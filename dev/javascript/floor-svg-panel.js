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
const _svgViewRotationByFloor = new Map();

let _isPanelDragging = false;
let _isStageDragging = false;

let _expandedFloorKey = '';
let _pendingUploadFloorKey = '';
let _highlightRoomIds = new Set();
let _lastFloorCounts = null;
let _lastFilteredComps = [];
let _svgHoverTooltipEl = null;
let _floorPlanAlignment = { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, originXPct: 0.5, originYPct: 0.5 };
let _floorPlanAlignmentDraft = null;
let _floorPlanAlignmentFloorKey = '';
let _floorPlanAlignmentModalKey = '';
let _floorAlignView = { zoom: 1, panX: 0, panY: 0 };
let _floorAlignFillOpacity = 0.35;
let _activeFloorKey = '';

const _SVG_ATTR_CHUNK_SIZE = 30000;
const _SVG_ATTR_NAME_RE = /^svg(?:[^\d]*(\d+))?$/i;
const _ALIGN_ATTR_CHUNK_SIZE = 30000;
const _ALIGN_ATTR_NAME_RE = /^svg-alignment(?:[^\d]*(\d+))?$/i;
const _SVG_FIT_PADDING_RATIO = 0.08;
const _SVG_MIN_ZOOM = 0.05;

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
  const seen = new Set();
  const entries = [];
  db.floors.forEach(row => {
    const name = f(row, 'Name');
    if (!name) return;
    const key = _rowKey(row, name);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      key,
      name,
      facility: row._facility || '',
      fileName: row._fileName || '',
    });
  });
  return entries;
}

function _collectFloorSvgByKey() {
  return _collectChunkedFloorAttributes(_SVG_ATTR_NAME_RE);
}

function _collectChunkedFloorAttributes(namePattern) {
  const buckets = new Map();
  (db.attributes || []).forEach(attr => {
    if (_cobieField(attr, 'sheetName').toLowerCase() !== 'floor') return;
    const rowName = _cobieField(attr, 'rowName');
    const attrName = f(attr, 'Name');
    const value = _attributeRawValue(attr);
    const match = attrName.match(namePattern);
    if (!rowName || !match || !value) return;
    const key = _scopeKey(attr._facility, rowName);
    const bucket = buckets.get(key) || { single:'', chunks:[] };
    const index = match[1] ? parseInt(match[1], 10) : 0;
    if (index > 0) bucket.chunks.push({ index, value });
    else if (!bucket.single) bucket.single = value;
    buckets.set(key, bucket);
  });

  const values = Object.create(null);
  buckets.forEach((bucket, key) => {
    if (!bucket.chunks.length) {
      values[key] = bucket.single;
      return;
    }
    if (!bucket.chunks.some(part => part.index === 1) && bucket.single) {
      bucket.chunks.push({ index:1, value:bucket.single });
    }
    values[key] = bucket.chunks
      .sort((a, b) => a.index - b.index)
      .map(part => part.value)
      .join('');
  });
  return values;
}

function _writeChunkedFloorAttribute(floorRow, raw, baseName, namePattern, chunkSize) {
  if (!floorRow || !raw) return false;
  const floorName = f(floorRow, 'Name');
  if (!floorName) return false;
  const facility = floorRow._facility || '';
  const attrs = db.attributes || (db.attributes = []);

  for (let index = attrs.length - 1; index >= 0; index--) {
    const attr = attrs[index];
    if ((attr._facility || '') !== facility) continue;
    if (_cobieField(attr, 'sheetName').toLowerCase() !== 'floor') continue;
    if (_cobieField(attr, 'rowName') !== floorName) continue;
    if (namePattern.test(f(attr, 'Name'))) attrs.splice(index, 1);
  }

  const chunks = [];
  for (let offset = 0; offset < raw.length; offset += chunkSize) {
    chunks.push(raw.slice(offset, offset + chunkSize));
  }
  chunks.forEach((chunk, index) => {
    attrs.push({
      Name: chunks.length === 1 ? baseName : `${baseName}_${index + 1}`,
      Value:chunk,
      SheetName:'Floor',
      RowName:floorName,
      CreatedBy:'',
      CreatedOn:new Date().toISOString().slice(0, 10),
      ExtSystem:'', ExtObject:'', ExtIdentifier:'',
      _facility:facility,
    });
  });
  return true;
}

function _floorByKey(key) {
  return db.floors.find(row => _rowKey(row, f(row, 'Name')) === key) || null;
}

function _floorLabel(entry) {
  if (db.facilities.length > 1 && entry.facility) return entry.name + ' - ' + entry.facility;
  return entry.name;
}

function _floorAlignmentFacility(entry) {
  return db.facilities.find(fac => fac._facility === entry?.facility) || null;
}

function _defaultFloorAlignment() {
  return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false, originXPct: 0.5, originYPct: 0.5 };
}

function _floorAlignmentAttrValueForRow(floorRow) {
  if (!floorRow) return '';
  const floorName = f(floorRow, 'Name');
  if (!floorName) return '';
  return _collectChunkedFloorAttributes(_ALIGN_ATTR_NAME_RE)[_rowKey(floorRow, floorName)] || '';
}

function _floorAlignmentValueForEntry(entry) {
  return _floorAlignmentAttrValueForRow(_floorByKey(entry?.key || ''));
}

function _floorAlignmentHasStoredValue(entry) {
  return !!String(_floorAlignmentValueForEntry(entry) || '').trim();
}

function _floorAlignmentFromRaw(raw) {
  if (!raw) return _defaultFloorAlignment();
  try {
    const parsed = JSON.parse(raw);
    const axisScales = [Number(parsed?.scaleX), Number(parsed?.scaleY)].filter(value => Number.isFinite(value) && value > 0);
    const scale = axisScales.length ? Math.min(...axisScales) : (Number(parsed?.scale) || 1);
    return {
      xPct: _unitInterval(parsed?.xPct ?? parsed?.centerX),
      yPct: _unitInterval(parsed?.yPct ?? parsed?.centerY),
      scale,
      rotation: Number(parsed?.rotation) || 0,
      flipHorizontal: !!(parsed?.flipHorizontal || parsed?.flipX),
      flipVertical: !!(parsed?.flipVertical || parsed?.flipY),
      originXPct: _unitInterval(parsed?.originXPct ?? parsed?.originX),
      originYPct: _unitInterval(parsed?.originYPct ?? parsed?.originY),
      floorToSvg:parsed?.floorToSvg || null,
    };
  } catch (_) {
    return _defaultFloorAlignment();
  }
}

function _floorAlignmentToRaw(alignment) {
  const scale = Number(alignment?.scale) || 1;
  return JSON.stringify({
    xPct: _unitInterval(alignment?.xPct ?? alignment?.centerX),
    yPct: _unitInterval(alignment?.yPct ?? alignment?.centerY),
    scale,
    rotation: Number(alignment?.rotation) || 0,
    flipHorizontal: !!(alignment?.flipHorizontal || alignment?.flipX),
    flipVertical: !!(alignment?.flipVertical || alignment?.flipY),
    originXPct: _unitInterval(alignment?.originXPct ?? alignment?.originX),
    originYPct: _unitInterval(alignment?.originYPct ?? alignment?.originY),
    floorToSvg:alignment?.floorToSvg || undefined,
  });
}

function _upsertFloorAlignmentAttribute(floorRow, alignment) {
  const raw = _floorAlignmentToRaw(alignment);
  return _writeChunkedFloorAttribute(floorRow, raw, 'svg-alignment', _ALIGN_ATTR_NAME_RE, _ALIGN_ATTR_CHUNK_SIZE);
}

function _floorAlignmentLoad(entry) {
  const raw = _floorAlignmentValueForEntry(entry);
  _floorPlanAlignment = _floorAlignmentFromRaw(raw);
  _floorPlanAlignmentDraft = null;
  _floorPlanAlignmentFloorKey = entry?.key || '';
  return _floorPlanAlignment;
}

function _floorAlignmentSave(entry, alignment) {
  const floorRow = _floorByKey(entry?.key || '');
  if (!floorRow) return null;
  const beforeValue = _floorAlignmentAttrValueForRow(floorRow);
  const saved = _upsertFloorAlignmentAttribute(floorRow, alignment);
  const afterValue = _floorAlignmentAttrValueForRow(floorRow);

  if (saved && afterValue !== beforeValue) {
    _logChange('attribute', `Floor/${f(floorRow, 'Name')}/svg-alignment`, floorRow._facility || '');
    if (typeof _viewer3dRebuildRoomGeometryCache === 'function') {
      _viewer3dRebuildRoomGeometryCache(entry.key);
    }
  }

  _floorPlanAlignment = {
    xPct: _unitInterval(alignment?.xPct ?? alignment?.centerX),
    yPct: _unitInterval(alignment?.yPct ?? alignment?.centerY),
    scale:Number(alignment?.scale) || 1,
    rotation: Number(alignment?.rotation) || 0,
    flipHorizontal: !!alignment?.flipHorizontal,
    flipVertical: !!alignment?.flipVertical,
    originXPct: _unitInterval(alignment?.originXPct ?? alignment?.originX),
    originYPct: _unitInterval(alignment?.originYPct ?? alignment?.originY),
    floorToSvg:alignment?.floorToSvg || null,
  };
  _floorPlanAlignmentFloorKey = entry?.key || '';
  return saved;
}

function _floorAlignmentButtonLabel(entry) {
  const label = _floorAlignmentHasStoredValue(entry) ? 'Modify' : 'Align';
  const inlineBtn = [...document.querySelectorAll('[data-svg-align]')]
    .find(node => (node.getAttribute('data-svg-align') || '') === (entry?.key || ''));
  if (inlineBtn) {
    inlineBtn.textContent = label;
    inlineBtn.title = `${label} Floor Plan`;
  }
  const btn = document.getElementById('align-floor-plans-btn');
  if (btn) {
    btn.innerHTML = `<i class="bi bi-arrows-move me-1"></i>${label}`;
    btn.title = label;
  }
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
    if (selectedIds.has(id)) {
      node.classList.add('svg-room-hit');
      node.setAttribute('pointer-events', 'all');
      if (!node.style.cursor) node.style.cursor = 'pointer';
    }
  });
}

function _filteredDotPositionsForFloor(floorEntry, alignmentOverride = null) {
  const points = [];
  if (!floorEntry) return points;
  const alignment = alignmentOverride || _resolvedFloorAlignmentForEntry(floorEntry);

  const highlightCtx = typeof getGroupHighlightContext === 'function'
    ? getGroupHighlightContext()
    : { componentKeys:new Set() };
  const hasComponentHighlight = (highlightCtx.componentKeys || new Set()).size > 0;
  const showDots = !!(
    searchQuery ||
    sel.type.size || sel.system.size || sel.doccat.size ||
    hasComponentHighlight
  );
  if (!showDots) return points;

  const floorNameLower = String(floorEntry.name || '').toLowerCase();
  const facility = String(floorEntry.facility || '');
  const coordIndex = typeof _viewer3dCoordIndex === 'function' ? _viewer3dCoordIndex() : null;
  const floorBoxes = _alignmentRoomBoxes(floorEntry, coordIndex);
  if (!floorBoxes.length) return points;
  const minX = Math.min(...floorBoxes.map(box => box.x));
  const minZ = Math.min(...floorBoxes.map(box => box.y));
  const maxX = Math.max(...floorBoxes.map(box => box.x + box.w));
  const maxZ = Math.max(...floorBoxes.map(box => box.y + box.h));
  const floorBounds = {
    minX,
    maxX,
    minZ,
    maxZ,
    sizeX:Math.max(1, maxX - minX),
    sizeZ:Math.max(1, maxZ - minZ),
  };
  const spacesOnFloor = new Set(db.spaces
    .filter(space =>
      (space._facility || '') === facility &&
      _cobieField(space, 'floorName').toLowerCase() === floorNameLower
    )
    .map(space => f(space, 'Name').toLowerCase())
    .filter(Boolean));

  const componentRows = hasComponentHighlight
    ? (highlightCtx.components || [])
    : (_lastFilteredComps || []);
  componentRows.forEach(comp => {
    if ((comp._facility || '') !== facility) return;
    const spaceLower = f(comp, 'Space').toLowerCase();
    if (spaceLower && !spacesOnFloor.has(spaceLower)) return;
    if (!spaceLower && !hasComponentHighlight) return;

    const compCoord = (coordIndex && typeof _viewer3dCoordFor === 'function')
      ? _viewer3dCoordFor(coordIndex, 'component', comp._facility, f(comp, 'Name'))
      : null;
    const compBounds = typeof _viewer3dBounds === 'function' ? _viewer3dBounds(compCoord, 1200) : null;
    if (!compBounds) return;
    const centerX = compBounds.centerX;
    const centerZ = compBounds.centerZ;

    const uv = _worldXZToRoomUv(floorBounds, centerX, centerZ, false);
    const rawUv = _floorUvToSvgUv(uv.u, uv.v, alignment);
    if (![rawUv.u, rawUv.v].every(Number.isFinite)) return;
    points.push({ u:rawUv.u, v:rawUv.v });
  });

  return points;
}

function _svgDrawingBounds(svgRoot) {
  if (!svgRoot) return null;
  const viewport = _svgCanvasSizeForFlip(svgRoot);
  if (viewport) return { x:viewport.minX, y:viewport.minY, width:viewport.width, height:viewport.height };
  try {
    const box = svgRoot.getBBox();
    if (box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0) {
      return { x:box.x, y:box.y, width:box.width, height:box.height };
    }
  } catch (_) {
    // Fall through to the SVG viewport when geometry bounds are unavailable.
  }
  return _svgCanvasSizeForFlip(svgRoot);
}

function _svgNodeRootBounds(node) {
  if (!node || typeof node.getBBox !== 'function') return null;
  let box;
  try {
    box = node.getBBox();
  } catch (_) {
    return null;
  }
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || box.width <= 0 || box.height <= 0) return null;

  const ctm = typeof node.getCTM === 'function' ? node.getCTM() : null;
  if (!ctm) return { x:box.x, y:box.y, width:box.width, height:box.height };
  const corners = [
    { x:box.x, y:box.y },
    { x:box.x + box.width, y:box.y },
    { x:box.x, y:box.y + box.height },
    { x:box.x + box.width, y:box.y + box.height },
  ].map(point => ({
    x:(ctm.a * point.x) + (ctm.c * point.y) + ctm.e,
    y:(ctm.b * point.x) + (ctm.d * point.y) + ctm.f,
  }));
  const xs = corners.map(point => point.x);
  const ys = corners.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x:minX,
    y:minY,
    width:Math.max(0, Math.max(...xs) - minX),
    height:Math.max(0, Math.max(...ys) - minY),
  };
}

function _applyFilteredDots(svgRoot, floorEntry, alignmentOverride = null) {
  if (!svgRoot || !floorEntry) return;
  svgRoot.querySelectorAll('.svg-filter-dot-layer').forEach(node => node.remove());

  const points = _filteredDotPositionsForFloor(floorEntry, alignmentOverride);
  if (!points.length) return;
  const drawingBounds = _svgDrawingBounds(svgRoot);
  if (!drawingBounds) return;

  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.setAttribute('class', 'svg-filter-dot-layer');
  layer.setAttribute('pointer-events', 'none');
  const placedByPoint = new Map();

  points.forEach(point => {
    const cx = drawingBounds.x + (point.u * drawingBounds.width);
    const cy = drawingBounds.y + (point.v * drawingBounds.height);
    const pointKey = `${Math.round(cx * 10)}:${Math.round(cy * 10)}`;
    const pointPlaced = placedByPoint.get(pointKey) || 0;
    placedByPoint.set(pointKey, pointPlaced + 1);
    const ringRadius = pointPlaced > 0 ? Math.max(3, Math.min(11, Math.sqrt(pointPlaced) * 1.8)) : 0;
    const theta = pointPlaced > 0 ? (pointPlaced * (Math.PI * 0.7639)) : 0;

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'svg-filter-dot');
    dot.setAttribute('cx', String(cx + (Math.cos(theta) * ringRadius)));
    dot.setAttribute('cy', String(cy + (Math.sin(theta) * ringRadius)));
    dot.setAttribute('r', '2.7');
    layer.appendChild(dot);
  });

  svgRoot.appendChild(layer);
}

function roomSvgRoot(node) {
  if (!node) return null;
  if (node.nodeName && node.nodeName.toLowerCase() === 'svg') return node;
  return node.ownerSVGElement || null;
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
    if (floor && _cobieField(space, 'floorName').toLowerCase() !== floorName) return false;
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
    const floorName = _cobieField(space, 'floorName').toLowerCase();
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
    node.setAttribute('pointer-events', 'all');
    if (!node.style.cursor) node.style.cursor = 'pointer';
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
  selectedCategoryLevels.space.clear();

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
      const floorName = _cobieField(space, 'floorName').toLowerCase();
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
  return _writeChunkedFloorAttribute(floorRow, svgMarkup, 'svg', _SVG_ATTR_NAME_RE, _SVG_ATTR_CHUNK_SIZE);
}

function _svgCanvasSizeForFlip(svgRoot) {
  const viewBox = String(svgRoot.getAttribute('viewBox') || '').trim();
  if (viewBox) {
    const p = viewBox.split(/\s+/).map(Number);
    if (p.length === 4 && Number.isFinite(p[2]) && Number.isFinite(p[3]) && p[2] > 0 && p[3] > 0) {
      return { minX: p[0], minY: p[1], width: p[2], height: p[3] };
    }
  }
  const width = parseFloat(svgRoot.getAttribute('width'));
  const height = parseFloat(svgRoot.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { minX: 0, minY: 0, width, height };
  }
  return null;
}

function _bakeFlipIntoSvgMarkup(svgMarkup, flipH, flipV) {
  if (!flipH && !flipV) return svgMarkup;
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(svgMarkup || ''), 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return svgMarkup;

  const size = _svgCanvasSizeForFlip(svg);
  if (!size) return svgMarkup;

  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  const tx = flipH ? (2 * size.minX + size.width) : 0;
  const ty = flipV ? (2 * size.minY + size.height) : 0;
  g.setAttribute('transform', `matrix(${sx} 0 0 ${sy} ${tx} ${ty})`);

  while (svg.firstChild) g.appendChild(svg.firstChild);
  svg.appendChild(g);

  return new XMLSerializer().serializeToString(svg);
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
      if (typeof _viewer3dRebuildRoomGeometryCache === 'function') {
        _viewer3dRebuildRoomGeometryCache(floorKey);
      }
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

function _svgViewRotation(floorKey = _activeFloorKey) {
  return _svgViewRotationByFloor.get(floorKey || '') || 0;
}

function _svgRotatedBounds(width, height, angle = _svgViewRotation()) {
  const radians = (Number(angle) || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x:0, y:0 },
    { x:width * cos, y:width * sin },
    { x:-height * sin, y:height * cos },
    { x:(width * cos) - (height * sin), y:(width * sin) + (height * cos) },
  ];
  const xs = corners.map(point => point.x);
  const ys = corners.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width:Math.max(...xs) - minX,
    height:Math.max(...ys) - minY,
  };
}

function _setSvgZoom(nextZoom, viewport, svgNode = _activeInlineSvg) {
  if (!svgNode || !viewport) return;
  const zoom = Math.max(_SVG_MIN_ZOOM, Math.min(8, nextZoom));
  if (!_svgBaseWidth || !_svgBaseHeight) {
    const size = _svgNaturalSize(svgNode, viewport);
    _svgBaseWidth = size.w;
    _svgBaseHeight = size.h;
  }
  _svgZoom = zoom;
  svgNode.style.width = Math.max(100, Math.round(_svgBaseWidth)) + 'px';
  svgNode.style.height = Math.max(60, Math.round(_svgBaseHeight)) + 'px';
  svgNode.style.transformOrigin = '0 0';
  const angle = _svgViewRotation();
  const rotated = _svgRotatedBounds(_svgBaseWidth, _svgBaseHeight, angle);
  const translateX = _svgPanX - (rotated.minX * _svgZoom);
  const translateY = _svgPanY - (rotated.minY * _svgZoom);
  svgNode.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${angle}deg) scale(${_svgZoom})`;
}

function _centerSvgViewport(viewport) {
  if (!viewport || !_activeInlineSvg) return;
  const rotated = _svgRotatedBounds(_svgBaseWidth, _svgBaseHeight);
  const scaledW = rotated.width * _svgZoom;
  const scaledH = rotated.height * _svgZoom;
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
  const rotated = _svgRotatedBounds(_svgBaseWidth, _svgBaseHeight);
  const fitZoom = Math.min(availW / rotated.width, availH / rotated.height);
  _svgZoom = Math.max(_SVG_MIN_ZOOM, Math.min(8, fitZoom || 1));

  const scaledW = rotated.width * _svgZoom;
  const scaledH = rotated.height * _svgZoom;
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
  const nextZoom = Math.max(_SVG_MIN_ZOOM, Math.min(8, oldZoom * factor));
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
    const alignLabel = _floorAlignmentHasStoredValue(entry) ? 'Modify' : 'Align';
    const stateHtml = hasSvg
      ? `<span class="svg-floor-head-actions">
          <span class="svg-floor-icon-btn" data-svg-rotate="${esc(entry.key)}" title="Rotate plan view 90 degrees" role="button" aria-label="Rotate ${esc(_floorLabel(entry))} plan view 90 degrees"><i class="bi bi-arrow-clockwise"></i></span>
          <span class="svg-floor-pill-btn" data-svg-upload="${esc(entry.key)}" title="Swap SVG">Swap</span>
          <span class="svg-floor-pill-btn" data-svg-align="${esc(entry.key)}" title="${esc(alignLabel)} Floor Plan">${esc(alignLabel)}</span>
        </span>`
      : `<span class="svg-floor-state">Missing</span>`;
    return `<section class="svg-floor-card${expanded ? ' expanded' : ''}${index === 0 ? ' svg-floor-card-first' : ''}" data-floor-key="${esc(entry.key)}">
      <button class="svg-floor-head" type="button" data-floor-toggle="${esc(entry.key)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <i class="bi bi-chevron-right svg-floor-chev"></i>
        <span class="svg-floor-name">${esc(_floorLabel(entry))}</span>
        ${stateHtml}
      </button>
      <div class="svg-floor-body">
        <div class="svg-floor-inner" data-floor-body="${esc(entry.key)}"></div>
      </div>
    </section>`;
  }).join('');
  els.stage.innerHTML = `<div class="svg-floor-stack">${html}</div>`;
}

function _renderExpandedFloorContent(els, floorEntry, svgRaw, options = null) {
  if (!els?.stage || !floorEntry) return;
  const preserveView = !!options?.preserveView;
  const previousView = preserveView ? { zoom: _svgZoom, panX: _svgPanX, panY: _svgPanY } : null;

  els.stage.querySelectorAll('.svg-floor-card').forEach(card => {
    const key = card.getAttribute('data-floor-key') || '';
    const expanded = key === floorEntry.key;
    card.classList.toggle('expanded', expanded);
    const toggle = card.querySelector('[data-floor-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });

  const body = [...els.stage.querySelectorAll('[data-floor-body]')]
    .find(node => (node.getAttribute('data-floor-body') || '') === floorEntry.key);
  if (!body) return;

  _activeInlineSvg = null;
  _activeViewport = null;
  _svgBaseWidth = 0;
  _svgBaseHeight = 0;
  if (!preserveView) {
    _svgZoom = 1;
    _svgPanX = 0;
    _svgPanY = 0;
  }
  _floorAlignmentLoad(floorEntry);

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
  body.innerHTML = `<div class="svg-floor-viewport" data-inline-svg="${inline ? '1' : '0'}">
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
      _activeFloorKey = floorEntry.key;
      if (preserveView && previousView) {
        _svgZoom = previousView.zoom;
        _svgPanX = previousView.panX;
        _svgPanY = previousView.panY;
        _setSvgZoom(_svgZoom, viewport, cleanSvg);
      } else {
        _setSvgZoom(1, viewport, cleanSvg);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (_activeViewport === viewport && _activeInlineSvg === cleanSvg) {
              _fitSvgToViewport(viewport, cleanSvg);
            }
          });
        });
      }
      _applySvgRoomTooltips(cleanSvg, floorEntry);
      _highlightSvgRooms(cleanSvg);
      _applyFilteredDots(cleanSvg, floorEntry);
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

function _alignmentRoomBoxes(floorEntry, existingCoordIndex = null) {
  const coordIndex = existingCoordIndex || (typeof _viewer3dCoordIndex === 'function' ? _viewer3dCoordIndex() : null);
  if (!coordIndex || !floorEntry) return [];

  return db.spaces
    .filter(space => {
      if ((space._facility || '') !== (floorEntry.facility || '')) return false;
      return _cobieField(space, 'floorName').toLowerCase() === floorEntry.name.toLowerCase();
    })
    .map(space => {
      const coord = typeof _viewer3dCoordFor === 'function'
        ? _viewer3dCoordFor(coordIndex, 'space', space._facility, f(space, 'Name'))
        : null;
      const bounds = typeof _viewer3dBounds === 'function' ? _viewer3dBounds(coord, 2400) : null;
      if (!bounds?.hasCorners) return null;
      return {
        name: f(space, 'Name'),
        x: bounds.minX,
        y: bounds.minZ,
        w: bounds.sizeX,
        h: bounds.sizeZ,
      };
    })
    .filter(Boolean);
}

function _alignmentRoomLayout(floorEntry, width, height) {
  const boxes = _alignmentRoomBoxes(floorEntry);
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map(box => box.x));
  const minY = Math.min(...boxes.map(box => box.y));
  const maxX = Math.max(...boxes.map(box => box.x + box.w));
  const maxY = Math.max(...boxes.map(box => box.y + box.h));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const pad = 24;
  const scale = Math.max(0.000001, Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY));
  const drawWidth = spanX * scale;
  const drawHeight = spanY * scale;
  return {
    boxes, minX, minY, maxX, maxY, spanX, spanY, scale,
    left:(width - drawWidth) / 2,
    top:(height - drawHeight) / 2,
    width:drawWidth,
    height:drawHeight,
  };
}

function _drawAlignmentRooms(canvas, floorEntry) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(10, Math.round(canvas.clientWidth));
  const height = Math.max(10, Math.round(canvas.clientHeight));
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  const layout = _alignmentRoomLayout(floorEntry, width, height);
  if (!layout) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '14px sans-serif';
    ctx.fillText('No room coordinate boxes found for this floor.', 18, 28);
    return;
  }

  const { boxes, minX, maxY, spanX, spanY, scale, left, top } = layout;

  ctx.strokeStyle = 'rgba(50,50,50,.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 10; x++) {
    const gx = left + (spanX * x / 10) * scale;
    ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, top + layout.height); ctx.stroke();
  }
  for (let y = 0; y <= 10; y++) {
    const gy = top + (spanY * y / 10) * scale;
    ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(left + layout.width, gy); ctx.stroke();
  }

  boxes.forEach((box, index) => {
    const x = left + (box.x - minX) * scale;
    // Match the default 3D viewer orientation: screen Y maps to inverted world Z.
    const y = top + (maxY - (box.y + box.h)) * scale;
    const w = box.w * scale;
    const h = box.h * scale;
    ctx.fillStyle = 'rgba(14,165,233,.12)';
    ctx.strokeStyle = index === 0 ? 'rgba(14,165,233,.9)' : 'rgba(50,50,50,.7)';
    ctx.lineWidth = index === 0 ? 2 : 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });
}

function _alignmentModalElements() {
  return {
    modal: document.getElementById('floor-align-modal'),
    title: document.getElementById('floor-align-title'),
    subtitle: document.getElementById('floor-align-subtitle'),
    stage: document.getElementById('floor-align-stage'),
    world: document.getElementById('floor-align-world'),
    roomCanvas: document.getElementById('floor-align-room-canvas'),
    svgLayer: document.getElementById('floor-align-svg-layer'),
    status: document.getElementById('floor-align-status'),
    label: document.getElementById('align-floor-plans-btn'),
    fillOpacity: document.getElementById('floor-align-fill-opacity'),
    fillOpacityValue: document.getElementById('floor-align-fill-opacity-value'),
  };
}

function _alignmentApplyViewTransform() {
  const els = _alignmentModalElements();
  if (!els.world) return;
  els.world.style.transformOrigin = '0 0';
  els.world.style.transform = `translate(${Math.round(_floorAlignView.panX)}px, ${Math.round(_floorAlignView.panY)}px) scale(${_floorAlignView.zoom})`;
}

function _alignmentDefaultTransform(floorEntry, svgNode) {
  const els = _alignmentModalElements();
  const rect = els.stage?.getBoundingClientRect();
  const stageWidth = Math.max(1, Math.round(rect?.width || els.stage?.clientWidth || 1));
  const stageHeight = Math.max(1, Math.round(rect?.height || els.stage?.clientHeight || 1));
  const size = svgNode ? _svgNaturalSize(svgNode, { clientWidth: stageWidth, clientHeight: stageHeight }) : { w: 900, h: 700 };
  const layout = _alignmentRoomLayout(floorEntry, stageWidth, stageHeight);
  const target = layout || { left:stageWidth * 0.15, top:stageHeight * 0.15, width:stageWidth * 0.7, height:stageHeight * 0.7 };
  const scale = Math.min(target.width / Math.max(1, size.w), target.height / Math.max(1, size.h));
  return {
    xPct:(target.left + target.width / 2) / stageWidth,
    yPct:(target.top + target.height / 2) / stageHeight,
    scale:Math.max(0.0001, Math.min(6, scale || 1)),
    rotation:0,
    flipHorizontal:false,
    flipVertical:false,
    originXPct:0.5,
    originYPct:0.5,
  };
}

function _alignmentDefaultForEntry(floorEntry, svgRaw = '') {
  const inline = _extractInlineSvgMarkup(svgRaw || _collectFloorSvgByKey()[floorEntry?.key] || '');
  const svgNode = inline ? _sanitizeInlineSvg(inline) : null;
  return _alignmentDefaultTransform(floorEntry, svgNode);
}

function _alignmentApplyFillOpacity(svgRoot) {
  if (!svgRoot) return;
  const opacity = Math.max(0, Math.min(1, Number(_floorAlignFillOpacity) || 0));
  svgRoot.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,text,use').forEach(node => {
    node.style.setProperty('fill-opacity', String(opacity), 'important');
    node.style.setProperty('stroke-opacity', '1', 'important');
  });
}

function _alignmentFloorToSvgAffine(floorEntry, svgRoot, alignment, stageWidth, stageHeight) {
  if (!floorEntry || !svgRoot || !alignment || stageWidth <= 0 || stageHeight <= 0) return null;
  const roomCanvas = _alignmentModalElements().roomCanvas;
  const svgLayer = _alignmentModalElements().svgLayer;
  const layoutWidth = roomCanvas?.clientWidth || stageWidth;
  const layoutHeight = roomCanvas?.clientHeight || stageHeight;
  const layoutOffsetX = (stageWidth - layoutWidth) / 2;
  const layoutOffsetY = (stageHeight - layoutHeight) / 2;
  const layerOffsetX = (stageWidth - (svgLayer?.clientWidth || stageWidth)) / 2;
  const layerOffsetY = (stageHeight - (svgLayer?.clientHeight || stageHeight)) / 2;
  const layout = _alignmentRoomLayout(floorEntry, layoutWidth, layoutHeight);
  const drawing = _svgDrawingBounds(svgRoot);
  const size = _svgNaturalSize(svgRoot, { clientWidth:stageWidth, clientHeight:stageHeight });
  if (!layout || !drawing || !size?.w || !size?.h) return null;

  const scale = Math.max(0.0001, Number(alignment.scale) || 1);
  const theta = (Number(alignment.rotation) || 0) * Math.PI / 180;
  const sx = (alignment.flipHorizontal ? -1 : 1) * scale;
  const sy = (alignment.flipVertical ? -1 : 1) * scale;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const matrixA = cos * sx;
  const matrixB = sin * sx;
  const matrixC = -sin * sy;
  const matrixD = cos * sy;
  const determinant = (matrixA * matrixD) - (matrixB * matrixC);
  if (Math.abs(determinant) <= 1e-12) return null;

  const positionX = layerOffsetX + (stageWidth * _unitInterval(alignment.xPct));
  const positionY = layerOffsetY + (stageHeight * _unitInterval(alignment.yPct));
  const originX = size.w * _unitInterval(alignment.originXPct);
  const originY = size.h * _unitInterval(alignment.originYPct);
  const mapPoint = (u, v) => {
    const stageX = layoutOffsetX + layout.left + (u * layout.width);
    const stageY = layoutOffsetY + layout.top + (v * layout.height);
    const transformedX = stageX - positionX - originX + (size.w / 2);
    const transformedY = stageY - positionY - originY + (size.h / 2);
    const localX = originX + (((matrixD * transformedX) - (matrixC * transformedY)) / determinant);
    const localY = originY + (((-matrixB * transformedX) + (matrixA * transformedY)) / determinant);
    return {
      u:(localX - drawing.x) / drawing.width,
      v:(localY - drawing.y) / drawing.height,
    };
  };

  const topLeft = mapPoint(0, 0);
  const topRight = mapPoint(1, 0);
  const bottomLeft = mapPoint(0, 1);
  return {
    a:topRight.u - topLeft.u,
    b:bottomLeft.u - topLeft.u,
    c:topLeft.u,
    d:topRight.v - topLeft.v,
    e:bottomLeft.v - topLeft.v,
    f:topLeft.v,
  };
}

function _alignmentTransformForStage(transform) {
  const els = _alignmentModalElements();
  const rect = els.stage?.getBoundingClientRect();
  const stageWidth = Math.max(1, Math.round(rect?.width || els.stage?.clientWidth || 1));
  const stageHeight = Math.max(1, Math.round(rect?.height || els.stage?.clientHeight || 1));
  const scale = Math.max(0.0001, Number(transform?.scale) || 1);
  return {
    x: stageWidth * _unitInterval(transform?.xPct),
    y: stageHeight * _unitInterval(transform?.yPct),
    scale,
    rotation: Number(transform?.rotation) || 0,
    flipHorizontal: !!transform?.flipHorizontal,
    flipVertical: !!transform?.flipVertical,
    originXPct: _unitInterval(transform?.originXPct ?? transform?.originX),
    originYPct: _unitInterval(transform?.originYPct ?? transform?.originY),
  };
}

function _alignmentUpdateStatus(floorEntry) {
  const els = _alignmentModalElements();
  els.status.textContent = _floorAlignmentHasStoredValue(floorEntry)
    ? 'Stored on Floor attribute: svg-alignment'
    : 'No floor alignment stored yet.';
  _floorAlignmentButtonLabel(floorEntry);
}

function _alignmentApplyShellTransform(shell, transform) {
  if (!shell || !transform) return;
  shell.style.left = `${transform.x}px`;
  shell.style.top = `${transform.y}px`;
  const scaleX = (transform.flipHorizontal ? -1 : 1) * transform.scale;
  const scaleY = (transform.flipVertical ? -1 : 1) * transform.scale;
  shell.style.transform = `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${scaleX}, ${scaleY})`;
  shell.style.transformOrigin = `${transform.originXPct * 100}% ${transform.originYPct * 100}%`;
  const originHandle = shell.querySelector('#floor-align-origin-handle');
  if (originHandle) {
    originHandle.style.left = `${transform.originXPct * 100}%`;
    originHandle.style.top = `${transform.originYPct * 100}%`;
  }
}

function _alignmentRenderSvg(floorEntry, svgRaw, transform) {
  const els = _alignmentModalElements();
  if (!els.roomCanvas || !els.svgLayer) return;
  _drawAlignmentRooms(els.roomCanvas, floorEntry);

  els.svgLayer.innerHTML = '';
  const inline = _extractInlineSvgMarkup(svgRaw);
  if (!inline) return;

  const cleanSvg = _sanitizeInlineSvg(inline);
  if (!cleanSvg) return;

  const shell = document.createElement('div');
  shell.id = 'floor-align-shell';
  shell.className = 'position-absolute';
  shell.style.cursor = 'grab';
  shell.style.userSelect = 'none';
  shell.style.touchAction = 'none';

  const shellWidth = cleanSvg.viewBox?.baseVal?.width || cleanSvg.getBBox?.().width || cleanSvg.getBoundingClientRect().width || 900;
  const shellHeight = cleanSvg.viewBox?.baseVal?.height || cleanSvg.getBBox?.().height || cleanSvg.getBoundingClientRect().height || 700;

  const svgShell = document.createElement('div');
  svgShell.className = 'position-relative';
  svgShell.style.width = `${Math.max(1, shellWidth)}px`;
  svgShell.style.height = `${Math.max(1, shellHeight)}px`;
  svgShell.style.zIndex = '1';
  svgShell.style.pointerEvents = 'auto';

  const dragSurface = document.createElement('div');
  dragSurface.id = 'floor-align-drag-surface';
  dragSurface.className = 'position-absolute top-0 start-0 w-100 h-100';
  dragSurface.style.cursor = 'grab';
  dragSurface.style.background = 'transparent';
  dragSurface.style.zIndex = '1';

  cleanSvg.style.width = '100%';
  cleanSvg.style.height = '100%';
  cleanSvg.style.pointerEvents = 'none';
  cleanSvg.style.display = 'block';
  _alignmentApplyFillOpacity(cleanSvg);

  const makeResizeHandle = (corner, xCss, yCss, cursor) => {
    const handle = document.createElement('div');
    handle.className = 'position-absolute rounded border border-2 border-primary bg-white shadow';
    handle.dataset.floorAlignResizeCorner = corner;
    handle.style.width = '14px';
    handle.style.height = '14px';
    handle.style.left = xCss;
    handle.style.top = yCss;
    handle.style.transform = 'translate(-50%, -50%)';
    handle.style.cursor = cursor;
    handle.style.touchAction = 'none';
    handle.style.zIndex = '4';
    handle.style.boxShadow = '0 0 0 2px rgba(255,255,255,.8), 0 .15rem .45rem rgba(0,0,0,.25)';
    return handle;
  };

  const originHandle = document.createElement('div');
  originHandle.id = 'floor-align-origin-handle';
  originHandle.className = 'position-absolute rounded-circle shadow';
  originHandle.style.width = '20px';
  originHandle.style.height = '20px';
  originHandle.style.left = `${Math.max(0, Math.min(100, transform.originXPct * 100))}%`;
  originHandle.style.top = `${Math.max(0, Math.min(100, transform.originYPct * 100))}%`;
  originHandle.style.transform = 'translate(-50%, -50%)';
  originHandle.style.cursor = 'move';
  originHandle.style.touchAction = 'none';
  originHandle.style.zIndex = '5';
  originHandle.style.background = 'var(--accent, #0ea5e9)';
  originHandle.style.border = '3px solid #fff';
  originHandle.style.boxShadow = '0 0 0 2px var(--accent, #0ea5e9), 0 .2rem .6rem rgba(0,0,0,.35)';

  svgShell.appendChild(cleanSvg);
  svgShell.appendChild(dragSurface);
  svgShell.appendChild(makeResizeHandle('nw', '0%', '0%', 'nwse-resize'));
  svgShell.appendChild(makeResizeHandle('ne', '100%', '0%', 'nesw-resize'));
  svgShell.appendChild(makeResizeHandle('sw', '0%', '100%', 'nesw-resize'));
  svgShell.appendChild(makeResizeHandle('se', '100%', '100%', 'nwse-resize'));
  svgShell.appendChild(originHandle);
  shell.appendChild(svgShell);
  els.svgLayer.appendChild(shell);
  _alignmentApplyShellTransform(shell, transform);
  const previewAlignment = { ...(_floorPlanAlignmentDraft || _floorPlanAlignment) };
  previewAlignment.floorToSvg = _alignmentFloorToSvgAffine(
    floorEntry,
    cleanSvg,
    previewAlignment,
    els.stage.clientWidth,
    els.stage.clientHeight
  );
  _applyFilteredDots(cleanSvg, floorEntry, previewAlignment);
}

function _alignmentBindInteractions() {
  const els = _alignmentModalElements();
  const stage = els.stage;
  if (!stage || stage.dataset.bound === '1') return;
  stage.dataset.bound = '1';

  const state = { mode:'', startX:0, startY:0, startTransform:null, startAngle:0, startDistance:0, stageSize:null, startView:null, startOrigin:null, shellRect:null, shellLocalW:0, shellLocalH:0, startOriginLocal:null };

  const render = () => {
    const currentEntry = _alignmentModalFloorEntry();
    if (!currentEntry) return;
    const currentSvg = _collectFloorSvgByKey()[currentEntry.key] || '';
    _alignmentRenderSvg(currentEntry, currentSvg, _alignmentTransformForStage(_floorPlanAlignmentDraft || _floorPlanAlignment));
    _alignmentApplyViewTransform();
  };

  stage.addEventListener('contextmenu', event => event.preventDefault());
  stage.addEventListener('wheel', event => {
    if (!(_alignmentModalFloorEntry())) return;
    const overControl = event.target.closest('button, [data-floor-align-flip], [data-floor-align-reset], [data-floor-align-save]');
    if (overControl) return;
    const rect = stage.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const oldZoom = _floorAlignView.zoom;
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = Math.max(0.25, Math.min(6, oldZoom * factor));
    if (newZoom === oldZoom) return;
    const worldX = (mouseX - _floorAlignView.panX) / oldZoom;
    const worldY = (mouseY - _floorAlignView.panY) / oldZoom;
    _floorAlignView.zoom = newZoom;
    _floorAlignView.panX = mouseX - (worldX * newZoom);
    _floorAlignView.panY = mouseY - (worldY * newZoom);
    _alignmentApplyViewTransform();
    event.preventDefault();
  }, { passive: false });
  stage.addEventListener('mousedown', event => {
    const currentEntry = _alignmentModalFloorEntry();
    if (!currentEntry) return;
    const shell = event.target.closest('#floor-align-shell');
    const dragSurface = event.target.closest('#floor-align-drag-surface');
    const resize = event.target.closest('[data-floor-align-resize-corner]');
    const originHandle = event.target.closest('#floor-align-origin-handle');
    if (event.button !== 0 && event.button !== 2) return;

    if (!shell && event.button === 0) {
      state.mode = 'panView';
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startView = { ..._floorAlignView };

      const onPanMove = moveEvent => {
        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        _floorAlignView.panX = state.startView.panX + dx;
        _floorAlignView.panY = state.startView.panY + dy;
        _alignmentApplyViewTransform();
        moveEvent.preventDefault();
      };

      const onPanUp = () => {
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanUp);
        state.mode = '';
      };

      window.addEventListener('mousemove', onPanMove);
      window.addEventListener('mouseup', onPanUp);
      event.preventDefault();
      return;
    }

    if (!shell) return;
    if (event.button === 0 && !dragSurface && !resize && !originHandle) return;

    const rect = stage.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const svgShell = shell.firstElementChild;
    const initial = { ...(_floorPlanAlignmentDraft || _floorPlanAlignment || _alignmentDefaultForEntry(currentEntry)) };
    const originXPct = _unitInterval(initial.originXPct);
    const originYPct = _unitInterval(initial.originYPct);
    const originX = shellRect.left - rect.left + (shellRect.width * originXPct);
    const originY = shellRect.top - rect.top + (shellRect.height * originYPct);

    state.mode = originHandle ? 'moveOrigin' : (resize ? 'resize' : (event.button === 2 ? 'rotate' : 'move'));
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startTransform = initial;
    state.stageSize = { width: rect.width, height: rect.height };
    state.startOrigin = { x: originX, y: originY };
    state.shellRect = shellRect;
    state.shellLocalW = Math.max(1, Number(svgShell?.offsetWidth || shellRect.width) || shellRect.width);
    state.shellLocalH = Math.max(1, Number(svgShell?.offsetHeight || shellRect.height) || shellRect.height);
    state.startOriginLocal = {
      x: originXPct * state.shellLocalW,
      y: originYPct * state.shellLocalH,
    };
    state.startAngle = Math.atan2(event.clientY - (rect.top + originY), event.clientX - (rect.left + originX));
    state.startDistance = Math.max(1, Math.hypot(event.clientX - (rect.left + originX), event.clientY - (rect.top + originY)));

    const onMove = moveEvent => {
      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;
      const viewZoom = Math.max(0.0001, Number(_floorAlignView?.zoom) || 1);
      const dxWorld = dx / viewZoom;
      const dyWorld = dy / viewZoom;
      const draft = { ...state.startTransform };

      if (state.mode === 'move') {
        draft.xPct = state.startTransform.xPct + (dxWorld / Math.max(1, state.stageSize.width));
        draft.yPct = state.startTransform.yPct + (dyWorld / Math.max(1, state.stageSize.height));
      } else if (state.mode === 'rotate') {
        const currentAngle = Math.atan2(moveEvent.clientY - (rect.top + state.startOrigin.y), moveEvent.clientX - (rect.left + state.startOrigin.x));
        draft.rotation = state.startTransform.rotation + ((currentAngle - state.startAngle) * 180 / Math.PI);
      } else if (state.mode === 'resize') {
        const currentDistance = Math.max(1, Math.hypot(moveEvent.clientX - (rect.left + state.startOrigin.x), moveEvent.clientY - (rect.top + state.startOrigin.y)));
        const ratio = currentDistance / state.startDistance;
        const startScale = Number(state.startTransform.scale) || 1;
        draft.scale = Math.max(0.0001, Math.min(6, startScale * ratio));
      } else if (state.mode === 'moveOrigin') {
        const theta = (Number(state.startTransform.rotation) || 0) * Math.PI / 180;
        const uniformScale = Number(state.startTransform.scale) || 1;
        const sx = (state.startTransform.flipHorizontal ? -1 : 1) * uniformScale;
        const sy = (state.startTransform.flipVertical ? -1 : 1) * uniformScale;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        const dxScreen = dxWorld;
        const dyScreen = dyWorld;

        // Convert pointer delta from screen space back into local SVG space.
        const rotInvX = (cos * dxScreen) + (sin * dyScreen);
        const rotInvY = (-sin * dxScreen) + (cos * dyScreen);
        const dLocalX = rotInvX / (Math.abs(sx) > 0.000001 ? sx : 1);
        const dLocalY = rotInvY / (Math.abs(sy) > 0.000001 ? sy : 1);

        const localX = Math.max(0, Math.min(state.shellLocalW, state.startOriginLocal.x + dLocalX));
        const localY = Math.max(0, Math.min(state.shellLocalH, state.startOriginLocal.y + dLocalY));
        draft.originXPct = localX / Math.max(1, state.shellLocalW);
        draft.originYPct = localY / Math.max(1, state.shellLocalH);

        const originDeltaX = localX - state.startOriginLocal.x;
        const originDeltaY = localY - state.startOriginLocal.y;
        const mDx = (cos * sx * originDeltaX) + (-sin * sy * originDeltaY);
        const mDy = (sin * sx * originDeltaX) + ( cos * sy * originDeltaY);
        const worldDx = mDx - originDeltaX;
        const worldDy = mDy - originDeltaY;
        draft.xPct = state.startTransform.xPct + (worldDx / Math.max(1, state.stageSize.width));
        draft.yPct = state.startTransform.yPct + (worldDy / Math.max(1, state.stageSize.height));
      }

      _floorPlanAlignmentDraft = draft;
      const liveShell = document.getElementById('floor-align-shell');
      _alignmentApplyShellTransform(liveShell, _alignmentTransformForStage(draft));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      state.mode = '';
      const shellNow = document.getElementById('floor-align-shell');
      if (shellNow) shellNow.style.cursor = 'grab';
    };

    if (state.mode === 'move') {
      const shellNow = document.getElementById('floor-align-shell');
      if (shellNow) shellNow.style.cursor = 'grabbing';
    } else if (state.mode === 'moveOrigin') {
      const originNow = document.getElementById('floor-align-origin-handle');
      if (originNow) originNow.style.cursor = 'grabbing';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    event.preventDefault();
  });
}

function _alignmentModalFloorEntry() {
  const allFloors = _allFloorEntries();
  const expanded = _floorByKey(_expandedFloorKey);
  if (expanded) {
    return {
      key: _rowKey(expanded, f(expanded, 'Name')),
      name: f(expanded, 'Name'),
      facility: expanded._facility || '',
      fileName: expanded._fileName || '',
    };
  }
  return allFloors[0] || null;
}

function _renderAlignmentModal() {
  const els = _alignmentModalElements();
  const floorEntry = _alignmentModalFloorEntry();
  if (!els.modal || !els.stage || !floorEntry) return;
  const svgByKey = _collectFloorSvgByKey();
  const svgRaw = svgByKey[floorEntry.key] || '';
  const hasStored = _floorAlignmentHasStoredValue(floorEntry);
  const savedAlignment = hasStored ? _floorAlignmentFromRaw(_floorAlignmentValueForEntry(floorEntry)) : _alignmentDefaultForEntry(floorEntry, svgRaw);
  if (_floorPlanAlignmentModalKey !== floorEntry.key || !_floorPlanAlignmentDraft) {
    _floorPlanAlignmentDraft = { ...savedAlignment };
  }
  _floorPlanAlignmentModalKey = floorEntry.key;

  els.title.textContent = (hasStored ? 'Modify Floor Plan Alignment' : 'Align Floor Plans') + ' - ' + floorEntry.name;
  els.subtitle.textContent = _floorLabel(floorEntry);
  els.stage.innerHTML = `<div class="position-absolute top-0 start-0 w-100 h-100 rounded border bg-white overflow-hidden">
    <div id="floor-align-world" class="position-absolute top-0 start-0 w-100 h-100">
      <canvas id="floor-align-room-canvas" class="position-absolute top-0 start-0 w-100 h-100"></canvas>
      <div id="floor-align-svg-layer" class="position-absolute top-0 start-0 w-100 h-100"></div>
    </div>
  </div>`;

  _alignmentUpdateStatus(floorEntry);
  _floorAlignmentButtonLabel(floorEntry);
  if (els.fillOpacity) els.fillOpacity.value = String(Math.round(_floorAlignFillOpacity * 100));
  if (els.fillOpacityValue) els.fillOpacityValue.textContent = `${Math.round(_floorAlignFillOpacity * 100)}%`;
  _alignmentRenderSvg(floorEntry, svgRaw, _alignmentTransformForStage(_floorPlanAlignmentDraft));
  _alignmentApplyViewTransform();
  _alignmentBindInteractions();
}

function openFloorPlanAlignmentModal() {
  const floorEntry = _alignmentModalFloorEntry();
  if (!floorEntry) {
    alert('No floor plan is available to align yet.');
    return;
  }
  _floorAlignView = { zoom: 1, panX: 0, panY: 0 };
  _floorAlignFillOpacity = 0.35;
  _floorPlanAlignmentDraft = null;
  _floorPlanAlignmentModalKey = '';
  new bootstrap.Modal(document.getElementById('floor-align-modal')).show();
}

function _saveFloorPlanAlignment() {
  const floorEntry = _alignmentModalFloorEntry();
  if (!floorEntry) return;
  const draft = { ...(_floorPlanAlignmentDraft || _floorPlanAlignment || _alignmentDefaultForEntry(floorEntry)) };
  const flipH = !!draft.flipHorizontal;
  const flipV = !!draft.flipVertical;

  if (flipH || flipV) {
    const floorRow = _floorByKey(floorEntry.key);
    const rawSvg = _collectFloorSvgByKey()[floorEntry.key] || '';
    const inline = _extractInlineSvgMarkup(rawSvg);
    if (floorRow && inline) {
      const baked = _bakeFlipIntoSvgMarkup(inline, flipH, flipV);
      if (baked && baked !== inline && _upsertFloorSvgAttribute(floorRow, baked)) {
        _logChange('floor', f(floorRow, 'Name'), floorRow._facility || '');
      }
    }
    draft.flipHorizontal = false;
    draft.flipVertical = false;
  }

  const els = _alignmentModalElements();
  const svgRoot = document.querySelector('#floor-align-shell svg');
  draft.floorToSvg = _alignmentFloorToSvgAffine(
    floorEntry,
    svgRoot,
    draft,
    els.stage?.clientWidth || 0,
    els.stage?.clientHeight || 0
  );

  _floorPlanAlignmentDraft = draft;
  _floorAlignmentSave(floorEntry, draft);
  refreshFloorSvgPanel([], _lastFloorCounts || {});
  refreshDisplay();
  bootstrap.Modal.getInstance(document.getElementById('floor-align-modal'))?.hide();
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

    const uploadBtn = event.target.closest('[data-svg-upload]');
    if (uploadBtn) {
      const key = uploadBtn.getAttribute('data-svg-upload') || '';
      _openSvgFilePicker(els, key);
      return;
    }

    const alignBtn = event.target.closest('[data-svg-align]');
    if (alignBtn) {
      const key = alignBtn.getAttribute('data-svg-align') || '';
      if (key && key !== _expandedFloorKey) _expandedFloorKey = key;
      openFloorPlanAlignmentModal();
      return;
    }

    const rotateBtn = event.target.closest('[data-svg-rotate]');
    if (rotateBtn) {
      const key = rotateBtn.getAttribute('data-svg-rotate') || '';
      if (key && key !== _expandedFloorKey) {
        _expandedFloorKey = key;
        refreshFloorSvgPanel(_lastFilteredComps || [], _lastFloorCounts || {});
      }
      if (key && _activeInlineSvg && _activeFloorKey === key) {
        _svgViewRotationByFloor.set(key, (_svgViewRotation(key) + 90) % 360);
        _fitSvgToViewport(_activeViewport, _activeInlineSvg);
      }
      return;
    }

    const toggle = event.target.closest('[data-floor-toggle]');
    if (toggle) {
      const key = toggle.getAttribute('data-floor-toggle') || '';
      if (key && key !== _expandedFloorKey) {
        _expandedFloorKey = key;
        refreshFloorSvgPanel(_lastFilteredComps || [], _lastFloorCounts || {});
      }
      return;
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

  const alignModal = document.getElementById('floor-align-modal');
  if (alignModal && alignModal.dataset.bound !== '1') {
    alignModal.dataset.bound = '1';
    alignModal.addEventListener('shown.bs.modal', () => {
      _renderAlignmentModal();
    });
    alignModal.addEventListener('hidden.bs.modal', () => {
      _floorPlanAlignmentDraft = null;
      _floorPlanAlignmentModalKey = '';
      _floorAlignView = { zoom: 1, panX: 0, panY: 0 };
    });
    alignModal.addEventListener('click', event => {
      const flipBtn = event.target.closest('[data-floor-align-flip]');
      if (flipBtn) {
        const current = { ...(_floorPlanAlignmentDraft || _floorPlanAlignment || _alignmentDefaultForEntry(_alignmentModalFloorEntry())) };
        const axis = flipBtn.getAttribute('data-floor-align-flip');
        if (axis === 'horizontal') current.flipHorizontal = !current.flipHorizontal;
        if (axis === 'vertical') current.flipVertical = !current.flipVertical;
        _floorPlanAlignmentDraft = current;
        _renderAlignmentModal();
        return;
      }

      const resetBtn = event.target.closest('[data-floor-align-reset]');
      if (resetBtn) {
        const floorEntry = _alignmentModalFloorEntry();
        _floorPlanAlignmentDraft = _alignmentDefaultForEntry(floorEntry);
        _floorAlignView = { zoom: 1, panX: 0, panY: 0 };
        _renderAlignmentModal();
        return;
      }

      const saveBtn = event.target.closest('[data-floor-align-save]');
      if (saveBtn) {
        _saveFloorPlanAlignment();
        return;
      }
    });
    alignModal.addEventListener('input', event => {
      const slider = event.target.closest('[data-floor-align-fill-opacity]');
      if (!slider) return;
      _floorAlignFillOpacity = Math.max(0, Math.min(1, Number(slider.value) / 100));
      const value = document.getElementById('floor-align-fill-opacity-value');
      if (value) value.textContent = `${Math.round(_floorAlignFillOpacity * 100)}%`;
      _alignmentApplyFillOpacity(document.querySelector('#floor-align-shell svg'));
    });
    window.addEventListener('resize', () => {
      const modal = bootstrap.Modal.getInstance(alignModal);
      if (modal && alignModal.classList.contains('show')) _renderAlignmentModal();
    });
  }

  _applyFloorPanelCollapsedState(els);
}

function refreshFloorSvgPanel(filteredComps, counts) {
  const els = _floorPanelElements();
  if (!els.panel || !els.stage) return;

  if (viewMode === 'qa') {
    els.panel.classList.add('d-none');
    return;
  }

  _lastFloorCounts = counts || {};
  _lastFilteredComps = Array.isArray(filteredComps) ? filteredComps : [];
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
    _floorAlignmentButtonLabel(expandedFloor);
    _renderExpandedFloorContent(els, expandedFloor, svgByKey[expandedFloor.key] || '', {
      preserveView: _activeFloorKey === expandedFloor.key,
    });
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
  _svgViewRotationByFloor.clear();
  _expandedFloorKey = '';
  _pendingUploadFloorKey = '';
  _highlightRoomIds = new Set();
  _lastFloorCounts = null;
  _floorPlanAlignment = _defaultFloorAlignment();
  _floorPlanAlignmentDraft = null;
  _floorPlanAlignmentFloorKey = '';
  _floorPlanAlignmentModalKey = '';
  _floorAlignView = { zoom: 1, panX: 0, panY: 0 };
  _activeFloorKey = '';
  _svgTooltipHide();
}

initFloorSvgPanel();
