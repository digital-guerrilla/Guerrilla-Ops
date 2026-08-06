// ── Filter panel rendering ────────────────────────────────────
function renderPanels(counts) {
  renderPanelCat('fpl-facility','fb-facility','facility', counts.facility);
  renderPanel('fpl-floor',  'fb-floor',  idx.floors,  'floor',  counts.floor);
  renderPanelCat('fpl-space',  'fb-space',  'space',  counts.space);
  renderPanelCat('fpl-type',   'fb-type',   'type',   counts.type);
  renderPanelCat('fpl-system', 'fb-system', 'system', counts.system);
  renderPanelCat('fpl-doccat', 'fb-doccat', 'doccat', counts.doccat);
}

function renderPanel(listId, badgeId, names, dim, counts) {
  const badge = document.getElementById(badgeId);
  const n = sel[dim].size;
  badge.textContent = n; badge.classList.toggle('d-none', n===0);

  document.getElementById(listId).innerHTML = names.map(name => {
    const k    = name.toLowerCase();
    const act  = sel[dim].has(k);
    const cnt  = counts[k] || 0;
    const nw   = _justCreated.has(dim+'::'+k);
    const z    = !act && cnt === 0 && !nw;
    const disp = withDesc(name, dim);
    const newTag = (nw && !act && !cnt) ? '<small style="color:var(--accent);font-size:.62rem;margin-left:.25rem">new</small>' : '';
    return `<div class="fp-item${act?' fp-sel':''}${z?' fp-zero':''}${nw&&!act&&!cnt?' fp-new':''}" data-dim="${dim}" data-key="${esc(k)}">
      <span class="fp-name" title="${esc(disp)}">${esc(disp)}${newTag}</span>
      <span class="fp-cnt">${cnt||''}</span>
    </div>`;
  }).join('');
}

function renderPanelCat(listId, badgeId, dim, counts) {
  const badge = document.getElementById(badgeId);
  const nSel = sel[dim].size;
  badge.textContent = nSel; badge.classList.toggle('d-none', nSel===0);

  const groups = idx.catGroups[dim] || {};
  const nodes = idx.categoryTrees?.[dim] || [];

  let html = '';
  nodes.forEach(node => {
    const names = groups[node.key] || [];
    let selInCat = 0, visCount = 0;
    names.forEach(name => {
      const k = name.toLowerCase();
      if (sel[dim].has(k) || (counts[k]||0) > 0 || _justCreated.has(dim+'::'+k)) visCount++;
      if (sel[dim].has(k)) selInCat++;
    });
    if (visCount === 0) return;

    const icon = selInCat === 0         ? 'bi-square'
               : selInCat === visCount  ? 'bi-check-square-fill'
               : 'bi-dash-square-fill';
    const collapseKey = dim + '::' + node.key;
    const collapsed = collapsedFilterCategories.has(collapseKey);
    const hiddenByAncestor = nodes.some(parent => parent.depth < node.depth
      && collapsedFilterCategories.has(dim + '::' + parent.key)
      && node.key.startsWith(parent.key + '_'));
    const hasChildren = (dim !== 'doccat' && node.direct.length > 0)
      || nodes.some(child => child.depth > node.depth && child.key.startsWith(node.key + '_'));
    const grade = Math.max(28, 78 - node.depth * 13);

    html += `<div class="fp-cat-hdr fp-cat-depth-${Math.min(4, node.depth)}${hiddenByAncestor?' fp-tree-hidden':''}${collapsed?' fp-cat-collapsed':''}" data-dim="${dim}" data-cat="${esc(node.key)}" data-depth="${node.depth}" style="--cat-depth:${node.depth};--cat-grade:${grade}%">
      ${hasChildren?`<button class="fp-cat-toggle" type="button" title="${collapsed?'Expand':'Collapse'} ${esc(node.label)}" aria-label="${collapsed?'Expand':'Collapse'} ${esc(node.label)}" aria-expanded="${collapsed?'false':'true'}"><i class="bi bi-chevron-down"></i></button>`:'<span class="fp-cat-toggle-spacer"></span>'}
      <i class="bi ${icon} fp-cat-check"></i>
      <span class="fp-cat-name" title="${esc(node.label)}">${esc(node.label)}</span>
      <span class="fp-cat-cnt">${selInCat>0?selInCat+'/':''}${visCount}</span>
    </div>`;

    if (dim === 'doccat') return;
    node.direct.forEach(name => {
      const k    = name.toLowerCase();
      const act  = sel[dim].has(k);
      const cnt  = counts[k] || 0;
      const nw   = _justCreated.has(dim+'::'+k);
      const z    = !act && cnt === 0 && !nw;
      const disp = withDesc(name, dim);
      const newTag = (nw && !act && !cnt) ? '<small style="color:var(--accent);font-size:.62rem;margin-left:.25rem">new</small>' : '';
      html += `<div class="fp-item fp-tree-item${act?' fp-sel':''}${z?' fp-zero':''}${nw&&!act&&!cnt?' fp-new':''}${collapsed||hiddenByAncestor?' fp-tree-hidden':''}" data-dim="${dim}" data-key="${esc(k)}" data-depth="${node.depth + 1}" data-cat-path="${esc(node.key)}" style="--cat-depth:${node.depth + 1}">
        <span class="fp-name" title="${esc(disp)}">${esc(disp)}${newTag}</span>
        <span class="fp-cnt">${cnt||''}</span>
      </div>`;
    });
  });

  document.getElementById(listId).innerHTML = html;
}

function _filterPanelItems(body, q) {
  const children = Array.from(body.children);
  if (!q) {
    children.forEach(el => { el.style.display = el.classList.contains('fp-tree-hidden') ? 'none' : ''; });
    return;
  }

  const visible = new Set();
  const canShow = element => !element.classList.contains('fp-zero') || element.classList.contains('fp-sel');
  children.forEach((element, index) => {
    const name = element.querySelector('.fp-cat-name,.fp-name')?.textContent.toLowerCase() || '';
    const path = (element.dataset.catPath || element.dataset.cat || '').toLowerCase();
    if (canShow(element) && (name.includes(q) || path.includes(q) || element.classList.contains('fp-sel'))) visible.add(index);
  });

  children.forEach((header, index) => {
    if (!header.classList.contains('fp-cat-hdr')) return;
    const name = header.querySelector('.fp-cat-name')?.textContent.toLowerCase() || '';
    const key = (header.dataset.cat || '').toLowerCase();
    if (!name.includes(q) && !key.includes(q)) return;
    visible.add(index);
    const depth = Number(header.dataset.depth || 0);
    for (let cursor = index + 1; cursor < children.length; cursor++) {
      const child = children[cursor];
      if (child.classList.contains('fp-cat-hdr') && Number(child.dataset.depth || 0) <= depth) break;
      if (canShow(child)) visible.add(cursor);
    }
  });

  [...visible].forEach(index => {
    const element = children[index];
    const path = (element.dataset.catPath || element.dataset.cat || '').toLowerCase();
    children.forEach((candidate, candidateIndex) => {
      if (!candidate.classList.contains('fp-cat-hdr')) return;
      const category = (candidate.dataset.cat || '').toLowerCase();
      if (path !== category && path.startsWith(category + '_')) visible.add(candidateIndex);
    });
  });
  children.forEach((element, index) => { element.style.display = visible.has(index) ? 'flex' : 'none'; });
}

function _filterTreeParentNodes(dim) {
  const nodes = idx.categoryTrees?.[dim] || [];
  return nodes.filter(node => (dim !== 'doccat' && node.direct.length > 0)
    || nodes.some(child => child.depth > node.depth && child.key.startsWith(node.key + '_')));
}

function stepFilterTreeDepth(dim, direction, render = true) {
  const nodes = idx.categoryTrees?.[dim] || [];
  const parents = _filterTreeParentNodes(dim);
  const stateKey = node => dim + '::' + node.key;
  if (direction === 'collapse') {
    const visibleExpanded = parents.filter(node => !collapsedFilterCategories.has(stateKey(node))
      && !nodes.some(ancestor => ancestor.depth < node.depth
        && collapsedFilterCategories.has(stateKey(ancestor))
        && node.key.startsWith(ancestor.key + '_')));
    if (visibleExpanded.length) {
      const depth = Math.max(...visibleExpanded.map(node => node.depth));
      visibleExpanded.filter(node => node.depth === depth)
        .forEach(node => collapsedFilterCategories.add(stateKey(node)));
    }
  } else if (direction === 'expand') {
    const collapsed = parents.filter(node => collapsedFilterCategories.has(stateKey(node)));
    if (collapsed.length) {
      const depth = Math.min(...collapsed.map(node => node.depth));
      collapsed.filter(node => node.depth === depth)
        .forEach(node => collapsedFilterCategories.delete(stateKey(node)));
    }
  }
  if (render) {
    renderPanels(lastCounts);
    reapplyPanelSearches();
  }
}

function toggleFilterCategoryCollapse(dim, category) {
  const key = dim + '::' + category;
  if (collapsedFilterCategories.has(key)) collapsedFilterCategories.delete(key);
  else collapsedFilterCategories.add(key);
  renderPanels(lastCounts);
  reapplyPanelSearches();
}

function reapplyPanelSearches() {
  document.querySelectorAll('.fp-search').forEach(inp => {
    const q = inp.value.toLowerCase().trim();
    if (!q) return;
    _filterPanelItems(inp.closest('.fp-inner').querySelector('.fp-body'), q);
  });
}
