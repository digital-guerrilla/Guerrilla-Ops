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
let _viewer3dFloorKey = '';
const _viewer3dFloorImageCache = new Map();
const _viewer3dRoomPolygonCache = new Map();
const _viewer3dRoomGeometryCache = new Map();
let _viewer3dRoomGeometryCacheReady = false;
let _viewer3dFloorMeshDivisions = 1;
let _viewer3dCoordIndexRows = null;
let _viewer3dCoordIndexLength = -1;
let _viewer3dCoordIndexCache = null;

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
    floorControl: document.getElementById('viewer3d-floor-control'),
    floorSelect: document.getElementById('viewer3d-floor-select'),
    resetView: document.getElementById('viewer3d-reset-view'),
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

function _viewer3dParseNumber(value, fallback = null) {
  const text = String(value ?? '').trim();
  if (!text || text.toLowerCase() === 'n/a') return fallback;
  const num = Number(text.replace(/,/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function _coordinateSourceToWorld(sourceX, sourceY, sourceZ) {
  return {
    x:sourceY,
    y:sourceZ,
    z:sourceX === 0 ? 0 : -sourceX,
  };
}

function _coordinateWorldToSource(point) {
  if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return null;
  return {
    x:point.z === 0 ? 0 : -point.z,
    y:point.x,
    z:point.y,
  };
}

function _viewer3dCoordPoint(row) {
  if (!row) return null;
  const sourceX = _viewer3dParseNumber(f(row, 'CoordinateXAxis', 'Coordinate X Axis'));
  const sourceY = _viewer3dParseNumber(f(row, 'CoordinateYAxis', 'Coordinate Y Axis'));
  const sourceZ = _viewer3dParseNumber(f(row, 'CoordinateZAxis', 'Coordinate Z Axis'));
  if (sourceX === null || sourceY === null || sourceZ === null) return null;
  return _coordinateSourceToWorld(sourceX, sourceY, sourceZ);
}

function _viewer3dCoordKeyParts(row) {
  const rowName = _cobieField(row, 'rowName').trim();
  if (!rowName) return null;
  const coordinateName = f(row, 'Name').replace(/[\s_-]+/g, '').toLowerCase();
  const namedCorner = ['upperright', 'lowerright', 'upperleft', 'lowerleft']
    .find(corner => coordinateName.endsWith(corner)) || '';
  const suffixMatch = rowName.match(/^(.*?)(?:_(upperright|lowerright|upperleft|lowerleft))$/i);
  const cornerName = namedCorner || (coordinateName === 'coordinate' ? '' : (suffixMatch?.[2] || '').toLowerCase());
  return {
    baseName: (cornerName && suffixMatch ? suffixMatch[1] : rowName).trim(),
    cornerName,
  };
}

function _viewer3dCoordIndex() {
  const rows = db.coordinates || [];
  if (_viewer3dCoordIndexCache && rows === _viewer3dCoordIndexRows && rows.length === _viewer3dCoordIndexLength) {
    return _viewer3dCoordIndexCache;
  }
  const bySheet = Object.create(null);
  rows.forEach(row => {
    const sheet = _cobieField(row, 'sheetName').toLowerCase();
    const parts = _viewer3dCoordKeyParts(row);
    const facility = String(row._facility || '').toLowerCase();
    if (!sheet || !parts?.baseName) return;
    const key = facility + '::' + parts.baseName.toLowerCase();
    const bucket = (bySheet[sheet] = bySheet[sheet] || Object.create(null));
    const entry = (bucket[key] = bucket[key] || { base:null, upperRight:null, lowerLeft:null, corners:[] });
    const prefer = current => !current || (!_viewer3dCoordPoint(current) && _viewer3dCoordPoint(row));
    if (!parts.cornerName) {
      if (prefer(entry.base)) entry.base = row;
    } else if (parts.cornerName === 'upperright') {
      if (prefer(entry.upperRight)) entry.upperRight = row;
    } else if (parts.cornerName === 'lowerleft') {
      if (prefer(entry.lowerLeft)) entry.lowerLeft = row;
    } else {
      entry.corners.push(row);
    }
  });
  _viewer3dCoordIndexRows = rows;
  _viewer3dCoordIndexLength = rows.length;
  _viewer3dCoordIndexCache = bySheet;
  return bySheet;
}

function _viewer3dInvalidateCoordIndex() {
  _viewer3dCoordIndexRows = null;
  _viewer3dCoordIndexLength = -1;
  _viewer3dCoordIndexCache = null;
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
  const cornerPoints = [];
  const lowerLeft = _viewer3dCoordPoint(coordEntry.lowerLeft);
  const upperRight = _viewer3dCoordPoint(coordEntry.upperRight);
  const basePoint = _viewer3dCoordPoint(coordEntry.base);
  if (lowerLeft) cornerPoints.push(lowerLeft);
  if (upperRight) cornerPoints.push(upperRight);
  coordEntry.corners.forEach(row => {
    const point = _viewer3dCoordPoint(row);
    if (point) cornerPoints.push(point);
  });
  const hasCornerPoints = cornerPoints.length >= 2;
  const points = hasCornerPoints ? cornerPoints : (basePoint ? [basePoint] : cornerPoints.slice(0, 1));
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
    hasCorners:hasCornerPoints,
    isPoint:!hasCornerPoints,
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

function _viewer3dModalAverage(values) {
  const groups = new Map();
  values.filter(Number.isFinite).forEach(value => {
    const key = Math.round(value);
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  });
  let mode = [];
  groups.forEach(group => {
    if (group.length > mode.length) mode = group;
  });
  return mode.length ? mode.reduce((sum, value) => sum + value, 0) / mode.length : null;
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
      const floorName = _cobieField(space, 'floorName').toLowerCase();
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
    const floorName = _cobieField(space, 'floorName');
    const floorKey = _scopeKey(space._facility, floorName);
    if (!floorKeys.has(floorKey)) return false;
    return true;
  });
}

function _viewer3dFloorPlans(visibleFloors, coordIndex) {
  const svgByKey = typeof _collectFloorSvgByKey === 'function' ? _collectFloorSvgByKey() : {};
  return visibleFloors.map(floorRow => {
    const name = f(floorRow, 'Name');
    const key = _rowKey(floorRow, name);
    const spaces = db.spaces
      .filter(space =>
        (space._facility || '') === (floorRow._facility || '') &&
        _cobieField(space, 'floorName').toLowerCase() === name.toLowerCase()
      )
      .map(space => _viewer3dBounds(
        _viewer3dCoordFor(coordIndex, 'space', space._facility, f(space, 'Name')),
        2400
      ))
      .filter(bounds => bounds?.hasCorners);
    if (!spaces.length) return { key, name, facility:floorRow._facility || '', svgRaw:svgByKey[key] || '', bounds:null };

    const minX = Math.min(...spaces.map(bounds => bounds.minX));
    const maxX = Math.max(...spaces.map(bounds => bounds.maxX));
    const minZ = Math.min(...spaces.map(bounds => bounds.minZ));
    const maxZ = Math.max(...spaces.map(bounds => bounds.maxZ));
    return {
      key,
      name,
      facility:floorRow._facility || '',
      svgRaw:svgByKey[key] || '',
      alignment:typeof _floorAlignmentFromRaw === 'function'
        ? _floorAlignmentFromRaw(_floorAlignmentAttrValueForRow(floorRow))
        : null,
      bounds:{
        minX, maxX, minZ, maxZ,
        sizeX:Math.max(1, maxX - minX),
        sizeZ:Math.max(1, maxZ - minZ),
        y:_viewer3dModalAverage(spaces.map(bounds => bounds.minY)),
      },
    };
  });
}

function _viewer3dRebuildRoomGeometryCache(floorKey = '') {
  const coordIndex = _viewer3dCoordIndex();
  const allFloorPlans = _viewer3dFloorPlans(db.floors, coordIndex);
  const floorPlans = floorKey
    ? allFloorPlans.filter(plan => plan.key === floorKey)
    : allFloorPlans;
  if (!floorKey) {
    _viewer3dRoomGeometryCache.clear();
    _viewer3dRoomPolygonCache.clear();
  }
  else {
    [..._viewer3dRoomGeometryCache].forEach(([key, room]) => {
      if (room.floorKey === floorKey) _viewer3dRoomGeometryCache.delete(key);
    });
    [..._viewer3dRoomPolygonCache.keys()].forEach(key => {
      if (key.startsWith(floorKey + '::')) _viewer3dRoomPolygonCache.delete(key);
    });
  }

  floorPlans.forEach(floorPlan => {
    if (!floorPlan.bounds) return;
    const floorSpaces = db.spaces.map(row => ({
      row,
      floorKey:_scopeKey(row._facility, _cobieField(row, 'floorName')),
    })).filter(entry => entry.floorKey === floorPlan.key);
    const boundsBySpace = new Map(floorSpaces.map(entry => [
      entry.row,
      _viewer3dBounds(_viewer3dCoordFor(coordIndex, 'space', entry.row._facility, f(entry.row, 'Name')), 2400),
    ]));
    const defaultHeight = _viewer3dMedian([...boundsBySpace.values()]
      .filter(Boolean)
      .map(bounds => bounds.sizeY)) || 2400;
    const nextFloor = allFloorPlans
      .filter(plan => plan.facility === floorPlan.facility && plan.bounds?.y > floorPlan.bounds.y)
      .sort((a, b) => a.bounds.y - b.bounds.y)[0];
    const storeyHeight = nextFloor ? nextFloor.bounds.y - floorPlan.bounds.y : defaultHeight;
    const polygons = floorPlan.svgRaw ? _viewer3dSvgRoomPolygons(floorPlan) : new Map();

    floorSpaces.forEach(entry => {
      const name = f(entry.row, 'Name').toLowerCase();
      const number = _viewer3dSpaceRoomNumber(entry.row).toLowerCase();
      const identifiers = [name, number].filter(Boolean);
      const polygon = identifiers.map(identifier => polygons.get(identifier)).find(Boolean) || null;
      const coordinateBounds = boundsBySpace.get(entry.row);
      let bounds = coordinateBounds;
      if (polygon) {
        const xs = polygon.map(point => point.x);
        const zs = polygon.map(point => point.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const minY = floorPlan.bounds.y;
        const sizeY = Math.min(coordinateBounds?.sizeY || defaultHeight, storeyHeight);
        bounds = {
          minX, maxX, minY, maxY:minY + sizeY, minZ, maxZ,
          centerX:(minX + maxX) / 2, centerY:minY + sizeY / 2, centerZ:(minZ + maxZ) / 2,
          sizeX:Math.max(1, maxX - minX), sizeY, sizeZ:Math.max(1, maxZ - minZ),
        };
      }
      if (!bounds) return;
      _viewer3dRoomGeometryCache.set(_scopeKey(entry.row._facility, f(entry.row, 'Name')), {
        row:entry.row,
        floorKey:entry.floorKey,
        source:polygon ? 'svg' : 'coordinate',
        polygon,
        bounds,
        identifiers,
      });
    });
  });
  _viewer3dRoomGeometryCacheReady = true;
}

function _viewer3dEnsureRoomGeometryCache() {
  if (!_viewer3dRoomGeometryCacheReady) _viewer3dRebuildRoomGeometryCache();
  return _viewer3dRoomGeometryCache;
}

function _viewer3dSceneData(filteredComps, counts) {
  const coordIndex = _viewer3dCoordIndex();
  if (!Object.keys(coordIndex).length) return null;
  const roomGeometry = _viewer3dEnsureRoomGeometryCache();

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
    .map(space => roomGeometry.get(_scopeKey(space._facility, f(space, 'Name'))))
    .filter(Boolean);

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

  const svgSpaces = spaces.filter(entry => entry.source === 'svg');
  const culledSpaces = [
    ...svgSpaces,
    ..._viewer3dCullOutliers(spaces.filter(entry => entry.source !== 'svg')),
  ];
  const culledComponents = _viewer3dCullOutliers(components);

  const spacePointsByFloor = Object.create(null);
  culledSpaces.forEach(entry => {
    const floorName = _cobieField(entry.row, 'floorName');
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
    const roomNumber = _viewer3dSpaceRoomNumber(entry.row).toLowerCase();
    const isSelectedSpace = (sel.space.size > 0 && sel.space.has(spaceName)) || highlightedSpaces.has(spaceName);
    const floorKey = _scopeKey(entry.row._facility, _cobieField(entry.row, 'floorName'));
    objects.push({
      type:'cube',
      kind:'space',
      floorKey,
      highlighted:isSelectedSpace,
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
      roomIdentifiers:entry.identifiers,
      polygon:entry.polygon,
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
    floorPlans:_viewer3dFloorPlans(visibleFloors, coordIndex),
  };
}

function _viewer3dRotate(point) {
  return _viewer3dRotateAt(point, _viewer3dRotX, _viewer3dRotY);
}

function _viewer3dRotateAt(point, rotX, rotY) {
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;
  const y2 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX;
  return { x:x1, y:y2, z:z2 };
}

function _viewer3dProject(point, scale, perspective, width, height, fovScale = 1) {
  return _viewer3dProjectAt(point, scale, perspective, width, height, fovScale, _viewer3dRotX, _viewer3dRotY, _viewer3dPanX, _viewer3dPanY);
}

function _viewer3dProjectAt(point, scale, perspective, width, height, fovScale = 1, rotX = _viewer3dRotX, rotY = _viewer3dRotY, panX = _viewer3dPanX, panY = _viewer3dPanY) {
  const rotated = _viewer3dRotateAt(point, rotX, rotY);
  return {
    x: (width / 2) + panX + (rotated.x * scale),
    y: (height / 2) + panY - (rotated.y * scale),
    depth: rotated.z,
  };
}

function _viewer3dRenderSceneToCanvas(canvas, scene, options = {}) {
  if (!canvas || !scene?.points?.length) return false;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(10, Math.round(rect.width || canvas.clientWidth || 10));
  const height = Math.max(10, Math.round(rect.height || canvas.clientHeight || 10));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const theme = options.theme || _viewer3dTheme();
  const rotX = Number.isFinite(options.rotX) ? options.rotX : _viewer3dRotX;
  const rotY = Number.isFinite(options.rotY) ? options.rotY : _viewer3dRotY;
  const panX = Number.isFinite(options.panX) ? options.panX : _viewer3dPanX;
  const panY = Number.isFinite(options.panY) ? options.panY : _viewer3dPanY;
  const zoom = Number.isFinite(options.zoom) ? options.zoom : _viewer3dZoom;
  const background = options.background || theme.background;
  const floorPlans = scene.floorPlans || [];
  const floorPlan = floorPlans.find(entry => entry.key === _viewer3dFloorKey);
  const floorPlanSelected = !!(floorPlan?.bounds && floorPlan.svgRaw);
  const focusSource = scene.focusPoints?.length ? scene.focusPoints : scene.points;
  const xs = focusSource.map(point => point.x);
  const ys = focusSource.map(point => point.y);
  const zs = focusSource.map(point => point.z);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  const extentSource = scene.points;
  const span = Math.max(
    ...extentSource.map(point => Math.abs(point.x - center.x) * 2),
    ...extentSource.map(point => Math.abs(point.y - center.y) * 2),
    ...extentSource.map(point => Math.abs(point.z - center.z) * 2),
    options.minSpan || 3000
  );
  const scale = (options.scaleFactor || 0.82) * Math.min(width, height) / span * zoom;
  const perspectiveBlend = _viewer3dClamp((zoom - 1.2) / 5, 0, 1);
  const perspectiveDistance = span * (1.9 - 1.7 * perspectiveBlend);
  const perspective = Math.max(options.minPerspective || 120, perspectiveDistance);
  const fovStartDeg = 22;
  const fovEndDeg = 35;
  const fovRamp = _viewer3dClamp((perspectiveBlend - 0.24) / 0.76, 0, 1);
  const fovT = Math.pow(fovRamp, 1.35);
  const fovDegrees = fovStartDeg + ((fovEndDeg - fovStartDeg) * fovT);
  const fovScale = Math.tan((fovStartDeg * Math.PI) / 360) / Math.tan((fovDegrees * Math.PI) / 360);
  const renderBatches = [];
  const hoverTargets = [];
  (scene.objects || []).forEach(object => {
    const localX = object.x - center.x;
    const localY = object.y - center.y;
    const localZ = object.z - center.z;
    const roomPolygon = object.kind === 'space' ? object.polygon : null;
    const localPolygon = roomPolygon?.map(point => ({ x:point.x - center.x, z:point.z - center.z })) || null;
    const edges = localPolygon
      ? _viewer3dPrismEdges(localPolygon, localY - object.sizeY / 2, localY + object.sizeY / 2)
      : (object.type === 'plane'
        ? _viewer3dPlaneEdges(localX, localY, localZ, object.sizeX, object.sizeY)
        : _viewer3dCubeEdges(localX, localY, localZ, object.sizeX, object.sizeY, object.sizeZ));
    const depth = _viewer3dRotateAt({ x:localX, y:localY, z:localZ }, rotX, rotY).z;
    const batch = {
      edges,
      color:object.color,
      depth,
      lineWidth:object.lineWidth || 1,
      alphaMul:(object.alphaMul || 1) * _viewer3dRoomOpacity(object, floorPlanSelected ? floorPlan.key : ''),
      fills:[],
      tooltip:object.tooltip || '',
      spaceKey:object.spaceKey || '',
      interactive:_viewer3dRoomInteractive(object, floorPlanSelected ? floorPlan.key : ''),
    };

    if (object.type === 'cube' && object.fillColor && object.fillAlpha > 0) {
      const faces = localPolygon
        ? _viewer3dPrismFaces(localPolygon, localY - object.sizeY / 2, localY + object.sizeY / 2)
        : _viewer3dCubeFaces(localX, localY, localZ, object.sizeX, object.sizeY, object.sizeZ);
      faces.forEach(face => {
        const depthAverage = face.reduce((sum, point) => sum + _viewer3dRotateAt(point, rotX, rotY).z, 0) / face.length;
        const dimMultiplier = _viewer3dRoomOpacity(object, floorPlanSelected ? floorPlan.key : '');
        batch.fills.push({ points:face, color:object.fillColor, alpha:object.fillAlpha * dimMultiplier, depth:depthAverage });
      });
      batch.fills.sort((a, b) => b.depth - a.depth);
    }

    renderBatches.push(batch);
  });

  renderBatches.sort((a, b) => b.depth - a.depth);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  if (floorPlan?.bounds && floorPlan.svgRaw) {
    _viewer3dDrawFloorPlan(ctx, floorPlan, center, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY);
  }

  renderBatches.forEach(batch => {
    batch.fills.forEach(fill => {
      ctx.fillStyle = _viewer3dResolveColor(theme, fill.color);
      ctx.globalAlpha = fill.alpha;
      ctx.beginPath();
      fill.points.forEach((point, index) => {
        const p = _viewer3dProjectAt(point, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY);
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
      const p1 = _viewer3dProjectAt(start, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY);
      const p2 = _viewer3dProjectAt(end, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    });
    ctx.stroke();

    if (batch.interactive && batch.tooltip) {
      let bestFace = null;
      batch.fills.forEach(fill => {
        if (!bestFace || fill.depth < bestFace.depth) bestFace = fill;
      });
      if (bestFace?.points?.length) {
        const polygon = bestFace.points.map(point => _viewer3dProjectAt(point, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY));
        hoverTargets.push({ tooltip:batch.tooltip, polygon, depth:batch.depth, spaceKey:batch.spaceKey });
      }
    }
  });

  ctx.globalAlpha = 1;
  _viewer3dDrawAxesHelper(ctx, width, height, theme);
  return { width, height, center, scale, perspective, fovScale, hoverTargets };
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

function _viewer3dPrismEdges(polygon, minY, maxY) {
  const edges = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    edges.push([{ x:point.x, y:minY, z:point.z }, { x:next.x, y:minY, z:next.z }]);
    edges.push([{ x:point.x, y:maxY, z:point.z }, { x:next.x, y:maxY, z:next.z }]);
    if (_viewer3dVertexTurnAngle(polygon, index) >= 45) {
      edges.push([{ x:point.x, y:minY, z:point.z }, { x:point.x, y:maxY, z:point.z }]);
    }
  });
  return edges;
}

function _viewer3dVertexTurnAngle(polygon, index) {
  if (!polygon?.length || polygon.length < 3) return 0;
  const point = polygon[index];
  const previous = polygon[(index - 1 + polygon.length) % polygon.length];
  const next = polygon[(index + 1) % polygon.length];
  const incomingX = previous.x - point.x;
  const incomingZ = previous.z - point.z;
  const outgoingX = next.x - point.x;
  const outgoingZ = next.z - point.z;
  const denominator = Math.hypot(incomingX, incomingZ) * Math.hypot(outgoingX, outgoingZ);
  if (!denominator) return 0;
  const cosine = _viewer3dClamp(
    ((incomingX * outgoingX) + (incomingZ * outgoingZ)) / denominator,
    -1,
    1
  );
  const interiorAngle = Math.acos(cosine) * 180 / Math.PI;
  return 180 - interiorAngle;
}

function _viewer3dPrismFaces(polygon, minY, maxY) {
  const bottom = polygon.map(point => ({ x:point.x, y:minY, z:point.z }));
  const top = polygon.map(point => ({ x:point.x, y:maxY, z:point.z }));
  const sides = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return [
      { x:point.x, y:minY, z:point.z },
      { x:next.x, y:minY, z:next.z },
      { x:next.x, y:maxY, z:next.z },
      { x:point.x, y:maxY, z:point.z },
    ];
  });
  return [bottom, top, ...sides];
}

function _viewer3dRoomOpacity(object, selectedFloorKey) {
  if (object?.kind !== 'space' || !selectedFloorKey) return 1;
  if (object.floorKey !== selectedFloorKey) return 0.04;
  return object.highlighted ? 0.9 : 0.35;
}

function _viewer3dRoomInteractive(object, selectedFloorKey) {
  if (object?.kind !== 'space') return false;
  return !selectedFloorKey || object.floorKey === selectedFloorKey;
}

function _viewer3dClosedSvgPoints(node) {
  if (!node) return null;
  const tag = String(node.tagName || '').toLowerCase();
  if (tag === 'rect') {
    const x = Number(node.getAttribute('x')) || 0;
    const y = Number(node.getAttribute('y')) || 0;
    const width = Number(node.getAttribute('width'));
    const height = Number(node.getAttribute('height'));
    if (!(width > 0 && height > 0)) return null;
    return [{ x, y }, { x:x + width, y }, { x:x + width, y:y + height }, { x, y:y + height }];
  }
  if (tag === 'polygon') {
    const points = String(node.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    if (points.length < 6 || points.length % 2 || points.some(value => !Number.isFinite(value))) return null;
    return Array.from({ length:points.length / 2 }, (_, index) => ({ x:points[index * 2], y:points[index * 2 + 1] }));
  }
  if (tag !== 'path' || typeof node.getTotalLength !== 'function') return null;
  const data = String(node.getAttribute('d') || '').trim();
  if (!/[zZ]\s*$/.test(data) || (data.match(/[mM]/g) || []).length !== 1) return null;
  let length;
  try { length = node.getTotalLength(); } catch (_) { return null; }
  if (!Number.isFinite(length) || length <= 0) return null;
  const count = _viewer3dClamp(Math.ceil(length / 12), 12, 96);
  return Array.from({ length:count }, (_, index) => node.getPointAtLength(length * index / count));
}

function _viewer3dSvgRootPoint(point, nodeMatrix, rootMatrix) {
  if (!point || !nodeMatrix) return null;
  const viewportX = (nodeMatrix.a * point.x) + (nodeMatrix.c * point.y) + nodeMatrix.e;
  const viewportY = (nodeMatrix.b * point.x) + (nodeMatrix.d * point.y) + nodeMatrix.f;
  if (!rootMatrix) return { x:viewportX, y:viewportY };
  const determinant = (rootMatrix.a * rootMatrix.d) - (rootMatrix.b * rootMatrix.c);
  if (Math.abs(determinant) <= 1e-12) return null;
  const offsetX = viewportX - rootMatrix.e;
  const offsetY = viewportY - rootMatrix.f;
  return {
    x:((rootMatrix.d * offsetX) - (rootMatrix.c * offsetY)) / determinant,
    y:((-rootMatrix.b * offsetX) + (rootMatrix.a * offsetY)) / determinant,
  };
}

function _viewer3dSvgRoomPolygons(floorPlan) {
  const cacheKey = floorPlan.key + '::' + floorPlan.svgRaw + '::' + JSON.stringify(floorPlan.alignment || {});
  if (_viewer3dRoomPolygonCache.has(cacheKey)) return _viewer3dRoomPolygonCache.get(cacheKey);
  const polygons = new Map();
  let svgRoot = _activeFloorKey === floorPlan.key ? _activeInlineSvg : null;
  let temporaryHost = null;
    if (!svgRoot && typeof DOMParser !== 'undefined' && typeof document !== 'undefined' &&
      typeof document.createElement === 'function' &&
      typeof _extractInlineSvgMarkup === 'function' && typeof _sanitizeInlineSvg === 'function') {
    const markup = _extractInlineSvgMarkup(floorPlan.svgRaw);
    svgRoot = markup ? _sanitizeInlineSvg(markup) : null;
    if (svgRoot) {
      temporaryHost = document.createElement('div');
      temporaryHost.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
      temporaryHost.appendChild(svgRoot);
      document.body.appendChild(temporaryHost);
    }
  }
  if (!svgRoot) return polygons;
  const drawing = _svgDrawingBounds(svgRoot);
  if (!drawing?.width || !drawing?.height) {
    temporaryHost?.remove();
    return polygons;
  }

  const spacesByIdentifier = new Map();
  db.spaces.forEach(space => {
    if ((space._facility || '') !== floorPlan.facility) return;
    if (_cobieField(space, 'floorName').toLowerCase() !== floorPlan.name.toLowerCase()) return;
    const name = f(space, 'Name').trim().toLowerCase();
    const number = _viewer3dSpaceRoomNumber(space).trim().toLowerCase();
    [name, number].filter(Boolean).forEach(identifier => spacesByIdentifier.set(identifier, { name, number }));
  });

  const rootMatrix = typeof svgRoot.getCTM === 'function' ? svgRoot.getCTM() : null;
  svgRoot.querySelectorAll('[id]').forEach(node => {
    const identifier = String(node.id || '').trim().toLowerCase();
    const room = spacesByIdentifier.get(identifier);
    if (!room) return;
    const points = _viewer3dClosedSvgPoints(node);
    const matrix = typeof node.getCTM === 'function' ? node.getCTM() : null;
    if (!points?.length || !matrix) return;
    const worldPoints = points.map(point => {
      const rootPoint = _viewer3dSvgRootPoint(point, matrix, rootMatrix);
      if (!rootPoint) return null;
      const svgU = (rootPoint.x - drawing.x) / drawing.width;
      const svgV = (rootPoint.y - drawing.y) / drawing.height;
      const floorUv = _svgUvToFloorUv(svgU, svgV, floorPlan.alignment);
      return _roomUvToWorldXZ(floorPlan.bounds, floorUv.u, floorUv.v, false);
    }).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.z));
    if (worldPoints.length < 3) return;
    const area = Math.abs(worldPoints.reduce((sum, point, index) => {
      const next = worldPoints[(index + 1) % worldPoints.length];
      return sum + (point.x * next.z) - (next.x * point.z);
    }, 0) / 2);
    if (area < 1) return;
    [room.name, room.number].filter(Boolean).forEach(key => polygons.set(key, worldPoints));
  });
  temporaryHost?.remove();
  _viewer3dRoomPolygonCache.set(cacheKey, polygons);
  return polygons;
}

function _viewer3dFloorImage(floorPlan) {
  const cacheKey = floorPlan.key + '::' + floorPlan.svgRaw;
  const cached = _viewer3dFloorImageCache.get(cacheKey);
  if (cached) return cached;

  const entry = { image:null, loaded:false };
  const markup = typeof _extractInlineSvgMarkup === 'function'
    ? _extractInlineSvgMarkup(floorPlan.svgRaw)
    : '';
  const cleanSvg = markup && typeof _sanitizeInlineSvg === 'function' ? _sanitizeInlineSvg(markup) : null;
  if (!cleanSvg) {
    _viewer3dFloorImageCache.set(cacheKey, entry);
    return entry;
  }

  const viewport = typeof _svgCanvasSizeForFlip === 'function' ? _svgCanvasSizeForFlip(cleanSvg) : null;
  if (viewport) {
    const rasterScale = Math.min(1, 1600 / Math.max(viewport.width, viewport.height));
    cleanSvg.setAttribute('width', String(Math.max(1, Math.round(viewport.width * rasterScale))));
    cleanSvg.setAttribute('height', String(Math.max(1, Math.round(viewport.height * rasterScale))));
  }

  const image = new Image();
  image.onload = () => {
    entry.loaded = true;
    _renderThreeDViewer();
  };
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(cleanSvg));
  entry.image = image;
  _viewer3dFloorImageCache.set(cacheKey, entry);
  return entry;
}

function _viewer3dDrawFloorTriangle(ctx, image, source, destination, width, height) {
  const xs = destination.map(point => point.x);
  const ys = destination.map(point => point.y);
  if (Math.max(...xs) < -2 || Math.min(...xs) > width + 2 || Math.max(...ys) < -2 || Math.min(...ys) > height + 2) return;

  const sourceMinX = Math.min(...source.map(point => point.x));
  const sourceMinY = Math.min(...source.map(point => point.y));
  const sourceMaxX = Math.max(...source.map(point => point.x));
  const sourceMaxY = Math.max(...source.map(point => point.y));
  const sourceWidth = sourceMaxX - sourceMinX;
  const sourceHeight = sourceMaxY - sourceMinY;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;
  const [sourceA, sourceB, sourceC] = source.map(point => ({
    x:point.x - sourceMinX,
    y:point.y - sourceMinY,
  }));
  const [destA, destB, destC] = destination;
  const determinant = sourceA.x * (sourceB.y - sourceC.y) +
    sourceB.x * (sourceC.y - sourceA.y) +
    sourceC.x * (sourceA.y - sourceB.y);
  if (Math.abs(determinant) < 1e-8) return;

  const matrixA = (destA.x * (sourceB.y - sourceC.y) + destB.x * (sourceC.y - sourceA.y) + destC.x * (sourceA.y - sourceB.y)) / determinant;
  const matrixB = (destA.y * (sourceB.y - sourceC.y) + destB.y * (sourceC.y - sourceA.y) + destC.y * (sourceA.y - sourceB.y)) / determinant;
  const matrixC = (destA.x * (sourceC.x - sourceB.x) + destB.x * (sourceA.x - sourceC.x) + destC.x * (sourceB.x - sourceA.x)) / determinant;
  const matrixD = (destA.y * (sourceC.x - sourceB.x) + destB.y * (sourceA.x - sourceC.x) + destC.y * (sourceB.x - sourceA.x)) / determinant;
  const matrixE = (destA.x * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) + destB.x * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) + destC.x * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) / determinant;
  const matrixF = (destA.y * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) + destB.y * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) + destC.y * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) / determinant;

  const centerX = (destA.x + destB.x + destC.x) / 3;
  const centerY = (destA.y + destB.y + destC.y) / 3;
  const clipPoints = destination.map(point => {
    const deltaX = point.x - centerX;
    const deltaY = point.y - centerY;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const expansion = (distance + 0.45) / distance;
    return { x:centerX + deltaX * expansion, y:centerY + deltaY * expansion };
  });

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clipPoints[0].x, clipPoints[0].y);
  ctx.lineTo(clipPoints[1].x, clipPoints[1].y);
  ctx.lineTo(clipPoints[2].x, clipPoints[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(matrixA, matrixB, matrixC, matrixD, matrixE, matrixF);
  ctx.drawImage(image, sourceMinX, sourceMinY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}

function _viewer3dDrawFloorPlan(ctx, floorPlan, center, scale, perspective, width, height, fovScale, rotX, rotY, panX, panY, elevation = floorPlan.bounds.y, opacity = 0.68) {
  const cached = _viewer3dFloorImage(floorPlan);
  const image = cached.image;
  if (!cached.loaded || !image?.naturalWidth || !image?.naturalHeight) return;

  const bounds = floorPlan.bounds;
  const projectUv = (svgU, svgV) => {
    const floorUv = _svgUvToFloorUv(svgU, svgV, floorPlan.alignment);
    const world = _roomUvToWorldXZ(bounds, floorUv.u, floorUv.v, false);
    return _viewer3dProjectAt(
      { x:world.x - center.x, y:elevation - center.y, z:world.z - center.z },
      scale, perspective, width, height, fovScale, rotX, rotY, panX, panY
    );
  };

  const projectedCorners = {
    topLeft:projectUv(0, 0),
    topRight:projectUv(1, 0),
    bottomLeft:projectUv(0, 1),
    bottomRight:projectUv(1, 1),
  };
  const bilinearPoint = (u, v) => ({
    x:(projectedCorners.topLeft.x * (1 - u) * (1 - v)) +
      (projectedCorners.topRight.x * u * (1 - v)) +
      (projectedCorners.bottomLeft.x * (1 - u) * v) +
      (projectedCorners.bottomRight.x * u * v),
    y:(projectedCorners.topLeft.y * (1 - u) * (1 - v)) +
      (projectedCorners.topRight.y * u * (1 - v)) +
      (projectedCorners.bottomLeft.y * (1 - u) * v) +
      (projectedCorners.bottomRight.y * u * v),
  });
  const perspectiveError = [
    [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
  ].reduce((maxError, [u, v]) => {
    const actual = projectUv(u, v);
    const affine = bilinearPoint(u, v);
    return Math.max(maxError, Math.hypot(actual.x - affine.x, actual.y - affine.y));
  }, 0);
  const divisions = _viewer3dClamp(Math.ceil(Math.sqrt(perspectiveError / 0.75)), 1, 8);
  _viewer3dFloorMeshDivisions = divisions;
  const sourceWidth = image.naturalWidth / divisions;
  const sourceHeight = image.naturalHeight / divisions;
  ctx.save();
  ctx.globalAlpha = opacity;
  for (let row = 0; row < divisions; row++) {
    for (let column = 0; column < divisions; column++) {
      const u0 = column / divisions;
      const v0 = row / divisions;
      const u1 = (column + 1) / divisions;
      const v1 = (row + 1) / divisions;
      const topLeft = projectUv(u0, v0);
      const topRight = projectUv(u1, v0);
      const bottomLeft = projectUv(u0, v1);
      const bottomRight = projectUv(u1, v1);
      const sourceX = column * sourceWidth;
      const sourceY = row * sourceHeight;
      const sourceTopLeft = { x:sourceX, y:sourceY };
      const sourceTopRight = { x:sourceX + sourceWidth, y:sourceY };
      const sourceBottomLeft = { x:sourceX, y:sourceY + sourceHeight };
      const sourceBottomRight = { x:sourceX + sourceWidth, y:sourceY + sourceHeight };
      _viewer3dDrawFloorTriangle(
        ctx,
        image,
        [sourceTopLeft, sourceTopRight, sourceBottomRight],
        [topLeft, topRight, bottomRight],
        width,
        height
      );
      _viewer3dDrawFloorTriangle(
        ctx,
        image,
        [sourceTopLeft, sourceBottomRight, sourceBottomLeft],
        [topLeft, bottomRight, bottomLeft],
        width,
        height
      );
    }
  }
  ctx.restore();
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
  selectedCategoryLevels.space.clear();
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
  const render = _viewer3dRenderSceneToCanvas(canvas, _viewer3dScene, {
    rotX: _viewer3dRotX,
    rotY: _viewer3dRotY,
    panX: _viewer3dPanX,
    panY: _viewer3dPanY,
    zoom: _viewer3dZoom,
  });
  _viewer3dHoverTargets = render?.hoverTargets || [];
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

function _viewer3dRefreshFloorControl(els) {
  if (!els?.floorControl || !els.floorSelect) return;
  const floors = _viewer3dScene?.floorPlans || [];
  const hasSvg = floors.some(entry => entry.svgRaw && entry.bounds);
  els.floorControl.classList.toggle('d-none', !hasSvg);
  if (!hasSvg) {
    _viewer3dFloorKey = '';
    els.floorSelect.innerHTML = '<option value="">Floor plan…</option>';
    return;
  }

  if (_viewer3dFloorKey && !floors.some(entry => entry.key === _viewer3dFloorKey && entry.svgRaw && entry.bounds)) {
    _viewer3dFloorKey = '';
  }
  els.floorSelect.innerHTML = '<option value="">Floor plan…</option>' + floors.map(entry => {
    const available = !!(entry.svgRaw && entry.bounds);
    const facility = db.facilities.length > 1 && entry.facility ? ` - ${entry.facility}` : '';
    return `<option value="${esc(entry.key)}"${available ? '' : ' disabled'}>${esc(entry.name + facility)}${available ? '' : ' (No SVG)'}</option>`;
  }).join('');
  els.floorSelect.value = _viewer3dFloorKey;
}

function _viewer3dOpenFloorInPlanView(floorKey) {
  if (!floorKey || typeof refreshFloorSvgPanel !== 'function') return;
  _expandedFloorKey = floorKey;
  _floorSvgCollapsed = false;
  refreshFloorSvgPanel(_lastFilteredComps || [], _lastFloorCounts || {});
}

function _viewer3dResetView() {
  _viewer3dRotX = -0.55;
  _viewer3dRotY = 0.7;
  _viewer3dPanX = 0;
  _viewer3dPanY = 0;
  _viewer3dZoom = 1;
  _viewer3dTooltipHide();
  _renderThreeDViewer();
}

function _bindThreeDFloorControl(els) {
  if (!els?.floorSelect || els.floorSelect.dataset.bound === '1') return;
  els.floorSelect.dataset.bound = '1';
  els.floorSelect.addEventListener('change', () => {
    _viewer3dFloorKey = els.floorSelect.value;
    _viewer3dHoverTargets = [];
    _viewer3dSetCanvasTooltip(els.canvas, '');
    _viewer3dTooltipHide();
    _viewer3dOpenFloorInPlanView(_viewer3dFloorKey);
    _renderThreeDViewer();
  });
  els.resetView?.addEventListener('click', _viewer3dResetView);
}

function initThreeDViewerPanel() {
  const els = _viewer3dElements();
  if (!els.panel || !els.edgeToggle || !els.canvas) return;
  _viewer3dSetWidth(els, _viewer3dDesiredWidth());
  _bindThreeDPanelToggle(els);
  _bindThreeDCanvas(els);
  _bindThreeDFloorControl(els);
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
  _viewer3dRefreshFloorControl(els);
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
  _viewer3dFloorKey = '';
  _viewer3dFloorImageCache.clear();
  _viewer3dRoomPolygonCache.clear();
  _viewer3dRoomGeometryCache.clear();
  _viewer3dRoomGeometryCacheReady = false;
  if (els.canvas) els.canvas.title = '';
  _viewer3dRefreshFloorControl(els);
  _viewer3dTooltipHide();
  _viewer3dSetEmpty(els, '');
}

initThreeDViewerPanel();