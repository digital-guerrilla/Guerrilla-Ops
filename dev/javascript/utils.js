// ── String and value helpers ─────────────────────────────────
function v(x) {
  const s = String(x ?? '').trim();
  return (s === '' || s.toLowerCase() === 'n/a') ? '' : s;
}
function f(row, ...names) {
  for (const n of names) { const r = v(row[n]); if (r) return r; }
  return '';
}
const COBIE_FIELD_ALIASES = Object.freeze({
  typeName:['TypeName', 'Type Name'],
  floorName:['FloorName', 'Floor Name', 'Floor'],
  sheetName:['SheetName', 'Sheet Name'],
  rowName:['RowName', 'Row Name'],
});
function _cobieField(row, field) {
  return f(row, ...(COBIE_FIELD_ALIASES[field] || [field]));
}
function _scopeKey(facility, name) {
  return String(facility || '').toLowerCase() + '::' + String(name || '').toLowerCase();
}
function _rowKey(row, name) { return _scopeKey(row?._facility, name); }
function _findEntity(rows, name, facility = '') {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !Array.isArray(rows)) return null;
  return rows.find(row =>
    f(row, 'Name').toLowerCase() === key && (!facility || row._facility === facility)
  ) || null;
}
function _facilityProjectCode(facObj) {
  return f(facObj, 'ProjectCode', 'Project Code', 'ProjectName', 'Project Name', 'ProjectId', 'Project ID', 'Code');
}

function _facilityWorkbookSourceInfo(facObj) {
  const fileName = String(facObj?._fileName || '').trim();
  const projectCode = String(facObj?._projectCode || _facilityProjectCode(facObj) || '').trim();
  const facName = String(facObj?._facility || '').trim();
  const sharedProject = projectCode && db.facilities.filter(x => {
    if ((x._facility || '') !== facName) return false;
    return String(x._projectCode || _facilityProjectCode(x) || '').trim() === projectCode;
  }).length > 1;

  if (sharedProject) {
    return { kind: 'Project code', value: projectCode };
  }
  return { kind: 'Source file', value: fileName || projectCode };
}

function _projectAlignmentKey(facObj) {
  return String(_facilityProjectCode(facObj) || facObj?._facility || '').trim().toLowerCase();
}

function _projectAlignmentRow(facObj) {
  const facility = String(facObj?._facility || '').trim();
  const key = _projectAlignmentKey(facObj);
  if (!facility || !key) return null;
  return db.attributes.find(row =>
    (row._facility || '') === facility &&
    _cobieField(row, 'sheetName').toLowerCase() === 'project' &&
    _cobieField(row, 'rowName').toLowerCase() === key &&
    f(row, 'Name').toLowerCase() === 'floorplanalignment'
  ) || null;
}

function _resolvedFloorAlignmentForEntry(entry) {
  const fallback = { rotation:0, flipHorizontal:false, flipVertical:false, originXPct:0.5, originYPct:0.5, floorToSvg:null };
  if (!entry) return fallback;
  if (typeof _floorAlignmentValueForEntry === 'function' && typeof _floorAlignmentFromRaw === 'function') {
    try {
      const raw = _floorAlignmentValueForEntry(entry);
      const parsed = _floorAlignmentFromRaw(raw);
      return {
        rotation: Number(parsed?.rotation) || 0,
        flipHorizontal: !!parsed?.flipHorizontal,
        flipVertical: !!parsed?.flipVertical,
        originXPct: _unitInterval(parsed?.originXPct ?? parsed?.originX),
        originYPct: _unitInterval(parsed?.originYPct ?? parsed?.originY),
        floorToSvg:parsed?.floorToSvg || null,
      };
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function _unitInterval(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function _finiteNumber(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _applyFloorAlignmentToUv(u, v, alignment) {
  const uu = _finiteNumber(u);
  const vv = _finiteNumber(v);
  const theta = (Number(alignment?.rotation) || 0) * Math.PI / 180;
  const sx = alignment?.flipHorizontal ? -1 : 1;
  const sy = alignment?.flipVertical ? -1 : 1;

  let x = uu - 0.5;
  let y = vv - 0.5;

  x *= sx;
  y *= sy;

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const xr = (x * cos) - (y * sin);
  const yr = (x * sin) + (y * cos);

  return {
    u: xr + 0.5,
    v: yr + 0.5,
  };
}

function _invertFloorAlignmentFromUv(u, v, alignment) {
  const uu = _finiteNumber(u);
  const vv = _finiteNumber(v);
  const theta = (Number(alignment?.rotation) || 0) * Math.PI / 180;
  const sx = alignment?.flipHorizontal ? -1 : 1;
  const sy = alignment?.flipVertical ? -1 : 1;

  const x = uu - 0.5;
  const y = vv - 0.5;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Inverse rotation first.
  let xr = (x * cos) + (y * sin);
  let yr = (-x * sin) + (y * cos);

  // Then inverse flip.
  xr /= sx;
  yr /= sy;

  return {
    u: xr + 0.5,
    v: yr + 0.5,
  };
}

function _floorUvToSvgUv(u, v, alignment) {
  const map = alignment?.floorToSvg;
  if (map && [map.a, map.b, map.c, map.d, map.e, map.f].every(Number.isFinite)) {
    return {
      u:(map.a * u) + (map.b * v) + map.c,
      v:(map.d * u) + (map.e * v) + map.f,
    };
  }
  return _invertFloorAlignmentFromUv(u, v, alignment);
}

function _svgUvToFloorUv(u, v, alignment) {
  const map = alignment?.floorToSvg;
  if (map && [map.a, map.b, map.c, map.d, map.e, map.f].every(Number.isFinite)) {
    const determinant = (map.a * map.e) - (map.b * map.d);
    if (Math.abs(determinant) > 1e-12) {
      const x = u - map.c;
      const y = v - map.f;
      return {
        u:((map.e * x) - (map.b * y)) / determinant,
        v:((-map.d * x) + (map.a * y)) / determinant,
      };
    }
  }
  return _applyFloorAlignmentToUv(u, v, alignment);
}

function _projectFloorPlanAlignment(facObj) {
  const row = _projectAlignmentRow(facObj);
  if (!row) return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  const raw = f(row, 'Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value');
  if (!raw) return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      xPct: _unitInterval(parsed?.xPct ?? parsed?.centerX),
      yPct: _unitInterval(parsed?.yPct ?? parsed?.centerY),
      scale: Number(parsed?.scale) || 1,
      rotation: Number(parsed?.rotation) || 0,
      flipHorizontal: !!(parsed?.flipHorizontal || parsed?.flipX),
      flipVertical: !!(parsed?.flipVertical || parsed?.flipY),
    };
  } catch (_) {
    return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  }
}

function _setProjectFloorPlanAlignment(facObj, alignment) {
  const facility = String(facObj?._facility || '').trim();
  const key = _projectAlignmentKey(facObj);
  if (!facility || !key) return null;

  const row = _projectAlignmentRow(facObj) || {
    SheetName: 'Project',
    RowName: key,
    Name: 'FloorPlanAlignment',
    CreatedBy: '',
    CreatedOn: new Date().toISOString().slice(0, 10),
    ExtSystem: '',
    ExtObject: '',
    ExtIdentifier: '',
    _facility: facility,
    _projectCode: _facilityProjectCode(facObj) || '',
  };

  const payload = {
    xPct: _unitInterval(alignment?.xPct ?? alignment?.centerX),
    yPct: _unitInterval(alignment?.yPct ?? alignment?.centerY),
    scale: Number(alignment?.scale) || 1,
    rotation: Number(alignment?.rotation) || 0,
    flipHorizontal: !!(alignment?.flipHorizontal || alignment?.flipX),
    flipVertical: !!(alignment?.flipVertical || alignment?.flipY),
  };
  const value = JSON.stringify(payload);
  row.Value = value;
  row.AttributeValue = value;
  row['Attribute Value'] = value;
  row.NominalValue = value;
  row['Nominal Value'] = value;

  if (!db.attributes.includes(row)) db.attributes.push(row);
  return row;
}

function _roomUvToWorldXZ(bounds, u, v, clamp = true) {
  if (!bounds) return null;
  const rawU = _finiteNumber(u);
  const rawV = _finiteNumber(v);
  const uu = clamp ? _unitInterval(rawU) : rawU;
  const vv = clamp ? _unitInterval(rawV) : rawV;
  return {
    x: bounds.minX + (uu * bounds.sizeX),
    // SVG Y grows downward; map this to decreasing world Z for consistent orientation.
    z: bounds.maxZ - (vv * bounds.sizeZ),
  };
}

function _worldXZToRoomUv(bounds, x, z, clamp = true) {
  if (!bounds) return { u:0.5, v:0.5 };
  const sizeX = Math.max(1, Number(bounds.sizeX) || 1);
  const sizeZ = Math.max(1, Number(bounds.sizeZ) || 1);
  const rawU = (Number(x) - bounds.minX) / sizeX;
  const rawV = (bounds.maxZ - Number(z)) / sizeZ;
  const u = Number.isFinite(rawU) ? rawU : 0.5;
  const v = Number.isFinite(rawV) ? rawV : 0.5;
  return {
    u: clamp ? _unitInterval(u) : u,
    v: clamp ? _unitInterval(v) : v,
  };
}

// ── HTML escaping ────────────────────────────────────────────
const _ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s) { return String(s||'').replace(/[&<>"']/g, c => _ESC_MAP[c]); }

// ── Date formatting ──────────────────────────────────────────
function fmtDate(x) {
  if (!x) return '';
  if (x instanceof Date && !isNaN(x)) return x.toLocaleDateString();
  const s=String(x).trim();
  if (!s||s.toLowerCase()==='n/a') return '';
  const d=new Date(s);
  return !isNaN(d.getTime()) ? d.toLocaleDateString() : s;
}

// ── Document path and icon helpers ───────────────────────────
function _docTarget(directory) {
  return v(directory);
}
function _docUniqueKey(doc) {
  const facility = String(doc?._facility || '').trim().toLowerCase();
  const path = f(doc,'Directory').toLowerCase();
  const fallback = f(doc,'Name').toLowerCase() || [
    f(doc,'Description'), f(doc,'Category'),
    _cobieField(doc, 'sheetName'), _cobieField(doc, 'rowName'),
  ].join('::').toLowerCase();
  return facility + '::' + (path ? 'path::' + path : 'name::' + fallback);
}
function _docHref(path) {
  if (!path || /^(https?:|file:)/i.test(path)) return path || '';
  if (/^\\\\/.test(path)) return 'file:' + path.replace(/\\/g,'/');
  if (/^[a-z]:[\\\/]/i.test(path)) return 'file:///' + path.replace(/\\/g,'/');
  return path;
}

function _isSvgReference(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\.svg(?:[?#].*)?$/i.test(text);
}

function _isSvgDataUri(value) {
  return /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(String(value || '').trim());
}

function _looksLikeInlineSvg(value) {
  const text = String(value || '').trim();
  return /^<svg\b[\s\S]*<\/svg>$/i.test(text);
}

function _svgDataUri(svgText) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
}

function renderAttributeValue(value, attributeName = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  const isSvgNamed = String(attributeName || '').trim().toLowerCase() === 'svg';

  if (isSvgNamed && _looksLikeInlineSvg(text)) {
    const src = _svgDataUri(text);
    const safeText = esc(text);
    return `<div>
      <div style="margin-top:.15rem">
        <img src="${src}" alt="SVG attribute preview" loading="lazy"
          style="max-width:360px;max-height:200px;border:1px solid #d7dbe1;border-radius:4px;background:#fff;padding:2px"
          onerror="this.style.display='none'">
      </div>
      <details style="margin-top:.35rem">
        <summary style="cursor:pointer;color:#5b6470">Show SVG markup</summary>
        <pre style="white-space:pre-wrap;word-break:break-word;max-width:480px;max-height:220px;overflow:auto;margin-top:.3rem">${safeText}</pre>
      </details>
    </div>`;
  }

  if (!_isSvgReference(text) && !_isSvgDataUri(text)) return esc(text);

  const href = _docHref(text);
  // Guard against unsafe URI schemes before rendering in href/src.
  if (/^\s*javascript:/i.test(href)) return esc(text);

  const safeHref = esc(href);
  const safeText = esc(text);
  return `<div>
    <a href="${safeHref}" target="_blank" rel="noopener">${safeText}</a>
    <div style="margin-top:.35rem">
      <img src="${safeHref}" alt="${safeText}" loading="lazy"
        style="max-width:220px;max-height:120px;border:1px solid #d7dbe1;border-radius:4px;background:#fff;padding:2px"
        onerror="this.style.display='none'">
    </div>
  </div>`;
}

const _DOC_ICONS = {
  pdf:'bi-file-earmark-pdf', doc:'bi-file-earmark-word',  docx:'bi-file-earmark-word',
  xls:'bi-file-earmark-excel',xlsx:'bi-file-earmark-excel',xlsm:'bi-file-earmark-excel',
  dwg:'bi-file-earmark-code', dxf:'bi-file-earmark-code', ifc:'bi-box',
  png:'bi-file-earmark-image',jpg:'bi-file-earmark-image', jpeg:'bi-file-earmark-image',
  zip:'bi-file-earmark-zip',  rar:'bi-file-earmark-zip'
};
function docIcon(fn) {
  const ext = (String(fn||'').split('.').pop()||'').toLowerCase();
  return `<i class="bi ${_DOC_ICONS[ext]||'bi-file-earmark'}"></i>`;
}
