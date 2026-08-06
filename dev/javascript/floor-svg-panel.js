// -- Floor SVG side panel -----------------------------------------------------
let _floorSvgCollapsed = false;
let _floorPanelWidth = 0;
let _floorPanelLastWidth = 0;

let _svgZoom = 1;
let _svgBaseWidth = 0;
let _svgBaseHeight = 0;
let _svgPanX = 0;
let _svgPanY = 0;
let _activeInlineSvg = null;
let _activeViewport = null;

let _isPanelDragging = false;
let _isStageDragging = false;

let _expandedFloorKey = '';
let _pendingUploadFloorKey = '';
let _highlightRoomIds = new Set();
let _lastFloorCounts = null;
let _svgHoverTooltipEl = null;

const _SVG_ATTR_CHUNK_SIZE = 30000;
const _SVG_ATTR_NAME_RE = /^svg(?:[^\d]*(\d+))?$/i;
const _SVG_FIT_PADDING_RATIO = 0.08;

function _attributeRawValue(attr) {
  if (!attr) return '';
  const keys = ['Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(attr, key)) continue;
    const value = attr[key];
    if (value === null || value === undefined) continue;
    const text = String(value);
    if (text.length) return text;
  }
  return '';
}

function _floorPanelElements() {
  return {
    panel: document.getElementById('svg-floor-panel'),
    stage: document.getElementById('svg-floor-stage'),
    edgeToggle: document.getElementById('svgp-edge-toggle'),
    uploadInput: document.getElementById('svgp-upload-input'),
  };
}

function _allFloorEntries() {
  return db.floors
    .filter(row => f(row, 'Name'))
    .map(row => ({
      key: _rowKey(row, f(row, 'Name')),
      name: f(row, 'Name'),
      facility: row._facility || '',
    }));
}

function _collectFloorSvgByKey() {
  const map = Object.create(null);
  const attrRows = db.attributes || [];

  db.floors.forEach(row => {
    const floorName = f(row, 'Name');
    if (!floorName) return;
    const facility = row._facility || '';
    const floorNameLower = floorName.toLowerCase();

    const svgRows = attrRows.filter(attr => {
      const sheetName = f(attr, 'SheetName', 'Sheet Name').toLowerCase();
      const rowName = f(attr, 'RowName', 'Row Name');
      const attrName = f(attr, 'Name');
      if (sheetName !== 'floor' || !rowName || !attrName) return false;
      if ((attr._facility || '') !== facility) return false;
      if (rowName.toLowerCase() !== floorNameLower) return false;
      return _SVG_ATTR_NAME_RE.test(attrName);
    });

    const chunks = [];
    let singleSvg = '';
    svgRows.forEach(attr => {
      const attrName = f(attr, 'Name');
      const attrValue = _attributeRawValue(attr);
      if (!attrName || !attrValue) return;
      const match = attrName.match(_SVG_ATTR_NAME_RE);
      if (!match) return;
      const idxNum = match[1] ? parseInt(match[1], 10) : 0;
      if (idxNum > 0) {
        chunks.push({ index:idxNum, value:attrValue });
      } else if (!singleSvg) {
        singleSvg = attrValue;
      }
    });

    let svgValue = '';
    if (chunks.length) {
      const hasPart1 = chunks.some(part => part.index === 1);
      if (!hasPart1 && singleSvg) chunks.push({ index:1, value:singleSvg });
      svgValue = chunks
        .sort((a, b) => a.index - b.index)
        .map(part => part.value)
        .join('');
    } else {
      svgValue = singleSvg;
    }

    if (svgValue) map[_rowKey(row, floorName)] = svgValue;
  });

  return map;
}

function _floorByKey(key) {
  return db.floors.find(row => _rowKey(row, f(row, 'Name')) === key) || null;
}

function _floorLabel(entry) {
  if (db.facilities.length > 1 && entry.facility) return entry.name + ' - ' + entry.facility;
  return entry.name;
}

function _desiredDefaultPanelWidth() {
  return Math.max(320, Math.round(window.innerWidth * 0.25));
}

function _clampPanelWidth(width) {
  const min = 280;
  const max = Math.max(min + 40, window.innerWidth - 260);
  return Math.max(min, Math.min(max, Math.round(width)));
}

function _setPanelWidth(els, width) {
  if (!els?.panel) return;
  const finalWidth = _clampPanelWidth(width);
  _floorPanelWidth = finalWidth;
  els.panel.style.width = finalWidth + 'px';
  els.panel.style.flexBasis = finalWidth + 'px';
}

function _decodeSvgDataUri(value) {
  const match = String(value || '').match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i);
  if (!match) return '';
  try {
    return match[1] ? atob(match[2]) : decodeURIComponent(match[2]);
  } catch (_) {
    return '';
  }
}

function _extractInlineSvgMarkup(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^<svg\b[\s\S]*<\/svg>$/i.test(text)) return text;
  if (/^data:image\/svg\+xml/i.test(text)) return _decodeSvgDataUri(text);
  return '';
}

function _sanitizeInlineSvg(markup) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;

  svg.querySelectorAll('script,foreignObject').forEach(node => node.remove());
  svg.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '');
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    });
  });

  const imported = document.importNode(svg, true);
  imported.removeAttribute('height');
  imported.setAttribute('width', '100%');
  return imported;
}

function _roomIdsToHighlight(counts) {
  const highlightCtx = typeof getGroupHighlightContext === 'function'
    ? getGroupHighlightContext()
    : { spaces:new Set() };
  const explicit = new Set([...sel.space].map(key => key.trim().toLowerCase()).filter(Boolean));
  highlightCtx.spaces?.forEach(space => explicit.add(String(space || '').trim().toLowerCase()));
  if (explicit.size) return explicit;

  const hasOtherFilters = !!(
    searchQuery ||
    sel.facility.size || sel.floor.size || sel.type.size || sel.system.size || sel.doccat.size
  );
  if (!hasOtherFilters) return explicit;

  const inferred = new Set();
  Object.entries(counts?.space || {}).forEach(([spaceNameLower, count]) => {
    if (count > 0) inferred.add(spaceNameLower);
  });
  return inferred;
}

function _highlightSvgRooms(svgRoot) {
  const selectedIds = _highlightRoomIds;
  svgRoot.querySelectorAll('.svg-room-hit').forEach(node => node.classList.remove('svg-room-hit'));
  if (!selectedIds.size) return;

  svgRoot.querySelectorAll('[id]').forEach(node => {
    const id = String(node.id || '').trim().toLowerCase();
    if (selectedIds.has(id)) node.classList.add('svg-room-hit');
  });
}

function _svgRoomKeyFromEventTarget(target) {
  if (!_activeInlineSvg || !target) return '';
  const roomNode = target.closest('[id]');
  if (!roomNode || !_activeInlineSvg.contains(roomNode)) return '';
  const id = String(roomNode.id || '').trim().toLowerCase();
  if (!id) return '';
  if (!idx?.spaces?.some(name => name.toLowerCase() === id)) return '';
  return id;
}

function _spaceRoomNumber(spaceRow) {
  if (!spaceRow) return '';
  return f(spaceRow,
    'RoomNumber', 'Room Number',
    'Number',
    'RoomTag', 'Room Tag',
    'TagNumber', 'Tag Number'
  );
}

function _spaceTooltipText(spaceRow) {
  if (!spaceRow) return '';
  const roomName = f(spaceRow, 'Name');
  if (!roomName) return '';
  const roomNumber = _spaceRoomNumber(spaceRow);
  return roomNumber
    ? `Room: ${roomName}\nNumber: ${roomNumber}`
    : `Room: ${roomName}`;
}

function _svgTooltipEnsure() {
  if (_svgHoverTooltipEl && document.body.contains(_svgHoverTooltipEl)) return _svgHoverTooltipEl;
  const el = document.createElement('div');
  el.className = 'room-hover-tooltip d-none';
  document.body.appendChild(el);
  _svgHoverTooltipEl = el;
  return el;
}

function _svgTooltipHide() {
  if (!_svgHoverTooltipEl) return;
  _svgHoverTooltipEl.classList.add('d-none');
}

function _svgTooltipShow(text, clientX, clientY) {
  if (!text) {
    _svgTooltipHide();
    return;
  }
  const el = _svgTooltipEnsure();
  el.textContent = text;
  el.classList.remove('d-none');
  const pad = 14;
  const maxX = window.innerWidth - el.offsetWidth - 6;
  const maxY = window.innerHeight - el.offsetHeight - 6;
  const left = Math.max(6, Math.min(maxX, clientX + pad));
  const top = Math.max(6, Math.min(maxY, clientY + pad));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function _spaceRowForHoveredSvgRoom(roomKey) {
  if (!roomKey) return null;
  const floor = _floorByKey(_expandedFloorKey);
  const floorName = floor ? f(floor, 'Name').toLowerCase() : '';
  const floorFacility = floor ? (floor._facility || '') : '';
  return db.spaces.find(space => {
    if (f(space, 'Name').toLowerCase() !== roomKey) return false;
    if (floor && (space._facility || '') !== floorFacility) return false;
    if (floor && f(space, 'FloorName', 'Floor Name', 'Floor').toLowerCase() !== floorName) return false;
    return true;
  }) || null;
}

function _applySvgRoomTooltips(svgRoot, floorEntry) {
  if (!svgRoot || !floorEntry) return;

  const spacesByName = new Map();
  db.spaces.forEach(space => {
    const name = f(space, 'Name').toLowerCase();
    if (!name) return;
    const sameFacility = (space._facility || '') === (floorEntry.facility || '');
    if (!sameFacility) return;
    const floorName = f(space, 'FloorName', 'Floor Name', 'Floor').toLowerCase();
    if (floorName !== floorEntry.name.toLowerCase()) return;
    if (!spacesByName.has(name)) spacesByName.set(name, space);
  });

  svgRoot.querySelectorAll('[id]').forEach(node => {
    const key = String(node.id || '').trim().toLowerCase();
    if (!key) return;
    const space = spacesByName.get(key);
    if (!space) return;
    const tooltip = _spaceTooltipText(space);
    if (!tooltip) return;

    node.setAttribute('title', tooltip);
    let titleNode = [...node.children].find(child => child.nodeName && child.nodeName.toLowerCase() === 'title');
    if (!titleNode) {
      titleNode = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      node.insertBefore(titleNode, node.firstChild || null);
    }
    titleNode.textContent = tooltip;
  });
}

function _applySvgRoomSelection(roomKey, additive) {
  if (!roomKey) return;

  if (additive) {
    if (sel.space.has(roomKey)) sel.space.delete(roomKey);
    else sel.space.add(roomKey);
  } else {
    const alreadyOnly = sel.space.size === 1 && sel.space.has(roomKey);
    sel.space.clear();
    if (!alreadyOnly) sel.space.add(roomKey);
  }

  applyFilters();
}

function _visibleFloorKeys(allFloors, counts) {
  const ordered = [];
  const push = key => { if (key && !ordered.includes(key)) ordered.push(key); };
  const facAllowed = entry => !sel.facility.size || sel.facility.has((entry.facility || '').toLowerCase());

  // Floor filter selection order follows floor list order.
  if (sel.floor.size) {
    allFloors.forEach(entry => {
      if (facAllowed(entry) && sel.floor.has(entry.name.toLowerCase())) push(entry.key);
    });
  }

  // Infer from explicit space selection.
  if (!ordered.length && sel.space.size) {
    db.spaces.forEach(space => {
      const spName = f(space, 'Name').toLowerCase();
      if (!sel.space.has(spName)) return;
      const floorName = f(space, 'FloorName', 'Floor Name', 'Floor').toLowerCase();
      if (!floorName) return;
      const match = allFloors.find(entry => entry.name.toLowerCase() === floorName && (!space._facility || entry.facility === (space._facility || '')));
      if (match && facAllowed(match)) push(match.key);
    });
  }

  // Use currently filtered floor counts.
  if (!ordered.length && counts?.floor) {
    allFloors.forEach(entry => {
      if (facAllowed(entry) && (counts.floor[entry.name.toLowerCase()] || 0) > 0) push(entry.key);
    });
  }

  // Fallback to all floors.
  if (!ordered.length) allFloors.forEach(entry => { if (facAllowed(entry)) push(entry.key); });
  return ordered;
}

function _openSvgFilePicker(els, floorKey) {
  if (!els?.uploadInput || !floorKey) return;
  _pendingUploadFloorKey = floorKey;
  els.uploadInput.click();
}

function _upsertFloorSvgAttribute(floorRow, svgMarkup) {
  if (!floorRow || !svgMarkup) return false;
  const floorName = f(floorRow, 'Name');
  if (!floorName) return false;
  const fac = floorRow._facility || '';
  const attrs = db.attributes || (db.attributes = []);

  // Remove existing SVG attribute rows for this floor (legacy single-row and chunked forms).
  for (let i = attrs.length - 1; i >= 0; i--) {
    const attr = attrs[i];
    if ((attr._facility || '') !== fac) continue;
    if (f(attr, 'SheetName', 'Sheet Name').toLowerCase() !== 'floor') continue;
    if (f(attr, 'RowName', 'Row Name') !== floorName) continue;
    if (!_SVG_ATTR_NAME_RE.test(f(attr, 'Name'))) continue;
    attrs.splice(i, 1);
  }

  const chunks = [];
  for (let offset = 0; offset < svgMarkup.length; offset += _SVG_ATTR_CHUNK_SIZE) {
    chunks.push(svgMarkup.slice(offset, offset + _SVG_ATTR_CHUNK_SIZE));
  }

  chunks.forEach((chunk, index) => {
    attrs.push({
      Name: chunks.length === 1 ? 'svg' : ('svg_' + (index + 1)),
      Value: chunk,
      SheetName:'Floor',
      RowName:floorName,
      CreatedBy:'',
      CreatedOn:new Date().toISOString().slice(0,10),
      ExtSystem:'',
      ExtObject:'',
      ExtIdentifier:'',
      _facility: fac,
    });
  });

  return true;
}

function _handleSvgUpload(file, floorKey) {
  const floorRow = _floorByKey(floorKey);
  if (!floorRow || !file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const svgMarkup = String(reader.result || '').trim();
    if (!/^<svg\b[\s\S]*<\/svg>$/i.test(svgMarkup)) {
      alert('The selected file does not contain valid SVG markup.');
      return;
    }
    if (_upsertFloorSvgAttribute(floorRow, svgMarkup)) {
      _logChange('floor', f(floorRow, 'Name'), floorRow._facility || '');
      refreshDisplay();
    }
  };
  reader.onerror = () => {
    alert('Could not read the selected SVG file.');
  };
  reader.readAsText(file);
}

function _svgNaturalSize(svgNode, viewport) {
  const vb = svgNode.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/\s+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w:p[2], h:p[3] };
  }
  const w = parseFloat(svgNode.getAttribute('width'));
  const h = parseFloat(svgNode.getAttribute('height'));
  if (w > 0 && h > 0) return { w, h };
  const viewportW = Math.max(320, viewport.clientWidth - 16);
  return { w:viewportW, h:Math.round(viewportW * 0.6) };
}

function _setSvgZoom(nextZoom, viewport, svgNode = _activeInlineSvg) {
  if (!svgNode || !viewport) return;
  const zoom = Math.max(0.2, Math.min(8, nextZoom));
  if (!_svgBaseWidth || !_svgBaseHeight) {
    const size = _svgNaturalSize(svgNode, viewport);
    _svgBaseWidth = size.w;
    _svgBaseHeight = size.h;
  }
  _svgZoom = zoom;
  svgNode.style.width = Math.max(100, Math.round(_svgBaseWidth)) + 'px';
  svgNode.style.height = Math.max(60, Math.round(_svgBaseHeight)) + 'px';
  svgNode.style.transformOrigin = '0 0';
  svgNode.style.transform = `translate(${_svgPanX}px, ${_svgPanY}px) scale(${_svgZoom})`;
}

function _centerSvgViewport(viewport) {
  if (!viewport || !_activeInlineSvg) return;
  const scaledW = _svgBaseWidth * _svgZoom;
  const scaledH = _svgBaseHeight * _svgZoom;
  _svgPanX = Math.round((viewport.clientWidth - scaledW) / 2);
  _svgPanY = Math.round((viewport.clientHeight - scaledH) / 2);
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  _setSvgZoom(_svgZoom, viewport, _activeInlineSvg);
}

function _fitSvgToViewport(viewport, svgNode = _activeInlineSvg) {
  if (!viewport || !svgNode) return;
  if (!_svgBaseWidth || !_svgBaseHeight) {
    const size = _svgNaturalSize(svgNode, viewport);
    _svgBaseWidth = size.w;
    _svgBaseHeight = size.h;
  }

  const availW = Math.max(80, viewport.clientWidth * (1 - (_SVG_FIT_PADDING_RATIO * 2)));
  const availH = Math.max(80, viewport.clientHeight * (1 - (_SVG_FIT_PADDING_RATIO * 2)));
  const fitZoom = Math.min(availW / _svgBaseWidth, availH / _svgBaseHeight);
  _svgZoom = Math.max(0.2, Math.min(8, fitZoom || 1));

  const scaledW = _svgBaseWidth * _svgZoom;
  const scaledH = _svgBaseHeight * _svgZoom;
  _svgPanX = Math.round((viewport.clientWidth - scaledW) / 2);
  _svgPanY = Math.round((viewport.clientHeight - scaledH) / 2);

  _setSvgZoom(_svgZoom, viewport, svgNode);
}

function _zoomSvgAtCursor(viewport, clientX, clientY, factor) {
  if (!viewport || !_activeInlineSvg) return;
  const rect = viewport.getBoundingClientRect();
  const anchorX = clientX - rect.left;
  const anchorY = clientY - rect.top;
  const oldZoom = _svgZoom;
  const nextZoom = Math.max(0.2, Math.min(8, oldZoom * factor));
  if (Math.abs(nextZoom - oldZoom) < 0.0001) return;

  const worldX = (anchorX - _svgPanX) / oldZoom;
  const worldY = (anchorY - _svgPanY) / oldZoom;
  _svgPanX = anchorX - (worldX * nextZoom);
  _svgPanY = anchorY - (worldY * nextZoom);
  _setSvgZoom(nextZoom, viewport, _activeInlineSvg);
}

function _setViewportCursor(viewport) {
  if (!viewport) return;
  if (_isStageDragging && _activeViewport === viewport) {
    viewport.style.cursor = 'grabbing';
  } else {
    viewport.style.cursor = _activeInlineSvg && _activeViewport === viewport ? 'grab' : 'auto';
  }
}

function _renderStackSkeleton(els, floors, svgByKey) {
  const html = floors.map((entry, index) => {
    const expanded = entry.key === _expandedFloorKey;
    const hasSvg = !!svgByKey[entry.key];
    return `<section class="svg-floor-card${expanded ? ' expanded' : ''}${index === 0 ? ' svg-floor-card-first' : ''}" data-floor-key="${esc(entry.key)}">
      <button class="svg-floor-head" type="button" data-floor-toggle="${esc(entry.key)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <i class="bi bi-chevron-right svg-floor-chev"></i>
        <span class="svg-floor-name">${esc(_floorLabel(entry))}</span>
        <span class="svg-floor-state">${hasSvg ? 'SVG' : 'Missing'}</span>
      </button>
      <div class="svg-floor-body">
        <div class="svg-floor-inner" data-floor-body="${esc(entry.key)}"></div>
      </div>
    </section>`;
  }).join('');
  els.stage.innerHTML = `<div class="svg-floor-stack">${html}</div>`;
}

function _renderExpandedFloorContent(els, floorEntry, svgRaw) {
  const body = [...els.stage.querySelectorAll('[data-floor-body]')]
    .find(node => node.getAttribute('data-floor-body') === floorEntry.key);
  if (!body) return;

  _activeInlineSvg = null;
  _activeViewport = null;
  _svgZoom = 1;
  _svgBaseWidth = 0;
  _svgBaseHeight = 0;
  _svgPanX = 0;
  _svgPanY = 0;

  if (!svgRaw) {
    body.innerHTML = `<div class="svg-floor-viewport">
      <div class="svgp-missing-wrap">
        <div class="svgp-missing-title">Missing SVG</div>
        <div class="svgp-missing-sub">${esc(_floorLabel(floorEntry))}</div>
        <p class="svgp-missing-msg">Load an SVG here to render this floor plan.</p>
        <button class="btn btn-sm btn-outline-secondary" type="button" data-svg-upload="${esc(floorEntry.key)}">
          <i class="bi bi-upload me-1"></i>Load SVG Here
        </button>
      </div>
    </div>`;
    return;
  }

  const inline = _extractInlineSvgMarkup(svgRaw);
  body.innerHTML = `<div class="svgp-stage-actions">
    <button class="btn btn-sm btn-outline-secondary" type="button" data-svg-upload="${esc(floorEntry.key)}">
      <i class="bi bi-arrow-repeat me-1"></i>Swap SVG
    </button>
  </div>
  <div class="svg-floor-viewport" data-inline-svg="${inline ? '1' : '0'}">
    <div class="svg-floor-canvas"></div>
  </div>`;

  const viewport = body.querySelector('.svg-floor-viewport');
  const canvas = body.querySelector('.svg-floor-canvas');
  if (!viewport || !canvas) return;

  if (inline) {
    const cleanSvg = _sanitizeInlineSvg(inline);
    if (cleanSvg) {
      canvas.appendChild(cleanSvg);
      _activeInlineSvg = cleanSvg;
      _activeViewport = viewport;
      _setSvgZoom(1, viewport, cleanSvg);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (_activeViewport === viewport && _activeInlineSvg === cleanSvg) {
            _fitSvgToViewport(viewport, cleanSvg);
          }
        });
      });
      _applySvgRoomTooltips(cleanSvg, floorEntry);
      _highlightSvgRooms(cleanSvg);
      _setViewportCursor(viewport);
      return;
    }
  }

  const href = _docHref(svgRaw);
  if (!href || /^\s*javascript:/i.test(href)) {
    canvas.innerHTML = '<div class="svgp-missing-wrap"><div class="svgp-missing-title">Invalid SVG source</div></div>';
    return;
  }
  canvas.innerHTML = `<a href="${esc(href)}" target="_blank" rel="noopener" style="font-size:.74rem">${esc(svgRaw)}</a>
    <img src="${esc(href)}" alt="SVG preview" loading="lazy" style="max-width:100%;height:auto;margin-top:.4rem">`;
}

function _applyFloorPanelCollapsedState(els) {
  els.panel.classList.toggle('svg-panel-collapsed', _floorSvgCollapsed);
  els.edgeToggle?.setAttribute('aria-expanded', _floorSvgCollapsed ? 'false' : 'true');
  if (_floorSvgCollapsed) {
    _floorPanelLastWidth = _floorPanelWidth || _desiredDefaultPanelWidth();
  } else if (!_floorPanelWidth) {
    _setPanelWidth(els, _floorPanelLastWidth || _desiredDefaultPanelWidth());
  }
}

function _bindEdgeDragAndToggle(els) {
  const edge = els?.edgeToggle;
  if (!edge) return;
  if (edge.dataset.bound === '1') return;
  edge.dataset.bound = '1';

  edge.addEventListener('mousedown', event => {
    if (event.button !== 0 || window.matchMedia('(max-width: 1200px)').matches) return;
    const startX = event.clientX;
    const startW = els.panel.getBoundingClientRect().width;
    _isPanelDragging = false;

    const onMove = moveEvent => {
      const delta = startX - moveEvent.clientX;
      if (Math.abs(delta) > 3) _isPanelDragging = true;
      if (_floorSvgCollapsed) {
        _floorSvgCollapsed = false;
        els.panel.classList.remove('svg-panel-collapsed');
        els.edgeToggle?.setAttribute('aria-expanded', 'true');
      }
      _setPanelWidth(els, startW + delta);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!_isPanelDragging) {
        _floorSvgCollapsed = !_floorSvgCollapsed;
        _applyFloorPanelCollapsedState(els);
      } else {
        _floorPanelLastWidth = _floorPanelWidth;
      }
      _isPanelDragging = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  window.addEventListener('resize', () => {
    if (_floorSvgCollapsed || !els.panel || window.matchMedia('(max-width: 1200px)').matches) return;
    _setPanelWidth(els, _floorPanelWidth || _desiredDefaultPanelWidth());
  });
}

function _bindStageInteractions(els) {
  if (!els?.stage || els.stage.dataset.bound === '1') return;
  els.stage.dataset.bound = '1';

  els.stage.addEventListener('click', event => {
    const roomKey = _svgRoomKeyFromEventTarget(event.target);
    if (roomKey) {
      _applySvgRoomSelection(roomKey, !!(event.ctrlKey || event.metaKey));
      return;
    }

    const toggle = event.target.closest('[data-floor-toggle]');
    if (toggle) {
      const key = toggle.getAttribute('data-floor-toggle') || '';
      if (key && key !== _expandedFloorKey) {
        _expandedFloorKey = key;
        refreshFloorSvgPanel([], _lastFloorCounts || {});
      }
      return;
    }

    const uploadBtn = event.target.closest('[data-svg-upload]');
    if (uploadBtn) {
      const key = uploadBtn.getAttribute('data-svg-upload') || '';
      _openSvgFilePicker(els, key);
    }
  });

  els.stage.addEventListener('wheel', event => {
    const viewport = event.target.closest('.svg-floor-viewport');
    if (!viewport || !_activeInlineSvg || viewport !== _activeViewport) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1.12 : 0.89;
    _zoomSvgAtCursor(viewport, event.clientX, event.clientY, step);
  }, { passive:false });

  els.stage.addEventListener('mousemove', event => {
    if (_isStageDragging) {
      _svgTooltipHide();
      return;
    }
    const roomKey = _svgRoomKeyFromEventTarget(event.target);
    if (!roomKey) {
      _svgTooltipHide();
      return;
    }
    const roomRow = _spaceRowForHoveredSvgRoom(roomKey);
    const text = _spaceTooltipText(roomRow);
    _svgTooltipShow(text, event.clientX, event.clientY);
  });

  els.stage.addEventListener('mouseleave', () => {
    _svgTooltipHide();
  });

  els.stage.addEventListener('mousedown', event => {
    const viewport = event.target.closest('.svg-floor-viewport');
    if (event.button !== 0 || !viewport || !_activeInlineSvg || viewport !== _activeViewport) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = _svgPanX;
    const startPanY = _svgPanY;
    _isStageDragging = false;

    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!_isStageDragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) _isStageDragging = true;
      if (_isStageDragging) {
        _svgPanX = startPanX + dx;
        _svgPanY = startPanY + dy;
        _setSvgZoom(_svgZoom, viewport, _activeInlineSvg);
        moveEvent.preventDefault();
      }
      _setViewportCursor(viewport);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _isStageDragging = false;
      _setViewportCursor(viewport);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function initFloorSvgPanel() {
  const els = _floorPanelElements();
  if (!els.panel || !els.edgeToggle) return;

  _setPanelWidth(els, _desiredDefaultPanelWidth());
  _bindEdgeDragAndToggle(els);
  _bindStageInteractions(els);

  if (els.uploadInput && !els.uploadInput.dataset.bound) {
    els.uploadInput.dataset.bound = '1';
    els.uploadInput.addEventListener('change', () => {
      const file = els.uploadInput.files?.[0] || null;
      if (file && _pendingUploadFloorKey) _handleSvgUpload(file, _pendingUploadFloorKey);
      _pendingUploadFloorKey = '';
      els.uploadInput.value = '';
    });
  }

  _applyFloorPanelCollapsedState(els);
}

function refreshFloorSvgPanel(filteredComps, counts) {
  const els = _floorPanelElements();
  if (!els.panel || !els.stage) return;

  _lastFloorCounts = counts || {};
  _highlightRoomIds = _roomIdsToHighlight(counts);

  const allFloors = _allFloorEntries();
  if (!allFloors.length) {
    els.panel.classList.add('d-none');
    els.stage.innerHTML = '';
    return;
  }

  const visibleKeys = _visibleFloorKeys(allFloors, counts);
  const visibleKeySet = new Set(visibleKeys);
  const floors = allFloors.filter(entry => visibleKeySet.has(entry.key));
  const svgByKey = _collectFloorSvgByKey();

  if (!_expandedFloorKey || !visibleKeySet.has(_expandedFloorKey)) {
    _expandedFloorKey = floors[0]?.key || '';
  }

  els.panel.classList.remove('d-none');
  _renderStackSkeleton(els, floors, svgByKey);
  const expandedFloor = floors.find(entry => entry.key === _expandedFloorKey) || floors[0];
  if (expandedFloor) {
    _expandedFloorKey = expandedFloor.key;
    _renderExpandedFloorContent(els, expandedFloor, svgByKey[expandedFloor.key] || '');
  }

  _applyFloorPanelCollapsedState(els);
}

function handleFloorSvgPanelResize() {
  if (!_activeViewport || !_activeInlineSvg) return;
  _setSvgZoom(_svgZoom, _activeViewport, _activeInlineSvg);
  _setViewportCursor(_activeViewport);
}

function resetFloorSvgPanel() {
  const els = _floorPanelElements();
  if (!els.panel || !els.stage) return;
  els.panel.classList.add('d-none');
  els.stage.innerHTML = '';

  _activeInlineSvg = null;
  _activeViewport = null;
  _svgZoom = 1;
  _svgBaseWidth = 0;
  _svgBaseHeight = 0;
  _svgPanX = 0;
  _svgPanY = 0;
  _expandedFloorKey = '';
  _pendingUploadFloorKey = '';
  _highlightRoomIds = new Set();
  _lastFloorCounts = null;
  _svgTooltipHide();
}

initFloorSvgPanel();
