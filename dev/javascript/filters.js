// ── Filter model and cross-counts ────────────────────────────
// Returns true if Set a and Set b share at least one element
function _setHasAny(a, b) { for (const x of a) if (b.has(x)) return true; return false; }
const _SUPPORTED_DOC_SHEETS = new Set(['component','type','space','floor','system','facility']);
const _DOC_CONTEXT_DIMENSIONS = {
  facility:'facilities', floor:'floors', space:'spaces', type:'types', system:'systems', doccat:'categories',
};

function _documentContextSearchMatches(context) {
  if (searchQuery) {
    const documentText = [
      f(context.doc,'Name'), f(context.doc,'Description'), f(context.doc,'Category'),
      f(context.doc,'Directory'), _cobieField(context.doc, 'rowName'),
    ].join(' ').toLowerCase();
    const componentMatch = Array.from(context.components).some(key => (idx.searchText?.[key] || '').includes(searchQuery));
    if (!documentText.includes(searchQuery) && !componentMatch) return false;
  }
  return true;
}

function _filterDocumentContexts(contexts, counts, replaceAssetCounts) {
  const dimensions = Object.keys(_DOC_CONTEXT_DIMENSIONS);
  const countSets = Object.fromEntries(dimensions.map(dimension => [dimension, Object.create(null)]));
  const filtered = [];
  const ALL = (1 << dimensions.length) - 1;

  contexts.forEach(context => {
    if (!_documentContextSearchMatches(context)) return;
    let bits = 0;
    dimensions.forEach((dimension, index) => {
      const property = _DOC_CONTEXT_DIMENSIONS[dimension];
      if (!sel[dimension].size || _setHasAny(sel[dimension], context[property])) bits |= 1 << index;
    });
    if (bits === ALL) filtered.push(context);

    dimensions.forEach((dimension, index) => {
      if ((bits | (1 << index)) !== ALL) return;
      const property = _DOC_CONTEXT_DIMENSIONS[dimension];
      context[property].forEach(value => (countSets[dimension][value] ||= new Set()).add(context.identity));
    });
  });

  dimensions.forEach(dimension => {
    if (dimension !== 'doccat' && !replaceAssetCounts) return;
    counts[dimension] = Object.fromEntries(
      Object.entries(countSets[dimension]).map(([value, identities]) => [value, identities.size]),
    );
  });
  return filtered;
}

function _documentContextEntry(context) {
  const display = (dimension, key) => {
    const values = dimension === 'facility' ? idx.facilityNames : idx[dimension + 's'];
    return values?.find(value => value.toLowerCase() === key) || key;
  };
  return {
    doc:context.doc, linkedType:context.linkedType, linkedName:context.linkedName,
    facilityNames:[...context.facilities].map(key => display('facility',key)),
    floorNames:[...context.floors].map(key => display('floor',key)),
    spaceNames:[...context.spaces].map(key => display('space',key)),
    typeNames:[...context.types].map(key => display('type',key)),
    systemNames:[...context.systems].map(key => display('system',key)),
  };
}

// ── Filter application and user actions ──────────────────────
// Single-pass: builds filtered component list + cross-counts simultaneously.
// Uses a 6-bit mask (one bit per dimension) so each component is visited once.
function applyFilters() {
  const c = { facility:{}, floor:{}, space:{}, type:{}, system:{}, doccat:{} };
  const comps = [];
  const ALL = 63; // bits: 0=facility 1=floor 2=space 3=type 4=system 5=doccat

  db.components.forEach(comp => {
    const sp  = f(comp,'Space').toLowerCase();
    const tn  = _cobieField(comp, 'typeName').toLowerCase();
    const fac = (comp._facility||'').toLowerCase();
    const cn  = f(comp,'Name').toLowerCase();
    const compKey = _scopeKey(fac, cn);
    const fl  = idx.spFloor[_scopeKey(fac, sp)] || '';

    if (searchQuery && !(idx.searchText?.[compKey] || '').includes(searchQuery)) return;

    const cats = idx.docCatByComp?.[compKey];
    const syss = idx.compSys[compKey] || [];

    const bits =
      ((!sel.facility.size || sel.facility.has(fac))                         ? 1  : 0) |
      ((!sel.floor.size    || sel.floor.has(fl))                             ? 2  : 0) |
      ((!sel.space.size    || sel.space.has(sp))                             ? 4  : 0) |
      ((!sel.type.size     || sel.type.has(tn))                              ? 8  : 0) |
      ((!sel.system.size   || syss.some(s => sel.system.has(s)))             ? 16 : 0) |
      ((!sel.doccat.size   || (cats && _setHasAny(sel.doccat, cats)))        ? 32 : 0);

    if (bits === ALL) comps.push(comp);

    // For each dimension, count this component if all OTHER dimensions pass
    if ((bits | 1)  === ALL && fac)  c.facility[fac] = (c.facility[fac]||0)+1;
    if ((bits | 2)  === ALL && fl)   c.floor[fl]     = (c.floor[fl]    ||0)+1;
    if ((bits | 4)  === ALL && sp)   c.space[sp]     = (c.space[sp]    ||0)+1;
    if ((bits | 8)  === ALL && tn)   c.type[tn]      = (c.type[tn]     ||0)+1;
    if ((bits | 16) === ALL) syss.forEach(sk => c.system[sk] = (c.system[sk]||0)+1);
  });

  const contexts = idx.documentContexts || [];
  const filteredDocumentContexts = _filterDocumentContexts(
    contexts,
    c,
    viewMode === 'document' || sel.doccat.size > 0,
  );

  if (viewMode === 'qa' && typeof setQaFilterScope === 'function') {
    setQaFilterScope(comps, filteredDocumentContexts);
  }

  lastCounts = c;
  renderPanels(c);
  reapplyPanelSearches();
  renderPills();
  renderComps(comps, filteredDocumentContexts.map(_documentContextEntry));
  if (typeof refreshQaGraphPanel === 'function') {
    refreshQaGraphPanel();
  }
  if (typeof refreshFloorSvgPanel === 'function') {
    refreshFloorSvgPanel(comps, c);
  }
  if (typeof refreshThreeDViewerPanel === 'function') {
    refreshThreeDViewerPanel(comps, c);
  }
  const n = viewMode === 'document' ? filteredDocumentContexts.length : comps.length;
  const noun = viewMode === 'document' ? 'document' : 'component';
  document.getElementById('res-count').textContent = n + ' ' + noun + (n!==1?'s':'');
}

function _setFilterSelection(dim, keys, selected, categoryLevels = []) {
  const normalized = [...new Set(keys.map(key => String(key || '').toLowerCase()).filter(Boolean))];
  if (!normalized.length) return;
  const changedKeys = new Set(normalized);
  Object.entries(idx.catGroups?.[dim] || {}).forEach(([category, names]) => {
    if (names.some(name => changedKeys.has(name.toLowerCase()))) selectedCategoryLevels[dim]?.delete(category);
  });
  normalized.forEach(key => {
    if (selected) sel[dim].add(key); else sel[dim].delete(key);
  });
  if (selected) categoryLevels.forEach(category => selectedCategoryLevels[dim]?.add(category));
  // When selecting a facility-only doc category, auto-enable Facility grouping
  if (dim === 'doccat' && selected && normalized.some(key => idx.docCatFacilityOnly?.has(key))) {
    if (!groupState.active.has('facility')) {
      groupState.active.add('facility');
      const chip = document.querySelector('#group-sortable [data-dim="facility"]');
      if (chip) chip.classList.add('gchip-active');
    }
  }
  if (dim === 'doccat' && selected && viewMode === 'asset') {
    setMode('document');
    return;
  }
  applyFilters();
}

function toggle(dim, key) {
  const normalized = String(key || '').toLowerCase();
  _setFilterSelection(dim, [normalized], !sel[dim].has(normalized));
}

function selectFilterRange(dim, keys, selected) {
  _setFilterSelection(dim, keys, selected);
}

function selectFilterCategoryRange(dim, categories, selected) {
  const keys = [...new Set(categories.flatMap(category => (idx.catGroups?.[dim]?.[category] || [])
    .map(name => name.toLowerCase())
    .filter(key => sel[dim].has(key) || (lastCounts[dim]?.[key] || 0) > 0)))];
  _setFilterSelection(dim, keys, selected, categories);
}

function clearAll() {
  ['facility','floor','space','type','system','doccat'].forEach(d => sel[d].clear());
  Object.values(selectedCategoryLevels).forEach(levels => levels.clear());
  applyFilters();
}

let _searchApplyTimer = null;
function onSearch(val) {
  searchQuery = val.trim().toLowerCase();
  const clr = document.getElementById('s-clear');
  clr.style.display = searchQuery ? '' : 'none';
  document.getElementById('hdr').classList.toggle('search-active', !!searchQuery);
  clearTimeout(_searchApplyTimer);
  _searchApplyTimer = setTimeout(() => {
    _searchApplyTimer = null;
    applyFilters();
  }, 120);
}

function clearSearch() {
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('s-clear').style.display = 'none';
  document.getElementById('hdr').classList.remove('search-active');
  applyFilters();
}

function setMode(mode) {
  if (mode !== 'qa' && typeof cancelQaRun === 'function') cancelQaRun(true);
  viewMode = mode;
  document.getElementById('btn-asset')   .classList.toggle('active', mode==='asset');
  document.getElementById('btn-document').classList.toggle('active', mode==='document');
  document.getElementById('btn-qa')      .classList.toggle('active', mode==='qa');
  applyFilters();
}

function toggleCategory(dim, catName) {
  const names = (idx.catGroups[dim] || {})[catName] || [];
  const keys  = names.map(n => n.toLowerCase())
    .filter(k => sel[dim].has(k) || (lastCounts[dim]?.[k] || 0) > 0);
  if (!keys.length) return;
  const allSel = keys.every(k => sel[dim].has(k));
  const changedKeys = new Set(keys);
  [...(selectedCategoryLevels[dim] || [])].forEach(category => {
    const categoryNames = (idx.catGroups[dim] || {})[category] || [];
    if (categoryNames.some(name => changedKeys.has(name.toLowerCase()))) selectedCategoryLevels[dim].delete(category);
  });
  keys.forEach(k => { if (allSel) sel[dim].delete(k); else sel[dim].add(k); });
  if (!allSel) selectedCategoryLevels[dim]?.add(catName);
  applyFilters();
}
