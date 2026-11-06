const assert = require('assert');
const { DOMParser, parseHTML } = require('linkedom');
const { createContext, loadModules, readText, readJavascript, path, root, vm, xmlRequestFor } = require('./test-helpers');

const template = readText(path.join(root, 'index.html'));
const { document, Event } = parseHTML(template);
let focused;
document.querySelectorAll('button,input').forEach(element => { element.focus = () => { focused = element; }; });
let renderCount = 0;
let nextFrame = 0;
const frames = new Map();
const animations = [];
const context = createContext();
Object.assign(context, {
  document, DOMParser,
  XMLHttpRequest: xmlRequestFor(readText(path.join(root, 'specification', 'guerrilla-ops-schema.xml'))),
  requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
  cancelAnimationFrame: frame => frames.delete(frame),
  bootstrap: { Modal: { getInstance: () => null } },
  _updateChangesBtn: () => {},
});
loadModules(context, ['state.js', 'utils.js', 'panels.js', 'pills.js', 'results.js', 'filters.js', 'qa.js', 'filter-tabs.js', 'app-lifecycle.js']);
context.sel = vm.runInContext('sel', context);
context.collapsedFilterCategories = vm.runInContext('collapsedFilterCategories', context);
context.applyFilters = () => { renderCount++; };
context.hydrateFilterControls();
document.querySelectorAll('button,input').forEach(element => { element.focus = () => { focused = element; }; });
context.initFilterTabs();
const evaluate = expression => vm.runInContext(expression, context);
const dimensions = JSON.parse(evaluate('JSON.stringify(DEFAULT_GROUP_ORDER)'));
const list = document.getElementById('group-sortable');
let capturedPointer;
list.setPointerCapture = pointer => { capturedPointer = pointer; };
list.hasPointerCapture = pointer => capturedPointer === pointer;
list.releasePointerCapture = () => { capturedPointer = undefined; };
let scrollTop = 0;
Object.defineProperty(list, 'scrollTop', {
  get: () => scrollTop,
  set: value => { scrollTop = Math.max(0, Math.min(400, value)); },
});
list.getBoundingClientRect = () => ({ top:0, bottom:400, left:0, width:56, height:400 });
for (const tab of list.children) {
  tab.getBoundingClientRect = () => ({
    left:0, top:[...list.children].indexOf(tab) * 100 - list.scrollTop, width:56, height:100,
  });
  tab.animate = (keyframes, options) => {
    const animation = { cancel: () => {}, keyframes, options };
    animations.push(animation);
    return animation;
  };
}
const trigger = dim => document.querySelector(`[data-filter-open="${dim}"]`);
const drawer = dim => document.getElementById('filter-drawer-' + dim);
const group = dim => document.querySelector(`[data-filter-group="${dim}"]`);
const openDrawers = () => [...document.querySelectorAll('#filter-bar .fp')].filter(panel => !panel.classList.contains('d-none'));
const dispatch = (element, type, fields = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, fields);
  element.dispatchEvent(event);
  return event;
};
const order = () => JSON.parse(evaluate('JSON.stringify(groupState.order)'));
const filterCss = readText(path.join(root, 'css', 'filter.css'));
assert(filterCss.includes('#content:has(#btn-qa.active) #filter-tabs,')
  && filterCss.includes('#content:has(#btn-qa.active) #filter-bar {'),
  'QA view must hide both the tab stack and its drawers without clearing filter selections');
const countCss = filterCss.match(/\.filter-tab-count\s*\{([^}]+)\}/)?.[1] || '';
const groupCss = filterCss.match(/\.filter-tab-group\s*\{([^}]+)\}/)?.[1] || '';
const controlsCss = filterCss.match(/\.filter-tab-controls\s*\{([^}]+)\}/)?.[1] || '';
assert(controlsCss.includes('grid-template-columns: minmax(0, 1fr) auto;')
  && controlsCss.includes('padding: 0 2px 0 6px;')
  && groupCss.includes('grid-column: 2;')
  && countCss.includes('overflow: hidden;')
  && !countCss.includes('position: absolute'),
  'counts and checkboxes must have separate columns with clearance for the 4px selection stripe');
assert([...list.children].every(tab => tab.querySelector('.filter-tab-count').parentElement
  === tab.querySelector('.filter-tab-group').parentElement),
  'count and grouping control must share the bottom controls row');
assert([...list.children].every(tab => tab.dataset.label === tab.querySelector('.filter-tab-trigger').title),
  'each label must match the tab name');
assert([...list.children].every(tab => tab.querySelector('.filter-tab-grip').textContent === tab.dataset.label)
  && !list.querySelector('.bi-grip-vertical'),
  'each tab must show its title in place of the grab icon');
assert(!filterCss.includes('.filter-tab-grip { display: none; }'),
  'tab titles must remain visible at compact heights');
const railCss = filterCss.match(/#filter-tabs\s*\{([^}]+)\}/)?.[1] || '';
assert(railCss.includes('position: relative; left: 1px;'),
  'the filter rail must shift right by 1px to merge with the workspace border');
const floatingTabCss = filterCss
  .match(/body > \.filter-tab-fallback\.filter-tab\s*\{([^}]+)\}/)?.[1] || '';
assert(floatingTabCss.includes('position: fixed') && floatingTabCss.includes('transition: none'),
  'the floating tab must track viewport coordinates without the legacy chip transition');
assert(filterCss.includes('background: transparent; color: var(--on-dark);')
  && filterCss.includes('border: 0; border-radius: 8px 0 0 8px;'),
  'the filter rail must have no background panel and only rounded left corners');
assert(!document.querySelector('#filter-tabs .filter-tabs-title'),
  'the filter tab rail must not contain a heading');
assert(filterCss.includes('padding: .3rem 0 .3rem .3rem;')
  && filterCss.includes('border-radius: 5px 0 0 5px;'),
  'filter tabs must remain colored and sit flush against the right edge with rounded left corners');
const resultsCss = readText(path.join(root, 'css', 'results.css'));
const workspaceCss = resultsCss.match(/#results-workspace\s*\{([^}]+)\}/)?.[1] || '';
assert(workspaceCss.includes('background: #fff;')
  && workspaceCss.includes('border-radius: 0 0 9px 9px;'),
  'the shared results workspace must extend its white surface beneath the filter rail');

assert.strictEqual(list.children.length, dimensions.length, 'all schema dimensions must have tabs');
assert(dimensions.every(dim => drawer(dim) && trigger(dim) && group(dim)), 'each tab needs independent filter and grouping controls');
assert.strictEqual(openDrawers().length, 0, 'drawers start closed');
const headerSummary = document.getElementById('header-summary');
assert.strictEqual(headerSummary.parentElement.id, 'hdr', 'the summary must live in the main header');
assert.strictEqual(document.querySelector('#hdr .title').nextElementSibling, headerSummary,
  'the summary must sit immediately to the right of the brand');
assert(!document.querySelector('#app #stats') && !document.getElementById('summary-section-header'),
  'the separate summary section must be removed');
assert.strictEqual(document.querySelectorAll('#stats').length, 1, 'summary IDs must stay unique');
assert(!document.getElementById('summary-toggle-btns') && !document.getElementById('stats-min-btn')
  && !document.getElementById('stats-max-btn') && !document.getElementById('file-lbl'),
  'the summary must have no collapse controls or duplicate project label');
assert(!readJavascript('init.js').includes('go:statsCollapsed'),
  'an old saved collapse preference must not hide the summary');
assert(filterCss.includes('container-type: size') && filterCss.includes('@container (max-height: 70px)'),
  'tabs must adapt their controls to the available tab height');
evaluate(`db.facilities = [{Name:'Demo Facility',_facility:'Demo Facility',Description:'Full facility description'}];
  db.floors = [{Name:'Ground'},{Name:'First'}]; db.spaces = [{Name:'Room'}];
  db.types = [{Name:'Pump'}]; db.components = [{Name:'P-1'},{Name:'P-2'}];
  db.systems = [{Name:'Heating'},{Name:'Heating'}]; idx.systems = ['Heating'];
  db.documents = [{Name:'Manual'}];`);
context._renderSummary();
assert.strictEqual(document.getElementById('fac-name').textContent, 'Demo Facility');
assert.strictEqual(document.getElementById('fac-desc').textContent, 'Full facility description');
assert.strictEqual(document.querySelector('#stats .fac').title, 'Demo Facility - Full facility description',
  'ellipsised summary content must remain available on hover');
assert.deepStrictEqual(['facilities','floors','spaces','types','comps','sys','docs']
  .map(id => document.getElementById('st-' + id).textContent), ['1','2','1','1','2','1','1'],
  'the relocated summary must preserve all counts including deduplicated systems');
assert(dimensions.every(dim => trigger(dim).querySelector('.filter-tab-icon')
  && trigger(dim).getAttribute('title') && trigger(dim).getAttribute('aria-label')),
  'every icon-only tab must keep a hover name and accessible label');
assert(dimensions.every(dim => trigger(dim).textContent === ''
  && group(dim).parentElement.textContent === ''), 'tab names and Group text must not be visible');
assert(list.querySelector('[data-dim="facility"]').getAttribute('style').includes('--pill-fac-bg'),
  'Facility tabs must reuse the existing colour alias');
assert(list.querySelector('[data-dim="doccat"]').getAttribute('style').includes('--pill-doc-bg'),
  'Document Category tabs must reuse the existing colour alias');
assert(!document.getElementById('filter-resize') && !document.getElementById('group-config'), 'obsolete horizontal controls must be removed');
assert.deepStrictEqual([...document.getElementById('results-layout').children].map(node => node.id),
  ['svg-floor-panel', 'viewer-3d-panel', 'results-main', 'qa-graph-panel'], 'viewers precede the hierarchy');
const layout = document.getElementById('results-layout');
assert.strictEqual(document.getElementById('active-bar').parentElement.id, 'results-main',
  'selected filter pills must align with the results column rather than span the viewers');
assert(document.querySelector('#mode-toggle #viewer-toggles #restore-plan-btn[aria-label]')
  && document.querySelector('#mode-toggle #viewer-toggles #restore-3d-btn[aria-label]'),
  'viewer toggles must be accessible in the main mode row rather than the filter pills');
Object.defineProperty(layout, 'clientWidth', { value: 1200 });
context.getComputedStyle = () => ({ paddingLeft:'12px', paddingRight:'12px', columnGap:'12px' });
for (const id of ['svg-floor-panel', 'viewer-3d-panel']) {
  const panel = document.getElementById(id);
  panel.classList.remove('d-none');
  panel.getBoundingClientRect = () => ({ width: 400 });
}
assert.strictEqual(context._workspacePanelMaxWidth('svg-floor-panel', 1400), 512,
  'viewer resizing must reserve 240px for the hierarchy after sibling widths, padding and gaps');

dispatch(trigger('floor'), 'click');
assert.strictEqual(openDrawers().length, 1);
assert.strictEqual(trigger('floor').getAttribute('aria-expanded'), 'true');
assert.strictEqual(evaluate('groupState.active.size'), 0, 'opening a drawer must not group results');
const search = drawer('floor').querySelector('.fp-search');
search.value = 'Level 1';
context.sel.floor.add('level 1');
context.collapsedFilterCategories.add('type::classification');
dispatch(trigger('type'), 'click');
assert(drawer('floor').classList.contains('d-none'));
assert.strictEqual(openDrawers().length, 1, 'only one drawer can be open');
context.syncFilterTabs();
assert.strictEqual(document.getElementById('ftb-floor').textContent, '1', 'closed tabs retain selection counts');
dispatch(drawer('type').querySelector('[data-filter-close]'), 'click');
assert.strictEqual(openDrawers().length, 0);
assert.strictEqual(focused, trigger('type'), 'close restores focus to its tab');
dispatch(trigger('floor'), 'click');
assert.strictEqual(search.value, 'Level 1');
dispatch(document, 'keydown', { key: 'Escape' });
assert.strictEqual(openDrawers().length, 0);
assert(context.sel.floor.has('level 1'), 'closing must preserve filter selections');
assert(context.collapsedFilterCategories.has('type::classification'), 'switching must preserve classification state');

dispatch(group('floor'), 'change');
dispatch(group('type'), 'change');
assert(evaluate("groupState.active.has('floor') && groupState.active.has('type')"));
assert.strictEqual(group('floor').checked, true);
assert.strictEqual(openDrawers().length, 0, 'grouping must not open drawers');
const floorTab = group('floor').closest('.filter-tab');
const grip = floorTab.querySelector('.filter-tab-grip');
dispatch(grip, 'keydown', { key: 'ArrowUp', altKey: true });
assert.strictEqual(order()[0], 'floor');
assert.strictEqual(focused, grip);
assert(document.getElementById('filter-order-status').textContent.startsWith('Grouping order: Floor'));
dispatch(trigger('floor'), 'keydown', { key:'ArrowDown', altKey:true });
assert.strictEqual(order()[1], 'floor', 'icon triggers must support keyboard ordering when grips are hidden');
assert.strictEqual(focused, trigger('floor'));
dispatch(trigger('floor'), 'keydown', { key:'ArrowUp', altKey:true });
assert.strictEqual(order()[0], 'floor');
const orderBeforeDrag = order();
const rendersBeforeDrag = renderCount;
const typeTab = group('type').closest('.filter-tab');
const dragFields = { pointerId:7, button:0, isPrimary:true, clientX:28, clientY:typeTab.getBoundingClientRect().top + 20 };
dispatch(trigger('type'), 'pointerdown', dragFields);
dispatch(document, 'pointermove', { ...dragFields, clientX:-100, clientY:0 });
assert.strictEqual(list.firstElementChild, typeTab, 'vertical movement must reorder tabs even with the pointer left of the rail');
const floatingTab = document.body.querySelector('.filter-tab-fallback');
assert(floatingTab && floatingTab.parentElement === document.body, 'the floating tab must not be clipped by the rail');
assert.strictEqual(floatingTab.style.transform, 'translate3d(-128px, -20px, 0)', 'the grab point must follow the pointer exactly on both axes');
assert.strictEqual(capturedPointer, 7, 'pointer capture must keep dragging active outside the rail');
assert(animations.some(animation => animation.options.duration === 220
  && animation.keyframes[0].transform !== animation.keyframes[1].transform),
  'displaced tabs must animate between their old and new positions');
context.commitFilterTabOrder();
dispatch(grip, 'keydown', { key:'ArrowDown', altKey:true });
assert.deepStrictEqual(order(), orderBeforeDrag, 'visual drag previews must not change the applied hierarchy');
assert.strictEqual(renderCount, rendersBeforeDrag, 'no hierarchy rendering is allowed before drop');
dispatch(document, 'pointerup', dragFields);
assert(!document.body.querySelector('.filter-tab-fallback'), 'drop must remove the floating tab');
assert.strictEqual(capturedPointer, undefined, 'drop must release pointer capture');
assert.strictEqual(renderCount, rendersBeforeDrag + 1, 'a changed drop must render exactly once');
assert.strictEqual(order()[0], 'type');
assert.deepStrictEqual(JSON.parse(evaluate("JSON.stringify(groupState.order.filter(dim => groupState.active.has(dim)))")),
  ['type', 'floor'], 'enabled dimensions follow top-to-bottom precedence');
dispatch(trigger('type'), 'pointerdown', { ...dragFields, clientY:20 });
dispatch(document, 'pointermove', { ...dragFields, clientX:60, clientY:20 });
dispatch(document, 'pointerup', dragFields);
assert.strictEqual(renderCount, rendersBeforeDrag + 1, 'dropping without a reorder must not recompute the hierarchy');
dispatch(trigger('type'), 'click');
assert.strictEqual(openDrawers().length, 0, 'post-drag click must be suppressed');
dispatch(trigger('type'), 'pointerdown', { ...dragFields, clientY:20 });
dispatch(document, 'pointerup', dragFields);
dispatch(trigger('type'), 'click');
assert.strictEqual(openDrawers().length, 1, 'next deliberate click should work');
context.closeFilterDrawer(false);
assert(renderCount >= 4, 'grouping and ordering must refresh results');
const orderBeforeCancel = order();
const rendersBeforeCancel = renderCount;
dispatch(trigger('system'), 'pointerdown', {
  ...dragFields, pointerId:8, pointerType:'touch', clientY:group('system').closest('.filter-tab').getBoundingClientRect().top + 20,
});
dispatch(document, 'pointermove', { ...dragFields, pointerId:8, pointerType:'touch', clientY:0 });
assert.strictEqual(list.firstElementChild.dataset.dim, 'system');
dispatch(document, 'pointercancel', { ...dragFields, pointerId:8 });
assert.deepStrictEqual([...list.children].map(tab => tab.dataset.dim), orderBeforeCancel, 'cancel must restore the preview order');
assert.deepStrictEqual(order(), orderBeforeCancel);
assert.strictEqual(renderCount, rendersBeforeCancel, 'cancel must not recompute the hierarchy');
assert(!document.body.querySelector('.filter-tab-fallback'));
dispatch(trigger('type'), 'pointerdown', { ...dragFields, clientY:20 });
dispatch(document, 'pointermove', { ...dragFields, clientY:450 });
const frame = evaluate('_filterTabDragSession.scrollFrame');
const tick = frames.get(frame);
frames.delete(frame);
tick();
assert.strictEqual(list.scrollTop, 12, 'dragging near the bottom must scroll the rail');
assert.strictEqual(renderCount, rendersBeforeCancel, 'auto-scroll must not recompute the hierarchy');
dispatch(document, 'keydown', { key:'Escape' });
assert.deepStrictEqual([...list.children].map(tab => tab.dataset.dim), orderBeforeCancel, 'Escape must cancel a drag');
assert.strictEqual(frames.size, 0, 'finishing or cancelling must stop auto-scroll frames');
list.scrollTop = 0;

evaluate("viewMode = 'qa'");
context.toggleFilterTabGroup('space');
assert.strictEqual(evaluate('_qaResultsSelectedSheet'), 'space');
assert.strictEqual(group('floor').checked, false, 'QA scope sync must update other entity toggles');
context.toggleFilterTabGroup('type');
assert.strictEqual(evaluate('_qaResultsSelectedSheet'), 'type');
assert.strictEqual(group('space').checked, false);
evaluate("viewMode = 'asset'; groupState.active.clear(); idx.docCatFacilityOnly = new Set(['manual']); idx.catGroups = {};");
let mode;
context.setMode = value => { mode = value; context.syncFilterTabs(); };
context._setFilterSelection('doccat', ['manual'], true);
assert.strictEqual(mode, 'document', 'document-category selection must retain the mode transition');
assert.strictEqual(group('facility').checked, true, 'automatic Facility grouping must update its checkbox');
assert.strictEqual(document.getElementById('ftb-doccat').textContent, '1');

context.closeWorkbooks();
assert.deepStrictEqual(order(), dimensions, 'closing restores default tab order');
assert.strictEqual(evaluate('groupState.active.size'), 0);
assert.strictEqual(openDrawers().length, 0);
assert.strictEqual(search.value, '');
assert(dimensions.every(dim => context.sel[dim].size === 0 && !group(dim).checked));
assert(['facilities','floors','spaces','types','comps','sys','docs']
  .every(id => document.getElementById('st-' + id).textContent === '0'),
  'closing must reset every header summary count');
assert.strictEqual(document.querySelector('#stats .fac').title, '');

for (const filename of ['floor-svg-panel.js', 'three-d-viewer.js']) {
  assert(readJavascript(filename).includes('const delta = moveEvent.clientX - startX;'),
    filename + ' must widen when the right edge moves right');
}
const savedLayouts = new Map();
context.localStorage = {
  getItem: key => savedLayouts.get(key) || null,
  setItem: (key, value) => savedLayouts.set(key, value),
};
context.Event = Event;
const workspaceEvents = document.createElement('div');
context.window.addEventListener = workspaceEvents.addEventListener.bind(workspaceEvents);
context.window.removeEventListener = workspaceEvents.removeEventListener.bind(workspaceEvents);
context.window.dispatchEvent = workspaceEvents.dispatchEvent.bind(workspaceEvents);
context.MutationObserver = class { observe() {} };
Object.defineProperty(layout, 'clientHeight', { value:800 });
for (const panel of layout.children) panel.getClientRects = () => [{}];
document.getElementById('svg-floor-panel').classList.remove('d-none');
document.getElementById('viewer-3d-panel').classList.remove('d-none');
context.initWorkspacePanels();
for (const id of ['restore-plan-btn', 'restore-3d-btn']) {
  const button = document.getElementById(id);
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
  assert(button.classList.contains('active') && !button.classList.contains('d-none'),
    'available open viewers must have visible active mode-row toggles');
}
assert(!document.querySelector('[data-workspace-layout]'), 'edge docking replaces layout toggles');
context.dockWorkspacePanel('viewer-3d-panel', 'svg-floor-panel', 'bottom');
const tree = JSON.parse(savedLayouts.get('go:panelLayout')).tree;
assert.deepStrictEqual(tree.first, {
  axis:'column', ratio:.5, first:'svg-floor-panel', second:'viewer-3d-panel',
}, 'bottom docking must stack viewers within the existing side-by-side layout');
assert.strictEqual(tree.axis, 'row', 'the results must remain beside the stacked viewers');
assert.strictEqual(document.getElementById('svg-floor-panel').style.gridColumn,
  document.getElementById('viewer-3d-panel').style.gridColumn, 'stacked viewers must share a column');
assert.notStrictEqual(document.getElementById('svg-floor-panel').style.gridRow,
  document.getElementById('viewer-3d-panel').style.gridRow, 'stacked viewers need separate rows');
const resizeHandle = (id, edge) => document.querySelector(`#${id} .workspace-resize-handle[data-edge="${edge}"]`);
const planPanel = document.getElementById('svg-floor-panel');
planPanel.getBoundingClientRect = () => ({ width:300, height:200 });
assert(!resizeHandle('svg-floor-panel', 'right').hidden && !resizeHandle('svg-floor-panel', 'bottom').hidden,
  'a panel above and beside neighbours must expose both resizing borders');
assert(resizeHandle('viewer-3d-panel', 'bottom').hidden && resizeHandle('results-main', 'right').hidden,
  'outside borders must not offer resizing');
dispatch(resizeHandle('svg-floor-panel', 'bottom'), 'keydown', { key:'ArrowDown' });
assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .525, 'Down must increase the top panel height');
dispatch(resizeHandle('svg-floor-panel', 'bottom'), 'keydown', { key:'ArrowUp' });
assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .5, 'Up must decrease the top panel height');
const rightRatio = evaluate('_workspaceDock.tree.ratio');
dispatch(resizeHandle('svg-floor-panel', 'right'), 'keydown', { key:'ArrowRight' });
assert.strictEqual(evaluate('_workspaceDock.tree.ratio'), rightRatio + 20 / layout.clientWidth, 'Right must widen the left column');
dispatch(resizeHandle('svg-floor-panel', 'right'), 'keydown', { key:'ArrowLeft' });
const bottomHandle = resizeHandle('svg-floor-panel', 'bottom');
let resizePointer;
bottomHandle.setPointerCapture = pointer => { resizePointer = pointer; };
bottomHandle.hasPointerCapture = pointer => resizePointer === pointer;
bottomHandle.releasePointerCapture = () => { resizePointer = undefined; };
const resizeStart = { button:0, pointerId:21, clientX:100, clientY:100 };
dispatch(bottomHandle, 'pointerdown', resizeStart);
dispatch(workspaceEvents, 'pointermove', { ...resizeStart, pointerId:22, clientY:260 });
assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .5, 'unrelated pointers cannot resize the split');
dispatch(workspaceEvents, 'pointermove', { ...resizeStart, clientY:260 });
assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .7, 'bottom dragging must resize the vertical split');
dispatch(workspaceEvents, 'pointerup', resizeStart);
assert.strictEqual(JSON.parse(savedLayouts.get('go:panelLayout')).tree.first.ratio, .7, 'resized heights must persist');
assert.strictEqual(resizePointer, undefined, 'finishing must release the resize pointer');
for (const cancelEvent of ['pointercancel', 'lostpointercapture']) {
  dispatch(bottomHandle, 'pointerdown', resizeStart);
  dispatch(workspaceEvents, 'pointermove', { ...resizeStart, clientY:-9000 });
  assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .15, 'resize must respect minimum split ratio');
  dispatch(workspaceEvents, 'pointermove', { ...resizeStart, clientY:9000 });
  assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .85, 'resize must respect maximum split ratio');
  dispatch(cancelEvent === 'pointercancel' ? workspaceEvents : bottomHandle, cancelEvent, resizeStart);
  assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .7, 'cancelled resizing must restore the starting ratio');
  assert(!bottomHandle.classList.contains('workspace-resizing'));
  dispatch(workspaceEvents, 'pointermove', { ...resizeStart, clientY:-9000 });
  assert.strictEqual(evaluate('_workspaceDock.tree.first.ratio'), .7, 'cancel must remove pointer listeners');
}
context.dockWorkspacePanel('results-main', 'svg-floor-panel', 'top');
assert(!resizeHandle('results-main', 'bottom').hidden, 'Results must support height resizing when above another panel');
context.dockWorkspacePanel('results-main', 'viewer-3d-panel', 'left');
assert(!resizeHandle('results-main', 'right').hidden && resizeHandle('results-main', 'bottom').hidden,
  'Results must support width resizing and remove obsolete height resizing after redocking');
evaluate(`_workspaceDock.tree = ${JSON.stringify(tree)}; _workspaceDock.render()`);
dispatch(document.getElementById('svgp-edge-toggle'), 'keydown', { key:'ArrowRight', altKey:true });
const keyboardTree = JSON.parse(savedLayouts.get('go:panelLayout')).tree;
assert.strictEqual(resizeHandle('svg-floor-panel', 'bottom').hidden, true,
  'docking must remove obsolete bottom resize handles');
assert.deepStrictEqual(keyboardTree.first, {
  axis:'row', ratio:.5, first:'viewer-3d-panel', second:'svg-floor-panel',
}, 'keyboard right docking must replace the stack with side-by-side viewers');
context.dockWorkspacePanel('svg-floor-panel', 'results-main', 'top');
const idsInTree = node => typeof node === 'string' ? [node] : [...idsInTree(node.first), ...idsInTree(node.second)];
assert.deepStrictEqual(idsInTree(JSON.parse(savedLayouts.get('go:panelLayout')).tree).sort(),
  ['qa-graph-panel', 'results-main', 'svg-floor-panel', 'viewer-3d-panel'],
  'repeated docking must retain every panel exactly once, including hidden panels');
for (const edge of ['left', 'right', 'top', 'bottom']) {
  for (const id of ['svg-floor-panel', 'viewer-3d-panel', 'results-main', 'qa-graph-panel']) {
    for (const target of ['svg-floor-panel', 'viewer-3d-panel', 'results-main', 'qa-graph-panel']) {
      if (id === target) continue;
      context.dockWorkspacePanel(id, target, edge);
      const saved = JSON.parse(savedLayouts.get('go:panelLayout'));
      assert.strictEqual(saved.version, 2);
      assert.deepStrictEqual(idsInTree(saved.tree).sort(),
        ['qa-graph-panel', 'results-main', 'svg-floor-panel', 'viewer-3d-panel'],
        `${edge} docking must not duplicate or lose panels`);
    }
  }
}
document.getElementById('svg-floor-panel').classList.add('svg-panel-collapsed');
document.getElementById('viewer-3d-panel').classList.add('viewer3d-collapsed');
evaluate('_workspaceDock.render()');
assert.strictEqual(document.getElementById('results-main').style.gridColumn, '1 / 2');
assert.strictEqual(document.getElementById('results-main').style.gridRow, '1 / 2',
  'hidden or collapsed panels must not reserve grid tracks');
assert(resizeHandle('results-main', 'right').hidden && resizeHandle('results-main', 'bottom').hidden,
  'a lone visible panel must have no resize handles');
for (const id of ['restore-plan-btn', 'restore-3d-btn']) {
  const button = document.getElementById(id);
  assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
  assert(!button.classList.contains('active') && !button.classList.contains('d-none'),
    'collapsed viewers must retain visible inactive toggles for reopening');
}
document.getElementById('svg-floor-panel').classList.add('d-none');
evaluate('_workspaceDock.render()');
assert(document.getElementById('restore-plan-btn').classList.contains('d-none'),
  'an unavailable viewer must not expose a nonfunctional toggle');
console.log('Filter tab interaction and layout regressions passed.');
