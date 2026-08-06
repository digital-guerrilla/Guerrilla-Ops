// ── Entity creation engine ────────────────────────────────────
let _createType = 'space';

function openCreateModal(entityType, prefillName, prefillFac) {
  _createType = entityType || 'space';
  if (typeof resetComponentPlacementDraft === 'function') resetComponentPlacementDraft('create');
  const facSel = document.getElementById('create-fac-sel');
  const facRow = document.getElementById('create-fac-row');
  facSel.innerHTML = db.facilities.map(fac =>
    `<option value="${esc(fac._facility)}"${fac._facility===prefillFac?' selected':''}>${esc(fac._facility)}</option>`
  ).join('');
  facRow.classList.toggle('d-none', db.facilities.length <= 1);
  switchCreateType(_createType, prefillName || '');
  new bootstrap.Modal(document.getElementById('create-modal')).show();
}

function switchCreateType(type, prefillName) {
  _createType = type;
  prefillName = prefillName || '';
  const icons  = {space:'bi-grid-fill',type:'bi-tag-fill',component:'bi-tools',system:'bi-diagram-3-fill',contact:'bi-person-fill'};
  const titles = {space:'New Room / Space',type:'New Type',component:'New Component',system:'New System',contact:'New Contact'};
  document.querySelectorAll('.create-type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.etype === type));
  document.getElementById('create-modal-icon').className = `bi ${icons[type]||'bi-plus-circle'} me-2`;
  document.getElementById('create-modal-title').textContent = titles[type] || 'Create New';
  document.getElementById('create-form-body').innerHTML = _buildCreateForm(type, prefillName);
}

function _buildCreateForm(type, prefillName) {
  prefillName = prefillName || '';
  const lbl = 'style="font-size:.71rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666"';
  const cf = (label, field, val='', ph='') =>
    `<div class="mb-2"><label class="d-block mb-1" ${lbl}>${label}</label>
     <input type="text" class="form-control form-control-sm create-field" data-field="${esc(field)}"
       value="${esc(String(val))}" placeholder="${esc(ph)}" autocomplete="off"></div>`;
  const cta = (label, field, val='', opts=[], maxOpts=400) => {
    const lid = 'cdl_' + field.replace(/[^a-z0-9]/gi,'_');
    const items = opts.slice(0,maxOpts).map(o => typeof o==='string'
      ? `<option value="${esc(o)}">`
      : `<option value="${esc(o.name)}">${esc(o.desc||'')}</option>`).join('');
    return `<div class="mb-2"><label class="d-block mb-1" ${lbl}>${label}</label>
      <input type="text" class="form-control form-control-sm create-field" data-field="${esc(field)}"
        value="${esc(String(val))}" list="${lid}" autocomplete="off">
      <datalist id="${lid}">${items}</datalist></div>`;
  };
  const csel = (label, field, opts=[]) => {
    const items = opts.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<div class="mb-2"><label class="d-block mb-1" ${lbl}>${label}</label>
      <select class="form-select form-select-sm create-field" data-field="${esc(field)}">
        <option value="">— none —</option>${items}</select></div>`;
  };
  const carea = (label, field, ph='') =>
    `<div class="mb-2"><label class="d-block mb-1" ${lbl}>${label}</label>
     <textarea class="form-control form-control-sm create-field" data-field="${esc(field)}"
       rows="3" placeholder="${esc(ph)}"></textarea></div>`;

  if (type === 'space') {
    return `<div class="row g-3"><div class="col-md-6">
      ${cf('Name *','Name',prefillName,'e.g. GF-001')}
      ${cta('Category','Category','',picklistCategoryValues('space'),Infinity)}
      ${csel('Floor','FloorName',idx.floors||[])}
      ${cf('Room Tag','RoomTag')}
    </div><div class="col-md-6">
      ${carea('Description','Description','Room / space description')}
      ${cf('Usable Height','UsableHeight')}
      ${cf('Gross Area','GrossArea')}
      ${cf('Net Area','NetArea')}
    </div></div>`;
  }
  if (type === 'type') {
    const cats = picklistCategoryValues('type');
    return `<div class="row g-3"><div class="col-md-6">
      ${cf('Name *','Name',prefillName,'e.g. Air Handling Unit')}
      ${cta('Category','Category','',cats,Infinity)}
      ${cf('Asset Type','AssetType','','Fixed, Moveable, etc.')}
      ${cf('Manufacturer','Manufacturer')}
      ${cf('Model Number','ModelNumber')}
    </div><div class="col-md-6">
      ${carea('Description','Description','Plain-language description of this type…')}
      ${cf('Warranty Guarantor (Parts)','WarrantyGuarantorParts')}
      ${cf('Warranty Duration (Parts)','WarrantyDurationParts')}
      ${cf('Warranty Guarantor (Labour)','WarrantyGuarantorLabor')}
      ${cf('Warranty Duration (Labour)','WarrantyDurationLabor')}
    </div></div>`;
  }
  if (type === 'component') {
    const typeDescs = idx.types.map(n => {
      const t = db.types.find(x => f(x,'Name')===n);
      return { name:n, desc: t ? f(t,'Description') : '' };
    });
    const spaceMap = new Map();
    db.spaces.forEach(s => { const n=f(s,'Name'); if(n && !spaceMap.has(n)) spaceMap.set(n, f(s,'Description')); });
    const spaceDescs = [...spaceMap.entries()].map(([name,desc])=>({name,desc}));
    return `<div class="row g-3"><div class="col-md-6">
      ${cf('Name *','Name',prefillName,'e.g. AHU-01')}
      ${cta('Type (TypeName)','TypeName','',typeDescs)}
      ${renderComponentSpaceField('create', '', spaceDescs)}
      ${cf('Description','Description')}
    </div><div class="col-md-6">
      ${cf('Assembly Type','AssemblyType')}
      ${cf('Serial Number','SerialNumber')}
      ${cf('Installation Date','InstallationDate','','YYYY-MM-DD')}
      ${cf('Tag Number','TagNumber')}
    </div></div>`;
  }
  if (type === 'system') {
    const cats = picklistCategoryValues('system');
    const compList = [...new Set(db.components.map(c=>f(c,'Name')))].sort().map(cn =>
      `<label class="d-flex align-items-center gap-1 mb-1" style="font-size:.79rem">
        <input type="checkbox" class="form-check-input create-comp-chk" value="${esc(cn)}"> ${esc(cn)}
      </label>`).join('');
    return `<div class="row g-3"><div class="col-md-6">
      ${cf('Name *','Name',prefillName,'e.g. Mechanical Ventilation')}
      ${cta('Category','Category','',cats,Infinity)}
      ${carea('Description','Description','System description…')}
    </div><div class="col-md-6">
      <div class="mb-2"><label class="d-block mb-1" ${lbl}>Components</label>
        <input type="search" placeholder="Filter components…" class="form-control form-control-sm mb-1" style="font-size:.77rem"
          oninput="_filterCheckboxList(this)">
        <div style="max-height:170px;overflow-y:auto;border:1px solid #dee2e6;border-radius:4px;padding:.35rem .5rem">
          ${compList||'<span class="text-muted small">No components loaded yet.</span>'}
        </div>
      </div>
    </div></div>`;
  }
  if (type === 'contact') {
    const cats = [...new Set((db.contacts||[]).map(c=>f(c,'Category')).filter(Boolean))].sort();
    return `<div class="row g-3"><div class="col-md-6">
      ${cf('Name / Unique ID *','Name',prefillName,'Usually the email address in COBie')}
      ${cf('Given Name','GivenName')}
      ${cf('Family Name','FamilyName')}
      ${cf('Email','Email')}
      ${cf('Phone','Phone')}
    </div><div class="col-md-6">
      ${cf('Company / Organisation','Company')}
      ${cta('Category','Category','',cats)}
      ${cf('Department','Department')}
      ${cf('Organisation Code','OrganizationCode')}
      ${cf('Town / City','Town')}
      ${cf('Country','Country')}
    </div></div>`;
  }
  return '<p class="text-muted small">Select an entity type above.</p>';
}

function saveCreate() {
  const type = _createType;
  const facEl = document.getElementById('create-fac-sel');
  const fac   = db.facilities.length <= 1
    ? (db.facilities[0]?._facility || '')
    : (facEl?.value || db.facilities[0]?._facility || '');

  const fields = {};
  document.querySelectorAll('#create-form-body .create-field').forEach(el => {
    if (el.dataset.field) fields[el.dataset.field] = el.value;
  });

  const name  = (fields.Name || '').trim();
  const today = new Date().toISOString().slice(0,10);
  const base  = { CreatedBy:'', CreatedOn:today, ExtSystem:'', ExtObject:'', ExtIdentifier:'', _facility:fac };

  if (type === 'space') {
    if (!name) { alert('Name is required.'); return; }
    if (db.spaces.some(s => f(s,'Name')===name && s._facility===fac)) { alert(`Space "${name}" already exists in this facility.`); return; }
    db.spaces.push({ ...base, Name:name, Category:fields.Category||'', FloorName:fields.FloorName||'',
      Description:fields.Description||'', RoomTag:fields.RoomTag||'',
      UsableHeight:fields.UsableHeight||'', GrossArea:fields.GrossArea||'', NetArea:fields.NetArea||'' });

  } else if (type === 'type') {
    if (!name) { alert('Name is required.'); return; }
    if (db.types.some(t => f(t,'Name')===name && t._facility===fac)) { alert(`Type "${name}" already exists in this facility.`); return; }
    db.types.push({ ...base, Name:name, Category:fields.Category||'', Description:fields.Description||'',
      AssetType:fields.AssetType||'', Manufacturer:fields.Manufacturer||'', ModelNumber:fields.ModelNumber||'',
      WarrantyGuarantorParts:fields.WarrantyGuarantorParts||'', WarrantyDurationParts:fields.WarrantyDurationParts||'',
      WarrantyGuarantorLabor:fields.WarrantyGuarantorLabor||'', WarrantyDurationLabor:fields.WarrantyDurationLabor||'',
      WarrantyDurationUnit:'', Reference:'' });

  } else if (type === 'component') {
    if (!name) { alert('Name is required.'); return; }
    if (db.components.some(c => f(c,'Name')===name && c._facility===fac)) { alert(`Component "${name}" already exists in this facility.`); return; }
    db.components.push({ ...base, Name:name, TypeName:fields.TypeName||'', Space:fields.Space||'',
      Description:fields.Description||'', AssemblyType:fields.AssemblyType||'',
      SerialNumber:fields.SerialNumber||'', InstallationDate:fields.InstallationDate||'', TagNumber:fields.TagNumber||'' });
    const newTN = (fields.TypeName||'').trim();
    if (newTN && !db.types.some(t => f(t,'Name')===newTN && t._facility===fac)) {
      _pendingNewType = { name: newTN, facility: fac };
    }
    const appliedPlacement = typeof _componentPlacementConsumeApplied === 'function'
      ? _componentPlacementConsumeApplied('create')
      : null;
    if (typeof _writeComponentCoordinates === 'function' && appliedPlacement?.spaceName) {
      _writeComponentCoordinates(fac, name, appliedPlacement);
      resetComponentPlacementDraft();
    }

  } else if (type === 'system') {
    if (!name) { alert('Name is required.'); return; }
    if (db.systems.some(s => f(s,'Name')===name && s._facility===fac)) { alert(`System "${name}" already exists in this facility.`); return; }
    const compNames = [...document.querySelectorAll('#create-form-body .create-comp-chk:checked')].map(el=>el.value).join(',');
    db.systems.push({ ...base, Name:name, Category:fields.Category||'', Description:fields.Description||'',
      ComponentNames:compNames });

  } else if (type === 'contact') {
    if (!name) { alert('Name / unique ID is required.'); return; }
    if (!db.contacts) db.contacts = [];
    if (db.contacts.some(c => f(c,'Name')===name && c._facility===fac)) { alert(`Contact "${name}" already exists in this facility.`); return; }
    db.contacts.push({ ...base, Name:name, GivenName:fields.GivenName||'', FamilyName:fields.FamilyName||'',
      Email:fields.Email||'', Phone:fields.Phone||'', Company:fields.Company||'', Category:fields.Category||'',
      Department:fields.Department||'', OrganizationCode:fields.OrganizationCode||'',
      Town:fields.Town||'', Country:fields.Country||'' });
  }

  _logChange(type, name, fac);
  if (type === 'type' || type === 'space' || type === 'system') {
    _justCreated.add(type + '::' + name.toLowerCase());
  }
  refreshDisplay();
  if (type === 'component' && !allExpanded) toggleExpandAll();
  const pendingType = _pendingNewType; _pendingNewType = null;
  bootstrap.Modal.getInstance(document.getElementById('create-modal'))?.hide();
  if (pendingType) {
    setTimeout(() => openCreateModal('type', pendingType.name, pendingType.facility), 400);
  }
}
