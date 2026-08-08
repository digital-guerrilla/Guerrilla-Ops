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

// ── Summary stats collapse toggle ────────────────────────────
const _statsBar = document.getElementById('stats');
const _summaryHeader = document.getElementById('summary-section-header');
const _statsMinBtn = document.getElementById('stats-min-btn');
const _statsMaxBtn = document.getElementById('stats-max-btn');
if (_statsBar && _summaryHeader && _statsMinBtn && _statsMaxBtn) {
  const _setStatsCollapsed = collapsed => {
    _statsBar.classList.toggle('stats-collapsed', !!collapsed);
    _statsMinBtn.classList.toggle('frb-active', !!collapsed);
    _statsMaxBtn.classList.toggle('frb-active', !collapsed);
    _statsMinBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    _statsMaxBtn.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
    localStorage.setItem('go:statsCollapsed', collapsed ? '1' : '0');
  };

  _setStatsCollapsed(localStorage.getItem('go:statsCollapsed') === '1');
  _summaryHeader.addEventListener('click', e => {
    if (e.target.closest('.frb')) return;
    _setStatsCollapsed(!_statsBar.classList.contains('stats-collapsed'));
  });
  _statsMinBtn.addEventListener('click', e => {
    e.stopPropagation();
    _setStatsCollapsed(true);
  });
  _statsMaxBtn.addEventListener('click', e => {
    e.stopPropagation();
    _setStatsCollapsed(false);
  });
}

// ── Filter bar events ─────────────────────────────────────────
function _toggleFilterPanel(panel) {
  if (!panel) return;
  if (panel.classList.contains('fp-collapsed')) {
    panel.classList.remove('fp-collapsed');
    const prev = Number(panel.dataset.prevWidth || panel.dataset.userWidth || 0);
    if (prev > 40) {
      panel.style.flex = `0 0 ${Math.round(prev)}px`;
      panel.dataset.userWidth = String(Math.round(prev));
    } else {
      panel.style.removeProperty('flex');
    }
    return;
  }
  const curWidth = panel.getBoundingClientRect().width;
  if (curWidth > 40) panel.dataset.prevWidth = String(Math.round(curWidth));
  panel.classList.add('fp-collapsed');
  panel.style.removeProperty('flex');
}

function _setFilterPanelWidth(panel, widthPx) {
  if (!panel) return;
  const clamped = Math.max(120, Math.min(700, Math.round(widthPx)));
  panel.classList.remove('fp-collapsed');
  panel.style.flex = `0 0 ${clamped}px`;
  panel.dataset.userWidth = String(clamped);
}

function _activeFilterPanels() {
  return [...document.querySelectorAll('#filter-bar .fp')].filter(panel => !panel.classList.contains('fp-collapsed'));
}

function _captureFilterWidths(panels) {
  return panels.map(panel => Math.round(panel.getBoundingClientRect().width));
}

function _applyFilterWidths(panels, widths) {
  panels.forEach((panel, i) => {
    const width = Math.max(120, Math.round(widths[i] || 120));
    panel.style.flex = `0 0 ${width}px`;
    panel.dataset.userWidth = String(width);
  });
}

function _reduceFromIndices(widths, indices, amount, minWidth = 120) {
  let remaining = Math.max(0, amount);
  if (!remaining || !indices.length) return 0;

  while (remaining > 0.5) {
    const available = indices.map(i => Math.max(0, widths[i] - minWidth));
    const totalAvailable = available.reduce((sum, value) => sum + value, 0);
    if (totalAvailable <= 0) break;

    const ratio = Math.min(1, remaining / totalAvailable);
    let consumed = 0;
    indices.forEach((i, idx) => {
      const take = available[idx] * ratio;
      widths[i] -= take;
      consumed += take;
    });
    remaining -= consumed;
  }

  return Math.max(0, amount - remaining);
}

function _distributeToIndices(widths, indices, amount) {
  if (!indices.length || amount <= 0) return;
  const totalBase = indices.reduce((sum, i) => sum + Math.max(1, widths[i]), 0);
  indices.forEach(i => {
    const share = amount * (Math.max(1, widths[i]) / totalBase);
    widths[i] += share;
  });
}

function _bindFilterSideHandleDrag() {
  document.querySelectorAll('#filter-bar .fp-hd').forEach(handle => {
    if (handle.dataset.dragBound === '1') return;
    handle.dataset.dragBound = '1';

    handle.addEventListener('mousedown', event => {
      if (event.button !== 0 || window.matchMedia('(max-width: 1200px)').matches) return;
      const panel = handle.closest('.fp');
      if (!panel) return;
      event.preventDefault();

      const wasCollapsed = panel.classList.contains('fp-collapsed');
      const startX = event.clientX;
      let baseWidth = panel.getBoundingClientRect().width;
      if (wasCollapsed) {
        const prev = Number(panel.dataset.prevWidth || panel.dataset.userWidth || 240);
        baseWidth = Math.max(120, Math.min(700, Math.round(prev)));
      }
      let dragged = false;
      let movedMax = 0;
      let dragPanels = [];
      let dragStartWidths = [];
      let dragPanelIndex = -1;

      const initDirectionalLayout = () => {
        dragPanels = _activeFilterPanels();
        if (!dragPanels.includes(panel)) {
          dragPanels.push(panel);
        }
        dragPanels = [...new Set(dragPanels)];
        dragStartWidths = _captureFilterWidths(dragPanels);
        dragPanelIndex = dragPanels.indexOf(panel);

        if (dragPanelIndex >= 0 && wasCollapsed) {
          dragStartWidths[dragPanelIndex] = baseWidth;
        }
        if (dragPanelIndex >= 0) {
          baseWidth = dragStartWidths[dragPanelIndex];
        }

        _applyFilterWidths(dragPanels, dragStartWidths);
      };

      const onMove = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const adx = Math.abs(dx);
        if (adx > movedMax) movedMax = adx;
        if (!dragged && adx > 2) {
          dragged = true;
          panel.classList.add('fp-resizing');
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'ew-resize';
          if (wasCollapsed && panel.classList.contains('fp-collapsed')) {
            panel.classList.remove('fp-collapsed');
          }
          initDirectionalLayout();
        }
        if (!dragged) return;

        if (dragPanelIndex < 0 || !dragPanels.length) return;

        const targetWidth = Math.max(120, Math.min(700, Math.round(baseWidth + dx)));
        const delta = targetWidth - baseWidth;
        const nextWidths = dragStartWidths.slice();
        const rightIdx = dragPanels.map((_, i) => i).filter(i => i > dragPanelIndex);
        const leftIdx = dragPanels.map((_, i) => i).filter(i => i < dragPanelIndex);

        if (delta > 0) {
          // Expanding right: consume space from panels to the right first.
          let consumed = _reduceFromIndices(nextWidths, rightIdx, delta);
          if (consumed < delta) consumed += _reduceFromIndices(nextWidths, leftIdx, delta - consumed);
          nextWidths[dragPanelIndex] = baseWidth + consumed;
        } else if (delta < 0) {
          const release = -delta;
          nextWidths[dragPanelIndex] = baseWidth - release;
          // Shrinking right edge: give space to panels on the right first.
          if (rightIdx.length) _distributeToIndices(nextWidths, rightIdx, release);
          else _distributeToIndices(nextWidths, leftIdx, release);
        }

        _applyFilterWidths(dragPanels, nextWidths);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        panel.classList.remove('fp-resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        if (dragged) {
          const sized = Number(panel.dataset.userWidth || 0);
          if (sized > 40) panel.dataset.prevWidth = String(Math.round(sized));
          return;
        }
        // If the pointer moved a bit, treat it as drag intent and avoid click-toggle bounce.
        if (movedMax <= 1) _toggleFilterPanel(panel);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

_bindFilterSideHandleDrag();
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

// ── Group sortable and chip clicks ────────────────────────────
let _gDrag = false;
const _gList = document.getElementById('group-sortable');
if (_gList && typeof Sortable !== 'undefined') {
  Sortable.create(_gList, {
    animation: 150,
    onStart: () => { _gDrag = true; },
    onEnd: () => {
      groupState.order = [..._gList.querySelectorAll('[data-dim]')].map(li => li.dataset.dim);
      setTimeout(() => { _gDrag = false; }, 50);
      applyFilters();
    },
  });
}
_gList && _gList.addEventListener('click', e => {
  if (_gDrag) return;
  const chip = e.target.closest('.group-chip');
  if (!chip) return;
  const dim = chip.dataset.dim;
  if (viewMode === 'qa' && typeof QA_ENTITY_GROUP_DIMS !== 'undefined' && QA_ENTITY_GROUP_DIMS.includes(dim)) {
    const nextSheet = groupState.active.has(dim) ? '' : dim;
    setQaResultsSheetFilter(nextSheet, false);
    if (typeof _qaGraphSelectedSheet !== 'undefined') _qaGraphSelectedSheet = nextSheet;
  } else {
    if (groupState.active.has(dim)) groupState.active.delete(dim);
    else groupState.active.add(dim);
    chip.classList.toggle('gchip-active', groupState.active.has(dim));
  }
  applyFilters();
});
