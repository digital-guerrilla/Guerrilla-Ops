// ── Workbook loading and session lifecycle ───────────────────
function readBuf(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(file.name));
    r.onload  = ev => resolve(ev.target.result);
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
  const files = [...fileList].filter(f => _excelRe.test(f.name));
  if (!files.length) { alert('No COBie Excel files found (.xlsx / .xls / .xlsm).'); return; }
  const incomingMode = handleMap.size ? 'editable' : 'standard';
  if (_loadMode && _loadMode !== incomingMode) {
    alert(_loadMode === 'editable'
      ? 'This session contains editable workbooks. Use Open Editable to append more files.'
      : 'This session contains standard workbooks. Use Load Files or Load Folder to append more files.');
    return;
  }

  const prog = document.getElementById('load-progress');
  const parsedFiles = [];
  const failures = [];

  for (let i = 0; i < files.length; i++) {
    if (prog) prog.textContent = `Loading ${i + 1} of ${files.length}: ${files[i].name}`;
    try {
      const buf = await readBuf(files[i]);
      const wb  = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true, cellStyles:true, bookVBA:true });
      parsedFiles.push({ file:files[i], workbook:wb, buffer:buf });
    } catch(err) {
      console.warn('Skipped', files[i].name, err.message);
      failures.push(`${files[i].name}: ${err.message}`);
    }
  }

  if (prog) prog.textContent = '';
  if (!parsedFiles.length) {
    alert('No workbooks could be loaded.\n\n' + failures.join('\n'));
    return;
  }

  const appending = db.facilities.length > 0;
  const previousLengths = {};
  ['types','components','spaces','floors','systems','documents','facilities','contacts','attributes','coordinates'].forEach(key => {
    previousLengths[key] = db[key].length;
  });
  if (!appending) resetDb();
  parsedFiles.forEach(({ file, workbook, buffer }) => {
    parseCOBieInto(workbook, file.name, buffer, handleMap.get(file) || null);
  });
  buildIdx();
  if (appending) _appendDbState(previousLengths); else _captureDbState();
  _loadMode = incomingMode;
  const label = db.facilities.length === 1
    ? db.facilities[0]._fileName
    : `${db.facilities.length} workbooks loaded`;
  showApp(label);
  document.getElementById('fileInput').value = '';
  document.getElementById('folderInput').value = '';
  if (failures.length) {
    alert(`${failures.length} workbook${failures.length !== 1 ? 's were' : ' was'} skipped:\n\n${failures.join('\n')}`);
  }
}

function resetDb() {
  db.types=[]; db.components=[]; db.spaces=[];
  db.floors=[]; db.systems=[]; db.documents=[];
  db.facilities=[]; db.contacts=[]; db.attributes=[]; db.coordinates=[]; db.picklists=[]; db.facility=null;
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
  lastCounts = { facility:{}, floor:{}, space:{}, type:{}, system:{}, doccat:{} };
  searchQuery = '';
  viewMode = 'asset';
  docStore = [];
  groupInfoStore = [];
  pendingGroups = {};
  pendingLeaf = {};
  collapseCounter = 0;
  cardCtr = 0;
  allExpanded = false;
  _editState = null;
  _editDocRemovals = [];
  _pendingNewType = null;
  _createType = 'space';

  groupState.order = [...DEFAULT_GROUP_ORDER];
  groupState.active.clear();
  groupState.active.add('type');
  const groupList = document.getElementById('group-sortable');
  DEFAULT_GROUP_ORDER.forEach(dim => {
    const chip = groupList.querySelector(`[data-dim="${dim}"]`);
    if (chip) {
      chip.classList.toggle('gchip-active', dim === 'type');
      groupList.appendChild(chip);
    }
  });

  document.getElementById('fileInput').value = '';
  document.getElementById('folderInput').value = '';
  document.getElementById('load-progress').textContent = '';
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
  _originalDbState = {
    types: db.types.map(_cloneRecord), components: db.components.map(_cloneRecord),
    spaces: db.spaces.map(_cloneRecord), floors: db.floors.map(_cloneRecord),
    systems: db.systems.map(_cloneRecord), documents: db.documents.map(_cloneRecord),
    facilities: db.facilities.map(_cloneRecord), contacts: db.contacts.map(_cloneRecord),
    attributes: db.attributes.map(_cloneRecord), coordinates: db.coordinates.map(_cloneRecord),
    picklists: db.picklists.map(_cloneRecord),
  };
}

function _appendDbState(previousLengths) {
  if (!_originalDbState) { _captureDbState(); return; }
  ['types','components','spaces','floors','systems','documents','facilities','contacts','attributes','coordinates','picklists'].forEach(key => {
    db[key].slice(previousLengths[key]).forEach(row => _originalDbState[key].push(_cloneRecord(row)));
  });
}

function _restoreDbState() {
  if (!_originalDbState) return;
  ['types','components','spaces','floors','systems','documents','facilities','contacts','attributes','coordinates','picklists'].forEach(key => {
    db[key] = _originalDbState[key].map(_cloneRecord);
  });
  db.facility = db.facilities[0] || null;
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
  if (db.facilities.length === 1) {
    document.getElementById('fac-name').textContent = f(db.facilities[0], 'Name') || db.facilities[0]._facility || 'Facility';
    document.getElementById('fac-desc').textContent = f(db.facilities[0], 'Description');
  } else {
    document.getElementById('fac-name').textContent = db.facilities.length + ' Facilities';
    document.getElementById('fac-desc').textContent = db.facilities.map(fac => f(fac, 'Name') || fac._facility).join(' · ');
  }
  document.getElementById('st-facilities').textContent = db.facilities.length;
  document.getElementById('st-floors').textContent = db.floors.length;
  document.getElementById('st-types') .textContent = db.types.length;
  document.getElementById('st-comps') .textContent = db.components.length;
  document.getElementById('st-spaces').textContent = db.spaces.length;
  document.getElementById('st-sys')   .textContent = idx.systems.length;
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
