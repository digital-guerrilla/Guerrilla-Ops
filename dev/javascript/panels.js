// ── Filter panel rendering ────────────────────────────────────
function renderPanels(counts) {
  renderPanel('fpl-facility','fb-facility', idx.facilityNames,'facility', counts.facility);
  renderPanel('fpl-floor',  'fb-floor',  idx.floors,  'floor',  counts.floor);
  renderPanelCat('fpl-space',  'fb-space',  'space',  counts.space);
  renderPanelCat('fpl-type',   'fb-type',   'type',   counts.type);
  renderPanelCat('fpl-system', 'fb-system', 'system', counts.system);
  renderPanel('fpl-doccat', 'fb-doccat', idx.docCategories||[], 'doccat', counts.doccat);
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
  const sortedCats = Object.keys(groups).sort((a,b) => {
    const ua=a.startsWith('('), ub=b.startsWith('(');
    return ua!==ub ? (ua?1:-1) : a.localeCompare(b);
  });

  let html = '';
  sortedCats.forEach(catName => {
    const names = groups[catName];
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

    html += `<div class="fp-cat-hdr" data-dim="${dim}" data-cat="${esc(catName)}">
      <i class="bi ${icon} fp-cat-check"></i>
      <span class="fp-cat-name">${esc(catName)}</span>
      <span class="fp-cat-cnt">${selInCat>0?selInCat+'/':''}${visCount}</span>
    </div>`;

    names.forEach(name => {
      const k    = name.toLowerCase();
      const act  = sel[dim].has(k);
      const cnt  = counts[k] || 0;
      const nw   = _justCreated.has(dim+'::'+k);
      const z    = !act && cnt === 0 && !nw;
      const disp = withDesc(name, dim);
      const newTag = (nw && !act && !cnt) ? '<small style="color:var(--accent);font-size:.62rem;margin-left:.25rem">new</small>' : '';
      html += `<div class="fp-item${act?' fp-sel':''}${z?' fp-zero':''}${nw&&!act&&!cnt?' fp-new':''}" data-dim="${dim}" data-key="${esc(k)}">
        <span class="fp-name" title="${esc(disp)}">${esc(disp)}${newTag}</span>
        <span class="fp-cnt">${cnt||''}</span>
      </div>`;
    });
  });

  document.getElementById(listId).innerHTML = html;
}

function _filterPanelItems(body, q) {
  // Walk children in DOM order so each item can inherit its category header's text
  let curCat = '';
  Array.from(body.children).forEach(el => {
    if (el.classList.contains('fp-cat-hdr')) {
      curCat = (el.dataset.cat || '').toLowerCase();
    } else if (el.classList.contains('fp-item')) {
      const text = el.querySelector('.fp-name')?.textContent.toLowerCase() || '';
      const isSel = el.classList.contains('fp-sel');
      el.style.display = (!q || text.includes(q) || curCat.includes(q) || isSel) ? '' : 'none';
    }
  });
  body.querySelectorAll('.fp-cat-hdr').forEach(hdr => {
    let sib = hdr.nextElementSibling, vis = false;
    while (sib && !sib.classList.contains('fp-cat-hdr')) {
      if (sib.style.display !== 'none' && !sib.classList.contains('fp-zero')) { vis = true; break; }
      sib = sib.nextElementSibling;
    }
    hdr.style.display = vis ? '' : 'none';
  });
}

function reapplyPanelSearches() {
  document.querySelectorAll('.fp-search').forEach(inp => {
    const q = inp.value.toLowerCase().trim();
    if (!q) return;
    _filterPanelItems(inp.closest('.fp-inner').querySelector('.fp-body'), q);
  });
}
