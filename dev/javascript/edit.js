// ── Edit engine state ─────────────────────────────────────────
let _editState = null;
let _editDocRemovals = [];
let _editDocRefs = new Map();
let _editDocRefCounter = 0;
let _pendingNewType = null; // { name, facility } — queued when a component edit introduces a new TypeName

function openEditModal(entityType, entityName, facility) {
  _editState = { entityType, entityName, facility: facility || '' };
  if (typeof resetComponentPlacementDraft === 'function') resetComponentPlacementDraft('edit');
  _editDocRemovals = [];
  _editDocRefs = new Map();
  _editDocRefCounter = 0;
  const typeModalEl = document.getElementById('type-modal');
  const tm = bootstrap.Modal.getInstance(typeModalEl);
  if (tm && typeModalEl.classList.contains('show')) {
    tm.hide();
    typeModalEl.addEventListener('hidden.bs.modal', _showEditModal, { once: true });
  } else {
    _showEditModal();
  }
}

function openDocumentEdit(documentRow) {
  _editState = {
    entityType:'document', entityName:f(documentRow,'Name') || 'Document',
    facility:documentRow._facility || '', document:documentRow,
  };
  _editDocRemovals = [];
  _editDocRefs = new Map([['doc-direct', documentRow]]);
  _editDocRefCounter = 1;
  const visibleModal = ['type-modal','doc-modal'].map(id => document.getElementById(id))
    .find(element => element.classList.contains('show'));
  if (visibleModal) {
    bootstrap.Modal.getInstance(visibleModal)?.hide();
    visibleModal.addEventListener('hidden.bs.modal', _showEditModal, { once:true });
  } else {
    _showEditModal();
  }
}

function _showEditModal() {
  if (!_editState) return;
  const { entityType, entityName } = _editState;
  const icons  = {component:'bi-tools',type:'bi-tag-fill',space:'bi-grid-fill',system:'bi-diagram-3-fill',floor:'bi-layers-fill',facility:'bi-building',document:'bi-file-earmark-text'};
  const labels = {component:'Component',type:'Type',space:'Space',system:'System',floor:'Floor',facility:'Facility',document:'Document'};
  document.getElementById('edit-modal-icon').className  = `bi ${icons[entityType]||'bi-pencil'} me-2`;
  document.getElementById('edit-modal-label').textContent = `${labels[entityType]||entityType}: ${entityName}`;
  document.getElementById('edit-modal-body').innerHTML = _buildEditBody(entityType, entityName);
  new bootstrap.Modal(document.getElementById('edit-modal')).show();
}

// ── Edit form controls ────────────────────────────────────────
function _ef(label, fieldName, value) {
  return `<div class="mb-2">
    <label class="d-block mb-1" style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666">${esc(label)}</label>
    <input type="text" class="form-control form-control-sm edit-field" data-field="${esc(fieldName)}" value="${esc(String(value===undefined||value===null?'':value))}">
  </div>`;
}
function _esel(label, fieldName, currentVal, options) {
  const opts = options.map(o=>`<option value="${esc(o)}"${o===currentVal?' selected':''}>${esc(o)}</option>`).join('');
  return `<div class="mb-2">
    <label class="d-block mb-1" style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666">${esc(label)}</label>
    <select class="form-select form-select-sm edit-field" data-field="${esc(fieldName)}"><option value="">— none —</option>${opts}</select>
  </div>`;
}
function _eauto(label, fieldName, currentVal, options, maxOpts=400) {
  const lid = 'dl_' + fieldName.replace(/[^a-z0-9]/gi,'_');
  const limited = options.slice(0, maxOpts);
  const opts = limited.map(o => typeof o === 'string'
    ? `<option value="${esc(o)}">`
    : `<option value="${esc(o.name)}">${esc(o.desc||'')}</option>`
  ).join('');
  const hint = options.length > maxOpts ? ` (${options.length} total — type to filter)` : '';
  return `<div class="mb-2">
    <label class="d-block mb-1" style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666">${esc(label)}${hint}</label>
    <input type="text" class="form-control form-control-sm edit-field" data-field="${esc(fieldName)}"
           value="${esc(String(currentVal||''))}" list="${lid}" autocomplete="off">
    <datalist id="${lid}">${opts}</datalist>
  </div>`;
}
function _editPropertyField(entityType, fieldName, value) {
  return fieldName.toLowerCase() === 'category' && ['facility','space','type','system'].includes(entityType)
    ? _eauto(fieldName, fieldName, value, picklistCategoryValues(entityType), Infinity)
    : _ef(fieldName, fieldName, value);
}
function _documentCategoryDatalist() {
  const options = picklistCategoryValues('document')
    .map(value => `<option value="${esc(value)}"></option>`).join('');
  return `<datalist id="edit-document-category-list">${options}</datalist>`;
}
function _docEditRow(doc, sheetName, rowName, isNew = false, docRef = '') {
  const name = doc ? f(doc,'Name') : '';
  const description = doc ? f(doc,'Description') : '';
  const category = doc ? f(doc,'Category') : '';
  const path = doc ? f(doc,'Directory') : '';
  const field = (label, key, value) => `<div class="mb-2">
    <label class="form-label mb-1" style="font-size:.71rem;font-weight:700;color:#666">${label}</label>
    <input class="form-control form-control-sm" value="${esc(value)}" data-dfield="${key}">
  </div>`;
  return `<div class="edit-doc-row${isNew?' new-doc-row':''} border rounded p-2 mb-2"
      data-sheet="${esc(sheetName)}" data-row="${esc(rowName)}" data-orig-name="${esc(name)}" data-doc-ref="${esc(docRef)}">
    <div class="d-flex align-items-center mb-2">
      <span class="small fw-semibold text-muted"><i class="bi bi-file-earmark-text me-1"></i>${isNew?'New document':'Document'}</span>
      <button class="btn btn-sm btn-outline-danger ms-auto py-0 px-2 rm-doc-btn" type="button" title="Remove document">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
    ${field('Name', 'Name', name)}
    ${field('Description', 'Description', description)}
    <div class="mb-2">
      <label class="form-label mb-1" style="font-size:.71rem;font-weight:700;color:#666">Category</label>
      <input class="form-control form-control-sm" value="${esc(category)}" data-dfield="Category"
        list="edit-document-category-list" autocomplete="off">
    </div>
    <div class="mb-1">
      <label class="form-label mb-1" style="font-size:.71rem;font-weight:700;color:#666">Link</label>
      <div class="doc-link-display${isNew?' d-none':''}">
        ${path?`<a href="${esc(_docHref(path))}" target="_blank" rel="noopener" title="Open link">${esc(path)}</a>`:'<span class="text-muted small">No link added</span>'}
        <button class="btn btn-sm btn-outline-secondary ms-auto py-0 px-2 edit-doc-link-btn" type="button">
          <i class="bi bi-pencil me-1"></i>Edit
        </button>
      </div>
      <div class="doc-link-editor${isNew?'':' d-none'}">
        <input class="form-control form-control-sm doc-link-input mb-2" value="${esc(path)}" data-dfield="Directory"
          placeholder="Paste a web link or full file path">
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary paste-doc-link-btn" type="button"><i class="bi bi-clipboard me-1"></i>Paste</button>
          <button class="btn btn-sm btn-outline-secondary browse-doc-link-btn" type="button"><i class="bi bi-folder2-open me-1"></i>Browse</button>
          <input type="file" class="doc-file-picker d-none">
        </div>
        <div class="doc-link-note text-muted mt-1" style="font-size:.68rem"></div>
      </div>
    </div>
  </div>`;
}
function _editDocList(sheetName, rowName) {
  const _dfac = _editState?.facility || '';
  const docs = docsFor(sheetName, rowName, _dfac);
  const rows = docs.map(d => {
    const docRef = 'doc-' + (_editDocRefCounter++);
    _editDocRefs.set(docRef, d);
    return _docEditRow(d, sheetName, rowName, false, docRef);
  }).join('');
  return `<div class="mt-3 pt-2 border-top">
    <div class="d-flex align-items-center mb-1">
      <span style="font-size:.72rem;font-weight:700;color:var(--navy)"><i class="bi bi-folder2-open me-1"></i>Documents</span>
      <button class="btn btn-sm btn-outline-primary ms-auto py-0 px-2 add-doc-btn" data-sheet="${esc(sheetName)}" data-row="${esc(rowName)}" style="font-size:.71rem">
        <i class="bi bi-plus-circle me-1"></i>Add
      </button>
    </div>
    <div class="edit-doc-list" id="doc-rows-${sheetName.toLowerCase()}">${rows}</div>
  </div>`;
}

const _ESKIP = new Set(['createdby','createdon','extsystem','extobject','extidentifier']);
function _eskip(k) { return k.startsWith('_') || _ESKIP.has(k.toLowerCase()); }

function _filterCheckboxList(inp) {
  const q = inp.value.toLowerCase();
  const container = inp.nextElementSibling;
  if (!container) return;
  container.querySelectorAll('label').forEach(l => {
    const v = (l.querySelector('input')?.value || '').toLowerCase();
    if (!q || v.includes(q)) {
      l.style.removeProperty('display');
    } else {
      l.style.setProperty('display', 'none', 'important');
    }
  });
}

function _buildEditBody(entityType, entityName) {
  let propsHtml = '', assocHtml = '';
  const _fac = _editState?.facility || '';

  if (entityType === 'document') {
    const documentRow = _editState?.document;
    if (!documentRow) return '<p class="text-muted">Document not found.</p>';
    return `<div style="max-width:720px;margin:0 auto">
      ${_documentCategoryDatalist()}
      ${_docEditRow(documentRow, _cobieField(documentRow, 'sheetName'), _cobieField(documentRow, 'rowName'), false, 'doc-direct')}
    </div>`;
  }

  if (entityType === 'component') {
    const obj = _findEntity(db.components, entityName, _fac);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    const shown = new Set(['typeName','type name','space']);
    Object.entries(obj).forEach(([k,v]) => {
      if (!_eskip(k) && !shown.has(k.toLowerCase()))
        propsHtml += _ef(k, k, v);
    });
    const typeDescs = idx.types.map(n => {
      const t = db.types.find(x => f(x,'Name') === n);
      return { name: n, desc: t ? f(t,'Description') : '' };
    });
    assocHtml += _eauto('Type (TypeName)', 'TypeName', _cobieField(obj, 'typeName'), typeDescs);
    const spaceMap = new Map();
    db.spaces.forEach(s => { const n=f(s,'Name'); if(n && !spaceMap.has(n)) spaceMap.set(n, f(s,'Description')); });
    const spaceDescs = [...spaceMap.entries()].map(([name,desc])=>({name,desc}));
    assocHtml += renderComponentSpaceField('edit', f(obj,'Space'), spaceDescs);
    const cLow = entityName.toLowerCase();
    const _sysRows = _fac ? db.systems.filter(x => x._facility === _fac) : db.systems;
    const _sysNames = [...new Set(_sysRows.map(x=>f(x,'Name')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const curSys = new Set();
    _sysRows.forEach(x => {
      const list = ((x.ComponentNames !== undefined ? x.ComponentNames : x['Component Names'])||'');
      if (list.split(',').map(t=>t.trim().toLowerCase()).includes(cLow)) curSys.add(f(x,'Name').toLowerCase());
    });
    const sysChecks = _sysNames.map(sn=>{
      return `<label class="d-flex align-items-center gap-1 mb-1" style="font-size:.79rem">
        <input type="checkbox" class="form-check-input sys-assoc-chk" value="${esc(sn)}" ${curSys.has(sn.toLowerCase())?'checked':''}> ${esc(sn)}
      </label>`;
    }).join('');
    assocHtml += `<div class="mb-2"><div style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666;margin-bottom:.3rem">Systems</div>
      <input type="search" placeholder="Filter systems…" class="form-control form-control-sm mb-1" style="font-size:.77rem"
        oninput="_filterCheckboxList(this)">
      <div style="max-height:130px;overflow-y:auto;border:1px solid #dee2e6;border-radius:4px;padding:.35rem .5rem">${sysChecks||'<span class="text-muted small">No systems</span>'}</div></div>`;
    assocHtml += _editDocList('Component', entityName);

  } else if (entityType === 'type') {
    const obj = _findEntity(db.types, entityName, _fac);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    Object.entries(obj).forEach(([k,v]) => { if(!_eskip(k)) propsHtml += _editPropertyField(entityType,k,v); });
    assocHtml += _editDocList('Type', entityName);

  } else if (entityType === 'space') {
    const obj = _findEntity(db.spaces, entityName, _fac);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    const flKeys = new Set(['floorname','floor name','floor']);
    assocHtml += _esel('Floor', 'FloorName', _cobieField(obj, 'floorName'), idx.floors);
    Object.entries(obj).forEach(([k,v]) => { if(!_eskip(k)&&!flKeys.has(k.toLowerCase())) propsHtml += _editPropertyField(entityType,k,v); });
    assocHtml += _editDocList('Space', entityName);

  } else if (entityType === 'system') {
    const obj = _findEntity(db.systems, entityName, _fac);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    ['Name','Category','Description'].forEach(k => propsHtml += _editPropertyField(entityType, k, obj[k]||''));
    const sysCompsLow = new Set();
    db.systems.filter(x => f(x,'Name') === entityName && (!_fac || x._facility === _fac)).forEach(x => {
      ((x.ComponentNames !== undefined ? x.ComponentNames : x['Component Names'])||'')
        .split(',').forEach(t => { t = t.trim().toLowerCase(); if (t) sysCompsLow.add(t); });
    });
    const allComps = [...new Set(db.components.filter(c => !_fac || c._facility === _fac).map(c=>f(c,'Name')).filter(Boolean))].sort();
    const compChecks = allComps.map(cn=>{
      return `<label class="d-flex align-items-center gap-1 mb-1" style="font-size:.79rem">
        <input type="checkbox" class="form-check-input comp-assoc-chk" value="${esc(cn)}" ${sysCompsLow.has(cn.toLowerCase())?'checked':''}> ${esc(cn)}
      </label>`;
    }).join('');
    assocHtml += `<div class="mb-2"><div style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666;margin-bottom:.3rem">Components</div>
      <div style="max-height:200px;overflow-y:auto;border:1px solid #dee2e6;border-radius:4px;padding:.35rem .5rem">${compChecks||'<span class="text-muted small">None</span>'}</div></div>`;
    assocHtml += _editDocList('System', entityName);

  } else if (entityType === 'floor') {
    const obj = _findEntity(db.floors, entityName, _fac);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    Object.entries(obj).forEach(([k,v]) => { if(!_eskip(k) && !/^svg/i.test(k)) propsHtml += _ef(k,k,v); });
    assocHtml += _editDocList('Floor', entityName);

  } else if (entityType === 'facility') {
    const obj = db.facilities.find(x => x._facility === entityName);
    if (!obj) return '<p class="text-muted">Not found.</p>';
    Object.entries(obj).forEach(([k,v]) => { if(!_eskip(k)) propsHtml += _editPropertyField(entityType,k,v); });
    assocHtml += _editDocList('Facility', entityName);
  }

  const hdr = (ico, t) => `<div style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);margin-bottom:.6rem"><i class="bi ${ico} me-1"></i>${t}</div>`;
  return `${_documentCategoryDatalist()}<div class="row g-3">
    <div class="col-md-6 pe-md-3 border-end-md">
      ${hdr('bi-list-ul','Properties')}
      ${propsHtml||'<p class="text-muted small">No properties.</p>'}
    </div>
    <div class="col-md-6 ps-md-3">
      ${hdr('bi-link-45deg','Associations')}
      ${assocHtml||'<p class="text-muted small">No associations.</p>'}
    </div>
  </div>`;
}

// ── Rename propagation and edit persistence ───────────────────
function _setReference(row, aliases, oldName, newName) {
  if (f(row,...aliases).toLowerCase() !== oldName.toLowerCase()) return;
  const key = aliases.find(alias => v(row[alias]).toLowerCase() === oldName.toLowerCase())
    || aliases.find(alias => Object.prototype.hasOwnProperty.call(row, alias)) || aliases[0];
  row[key] = newName;
}

function _renameDocumentRows(sheetName, oldName, newName, facility) {
  db.documents.forEach(doc => {
    if (facility && doc._facility !== facility) return;
    if (_cobieField(doc, 'sheetName').toLowerCase() !== sheetName.toLowerCase()) return;
    _setReference(doc, ['RowName','Row Name'], oldName, newName);
  });
}

function _replaceSelectedKey(dim, oldName, newName) {
  if (!sel[dim]) return;
  const oldKey = oldName.toLowerCase(), newKey = newName.toLowerCase();
  if (sel[dim].delete(oldKey)) sel[dim].add(newKey);
}

function _cascadeEntityRename(entityType, oldName, newName, facility) {
  if (!newName || oldName === newName) return facility;
  _renameDocumentRows(entityType, oldName, newName, facility);

  if (entityType === 'component') {
    db.systems.forEach(system => {
      if (facility && system._facility !== facility) return;
      const key = v(system.ComponentNames) ? 'ComponentNames'
        : Object.prototype.hasOwnProperty.call(system,'Component Names') ? 'Component Names' : 'ComponentNames';
      const names = String(system[key] || '').split(',').map(name => name.trim()).filter(Boolean);
      system[key] = names.map(name => name.toLowerCase() === oldName.toLowerCase() ? newName : name).join(',');
    });
  } else if (entityType === 'type') {
    db.components.forEach(component => {
      if (!facility || component._facility === facility) {
        _setReference(component, ['TypeName','Type Name'], oldName, newName);
      }
    });
    _replaceSelectedKey('type', oldName, newName);
  } else if (entityType === 'space') {
    db.components.forEach(component => {
      if (!facility || component._facility === facility) _setReference(component, ['Space'], oldName, newName);
    });
    _replaceSelectedKey('space', oldName, newName);
  } else if (entityType === 'floor') {
    db.spaces.forEach(space => {
      if (!facility || space._facility === facility) {
        _setReference(space, ['FloorName','Floor Name','Floor'], oldName, newName);
      }
    });
    _replaceSelectedKey('floor', oldName, newName);
  } else if (entityType === 'system') {
    _replaceSelectedKey('system', oldName, newName);
  } else if (entityType === 'facility') {
    const oldFacility = facility || oldName;
    ['components','types','spaces','floors','systems','documents','contacts','facilities'].forEach(key => {
      db[key].forEach(row => { if (row._facility === oldFacility) row._facility = newName; });
    });
    if (db.facility) db.facility.Name = newName;
    _replaceSelectedKey('facility', oldFacility, newName);
    return newName;
  }
  return facility;
}

function _editNameConflict(entityType, oldName, newName, facility) {
  if (!newName || oldName.toLowerCase() === newName.toLowerCase()) return false;
  const rowsByType = {
    component:db.components, type:db.types, space:db.spaces,
    system:db.systems, floor:db.floors, facility:db.facilities,
  };
  const rows = rowsByType[entityType] || [];
  const newKey = newName.toLowerCase();
  return rows.some(row => {
    const rowName = entityType === 'facility' ? (row._facility || f(row,'Name')) : f(row,'Name');
    return (entityType === 'facility' || !facility || row._facility === facility) &&
      rowName.toLowerCase() === newKey && rowName.toLowerCase() !== oldName.toLowerCase();
  });
}

// ── Save edit ────────────────────────────────────────────────
function saveEdit() {
  if (!_editState) return;
  const { entityType, entityName } = _editState;
  const _fac = _editState.facility || '';
  let changedEntityName = entityName;

  if (entityType === 'document') {
    const nameInput = document.querySelector('#edit-modal-body .edit-doc-row [data-dfield="Name"]');
    if (!nameInput?.value.trim()) { alert('Name is required.'); return; }
    nameInput.value = nameInput.value.trim();
  }

  const fields = {};
  document.querySelectorAll('#edit-modal-body .edit-field').forEach(el => {
    if (el.dataset.field) fields[el.dataset.field] = el.value;
  });
  if (fields.Name !== undefined) fields.Name = fields.Name.trim();
  const proposedName = fields.Name || entityName;
  if (!proposedName) { alert('Name is required.'); return; }
  if (_editNameConflict(entityType, entityName, proposedName, _fac)) {
    alert(`"${proposedName}" already exists in this facility.`);
    return;
  }

  if (entityType === 'component') {
    const obj = _findEntity(db.components, entityName, _fac);
    if (obj) {
      const previousSpace = f(obj, 'Space').trim().toLowerCase();
      Object.assign(obj, fields);
      changedEntityName = f(obj,'Name') || entityName;
      const newTN = (fields.TypeName || fields['Type Name'] || '').trim();
      if (newTN && !db.types.some(t => f(t,'Name') === newTN && t._facility === obj._facility)) {
        _pendingNewType = { name: newTN, facility: obj._facility || '' };
      }
      const newSys = new Set([...document.querySelectorAll('#edit-modal-body .sys-assoc-chk:checked')].map(el=>el.value));
      _updateCompSystems(entityName, newSys, obj._facility || _fac);
      if (typeof _renameComponentCoordinateRows === 'function') {
        _renameComponentCoordinateRows(obj._facility || _fac, entityName, changedEntityName);
      }
      const appliedPlacement = typeof _componentPlacementConsumeApplied === 'function'
        ? _componentPlacementConsumeApplied('edit')
        : null;
      if (typeof _writeComponentCoordinates === 'function' && appliedPlacement?.spaceName) {
        _writeComponentCoordinates(obj._facility || _fac, changedEntityName, appliedPlacement);
        resetComponentPlacementDraft();
      } else if (previousSpace !== f(obj, 'Space').trim().toLowerCase() && typeof _removeComponentCoordinateRows === 'function') {
        const removed = _removeComponentCoordinateRows(obj._facility || _fac, changedEntityName);
        if (removed) _logChange('coordinate', changedEntityName, obj._facility || _fac);
      }
    }
  } else if (entityType === 'type') {
    const obj = _findEntity(db.types, entityName, _fac);
    if (obj) { Object.assign(obj, fields); changedEntityName = f(obj,'Name') || entityName; }
  } else if (entityType === 'space') {
    const obj = _findEntity(db.spaces, entityName, _fac);
    if (obj) { Object.assign(obj, fields); changedEntityName = f(obj,'Name') || entityName; }
  } else if (entityType === 'system') {
    db.systems.filter(s => f(s,'Name') === entityName && (!_fac || s._facility === _fac)).forEach(s => {
      ['Name','Category','Description'].forEach(k => { if (fields[k]!==undefined) s[k]=fields[k]; });
    });
    changedEntityName = (fields.Name || entityName).trim() || entityName;
    const newComps = [...document.querySelectorAll('#edit-modal-body .comp-assoc-chk:checked')].map(el=>el.value);
    _updateSysComponents(changedEntityName, newComps, _fac);
  } else if (entityType === 'floor') {
    const obj = _findEntity(db.floors, entityName, _fac);
    if (obj) { Object.assign(obj, fields); changedEntityName = f(obj,'Name') || entityName; }
  } else if (entityType === 'facility') {
    const obj = db.facilities.find(x => x._facility === entityName);
    if (obj) { Object.assign(obj, fields); changedEntityName = f(obj,'Name') || entityName; }
  }

  // Apply doc removals
  _editDocRemovals.forEach(({ sheetName, rowName, docName, docRef }) => {
    const exactDoc = _editDocRefs.get(docRef);
    const i = exactDoc ? db.documents.indexOf(exactDoc) : db.documents.findIndex(d =>
      _cobieField(d, 'sheetName').toLowerCase() === sheetName.toLowerCase() &&
      _cobieField(d, 'rowName').toLowerCase() === rowName.toLowerCase() &&
      f(d,'Name') === docName && (!_fac || (d._facility||'') === _fac)
    );
    if (i !== -1) db.documents.splice(i, 1);
  });

  // Update existing doc rows + add new ones
  document.querySelectorAll('#edit-modal-body .edit-doc-row').forEach(row => {
    const sheet = row.dataset.sheet, rn = row.dataset.row, orig = row.dataset.origName;
    const vals = {};
    row.querySelectorAll('[data-dfield]').forEach(el => { vals[el.dataset.dfield] = el.value; });
    if (row.classList.contains('new-doc-row')) {
      if (vals.Name || vals.Description || vals.Directory) {
        const fac = _fac || (db.components.find(c=>f(c,'Name')===entityName)||db.facilities[0]||{})?._facility||'';
        db.documents.push({ Name:vals.Name||'', Description:vals.Description||'', Category:vals.Category||'',
          File:'', Directory:vals.Directory||'', SheetName:sheet, RowName:rn,
          CreatedBy:'', CreatedOn:'', ExtSystem:'', ExtObject:'', ExtIdentifier:'', Reference:'',
          _facility: fac });
      }
    } else if (orig) {
      const doc = _editDocRefs.get(row.dataset.docRef) || db.documents.find(d =>
        _cobieField(d, 'sheetName').toLowerCase() === sheet.toLowerCase() &&
        _cobieField(d, 'rowName').toLowerCase() === rn.toLowerCase() &&
        f(d,'Name') === orig &&
        (!_fac || (d._facility||'') === _fac)
      );
      if (doc) Object.keys(vals).forEach(k => { doc[k] = vals[k]; });
    }
  });

  if (entityType === 'document') changedEntityName = f(_editState.document,'Name') || entityName;
  const changedFacility = entityType === 'document'
    ? _fac
    : _cascadeEntityRename(entityType, entityName, changedEntityName, _fac);
  _logChange(entityType, changedEntityName, changedFacility, entityName);
  refreshDisplay();
  if (_pendingNewType) {
    const _pt = _pendingNewType; _pendingNewType = null;
    document.getElementById('edit-modal').addEventListener('hidden.bs.modal', () => {
      openCreateModal('type', _pt.name, _pt.facility);
    }, { once: true });
  }
  bootstrap.Modal.getInstance(document.getElementById('edit-modal'))?.hide();
}

function _updateCompSystems(compName, newSystems, fac) {
  const cLow = compName.toLowerCase();
  idx.systems.forEach(sysName => {
    const rows = db.systems.filter(s => f(s,'Name') === sysName && (!fac || s._facility === fac));
    const shouldHave = newSystems.has(sysName);
    rows.forEach(s => {
      const ck = s.ComponentNames !== undefined ? 'ComponentNames' : 'Component Names';
      const list = (s[ck]||'').split(',').map(x=>x.trim()).filter(Boolean);
      const has = list.some(x=>x.toLowerCase()===cLow);
      if (shouldHave && !has) list.push(compName);
      if (!shouldHave && has) { const i=list.findIndex(x=>x.toLowerCase()===cLow); list.splice(i,1); }
      s[ck] = list.join(',');
    });
    if (shouldHave && !rows.length) {
      const facVal = fac || (db.components.find(c=>f(c,'Name')===compName)||{})?._facility||'';
      db.systems.push({ Name: sysName, ComponentNames: compName, _facility: facVal });
    }
  });
}

function _updateSysComponents(sysName, newComps, fac) {
  const rows = db.systems.filter(s => f(s,'Name') === sysName && (!fac || s._facility === fac));
  if (rows.length) {
    rows.forEach((row, index) => {
      const key = row.ComponentNames !== undefined ? 'ComponentNames' : 'Component Names';
      row[key] = index === 0 ? newComps.join(',') : '';
    });
  } else if (newComps.length) {
    db.systems.push({ Name: sysName, ComponentNames: newComps.join(','), _facility: fac || db.facilities[0]?._facility||'' });
  }
}
