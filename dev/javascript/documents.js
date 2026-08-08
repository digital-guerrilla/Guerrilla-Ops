// ── Document result grouping and cards ───────────────────────

function renderDocumentMode(list, entries) {
  if(!entries.length){
    list.innerHTML=`<div class="empty"><i class="bi bi-folder-x"></i><p>No documents found for the current filters.</p></div>`;
    return;
  }
  const dims = groupState.order.filter(d => groupState.active.has(d));
  list.innerHTML = dims.length ? groupDocsNested(entries, dims) : renderDocumentCards(entries);
}

function renderDocumentCards(entries) {
  return entries.map(entry => docCard(entry)).join('');
}

function _docEntryValues(entry, dimension) {
  const values = entry.valuesByDimension?.[dimension];
  if (values?.length) return values;
  const filter = _cobieFilterDescriptor(dimension);
  return [`(${filter?.emptyLabel || `No ${filter?.label || 'Value'}`})`];
}

function groupDocsNested(entries, dims, depth = 0, parentPath = '') {
  if (!entries.length) return '';
  if (!dims.length) return renderDocumentCards(entries);
  const [dim,...rest] = dims;
  if (dim === _cobieDocumentCategoryDimension()) return groupDocsByClassification(entries, rest, depth);
  const map = new Map();
  entries.forEach(e => {
    const ks = _docEntryValues(e, dim);
    ks.forEach(k=>{ if(!map.has(k))map.set(k,[]); map.get(k).push(e); });
  });
  const ico = _cobieFilterDescriptor(dim)?.icon || 'bi-folder';
  const lvl = depth;
  return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,grpE])=>{
    const cid='col_'+(collapseCounter++);
    const facilities = [...new Set(grpE.flatMap(entry => entry.valuesByDimension?.facility || []).filter(Boolean))];
    const facility = facilities.length === 1 ? facilities[0] : '';
    const gkey = _groupNodeKey(dim, name, facility, depth, parentPath);
    const isOpen = _groupNodeIsOpen(gkey);
    if (!isOpen) pendingGroups[cid]={docEntries:grpE,dims:rest,depth:depth+1,parentPath:gkey,isDocMode:true};
    const sub=dim!=='doccat'?getGroupSubtitle(dim,name):'';
    const bodyHtml = isOpen ? groupDocsNested(grpE, rest, depth + 1, gkey) : '';
    return `<div class="grp-block grp-d${lvl}">
      ${buildGroupHeader({ dim, name, facility, count:grpE.length, subtitle:sub, icon:ico, cid, gkey, isOpen })}
      <div class="grp-body${isOpen ? '' : ' grp-closed'}" id="${cid}">${bodyHtml}</div>
    </div>`;
  }).join('');
}

function renderDocsByCat(entries) {
  return groupDocsByClassification(entries, [], 0);
}

function _isDocumentUnsaved(doc) {
  const name = String(f(doc, 'Name') || '').toLowerCase();
  const facility = String(doc?._facility || '').toLowerCase();
  const changes = typeof _changeLog !== 'undefined' && Array.isArray(_changeLog) ? _changeLog : [];
  if (!name) return false;
  return changes.some(entry => {
    if (String(entry?.entityType || '').toLowerCase() !== 'document') return false;
    if (!Array.isArray(entry?.facNames) || !entry.facNames.some(fac => String(fac || '').toLowerCase() === facility)) return false;
    const entityName = String(entry?.entityName || '').toLowerCase();
    const originalName = String(entry?.originalName || '').toLowerCase();
    return entityName === name || originalName === name;
  });
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
    const categoryDimension = _cobieDocumentCategoryDimension();
    const categoryNode = idx.categoryTrees?.[categoryDimension]?.find(node => node.key === categoryKey);
    const categoryLabel = categoryNode?.label || classificationParts(f(categoryEntries[0]?.doc,'Category')).label || categoryKey;
    const cid='col_'+(collapseCounter++);
    const scopeDimension = _cobieScopeFilterDimension();
    const facilityNames = [...new Set(categoryEntries.flatMap(entry => entry.valuesByDimension?.[scopeDimension] || []).filter(Boolean))];
    const facility = facilityNames.length === 1 ? facilityNames[0] : '';
    const gkey = _groupNodeKey(categoryDimension, categoryKey, facility, depth, parentKey);
    const isOpen = _groupNodeIsOpen(gkey);
    if (!isOpen) pendingGroups[cid]={
      docEntries:categoryEntries, dims:remainingDims, depth:depth+1, parentPath:gkey,
      isDocMode:true, isDocCategory:true, categoryKey,
    };
    const bodyHtml = isOpen
      ? groupDocsByClassification(categoryEntries, remainingDims, depth + 1, categoryKey)
      : '';
    return `<div class="grp-block grp-d${Math.min(depth,4)}" style="margin-bottom:.3rem">
      ${buildGroupHeader({ dim:'doccat', name:categoryKey, facility, count:categoryEntries.length, icon:'bi-folder2-open', cid, gkey, isOpen, displayName:categoryLabel })}
      <div class="grp-body${isOpen ? '' : ' grp-closed'}" id="${cid}">${bodyHtml}</div>
    </div>`;
  }).join('');
  return directHtml + nodes;
}

function docCard(entry) {
  const {doc,linkedType,linkedName}=entry;
  const name=f(doc,'Name')||'(Unnamed document)';
  const isUnsaved = _isDocumentUnsaved(doc);
  const dir=f(doc,'Directory'), desc=f(doc,'Description'), cat=f(doc,'Category');
  const lpath = _docTarget(dir), href = _docHref(lpath);
  const LL={component:'Component',type:'Type',space:'Space',system:'System',facility:'Facility',floor:'Floor'};
  const di=docStore.length; docStore.push(doc);
  const highlightKey = _groupHighlightBuildKey('document', _docUniqueKey(doc), doc._facility || '');
  const content = `<div class="cc-name">${docIcon(lpath||name)} ${esc(name)}</div>
    ${desc ? `<div class="cc-desc mt-1">${esc(desc)}</div>` : ''}
    <div class="cc-meta">
      <span><i class="bi bi-link-45deg me-1"></i>${esc(LL[linkedType]||linkedType)}: ${esc(linkedName)}</span>
      ${cat ? `<span><i class="bi bi-tag me-1"></i>${esc(cat)}</span>` : ''}
    </div>`;
  const actions = `<button class="xbtn" data-doc="${di}" title="View document details"><i class="bi bi-info-circle"></i><span>Info</span></button>
    ${lpath ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="xbtn document-link-action" title="Open link"><i class="bi bi-box-arrow-up-right"></i><span>Link</span></a>` : ''}`;
  return buildSelectableResultCard(highlightKey, content, actions, `document-result-card${isUnsaved ? ' document-result-card-unsaved' : ''}`);
}
