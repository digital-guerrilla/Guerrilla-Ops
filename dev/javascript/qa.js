// ── Workbook quality audit ────────────────────────────────────
const QA_CHECKS = {
  'facility-cardinality': { label:'Workbook does not have exactly one Facility row', sev:'error', sheet:'Facility', ico:'bi-building' },
  'key-missing':       { label:'Rows with a blank Name',                sev:'error',   sheet:'Multiple',  ico:'bi-key' },
  'comp-no-type':      { label:'Component has no Type',                 sev:'error',   sheet:'Component', ico:'bi-tools' },
  'comp-bad-type':     { label:'Component references unknown Type',     sev:'error',   sheet:'Component', ico:'bi-tools' },
  'comp-no-space':     { label:'Component has no Space',                sev:'error',   sheet:'Component', ico:'bi-tools' },
  'comp-bad-space':    { label:'Component references unknown Space',    sev:'error',   sheet:'Component', ico:'bi-tools' },
  'space-bad-floor':   { label:'Space has missing or unknown Floor',    sev:'error',   sheet:'Space',     ico:'bi-grid-fill' },
  'sys-bad-comp':      { label:'System references unknown Component',   sev:'error',   sheet:'System',    ico:'bi-diagram-3-fill' },
  'doc-bad-ref':       { label:'Document points at a missing row',      sev:'error',   sheet:'Document',  ico:'bi-file-earmark-text' },
  'dup-names':         { label:'Duplicate names in one sheet',          sev:'error',   sheet:'Multiple',  ico:'bi-files' },
  'createdby-missing': { label:'CreatedBy not in Contact sheet',        sev:'error',   sheet:'Multiple',  ico:'bi-person-fill' },
  'comp-no-system':    { label:'Component belongs to no System',        sev:'warning', sheet:'Component', ico:'bi-diagram-3-fill' },
  'type-no-category':  { label:'Type has no classification',            sev:'warning', sheet:'Type',      ico:'bi-tag-fill' },
  'space-no-category': { label:'Space has no classification',           sev:'warning', sheet:'Space',     ico:'bi-grid-fill' },
  'warranty-unit':     { label:'Warranty duration has no unit',         sev:'warning', sheet:'Type',      ico:'bi-tag-fill' },
};
// COBie sheets this app does not parse — skip, never flag
const _QA_UNPARSED_SHEETS = new Set(['zone','assembly','spare','resource','job','impact','connection','issue']);
const _QA_EDITABLE = new Set(['component','type','space','system','floor','facility']);
let qaFindings = [];
let qaScopeCounts = { comps:0, spaces:0, types:0, docs:0 };

function qaRaw(row, ...names) {
  for (const n of names) { const s = String(row[n] ?? '').trim(); if (s) return s; }
  return '';
}
function qaIsNA(s) { return s.toLowerCase() === 'n/a'; }

function runQA() {
  const facSel = sel.facility;
  const inScope = r => !facSel.size || facSel.has((r._facility||'').toLowerCase());
  const S = {
    comps:    db.components.filter(inScope),
    types:    db.types.filter(inScope),
    spaces:   db.spaces.filter(inScope),
    floors:   db.floors.filter(inScope),
    systems:  db.systems.filter(inScope),
    docs:     db.documents.filter(inScope),
    contacts: (db.contacts||[]).filter(inScope),
  };
  qaScopeCounts = { comps: S.comps.length, spaces: S.spaces.length, types: S.types.length, docs: S.docs.length };

  const nameSet = rows => {
    const m = {};
    rows.forEach(r => {
      const fac = (r._facility||'').toLowerCase();
      const n = f(r,'Name').toLowerCase();
      if (!n) return;
      (m[fac] = m[fac] || new Set()).add(n);
    });
    return m;
  };
  const typeNames  = nameSet(S.types);
  const spaceNames = nameSet(S.spaces);
  const floorNames = nameSet(S.floors);
  const compNames  = nameSet(S.comps);
  const contactIds = {};
  S.contacts.forEach(c => {
    const fac = (c._facility||'').toLowerCase();
    const set = (contactIds[fac] = contactIds[fac] || new Set());
    const n = f(c,'Name').toLowerCase(), e = f(c,'Email').toLowerCase();
    if (e) set.add(e); else if (n) set.add(n);
  });

  const out = [];
  const add = (check, entityType, entityName, facility, detail) =>
    out.push({ check, sev: QA_CHECKS[check].sev, entityType, entityName, facility, detail });

  // Facility cardinality
  db.facilities.filter(inScope).forEach(fac => {
    const n = fac._facRowCount;
    if (n === undefined) return;
    if (n === 0)
        add('facility-cardinality','facility',fac._facility||_facilityWorkbookSourceInfo(fac).value || fac._fileName,fac._facility||'',
        `"${_facilityWorkbookSourceInfo(fac).value || fac._fileName}" has no Facility row.`);
    else if (n > 1)
      add('facility-cardinality','facility',fac._facility||'',fac._facility||'',
        `"${_facilityWorkbookSourceInfo(fac).value || fac._fileName}" has ${n} Facility rows; only the first is read.`);
    if (n >= 1 && !f(fac,'Name'))
      add('key-missing','sheet','Facility sheet',fac._facility||'',
        `Facility row has a blank Name — ${_facilityWorkbookSourceInfo(fac).kind.toLowerCase()} "${_facilityWorkbookSourceInfo(fac).value || fac._fileName}" is standing in for it.`);
  });

  // Blank keys
  [['Component',S.comps,null],['Type',S.types,null],['Space',S.spaces,null],['Floor',S.floors,null],
   ['System',S.systems,null],['Document',S.docs,null],
   ['Contact',S.contacts,r => f(r,'Email')||f(r,'Name')]]
  .forEach(([sheetName, rows, keyFn]) => {
    const blank = {};
    rows.forEach(r => {
      if (keyFn ? keyFn(r) : f(r,'Name')) return;
      const fac = r._facility||'';
      blank[fac] = (blank[fac]||0)+1;
    });
    Object.entries(blank).forEach(([fac, n]) =>
      add('key-missing','sheet',sheetName+' sheet',fac,`${n} row${n!==1?'s':''} with a blank ${sheetName==='Contact'?'Email':'Name'}.`));
  });

  const facDisp = {};
  [S.comps,S.types,S.spaces,S.floors,S.systems,S.docs,S.contacts].forEach(rows =>
    rows.forEach(r => { const l=(r._facility||'').toLowerCase(); if (l && !facDisp[l]) facDisp[l]=r._facility; }));
  const missingRefs = {};
  const tally = (facL, k, v) => {
    const m = (missingRefs[facL] = missingRefs[facL] || { type:0, space:0, floor:0, syscomp:0, createdby:new Set() });
    if (k === 'createdby') m.createdby.add(v); else m[k] += (v||1);
  };

  const noRefMsg = (field, raw) => raw
    ? `${field} is explicitly "n/a" — this relationship cannot be n/a at handover.`
    : `${field} is blank.`;
  S.comps.forEach(c => {
    const name = f(c,'Name'), fac = c._facility||'', facL = fac.toLowerCase();
    if (!name) return;
    const tn = qaRaw(c,'TypeName','Type Name');
    if (!tn || qaIsNA(tn)) add('comp-no-type','component',name,fac,noRefMsg('TypeName',tn));
    else if (!typeNames[facL]) tally(facL,'type');
    else if (!typeNames[facL].has(tn.toLowerCase()))
      add('comp-bad-type','component',name,fac,`TypeName "${tn}" is not in the Type sheet.`);

    const spRaw = qaRaw(c,'Space');
    if (!spRaw || qaIsNA(spRaw)) add('comp-no-space','component',name,fac,noRefMsg('Space',spRaw));
    else if (!spaceNames[facL]) tally(facL,'space');
    else if (!spaceNames[facL].has(spRaw.toLowerCase())) {
      const missing = spRaw.split(',').map(x=>x.trim()).filter(Boolean)
        .filter(t => !spaceNames[facL].has(t.toLowerCase()));
      if (missing.length)
        add('comp-bad-space','component',name,fac,`Space "${missing.join('", "')}" is not in the Space sheet.`);
    }
  });

  const catMsg = raw => raw
    ? 'Category is explicitly "n/a" — classification not available.'
    : 'Category is blank.';
  S.spaces.forEach(s => {
    const name = f(s,'Name'), fac = s._facility||'', facL = fac.toLowerCase();
    if (!name) return;
    const fl = qaRaw(s,'FloorName','Floor Name','Floor');
    if (!fl || qaIsNA(fl)) add('space-bad-floor','space',name,fac,noRefMsg('FloorName',fl));
    else if (!floorNames[facL]) tally(facL,'floor');
    else if (!floorNames[facL].has(fl.toLowerCase()))
      add('space-bad-floor','space',name,fac,`FloorName "${fl}" is not in the Floor sheet.`);
    const cat = qaRaw(s,'Category');
    if (!cat || qaIsNA(cat)) add('space-no-category','space',name,fac,catMsg(cat));
  });

  S.types.forEach(t => {
    const name = f(t,'Name'), fac = t._facility||'';
    if (!name) return;
    const cat = qaRaw(t,'Category');
    if (!cat || qaIsNA(cat)) add('type-no-category','type',name,fac,catMsg(cat));
    const wd = [qaRaw(t,'WarrantyDurationParts','Warranty Duration Parts'),
                qaRaw(t,'WarrantyDurationLabor','Warranty Duration Labor','WarrantyDurationLabour')]
      .find(x => x && !qaIsNA(x));
    const wu = qaRaw(t,'WarrantyDurationUnit','Warranty Duration Unit');
    if (wd && (!wu || qaIsNA(wu)))
      add('warranty-unit','type',name,fac,`Warranty duration "${wd}" has no WarrantyDurationUnit.`);
  });

  const inSystem = {};
  S.systems.forEach(s => {
    const facL = (s._facility||'').toLowerCase();
    const set = (inSystem[facL] = inSystem[facL] || new Set());
    qaRaw(s,'ComponentNames','Component Names').split(',').map(x=>x.trim()).filter(Boolean)
      .forEach(cn => set.add(cn.toLowerCase()));
  });
  const noSysFacs = {};
  S.comps.forEach(c => {
    const name = f(c,'Name'), fac = c._facility||'', facL = fac.toLowerCase();
    if (!name) return;
    if (!inSystem[facL] || !inSystem[facL].size) { noSysFacs[facL] = (noSysFacs[facL]||0)+1; return; }
    if (!inSystem[facL].has(name.toLowerCase()))
      add('comp-no-system','component',name,fac,'Not listed in any System\'s ComponentNames.');
  });
  Object.entries(noSysFacs).forEach(([facL, n]) =>
    add('comp-no-system','sheet','System sheet',facDisp[facL]||facL,
      `System sheet is missing or empty — none of the ${n} component${n!==1?'s':''} belongs to a system.`));

  const seenSysComp = new Set();
  S.systems.forEach(s => {
    const name = f(s,'Name'), fac = s._facility||'', facL = fac.toLowerCase();
    if (!name) return;
    const toks = qaRaw(s,'ComponentNames','Component Names').split(',').map(x=>x.trim())
      .filter(Boolean).filter(cn => !qaIsNA(cn));
    if (!compNames[facL]) { if (toks.length) tally(facL,'syscomp',toks.length); return; }
    toks.forEach(cn => {
      if (compNames[facL].has(cn.toLowerCase())) return;
      const k = facL+'::'+name.toLowerCase()+'::'+cn.toLowerCase();
      if (seenSysComp.has(k)) return;
      seenSysComp.add(k);
      add('sys-bad-comp','system',name,fac,`ComponentNames entry "${cn}" is not in the Component sheet.`);
    });
  });

  const rowSets = { facility: nameSet(db.facilities.filter(inScope).map(x=>({ Name:x._facility, _facility:x._facility }))),
    floor: floorNames, space: spaceNames, type: typeNames, component: compNames, system: nameSet(S.systems),
    contact: contactIds };
  S.docs.forEach(d => {
    const fac = d._facility||'', facL = fac.toLowerCase();
    const sheetDisp = _cobieField(d, 'sheetName');
    const sheet = sheetDisp.toLowerCase();
    const row   = _cobieField(d, 'rowName');
    if (!sheet || !row) return;
    const docName = f(d,'Name')||f(d,'File')||'(Unnamed)';
    if (sheet in rowSets) {
      const set = rowSets[sheet][facL];
      if (!set)
        add('doc-bad-ref','document',docName,fac,
          `References the ${sheetDisp} sheet, which is missing or empty.`);
      else if (!set.has(row.toLowerCase()))
        add('doc-bad-ref','document',docName,fac,
          `SheetName "${sheetDisp}" has no row named "${row}".`);
    } else if (!_QA_UNPARSED_SHEETS.has(sheet)) {
      add('doc-bad-ref','document',docName,fac,
        `SheetName "${sheetDisp}" is not a COBie sheet.`);
    }
  });

  [['Component',S.comps,'component',null],['Type',S.types,'type',null],
   ['Space',S.spaces,'space',null],['Floor',S.floors,'floor',null],
   ['Contact',S.contacts,'contact',r => f(r,'Email')||f(r,'Name')]]
  .forEach(([sheetName, rows, etype, keyFn]) => {
    const cnt = {};
    rows.forEach(r => {
      const n = keyFn ? keyFn(r) : f(r,'Name'); if (!n) return;
      const k = (r._facility||'').toLowerCase()+'::'+n.toLowerCase();
      cnt[k] = cnt[k] || { n, fac: r._facility||'', c: 0 };
      cnt[k].c++;
    });
    Object.values(cnt).filter(x => x.c > 1).forEach(x =>
      add('dup-names',etype,x.n,x.fac,`${sheetName} sheet has ${x.c} rows named "${x.n}".`));
  });

  const seenCB = new Set();
  [['Component',S.comps],['Type',S.types],['Space',S.spaces],['Floor',S.floors],
   ['System',S.systems],['Document',S.docs],['Contact',S.contacts],
   ['Facility',db.facilities.filter(inScope)]]
  .forEach(([sheetName, rows]) => {
    rows.forEach(r => {
      const fac = r._facility||'', facL = fac.toLowerCase();
      const cb = qaRaw(r,'CreatedBy','Created By');
      if (!cb || qaIsNA(cb)) return;
      if (!contactIds[facL] || !contactIds[facL].size) { tally(facL,'createdby',cb.toLowerCase()); return; }
      if (contactIds[facL].has(cb.toLowerCase())) return;
      const k = facL+'::'+cb.toLowerCase();
      if (seenCB.has(k)) return;
      seenCB.add(k);
      add('createdby-missing','contact',cb,fac,`Used as CreatedBy (first seen on the ${sheetName} sheet) but not in the Contact sheet.`);
    });
  });

  Object.entries(missingRefs).forEach(([facL, m]) => {
    const fac = facDisp[facL] || facL;
    const plural = (n, w) => `${n} ${w}${n!==1?'s':''}`;
    if (m.type)  add('comp-bad-type','sheet','Type sheet',fac,
      `Type sheet is missing or empty — ${plural(m.type,'component reference')} cannot resolve.`);
    if (m.space) add('comp-bad-space','sheet','Space sheet',fac,
      `Space sheet is missing or empty — ${plural(m.space,'component reference')} cannot resolve.`);
    if (m.floor) add('space-bad-floor','sheet','Floor sheet',fac,
      `Floor sheet is missing or empty — ${plural(m.floor,'space')} cannot resolve a floor.`);
    if (m.syscomp) add('sys-bad-comp','sheet','Component sheet',fac,
      `Component sheet is missing or empty — ${plural(m.syscomp,'system reference')} cannot resolve.`);
    if (m.createdby.size) add('createdby-missing','sheet','Contact sheet',fac,
      `Contact sheet is missing or empty — ${plural(m.createdby.size,'distinct CreatedBy value')} cannot resolve.`);
  });

  return out;
}

// ── QA rendering and report export ───────────────────────────
function renderQAMode(list) {
  qaFindings = runQA();
  const bySev = { error:0, warning:0, info:0 };
  qaFindings.forEach(x => bySev[x.sev]++);

  const facSel = sel.facility;
  const scopeTxt = facSel.size
    ? 'Auditing: ' + [...facSel].map(k => idx.facilityNames.find(n=>n.toLowerCase()===k)||k).join(', ')
    : 'Auditing all loaded facilities';
  const summary = `<div id="qa-summary">
    <span class="qa-sev qa-sev-error">${bySev.error} error${bySev.error!==1?'s':''}</span>
    <span class="qa-sev qa-sev-warning">${bySev.warning} warning${bySev.warning!==1?'s':''}</span>
    ${bySev.info?`<span class="qa-sev qa-sev-info">${bySev.info} info</span>`:''}
    <span class="qa-scope">${esc(scopeTxt)} — the Facility filter sets the scope; edits re-run the audit.</span>
    ${qaFindings.length?`<button class="xbtn" onclick="exportQAReport()"><i class="bi bi-download me-1"></i>Download Report</button>`:''}
  </div>`;

  if (!qaFindings.length) {
    list.innerHTML = summary + `<div class="qa-clear"><i class="bi bi-patch-check"></i>
      <p>No issues found across ${qaScopeCounts.comps} components, ${qaScopeCounts.spaces} spaces,
      ${qaScopeCounts.types} types and ${qaScopeCounts.docs} documents.</p></div>`;
    return;
  }

  const SEV_ORDER = { error:0, warning:1, info:2 };
  const byCheck = new Map();
  qaFindings.forEach(x => { if(!byCheck.has(x.check)) byCheck.set(x.check,[]); byCheck.get(x.check).push(x); });
  const checks = [...byCheck.keys()].sort((a,b) =>
    SEV_ORDER[QA_CHECKS[a].sev]-SEV_ORDER[QA_CHECKS[b].sev] || QA_CHECKS[a].label.localeCompare(QA_CHECKS[b].label));

  list.innerHTML = summary + checks.map(check => {
    const cfg = QA_CHECKS[check];
    const items = byCheck.get(check);
    const cid = 'col_' + (collapseCounter++);
    pendingGroups[cid] = { isQA: true, qaItems: items };
    return `<div class="grp-block grp-d0">
      <div class="grp-hdr grp-collapsed" data-cid="${cid}">
        <i class="bi bi-chevron-down grp-chev"></i>
        <i class="bi ${cfg.ico} me-1" style="opacity:.72;font-size:.82rem"></i>
        <span class="grp-name">${esc(cfg.label)}</span>
        <span class="grp-meta">${esc(cfg.sheet)} sheet</span>
        <span class="qa-sev qa-sev-${cfg.sev}">${cfg.sev}</span>
        <span class="grp-cnt">${items.length}</span>
      </div>
      <div class="grp-body grp-closed" id="${cid}"></div>
    </div>`;
  }).join('');
}

const QA_GROUP_CAP = 200;
function qaGroupBody(items) {
  const cards = items.slice(0, QA_GROUP_CAP).map(x => {
    const editBtn = _QA_EDITABLE.has(x.entityType)
      ? `<button class="xbtn" data-edit-entity="${esc(x.entityType)}" data-edit-key="${esc(x.entityName)}" data-edit-fac="${esc(x.facility)}" title="Edit and fix"><i class="bi bi-pencil"></i></button>`
      : '';
    return `<div class="cc qa-${x.sev}">
      <div class="d-flex align-items-start gap-2">
        <div style="flex:1;min-width:0">
          <div class="cc-name">${esc(x.entityName)}</div>
          <div class="cc-meta"><span>${esc(x.detail)}</span>${x.facility?`<span><i class="bi bi-building me-1"></i>${esc(x.facility)}</span>`:''}</div>
        </div>
        ${editBtn}
      </div>
    </div>`;
  }).join('');
  const rest = items.length - QA_GROUP_CAP;
  return cards + (rest > 0
    ? `<div class="load-more-wrap"><div class="load-more-btn" style="cursor:default">
        Showing ${QA_GROUP_CAP} of ${items.length} — download the report for the full list.</div></div>`
    : '');
}

function exportQAReport() {
  if (!qaFindings.length) return;
  const rows = qaFindings.map(x => ({
    Severity: x.sev, Check: QA_CHECKS[x.check].label, Sheet: QA_CHECKS[x.check].sheet,
    Item: x.entityName, Facility: x.facility, Detail: x.detail,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'QA Findings');
  XLSX.writeFile(wb, 'QA-Report_' + new Date().toISOString().slice(0,10) + '.xlsx');
}
