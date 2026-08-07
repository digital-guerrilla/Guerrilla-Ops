// ── Active filter pills and expansion controls ───────────────
const DIM_CFG = {
  facility: { label:'Facility',     cls:'pill-facility' },
  floor:    { label:'Floor',        cls:'pill-floor'    },
  space:    { label:'Space',        cls:'pill-space'    },
  type:     { label:'Type',         cls:'pill-type'     },
  system:   { label:'System',       cls:'pill-system'   },
  doccat:   { label:'Doc Category', cls:'pill-doccat'   },
};
const NAME_LISTS = {
  facility: () => idx.facilityNames || [],
  floor:    () => idx.floors,  space:  () => idx.spaces,
  type:     () => idx.types,   system: () => idx.systems,
  doccat:   () => idx.docCategories || [],
};

function withDesc(name, dim) {
  if (!name) return name;
  const desc = idx.desc?.[dim]?.[name.toLowerCase()];
  return desc ? name + ' - ' + desc : name;
}

function dispName(dim, key) {
  const name = NAME_LISTS[dim]().find(n => n.toLowerCase()===key) || key;
  return withDesc(name, dim);
}

function _pillItem(cfg, dim, key) {
  return `<span class="pill ${cfg.cls}">
    <span style="opacity:.6;font-size:.69rem">${cfg.label}:</span>
    ${esc(dispName(dim,key))}
    <span class="pill-rm" data-dim="${esc(dim)}" data-key="${esc(key)}">x</span>
  </span>`;
}

function renderPills() {
  const any = Object.values(sel).some(s => s.size);
  document.getElementById('clear-btn').classList.toggle('d-none', !any);
  const highlightCount = typeof getGroupHighlightCount === 'function' ? getGroupHighlightCount() : 0;
  document.getElementById('clear-highlights-btn').classList.toggle('d-none', highlightCount === 0);

  let html = '';
  Object.entries(DIM_CFG).forEach(([dim, cfg]) => {
    if (!sel[dim].size) return;
    const catGrps = idx.catGroups?.[dim];
    if (!catGrps) {
      sel[dim].forEach(key => { html += _pillItem(cfg, dim, key); });
      return;
    }
    const handled = new Set();
    [...(selectedCategoryLevels[dim] || [])].forEach(catName => {
      const selectedKeys = (catGrps[catName] || []).map(name => name.toLowerCase()).filter(key => sel[dim].has(key));
      if (!selectedKeys.length) return;
      const categoryLabel = idx.categoryTrees?.[dim]?.find(node => node.key === catName)?.label || catName;
      html += `<span class="pill ${cfg.cls}">
        <span style="opacity:.6;font-size:.69rem">${cfg.label}:</span>
        ${esc(categoryLabel)}
        <span class="pill-rm" data-dim="${esc(dim)}" data-cat="${esc(catName)}">x</span>
      </span>`;
      selectedKeys.forEach(key => handled.add(key));
    });
    sel[dim].forEach(k => { if (!handled.has(k)) html += _pillItem(cfg, dim, k); });
  });

  document.getElementById('pills').innerHTML =
    html || '<span style="font-size:.76rem;color:#ccc;font-style:italic">None - showing all components</span>';
}

function toggleExpandAll() {
  allExpanded = !allExpanded;
  const eab = document.getElementById('expand-all-btn');

  if (!allExpanded) {
    groupExpandedState.clear();
    document.querySelectorAll('#comp-list .grp-hdr[data-cid]').forEach(hdr => {
      hdr.classList.add('grp-collapsed');
      const body = document.getElementById(hdr.dataset.cid);
      if (body) body.classList.add('grp-closed');
    });
    if (eab) eab.innerHTML = '<i class="bi bi-arrows-expand"></i>Expand All';
    return;
  }

  if (eab) eab.innerHTML = '<i class="bi bi-arrows-collapse"></i>Collapse All';

  document.querySelectorAll('#comp-list .grp-hdr[data-cid]').forEach(hdr => {
    hdr.classList.remove('grp-collapsed');
    if (hdr.dataset.gkey) groupExpandedState.add(hdr.dataset.gkey);
    const body = document.getElementById(hdr.dataset.cid);
    if (body) body.classList.remove('grp-closed');
  });

  function renderPendingBatch() {
    const pending = [...document.querySelectorAll('#comp-list .grp-hdr[data-cid]')]
      .filter(hdr => pendingGroups[hdr.dataset.cid]);
    if (!pending.length) return;
    pending.slice(0, 20).forEach(hdr => {
      const cid = hdr.dataset.cid;
      if (!pendingGroups[cid]) return;
      const pg = pendingGroups[cid];
      delete pendingGroups[cid];
      const body = document.getElementById(cid);
      if (body) {
        if (pg.isQA) {
          body.innerHTML = qaGroupBody(pg.qaItems);
        } else if (pg.isDocMode) {
          body.innerHTML = pg.isDocCategory
            ? groupDocsByClassification(pg.docEntries, pg.dims || [], pg.depth || 0, pg.categoryKey)
            : groupDocsNested(pg.docEntries, pg.dims || [], pg.depth || 0, pg.parentPath || '');
        } else {
          body.innerHTML = groupNested(pg.comps, pg.dims, pg.depth, pg.parentPath || '');
        }
        body.querySelectorAll('.grp-hdr[data-cid]').forEach(h => {
          h.classList.remove('grp-collapsed');
          if (h.dataset.gkey) groupExpandedState.add(h.dataset.gkey);
          const b = document.getElementById(h.dataset.cid);
          if (b) b.classList.remove('grp-closed');
        });
      }
    });
    if (pending.length > 20) requestAnimationFrame(renderPendingBatch);
  }
  requestAnimationFrame(renderPendingBatch);
}
