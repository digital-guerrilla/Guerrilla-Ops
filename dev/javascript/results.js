// ── Result view state ─────────────────────────────────────────
let groupInfoStore = [];
const groupHighlightStore = new Set();
const groupExpandedState = new Set();
let collapseCounter = 0;
let allExpanded = false;
const DEFAULT_GROUP_ORDER = Object.freeze(COBIE_FILTER_DIMENSIONS.map(filter => filter.dimension));
const groupState = {
  order:  [...DEFAULT_GROUP_ORDER],
  active: new Set(),
};
const BATCH_SIZE = 200;
let pendingGroups = {}; // cid → {comps, dims, depth} – lazy group bodies
let pendingLeaf   = {}; // lcid → remaining component array

// ── Result view dispatch ──────────────────────────────────────
function renderComps(comps, documentEntries = []) {
  docStore = []; groupInfoStore = [];
  pendingGroups = {}; pendingLeaf = {};
  collapseCounter = 0; cardCtr = 0;
  const eab = document.getElementById('expand-all-btn');
  if (eab) {
    eab.innerHTML = allExpanded
      ? '<i class="bi bi-arrows-collapse"></i>Collapse All'
      : '<i class="bi bi-arrows-expand"></i>Expand All';
  }
  const list = document.getElementById('comp-list');

  if (viewMode === 'qa') {
    showQAMode(list);
    return;
  }

  if (viewMode === 'document') {
    renderDocumentMode(list, documentEntries);
    return;
  }

  if (!comps.length) {
    list.innerHTML = `<div class="empty"><i class="bi bi-inbox"></i><p>No components match the current filters.</p></div>`;
    return;
  }

  const dims = groupState.order.filter(d => groupState.active.has(d));
  list.innerHTML = dims.length
    ? groupNested(comps, dims, 0, '')
    : renderLeaf(comps);
}

// ── Asset result grouping and pagination ─────────────────────
function groupNested(comps, dims, depth = 0, parentPath = '') {
  if (!dims.length || !comps.length) return renderLeaf(comps);
  const [dim, ...rest] = dims;
  const map = buildGroupMap(comps, dim);
  const lvl = depth;
  const ico = _cobieFilterDescriptor(dim)?.icon || 'bi-folder';
  return [...map.entries()].map(([name, cs]) => {
    const cid  = 'col_' + (collapseCounter++);
    const facilities = [...new Set(cs.map(c => c._facility).filter(Boolean))];
    const facility = facilities.length === 1 ? facilities[0] : '';
    const gkey = _groupNodeKey(dim, name, facility, depth, parentPath);
    const isOpen = allExpanded || groupExpandedState.has(gkey);
    const sub  = getGroupSubtitle(dim, name, facility);
    let bodyHtml = '';
    if (isOpen) {
      bodyHtml = rest.length ? groupNested(cs, rest, depth + 1, gkey) : renderLeaf(cs);
    } else {
      pendingGroups[cid] = { comps: cs, dims: rest, depth: depth + 1, parentPath: gkey };
    }
    return `<div class="grp-block grp-d${lvl}">
      ${buildGroupHeader({ dim, name, facility, count:cs.length, subtitle:sub, icon:ico, cid, gkey, isOpen })}
      <div class="grp-body${isOpen ? '' : ' grp-closed'}" id="${cid}">${bodyHtml}</div>
    </div>`;
  }).join('');
}

function renderLeaf(comps) {
  if (!comps.length) return '';
  const first = comps.slice(0, BATCH_SIZE);
  const rest  = comps.slice(BATCH_SIZE);
  const html  = first.map(c => card(c)).join('');
  if (!rest.length) return html;
  const lcid = 'lm_' + (collapseCounter++);
  pendingLeaf[lcid] = rest;
  return html + `<div class="load-more-wrap" id="${lcid}">
    <button class="load-more-btn" data-lcid="${lcid}">
      <i class="bi bi-chevron-double-down"></i>
      Show next ${Math.min(BATCH_SIZE, rest.length)}
      <span class="lm-remaining">(${rest.length} more)</span>
    </button>
  </div>`;
}

// ── Group map and subtitles ───────────────────────────────────
function buildGroupMap(comps, dim) {
  const map = new Map();
  const filter = _cobieFilterDescriptor(dim);
  const names = idx[filter?.listIndex] || [];
  const namesByKey = new Map(names.map(name => [name.toLowerCase(), name]));
  comps.forEach(component => {
    const values = _componentFilterValues(component, filter);
    const sourceValue = filter?.valueField === '_facility'
      ? String(component._facility || '').trim()
      : filter?.valueField
        ? f(component, ..._cobieFieldAliasesFor(filter.valueField))
        : '';
    const keys = values.length
      ? values.map(value => namesByKey.get(value) || (sourceValue.toLowerCase() === value ? sourceValue : value))
      : [`(${filter?.emptyLabel || 'Unassigned'})`];
    keys.forEach(key => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(component);
    });
  });
  const pb = s => s.startsWith('(');
  return new Map([...map.entries()].sort(([a],[b]) => pb(a)!==pb(b)?(pb(a)?1:-1):a.localeCompare(b)));
}

function getGroupSubtitle(dim, name, facility) {
  if (!name || name.startsWith('(')) return '';
  if (dim === 'facility') {
    const fac = db.facilities.find(x => x._facility === name);
    return fac ? f(fac,'Description') : '';
  }
  if (dim === 'type') {
    const t = _findEntity(db.types, name, facility);
    return t ? [f(t,'Manufacturer'),f(t,'ModelNumber','Model Number')].filter(Boolean).join(' – ') : '';
  }
  if (dim === 'system') {
    const s = _findEntity(db.systems, name, facility);
    return s ? f(s,'Category') : '';
  }
  if (dim === 'space') {
    const s = _findEntity(db.spaces, name, facility);
    if (!s) return '';
    const fl = f(s,'FloorName','Floor Name');
    return fl ? 'Floor: '+fl : '';
  }
  if (dim === 'floor') {
    const fl = _findEntity(db.floors, name, facility);
    if (!fl) return '';
    const elev = f(fl,'Elevation');
    return elev ? 'Elev: '+elev : '';
  }
  return '';
}

function _groupHighlightKeyParts(key) {
  try {
    const parsed = JSON.parse(String(key || ''));
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return {
        dim: String(parsed[0] || '').trim().toLowerCase(),
        name: String(parsed[1] || '').trim().toLowerCase(),
        facility: String(parsed[2] || '').trim().toLowerCase(),
      };
    }
  } catch (_) {}
  return { dim:'', name:'', facility:'' };
}

function _groupHighlightMatchComponent(comp, dim, name, facility) {
  if (!comp || !dim || !name || name.startsWith('(')) return false;
  const compFacility = String(comp._facility || '').toLowerCase();
  if (facility && compFacility !== facility) return false;

  if (dim === 'component') return f(comp, 'Name').toLowerCase() === name;
  return _componentFilterValues(comp, _cobieFilterDescriptor(dim)).includes(name);
}

function getGroupHighlightContext() {
  const activeKeys = [...groupHighlightStore];
  const spaces = new Set();
  const components = [];
  const componentKeys = new Set();

  if (!activeKeys.length) {
    return { activeKeys, spaces, components, componentKeys };
  }

  const highlightedGroups = activeKeys.map(_groupHighlightKeyParts)
    .filter(group => group.dim && group.name && !group.name.startsWith('('));
  if (!highlightedGroups.length) {
    return { activeKeys, spaces, components, componentKeys };
  }

  db.components.forEach(comp => {
    const matches = highlightedGroups.some(group =>
      _groupHighlightMatchComponent(comp, group.dim, group.name, group.facility)
    );
    if (!matches) return;

    const compKey = _scopeKey(comp._facility, f(comp, 'Name'));
    if (!componentKeys.has(compKey)) {
      componentKeys.add(compKey);
      components.push(comp);
    }

    _cobieReferenceValues('component', comp, 'Space')
      .forEach(space => spaces.add(space.toLowerCase()));
  });

  return { activeKeys, spaces, components, componentKeys };
}

function getGroupHighlightCount() {
  return groupHighlightStore.size;
}

function clearAllHighlights() {
  if (!groupHighlightStore.size) return;
  groupHighlightStore.clear();
  applyFilters();
}

function highlightGroupSelection(button, additive = false) {
  if (!button) return;
  const key = (button.dataset.grphlkey || '').trim();
  toggleResultHighlight(key);
}

function setResultHighlightRange(keys, selected) {
  const normalized = [...new Set(keys.map(key => String(key || '').trim()).filter(Boolean))];
  if (!normalized.length) return;
  normalized.forEach(key => {
    if (selected) groupHighlightStore.add(key); else groupHighlightStore.delete(key);
  });
  applyFilters();
}

function toggleResultHighlight(key) {
  key = String(key || '').trim();
  if (!key) return;
  setResultHighlightRange([key], !groupHighlightStore.has(key));
}

// ── Component card ────────────────────────────────────────────
function card(c) {
  const name = f(c,'Name');
  const tn   = _cobieField(c, 'typeName');
  const spaces = _cobieReferenceValues('component', c, 'Space');
  const desc = f(c,'Description');
  const sn   = f(c,'SerialNumber','Serial Number');
  const tag  = f(c,'TagNumber','Tag Number');
  const bc   = f(c,'BarCode','Bar Code');
  const aid  = f(c,'AssetIdentifier','Asset Identifier');
  const inst = fmtDate(c['InstallationDate']  || c['Installation Date']);
  const wst  = fmtDate(c['WarrantyStartDate'] || c['Warranty Start Date']);
  const compHighlightKey = _groupHighlightBuildKey('component', name, c._facility || '');
  const cdocs  = docsFor('Component', name, c._facility);
  const badges  = badgesByCat(cdocs);
  const content = `<div class="cc-name">${esc(name)}${desc ? `<span class="cc-desc"> : ${esc(desc)}</span>` : ''}</div>
    <div class="cc-meta">
      ${tn ? `<span><i class="bi bi-tag me-1"></i>${esc(withDesc(tn,'type'))}</span>` : ''}
      ${spaces.length ? `<span><i class="bi bi-geo-alt me-1"></i>${esc(spaces.map(space => withDesc(space,'space')).join(', '))}</span>` : ''}
    </div>
    ${badges ? `<div class="mt-2">${badges}</div>` : ''}`;
  const activeClass = groupHighlightStore.has(compHighlightKey) ? ' is-active' : '';
  const actions = `<button class="xbtn" data-compinfo="1" data-comp-key="${esc(name)}" data-comp-fac="${esc(c._facility||'')}" title="Component info"><i class="bi bi-info-circle"></i><span>Info</span></button>
    <button class="grp-highlight-btn${activeClass}" data-card-highlight-action data-card-highlight-key="${esc(compHighlightKey)}" title="Toggle component highlight" aria-pressed="${activeClass ? 'true' : 'false'}"><i class="bi bi-highlighter"></i><span>Highlight</span></button>`;
  return buildSelectableResultCard(compHighlightKey, content, actions, 'component-result-card');
}

function badgesByCat(docs) {
  if (!docs.length) return '';
  const grp = new Map();
  docs.forEach(d => {
    const cat = f(d,'Category') || '(Uncategorised)';
    if (!grp.has(cat)) grp.set(cat,[]);
    grp.get(cat).push(d);
  });
  const cats = [...grp.keys()].sort((a,b) => { const pa=a.startsWith('('),pb=b.startsWith('('); return pa!==pb?(pa?1:-1):a.localeCompare(b); });
  return cats.map(cat =>
    (grp.size > 1 ? `<div class="doc-cat-label">${esc(cat)}</div>` : '') +
    `<div class="doc-list">${grp.get(cat).map(d => badge(d,false)).join('')}</div>`
  ).join('');
}

function badge(doc, fromType) {
  return _docListItem(doc, fromType);
}

function _docListItem(doc, fromType = false) {
  const index = docStore.length; docStore.push(doc);
  const number = f(doc,'Name') || '(Unnamed document)';
  const description = f(doc,'Description') || 'No description';
  const path = _docTarget(f(doc,'Directory'));
  const isUnsaved = _isDocumentUnsaved(doc);
  const title = fromType ? 'Type-level document' : 'View document details';
  return `<div class="doc-list-item${isUnsaved ? ' doc-list-item-unsaved' : ''}"${fromType?' data-doc-level="type"':''}>
    <div class="doc-list-copy" data-doc="${index}" title="${title}">
      <div class="doc-list-number">${docIcon(path||number)} ${esc(number)}</div>
      <div class="doc-list-desc">${esc(description)}</div>
    </div>
    <div class="doc-list-actions">
      ${path?`<a href="${esc(_docHref(path))}" target="_blank" rel="noopener" class="xbtn" title="Open link"><i class="bi bi-box-arrow-up-right me-1"></i>Link</a>`:''}
    </div>
  </div>`;
}

function _toggleGroupHeader(header, forceOpen) {
  const cid = header?.dataset.cid;
  const body = cid ? document.getElementById(cid) : null;
  if (!body) return null;
  if (pendingGroups[cid]) {
    const pending = pendingGroups[cid];
    delete pendingGroups[cid];
    if (pending.isQA) {
      body.innerHTML = qaPendingGroupBody(pending);
    } else if (pending.isDocMode) {
      body.innerHTML = pending.isDocCategory
        ? groupDocsByClassification(pending.docEntries, pending.dims || [], pending.depth || 0, pending.categoryKey)
        : groupDocsNested(pending.docEntries, pending.dims || [], pending.depth || 0, pending.parentPath || '');
    } else {
      body.innerHTML = groupNested(pending.comps, pending.dims, pending.depth, pending.parentPath || '');
    }
  }
  const open = forceOpen === undefined ? body.classList.contains('grp-closed') : forceOpen;
  body.classList.toggle('grp-closed', !open);
  header.classList.toggle('grp-collapsed', !open);
  const gkey = header.dataset.gkey;
  if (gkey) {
    if (open) groupExpandedState.add(gkey);
    else groupExpandedState.delete(gkey);
  }
  return body;
}
