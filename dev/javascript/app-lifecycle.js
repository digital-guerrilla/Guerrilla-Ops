// ── Workbook loading and session lifecycle ───────────────────
function _fileOperationProgress({ title, status, detail = '', percent = 0, icon = 'bi-file-earmark-arrow-down' }) {
  const host = document.getElementById('file-operation-progress');
  if (!host) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  host.innerHTML = `<div class="qa-run-progress file-operation-progress" role="status">
    <div class="qa-run-progress-head">
      <span class="qa-run-progress-title"><i class="bi ${esc(icon)}"></i> ${esc(title)}</span>
      <span class="qa-run-progress-percent">${value}%</span>
    </div>
    <div class="qa-run-progress-track" role="progressbar" aria-label="${esc(title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}">
      <span class="qa-run-progress-fill" style="width:${value}%"></span>
    </div>
    <div class="qa-run-progress-status">${esc(status)}</div>
    <div class="qa-run-progress-detail">${esc(detail)}</div>
  </div>`;
}

function _clearFileOperationProgress(delay = 0) {
  const clear = () => {
    const host = document.getElementById('file-operation-progress');
    if (host) host.replaceChildren();
  };
  if (delay) setTimeout(clear, delay);
  else clear();
}

function _yieldForFileProgress() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function readBuf(file, onProgress) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(file.name));
    r.onload  = ev => resolve(ev.target.result);
    r.onprogress = ev => {
      if (ev.lengthComputable && typeof onProgress === 'function') onProgress(ev.loaded / ev.total);
    };
    r.readAsArrayBuffer(file);
  });
}

async function openEditableFiles() {
  if (typeof globalThis.showOpenFilePicker !== 'function') {
    alert('Direct file updates require a current Chromium-based browser.');
    return;
  }
  try {
    const handles = await globalThis.showOpenFilePicker({
      multiple:true,
      types:[{ description:'Excel workbooks', accept:{
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']
      }}],
      excludeAcceptAllOption:true,
    });
    const files = [], handleMap = new Map();
    for (const handle of handles) {
      const file = await handle.getFile();
      files.push(file); handleMap.set(file, handle);
    }
    if (files.length) await loadFiles(files, handleMap);
  } catch (err) {
    if (err.name !== 'AbortError') alert('Could not open the selected workbook: ' + err.message);
  }
}

async function loadFiles(fileList, handleMap = new Map()) {
  if (!COBIE_SCHEMA_STATUS.loaded || !COBIE_RUNTIME_MODEL.entities.size) {
    alert(`The workbook cannot be loaded because the XML schema is unavailable or invalid.\n\n${COBIE_SCHEMA_STATUS.error || 'No schema sheets were found.'}`);
    return;
  }
  const files = [...fileList].filter(f => _excelRe.test(f.name));
  if (!files.length) { alert('No COBie Excel files found (.xlsx / .xls / .xlsm).'); return; }
  const incomingMode = handleMap.size ? 'editable' : 'standard';
  if (_loadMode && _loadMode !== incomingMode) {
    alert(_loadMode === 'editable'
      ? 'This session contains editable workbooks. Use Open Editable to append more files.'
      : 'This session contains standard workbooks. Use Load Files or Load Folder to append more files.');
    return;
  }

  const parsedFiles = [];
  const failures = [];
  const updateLoadProgress = (percent, status, detail = '') => _fileOperationProgress({
    title:'Loading COBie workbooks', status, detail,
    percent,
    icon:'bi-file-earmark-arrow-down',
  });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileStart = (i / files.length) * 65;
    const fileSpan = 65 / files.length;
    updateLoadProgress(fileStart, `Validating ${file.name}`, `Workbook ${i + 1} of ${files.length}`);
    await _yieldForFileProgress();
    try {
      const buf = await readBuf(file, ratio => {
        updateLoadProgress(fileStart + fileSpan * ratio * 0.55, `Reading ${file.name}`, `${Math.round(ratio * 100)}% of file read`);
      });
      updateLoadProgress(fileStart + fileSpan * 0.58, `Decoding workbook structure`, `${file.name} · sheets, cells, styles, and formulas`);
      await _yieldForFileProgress();
      const wb  = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true, cellStyles:true, bookVBA:true });
      parsedFiles.push({ file, workbook:wb, buffer:buf });
      updateLoadProgress(fileStart + fileSpan, `Workbook decoded`, `${file.name} · ${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? '' : 's'} ready`);
    } catch(err) {
      console.warn('Skipped', file.name, err.message);
      failures.push(`${file.name}: ${err.message}`);
    }
  }

  if (!parsedFiles.length) {
    _fileOperationProgress({ title:'Load failed', status:'No workbooks could be loaded', detail:failures[0] || '', percent:100, icon:'bi-exclamation-triangle' });
    _clearFileOperationProgress(2400);
    alert('No workbooks could be loaded.\n\n' + failures.join('\n'));
    return;
  }

  const appending = db.facilities.length > 0;
  if (typeof resetQaAudit === 'function') resetQaAudit();
  const previousLengths = {};
  COBIE_RUNTIME_MODEL.entities.forEach(descriptor => {
    previousLengths[descriptor.bucket] = (db[descriptor.bucket] || []).length;
  });
  if (!appending) resetDb();
  for (let index = 0; index < parsedFiles.length; index++) {
    const { file, workbook, buffer } = parsedFiles[index];
    updateLoadProgress(65 + (index / parsedFiles.length) * 17, 'Merging COBie rows', `${file.name} · workbook ${index + 1} of ${parsedFiles.length}`);
    await _yieldForFileProgress();
    try {
      parseCOBieInto(workbook, file.name, buffer, handleMap.get(file) || null);
    } catch (err) {
      console.warn('Skipped', file.name, err?.message || err);
      failures.push(`${file.name}: ${err?.message || err}`);
    }
  }

  if (!db.facilities.length) {
    _fileOperationProgress({ title:'Load failed', status:'No workbooks could be merged', detail:failures[0] || '', percent:100, icon:'bi-exclamation-triangle' });
    _clearFileOperationProgress(2400);
    alert('No workbooks could be loaded.\n\n' + failures.join('\n'));
    return;
  }
  canonicalizeLoadedFacilities();
  updateLoadProgress(82, 'Rebuilding workbook indexes', 'Linking facilities, floors, spaces, types, components, and systems');
  await _yieldForFileProgress();
  buildIdx();
  updateLoadProgress(89, appending ? 'Updating session baseline' : 'Capturing workbook baseline', 'Preparing change tracking and Undo state');
  await _yieldForFileProgress();
  if (appending) _appendDbState(previousLengths); else _captureDbState();
  _loadMode = incomingMode;
  const logicalFacilities = _logicalFacilityRows();
  const label = logicalFacilities.length === 1
    ? (logicalFacilities[0]._facility || logicalFacilities[0]._fileName)
    : `${logicalFacilities.length} facilities loaded`;
  updateLoadProgress(95, 'Rendering workspace', 'Refreshing filters, results, summaries, and navigation');
  await _yieldForFileProgress();
  showApp(label);
  updateLoadProgress(100, 'Load complete', label);
  _clearFileOperationProgress(900);
  document.getElementById('fileInput').value = '';
  document.getElementById('folderInput').value = '';
  if (failures.length) {
    alert(`${failures.length} workbook${failures.length !== 1 ? 's were' : ' was'} skipped:\n\n${failures.join('\n')}`);
  }
}

function resetDb() {
  if (typeof resetQaAudit === 'function') resetQaAudit();
  [...COBIE_RUNTIME_MODEL.entities.values()].forEach(descriptor => { db[descriptor.bucket] = []; });
  Object.values(selectedCategoryLevels).forEach(levels => levels.clear());
  collapsedFilterCategories.clear();
  _justCreated.clear();
  _originalDbState = null;
  _changeLog = [];
  _loadMode = null;
  _updateChangesBtn();
}

// Return the single-page application to its initial upload state.
function closeWorkbooks() {
  if (_changeLog.length && !confirm(
    'You have ' + _changeLog.length + ' unsaved change' + (_changeLog.length !== 1 ? 's' : '') +
    '. Close all workbooks and discard these changes?'
  )) return;

  document.querySelectorAll('.modal.show').forEach(modal => {
    bootstrap.Modal.getInstance(modal)?.hide();
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
  document.body.classList.remove('modal-open');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');

  resetDb();
  Object.keys(idx).forEach(key => delete idx[key]);
  Object.values(sel).forEach(values => values.clear());
  lastCounts = _createFilterCountStore();
  COBIE_FILTER_DIMENSIONS.forEach(filter => { lastCounts[filter.dimension] = {}; });
  searchQuery = '';
  viewMode = 'asset';
  docStore = [];
  groupInfoStore = [];
  pendingGroups = {};
  pendingLeaf = {};
  collapseCounter = 0;
  cardCtr = 0;
  allExpanded = false;
  _createType = 'space';

  groupState.order = [...DEFAULT_GROUP_ORDER];
  groupState.active.clear();
  const groupList = document.getElementById('group-sortable');
  DEFAULT_GROUP_ORDER.forEach(dim => {
    const chip = groupList.querySelector(`[data-dim="${dim}"]`);
    if (chip) {
      chip.classList.toggle('gchip-active', !!_cobieFilterDescriptor(dim)?.defaultActive);
      groupList.appendChild(chip);
    }
  });

  document.getElementById('fileInput').value = '';
  document.getElementById('folderInput').value = '';
  _clearFileOperationProgress();
  document.getElementById('search-input').value = '';
  document.getElementById('s-clear').style.display = 'none';
  document.getElementById('hdr').classList.remove('search-active');
  document.getElementById('search-wrap').classList.add('d-none');
  document.getElementById('close-btn').classList.add('d-none');
  const fileLabel = document.getElementById('file-lbl');
  fileLabel.textContent = '';
  fileLabel.classList.add('d-none');

  document.getElementById('comp-list').replaceChildren();
  document.getElementById('pills').replaceChildren();
  document.getElementById('res-count').textContent = '-';
  document.getElementById('fac-name').textContent = '-';
  document.getElementById('fac-desc').textContent = '';
  ['facilities','types','comps','spaces','sys','docs'].forEach(id => {
    document.getElementById('st-' + id).textContent = '0';
  });
  document.querySelectorAll('.fp').forEach(panel => panel.classList.remove('fp-collapsed'));
  document.querySelectorAll('.fp-search').forEach(input => { input.value = ''; });
  document.getElementById('filter-bar').style.removeProperty('height');
  document.getElementById('filter-bar').dataset.userSized = '';
  document.getElementById('content').scrollTop = 0;
  document.getElementById('btn-asset').classList.add('active');
  document.getElementById('btn-document').classList.remove('active');
  document.getElementById('btn-qa').classList.remove('active');
  document.getElementById('app').style.display = 'none';
  document.getElementById('hdr').style.display = 'none';
  document.getElementById('upload').style.display = 'flex';
  if (typeof resetFloorSvgPanel === 'function') resetFloorSvgPanel();
  if (typeof resetThreeDViewerPanel === 'function') resetThreeDViewerPanel();
  if (typeof resetQaGraphPanel === 'function') resetQaGraphPanel();
  _updateLoaderControls();
}

// ── Session snapshots and rollback ───────────────────────────
function _cloneRecord(row) {
  const copy = {};
  Object.entries(row).forEach(([key, value]) => {
    copy[key] = value instanceof Date ? new Date(value.getTime()) : value;
  });
  return copy;
}

function _captureDbState() {
  _originalDbState = {};
  [...COBIE_RUNTIME_MODEL.entities.values()].forEach(descriptor => {
    _originalDbState[descriptor.bucket] = (db[descriptor.bucket] || []).map(_cloneRecord);
  });
}

function _appendDbState(previousLengths) {
  if (!_originalDbState) { _captureDbState(); return; }
  [...COBIE_RUNTIME_MODEL.entities.values()].map(descriptor => descriptor.bucket).forEach(key => {
    const baseline = _originalDbState[key] ||= [];
    (db[key] || []).slice(previousLengths[key] || 0).forEach(row => baseline.push(_cloneRecord(row)));
  });
}

function _restoreDbState() {
  if (!_originalDbState) return;
  if (typeof resetQaAudit === 'function') resetQaAudit();
  [...COBIE_RUNTIME_MODEL.entities.values()].map(descriptor => descriptor.bucket).forEach(key => {
    db[key] = (_originalDbState[key] || []).map(_cloneRecord);
  });
  _justCreated.clear();
}

// ── Application display lifecycle ────────────────────────────
function showApp(filename) {
  document.getElementById('hdr').style.display    = 'flex';
  document.getElementById('upload').style.display = 'none';
  document.getElementById('app').style.display    = 'flex';

  if (typeof applyInitialVerticalFilterSplit === 'function') {
    applyInitialVerticalFilterSplit(false);
  }

  const lbl = document.getElementById('file-lbl');
  lbl.textContent = filename; lbl.classList.remove('d-none');

  _renderSummary();
  document.getElementById('search-wrap').classList.remove('d-none');
  document.getElementById('close-btn').classList.remove('d-none');
  _updateLoaderControls();

  if (typeof _viewer3dRebuildRoomGeometryCache === 'function') {
    _viewer3dRebuildRoomGeometryCache();
  }
  applyFilters();
}

function _updateLoaderControls() {
  const hasWorkbooks = db.facilities.length > 0;
  const editableMode = hasWorkbooks && _loadMode === 'editable';
  const pickerSupported = typeof globalThis.showOpenFilePicker === 'function';
  document.getElementById('edit-files-btn').classList.toggle('d-none', !pickerSupported || (hasWorkbooks && !editableMode));
  document.getElementById('load-lbl').classList.toggle('d-none', editableMode);
  document.getElementById('load-folder-lbl').classList.toggle('d-none', editableMode);
}

function _renderSummary() {
  const logicalFacilities = _logicalFacilityRows();
  const systemCount = Array.isArray(idx.systems) ? idx.systems.length : db.systems.length;
  if (logicalFacilities.length === 1) {
    document.getElementById('fac-name').textContent = logicalFacilities[0]._facility || f(logicalFacilities[0], 'Name') || 'Facility';
    document.getElementById('fac-desc').textContent = f(logicalFacilities[0], 'Description');
  } else {
    document.getElementById('fac-name').textContent = logicalFacilities.length + ' Facilities';
    document.getElementById('fac-desc').textContent = logicalFacilities.map(fac => fac._facility || f(fac, 'Name')).join(' · ');
  }
  document.getElementById('st-facilities').textContent = logicalFacilities.length;
  document.getElementById('st-floors').textContent = db.floors.length;
  document.getElementById('st-types') .textContent = db.types.length;
  document.getElementById('st-comps') .textContent = db.components.length;
  document.getElementById('st-spaces').textContent = db.spaces.length;
  document.getElementById('st-sys')   .textContent = systemCount;
  document.getElementById('st-docs')  .textContent = db.documents.length;
}

function refreshDisplay(closeChangesModal = false) {
  buildIdx();
  _renderSummary();
  applyFilters();
  if (closeChangesModal) {
    bootstrap.Modal.getInstance(document.getElementById('changes-modal'))?.hide();
  }
}
