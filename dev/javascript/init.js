// ── Schema-driven filter and grouping controls ───────────────
hydrateFilterControls();
initFilterTabs();

// ── Workbook upload and drag-and-drop ─────────────────────────
document.getElementById('fileInput').addEventListener('change', e => { if(e.target.files.length) loadFiles(e.target.files); });
document.getElementById('folderInput').addEventListener('change', e => { if(e.target.files.length) loadFiles(e.target.files); });
window.addEventListener('beforeunload', event => {
  if (!_changeLog.length) return;
  const message = 'Refreshing or closing this page will discard your unsaved changes.';
  event.preventDefault();
  event.returnValue = message;
  return message;
});
document.querySelectorAll('.editable-picker-btn').forEach(btn => {
  btn.classList.toggle('d-none', typeof globalThis.showOpenFilePicker !== 'function');
});
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.style.outline='3px dashed var(--accent)'; });
dz.addEventListener('dragleave', () => { dz.style.outline=''; });
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.style.outline='';
  if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});

// ── Filter events ─────────────────────────────────────────────
if (typeof initComponentPlacementModal === 'function') initComponentPlacementModal();

let _filterRangeAnchor = null;
let _filterCategoryRangeAnchor = null;
document.getElementById('filter-bar').addEventListener('click', e => {
  const treeStep = e.target.closest('[data-filter-tree-step]');
  if (treeStep) {
    stepFilterTreeDepth(treeStep.dataset.dim, treeStep.dataset.filterTreeStep);
    return;
  }
  const categoryToggle = e.target.closest('.fp-cat-toggle');
  if (categoryToggle) {
    const header = categoryToggle.closest('.fp-cat-hdr');
    toggleFilterCategoryCollapse(header.dataset.dim, header.dataset.cat);
    return;
  }
  const item = e.target.closest('.fp-item');
  if (item && !item.classList.contains('fp-zero')) {
    const dim = item.dataset.dim;
    const key = item.dataset.key;
    if (e.shiftKey && _filterRangeAnchor?.dim === dim) {
      const visibleKeys = [...item.closest('.fp-body').querySelectorAll(`.fp-item[data-dim="${dim}"]`)]
        .filter(row => !row.classList.contains('fp-zero') && row.getClientRects().length)
        .map(row => row.dataset.key);
      selectFilterRange(dim, _selectionRange(visibleKeys, _filterRangeAnchor.key, key), !sel[dim].has(key));
    } else {
      toggle(dim, key);
    }
    _filterRangeAnchor = { dim, key };
    return;
  }
  const cat = e.target.closest('.fp-cat-hdr');
  if (cat) {
    const dim = cat.dataset.dim;
    const category = cat.dataset.cat;
    if (e.shiftKey && _filterCategoryRangeAnchor?.dim === dim) {
      const visibleCategories = [...cat.closest('.fp-body').querySelectorAll(`.fp-cat-hdr[data-dim="${dim}"]`)]
        .filter(header => header.getClientRects().length)
        .map(header => header.dataset.cat);
      const directKeys = (idx.catGroups?.[dim]?.[category] || []).map(name => name.toLowerCase())
        .filter(key => sel[dim].has(key) || (lastCounts[dim]?.[key] || 0) > 0);
      const selected = !directKeys.length || !directKeys.every(key => sel[dim].has(key));
      selectFilterCategoryRange(dim, _selectionRange(visibleCategories, _filterCategoryRangeAnchor.category, category), selected);
    } else {
      toggleCategory(dim, category);
    }
    _filterCategoryRangeAnchor = { dim, category };
  }
});
document.getElementById('filter-bar').addEventListener('input', e => {
  const inp = e.target.closest('.fp-search');
  if (!inp) return;
  _filterPanelItems(inp.closest('.fp-inner').querySelector('.fp-body'), inp.value.toLowerCase().trim());
});

// ── Active filter pills ───────────────────────────────────────
document.getElementById('pills').addEventListener('click', e => {
  const rm = e.target.closest('.pill-rm');
  if (!rm) return;
  if (rm.dataset.cat) {
    const names = (idx.catGroups?.[rm.dataset.dim] || {})[rm.dataset.cat] || [];
    names.forEach(n => sel[rm.dataset.dim].delete(n.toLowerCase()));
    selectedCategoryLevels[rm.dataset.dim]?.delete(rm.dataset.cat);
  } else {
    sel[rm.dataset.dim].delete(rm.dataset.key);
  }
  applyFilters();
});
// ── Result list interactions ──────────────────────────────────
let _resultRangeAnchor = null;
let _resultGroupRangeAnchor = null;
document.getElementById('comp-list').addEventListener('click', e => {
  const gb = e.target.closest('[data-grpidx]');
  if (gb) {
    const entry = groupInfoStore[+gb.dataset.grpidx];
    if (entry) openGroupInfo(entry.dim, entry.name, entry.facility);
    return;
  }
  const cinfo = e.target.closest('[data-compinfo]');
  if (cinfo) {
    openComponentInfo(cinfo.dataset.compKey || '', cinfo.dataset.compFac || '');
    return;
  }
  const cardHighlightAction = e.target.closest('[data-card-highlight-action]');
  if (cardHighlightAction) {
    const key = cardHighlightAction.dataset.cardHighlightKey || '';
    if (e.shiftKey && _resultRangeAnchor) {
      const keys = [...document.querySelectorAll('#comp-list .selectable-result-card[data-card-highlight-key]')]
        .filter(card => card.getClientRects().length)
        .map(card => card.dataset.cardHighlightKey || '');
      setResultHighlightRange(_selectionRange(keys, _resultRangeAnchor, key), !groupHighlightStore.has(key));
    } else {
      toggleResultHighlight(key);
    }
    _resultRangeAnchor = key;
    return;
  }
  const hl = e.target.closest('[data-grphl]');
  if (hl) {
    const key = hl.dataset.grphlkey || '';
    if (e.shiftKey && _resultGroupRangeAnchor) {
      const keys = [...document.querySelectorAll('#comp-list [data-grphlkey]')]
        .filter(button => button.getClientRects().length)
        .map(button => button.dataset.grphlkey || '');
      setResultHighlightRange(_selectionRange(keys, _resultGroupRangeAnchor, key), !groupHighlightStore.has(key));
    } else {
      highlightGroupSelection(hl, !!(e.ctrlKey || e.metaKey));
    }
    _resultGroupRangeAnchor = key;
    return;
  }
  const qaInfo = e.target.closest('[data-qa-info-entity]');
  if (qaInfo) {
    const entityType = String(qaInfo.dataset.qaInfoEntity || '').toLowerCase();
    const entityName = qaInfo.dataset.qaInfoKey || '';
    const facility = qaInfo.dataset.qaInfoFac || '';
    if (entityType === 'component') {
      openComponentInfo(entityName, facility);
      return;
    }
    if (entityType === 'document') {
      const row = (db.documents || []).find(doc =>
        f(doc, 'Name').toLowerCase() === entityName.toLowerCase() &&
        (!facility || String(doc._facility || '').toLowerCase() === facility.toLowerCase())
      );
      if (row) openDoc(row);
      return;
    }
    if (entityType) {
      openGroupInfo(entityType, entityName, facility);
      return;
    }
  }
  const docBtn = e.target.closest('[data-doc]');
  if (docBtn) { const d=docStore[+docBtn.dataset.doc]; if(d) openDoc(d); return; }
  const cpInline = e.target.closest('.cp-btn-inline');
  if (cpInline) {
    navigator.clipboard.writeText(cpInline.dataset.p).then(()=>{
      cpInline.innerHTML='<i class="bi bi-check2"></i>';
      setTimeout(()=>{ cpInline.innerHTML='<i class="bi bi-clipboard"></i>'; },2000);
    });
    return;
  }
  const lm = e.target.closest('.load-more-btn');
  if (lm) {
    const lcid = lm.dataset.lcid;
    const rem  = pendingLeaf[lcid];
    if (rem) {
      const batch = rem.splice(0, BATCH_SIZE);
      lm.closest('.load-more-wrap').insertAdjacentHTML('beforebegin', batch.map(c=>card(c)).join(''));
      if (rem.length > 0) {
        lm.innerHTML = `<i class="bi bi-chevron-double-down"></i> Show next ${Math.min(BATCH_SIZE,rem.length)} <span class="lm-remaining">(${rem.length} more)</span>`;
      } else {
        delete pendingLeaf[lcid];
        lm.closest('.load-more-wrap').remove();
      }
    }
    return;
  }
  const selectableCard = e.target.closest('[data-card-highlight-key]');
  if (selectableCard && !e.target.closest('button,a,input,select,textarea,[role="link"]')) {
    const key = selectableCard.dataset.cardHighlightKey || '';
    if (e.shiftKey && _resultRangeAnchor) {
      const keys = [...document.querySelectorAll('#comp-list [data-card-highlight-key]')]
        .filter(card => card.getClientRects().length)
        .map(card => card.dataset.cardHighlightKey || '');
      setResultHighlightRange(_selectionRange(keys, _resultRangeAnchor, key), !groupHighlightStore.has(key));
    } else {
      toggleResultHighlight(key);
    }
    _resultRangeAnchor = key;
    return;
  }
  const hdr = e.target.closest('.grp-hdr');
  if (hdr && hdr.dataset.cid) {
    _toggleGroupHeader(hdr);
  }
});
document.getElementById('comp-list').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const selectableCard = e.target.closest('[data-card-highlight-key]');
  if (!selectableCard || e.target.closest('button,a,input,select,textarea,[role="link"]')) return;
  e.preventDefault();
  const key = selectableCard.dataset.cardHighlightKey || '';
  if (e.shiftKey && _resultRangeAnchor) {
    const keys = [...document.querySelectorAll('#comp-list [data-card-highlight-key]')]
      .filter(card => card.getClientRects().length)
      .map(card => card.dataset.cardHighlightKey || '');
    setResultHighlightRange(_selectionRange(keys, _resultRangeAnchor, key), !groupHighlightStore.has(key));
  } else {
    toggleResultHighlight(key);
  }
  _resultRangeAnchor = key;
});
document.getElementById('comp-list').addEventListener('show.bs.collapse', e => {
  const btn=document.querySelector(`[data-bs-target="#${e.target.id}"]`);
  if(btn) btn.innerHTML='<i class="bi bi-chevron-contract"></i> Details';
});
document.getElementById('comp-list').addEventListener('hide.bs.collapse', e => {
  const btn=document.querySelector(`[data-bs-target="#${e.target.id}"]`);
  if(btn) btn.innerHTML='<i class="bi bi-chevron-expand"></i> Details';
});

// ── Type info modal interactions ──────────────────────────────
document.getElementById('type-modal').addEventListener('click', e => {
  const copyPathButton = e.target.closest('.cp-btn');
  if (copyPathButton) {
    navigator.clipboard.writeText(copyPathButton.dataset.p || '').then(() => {
      copyPathButton.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied';
      setTimeout(() => { copyPathButton.innerHTML = '<i class="bi bi-clipboard me-1"></i>Copy path'; }, 2000);
    });
    return;
  }
  const b = e.target.closest('[data-doc]');
  if (!b) return;
  const d = docStore[+b.dataset.doc];
  if (!d) return;
  openDoc(d, _typeModalViewContext);
});
