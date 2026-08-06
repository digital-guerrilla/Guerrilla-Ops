// ── Document result grouping and cards ───────────────────────
function collectDocsForComps(comps) {
  const seen=new Set(), entries=[];
  const doneT=new Set(), doneSp=new Set(), doneSy=new Set(), doneFl=new Set(), doneFac=new Set();
  const addDoc = (doc, linkedType, linkedName, comp) => {
    const key = _docUniqueKey(doc);
    if(seen.has(key))return; seen.add(key);
    const sp  = comp ? f(comp,'Space').toLowerCase() : (linkedType==='space'?linkedName.toLowerCase():'');
    const facility = comp?._facility || doc._facility || '';
    const fl  = sp ? (idx.spFloor[_scopeKey(facility, sp)]||'') : '';
    const flN = fl ? (idx.floors.find(n=>n.toLowerCase()===fl)||fl) : '';
    const syss = comp ? (idx.compSys[_rowKey(comp, f(comp,'Name'))]||[]).map(sk=>idx.systems.find(n=>n.toLowerCase()===sk)||sk)
                      : (linkedType==='system'?[linkedName]:[]);
    entries.push({ doc, linkedType, linkedName,
      typeName:     comp?_cobieField(comp, 'typeName'):(linkedType==='type'?linkedName:''),
      spaceName:    comp?f(comp,'Space'):(linkedType==='space'?linkedName:''),
      facilityName: comp?(comp._facility||''):(linkedType==='facility'?linkedName:(doc._facility||'')),
      floorName:    flN, systemNames: syss });
  };
  comps.forEach(c => {
    const cn=f(c,'Name').toLowerCase(), tn=_cobieField(c, 'typeName').toLowerCase();
    const sp=f(c,'Space').toLowerCase(), fn=(c._facility||'').toLowerCase();
    const cKey=_rowKey(c,cn), tKey=_scopeKey(fn,tn), spKey=_scopeKey(fn,sp);
    docsFor('component',cn,c._facility).forEach(d=>addDoc(d,'component',f(c,'Name'),c));
    if(tn&&!doneT.has(tKey)){doneT.add(tKey);docsFor('type',tn,c._facility).forEach(d=>addDoc(d,'type',_cobieField(c, 'typeName'),null));}
    if(sp&&!doneSp.has(spKey)){doneSp.add(spKey);docsFor('space',sp,c._facility).forEach(d=>addDoc(d,'space',f(c,'Space'),c));}
    const floorKey = idx.spFloor[_scopeKey(fn,sp)] || '';
    const scopedFloorKey = _scopeKey(fn,floorKey);
    if(floorKey&&!doneFl.has(scopedFloorKey)){
      doneFl.add(scopedFloorKey);
      const floorName=idx.floors.find(name=>name.toLowerCase()===floorKey)||floorKey;
      docsFor('floor',floorKey,c._facility).forEach(d=>addDoc(d,'floor',floorName,c));
    }
    if(fn&&!doneFac.has(fn)){doneFac.add(fn);docsFor('facility',fn,c._facility).forEach(d=>addDoc(d,'facility',c._facility||'',null));}
    (idx.compSys[cKey]||[]).forEach(sk=>{
      const sysKey=_scopeKey(fn,sk);
      if(doneSy.has(sysKey))return; doneSy.add(sysKey);
      const sn=idx.systems.find(n=>n.toLowerCase()===sk)||sk;
      docsFor('system',sk,c._facility).forEach(d=>addDoc(d,'system',sn,null));
    });
  });
  return entries;
}

function renderDocumentMode(list, entries) {
  if(!entries.length){
    list.innerHTML=`<div class="empty"><i class="bi bi-folder-x"></i><p>No documents found for the current filters.</p></div>`;
    return;
  }
  const dims = groupState.order.filter(d => groupState.active.has(d));
  list.innerHTML = dims.length ? groupDocsNested(entries, dims) : renderDocsByCat(entries);
}

function _docEntryValues(entry, dimension) {
  const values = {
    type:entry.typeNames, space:entry.spaceNames, facility:entry.facilityNames,
    floor:entry.floorNames, system:entry.systemNames,
  }[dimension];
  if (values?.length) return values;
  if (dimension === 'doccat') return [f(entry.doc,'Category') || '(Uncategorised)'];
  const labels = {type:'Type',space:'Space',facility:'Facility',floor:'Floor',system:'System'};
  return [`(No ${labels[dimension] || 'Value'})`];
}

function groupDocsNested(entries, dims, depth = 0) {
  if(!dims.length||!entries.length) return renderDocsByCat(entries);
  const [dim,...rest] = dims;
  if (dim === 'doccat') return groupDocsByClassification(entries, rest, depth);
  const map = new Map();
  entries.forEach(e => {
    const ks = _docEntryValues(e, dim);
    ks.forEach(k=>{ if(!map.has(k))map.set(k,[]); map.get(k).push(e); });
  });
  const ico = {type:'bi-tag-fill',system:'bi-diagram-3-fill',space:'bi-grid-fill',floor:'bi-layers-fill',facility:'bi-building',doccat:'bi-folder2-open'}[dim]||'bi-folder';
  const lvl = depth;
  return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,grpE])=>{
    const cid='col_'+(collapseCounter++);
    pendingGroups[cid]={docEntries:grpE,dims:rest,depth:depth+1,isDocMode:true};
    const sub=dim!=='doccat'?getGroupSubtitle(dim,name):'';
    return `<div class="grp-block grp-d${lvl}">
      <div class="grp-hdr grp-cat-${dim} grp-collapsed" data-cid="${cid}">
        <i class="bi bi-chevron-down grp-chev"></i>
        <i class="bi ${ico} me-1" style="opacity:.72;font-size:.82rem"></i>
        <span class="grp-name">${esc(withDesc(name,dim))}</span>
        ${sub?`<span class="grp-meta">${esc(sub)}</span>`:''}
        <span class="grp-cnt">${grpE.length}</span>
      </div>
      <div class="grp-body grp-closed" id="${cid}"></div>
    </div>`;
  }).join('');
}

function renderDocsByCat(entries) {
  return groupDocsByClassification(entries, [], 0);
}

function groupDocsByClassification(entries, remainingDims = [], depth = 0, parentKey = '') {
  if (!entries.length) return '';
  const entryCode = entry => classificationParts(f(entry.doc,'Category') || '(Uncategorised)').code.toLowerCase();
  const directEntries = parentKey ? entries.filter(entry => entryCode(entry) === parentKey) : [];
  const childKeys = new Set();
  entries.forEach(entry => {
    const ancestors = classificationAncestors(entryCode(entry));
    const parentIndex = parentKey ? ancestors.indexOf(parentKey) : -1;
    const child = ancestors[parentIndex + 1];
    if (child && child !== parentKey) childKeys.add(child);
  });
  const directHtml = directEntries.length
    ? (remainingDims.length ? groupDocsNested(directEntries, remainingDims, depth) : directEntries.map(entry => docCard(entry)).join(''))
    : '';
  const nodes = [...childKeys].sort((a,b) => a.localeCompare(b, undefined, { numeric:true })).map(categoryKey => {
    const categoryEntries = entries.filter(entry => {
      const code = entryCode(entry);
      return code === categoryKey || code.startsWith(categoryKey + '_');
    });
    const categoryNode = idx.categoryTrees?.doccat?.find(node => node.key === categoryKey);
    const categoryLabel = categoryNode?.label || classificationParts(f(categoryEntries[0]?.doc,'Category')).label || categoryKey;
    const cid='col_'+(collapseCounter++);
    pendingGroups[cid]={
      docEntries:categoryEntries, dims:remainingDims, depth:depth+1,
      isDocMode:true, isDocCategory:true, categoryKey,
    };
    return `<div class="grp-block grp-d${Math.min(depth,4)}" style="margin-bottom:.3rem">
      <div class="grp-hdr grp-cat-doccat grp-collapsed" data-cid="${cid}">
        <i class="bi bi-chevron-down grp-chev"></i>
        <i class="bi bi-folder2-open me-1" style="opacity:.72;font-size:.82rem"></i>
        <span class="grp-name">${esc(categoryLabel)}</span>
        <span class="grp-cnt">${categoryEntries.length}</span>
      </div>
      <div class="grp-body grp-closed" id="${cid}"></div>
    </div>`;
  }).join('');
  return directHtml + nodes;
}

function docCard(entry) {
  const {doc,linkedType,linkedName}=entry;
  const name=f(doc,'Name')||'(Unnamed document)';
  const dir=f(doc,'Directory'), desc=f(doc,'Description'), cat=f(doc,'Category');
  const lpath = _docTarget(dir), href = _docHref(lpath);
  const LL={component:'Component',type:'Type',space:'Space',system:'System',facility:'Facility',floor:'Floor'};
  const di=docStore.length; docStore.push(doc);
  return `<div class="cc">
    <div class="d-flex align-items-start gap-2">
      <div style="flex:1;min-width:0">
        <div class="cc-name">${docIcon(lpath||name)} ${esc(name)}</div>
        ${desc?`<div class="cc-desc mt-1">${esc(desc)}</div>`:''}
        <div class="cc-meta">
          <span><i class="bi bi-link-45deg me-1"></i>${esc(LL[linkedType]||linkedType)}: ${esc(linkedName)}</span>
          ${cat?`<span><i class="bi bi-tag me-1"></i>${esc(cat)}</span>`:''}
        </div>
      </div>
      <div class="doc-list-actions">
        ${lpath?`<a href="${esc(href)}" target="_blank" rel="noopener" class="xbtn" title="Open link"><i class="bi bi-box-arrow-up-right me-1"></i>Link</a>`:''}
        <button class="xbtn" data-doc="${di}" title="View document details"><i class="bi bi-info-circle"></i></button>
        ${_docEditButton(doc)}
      </div>
    </div>
  </div>`;
}
