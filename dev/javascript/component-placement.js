// ── Component placement helper ────────────────────────────────
let _componentPlacementDraft = null;
let _componentPlacementMode = '';
let _componentPlacementReturnModalId = '';
let _componentPlacementPreviewZoom = 1;
let _componentPlacementPreviewRotX = -0.55;
let _componentPlacementPreviewRotY = 0.7;
let _componentPlacementPreviewPanX = 0;
let _componentPlacementPreviewPanY = 0;
let _componentPlacementPreviewSceneCache = null;
let _componentPlacementFloorKey = '';
let _componentPlacementSvgZoom = 1;
let _componentPlacementSvgPanX = 0;
let _componentPlacementSvgPanY = 0;
let _componentPlacementSvgBaseWidth = 0;
let _componentPlacementSvgBaseHeight = 0;
let _componentPlacementSvgDragging = false;
let _componentPlacementSuppressClick = false;
let _componentPlacementRefreshInfo = false;

function _componentPlacementClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function _componentPlacementModalElements() {
  return {
    modal: document.getElementById('component-placement-modal'),
    floor: document.getElementById('component-placement-floor'),
    height: document.getElementById('component-placement-height'),
    heightSlider: document.getElementById('component-placement-height-slider'),
    stage: document.getElementById('component-placement-stage'),
    preview: document.getElementById('component-placement-preview'),
    previewCanvas: document.getElementById('component-placement-preview-canvas'),
    status: document.getElementById('component-placement-status'),
    apply: document.querySelector('#component-placement-modal [data-component-placement-apply]'),
  };
}

function _componentPlacementFacility() {
  return String(_projectModalContext?.facility || _projectModalContext?.row?._facility || '');
}

function _componentPlacementActiveSpace() {
  return f(_projectModalContext?.row, 'Space').trim();
}

function _componentPlacementActiveName() {
  return f(_projectModalContext?.row, 'Name').trim();
}

function _componentPlacementFloors() {
  const facility = _componentPlacementFacility();
  const svgByKey = _collectFloorSvgByKey();
  return _allFloorEntries().filter(entry => (!facility || entry.facility === facility) && svgByKey[entry.key]);
}

function _componentPlacementFloorForSpace(spaceName) {
  const facility = _componentPlacementFacility();
  if (!spaceName) return null;
  const spaceRow = db.spaces.find(space =>
    f(space, 'Name').toLowerCase() === spaceName.toLowerCase() &&
    (!facility || (space._facility || '') === facility)
  );
  if (!spaceRow) return null;
  const floorName = _cobieField(spaceRow, 'floorName').toLowerCase();
  if (!floorName) return null;
  return _componentPlacementFloors().find(entry => entry.name.toLowerCase() === floorName) || null;
}

function _componentPlacementInitialFloor() {
  return _componentPlacementFloorForSpace(_componentPlacementActiveSpace()) || _componentPlacementFloors()[0] || null;
}

function _componentPlacementSyncHeight(value, source = '') {
  const els = _componentPlacementModalElements();
  const height = Math.max(0, Number(value) || 0);
  if (source !== 'number' && els.height) els.height.value = String(height);
  if (els.heightSlider) {
    const sliderMax = Math.max(10000, Math.ceil(height / 1000) * 1000);
    els.heightSlider.max = String(sliderMax);
    els.heightSlider.value = String(height);
  }
  if (!_componentPlacementDraft?.spaceName) return height;
  _componentPlacementDraft.height = height;
  const floorEntry = _componentPlacementFloors().find(entry => entry.key === els.floor?.value) || _componentPlacementInitialFloor() || null;
  _componentPlacementPreviewDraw(els.previewCanvas, _componentPlacementDraft, floorEntry);
  return height;
}

function _componentPlacementPointFromEvent(svgRoot, clientX, clientY) {
  if (!svgRoot || typeof svgRoot.getScreenCTM !== 'function' || !svgRoot.getScreenCTM()) return null;
  if (typeof svgRoot.createSVGPoint !== 'function') return null;
  const point = svgRoot.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(svgRoot.getScreenCTM().inverse());
}

function _componentPlacementResetSvgView() {
  _componentPlacementSvgZoom = 1;
  _componentPlacementSvgPanX = 0;
  _componentPlacementSvgPanY = 0;
  _componentPlacementSvgBaseWidth = 0;
  _componentPlacementSvgBaseHeight = 0;
}

function _componentPlacementApplySvgView(viewport, svgRoot) {
  if (!viewport || !svgRoot) return;
  if (!_componentPlacementSvgBaseWidth || !_componentPlacementSvgBaseHeight) {
    const size = _svgNaturalSize(svgRoot, viewport);
    _componentPlacementSvgBaseWidth = size.w;
    _componentPlacementSvgBaseHeight = size.h;
  }
  _componentPlacementSvgZoom = Math.max(0.2, Math.min(8, _componentPlacementSvgZoom));
  svgRoot.style.width = Math.max(100, Math.round(_componentPlacementSvgBaseWidth)) + 'px';
  svgRoot.style.height = Math.max(60, Math.round(_componentPlacementSvgBaseHeight)) + 'px';
  svgRoot.style.transformOrigin = '0 0';
  svgRoot.style.transform = `translate(${_componentPlacementSvgPanX}px, ${_componentPlacementSvgPanY}px) scale(${_componentPlacementSvgZoom})`;
}

function _componentPlacementFitSvg(viewport, svgRoot) {
  if (!viewport || !svgRoot) return;
  const size = _svgNaturalSize(svgRoot, viewport);
  _componentPlacementSvgBaseWidth = size.w;
  _componentPlacementSvgBaseHeight = size.h;
  const fitZoom = Math.min(
    Math.max(80, viewport.clientWidth * 0.92) / Math.max(1, size.w),
    Math.max(80, viewport.clientHeight * 0.92) / Math.max(1, size.h),
  );
  _componentPlacementSvgZoom = Math.max(0.2, Math.min(8, fitZoom || 1));
  _componentPlacementSvgPanX = Math.round((viewport.clientWidth - size.w * _componentPlacementSvgZoom) / 2);
  _componentPlacementSvgPanY = Math.round((viewport.clientHeight - size.h * _componentPlacementSvgZoom) / 2);
  _componentPlacementApplySvgView(viewport, svgRoot);
}

function _componentPlacementFocusPosition(viewport, svgRoot, placement) {
  if (!viewport || !svgRoot || !placement?.existingPosition) return false;
  if (!_componentPlacementSvgBaseWidth || !_componentPlacementSvgBaseHeight) {
    _componentPlacementFitSvg(viewport, svgRoot);
  }
  const marker = svgRoot.querySelector('[data-component-placement-marker]');
  const markerRect = marker?.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  if (!markerRect?.width || !viewportRect.width || !viewportRect.height) return false;
  const markerX = markerRect.left + (markerRect.width / 2) - viewportRect.left;
  const markerY = markerRect.top + (markerRect.height / 2) - viewportRect.top;
  const oldZoom = _componentPlacementSvgZoom;
  const nextZoom = Math.min(8, oldZoom * 2.2);
  const worldX = (markerX - _componentPlacementSvgPanX) / oldZoom;
  const worldY = (markerY - _componentPlacementSvgPanY) / oldZoom;
  _componentPlacementSvgZoom = nextZoom;
  _componentPlacementSvgPanX = (viewport.clientWidth / 2) - (worldX * nextZoom);
  _componentPlacementSvgPanY = (viewport.clientHeight / 2) - (worldY * nextZoom);
  _componentPlacementApplySvgView(viewport, svgRoot);
  return true;
}

function _componentPlacementZoomSvgAtCursor(viewport, svgRoot, clientX, clientY, factor) {
  if (!viewport || !svgRoot) return;
  const rect = viewport.getBoundingClientRect();
  const anchorX = clientX - rect.left;
  const anchorY = clientY - rect.top;
  const oldZoom = _componentPlacementSvgZoom;
  const nextZoom = Math.max(0.2, Math.min(8, oldZoom * factor));
  if (Math.abs(nextZoom - oldZoom) < 0.0001) return;
  const worldX = (anchorX - _componentPlacementSvgPanX) / oldZoom;
  const worldY = (anchorY - _componentPlacementSvgPanY) / oldZoom;
  _componentPlacementSvgPanX = anchorX - worldX * nextZoom;
  _componentPlacementSvgPanY = anchorY - worldY * nextZoom;
  _componentPlacementSvgZoom = nextZoom;
  _componentPlacementApplySvgView(viewport, svgRoot);
}

function _componentPlacementMarkerCoordinate(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return _finiteNumber(value, fallback);
}

function _componentPlacementDrawMarker(svgRoot, placement) {
  svgRoot?.querySelector('[data-component-placement-marker]')?.remove();
  if (!svgRoot || !placement?.spaceName) return null;
  const drawing = _svgDrawingBounds(svgRoot);
  if (!drawing?.width || !drawing?.height) return null;
  const markerX = _componentPlacementMarkerCoordinate(
    placement.markerX,
    drawing.x + (_unitInterval(placement.floorU ?? placement.roomU) * drawing.width),
  );
  const markerY = _componentPlacementMarkerCoordinate(
    placement.markerY,
    drawing.y + (_unitInterval(placement.floorV ?? placement.roomV) * drawing.height),
  );
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  marker.setAttribute('data-component-placement-marker', '');
  marker.setAttribute('class', 'component-placement-marker');
  marker.setAttribute('cx', String(markerX));
  marker.setAttribute('cy', String(markerY));
  marker.setAttribute('r', String(Math.max(4, Math.min(drawing.width, drawing.height) * 0.009)));
  marker.setAttribute('vector-effect', 'non-scaling-stroke');
  marker.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(marker);
  return marker;
}

function _componentPlacementSpaceBounds(spaceRow, coordIndex = null) {
  const index = coordIndex || (typeof _viewer3dCoordIndex === 'function' ? _viewer3dCoordIndex() : null);
  if (!index || !spaceRow) return null;
  const coord = _viewer3dCoordFor(index, 'space', spaceRow._facility, f(spaceRow, 'Name'));
  const bounds = typeof _viewer3dBounds === 'function' ? _viewer3dBounds(coord, 2400) : null;
  return bounds?.hasCorners ? bounds : null;
}

function _componentPlacementFloorBounds(floorEntry, coordIndex = null) {
  if (!floorEntry) return null;
  const index = coordIndex || (typeof _viewer3dCoordIndex === 'function' ? _viewer3dCoordIndex() : null);
  if (!index) return null;
  const bounds = db.spaces
    .filter(space =>
      (space._facility || '') === (floorEntry.facility || '') &&
      _cobieField(space, 'floorName').toLowerCase() === floorEntry.name.toLowerCase()
    )
    .map(space => _componentPlacementSpaceBounds(space, index))
    .filter(Boolean);
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map(entry => entry.minX));
  const maxX = Math.max(...bounds.map(entry => entry.maxX));
  const minY = Math.min(...bounds.map(entry => entry.minY));
  const maxY = Math.max(...bounds.map(entry => entry.maxY));
  const minZ = Math.min(...bounds.map(entry => entry.minZ));
  const maxZ = Math.max(...bounds.map(entry => entry.maxZ));
  return {
    minX, maxX, minY, maxY, minZ, maxZ,
    sizeX:Math.max(1, maxX - minX),
    sizeY:Math.max(1, maxY - minY),
    sizeZ:Math.max(1, maxZ - minZ),
  };
}

function _componentPlacementPreviewSceneKey(placement, floorEntry) {
  if (!placement?.spaceName || !floorEntry) return '';
  const alignment = _resolvedFloorAlignmentForEntry(floorEntry);
  return [
    placement.facility || '',
    floorEntry.key || '',
    String(placement.spaceName || '').toLowerCase(),
    String(placement.height || 0),
    String(placement.floorU ?? placement.roomU ?? 0.5),
    String(placement.floorV ?? placement.roomV ?? 0.5),
    String(alignment.rotation || 0),
    alignment.flipHorizontal ? '1' : '0',
    alignment.flipVertical ? '1' : '0',
    String(alignment.originXPct ?? 0.5),
    String(alignment.originYPct ?? 0.5),
  ].join('|');
}

function _componentPlacementResolveFloorUV(placement, floorEntry) {
  const floorU = _finiteNumber(placement?.floorU ?? placement?.roomU);
  const floorV = _finiteNumber(placement?.floorV ?? placement?.roomV);
  const alignment = _resolvedFloorAlignmentForEntry(floorEntry);
  return _svgUvToFloorUv(floorU, floorV, alignment);
}

function _componentPlacementGeometry(spaceBounds, floorBounds, placement, floorEntry) {
  if (!spaceBounds || !floorBounds) return null;
  const resolved = _componentPlacementResolveFloorUV(placement, floorEntry);
  const worldPoint = _roomUvToWorldXZ(floorBounds, resolved.u, resolved.v, false);
  if (!worldPoint) return null;
  const requestedFootprint = Math.max(100, Math.min(600, Math.round(Math.min(spaceBounds.sizeX, spaceBounds.sizeZ) * 0.08) || 100));
  const footprint = Math.max(1, Math.min(requestedFootprint, spaceBounds.sizeX, spaceBounds.sizeZ));
  const heightAboveFloor = Math.max(0, Number(placement?.height ?? 0) || 0);
  const bottomY = spaceBounds.minY + heightAboveFloor;
  if (bottomY >= spaceBounds.maxY) return null;
  const sizeY = Math.max(1, Math.min(footprint, spaceBounds.maxY - bottomY));
  return {
    centerX:worldPoint.x,
    centerY:bottomY + (sizeY / 2),
    centerZ:worldPoint.z,
    minX:worldPoint.x - (footprint / 2),
    maxX:worldPoint.x + (footprint / 2),
    minY:bottomY,
    maxY:bottomY + sizeY,
    minZ:worldPoint.z - (footprint / 2),
    maxZ:worldPoint.z + (footprint / 2),
    sizeX:footprint,
    sizeY,
    sizeZ:footprint,
  };
}

function _componentPlacementSceneData(placement, floorEntry) {
  if (!placement?.spaceName || !floorEntry) return null;
  const cacheKey = _componentPlacementPreviewSceneKey(placement, floorEntry);
  if (_componentPlacementPreviewSceneCache?.key === cacheKey) return _componentPlacementPreviewSceneCache.value;
  const coordIndex = typeof _viewer3dCoordIndex === 'function' ? _viewer3dCoordIndex() : null;
  if (!coordIndex) return null;

  const facility = placement.facility || '';
  const floorName = String(floorEntry.name || '').toLowerCase();
  const spaceRows = db.spaces.filter(space => {
    if ((space._facility || '') !== facility) return false;
    return _cobieField(space, 'floorName').toLowerCase() === floorName;
  });
  const roomName = String(placement.spaceName || '').toLowerCase();
  const roomRow = spaceRows.find(space => f(space, 'Name').toLowerCase() === roomName) || null;
  const roomBounds = _componentPlacementSpaceBounds(roomRow, coordIndex);
  const floorBounds = _componentPlacementFloorBounds(floorEntry, coordIndex);
  if (!roomBounds || !floorBounds) return null;

  const geometry = _componentPlacementGeometry(roomBounds, floorBounds, placement, floorEntry);
  if (!geometry) return null;

  const comp = {
    x: geometry.centerX,
    y: geometry.centerY,
    z: geometry.centerZ,
    sizeX: geometry.sizeX,
    sizeY: geometry.sizeY,
    sizeZ: geometry.sizeZ,
  };

  const roomObjects = spaceRows.map(space => {
    const bounds = _componentPlacementSpaceBounds(space, coordIndex);
    if (!bounds) return null;
    const isSelected = f(space, 'Name').toLowerCase() === roomName;
    return {
      bounds,
      type: 'cube',
      x: bounds.centerX,
      y: bounds.centerY,
      z: bounds.centerZ,
      sizeX: bounds.sizeX,
      sizeY: bounds.sizeY,
      sizeZ: bounds.sizeZ,
      color: 'wire',
      fillColor: isSelected ? 'brand' : 'wire',
      fillAlpha: isSelected ? 0.24 : 0.08,
      alphaMul: isSelected ? 1 : 0.35,
      lineWidth: isSelected ? 1.4 : 1,
      tooltip: f(space, 'Name'),
      spaceKey: f(space, 'Name').toLowerCase(),
    };
  }).filter(Boolean);

  const componentObject = {
    type: 'cube',
    x: comp.x,
    y: comp.y,
    z: comp.z,
    sizeX: comp.sizeX,
    sizeY: comp.sizeY,
    sizeZ: comp.sizeZ,
    color: 'element',
    fillColor: 'element',
    fillAlpha: 0.18,
    alphaMul: 1,
    lineWidth: 1.4,
  };

  const compPoints = [
    { x: comp.x - comp.sizeX / 2, y: comp.y - comp.sizeY / 2, z: comp.z - comp.sizeZ / 2 },
    { x: comp.x + comp.sizeX / 2, y: comp.y + comp.sizeY / 2, z: comp.z + comp.sizeZ / 2 },
  ];

  const sceneBounds = [
    ...roomObjects.map(object => object.bounds).filter(Boolean),
    {
    minX: comp.x - (comp.sizeX / 2),
    maxX: comp.x + (comp.sizeX / 2),
    minY: comp.y - (comp.sizeY / 2),
    maxY: comp.y + (comp.sizeY / 2),
    minZ: comp.z - (comp.sizeZ / 2),
    maxZ: comp.z + (comp.sizeZ / 2),
    },
  ];
  const scenePoints = sceneBounds
    .flatMap(boundsEntry => ([
      { x: boundsEntry.minX, y: boundsEntry.minY, z: boundsEntry.minZ },
      { x: boundsEntry.maxX, y: boundsEntry.maxY, z: boundsEntry.maxZ },
    ]));
  const value = {
    roomRow,
    roomBounds,
    comp,
    scene: {
      objects: [...roomObjects, componentObject],
      points: scenePoints,
      focusPoints: [
        { x: roomBounds.minX, y: roomBounds.minY, z: roomBounds.minZ },
        { x: roomBounds.maxX, y: roomBounds.maxY, z: roomBounds.maxZ },
        ...compPoints,
      ],
    },
  };

  _componentPlacementPreviewSceneCache = { key: cacheKey, value };
  return value;
}

function _componentPlacementPreviewDraw(canvas, placement, floorEntry) {
  if (!canvas) return;
  const scene = _componentPlacementSceneData(placement, floorEntry);
  if (!scene?.scene || !placement?.spaceName || !floorEntry) {
    const parent = canvas?.parentElement;
    const width = Math.max(320, Math.round(parent?.clientWidth || canvas?.clientWidth || 320));
    const height = Math.max(320, Math.round(parent?.clientHeight || canvas?.clientHeight || 320));
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(50,50,50,.08)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.fillStyle = 'rgba(50,50,50,.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText(!placement?.spaceName ? 'Select a room to preview the placement.' : 'No room coordinates available for preview.', 18, 28);
    return;
  }

  const zoom = _viewer3dClamp(Number(_componentPlacementPreviewZoom || 1) || 1, 0.3, 80);
  _viewer3dRenderSceneToCanvas(canvas, scene.scene, {
    rotX: _componentPlacementPreviewRotX,
    rotY: _componentPlacementPreviewRotY,
    panX: _componentPlacementPreviewPanX,
    panY: _componentPlacementPreviewPanY,
    zoom,
    minSpan: 500,
    minPerspective: 180,
    scaleFactor: 0.82,
    background: '#fff',
  });

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(50,50,50,.74)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${placement.spaceName} • ${Math.round(Number(placement.height || 0))} above floor`, 16, 24);
  }
}

function _componentPlacementRender() {
  const els = _componentPlacementModalElements();
  if (!els.modal || !els.stage || !els.floor || !els.height || !els.preview) return;

  const floors = _componentPlacementFloors();
  const requestedFloorKey = _componentPlacementFloorKey || _componentPlacementDraft?.floorKey || els.floor.value || _componentPlacementInitialFloor()?.key || '';
  els.floor.innerHTML = floors.map(entry => `<option value="${esc(entry.key)}">${esc(_floorLabel(entry))}</option>`).join('');

  const initialFloor = _componentPlacementInitialFloor();
  const requestedFloor = floors.find(entry => entry.key === requestedFloorKey) || initialFloor || floors[0] || null;
  if (requestedFloor) els.floor.value = requestedFloor.key;
  _componentPlacementFloorKey = requestedFloor?.key || '';

  els.height.value = String(_componentPlacementDraft?.height ?? els.height.value ?? 1000);
  _componentPlacementSyncHeight(els.height.value, 'number');

  const floorEntry = requestedFloor;
  const svgByKey = _collectFloorSvgByKey();
  const svgRaw = floorEntry ? (svgByKey[floorEntry.key] || '') : '';
  els.stage.innerHTML = `<div class="svg-floor-viewport component-placement-viewport" style="min-height:460px;max-height:65vh"><div class="component-placement-canvas"></div></div>`;
  const viewport = els.stage.querySelector('.component-placement-viewport');
  const canvas = els.stage.querySelector('.component-placement-canvas');
  if (els.apply) els.apply.disabled = true;

  if (!floorEntry) {
    els.status.textContent = 'No floor SVGs are available for this facility.';
    _componentPlacementPreviewDraw(els.previewCanvas, null, null);
    return;
  }

  if (!svgRaw) {
    els.status.textContent = `No SVG found for ${_floorLabel(floorEntry)}.`;
    canvas.innerHTML = '<div class="text-muted small p-2">Load an SVG for this floor first.</div>';
    _componentPlacementPreviewDraw(els.previewCanvas, null, floorEntry);
    return;
  }

  const inline = _extractInlineSvgMarkup(svgRaw);
  const cleanSvg = _sanitizeInlineSvg(inline);
  if (!cleanSvg) {
    els.status.textContent = 'Invalid SVG markup for this floor.';
    canvas.innerHTML = '<div class="text-muted small p-2">Invalid SVG source.</div>';
    _componentPlacementPreviewDraw(els.previewCanvas, null, floorEntry);
    return;
  }

  cleanSvg.style.width = '100%';
  cleanSvg.style.height = 'auto';
  cleanSvg.style.display = 'block';
  cleanSvg.style.pointerEvents = 'auto';
  cleanSvg.style.maxWidth = 'none';
  canvas.innerHTML = '';
  canvas.appendChild(cleanSvg);
  _applySvgRoomTooltips(cleanSvg, floorEntry);
  _componentPlacementDrawMarker(cleanSvg, _componentPlacementDraft);
  if (!_componentPlacementSvgBaseWidth || !_componentPlacementSvgBaseHeight) _componentPlacementFitSvg(viewport, cleanSvg);
  else _componentPlacementApplySvgView(viewport, cleanSvg);

  _componentPlacementPreviewDraw(els.previewCanvas, _componentPlacementDraft, floorEntry);

  els.status.textContent = _componentPlacementDraft?.existingPosition
    ? `Current saved position in ${_componentPlacementDraft.spaceName}`
    : _componentPlacementDraft?.spaceName
      ? `Selected room: ${_componentPlacementDraft.spaceName}`
    : 'Click a room on the SVG to choose the placement space.';
  if (els.apply) els.apply.disabled = !_componentPlacementDraft?.spaceName;
}

function _componentPlacementSelectRoom(event) {
  const els = _componentPlacementModalElements();
  if (!els.modal || !els.modal.classList.contains('show')) return;
  const floorKey = els.floor?.value || '';
  const floorEntry = _componentPlacementFloors().find(entry => entry.key === floorKey) || null;
  if (!floorEntry) return;

  const svgRoot = event.target.closest('svg');
  if (!svgRoot) return;
  const facility = _componentPlacementFacility();
  const spacesByName = new Map(db.spaces.filter(space => {
    if (facility && (space._facility || '') !== facility) return false;
    if (_cobieField(space, 'floorName').toLowerCase() !== floorEntry.name.toLowerCase()) return false;
    return true;
  }).map(space => [f(space, 'Name').toLowerCase(), space]));
  let roomNode = event.target.closest('[id]');
  while (roomNode && roomNode !== svgRoot && !spacesByName.has(String(roomNode.id || '').trim().toLowerCase())) {
    roomNode = roomNode.parentElement?.closest('[id]') || null;
  }
  const roomKey = String(roomNode?.id || '').trim().toLowerCase();
  const spaceRow = spacesByName.get(roomKey) || null;
  if (!spaceRow) return;

  const rootPoint = _componentPlacementPointFromEvent(svgRoot, event.clientX, event.clientY);
  const rootBounds = _svgDrawingBounds(svgRoot);
  const roomBounds = _componentPlacementSpaceBounds(spaceRow);
  if (!rootPoint || !rootBounds?.width || !rootBounds?.height || !roomBounds) {
    els.status.textContent = !roomBounds
      ? `No valid Space coordinates are available for ${f(spaceRow, 'Name')}.`
      : 'Could not resolve that point in the floor SVG.';
    return;
  }
  const floorU = (rootPoint.x - rootBounds.x) / rootBounds.width;
  const floorV = (rootPoint.y - rootBounds.y) / rootBounds.height;

  _componentPlacementDraft = {
    facility,
    spaceName: f(spaceRow, 'Name'),
    floorName: floorEntry.name,
    floorKey: floorEntry.key,
    roomKey,
    floorU,
    floorV,
    markerX: rootPoint?.x ?? 0,
    markerY: rootPoint?.y ?? 0,
    height: Number(els.height.value || 0) || 0,
    roomBounds,
  };

  _componentPlacementRender();
}

function _componentPlacementRows(componentName, facility, placement) {
  const cleanName = String(componentName || '').trim();
  const cleanSpace = String(placement?.spaceName || '').trim();
  if (!cleanName || !cleanSpace) return [];
  const spaceRow = db.spaces.find(space =>
    f(space, 'Name').toLowerCase() === cleanSpace.toLowerCase() &&
    (!facility || (space._facility || '') === facility)
  );
  if (!spaceRow) return [];

  const bounds = _componentPlacementSpaceBounds(spaceRow);
  if (!bounds) return [];

  const floorEntry = _allFloorEntries().find(entry => entry.key === (placement?.floorKey || '')) || null;
  const floorBounds = _componentPlacementFloorBounds(floorEntry);
  const geometry = _componentPlacementGeometry(bounds, floorBounds, placement, floorEntry);
  if (!geometry) return [];

  const rowBase = (nameSuffix, rowName, worldPoint) => {
    const source = _coordinateWorldToSource(worldPoint);
    if (!source) return null;
    return {
      Name:nameSuffix,
      SheetName:'Component',
      RowName:rowName,
      CoordinateXAxis:String(source.x),
      CoordinateYAxis:String(source.y),
      CoordinateZAxis:String(source.z),
      CreatedBy:'',
      CreatedOn:new Date().toISOString().slice(0, 10),
      ExtSystem:'', ExtObject:'', ExtIdentifier:'',
      _facility:facility,
    };
  };

  return [
    rowBase('Coordinate', cleanName, { x:geometry.centerX, y:geometry.centerY, z:geometry.centerZ }),
    rowBase('Coordinate LowerLeft', `${cleanName}_lowerleft`, { x:geometry.minX, y:geometry.minY, z:geometry.maxZ }),
    rowBase('Coordinate UpperRight', `${cleanName}_upperright`, { x:geometry.maxX, y:geometry.maxY, z:geometry.minZ }),
  ].filter(Boolean);
}

function _componentCoordinateRowBelongsTo(row, componentName) {
  const parts = typeof _viewer3dCoordKeyParts === 'function' ? _viewer3dCoordKeyParts(row) : null;
  return !!parts?.baseName && parts.baseName.toLowerCase() === String(componentName || '').trim().toLowerCase();
}

function _removeComponentCoordinateRows(facility, componentName) {
  const cleanName = String(componentName || '').trim();
  if (!cleanName) return 0;
  const attrs = db.coordinates || [];
  let removed = 0;
  for (let i = attrs.length - 1; i >= 0; i--) {
    const row = attrs[i];
    if ((row._facility || '') !== facility) continue;
    if (_cobieField(row, 'sheetName').toLowerCase() !== 'component') continue;
    if (!_componentCoordinateRowBelongsTo(row, cleanName)) continue;
    attrs.splice(i, 1);
    removed++;
  }
  if (removed && typeof _viewer3dInvalidateCoordIndex === 'function') _viewer3dInvalidateCoordIndex();
  return removed;
}

function _renameComponentCoordinateRows(facility, oldName, newName) {
  const oldClean = String(oldName || '').trim();
  const newClean = String(newName || '').trim();
  if (!oldClean || !newClean || oldClean.toLowerCase() === newClean.toLowerCase()) return 0;
  const attrs = db.coordinates || [];
  let renamed = 0;
  attrs.forEach(row => {
    if ((row._facility || '') !== facility) return;
    if (_cobieField(row, 'sheetName').toLowerCase() !== 'component') return;
    const rowName = _cobieField(row, 'rowName');
    if (!rowName) return;
    if (!_componentCoordinateRowBelongsTo(row, oldClean)) return;
    const parts = _viewer3dCoordKeyParts(row);
    if (!parts.cornerName) {
      row.RowName = newClean;
      renamed++;
      return;
    }
    row.RowName = `${newClean}_${parts.cornerName}`;
    renamed++;
  });
  if (renamed && typeof _viewer3dInvalidateCoordIndex === 'function') _viewer3dInvalidateCoordIndex();
  return renamed;
}

function _writeComponentCoordinates(facility, componentName, placement) {
  const cleanName = String(componentName || '').trim();
  if (!cleanName || !placement?.spaceName) return false;
  const rows = _componentPlacementRows(cleanName, facility, placement);
  if (!rows.length) return false;
  _removeComponentCoordinateRows(facility, cleanName);
  rows.forEach(row => db.coordinates.push(row));
  if (typeof _viewer3dInvalidateCoordIndex === 'function') _viewer3dInvalidateCoordIndex();
  _logChange('coordinate', cleanName, facility || '');
  return true;
}

function _componentPlacementDraftFromCoordinates() {
  if (_componentPlacementMode !== 'info' || _projectModalContext?.entityType !== 'component') return null;
  const facility = _componentPlacementFacility();
  const componentName = _componentPlacementActiveName();
  const spaceName = _componentPlacementActiveSpace();
  const floorEntry = _componentPlacementFloorForSpace(spaceName);
  if (!componentName || !spaceName || !floorEntry) return null;
  const spaceRow = _findEntity(db.spaces, spaceName, facility);
  const coordIndex = _viewer3dCoordIndex();
  const spaceBounds = _componentPlacementSpaceBounds(spaceRow, coordIndex);
  const floorBounds = _componentPlacementFloorBounds(floorEntry, coordIndex);
  const componentCoord = _viewer3dCoordFor(coordIndex, 'component', facility, componentName);
  const componentBounds = _viewer3dBounds(componentCoord, 700);
  if (!spaceBounds || !floorBounds || !componentBounds) return null;
  const alignedUv = _worldXZToRoomUv(floorBounds, componentBounds.centerX, componentBounds.centerZ, false);
  const rawUv = _floorUvToSvgUv(alignedUv.u, alignedUv.v, _resolvedFloorAlignmentForEntry(floorEntry));
  const componentBottom = componentBounds.hasCorners ? componentBounds.minY : componentBounds.centerY;
  return {
    facility,
    spaceName:f(spaceRow, 'Name'),
    floorName:floorEntry.name,
    floorKey:floorEntry.key,
    roomKey:f(spaceRow, 'Name').toLowerCase(),
    floorU:rawUv.u,
    floorV:rawUv.v,
    height:Math.max(0, componentBottom - spaceBounds.minY),
    roomBounds:spaceBounds,
    existingPosition:true,
  };
}

function openComponentPlacementModal() {
  if (_projectModalContext?.entityType !== 'component') return;
  _componentPlacementMode = 'info';
  _componentPlacementPreviewZoom = 1;
  _componentPlacementPreviewRotX = -0.55;
  _componentPlacementPreviewRotY = 0.7;
  _componentPlacementPreviewPanX = 0;
  _componentPlacementPreviewPanY = 0;
  _componentPlacementPreviewSceneCache = null;
  _componentPlacementFloorKey = '';
  _componentPlacementResetSvgView();
  _componentPlacementReturnModalId = 'type-modal';
  const els = _componentPlacementModalElements();
  if (!els.modal) return;
  const sourceModal = document.getElementById(_componentPlacementReturnModalId);
  const showPlacement = () => {
    _componentPlacementDraft = _componentPlacementDraftFromCoordinates();
    bootstrap.Modal.getOrCreateInstance(els.modal).show();
  };
  if (sourceModal?.classList.contains('show')) {
    const sourceInstance = bootstrap.Modal.getInstance(sourceModal);
    if (sourceInstance) {
      if (typeof _projectOpeningChildModal !== 'undefined') _projectOpeningChildModal = true;
      sourceModal.addEventListener('hidden.bs.modal', showPlacement, { once: true });
      sourceInstance.hide();
      return;
    }
  }
  showPlacement();
}

function initComponentPlacementModal() {
  const els = _componentPlacementModalElements();
  if (!els.modal || els.modal.dataset.bound === '1') return;
  els.modal.dataset.bound = '1';

  els.modal.addEventListener('shown.bs.modal', () => {
    _componentPlacementResetSvgView();
    _componentPlacementRender();
    requestAnimationFrame(() => {
      const viewport = els.stage?.querySelector('.component-placement-viewport');
      const svgRoot = viewport?.querySelector('svg');
      if (viewport && svgRoot) {
        _componentPlacementFitSvg(viewport, svgRoot);
        _componentPlacementFocusPosition(viewport, svgRoot, _componentPlacementDraft);
      }
    });
  });
  els.modal.addEventListener('hidden.bs.modal', () => {
    const completedMode = _componentPlacementMode;
    _componentPlacementMode = '';
    _componentPlacementDraft = null;
    _componentPlacementPreviewSceneCache = null;
    const returnModal = _componentPlacementReturnModalId ? document.getElementById(_componentPlacementReturnModalId) : null;
    _componentPlacementReturnModalId = '';
    if (typeof _projectOpeningChildModal !== 'undefined') _projectOpeningChildModal = false;
    if (completedMode === 'info' && _componentPlacementRefreshInfo && _typeModalViewContext?.kind === 'component') {
      const component = _findEntity(db.components, _typeModalViewContext.entityName, _typeModalViewContext.facility || '');
      if (component) document.getElementById('mtype-body').innerHTML = buildEntityInfoBody(
        'component', f(component, 'Name'), component._facility || '', component,
      );
    }
    _componentPlacementRefreshInfo = false;
    if (returnModal && !returnModal.classList.contains('show')) {
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(returnModal).show(), 0);
    }
  });
  els.modal.addEventListener('click', event => {
    const applyBtn = event.target.closest('[data-component-placement-apply]');
    if (applyBtn) {
      const current = _componentPlacementDraft;
      if (!current?.spaceName) {
        alert('Click a room in the SVG first.');
        return;
      }
      const height = Number(els.height?.value || 0);
      if (!Number.isFinite(height) || height < 0) {
        alert('Enter a valid height above floor.');
        return;
      }
      current.height = height;
      _componentPlacementDraft = current;
      const component = _projectModalContext?.row;
      const facility = _componentPlacementFacility();
      const componentName = f(component, 'Name');
      if (component && componentName) {
        _projectSetFieldValue(component, ['Space'], current.spaceName);
        _writeComponentCoordinates(facility, componentName, current);
        buildIdx();
        _projectSyncEntityChangeState('component', component, componentName, facility);
        _projectAssociationsChanged = true;
        _componentPlacementRefreshInfo = true;
      }
      bootstrap.Modal.getInstance(els.modal)?.hide();
      return;
    }
  });
  els.modal.addEventListener('change', event => {
    const floorSel = event.target.closest('[data-component-placement-floor]');
    if (floorSel) {
      _componentPlacementFloorKey = floorSel.value;
      _componentPlacementDraft = null;
      _componentPlacementPreviewSceneCache = null;
      _componentPlacementResetSvgView();
      _componentPlacementRender();
    }
  });
  els.height.addEventListener('input', () => _componentPlacementSyncHeight(els.height.value, 'number'));
  els.heightSlider?.addEventListener('input', () => _componentPlacementSyncHeight(els.heightSlider.value, 'slider'));
  els.previewCanvas?.addEventListener('wheel', event => {
    if (!_componentPlacementDraft?.spaceName) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1.18 : 0.85;
    _componentPlacementPreviewZoom = _viewer3dClamp(_componentPlacementPreviewZoom * step, 0.3, 80);
    const floorEntry = _componentPlacementFloors().find(entry => entry.key === els.floor?.value) || _componentPlacementInitialFloor() || null;
    _componentPlacementPreviewDraw(els.previewCanvas, _componentPlacementDraft, floorEntry);
  }, { passive: false });
  els.previewCanvas?.addEventListener('contextmenu', event => event.preventDefault());
  els.previewCanvas?.addEventListener('mousedown', event => {
    if (!_componentPlacementDraft?.spaceName) return;
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRotX = _componentPlacementPreviewRotX;
    const startRotY = _componentPlacementPreviewRotY;
    const startPanX = _componentPlacementPreviewPanX;
    const startPanY = _componentPlacementPreviewPanY;
    const mode = event.button === 1 ? 'rotate' : 'pan';
    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (mode === 'rotate') {
        _componentPlacementPreviewRotY = startRotY + dx * 0.01;
        _componentPlacementPreviewRotX = Math.max(-1.45, Math.min(1.45, startRotX - dy * 0.01));
      } else {
        _componentPlacementPreviewPanX = startPanX + dx;
        _componentPlacementPreviewPanY = startPanY + dy;
      }
      const floorEntry = _componentPlacementFloors().find(entry => entry.key === els.floor?.value) || _componentPlacementInitialFloor() || null;
      _componentPlacementPreviewDraw(els.previewCanvas, _componentPlacementDraft, floorEntry);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      els.previewCanvas.classList.remove('viewer3d-panning', 'viewer3d-rotating');
    };
    els.previewCanvas.classList.add(mode === 'rotate' ? 'viewer3d-rotating' : 'viewer3d-panning');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  els.modal.addEventListener('click', event => {
    const stage = event.target.closest('.component-placement-canvas');
    if (!stage) return;
    if (_componentPlacementSuppressClick) {
      _componentPlacementSuppressClick = false;
      return;
    }
    _componentPlacementSelectRoom(event);
  });
  els.stage.addEventListener('wheel', event => {
    const viewport = event.target.closest('.component-placement-viewport');
    const svgRoot = viewport?.querySelector('svg');
    if (!viewport || !svgRoot) return;
    event.preventDefault();
    _componentPlacementZoomSvgAtCursor(viewport, svgRoot, event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89);
  }, { passive:false });
  els.stage.addEventListener('mousedown', event => {
    const viewport = event.target.closest('.component-placement-viewport');
    const svgRoot = viewport?.querySelector('svg');
    if (event.button !== 0 || !viewport || !svgRoot) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = _componentPlacementSvgPanX;
    const startPanY = _componentPlacementSvgPanY;
    _componentPlacementSvgDragging = false;
    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!_componentPlacementSvgDragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) _componentPlacementSvgDragging = true;
      if (!_componentPlacementSvgDragging) return;
      _componentPlacementSvgPanX = startPanX + dx;
      _componentPlacementSvgPanY = startPanY + dy;
      _componentPlacementApplySvgView(viewport, svgRoot);
      viewport.style.cursor = 'grabbing';
      moveEvent.preventDefault();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _componentPlacementSuppressClick = _componentPlacementSvgDragging;
      _componentPlacementSvgDragging = false;
      viewport.style.cursor = 'grab';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
