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

document.getElementById('filter-bar').addEventListener('click', e => {
  const item = e.target.closest('.fp-item');
  if (item && !item.classList.contains('fp-zero')) {
    toggle(item.dataset.dim, item.dataset.key); return;
  }
  const cat = e.target.closest('.fp-cat-hdr');
  if (cat) toggleCategory(cat.dataset.dim, cat.dataset.cat);
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
  } else {
    sel[rm.dataset.dim].delete(rm.dataset.key);
  }
  applyFilters();
});

// ── Result list interactions ──────────────────────────────────
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
  const hl = e.target.closest('[data-grphl]');
  if (hl) {
    highlightGroupSelection(hl, !!(e.ctrlKey || e.metaKey));
    return;
  }
  const documentEditButton = e.target.closest('[data-edit-doc]');
  if (documentEditButton) {
    const documentRow = docStore[+documentEditButton.dataset.editDoc];
    if (documentRow) openDocumentEdit(documentRow);
    return;
  }
  const eb = e.target.closest('[data-edit-entity]');
  if (eb) { openEditModal(eb.dataset.editEntity, eb.dataset.editKey, eb.dataset.editFac); return; }
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
  const hdr = e.target.closest('.grp-hdr');
  if (hdr && hdr.dataset.cid) {
    _toggleGroupHeader(hdr);
  }
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
  const documentEditButton = e.target.closest('[data-edit-doc]');
  if (documentEditButton) {
    const documentRow = docStore[+documentEditButton.dataset.editDoc];
    if (documentRow) openDocumentEdit(documentRow);
    return;
  }
  const eb = e.target.closest('[data-edit-entity]');
  if (eb) { openEditModal(eb.dataset.editEntity, eb.dataset.editKey, eb.dataset.editFac); return; }
  const b = e.target.closest('[data-doc]');
  if (!b) return;
  const d = docStore[+b.dataset.doc];
  if (!d) return;
  const tm = bootstrap.Modal.getInstance(document.getElementById('type-modal'));
  if (tm) {
    tm.hide();
    document.getElementById('type-modal').addEventListener('hidden.bs.modal', () => openDoc(d), { once: true });
  } else { openDoc(d); }
});

// ── Document modal interactions ───────────────────────────────
document.getElementById('mdoc-body').addEventListener('click', e => {
  const editBtn = e.target.closest('[data-edit-doc]');
  if (editBtn) {
    const documentRow = docStore[+editBtn.dataset.editDoc];
    if (documentRow) openDocumentEdit(documentRow);
    return;
  }
  const b=e.target.closest('.cp-btn');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.p).then(()=>{
    b.innerHTML='<i class="bi bi-check2"></i>';
    setTimeout(()=>{ b.innerHTML='<i class="bi bi-clipboard"></i>'; },2000);
  });
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
  if (groupState.active.has(dim)) groupState.active.delete(dim);
  else groupState.active.add(dim);
  chip.classList.toggle('gchip-active', groupState.active.has(dim));
  applyFilters();
});

// ── Edit modal interactions ───────────────────────────────────
document.getElementById('edit-modal').addEventListener('click', e => {
  const rmBtn = e.target.closest('.rm-doc-btn');
  if (rmBtn) {
    const row = rmBtn.closest('.edit-doc-row');
    if (row) {
      _editDocRemovals.push({
        sheetName:row.dataset.sheet, rowName:row.dataset.row,
        docName:row.dataset.origName, docRef:row.dataset.docRef,
      });
      row.remove();
    }
    return;
  }
  const addBtn = e.target.closest('.add-doc-btn');
  if (addBtn) {
    const cont = document.getElementById('doc-rows-' + addBtn.dataset.sheet.toLowerCase());
    if (cont) {
      cont.insertAdjacentHTML('beforeend', _docEditRow(null, addBtn.dataset.sheet, addBtn.dataset.row, true));
    }
    return;
  }
  const editLinkBtn = e.target.closest('.edit-doc-link-btn');
  if (editLinkBtn) {
    const row = editLinkBtn.closest('.edit-doc-row');
    row?.querySelector('.doc-link-display')?.classList.add('d-none');
    const editor = row?.querySelector('.doc-link-editor');
    editor?.classList.remove('d-none');
    editor?.querySelector('.doc-link-input')?.focus();
    return;
  }
  const pasteBtn = e.target.closest('.paste-doc-link-btn');
  if (pasteBtn) {
    const row = pasteBtn.closest('.edit-doc-row');
    const input = row?.querySelector('.doc-link-input');
    const note = row?.querySelector('.doc-link-note');
    navigator.clipboard.readText().then(text => {
      if (input) input.value = text;
      if (note) note.textContent = '';
    }).catch(() => {
      input?.focus();
      if (note) note.textContent = 'Press Ctrl+V to paste into the link field.';
    });
    return;
  }
  const browseBtn = e.target.closest('.browse-doc-link-btn');
  if (browseBtn) {
    browseBtn.closest('.edit-doc-row')?.querySelector('.doc-file-picker')?.click();
  }
});

document.getElementById('edit-modal').addEventListener('change', e => {
  const picker = e.target.closest('.doc-file-picker');
  if (!picker?.files?.length) return;
  const row = picker.closest('.edit-doc-row');
  const input = row?.querySelector('.doc-link-input');
  const note = row?.querySelector('.doc-link-note');
  const file = picker.files[0];
  const exposedPath = file.path || file.webkitRelativePath ||
    (!/fakepath/i.test(picker.value) ? picker.value : '');
  if (input) input.value = exposedPath || file.name;
  if (note) note.textContent = exposedPath
    ? ''
    : 'Your browser hides the full local path. Paste the full path here if the file name alone is not enough.';
});
