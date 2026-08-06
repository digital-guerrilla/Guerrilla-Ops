// -- 3D coordinate viewer -----------------------------------------------------
let _viewer3dCollapsed = false;
let _viewer3dWidth = 0;
let _viewer3dLastWidth = 0;
let _viewer3dRotX = -0.55;
let _viewer3dRotY = 0.7;
let _viewer3dPanX = 0;
let _viewer3dPanY = 0;
let _viewer3dZoom = 1;
let _viewer3dDragging = '';
let _viewer3dScene = null;
let _viewer3dSceneKey = '';
let _viewer3dHasAutoFit = false;
let _viewer3dHoverTargets = [];
let _viewer3dTooltipText = '';
let _viewer3dTooltipEl = null;

function _viewer3dClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _viewer3dTheme() {
  const css = getComputedStyle(document.documentElement);
  return {
    background: '#fff',
    wire: (css.getPropertyValue('--navy') || '#323232').trim(),
    brand: (css.getPropertyValue('--brand-accent') || css.getPropertyValue('--accent') || '#0ea5e9').trim(),
    grid: (css.getPropertyValue('--border-light') || '#9aa3af').trim(),
    element: (css.getPropertyValue('--danger') || '#ef4444').trim(),
    axisX: (css.getPropertyValue('--danger') || '#ef4444').trim(),
    axisY: (css.getPropertyValue('--cat-green') || '#22c55e').trim(),
    axisZ: (css.getPropertyValue('--accent') || '#0ea5e9').trim(),
  };
}

function _viewer3dElements() {
  return {
    panel: document.getElementById('viewer-3d-panel'),
    edgeToggle: document.getElementById('viewer3d-edge-toggle'),
    canvas: document.getElementById('viewer-3d-canvas'),
    empty: document.getElementById('viewer-3d-empty'),
  };
}

function _viewer3dDesiredWidth() {
  return Math.max(300, Math.round(window.innerWidth * 0.25));
}

function _viewer3dClampWidth(width) {
  const min = 280;
  const max = Math.max(min + 40, window.innerWidth - 320);
  return Math.max(min, Math.min(max, Math.round(width)));
}

function _viewer3dSetWidth(els, width) {
  if (!els?.panel) return;
  const finalWidth = _viewer3dClampWidth(width);
  _viewer3dWidth = finalWidth;
  els.panel.style.width = finalWidth + 'px';
  els.panel.style.flexBasis = finalWidth + 'px';
  _renderThreeDViewer();
}

function _viewer3dParseNumber(value, fallback = 0) {
  const num = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function _viewer3dCoordPoint(row) {
  if (!row) return null;
  const sourceX = _viewer3dParseNumber(f(row, 'CoordinateXAxis', 'Coordinate X Axis'));
  const sourceY = _viewer3dParseNumber(f(row, 'CoordinateYAxis', 'Coordinate Y Axis'));
  const sourceZ = _viewer3dParseNumber(f(row, 'CoordinateZAxis', 'Coordinate Z Axis'));
  return {
    x: sourceX,
    y: sourceZ,
    z: -sourceY,
  };
}

function _viewer3dCoordKeyParts(row) {
  const rowName = f(row, 'RowName', 'Row Name').trim();
  if (!rowName) return null;
  const match = rowName.match(/^(.*?)(?:_(upperright|lowerright|upperleft|lowerleft))$/i);
  return {
    baseName: (match ? match[1] : rowName).trim(),
    cornerName: (match ? match[2] : '').toLowerCase(),
  };
}

function _viewer3dCoordIndex() {
  const bySheet = Object.create(null);
  (db.coordinates || []).forEach(row => {
    const sheet = f(row, 'SheetName', 'Sheet Name').toLowerCase();
    const parts = _viewer3dCoordKeyParts(row);
    const facility = String(row._facility || '').toLowerCase();
    if (!sheet || !parts?.baseName) return;
    const key = facility + '::' + parts.baseName.toLowerCase();
    const bucket = (bySheet[sheet] = bySheet[sheet] || Object.create(null));
    const entry = (bucket[key] = bucket[key] || { base:null, upperRight:null, lowerLeft:null, corners:[] });
    entry.base ||= row;
    if (parts.cornerName === 'upperright') entry.upperRight = row;
    else if (parts.cornerName === 'lowerleft') entry.lowerLeft = row;
    else entry.corners.push(row);
  });
  return bySheet;
}

function _viewer3dCoordFor(index, sheetName, facility, rowName) {
  const sheet = index[String(sheetName || '').toLowerCase()];
  if (!sheet) return null;
  return sheet[_scopeKey(facility, rowName)] || null;
}

function _viewer3dSpaceRoomNumber(spaceRow) {
  if (!spaceRow) return '';
  return f(spaceRow,
    'RoomNumber', 'Room Number',
    'Number',
    'RoomTag', 'Room Tag',
    'TagNumber', 'Tag Number'
  );
}

function _viewer3dSpaceTooltip(spaceRow) {
  if (!spaceRow) return '';
  const roomName = f(spaceRow, 'Name');
  if (!roomName) return '';
  const roomNumber = _viewer3dSpaceRoomNumber(spaceRow);
  return roomNumber
    ? `Room: ${roomName}\nNumber: ${roomNumber}`
    : `Room: ${roomName}`;
}

function _viewer3dBounds(coordEntry, fallbackSize = 1000) {
  if (!coordEntry) return null;
  const points = [];
  const lowerLeft = _viewer3dCoordPoint(coordEntry.lowerLeft);
  const upperRight = _viewer3dCoordPoint(coordEntry.upperRight);
  const basePoint = _viewer3dCoordPoint(coordEntry.base);
  if (lowerLeft) points.push(lowerLeft);
  if (upperRight) points.push(upperRight);
  coordEntry.corners.forEach(row => {
    const point = _viewer3dCoordPoint(row);
    if (point) points.push(point);
  });
  if (!points.length && basePoint) points.push(basePoint);
  if (!points.length) return null;

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const zs = points.map(point => point.z);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  let minZ = Math.min(...zs), maxZ = Math.max(...zs);

  if (minX === maxX) { minX -= fallbackSize / 2; maxX += fallbackSize / 2; }
  if (minY === maxY) { minY -= fallbackSize / 2; maxY += fallbackSize / 2; }
  if (minZ === maxZ) { minZ -= fallbackSize / 2; maxZ += fallbackSize / 2; }

  return {
    minX, maxX, minY, maxY, minZ, maxZ,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
    sizeX: Math.max(1, maxX - minX),
    sizeY: Math.max(1, maxY - minY),
    sizeZ: Math.max(1, maxZ - minZ),
  };
}

function _viewer3dMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _viewer3dCullOutliers(entries) {
  if (entries.length < 5) return entries;
  const metrics = entries.map(entry => ({
    entry,
    maxDim: Math.max(entry.bounds.sizeX, entry.bounds.sizeY, entry.bounds.sizeZ),
    footprint: entry.bounds.sizeX * entry.bounds.sizeY,
    volume: entry.bounds.sizeX * entry.bounds.sizeY * entry.bounds.sizeZ,
  }));
  const medianMaxDim = _viewer3dMedian(metrics.map(item => item.maxDim));
  const medianFootprint = _viewer3dMedian(metrics.map(item => item.footprint));
  const medianVolume = _viewer3dMedian(metrics.map(item => item.volume));
  if (!medianMaxDim || !medianFootprint || !medianVolume) return entries;

  return metrics
    .filter(item =>
      item.maxDim <= medianMaxDim * 6 &&
      item.footprint <= medianFootprint * 20 &&
      item.volume <= medianVolume * 30
    )
    .map(item => item.entry);
}

function _viewer3dVisibleFloors(counts) {
  const ordered = [];
  const push = row => { if (row && !ordered.includes(row)) ordered.push(row); };
  const facAllowed = row => !sel.facility.size || sel.facility.has((row._facility || '').toLowerCase());

  if (sel.floor.size) {
    db.floors.forEach(row => {
      if (facAllowed(row) && sel.floor.has(f(row, 'Name').toLowerCase())) push(row);
    });
  }

  if (!ordered.length && sel.space.size) {
    db.spaces.forEach(space => {
      const spName = f(space, 'Name').toLowerCase();
      if (!sel.space.has(spName)) return;
      const floorName = f(space, 'FloorName', 'Floor Name', 'Floor').toLowerCase();
      const match = db.floors.find(row =>
        f(row, 'Name').toLowerCase() === floorName &&
        row._facility === space._facility
      );
      if (match && facAllowed(match)) push(match);
    });
  }

  if (!ordered.length && counts?.floor) {
    db.floors.forEach(row => {
      const name = f(row, 'Name').toLowerCase();
      if (facAllowed(row) && (counts.floor[name] || 0) > 0) push(row);
    });
  }

  if (!ordered.length) {
    db.floors.forEach(row => { if (facAllowed(row)) push(row); });
  }

  return ordered;
}

function _viewer3dVisibleSpaces(visibleFloors) {
  const floorKeys = new Set(visibleFloors.map(row => _rowKey(row, f(row, 'Name'))));
  return db.spaces.filter(space => {
    if (sel.facility.size && !sel.facility.has((space._facility || '').toLowerCase())) return false;
    const floorName = f(space, 'FloorName', 'Floor Name', 'Floor');
    const floorKey = _scopeKey(space._facility, floorName);
    if (!floorKeys.has(floorKey)) return false;
    return true;
  });
}

function _viewer3dSceneData(filteredComps, counts) {
  const coordIndex = _viewer3dCoordIndex();
  if (!Object.keys(coordIndex).length) return null;

  const highlightCtx = typeof getGroupHighlightContext === 'function'
    ? getGroupHighlightContext()
    : { spaces:new Set(), components:[], componentKeys:new Set() };
  const highlightedSpaces = highlightCtx.spaces || new Set();
  const highlightedComponentKeys = highlightCtx.componentKeys || new Set();
  const hasComponentHighlight = highlightedComponentKeys.size > 0;
  const hasAnyFilterSelection = !!(
    searchQuery ||
    sel.facility.size || sel.floor.size || sel.space.size ||
    sel.type.size || sel.system.size || sel.doccat.size
  );

  const visibleFloors = _viewer3dVisibleFloors(counts);
  if (!visibleFloors.length) return null;

  const spaces = _viewer3dVisibleSpaces(visibleFloors)
    .map(space => ({
      row: space,
      coord: _viewer3dCoordFor(coordIndex, 'space', space._facility, f(space, 'Name')),
    }))
    .map(entry => ({ ...entry, bounds:_viewer3dBounds(entry.coord, 2400) }))
    .filter(entry => entry.bounds);

  const showComponents = sel.type.size > 0 || sel.system.size > 0 || hasComponentHighlight;
  const componentRows = [];
  if (showComponents) {
    const seenCompKeys = new Set();
    const sourceRows = hasComponentHighlight
      ? (highlightCtx.components || [])
      : (filteredComps || []);
    sourceRows.forEach(comp => {
      const key = _scopeKey(comp._facility, f(comp, 'Name'));
      if (seenCompKeys.has(key)) return;
      seenCompKeys.add(key);
      componentRows.push(comp);
    });
  }

  const components = componentRows
    .map(comp => ({
      row: comp,
      key: _scopeKey(comp._facility, f(comp, 'Name')),
      coord: _viewer3dCoordFor(coordIndex, 'component', comp._facility, f(comp, 'Name')),
    }))
    .map(entry => ({ ...entry, bounds:_viewer3dBounds(entry.coord, 700) }))
    .filter(entry => entry.bounds);

  const culledSpaces = _viewer3dCullOutliers(spaces);
  const culledComponents = _viewer3dCullOutliers(components);

  const spacePointsByFloor = Object.create(null);
  culledSpaces.forEach(entry => {
    const floorName = f(entry.row, 'FloorName', 'Floor Name', 'Floor');
    const floorKey = _scopeKey(entry.row._facility, floorName);
    (spacePointsByFloor[floorKey] = spacePointsByFloor[floorKey] || []).push(entry.bounds);
  });

  const scenePoints = [];
  const focusPoints = [];
  const objects = [];

  const hasRoomFocus = sel.space.size > 0 || highlightedSpaces.size > 0;
  const focusSelectedSpaces = hasRoomFocus || sel.floor.size > 0;
  const focusSelectedComponents = showComponents && (sel.type.size > 0 || sel.system.size > 0);

  culledSpaces.forEach(entry => {
    const spaceName = f(entry.row, 'Name').toLowerCase();
    const isSelectedSpace = (sel.space.size > 0 && sel.space.has(spaceName)) || highlightedSpaces.has(spaceName);
    objects.push({
      type:'cube',
      x:entry.bounds.centerX,
      y:entry.bounds.centerY,
      z:entry.bounds.centerZ,
      sizeX:entry.bounds.sizeX,
      sizeY:entry.bounds.sizeY,
      sizeZ:entry.bounds.sizeZ,
      color:'wire',
      lineWidth:1.2,
      alphaMul: hasRoomFocus && !isSelectedSpace ? 0.42 : 1,
      fillColor: isSelectedSpace ? 'brand' : 'background',
      fillAlpha: isSelectedSpace ? 0.24 : 0.16,
      tooltip: _viewer3dSpaceTooltip(entry.row),
      spaceKey: spaceName,
    });
    const minPoint = { x:entry.bounds.minX, y:entry.bounds.minY, z:entry.bounds.minZ };
    const maxPoint = { x:entry.bounds.maxX, y:entry.bounds.maxY, z:entry.bounds.maxZ };
    scenePoints.push(minPoint);
    scenePoints.push(maxPoint);
    if (!focusSelectedSpaces || !hasRoomFocus || isSelectedSpace) {
      focusPoints.push(minPoint);
      focusPoints.push(maxPoint);
    }
  });

  culledComponents.forEach(entry => {
    const isHighlightedComponent = hasComponentHighlight && highlightedComponentKeys.has(entry.key);
    const componentAlphaMul = hasComponentHighlight
      ? (isHighlightedComponent ? 1 : 0.3)
      : (hasAnyFilterSelection ? 0.58 : 1);
    const componentFillAlpha = hasComponentHighlight
      ? (isHighlightedComponent ? 1 : 0.35)
      : 1;
    objects.push({
      type:'cube',
      x:entry.bounds.centerX,
      y:entry.bounds.centerY,
      z:entry.bounds.centerZ,
      sizeX:entry.bounds.sizeX,
      sizeY:entry.bounds.sizeY,
      sizeZ:entry.bounds.sizeZ,
      color:'element',
      lineWidth:1.4,
      alphaMul: componentAlphaMul,
      fillColor:'element',
      fillAlpha: componentFillAlpha,
    });
    const minPoint = { x:entry.bounds.minX, y:entry.bounds.minY, z:entry.bounds.minZ };
    const maxPoint = { x:entry.bounds.maxX, y:entry.bounds.maxY, z:entry.bounds.maxZ };
    scenePoints.push(minPoint);
    scenePoints.push(maxPoint);
    if (!focusSelectedComponents || isHighlightedComponent) {
      focusPoints.push(minPoint);
      focusPoints.push(maxPoint);
    }
  });

  if (!scenePoints.length) return null;

  return {
    objects,
    points:scenePoints,
    focusPoints:focusPoints.length ? focusPoints : scenePoints,
    showComponents,
  };
}

function _viewer3dRotate(point) {
  const cosY = Math.cos(_viewer3dRotY);
  const sinY = Math.sin(_viewer3dRotY);
  const cosX = Math.cos(_viewer3dRotX);
  const sinX = Math.sin(_viewer3dRotX);
  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;
  const y2 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX;
  return { x:x1, y:y2, z:z2 };
}

function _viewer3dProject(point, scale, perspective, width, height, fovScale = 1) {
  const rotated = _viewer3dRotate(point);
  const minDenominator = Math.max(1, perspective * 0.08);
  const rawDenominator = perspective + rotated.z + perspective * 0.15;
  const safeDenominator = Math.max(minDenominator, rawDenominator);
  const factor = _viewer3dClamp((perspective / safeDenominator) * fovScale, 0, 7.5);
  return {
    x: (width / 2) + _viewer3dPanX + (rotated.x * scale * factor),
    y: (height / 2) + _viewer3dPanY - (rotated.y * scale * factor),
    depth: rotated.z,
  };
}

function _viewer3dSceneSignature(scene) {
  if (!scene?.points?.length) return '';
  const xs = scene.points.map(point => point.x);
  const ys = scene.points.map(point => point.y);
  const zs = scene.points.map(point => point.z);
  return [
    scene.objects.length,
    Math.min(...xs).toFixed(3), Math.max(...xs).toFixed(3),
    Math.min(...ys).toFixed(3), Math.max(...ys).toFixed(3),
    Math.min(...zs).toFixed(3), Math.max(...zs).toFixed(3),
  ].join('|');
}

function _viewer3dCubeEdges(cx, cy, cz, sizeX, sizeY, sizeZ) {
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const halfZ = sizeZ / 2;
  const corners = [
    { x:cx-halfX, y:cy-halfY, z:cz-halfZ }, { x:cx+halfX, y:cy-halfY, z:cz-halfZ },
    { x:cx+halfX, y:cy+halfY, z:cz-halfZ }, { x:cx-halfX, y:cy+halfY, z:cz-halfZ },
    { x:cx-halfX, y:cy-halfY, z:cz+halfZ }, { x:cx+halfX, y:cy-halfY, z:cz+halfZ },
    { x:cx+halfX, y:cy+halfY, z:cz+halfZ }, { x:cx-halfX, y:cy+halfY, z:cz+halfZ },
  ];
  return [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].map(([a,b]) => [corners[a], corners[b]]);
}

function _viewer3dCubeFaces(cx, cy, cz, sizeX, sizeY, sizeZ) {
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const halfZ = sizeZ / 2;
  const corners = [
    { x:cx-halfX, y:cy-halfY, z:cz-halfZ }, { x:cx+halfX, y:cy-halfY, z:cz-halfZ },
    { x:cx+halfX, y:cy+halfY, z:cz-halfZ }, { x:cx-halfX, y:cy+halfY, z:cz-halfZ },
    { x:cx-halfX, y:cy-halfY, z:cz+halfZ }, { x:cx+halfX, y:cy-halfY, z:cz+halfZ },
    { x:cx+halfX, y:cy+halfY, z:cz+halfZ }, { x:cx-halfX, y:cy+halfY, z:cz+halfZ },
  ];
  return [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ].map(face => face.map(index => corners[index]));
}

function _viewer3dPlaneEdges(cx, cy, cz, sizeX, sizeY) {
  const hx = sizeX / 2;
  const hy = sizeY / 2;
  const corners = [
    { x:cx-hx, y:cy-hy, z:cz }, { x:cx+hx, y:cy-hy, z:cz },
    { x:cx+hx, y:cy+hy, z:cz }, { x:cx-hx, y:cy+hy, z:cz },
  ];
  return [[0,1],[1,2],[2,3],[3,0]].map(([a,b]) => [corners[a], corners[b]]);
}

function _viewer3dResolveColor(theme, color) {
  if (color === 'wire') return theme.wire;
  if (color === 'element') return theme.element;
  if (color === 'brand') return theme.brand;
  if (color === 'background') return theme.background;
  return color;
}

function _viewer3dPointInPolygon(pointX, pointY, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersects = ((yi > pointY) !== (yj > pointY)) &&
      (pointX < ((xj - xi) * (pointY - yi) / ((yj - yi) || 0.000001)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function _viewer3dTooltipAt(canvasX, canvasY) {
  if (!_viewer3dHoverTargets.length) return '';
  for (let i = _viewer3dHoverTargets.length - 1; i >= 0; i--) {
    const target = _viewer3dHoverTargets[i];
    if (!target?.tooltip || !target.polygon?.length) continue;
    if (_viewer3dPointInPolygon(canvasX, canvasY, target.polygon)) return target.tooltip;
  }
  return '';
}

function _viewer3dSpaceAt(canvasX, canvasY) {
  if (!_viewer3dHoverTargets.length) return '';
  for (let i = _viewer3dHoverTargets.length - 1; i >= 0; i--) {
    const target = _viewer3dHoverTargets[i];
    if (!target?.spaceKey || !target.polygon?.length) continue;
    if (_viewer3dPointInPolygon(canvasX, canvasY, target.polygon)) return target.spaceKey;
  }
  return '';
}

function _viewer3dApplyRoomSelection(spaceKey, additive) {
  if (!spaceKey) return;
  if (additive) {
    if (sel.space.has(spaceKey)) sel.space.delete(spaceKey);
    else sel.space.add(spaceKey);
  } else {
    const alreadyOnly = sel.space.size === 1 && sel.space.has(spaceKey);
    sel.space.clear();
    if (!alreadyOnly) sel.space.add(spaceKey);
  }
  applyFilters();
}

function _viewer3dSetCanvasTooltip(canvas, tooltip) {
  const text = tooltip || '';
  if (_viewer3dTooltipText === text) return;
  _viewer3dTooltipText = text;
  canvas.title = text;
}

function _viewer3dTooltipEnsure() {
  if (_viewer3dTooltipEl && document.body.contains(_viewer3dTooltipEl)) return _viewer3dTooltipEl;
  const el = document.createElement('div');
  el.className = 'room-hover-tooltip d-none';
  document.body.appendChild(el);
  _viewer3dTooltipEl = el;
  return el;
}

function _viewer3dTooltipHide() {
  if (!_viewer3dTooltipEl) return;
  _viewer3dTooltipEl.classList.add('d-none');
}

function _viewer3dTooltipShow(text, clientX, clientY) {
  if (!text) {
    _viewer3dTooltipHide();
    return;
  }
  const el = _viewer3dTooltipEnsure();
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

function _viewer3dDrawAxesHelper(ctx, width, height, theme) {
  const originX = width - 52;
  const originY = height - 42;
  const axisLength = 22;
  const axes = [
    { label:'X', color:theme.axisX, point:{ x:axisLength, y:0, z:0 } },
    { label:'Y', color:theme.axisY, point:{ x:0, y:axisLength, z:0 } },
    { label:'Z', color:theme.axisZ, point:{ x:0, y:0, z:axisLength } },
  ];

  ctx.save();
  ctx.font = '11px Verdana, Geneva, sans-serif';
  ctx.lineWidth = 1.5;
  axes.forEach(axis => {
    const rotated = _viewer3dRotate(axis.point);
    const endX = originX + rotated.x;
    const endY = originY - rotated.y;
    ctx.strokeStyle = axis.color;
    ctx.fillStyle = axis.color;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.fillText(axis.label, endX + 4, endY + 4);
  });
  ctx.restore();
}

function _renderThreeDViewer() {
  const els = _viewer3dElements();
  const canvas = els?.canvas;
  if (!canvas || !_viewer3dScene || !els.panel || els.panel.classList.contains('viewer3d-collapsed')) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(10, Math.round(rect.width));
  const height = Math.max(10, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const theme = _viewer3dTheme();

  const focusSource = _viewer3dScene.focusPoints?.length ? _viewer3dScene.focusPoints : _viewer3dScene.points;
  const xs = focusSource.map(point => point.x);
  const ys = focusSource.map(point => point.y);
  const zs = focusSource.map(point => point.z);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  const extentSource = _viewer3dScene.points;
  const span = Math.max(
    ...extentSource.map(point => Math.abs(point.x - center.x) * 2),
    ...extentSource.map(point => Math.abs(point.y - center.y) * 2),
    ...extentSource.map(point => Math.abs(point.z - center.z) * 2),
    3000
  );
  const scale = (0.82 * Math.min(width, height) / span) * _viewer3dZoom;
  const perspectiveBlend = _viewer3dClamp((_viewer3dZoom - 1.2) / 5, 0, 1);
  const perspectiveDistance = span * (1.9 - 1.7 * perspectiveBlend);
  const perspective = Math.max(120, perspectiveDistance);
  const fovStartDeg = 22;
  const fovEndDeg = 35;
  const fovRamp = _viewer3dClamp((perspectiveBlend - 0.24) / 0.76, 0, 1);
  const fovT = Math.pow(fovRamp, 1.35);
  const fovDegrees = fovStartDeg + ((fovEndDeg - fovStartDeg) * fovT);
  const fovScale = Math.tan((fovStartDeg * Math.PI) / 360) / Math.tan((fovDegrees * Math.PI) / 360);

  const renderBatches = [];
  _viewer3dHoverTargets = [];
  _viewer3dScene.objects.forEach(object => {
    const localX = object.x - center.x;
    const localY = object.y - center.y;
    const localZ = object.z - center.z;
    const edges = object.type === 'plane'
      ? _viewer3dPlaneEdges(localX, localY, localZ, object.sizeX, object.sizeY)
      : _viewer3dCubeEdges(localX, localY, localZ, object.sizeX, object.sizeY, object.sizeZ);
    const depth = _viewer3dRotate({ x:localX, y:localY, z:localZ }).z;
    const batch = {
      edges,
      color:object.color,
      depth,
      lineWidth:object.lineWidth || 1,
      alphaMul:object.alphaMul || 1,
      fills:[],
      tooltip:object.tooltip || '',
      spaceKey:object.spaceKey || '',
    };

    if (object.type === 'cube' && object.fillColor && object.fillAlpha > 0) {
      const faces = _viewer3dCubeFaces(localX, localY, localZ, object.sizeX, object.sizeY, object.sizeZ);
      faces.forEach(face => {
        const depthAverage = face.reduce((sum, point) => sum + _viewer3dRotate(point).z, 0) / face.length;
        batch.fills.push({
          points:face,
          color:object.fillColor,
          alpha:object.fillAlpha,
          depth:depthAverage,
        });
      });
      batch.fills.sort((a, b) => b.depth - a.depth);
    }

    renderBatches.push(batch);
  });

  // Painter's order: draw farther geometry first, then nearer geometry on top.
  renderBatches.sort((a, b) => b.depth - a.depth);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  renderBatches.forEach(batch => {
    batch.fills.forEach(fill => {
      ctx.fillStyle = _viewer3dResolveColor(theme, fill.color);
      ctx.globalAlpha = fill.alpha;
      ctx.beginPath();
      fill.points.forEach((point, index) => {
        const p = _viewer3dProject(point, scale, perspective, width, height, fovScale);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
    });

    ctx.strokeStyle = _viewer3dResolveColor(theme, batch.color);
    ctx.globalAlpha = batch.alphaMul;
    ctx.lineWidth = batch.lineWidth;
    ctx.beginPath();
    batch.edges.forEach(([start, end]) => {
      const p1 = _viewer3dProject(start, scale, perspective, width, height, fovScale);
      const p2 = _viewer3dProject(end, scale, perspective, width, height, fovScale);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    });
    ctx.stroke();

    if (batch.tooltip) {
      let bestFace = null;
      batch.fills.forEach(fill => {
        if (!bestFace || fill.depth < bestFace.depth) bestFace = fill;
      });
      if (bestFace?.points?.length) {
        const polygon = bestFace.points.map(point => _viewer3dProject(point, scale, perspective, width, height, fovScale));
        _viewer3dHoverTargets.push({
          tooltip:batch.tooltip,
          polygon,
          depth:batch.depth,
          spaceKey:batch.spaceKey,
        });
      }
    }
  });

  ctx.globalAlpha = 1;

  _viewer3dDrawAxesHelper(ctx, width, height, theme);
}

function _viewer3dApplyCollapsedState(els) {
  els.panel.classList.toggle('viewer3d-collapsed', _viewer3dCollapsed);
  els.edgeToggle?.setAttribute('aria-expanded', _viewer3dCollapsed ? 'false' : 'true');
  if (_viewer3dCollapsed) {
    _viewer3dLastWidth = _viewer3dWidth || _viewer3dDesiredWidth();
  } else if (!_viewer3dWidth) {
    _viewer3dSetWidth(els, _viewer3dLastWidth || _viewer3dDesiredWidth());
  }
  _renderThreeDViewer();
}

function _viewer3dSetEmpty(els, text) {
  if (!els?.empty) return;
  els.empty.textContent = text;
  els.empty.classList.toggle('d-none', !text);
}

function _bindThreeDPanelToggle(els) {
  const edge = els?.edgeToggle;
  if (!edge || edge.dataset.bound === '1') return;
  edge.dataset.bound = '1';

  edge.addEventListener('mousedown', event => {
    if (event.button !== 0 || window.matchMedia('(max-width: 1200px)').matches) return;
    const startX = event.clientX;
    const startW = els.panel.getBoundingClientRect().width;
    let dragged = false;

    const onMove = moveEvent => {
      const delta = startX - moveEvent.clientX;
      if (Math.abs(delta) > 3) dragged = true;
      if (_viewer3dCollapsed) {
        _viewer3dCollapsed = false;
        els.panel.classList.remove('viewer3d-collapsed');
        els.edgeToggle?.setAttribute('aria-expanded', 'true');
      }
      _viewer3dSetWidth(els, startW + delta);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragged) {
        _viewer3dCollapsed = !_viewer3dCollapsed;
        _viewer3dApplyCollapsedState(els);
      } else {
        _viewer3dLastWidth = _viewer3dWidth;
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  window.addEventListener('resize', () => {
    if (_viewer3dCollapsed || !els.panel || window.matchMedia('(max-width: 1200px)').matches) return;
    _viewer3dSetWidth(els, _viewer3dWidth || _viewer3dDesiredWidth());
  });
}

function _bindThreeDCanvas(els) {
  const canvas = els?.canvas;
  if (!canvas || canvas.dataset.bound === '1') return;
  canvas.dataset.bound = '1';

  canvas.addEventListener('contextmenu', event => event.preventDefault());

  canvas.addEventListener('wheel', event => {
    if (!_viewer3dScene) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1.18 : 0.85;
    _viewer3dZoom = _viewer3dClamp(_viewer3dZoom * step, 0.3, 80);
    _renderThreeDViewer();
  }, { passive:false });

  canvas.addEventListener('mousedown', event => {
    if (!_viewer3dScene) return;
    event.preventDefault();
    _viewer3dTooltipHide();

    if (event.button === 0) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const spaceKey = _viewer3dSpaceAt(x, y);
      _viewer3dApplyRoomSelection(spaceKey, !!(event.ctrlKey || event.metaKey));
      return;
    }

    if (event.button !== 1 && event.button !== 2) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startRotX = _viewer3dRotX;
    const startRotY = _viewer3dRotY;
    const startPanX = _viewer3dPanX;
    const startPanY = _viewer3dPanY;
    _viewer3dDragging = event.button === 1 ? 'rotate' : 'pan';
    canvas.classList.toggle('viewer3d-panning', _viewer3dDragging === 'pan');
    canvas.classList.toggle('viewer3d-rotating', _viewer3dDragging === 'rotate');

    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (_viewer3dDragging === 'rotate') {
        _viewer3dRotY = startRotY + dx * 0.01;
        _viewer3dRotX = Math.max(-1.45, Math.min(1.45, startRotX - dy * 0.01));
      } else {
        _viewer3dPanX = startPanX + dx;
        _viewer3dPanY = startPanY + dy;
      }
      _renderThreeDViewer();
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _viewer3dDragging = '';
      canvas.classList.remove('viewer3d-panning', 'viewer3d-rotating');
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  canvas.addEventListener('mousemove', event => {
    if (!_viewer3dScene || _viewer3dDragging) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const text = _viewer3dTooltipAt(x, y);
    _viewer3dSetCanvasTooltip(canvas, text);
    _viewer3dTooltipShow(text, event.clientX, event.clientY);
  });

  canvas.addEventListener('mouseleave', () => {
    _viewer3dSetCanvasTooltip(canvas, '');
    _viewer3dTooltipHide();
  });
}

function initThreeDViewerPanel() {
  const els = _viewer3dElements();
  if (!els.panel || !els.edgeToggle || !els.canvas) return;
  _viewer3dSetWidth(els, _viewer3dDesiredWidth());
  _bindThreeDPanelToggle(els);
  _bindThreeDCanvas(els);
  _viewer3dApplyCollapsedState(els);
}

function refreshThreeDViewerPanel(filteredComps, counts) {
  const els = _viewer3dElements();
  if (!els.panel || !els.canvas) return;

  if (!(db.coordinates || []).length) {
    els.panel.classList.add('d-none');
    _viewer3dScene = null;
    _viewer3dHoverTargets = [];
    _viewer3dTooltipText = '';
    els.canvas.title = '';
    _viewer3dTooltipHide();
    _viewer3dSceneKey = '';
    _viewer3dHasAutoFit = false;
    return;
  }

  els.panel.classList.remove('d-none');
  _viewer3dScene = _viewer3dSceneData(filteredComps || [], counts || {});
  if (!_viewer3dScene) {
    _viewer3dSetEmpty(els, 'No coordinate data available for the current view.');
    _viewer3dSceneKey = '';
    _viewer3dHasAutoFit = false;
  } else {
    _viewer3dSetEmpty(els, '');
    const nextKey = _viewer3dSceneSignature(_viewer3dScene);
    if (!_viewer3dHasAutoFit) {
      _viewer3dPanX = 0;
      _viewer3dPanY = 0;
      _viewer3dZoom = 1;
      _viewer3dHasAutoFit = true;
    }
    _viewer3dSceneKey = nextKey;
  }
  _viewer3dApplyCollapsedState(els);
  _renderThreeDViewer();
}

function handleThreeDViewerResize() {
  _renderThreeDViewer();
}

function resetThreeDViewerPanel() {
  const els = _viewer3dElements();
  if (!els.panel) return;
  els.panel.classList.add('d-none');
  _viewer3dScene = null;
  _viewer3dSceneKey = '';
  _viewer3dHasAutoFit = false;
  _viewer3dPanX = 0;
  _viewer3dPanY = 0;
  _viewer3dZoom = 1;
  _viewer3dRotX = -0.55;
  _viewer3dRotY = 0.7;
  _viewer3dHoverTargets = [];
  _viewer3dTooltipText = '';
  if (els.canvas) els.canvas.title = '';
  _viewer3dTooltipHide();
  _viewer3dSetEmpty(els, '');
}

initThreeDViewerPanel();