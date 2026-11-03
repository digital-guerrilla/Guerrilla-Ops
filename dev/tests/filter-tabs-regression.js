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
const floatingTabCss = filterCss
  .match(/body > \.filter-tab-fallback\.filter-tab\s*\{([^}]+)\}/)?.[1] || '';
assert(floatingTabCss.includes('position: fixed') && floatingTabCss.includes('transition: none'),
  'the floating tab must track viewport coordinates without the legacy chip transition');

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
assert(dimensions.every(dim => trigger(dim).textContent === document.getElementById('ftb-' + dim).textContent
  && group(dim).parentElement.textContent === ''), 'tab names and Group text must not be visible');
assert(list.querySelector('[data-dim="facility"]').getAttribute('style').includes('--pill-fac-bg'),
  'Facility tabs must reuse the existing colour alias');
assert(list.querySelector('[data-dim="doccat"]').getAttribute('style').includes('--pill-doc-bg'),
  'Document Category tabs must reuse the existing colour alias');
assert(!document.getElementById('filter-resize') && !document.getElementById('group-config'), 'obsolete horizontal controls must be removed');
assert.deepStrictEqual([...document.getElementById('results-layout').children].map(node => node.id),
  ['svg-floor-panel', 'viewer-3d-panel', 'results-main', 'qa-graph-panel'], 'viewers precede the hierarchy');
const layout = document.getElementById('results-layout');
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
console.log('Filter tab interaction and layout regressions passed.');
