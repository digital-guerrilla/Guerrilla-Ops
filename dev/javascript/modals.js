// ── Entity information modal ──────────────────────────────────
const TYPE_FIELDS = [
  ['Category',              ['Category']],
  ['Description',           ['Description']],
  ['Asset Type',            ['AssetType','Asset Type']],
  ['Manufacturer',          ['Manufacturer']],
  ['Model No.',             ['ModelNumber','Model Number','ModelReference','Model Reference']],
  ['Colour',                ['Color','Colour']],
  ['Finish',                ['Finish']],
  ['Grade',                 ['Grade']],
  ['Material',              ['Material']],
  ['Shape',                 ['Shape']],
  ['Size',                  ['Size']],
  ['Sustainability',        ['Sustainability']],
  ['Nom. Length',           ['NominalLength','Nominal Length']],
  ['Nom. Width',            ['NominalWidth','Nominal Width']],
  ['Nom. Height',           ['NominalHeight','Nominal Height']],
  ['Nom. Depth',            ['NominalDepth','Nominal Depth']],
  ['Nom. Weight',           ['NominalWeight','Nominal Weight']],
  ['Code Performance',      ['CodePerformance','Code Performance']],
  ['Warranty (Parts)',      ['WarrantyGuarantorParts','Warranty Guarantor Parts']],
  ['Warranty Dur. (Parts)', ['WarrantyDurationParts','Warranty Duration Parts']],
  ['Warranty (Labour)',     ['WarrantyGuarantorLabor','Warranty Guarantor Labor','WarrantyGuarantorLabour','Warranty Guarantor Labour']],
  ['Warranty Dur. (Labour)',['WarrantyDurationLabor','Warranty Duration Labor','WarrantyDurationLabour']],
  ['Warranty Unit',         ['WarrantyDurationUnit','Warranty Duration Unit']],
  ['Expected Life',         ['ExpectedLife','Expected Life']],
  ['Life Duration Unit',    ['DurationUnit','Duration Unit']],
  ['Replacement Cost',      ['ReplacementCost','Replacement Cost']],
];

function buildDocSection(docs) {
  if (!docs.length) return '';
  const grp = new Map();
  docs.forEach(d => {
    const cat = f(d,'Category') || '(Uncategorised)';
    if (!grp.has(cat)) grp.set(cat,[]);
    grp.get(cat).push(d);
  });
  const cats = [...grp.keys()].sort((a,b) => { const pa=a.startsWith('('),pb=b.startsWith('('); return pa!==pb?(pa?1:-1):a.localeCompare(b); });
  let inner = cats.map(cat => {
    const catHdr = grp.size > 1 ? `<div class="doc-cat-label">${esc(cat)}</div>` : '';
    return catHdr + `<div class="doc-list">${grp.get(cat).map(d => _docListItem(d, true)).join('')}</div>`;
  }).join('');
  return `<div class="mt-3 pt-2 border-top">
    <div style="font-size:.78rem;font-weight:600;color:var(--navy);margin-bottom:.5rem">
      <i class="bi bi-folder2-open me-1"></i>Documents
    </div>
    <div>${inner}</div>
  </div>`;
}

function openGroupInfo(dim, name, facility) {
  document.getElementById('mtype-icon').className  = `bi ${_GRP_ICONS[dim]||'bi-info-circle'} me-2`;
  document.getElementById('mtype-title').textContent = name;

  let body = '';
  if (dim === 'type') {
    const t = db.types.find(x => f(x,'Name').toLowerCase() === name.toLowerCase() && (!facility || x._facility === facility));
    body = t ? buildTypeBody(t) : '<p class="text-muted small mb-0">Type not found.</p>';
  } else if (dim === 'system') {
    body = buildSystemBody(name, facility);
  } else if (dim === 'space') {
    body = buildSpaceBody(name, facility);
  } else if (dim === 'floor') {
    body = buildFloorBody(name, facility);
  } else if (dim === 'facility') {
    body = buildFacilityBody(name);
  }
  document.getElementById('mtype-body').innerHTML = body;
  new bootstrap.Modal(document.getElementById('type-modal')).show();
}

function _attributeRows(entity, widthPx) {
  const attrs = Object.entries(entity?._attrs || {})
    .filter(([, value]) => value)
    .sort(([a], [b]) => a.localeCompare(b));
  return attrs.map(([name, value]) =>
    `<tr><td style="width:${widthPx}px;color:#888;white-space:nowrap;font-size:.81rem">Attribute: ${esc(name)}</td><td style="font-size:.83rem">${renderAttributeValue(value, name)}</td></tr>`
  ).join('');
}

function buildTypeBody(t) {
  const nm = f(t,'Name');
  const facility = t._facility || '';
  const baseRows = TYPE_FIELDS.map(([label, fields]) => {
    const val = f(t, ...fields);
    return val ? `<tr><td style="width:170px;color:#888;white-space:nowrap;font-size:.81rem">${esc(label)}</td><td style="font-size:.83rem">${esc(val)}</td></tr>` : '';
  }).filter(Boolean).join('');
  const rows = baseRows + _attributeRows(t, 170);
  return `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="type" data-edit-key="${esc(nm)}" data-edit-fac="${esc(facility)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit Type</button>` +
    (rows ? `<table class="table table-sm mb-0"><tbody>${rows}</tbody></table>`
    : '<p class="text-muted small mb-0">No additional type data.</p>') + buildDocSection(docsFor('Type', nm, facility));
}

function buildSystemBody(name, facility) {
  const s = db.systems.find(x => f(x,'Name').toLowerCase() === name.toLowerCase() && (!facility || x._facility === facility));
  const baseRows = s ? [['Category',f(s,'Category')],['Description',f(s,'Description')]]
    .filter(([,v])=>v).map(([k,v])=>`<tr><td style="width:130px;color:#888;font-size:.81rem">${esc(k)}</td><td style="font-size:.83rem">${esc(v)}</td></tr>`).join('') : '';
  const rows = s ? baseRows + _attributeRows(s, 130) : '';
  return `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="system" data-edit-key="${esc(name)}" data-edit-fac="${esc(facility)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit System</button>` +
    (rows ? `<table class="table table-sm mb-0"><tbody>${rows}</tbody></table>`
    : '<p class="text-muted small mb-0">No additional system data.</p>') + buildDocSection(docsFor('System', name, facility));
}

function buildSpaceBody(name, facility) {
  const FIELDS = [
    ['Floor',           ['FloorName','Floor Name','Floor']],
    ['Description',     ['Description']],
    ['Category',        ['Category']],
    ['Gross Area',      ['GrossArea','Gross Area']],
    ['Net Area',        ['NetArea','Net Area']],
    ['Usable Height',   ['UsableHeight','Usable Height']],
    ['Gross Perimeter', ['GrossPerimeter','Gross Perimeter']],
    ['Net Perimeter',   ['NetPerimeter','Net Perimeter']],
    ['Room Tag',        ['RoomTag','Room Tag']],
  ];
  const s = db.spaces.find(x => f(x,'Name').toLowerCase() === name.toLowerCase() && (!facility || x._facility === facility));
  const baseRows = s ? FIELDS.map(([l,fs])=>{const val=f(s,...fs);return val?`<tr><td style="width:150px;color:#888;font-size:.81rem">${esc(l)}</td><td style="font-size:.83rem">${esc(val)}</td></tr>`:''}).filter(Boolean).join('') : '';
  const rows = s ? baseRows + _attributeRows(s, 150) : '';
  return `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="space" data-edit-key="${esc(name)}" data-edit-fac="${esc(facility)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit Space</button>` +
    (rows ? `<table class="table table-sm mb-0"><tbody>${rows}</tbody></table>`
    : '<p class="text-muted small mb-0">No additional space data.</p>') + buildDocSection(docsFor('Space', name, facility));
}

function buildFloorBody(name, facility) {
  const FIELDS = [
    ['Category',    ['Category']],
    ['Description', ['Description']],
    ['Floor Type',  ['FloorType','Floor Type']],
    ['Height',      ['Height']],
    ['Elevation',   ['Elevation']],
  ];
  const fl = db.floors.find(x => f(x,'Name').toLowerCase() === name.toLowerCase() && (!facility || x._facility === facility));
  const baseRows = fl ? FIELDS.map(([l,fs])=>{const val=f(fl,...fs);return val?`<tr><td style="width:130px;color:#888;font-size:.81rem">${esc(l)}</td><td style="font-size:.83rem">${esc(val)}</td></tr>`:''}).filter(Boolean).join('') : '';
  const rows = fl ? baseRows + _attributeRows(fl, 130) : '';
  return `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="floor" data-edit-key="${esc(name)}" data-edit-fac="${esc(facility)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit Floor</button>` +
    (rows ? `<table class="table table-sm mb-0"><tbody>${rows}</tbody></table>`
    : '<p class="text-muted small mb-0">No additional floor data.</p>') + buildDocSection(docsFor('Floor', name, facility));
}

function buildFacilityBody(name) {
  const FIELDS = [
    ['Description',      ['Description']],
    ['Phase',            ['Phase']],
    ['Country Code',     ['CountryCode','Country Code']],
    ['Language Code',    ['LanguageCode','Language Code']],
    ['Currency Unit',    ['CurrencyUnit','Currency Unit']],
    ['Area Measure',     ['AreaMeasurement','Area Measurement']],
    ['Linear Unit',      ['LinearUnits','Linear Units']],
    ['Volume Unit',      ['VolumeUnits','Volume Units']],
    ['Postal Code',      ['PostalCode','Postal Code']],
    ['Town',             ['Town']],
    ['Region',           ['Region']],
  ];
  const fac = db.facilities.find(x => x._facility === name);
  const rows = fac ? FIELDS.map(([l,fs])=>{const val=f(fac,...fs);return val?`<tr><td style="width:140px;color:#888;font-size:.81rem">${esc(l)}</td><td style="font-size:.83rem">${esc(val)}</td></tr>`:''}).filter(Boolean).join('') : '';
  const attrRows = fac ? _attributeRows(fac, 140) : '';
  const fileRow = fac?._fileName ? `<tr><td style="width:140px;color:#888;font-size:.81rem">Source file</td><td style="font-size:.83rem"><code>${esc(fac._fileName)}</code></td></tr>` : '';
  const allRows = fileRow + rows + attrRows;
  return `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="facility" data-edit-key="${esc(name)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit Facility</button>` +
    (allRows ? `<table class="table table-sm mb-0"><tbody>${allRows}</tbody></table>`
    : '<p class="text-muted small mb-0">No additional facility data.</p>') + buildDocSection(docsFor('Facility', name));
}

function openComponentInfo(name, facility) {
  const compName = String(name || '').trim();
  const compFacility = String(facility || '').trim();
  if (!compName) return;

  const c = (compFacility
    ? db.components.find(x => f(x,'Name') === compName && x._facility === compFacility)
    : db.components.find(x => f(x,'Name') === compName)) || null;

  document.getElementById('mtype-icon').className = 'bi bi-tools me-2';
  document.getElementById('mtype-title').textContent = compName;

  if (!c) {
    document.getElementById('mtype-body').innerHTML = '<p class="text-muted small mb-0">Component not found.</p>';
    new bootstrap.Modal(document.getElementById('type-modal')).show();
    return;
  }

  const rows = [
    ['Type', f(c,'TypeName','Type Name')],
    ['Location', f(c,'Space')],
    ['Description', f(c,'Description')],
    ['Serial No.', f(c,'SerialNumber','Serial Number')],
    ['Tag No.', f(c,'TagNumber','Tag Number')],
    ['Barcode', f(c,'BarCode','Bar Code')],
    ['Asset ID', f(c,'AssetIdentifier','Asset Identifier')],
    ['Installed', fmtDate(c['InstallationDate'] || c['Installation Date'])],
    ['Warranty Start', fmtDate(c['WarrantyStartDate'] || c['Warranty Start Date'])],
  ].filter(([, val]) => val).map(([label, value]) =>
    `<tr><td style="width:170px;color:#888;white-space:nowrap;font-size:.81rem">${esc(label)}</td><td style="font-size:.83rem">${esc(value)}</td></tr>`
  ).join('');

  const allRows = rows + _attributeRows(c, 170);
  const docs = buildDocSection(docsFor('Component', compName, compFacility));
  const body = `<button class="btn btn-sm btn-outline-secondary mb-2 py-1" data-edit-entity="component" data-edit-key="${esc(compName)}" data-edit-fac="${esc(compFacility)}" style="font-size:.77rem"><i class="bi bi-pencil me-1"></i>Edit Component</button>` +
    (allRows ? `<table class="table table-sm mb-0"><tbody>${allRows}</tbody></table>` : '<p class="text-muted small mb-0">No additional component data.</p>') +
    docs;

  document.getElementById('mtype-body').innerHTML = body;
  new bootstrap.Modal(document.getElementById('type-modal')).show();
}

// ── Document information modal ────────────────────────────────
function openDoc(doc) {
  const name=f(doc,'Name'), dir=f(doc,'Directory'),
        desc=f(doc,'Description'), cat=f(doc,'Category');

  document.getElementById('mdoc-title').textContent = name||'Document';
  const lpath = _docTarget(dir), href = _docHref(lpath);

  const tRows = [
    ['Name',name&&esc(name)], ['Description',desc&&esc(desc)], ['Category',cat&&esc(cat)],
  ].filter(([,v])=>v).map(([k,v])=>
    `<tr><th style="width:110px;font-weight:500;color:#555">${k}</th><td>${v}</td></tr>`
  ).join('');

  const pathBlock = lpath ? `<div class="alert alert-secondary py-2 px-3 mt-3 d-flex align-items-center gap-2 mb-0" style="font-size:.79rem">
    <i class="bi bi-link-45deg"></i>
    <a href="${esc(href)}" target="_blank" rel="noopener" title="${esc(lpath)}" style="flex:1">Open document link</a>
    <button class="btn btn-sm btn-outline-secondary py-0 px-2 cp-btn" data-p="${esc(lpath)}" title="Copy path">
      <i class="bi bi-clipboard"></i></button>
    </div>` : '<p class="text-muted small mt-3 mb-0">No link has been added.</p>';

  document.getElementById('mdoc-body').innerHTML =
    `<table class="table table-sm mb-0"><tbody>${tRows}</tbody></table>${pathBlock}
     <div class="d-flex justify-content-end mt-3">${_docEditButton(doc, true)}</div>`;
  new bootstrap.Modal(document.getElementById('doc-modal')).show();
}
