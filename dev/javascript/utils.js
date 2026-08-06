// ── String and value helpers ─────────────────────────────────
function v(x) {
  const s = String(x ?? '').trim();
  return (s === '' || s.toLowerCase() === 'n/a') ? '' : s;
}
function f(row, ...names) {
  for (const n of names) { const r = v(row[n]); if (r) return r; }
  return '';
}
function _scopeKey(facility, name) {
  return String(facility || '').toLowerCase() + '::' + String(name || '').toLowerCase();
}
function _rowKey(row, name) { return _scopeKey(row?._facility, name); }

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
    f(doc,'SheetName','Sheet Name'), f(doc,'RowName','Row Name'),
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
