let _openFilterDimension = '';
let _filterTabDragging = false;
let _filterTabSuppressClick = false;
let _filterTabDragSession = null;
const _filterTabAnimations = new Map();

function _cancelFilterTabAnimations() {
  _filterTabAnimations.forEach(animation => animation.cancel());
  _filterTabAnimations.clear();
}

function _measureFilterTabSlots(session) {
  session.slots = new Map([...session.list.children].map(tab => [tab, tab.getBoundingClientRect()]));
  session.measuredScrollTop = session.list.scrollTop;
}

function _previewFilterTabOrder(session) {
  const otherTabs = [...session.list.children].filter(tab => tab !== session.tab);
  const centerY = session.clientY - session.offsetY + session.height / 2;
  const scrollDelta = session.list.scrollTop - session.measuredScrollTop;
  const nextTab = otherTabs.find(tab => {
    const rect = session.slots.get(tab);
    return centerY < rect.top + rect.height / 2 - scrollDelta;
  }) || null;
  if (session.tab.nextElementSibling === nextTab) return;

  const before = new Map(otherTabs.map(tab => [tab, tab.getBoundingClientRect().top]));
  _cancelFilterTabAnimations();
  session.list.insertBefore(session.tab, nextTab);
  _measureFilterTabSlots(session);
  otherTabs.forEach(tab => {
    const delta = before.get(tab) - session.slots.get(tab).top;
    if (Math.abs(delta) < 0.5) return;
    const animation = tab.animate([
      { transform:`translateY(${delta}px)` },
      { transform:'translateY(0)' },
    ], { duration:220, easing:'cubic-bezier(0.2, 0, 0, 1)' });
    _filterTabAnimations.set(tab, animation);
    animation.onfinish = () => {
      if (_filterTabAnimations.get(tab) === animation) _filterTabAnimations.delete(tab);
    };
  });
}

function _scrollFilterTabsWhileDragging() {
  const session = _filterTabDragSession;
  if (!session?.started) return;
  const rect = session.list.getBoundingClientRect();
  let scroll = 0;
  if (session.clientY < rect.top + 24) scroll = -Math.min(12, (rect.top + 24 - session.clientY) / 2);
  else if (session.clientY > rect.bottom - 24) scroll = Math.min(12, (session.clientY - rect.bottom + 24) / 2);
  const before = session.list.scrollTop;
  session.list.scrollTop += scroll;
  if (session.list.scrollTop !== before) _previewFilterTabOrder(session);
  session.scrollFrame = requestAnimationFrame(_scrollFilterTabsWhileDragging);
}

function _startFilterTabDrag(session) {
  _cancelFilterTabAnimations();
  const floatingTab = session.tab.cloneNode(true);
  floatingTab.removeAttribute('id');
  floatingTab.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  floatingTab.querySelectorAll('[title]').forEach(element => element.removeAttribute('title'));
  floatingTab.setAttribute('aria-hidden', 'true');
  floatingTab.setAttribute('inert', '');
  floatingTab.classList.add('filter-tab-fallback');
  floatingTab.style.width = session.width + 'px';
  floatingTab.style.height = session.height + 'px';
  document.body.appendChild(floatingTab);
  session.floatingTab = floatingTab;
  session.started = true;
  _filterTabDragging = true;
  _filterTabSuppressClick = true;
  session.tab.classList.add('filter-tab-ghost');
  document.body.classList.add('filter-tabs-dragging');
  session.list.setPointerCapture(session.pointerId);
  _measureFilterTabSlots(session);
  session.scrollFrame = requestAnimationFrame(_scrollFilterTabsWhileDragging);
}

function _moveFilterTabDrag(event) {
  const session = _filterTabDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  session.clientX = event.clientX;
  session.clientY = event.clientY;
  if (!session.started) {
    if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4) return;
    _startFilterTabDrag(session);
  }
  event.preventDefault();
  session.floatingTab.style.transform = `translate3d(${event.clientX - session.offsetX}px, ${event.clientY - session.offsetY}px, 0)`;
  _previewFilterTabOrder(session);
}

function _finishFilterTabDrag(commit = true) {
  const session = _filterTabDragSession;
  if (!session) return;
  _filterTabDragSession = null;
  if (!session.started) return;
  cancelAnimationFrame(session.scrollFrame);
  session.floatingTab.remove();
  session.tab.classList.remove('filter-tab-ghost');
  document.body.classList.remove('filter-tabs-dragging');
  if (!commit) {
    _cancelFilterTabAnimations();
    session.originalOrder.forEach(tab => session.list.appendChild(tab));
  }
  if (session.list.hasPointerCapture(session.pointerId)) session.list.releasePointerCapture(session.pointerId);
  _filterTabDragging = false;
  if (commit) commitFilterTabOrder();
}

function syncFilterTabs() {
  document.querySelectorAll('#group-sortable .filter-tab').forEach(tab => {
    const dim = tab.dataset.dim;
    const open = dim === _openFilterDimension;
    const selected = sel[dim].size;
    tab.classList.toggle('filter-tab-open', open);
    tab.classList.toggle('gchip-active', groupState.active.has(dim));
    tab.querySelector('[data-filter-group]').checked = groupState.active.has(dim);
    tab.querySelector('[data-filter-open]').setAttribute('aria-expanded', String(open));
    const badge = document.getElementById('ftb-' + dim);
    badge.textContent = String(selected);
    badge.classList.toggle('d-none', selected === 0);
    document.getElementById('filter-drawer-' + dim).classList.toggle('d-none', !open);
  });
}

function setOpenFilterDimension(dim = '', focusSearch = false) {
  _openFilterDimension = dim;
  syncFilterTabs();
  if (focusSearch && dim) {
    document.getElementById('filter-drawer-' + dim).querySelector('.fp-search').focus();
  }
}

function closeFilterDrawer(restoreFocus = true) {
  const dim = _openFilterDimension;
  setOpenFilterDimension();
  if (restoreFocus && dim) {
    document.querySelector(`[data-filter-open="${dim}"]`).focus();
  }
}

function resetFilterTabs() {
  _finishFilterTabDrag(false);
  _cancelFilterTabAnimations();
  const list = document.getElementById('group-sortable');
  DEFAULT_GROUP_ORDER.forEach(dim => {
    list.appendChild(list.querySelector(`.filter-tab[data-dim="${dim}"]`));
  });
  _filterTabDragging = false;
  _filterTabSuppressClick = false;
  setOpenFilterDimension();
}

function commitFilterTabOrder() {
  if (_filterTabDragging) return;
  const order = [...document.querySelectorAll('#group-sortable .filter-tab')].map(tab => tab.dataset.dim);
  if (order.every((dim, index) => dim === groupState.order[index])) return;
  groupState.order = order;
  document.getElementById('filter-order-status').textContent = 'Grouping order: ' + groupState.order
    .map(dim => DIM_CFG[dim].label).join(', ');
  applyFilters();
}

function toggleFilterTabGroup(dim) {
  if (viewMode === 'qa' && QA_ENTITY_GROUP_DIMS.includes(dim)) {
    const nextSheet = groupState.active.has(dim) ? '' : dim;
    setQaResultsSheetFilter(nextSheet, false);
    _qaGraphSelectedSheet = nextSheet;
  } else {
    if (groupState.active.has(dim)) groupState.active.delete(dim);
    else groupState.active.add(dim);
  }
  syncFilterTabs();
  applyFilters();
}

function initFilterTabs() {
  const list = document.getElementById('group-sortable');
  list.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || _filterTabDragSession) return;
    _filterTabSuppressClick = false;
    const handle = event.target.closest('.filter-tab-grip, .filter-tab-trigger');
    if (!handle) return;
    const tab = handle.closest('.filter-tab');
    const rect = tab.getBoundingClientRect();
    _filterTabDragSession = {
      list, tab, pointerId:event.pointerId, originalOrder:[...list.children],
      startX:event.clientX, startY:event.clientY, clientX:event.clientX, clientY:event.clientY,
      offsetX:event.clientX - rect.left, offsetY:event.clientY - rect.top,
      width:rect.width, height:rect.height, started:false,
    };
  });
  document.addEventListener('pointermove', _moveFilterTabDrag);
  document.addEventListener('pointerup', event => {
    if (event.pointerId === _filterTabDragSession?.pointerId) _finishFilterTabDrag();
  });
  document.addEventListener('pointercancel', event => {
    if (event.pointerId === _filterTabDragSession?.pointerId) _finishFilterTabDrag(false);
  });
  list.addEventListener('lostpointercapture', event => {
    if (event.pointerId === _filterTabDragSession?.pointerId) _finishFilterTabDrag(false);
  });
  list.addEventListener('dragstart', event => event.preventDefault());
  window.addEventListener('blur', () => _finishFilterTabDrag(false));
  window.addEventListener('resize', () => _finishFilterTabDrag(false));
  list.addEventListener('click', event => {
    if (_filterTabDragging || _filterTabSuppressClick) {
      event.preventDefault();
      return;
    }
    const trigger = event.target.closest('[data-filter-open]');
    if (trigger) setOpenFilterDimension(_openFilterDimension === trigger.dataset.filterOpen ? '' : trigger.dataset.filterOpen);
  });
  // A new deliberate pointer/keyboard action releases drag-click suppression.
  list.addEventListener('change', event => {
    const input = event.target.closest('[data-filter-group]');
    if (input) toggleFilterTabGroup(input.dataset.filterGroup);
  });
  list.addEventListener('keydown', event => {
    if (_filterTabDragging) return;
    _filterTabSuppressClick = false;
    const handle = event.target.closest('.filter-tab-grip, .filter-tab-trigger');
    if (!handle || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const tab = handle.closest('.filter-tab');
    const adjacent = event.key === 'ArrowUp' ? tab.previousElementSibling : tab.nextElementSibling;
    if (!adjacent) return;
    if (event.key === 'ArrowUp') list.insertBefore(tab, adjacent);
    else list.insertBefore(adjacent, tab);
    commitFilterTabOrder();
    handle.focus();
  });
  document.getElementById('filter-bar').addEventListener('click', event => {
    if (event.target.closest('[data-filter-close]')) closeFilterDrawer();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && _filterTabDragSession?.started) {
      event.preventDefault();
      _finishFilterTabDrag(false);
      return;
    }
    if (event.key !== 'Escape' || !_openFilterDimension || document.querySelector('.modal.show')) return;
    event.preventDefault();
    closeFilterDrawer();
  });
  syncFilterTabs();
}
