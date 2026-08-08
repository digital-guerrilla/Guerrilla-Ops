// ── Change tracking and review ────────────────────────────────
function _resolveChangeFacilities(entityType, entityName, facility) {
  let facNames = facility ? [facility] : [];
  if (!facNames.length && entityType === 'component') {
    const o = db.components.find(c => f(c,'Name') === entityName);
    if (o?._facility) facNames = [o._facility];
  } else if (!facNames.length && entityType === 'type') {
    facNames = [...new Set(db.types.filter(t=>f(t,'Name')===entityName).map(t=>t._facility).filter(Boolean))];
  } else if (!facNames.length && entityType === 'space') {
    const o = db.spaces.find(s => f(s,'Name') === entityName);
    if (o?._facility) facNames = [o._facility];
  } else if (!facNames.length && entityType === 'system') {
    facNames = [...new Set(db.systems.filter(s=>f(s,'Name')===entityName).map(s=>s._facility).filter(Boolean))];
  } else if (!facNames.length && entityType === 'floor') {
    const o = db.floors.find(x => f(x,'Name') === entityName);
    if (o?._facility) facNames = [o._facility];
  } else if (!facNames.length && entityType === 'facility') {
    facNames = [entityName];
  }
  if (!facNames.length) facNames = db.facilities.map(x=>x._facility).filter(Boolean);
  return facNames;
}

function _clearChangeEntries(entityType, entityName, facility, originalName = entityName) {
  const facNames = _resolveChangeFacilities(entityType, entityName, facility);
  const facKey = [...facNames].sort().join();
  const rootKey = String(originalName || entityName || '').toLowerCase();
  _changeLog = _changeLog.filter(entry => !(
    entry.entityType === entityType &&
    [...entry.facNames].sort().join() === facKey &&
    (entry.entityName.toLowerCase() === rootKey || entry.originalName.toLowerCase() === rootKey)
  ));
  _updateChangesBtn();
}

function _logChange(entityType, entityName, facility, originalName = entityName) {
  let facNames = _resolveChangeFacilities(entityType, entityName, facility);
  const facKey = [...facNames].sort().join();
  const previous = _changeLog.find(entry =>
    entry.entityType === entityType &&
    [...entry.facNames].sort().join() === facKey &&
    entry.entityName.toLowerCase() === originalName.toLowerCase()
  );
  const rootName = previous?.originalName || originalName;
  _changeLog = _changeLog.filter(entry => !(
    entry.entityType === entityType &&
    [...entry.facNames].sort().join() === facKey &&
    (entry.entityName.toLowerCase() === entityName.toLowerCase() ||
     entry.originalName.toLowerCase() === rootName.toLowerCase())
  ));
  _changeLog.push({ entityType, entityName, originalName:rootName, facNames, timestamp: Date.now() });
  _updateChangesBtn();
}

function _updateChangesBtn() {
  const btn = document.getElementById('changes-btn');
  const cnt = document.getElementById('changes-count');
  if (!btn || !cnt) return;
  cnt.textContent = _changeLog.length;
  btn.classList.toggle('d-none', _changeLog.length === 0);
}

function openChangesModal() {
  const byFac = {};
  _changeLog.forEach(entry => {
    entry.facNames.forEach(fn => { (byFac[fn] = byFac[fn] || []).push(entry); });
  });
  const labels = {component:'Component',type:'Type',space:'Space',system:'System',floor:'Floor',facility:'Facility',document:'Document',attribute:'Attribute',coordinate:'Coordinate'};
  const icons  = {component:'bi-tools',type:'bi-tag-fill',space:'bi-grid-fill',system:'bi-diagram-3-fill',floor:'bi-layers-fill',facility:'bi-building',document:'bi-file-earmark-text',attribute:'bi-list-check',coordinate:'bi-crosshair'};
  let html = '';
  if (!_changeLog.length) {
    html = '<p class="text-muted small mb-0">No changes recorded.</p>';
  } else {
    Object.entries(byFac).forEach(([facName, entries]) => {
      const facObj = db.facilities.find(x => x._facility === facName);
      const sourceInfo = _facilityWorkbookSourceInfo(facObj);
      html += `<div class="mb-3 border rounded p-2">
        <div class="d-flex align-items-center gap-2 mb-2">
          <i class="bi bi-file-earmark-excel text-success"></i>
          <strong style="font-size:.88rem">${esc(facName)}</strong>
          ${sourceInfo.value ? `<code style="font-size:.74rem;color:#888">${esc(sourceInfo.kind)}: ${esc(sourceInfo.value)}</code>` : ''}
          <span class="badge bg-secondary ms-auto">${entries.length} change${entries.length!==1?'s':''}</span>
        </div>
        <ul class="mb-0 small ps-3">
          ${entries.map(e=>`<li><i class="bi ${icons[e.entityType]||'bi-pencil'} me-1 text-muted"></i>${esc(labels[e.entityType]||e.entityType)}: <strong>${esc(e.entityName)}</strong></li>`).join('')}
        </ul>
      </div>`;
    });
  }
  document.getElementById('changes-modal-body').innerHTML = html;
  const editableCount = db.facilities.filter(fac => fac._fileHandle).length;
  const saveBtn = document.getElementById('save-existing-btn');
  const saveNote = document.getElementById('changes-save-note');
  if (editableCount === db.facilities.length && editableCount > 0) {
    saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i>Update Selected Files';
    saveNote.textContent = 'These XLSX files were opened with write permission and will be updated directly.';
  } else if (editableCount > 0) {
    saveBtn.innerHTML = '<i class="bi bi-download me-1"></i>Update / Download Files';
    saveNote.textContent = 'Editable XLSX files will be updated; other workbooks will be downloaded.';
  } else {
    saveBtn.innerHTML = '<i class="bi bi-download me-1"></i>Download with Original Names';
    saveNote.textContent = 'Browsers download files opened by upload, folder selection, or drag and drop.';
  }
  new bootstrap.Modal(document.getElementById('changes-modal')).show();
}

// ── Workbook reconstruction and style preservation ────────────
function _exportSheetData(facObj) {
  const fac     = facObj._facility;
  const cleanRows = (arr) => arr
    .filter(r => r._facility === fac)
    .map(r => { const o={}; Object.entries(r).forEach(([k,v])=>{ if(!k.startsWith('_')) o[k]=v; }); return o; });
  const cleanFac = () => { const o={}; Object.entries(facObj).forEach(([k,v])=>{ if(!k.startsWith('_')) o[k]=v; }); return [o]; };
  return [['Facility',cleanFac()],['Contact',cleanRows(db.contacts||[])],['Floor',cleanRows(db.floors)],
   ['Space',cleanRows(db.spaces)],['Type',cleanRows(db.types)],['Component',cleanRows(db.components)],
   ['System',cleanRows(db.systems)],['Document',cleanRows(db.documents)],['Attribute',cleanRows(db.attributes||[])],
   ['Coordinate',cleanRows(db.coordinates||[])]];
}

async function _buildPreservedXlsx(facObj, onProgress) {
  onProgress(0.1, 'Loading original workbook');
  await _yieldForFileProgress();
  const workbook = await XlsxPopulate.fromDataAsync(facObj._sourceBuffer.slice(0));
  const sheetData = _exportSheetData(facObj);
  for (let index = 0; index < sheetData.length; index++) {
    const [name, data] = sheetData[index];
    onProgress(0.18 + (index / sheetData.length) * 0.38, `Synchronizing ${name} sheet`);
    await _yieldForFileProgress();
    const populatedSheet = workbook.sheets().find(sheet => sheet.name().toLowerCase() === name.toLowerCase());
    const sourceName = facObj._workbook.SheetNames.find(sheetName => sheetName.toLowerCase() === name.toLowerCase());
    const sourceSheet = sourceName ? facObj._workbook.Sheets[sourceName] : null;
    if (!populatedSheet && !data.length) continue;
    _syncPopulatedSheet(populatedSheet || workbook.addSheet(name), data, sourceSheet);
  }
  onProgress(0.58, 'Serializing workbook and styles');
  await _yieldForFileProgress();
  const output = await workbook.outputAsync();
  onProgress(0.68, 'Packaging workbook bytes');
  await _yieldForFileProgress();
  const blob = output instanceof Blob ? output : new Blob([output], {
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return { blob, buffer:await blob.arrayBuffer() };
}

function _syncPopulatedSheet(sheet, rows, sourceSheet) {
  const sourceGrid = sourceSheet ? XLSX.utils.sheet_to_json(sourceSheet, { header:1, defval:'', raw:false }) : [];
  const headers = (sourceGrid[0] || []).map(String).filter(Boolean);
  rows.forEach(row => Object.keys(row).forEach(key => { if (!headers.includes(key)) headers.push(key); }));
  if (!headers.length) return;

  const oldRowCount = Math.max(1, sourceGrid.length);
  const newRowCount = rows.length + 1;
  const outputRowCount = Math.max(oldRowCount, newRowCount);
  const values = [headers, ...rows.map(row => headers.map(key => row[key] ?? ''))];
  while (values.length < outputRowCount) values.push(headers.map(() => ''));
  sheet.range(1, 1, outputRowCount, headers.length).value(values);

  if (newRowCount > oldRowCount) {
    for (let row = Math.max(2, oldRowCount + 1); row <= newRowCount; row++) {
      for (let col = 1; col <= headers.length; col++) {
        _copyPopulatedStyle(sheet.cell(2, col), sheet.cell(row, col));
      }
    }
  }
}

const _POPULATE_STYLE_KEYS = [
  'bold','italic','underline','strikethrough','subscript','superscript',
  'fontSize','fontFamily','fontColor','horizontalAlignment','verticalAlignment',
  'wrapText','shrinkToFit','textDirection','textRotation','indent','fill','border',
  'numberFormat','locked','hidden'
];
function _copyPopulatedStyle(source, target) {
  _POPULATE_STYLE_KEYS.forEach(key => {
    try {
      const value = source.style(key);
      if (value !== undefined && value !== null) target.style(key, value);
    } catch (_) {}
  });
}

async function _buildFallbackWorkbook(facObj, onProgress) {
  const sourceWb = facObj._workbook;
  const wb = sourceWb
    ? { ...sourceWb, SheetNames:[...sourceWb.SheetNames], Sheets:{...sourceWb.Sheets} }
    : XLSX.utils.book_new();
  const sheetData = _exportSheetData(facObj);
  for (let index = 0; index < sheetData.length; index++) {
    const [name, data] = sheetData[index];
    onProgress(0.12 + (index / sheetData.length) * 0.42, `Synchronizing ${name} sheet`);
    await _yieldForFileProgress();
    const existingName = wb.SheetNames.find(n => n.toLowerCase() === name.toLowerCase());
    if (!existingName && !data.length) continue;
    const sheetName = existingName || name;
    const oldSheet = existingName ? wb.Sheets[existingName] : null;
    wb.Sheets[sheetName] = _syncSheet(data, oldSheet);
    if (!existingName) wb.SheetNames.push(sheetName);
  }
  return wb;
}

async function _buildExport(facObj, onProgress) {
  const isXlsx = /\.xlsx$/i.test(facObj._fileName || '');
  if (isXlsx && facObj._sourceBuffer && typeof XlsxPopulate !== 'undefined') {
    return _buildPreservedXlsx(facObj, onProgress);
  }
  const bookType = /\.xlsm$/i.test(facObj._fileName || '') ? 'xlsm'
    : (/\.xls$/i.test(facObj._fileName || '') ? 'xls' : 'xlsx');
  const workbook = await _buildFallbackWorkbook(facObj, onProgress);
  onProgress(0.58, 'Serializing workbook and styles');
  await _yieldForFileProgress();
  const bytes = XLSX_STYLE.write(workbook, {
    type:'array', bookType, bookVBA:true
  });
  onProgress(0.68, 'Packaging workbook bytes');
  await _yieldForFileProgress();
  const blob = new Blob([bytes], { type:'application/octet-stream' });
  return { blob, buffer:await blob.arrayBuffer() };
}

function _downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function _exportFacility(facObj, asNew, updateOriginal = false, writablePromise = null, onProgress = () => {}) {
  const fac = facObj._facility;
  const origName = facObj._fileName || (fac.replace(/[^a-z0-9_\-]/gi,'_') + '.xlsx');
  const outName = asNew ? origName.replace(/\.(xlsx|xls|xlsm)$/i, '_modified.$1') : origName;
  const directWritable = updateOriginal && facObj._fileHandle
    ? (writablePromise || facObj._fileHandle.createWritable())
    : null;
  onProgress(0.03, 'Collecting workbook rows');
  await _yieldForFileProgress();
  const result = await _buildExport(facObj, onProgress);
  onProgress(0.74, directWritable ? 'Opening destination file' : 'Preparing browser download');
  await _yieldForFileProgress();

  if (directWritable) {
    const writable = await directWritable;
    try {
      onProgress(0.8, 'Writing workbook bytes');
      await _yieldForFileProgress();
      await writable.write(result.blob);
      onProgress(0.88, 'Closing destination file');
      await _yieldForFileProgress();
      await writable.close();
    } catch (err) {
      try { await writable.abort(); } catch (_) {}
      throw err;
    }
  } else {
    _downloadBlob(result.blob, outName);
  }
  onProgress(0.92, 'Reopening saved workbook');
  await _yieldForFileProgress();
  facObj._sourceBuffer = result.buffer;
  facObj._workbook = XLSX.read(new Uint8Array(result.buffer), {
    type:'array', cellDates:true, cellStyles:true, bookVBA:true
  });
  onProgress(0.98, 'Updating saved workbook session');
  await _yieldForFileProgress();
}

function _setSaveControlsBusy(busy) {
  document.querySelectorAll('#changes-modal button').forEach(button => { button.disabled = busy; });
}

function _saveProgressUpdater(facilities, icon = 'bi-floppy') {
  return (index, fraction, status) => {
    const fac = facilities[index];
    _fileOperationProgress({
      title:'Saving COBie workbooks',
      status:`${status}: ${fac?._fileName || fac?._facility || 'Workbook'}`,
      detail:`Workbook ${index + 1} of ${facilities.length}`,
      percent:((index + fraction) / Math.max(1, facilities.length)) * 100,
      icon,
    });
  };
}

function _syncSheet(rows, oldSheet) {
  const oldGrid = oldSheet ? XLSX.utils.sheet_to_json(oldSheet, { header:1, defval:'' }) : [];
  const headers = (oldGrid[0] || []).map(String).filter(Boolean);
  rows.forEach(row => Object.keys(row).forEach(key => { if (!headers.includes(key)) headers.push(key); }));
  const grid = [headers, ...rows.map(row => headers.map(key => row[key] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  if (!oldSheet) return sheet;

  const columnTemplates = {};
  const oldRange = XLSX.utils.decode_range(oldSheet['!ref'] || 'A1');
  for (let col = oldRange.s.c; col <= oldRange.e.c; col++) {
    for (let row = Math.max(1, oldRange.s.r); row <= oldRange.e.r; row++) {
      const cell = oldSheet[XLSX.utils.encode_cell({ r:row, c:col })];
      if (cell?.s) { columnTemplates[col] = cell; break; }
    }
  }

  Object.keys(sheet).filter(key => key[0] !== '!').forEach(key => {
    const oldCell = oldSheet[key];
    const address = XLSX.utils.decode_cell(key);
    const styleCell = oldCell || (address.r > 0 ? columnTemplates[address.c] : null);
    if (styleCell?.s) sheet[key].s = _writableCellStyle(styleCell.s);
    if (!oldCell) return;
    ['z','l','c'].forEach(prop => { if (oldCell[prop] !== undefined) sheet[key][prop] = oldCell[prop]; });
    if (oldCell.f && oldCell.v === sheet[key].v) sheet[key].f = oldCell.f;
  });
  ['!cols','!rows','!merges','!autofilter','!margins','!protect','!outline'].forEach(prop => {
    if (oldSheet[prop] !== undefined) sheet[prop] = oldSheet[prop];
  });
  return sheet;
}

function _writableCellStyle(style) {
  const copy = JSON.parse(JSON.stringify(style));
  if (copy.fill || copy.font || copy.border || copy.alignment || copy.numFmt) return copy;
  if (copy.patternType || copy.fgColor || copy.bgColor) return { fill:copy };
  return copy;
}

// ── Save, download, and discard actions ──────────────────────
async function saveToExistingFiles() {
  const writablePromises = new Map();
  const facilities = db.facilities.filter(fac => fac._facility);
  const updateProgress = _saveProgressUpdater(facilities);
  _setSaveControlsBusy(true);
  try {
    if (facilities.length) updateProgress(0, 0, 'Requesting write access');
    await _yieldForFileProgress();
    db.facilities.forEach(fac => {
      if (fac._facility && fac._fileHandle) {
        writablePromises.set(fac, fac._fileHandle.createWritable());
      }
    });
    for (let index = 0; index < facilities.length; index++) {
      const fac = facilities[index];
      updateProgress(index, 0, 'Preparing');
      await _exportFacility(fac, false, !!fac._fileHandle, writablePromises.get(fac) || null,
        (fraction, status) => updateProgress(index, fraction, status));
    }
    _fileOperationProgress({ title:'Saving COBie workbooks', status:'Capturing saved baseline', detail:'Updating change tracking and Undo state', percent:99, icon:'bi-floppy' });
    await _yieldForFileProgress();
    _afterSave();
    _fileOperationProgress({ title:'Saving COBie workbooks', status:'Save complete', detail:`${facilities.length} workbook${facilities.length === 1 ? '' : 's'} saved`, percent:100, icon:'bi-check-circle' });
    _clearFileOperationProgress(1100);
  } catch (err) {
    for (const promise of writablePromises.values()) {
      try { const writable = await promise; await writable.abort(); } catch (_) {}
    }
    _fileOperationProgress({ title:'Save failed', status:'The workbook could not be saved', detail:err.message, percent:100, icon:'bi-exclamation-triangle' });
    _clearFileOperationProgress(2600);
    alert('Could not save the workbook: ' + err.message);
  } finally {
    _setSaveControlsBusy(false);
  }
}
async function saveToNewFiles() {
  const facilities = db.facilities.filter(fac => fac._facility);
  const updateProgress = _saveProgressUpdater(facilities, 'bi-download');
  _setSaveControlsBusy(true);
  try {
    for (let index = 0; index < facilities.length; index++) {
      const fac = facilities[index];
      updateProgress(index, 0, 'Preparing');
      await _exportFacility(fac, true, false, null,
        (fraction, status) => updateProgress(index, fraction, status));
    }
    _fileOperationProgress({ title:'Saving COBie workbooks', status:'Capturing saved baseline', detail:'Updating change tracking and Undo state', percent:99, icon:'bi-download' });
    await _yieldForFileProgress();
    _afterSave();
    _fileOperationProgress({ title:'Saving COBie workbooks', status:'Downloads ready', detail:`${facilities.length} workbook${facilities.length === 1 ? '' : 's'} prepared`, percent:100, icon:'bi-check-circle' });
    _clearFileOperationProgress(1100);
  } catch (err) {
    _fileOperationProgress({ title:'Save failed', status:'The workbook could not be created', detail:err.message, percent:100, icon:'bi-exclamation-triangle' });
    _clearFileOperationProgress(2600);
    alert('Could not create the workbook: ' + err.message);
  } finally {
    _setSaveControlsBusy(false);
  }
}
function _afterSave() {
  _captureDbState();
  _changeLog = []; _updateChangesBtn();
  bootstrap.Modal.getInstance(document.getElementById('changes-modal'))?.hide();
}
function discardChanges() {
  if (!_changeLog.length) return;
  if (!confirm('Discard all ' + _changeLog.length + ' recorded change' + (_changeLog.length!==1?'s':'') + '?')) return;
  _restoreDbState();
  _changeLog = []; _updateChangesBtn();
  refreshDisplay();
  bootstrap.Modal.getInstance(document.getElementById('changes-modal'))?.hide();
}
