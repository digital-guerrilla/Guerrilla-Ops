// ── Filter model and cross-counts ────────────────────────────
// Returns true if Set a and Set b share at least one element
function _setHasAny(a, b) { for (const x of a) if (b.has(x)) return true; return false; }
const _SUPPORTED_DOC_SHEETS = new Set(['component','type','space','floor','system','facility']);
const _DOC_CONTEXT_DIMENSIONS = {
  facility:'facilities', floor:'floors', space:'spaces', type:'types', system:'systems', doccat:'categories',
};

function _documentContextMatches(context, ignoredDimension = '') {
  for (const [dimension, property] of Object.entries(_DOC_CONTEXT_DIMENSIONS)) {
    if (dimension === ignoredDimension || !sel[dimension].size) continue;
    if (!_setHasAny(sel[dimension], context[property])) return false;
  }
  if (searchQuery) {
    const documentText = [
      f(context.doc,'Name'), f(context.doc,'Description'), f(context.doc,'Category'),
      f(context.doc,'Directory'), _cobieField(context.doc, 'rowName'),
    ].join(' ').toLowerCase();
    const componentMatch = [...context.components].some(key => (idx.searchText?.[key] || '').includes(searchQuery));
    if (!documentText.includes(searchQuery) && !componentMatch) return false;
  }
  return true;
}

function _documentCrossCounts(contexts, counts, replaceAssetCounts) {
  const countDimension = dimension => {
    const property = _DOC_CONTEXT_DIMENSIONS[dimension];
    const keysByValue = {};
    contexts.forEach(context => {
      if (!_documentContextMatches(context, dimension)) return;
      context[property].forEach(value => (keysByValue[value] ||= new Set()).add(context.identity));
    });
    const result = {};
    Object.entries(keysByValue).forEach(([value, keys]) => { result[value] = keys.size; });
    return result;
  };
  counts.doccat = countDimension('doccat');
  if (replaceAssetCounts) {
    ['facility','floor','space','type','system'].forEach(dimension => { counts[dimension] = countDimension(dimension); });
  }
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
  const filteredDocumentContexts = contexts.filter(context => _documentContextMatches(context));
  _documentCrossCounts(contexts, c, viewMode === 'document' || sel.doccat.size > 0);

  lastCounts = c;
  renderPanels(c);
  reapplyPanelSearches();
  renderPills();
  renderComps(comps, filteredDocumentContexts.map(_documentContextEntry));
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

function toggle(dim, key) {
  const k = key.toLowerCase();
  Object.entries(idx.catGroups?.[dim] || {}).forEach(([category, names]) => {
    if (names.some(name => name.toLowerCase() === k)) selectedCategoryLevels[dim]?.delete(category);
  });
  if (sel[dim].has(k)) sel[dim].delete(k); else sel[dim].add(k);
  // When selecting a facility-only doc category, auto-enable Facility grouping
  if (dim === 'doccat' && sel.doccat.has(k) && idx.docCatFacilityOnly?.has(k)) {
    if (!groupState.active.has('facility')) {
      groupState.active.add('facility');
      const chip = document.querySelector('#group-sortable [data-dim="facility"]');
      if (chip) chip.classList.add('gchip-active');
    }
  }
  if (dim === 'doccat' && sel.doccat.has(k) && viewMode === 'asset') {
    setMode('document');
    return;
  }
  applyFilters();
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
