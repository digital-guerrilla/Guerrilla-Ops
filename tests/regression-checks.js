const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'dev', 'javascript');
const context = {
  console,
  db: {
    types:[], components:[], spaces:[], floors:[], zones:[], systems:[], documents:[],
    facilities:[], contacts:[], attributes:[], coordinates:[], picklists:[], facility:null,
  },
  idx:{},
  sel:{ facility:new Set(), floor:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() },
  collapsedFilterCategories:new Set(),
  _changeLog:[],
  XLSX:{ utils:{ sheet_to_json:sheet => sheet } },
  document:{
    getElementById:() => null,
    querySelectorAll:() => [],
    addEventListener:() => {},
  },
  window:{ addEventListener:() => {} },
  searchQuery:'coordinate-test',
  collapseCounter:0,
  pendingGroups:{},
  _logChange:() => {},
};
vm.createContext(context);

function loadModule(filename) {
  const source = fs.readFileSync(path.join(javascriptDir, filename), 'utf8');
  vm.runInContext(source, context, { filename });
}

function workbook(facility, floor) {
  return {
    Sheets:{
      Facility:[{ Name:facility }],
      Floor:[floor],
    },
  };
}

fs.readdirSync(javascriptDir)
  .filter(filename => filename.endsWith('.js'))
  .forEach(filename => execFileSync(process.execPath, ['--check', path.join(javascriptDir, filename)]));

const logoThemeSource = fs.readFileSync(path.join(javascriptDir, 'logo-theme.js'), 'utf8');
const logoSvgSource = fs.readFileSync(path.join(root, 'dev', 'svgs', 'Guerrilla-Ops.svg'), 'utf8').trim();
const releaseBuilderSource = fs.readFileSync(path.join(root, 'build', 'build_release.py'), 'utf8');
const devIndexSource = fs.readFileSync(path.join(root, 'dev', 'index.html'), 'utf8');
const modalsSource = fs.readFileSync(path.join(javascriptDir, 'modals.js'), 'utf8');
const qaSource = fs.readFileSync(path.join(javascriptDir, 'qa.js'), 'utf8');
const qaGraphSource = fs.readFileSync(path.join(javascriptDir, 'qa-graph.js'), 'utf8');
const qaResultsSource = fs.readFileSync(path.join(javascriptDir, 'results.js'), 'utf8');
const appLifecycleSource = fs.readFileSync(path.join(javascriptDir, 'app-lifecycle.js'), 'utf8');
const qaSchemaSource = fs.readFileSync(path.join(root, 'dev', 'specification', 'ids_cobie.xml'), 'utf8');
const resultsCssSource = fs.readFileSync(path.join(javascriptDir, '..', 'css', 'results.css'), 'utf8');
const currentJavascriptSource = fs.readdirSync(javascriptDir)
  .filter(filename => filename.endsWith('.js'))
  .map(filename => fs.readFileSync(path.join(javascriptDir, filename), 'utf8'))
  .join('\n');
assert(!fs.existsSync(path.join(javascriptDir, 'edit.js')), 'the legacy edit modal module must remain removed');
assert(!devIndexSource.includes('id="edit-modal"') && !devIndexSource.includes('javascript/edit.js'),
  'development HTML must not contain or load the legacy edit modal');
assert(qaResultsSource.includes('active: new Set()') && !appLifecycleSource.includes("groupState.active.add('type')") &&
  !devIndexSource.includes('class="group-chip gchip-active" data-dim="type"'),
  'no view may default result grouping to Type');
['openEditModal', 'data-edit-entity', "getElementById('edit-modal')", '_editState'].forEach(reference => {
  assert(!currentJavascriptSource.includes(reference), `legacy edit modal reference must remain removed: ${reference}`);
});
assert(!qaSource.includes('bi-pencil') && !qaSource.includes('data-edit-entity'),
  'QA finding cards must use only the editable information action');
assert(modalsSource.includes("info: { icon:'bi-info-circle-fill', color:'text-info', label:'Advisory' }") &&
  modalsSource.includes("warning: { icon:'bi-exclamation-triangle-fill', color:'text-warning', label:'Warning' }"),
  'modal QA flags must distinguish advisories from warning triangles');
assert(devIndexSource.includes('id="qa-graph-edge-toggle"'),
  'the QA graph must expose a resize and collapse edge control');
assert(devIndexSource.includes('id="file-operation-progress"') && appLifecycleSource.includes('function _fileOperationProgress'),
  'file loading and saving must share a visible QA-styled progress surface');
['Reading ${file.name}', 'Decoding workbook structure', 'Merging COBie rows',
  'Rebuilding workbook indexes', 'Capturing workbook baseline', 'Rendering workspace'].forEach(stage => {
  assert(appLifecycleSource.includes(stage), `file loading progress must report the ${stage} phase`);
});
['Collecting workbook rows', 'Synchronizing ${name} sheet', 'Serializing workbook and styles',
  'Packaging workbook bytes', 'Writing workbook bytes', 'Closing destination file',
  'Reopening saved workbook', 'Capturing saved baseline', 'Save complete'].forEach(stage => {
  assert(currentJavascriptSource.includes(stage), `file save progress must report the ${stage} phase`);
});
assert(resultsCssSource.includes('width: 50vw;') && resultsCssSource.includes('.qa-graph-collapsed'),
  'the QA graph must default to half width and support a collapsed state');
assert(qaGraphSource.includes('_qaGraphDesiredWidth') && qaGraphSource.includes('_bindQaGraphResizeAndToggle'),
  'the QA graph must bind desktop drag resizing and click collapse behavior');
assert(qaSchemaSource.includes('profile="NBIMS-US-V3-current-rules"'),
  'QA must use the current named NBIMS rule profile');
assert(qaSchemaSource.includes('ruleId="System.PrimaryKey.Unique" keys="Name|ComponentNames"'),
  'System uniqueness must use Name and ComponentNames as its compound key');
assert(qaSchemaSource.includes('ruleId="Zone.PrimaryKey.Unique" keys="Name|SpaceNames"'),
  'Zone uniqueness must use Name and SpaceNames as its compound key');
assert(!qaSchemaSource.includes('<sheet name="Document"'),
  'worksheets outside the current rule catalog must not affect QA scores');
[
  'Contact.AtLeastOneRowPresent', 'Facility.OneAndOnlyOneFacilityFound',
  'Space.PrimaryKey.Unique.Warning',
  'Zone.SpaceNames.CrossReference', 'Type.Type.Component.AComponentForEachType',
  'Component.PrimaryKey.Unique.Error', 'System.ComponentNames.CrossReference',
].forEach(ruleId => assert(qaSchemaSource.includes(ruleId), `missing named QA rule ${ruleId}`));
assert(qaSchemaSource.includes('<column name="Height" checks="ZeroOrGreaterOrNA"/>'),
  'Floor Height must use ZeroOrGreaterOrNA');
assert(/<sheet name="Type"[\s\S]*?<column name="Description" checks="NotNull"\/>[\s\S]*?<\/sheet>/.test(qaSchemaSource),
  'Type Description must be checked by QA');
assert(releaseBuilderSource.includes("module == 'qa.js'") && releaseBuilderSource.includes('QA_SCHEMA_SOURCE'),
  'standalone builds must embed the active QA XML profile');
assert(!qaSource.includes('_qaDefaultSchema') && !qaSource.includes('fallbackUsed') && qaSource.includes('No fallback rules were applied.'),
  'QA schema failures must be reported explicitly without legacy fallback rules');
[
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'release', 'Guerrilla-Ops.html'), 'utf8'),
].forEach((standaloneSource, index) => {
  const embedded = standaloneSource.match(/const _QA_EMBEDDED_SCHEMA = ([^\r\n]+);/);
  assert(embedded, `standalone output ${index + 1} must contain an embedded QA XML string`);
  assert.strictEqual(vm.runInNewContext(embedded[1]), qaSchemaSource,
    `standalone output ${index + 1} must embed the exact current QA XML source`);
  assert(!standaloneSource.includes('_qaDefaultSchema') && !standaloneSource.includes('fallbackUsed'),
    `standalone output ${index + 1} must not contain legacy QA fallback code`);
  assert(!standaloneSource.includes('specification/ids_cobie.xml'),
    `standalone output ${index + 1} must not reference an external QA XML file`);
  assert(standaloneSource.includes('const _QA_SCHEMA_PATHS = [];'),
    `standalone output ${index + 1} must disable external QA schema loading`);
  assert(standaloneSource.includes('const xmlText = _QA_EMBEDDED_SCHEMA;') &&
    !standaloneSource.includes('_QA_EMBEDDED_SCHEMA || _qaReadXmlSync'),
    `standalone output ${index + 1} must load QA rules exclusively from embedded XML`);
});

const qaContext = {
  console,
  db:{
    contacts:[], facilities:[], floors:[], spaces:[], types:[], components:[], systems:[
      { Name:'Heating', Category:'Supply', ComponentNames:'AHU-01', _facility:'Facility A' },
      { Name:'Heating', Category:'Supply', ComponentNames:'AHU-02', _facility:'Facility A' },
    ],
    documents:[
      { Name:'Manual', SheetName:'Component', RowName:'AHU-01', File:'manual.pdf', _facility:'Facility A' },
      { Name:'Manual', SheetName:'Component', RowName:'AHU-02', File:'manual.pdf', _facility:'Facility A' },
    ],
    zones:[], attributes:[], coordinates:[],
  },
  idx:{},
  sel:{ facility:new Set(), floor:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() },
  searchQuery:'',
};
vm.createContext(qaContext);
vm.runInContext(qaSource, qaContext, { filename:'qa.js' });
vm.runInContext(`
  _qaSchemaCache = {
    error:'',
    formats:{ email:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/ },
    checkSeverities:Object.create(null),
    checkSeverityByField:Object.create(null),
    sheets:[{
      name:'System', required:false, requiredSeverity:'error', formatSeverity:'warning',
      uniqueSeverity:'error', referenceSeverity:'error',
      columns:[
        { name:'CreatedBy', aliases:[], checks:['NotNull'], severity:'' },
        { name:'Category', aliases:[], checks:['NotNull'], severity:'' },
        { name:'ExternalSystem', aliases:['ExtSystem'], checks:['NotEmpty'], severity:'' },
        { name:'Description', aliases:[], checks:['NotEmpty'], severity:'' },
        { name:'Name', aliases:[], checks:['NotNull'], severity:'' },
        { name:'ComponentNames', aliases:[], checks:['NotNull'], severity:'' },
      ],
      uniqueRules:[{ ruleId:'System.PrimaryKey.Unique', keys:['Name','ComponentNames'], severity:'error' }],
      references:[
        { ruleId:'System.CreatedBy.CrossReference', column:'CreatedBy', targetSheet:'Contact', targetColumn:'Email', required:true, severity:'error', multiValueDelimiter:';' },
        { ruleId:'System.ComponentNames.CrossReference', column:'ComponentNames', targetSheet:'Component', targetColumn:'Name', required:true, severity:'error', multiValueDelimiter:';' },
      ],
      relationRules:[],
    }],
  };
`, qaContext);
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('NotNull', 'n/a', _qaSchemaCache)", qaContext), false,
  'NotNull must reject n/a');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('NotEmpty', 'n/a', _qaSchemaCache)", qaContext), true,
  'NotEmpty must accept n/a');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('ValidNumberOrNA', 'n/a', _qaSchemaCache)", qaContext), true,
  'ValidNumberOrNA must accept n/a');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('ZeroOrGreaterOrNA', '-1', _qaSchemaCache)", qaContext), false,
  'ZeroOrGreaterOrNA must reject negative values');
assert.strictEqual(vm.runInContext("_qaNamedCheckSeverity('NotNull')", qaContext), 'warning',
  'missing required COBie values must be warnings');
assert.strictEqual(vm.runInContext("_qaNamedCheckSeverity('NotEmpty')", qaContext), 'info',
  'missing ancillary COBie values must be advisory findings');
assert.strictEqual(vm.runInContext("_qaCheckId('Floor.Height.ZeroOrGreaterOrNA', 'format')", qaContext),
  'Floor.Height.ZeroOrGreaterOrNA', 'named rule IDs must not receive UI issue-type suffixes');
let qaCompoundFindings = vm.runInContext('runQA()', qaContext);
assert(!qaCompoundFindings.some(finding => finding.check === 'System.PrimaryKey.Unique' && finding.entityType === 'system'),
  'repeated System names with different compound keys must be allowed');
qaContext.db.systems.push({ ...qaContext.db.systems[0] });
qaCompoundFindings = vm.runInContext('runQA()', qaContext);
assert(qaCompoundFindings.some(finding => finding.check === 'System.PrimaryKey.Unique' && finding.entityType === 'system'),
  'an exact duplicate System compound key must fail uniqueness');
assert(vm.runInContext('qaRuleResults.some(result => result.pass > 0 || result.fail > 0)', qaContext),
  'QA evaluation must publish pass/fail counts for reactive charts');
assert(qaCompoundFindings.some(finding => finding.check.endsWith('.NotNull') && finding.sev === 'warning'),
  'current-profile QA audits must classify required field omissions as warnings');
assert(qaCompoundFindings.some(finding => finding.check.endsWith('.NotEmpty') && finding.sev === 'info'),
  'current-profile QA audits must classify ancillary field omissions as advisory');
assert(qaCompoundFindings.some(finding => finding.issueType === 'reference' && finding.sev === 'error'),
  'cross-reference failures must remain errors');
assert(vm.runInContext("qaRuleResults.some(result => result.sheet === 'System' && result.column.includes('Name + ComponentNames'))", qaContext),
  'System compound-key scores must retain their sheet and combined column dimensions');
const pdfReportContract = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  globalThis.esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  db.facilities = [{ Name:'Facility A', _facility:'Facility A' }];
  const html = _qaPdfReportHtml('<svg id="qa-report-brand"></svg>');
  return {
    hasA4:html.includes('@page { size:A4 portrait'),
    hasFacility:html.includes('Facility A'),
    hasBrand:html.includes('qa-report-brand'),
    hasSummaries:html.includes('Overall score') && html.includes('Rules assessed') && html.includes('Advisories'),
    hasDisclaimer:html.includes('provided without guarantee of accuracy'),
    hasAllResults:qaRuleResults.every(result => html.includes(esc(result.label || result.check)) && html.includes(esc(result.column || 'Sheet'))),
  };
})())`, qaContext));
assert.deepStrictEqual(pdfReportContract, {
  hasA4:true, hasFacility:true, hasBrand:true, hasSummaries:true, hasDisclaimer:true, hasAllResults:true,
}, 'the PDF export must include branding, scope, summaries, disclaimer, and every sheet/column QA result');
qaContext.viewMode = 'asset';
vm.runInContext(`
  qaFindings = runQA();
  qaHasRun = true;
  _qaFullRunCalls = 0;
  _qaOriginalRun = runQA;
  runQA = () => { _qaFullRunCalls++; return []; };
  db.systems[db.systems.length - 1].ComponentNames = 'AHU-03';
  qaRevalidateFieldChange('system', 'Heating', 'Facility A', ['ComponentNames']);
`, qaContext);
assert.strictEqual(vm.runInContext('_qaFullRunCalls', qaContext), 0,
  'editing a modal field must not invoke the full QA evaluator');
assert(!vm.runInContext("qaFindings.some(finding => finding.check === 'System.PrimaryKey.Unique' && finding.entityType === 'system')", qaContext),
  'row revalidation must remove a resolved compound-key finding');
vm.runInContext(`
  db.systems[0].Category = '';
  qaRevalidateFieldChange('system', 'Heating', 'Facility A', ['Category']);
`, qaContext);
assert(vm.runInContext("qaFindings.some(finding => finding.entityType === 'system' && String(finding.fields).includes('Category'))", qaContext),
  'editing a valid modal cell to an invalid value must add its finding to the QA cache');
vm.runInContext(`
  db.systems[0].Category = 'Supply';
  qaRevalidateFieldChange('system', 'Heating', 'Facility A', ['Category']);
`, qaContext);
assert(!vm.runInContext("qaFindings.some(finding => finding.entityType === 'system' && String(finding.fields).includes('Category'))", qaContext),
  'undoing an invalid modal cell edit must remove its finding from the QA cache');
vm.runInContext('runQA = _qaOriginalRun', qaContext);
assert(qaGraphSource.includes('data-qa-sheet') && qaGraphSource.includes('_qaGraphRuleRows(selectedResults)'),
  'selecting a QA sheet score pill must filter the graph to that sheet\'s rules');
assert(qaGraphSource.includes('setQaResultsSheetFilter(_qaGraphSelectedSheet)') && qaSource.includes('function _qaVisibleFindings()'),
  'selecting a QA graph sheet must filter the findings rendered on the left');
assert(qaGraphSource.includes('data-qa-check') && qaGraphSource.includes('setQaResultsCheckFilter'),
  'clicking a QA rule card must filter findings rendered on the left');
assert(resultsCssSource.includes('.qa-graph-sheet-row .qa-donut') && resultsCssSource.includes('.qa-graph-rule-row .qa-donut') && resultsCssSource.includes('align-self: stretch'),
  'QA sheet and rule donuts must use the same full-height card sizing');
assert(!qaGraphSource.includes('_qaGraphSheetPillsMarkup') && qaGraphSource.includes('class="qa-graph-summary" data-qa-sheet=""'),
  'QA graph must use its overall summary to clear filters without a redundant sheet-button list');
assert(resultsCssSource.includes('border-bottom: 1px solid var(--border-subtle)') && resultsCssSource.includes('background: transparent'),
  'QA result cards must render as clean full-width rows without grey boxes');
assert(qaSource.includes('QA_ENTITY_GROUP_DIMS') && qaSource.includes("_qaNorm(finding.sheet || finding.entityType) !== selectedSheet"),
  'QA entity grouping pills must show findings only from their matching sheet');
qaContext.groupState = { active:new Set(), order:['facility', 'type', 'system', 'space', 'floor'] };
qaContext.document = { querySelectorAll:() => [] };
vm.runInContext(`
  qaFindings = [
    { sheet:'Type', entityType:'type', entityName:'Pump' },
    { sheet:'Space', entityType:'space', entityName:'Room 101' },
    { sheet:'System', entityType:'system', entityName:'Heating' },
  ];
  viewMode = 'asset';
  setQaResultsSheetFilter('type', false);
`, qaContext);
assert.strictEqual(vm.runInContext('_qaVisibleFindings().map(finding => finding.entityType).join() ', qaContext), 'type',
  'Type grouping must exclude Space and System findings');
vm.runInContext("setQaResultsSheetFilter('space', false)", qaContext);
assert.strictEqual(vm.runInContext('_qaVisibleFindings().map(finding => finding.entityType).join()', qaContext), 'space',
  'Space grouping must exclude Type and System findings');
assert(qaGraphSource.includes("els.body.innerHTML = ''") && !qaGraphSource.includes('_qaProgressMarkup(_qaRunProgress'),
  'QA progress must appear only in the run overlay, not inside the graph panel');
assert(qaGraphSource.includes('_qaGraphRuleDescription') && qaGraphSource.includes('qa-graph-rule-description'),
  'selected-sheet rule results must include plain-language check descriptions');
assert(qaSource.includes('async function startQaRun') && qaSource.includes('await new Promise(resolve => setTimeout(resolve, 0))'),
  'QA execution must yield to the browser between check groups');
assert(qaSource.includes('_qaPrepareGroupingLookups()') && qaSource.includes('_qaGroupValueCache'),
  'QA grouping must cache entity lookups and resolved group values');
assert(qaSource.includes('qaDims:rest') && qaSource.includes('function qaPendingGroupBody'),
  'nested QA groups must be created lazily when their parent opens');
assert(qaResultsSource.includes('qaPendingGroupBody(pending)') && fs.readFileSync(path.join(javascriptDir, 'pills.js'), 'utf8').includes('qaPendingGroupBody(pg)'),
  'single-group and expand-all paths must materialize lazy QA groups through the shared renderer');
assert(qaSource.includes('function cancelQaRun') && qaSource.includes('No partial results were applied.'),
  'QA execution must expose cooperative cancellation without publishing partial findings');
assert(qaSource.includes('role="progressbar"') && qaSource.includes('aria-valuenow'),
  'QA execution must expose accessible determinate progress');
assert(resultsCssSource.includes('.qa-run-progress-fill') && resultsCssSource.includes('.qa-run-cancelled'),
  'QA progress and cancellation states must be styled');
assert(qaGraphSource.includes("if (typeof qaIsRunning === 'function' && qaIsRunning())"),
  'the QA graph must not trigger a duplicate synchronous run while QA is active');
assert(qaResultsSource.includes('showQAMode(list)') && !qaResultsSource.includes('startQaRun(list)'),
  'returning to the QA tab must render the completed audit instead of starting another run');
assert(qaSource.includes('function renderQAMode(list)') && !qaSource.includes('function renderQAMode(list, rerun'),
  'QA rendering must remain presentational and never execute checks');
assert(qaSource.includes('if (!qaHasRun) return;') && !/function qaRevalidateFieldChange[\s\S]*?\n}\n[\s\S]*?qaFindings = runQA\(\)/.test(qaSource),
  'modal field changes must not start a full QA audit');
assert(qaSource.includes("if (col.checks?.length)") && qaSource.includes('_qaNamedCheckResult(checkName, v, schema)'),
  'row revalidation must evaluate named XML column checks');
assert(modalsSource.includes('return qaHasRun && Array.isArray(qaFindings) ? qaFindings : [];'),
  'opening a project modal must not trigger QA before the first audit');
assert(appLifecycleSource.includes("if (typeof resetQaAudit === 'function') resetQaAudit();"),
  'workbook lifecycle changes must invalidate the completed QA audit');
assert(modalsSource.includes("if (entityType === 'facility' && renamedFacility) resolvedName = renamedFacility;"),
  'non-facility rename previews must retain the edited item name instead of the facility scope');
assert(devIndexSource.includes('<span id="go-logo-hdr" class="go-logo go-logo-hdr" aria-hidden="true"></span>'),
  'the header must provide an empty host for inline logo injection');
assert(devIndexSource.includes('<span id="go-logo-upload" class="go-logo go-logo-upload" aria-hidden="true"></span>'),
  'the upload page must provide an empty host for inline logo injection');
assert(!logoThemeSource.includes('fetch('), 'logo theming must not fetch the SVG through JavaScript');
assert(logoThemeSource.includes('const LOGO_SVG = `<svg '), 'logo-theme.js must hardcode the complete SVG markup');
assert(logoThemeSource.includes('targetEl.innerHTML = LOGO_SVG'), 'logo-theme.js must inject a complete SVG into each host');
assert(logoThemeSource.includes('--sw-major:10;--sw-minor:5'), 'hardcoded logos must preserve dynamic line-width variables');
assert(logoThemeSource.includes('stroke-width="var(--sw-major)"'), 'major logo lines must use the dynamic width');
assert(logoThemeSource.includes('stroke-width="var(--sw-minor)"'), 'minor logo lines must use the dynamic width');
assert(logoSvgSource.includes('stroke="var(--lines)"'), 'logo line strokes must use the target theme color');
assert(releaseBuilderSource.includes("'svgs', 'Guerrilla-Ops.svg'"), 'the release build must read the canonical logo SVG');
assert(devIndexSource.includes('<link rel="icon" type="image/svg+xml" href="svgs/Guerrilla-Ops.svg">'), 'development must use the canonical SVG as its favicon');
assert(releaseBuilderSource.includes("'data:image/svg+xml;base64,'"), 'the release build must embed the SVG favicon as a data URL');
assert(!releaseBuilderSource.includes('logo_reference'), 'the release build must not rewrite visible logo references');
assert(!releaseBuilderSource.includes('svg_sprite'), 'the release build must not replace inline logos with a shared sprite');
assert(logoThemeSource.includes("{ id:'go-logo-hdr', lineColor:'--on-dark' }"), 'header logo lines must be light on the dark header');
assert(logoThemeSource.includes("{ id:'go-logo-upload', lineColor:'--text-dark' }"), 'upload logo lines must be dark on the light landing card');
const logoElements = {};
['go-logo-hdr', 'go-logo-upload'].forEach(id => {
  const properties = {};
  const svg = {
    style:{ setProperty:(name, value) => { properties[name] = value; } },
    setAttribute:() => {},
  };
  logoElements[id] = {
    properties,
    element:{
      classList:{ add:() => {} },
      set innerHTML(value) { this.markup = value; },
      querySelector:() => svg,
    },
  };
});
const logoContext = {
  console,
  Math,
  window:{},
  document:{
    documentElement:{},
    addEventListener:() => {},
    getElementById:id => logoElements[id]?.element || null,
  },
  getComputedStyle:() => ({
    getPropertyValue:name => ({ '--on-dark':'#fff', '--text-dark':'#292929' }[name] || '#00fed8'),
  }),
};
vm.createContext(logoContext);
vm.runInContext(logoThemeSource, logoContext, { filename:'logo-theme.js' });
logoContext.window.applyBrandLogoTheme();
assert.strictEqual(logoElements['go-logo-hdr'].properties['--lines'], '#fff', 'header logo lines must render light');
assert.strictEqual(logoElements['go-logo-upload'].properties['--lines'], '#292929', 'upload logo lines must render dark');

loadModule('utils.js');
loadModule('cobie-parser.js');
loadModule('filters.js');
loadModule('three-d-viewer.js');

assert.strictEqual(context.readSheet({ Sheets:{ Type:[
  { Name:'', Category:'', Description:'' },
  { Name:'', Category:'Pump', Description:'' },
] } }, 'Type').length, 1, 'import must discard fully blank rows but retain populated unnamed rows for QA');

context.parseCOBieInto(workbook('Facility A', { Name:'Level 01', Description:'First' }), 'a.xlsx');
context.parseCOBieInto(workbook('Facility A', { Name:'Level 01', Elevation:'3000' }), 'b.xlsx');
assert.strictEqual(context.db.floors.length, 1, 'overlapping Floor rows should merge');
assert.strictEqual(context.db.floors[0].Description, 'First');
assert.strictEqual(context.db.floors[0].Elevation, '3000');

context.parseCOBieInto({ Sheets:{
  Facility:[{ Name:'Facility B', Category:'Co_20_15_58' }],
  Space:[{ Name:'Meeting Room', Category:'SL_20_15_50' }],
  Type:[
    { Name:'Acid Neutralizer', Category:'Pr_15_31_04_02' },
    { Name:'Custom Product', Category:'Custom_01' },
  ],
  System:[{ Name:'Foundations', Category:'EF_20_05_30' }],
  Document:[
    { Name:'Document A', Category:'PM_70_15_07' },
    { Name:'Document B', Category:'PM_70_15_09' },
  ],
  Picklist:[{
    'Category-Facility':'Co_20_15_58 : Office complexes',
    'Category-Space':'SL_20_15_50 : Meeting rooms',
    'Category-Product':'Pr_15_31_04_02 : Acid neutralization products',
    'Category-Element':'EF_20_05_30 : Foundations',
    DocumentType:'PM_70_15_07 : Asset information model',
  }, {
    DocumentType:'PM_70 : Asset information',
  }, {
    DocumentType:'PM_70_15 : Asset information management',
  }, {
    DocumentType:'PM_70_15_09 : Asset information requirements',
  }],
} }, 'categories.xlsx');
context.buildIdx();
assert.deepStrictEqual([...context.idx.catGroups.doccat['pm_70_15']], ['PM_70_15_07', 'PM_70_15_09']);
assert.strictEqual(
  context.idx.categoryTrees.doccat.find(node => node.key === 'pm_70_15_07').label,
  'PM_70_15_07 : Asset information model',
);
assert.strictEqual(context.idx.categoryTrees.doccat.find(node => node.key === 'pm_70').depth, 0);
assert.deepStrictEqual([...context.idx.catGroups.space['sl_20']], ['Meeting Room']);
assert.deepStrictEqual([...context.idx.catGroups.type['pr_15_31']], ['Acid Neutralizer']);
assert.deepStrictEqual([...context.idx.catGroups.system['ef_20']], ['Foundations']);
assert.deepStrictEqual([...context.idx.catGroups.facility['co_20']], ['Facility B']);
assert.deepStrictEqual([...context.idx.catGroups.type['custom_01']], ['Custom Product'], 'used categories missing from Picklist must remain visible');
assert(context.picklistCategoryValues('document').includes('PM_70_15_07 : Asset information model'));
assert(context.picklistCategoryValues('type').includes('Custom_01'), 'used category values should supplement the Picklist');
assert.deepStrictEqual([...context.classificationAncestors('PM_70_15_07')], ['PM_70', 'PM_70_15', 'PM_70_15_07']);
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(_selectionRange(['a','b','c','d'], 'b', 'd'))", context)),
  ['b','c','d'],
  'Shift selection must include both endpoints in forward order',
);
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(_selectionRange(['a','b','c','d'], 'd', 'b'))", context)),
  ['b','c','d'],
  'Shift selection must support reverse ranges',
);
context.selectedCategoryLevels = {
  facility:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set(),
};
const originalApplyFilters = context.applyFilters;
let rangeFilterRefreshes = 0;
context.applyFilters = () => { rangeFilterRefreshes++; };
context.sel.type.clear();
context.selectFilterRange('type', ['acid neutralizer', 'custom product'], true);
assert.deepStrictEqual([...context.sel.type].sort(), ['acid neutralizer', 'custom product']);
assert.strictEqual(rangeFilterRefreshes, 1, 'a filter range must refresh once rather than once per item');
context.selectFilterRange('type', ['acid neutralizer', 'custom product'], false);
assert.strictEqual(context.sel.type.size, 0, 'a Shift range must also support deselection');
context.applyFilters = originalApplyFilters;

const documentFilterContexts = [
  {
    identity:'doc-a', doc:{ Name:'Manual A' }, components:new Set(),
    facilities:new Set(['facility a']), floors:new Set(['level 01']), spaces:new Set(['room 101']),
    types:new Set(['pump']), systems:new Set(['heating']), categories:new Set(['manual']),
  },
  {
    identity:'doc-b', doc:{ Name:'Manual B' }, components:new Set(),
    facilities:new Set(['facility b']), floors:new Set(['level 02']), spaces:new Set(['room 201']),
    types:new Set(['fan']), systems:new Set(['ventilation']), categories:new Set(['manual']),
  },
];
const previousDocumentFilterSearch = context.searchQuery;
const previousDocumentFilterSelections = Object.fromEntries(
  Object.entries(context.sel).map(([dimension, selection]) => [dimension, new Set(selection)]),
);
context.searchQuery = '';
context.sel.facility = new Set(['facility a']);
context.sel.type = new Set(['fan']);
const documentCounts = {};
const filteredDocumentContexts = context._filterDocumentContexts(documentFilterContexts, documentCounts, true);
assert.strictEqual(filteredDocumentContexts.length, 0, 'document contexts must satisfy every selected dimension');
assert.deepStrictEqual({ ...documentCounts.facility }, { 'facility b':1 }, 'facility counts must ignore only the facility selection');
assert.deepStrictEqual({ ...documentCounts.type }, { pump:1 }, 'type counts must ignore only the type selection');
assert.deepStrictEqual({ ...documentCounts.doccat }, {}, 'document categories must still respect all asset selections');
context.searchQuery = previousDocumentFilterSearch;
Object.entries(previousDocumentFilterSelections).forEach(([dimension, selection]) => { context.sel[dimension] = selection; });

loadModule('documents.js');
const documentEntries = context.db.documents.map(doc => ({ doc }));
const documentRoots = context.groupDocsByClassification(documentEntries);
assert(documentRoots.includes('PM_70 : Asset information'), 'Document view should start with the top used PM classification');
assert(documentRoots.includes('grp-action-label">Count'), 'document group headers should use the shared Count action');
assert(documentRoots.includes('>Info</span>'), 'document group headers should expose the shared Info action');
assert(documentRoots.includes('>Highlight</span>'), 'document group headers should expose the shared Highlight action');
const documentChildren = context.groupDocsByClassification(documentEntries, [], 1, 'pm_70');
assert(documentChildren.includes('PM_70_15 : Asset information management'), 'Document view should nest the next PM classification level');
context.docStore = [];
const linkedDocument = { ...context.db.documents[0], Directory:'https://example.test/document.pdf' };
const documentCardHtml = context.docCard({ doc:linkedDocument, linkedType:'facility', linkedName:'Facility A' });
assert(documentCardHtml.includes('data-card-highlight-key'), 'document cards should be selectable as a whole');
assert(documentCardHtml.includes('document-link-action'), 'document cards should retain the Link action');
assert(!documentCardHtml.includes('data-edit-doc'), 'document cards must not expose the redundant edit action');
const resultsSource = fs.readFileSync(path.join(javascriptDir, 'results.js'), 'utf8');
assert(!resultsSource.includes('data-edit-doc'), 'document trees must not expose the redundant edit action');
loadModule('results.js');
context.componentHighlightFixture = { Name:'Highlight Pump', Description:'Edited component', _facility:'Facility A' };
const componentHighlightFixture = context.componentHighlightFixture;
const highlightKey = context._groupHighlightBuildKey('component', componentHighlightFixture.Name, componentHighlightFixture._facility);
vm.runInContext(`groupHighlightStore.add(${JSON.stringify(highlightKey)})`, context);
const highlightedComponentHtml = vm.runInContext('card(componentHighlightFixture)', context);
assert(highlightedComponentHtml.includes('data-card-highlight-action'), 'component cards must expose a dedicated Highlight action');
assert(highlightedComponentHtml.includes('grp-highlight-btn is-active'), 'the component Highlight action must show its active state');
assert(highlightedComponentHtml.includes('component-result-card'), 'component highlight styling must remain scoped independently of edit state');
context._changeLog.push({
  entityType:'document', entityName:linkedDocument.Name, originalName:linkedDocument.Name,
  facNames:[linkedDocument._facility], timestamp:Date.now(),
});
assert(
  context.docCard({ doc:linkedDocument, linkedType:'facility', linkedName:'Facility A' }).includes('document-result-card-unsaved'),
  'unsaved documents should be highlighted in the main document tree',
);
context._changeLog.length = 0;

const devHtml = fs.readFileSync(path.join(root, 'dev', 'index.html'), 'utf8');
const createSource = fs.readFileSync(path.join(javascriptDir, 'create.js'), 'utf8');
assert(!devHtml.includes('id="create-modal"'), 'the legacy Create Item modal must not be present');
assert(!createSource.includes('saveCreate'), 'the legacy Create Item form engine must not be present');

loadModule('panels.js');
context.collapsedFilterCategories.clear();
context.stepFilterTreeDepth('doccat', 'collapse', false);
assert(context.collapsedFilterCategories.has('doccat::pm_70_15'), 'first collapse should close the deepest parent level');
context.stepFilterTreeDepth('doccat', 'collapse', false);
assert(context.collapsedFilterCategories.has('doccat::pm_70'), 'second collapse should close the next parent level');
context.stepFilterTreeDepth('doccat', 'expand', false);
assert(!context.collapsedFilterCategories.has('doccat::pm_70'), 'expand should reopen the shallowest collapsed level first');
context.collapsedFilterCategories.clear();

const entities = [
  { Name:'AHU-01', _facility:'Facility A' },
  { Name:'AHU-01', _facility:'Facility B' },
];
assert.strictEqual(context._findEntity(entities, 'ahu-01', 'Facility B'), entities[1]);
assert.strictEqual(context._findEntity(entities, 'ahu-01', 'Missing'), null);
assert.strictEqual(context._cobieField({ 'Floor Name':'Level 02' }, 'floorName'), 'Level 02');

const coordinateRow = (name, rowName, sourceX, sourceY, sourceZ, sheet = 'Component') => ({
  Name:name,
  SheetName:sheet,
  RowName:rowName,
  CoordinateXAxis:String(sourceX),
  CoordinateYAxis:String(sourceY),
  CoordinateZAxis:String(sourceZ),
  _facility:'Facility A',
});
assert.strictEqual(context._viewer3dCoordPoint(coordinateRow('Coordinate', 'Zero', 0, 0, 0)).x, 0);
assert.strictEqual(context._viewer3dCoordPoint(coordinateRow('Coordinate', 'Blank', '', 10, 20)), null);
assert.strictEqual(context._viewer3dCoordPoint(coordinateRow('Coordinate', 'Invalid', '12mm', 10, 20)), null);
const orthoNear = context._viewer3dProjectAt({ x:10, y:20, z:-100 }, 2, 1000, 400, 300, 1, 0, 0, 0, 0);
const orthoFar = context._viewer3dProjectAt({ x:10, y:20, z:100 }, 2, 1000, 400, 300, 1, 0, 0, 0, 0);
assert.deepStrictEqual(
  { x:orthoNear.x, y:orthoNear.y },
  { x:orthoFar.x, y:orthoFar.y },
  'orthographic projection must not shift points based on camera depth',
);
vm.runInContext('_viewer3dRotX = 1; _viewer3dRotY = 2; _viewer3dPanX = 30; _viewer3dPanY = 40; _viewer3dZoom = 5; _viewer3dResetView();', context);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(vm.runInContext('({ rotX:_viewer3dRotX, rotY:_viewer3dRotY, panX:_viewer3dPanX, panY:_viewer3dPanY, zoom:_viewer3dZoom })', context))),
  { rotX:-0.55, rotY:0.7, panX:0, panY:0, zoom:1 },
);

const suffixNamedComponent = coordinateRow('Coordinate', 'Pump_lowerleft', -20, 10, 30);
assert.deepStrictEqual({ ...context._viewer3dCoordKeyParts(suffixNamedComponent) }, {
  baseName:'Pump_lowerleft', cornerName:'',
});
const actualCorner = coordinateRow('Coordinate LowerLeft', 'Pump_lowerleft', -20, 10, 30);
assert.deepStrictEqual({ ...context._viewer3dCoordKeyParts(actualCorner) }, {
  baseName:'Pump', cornerName:'lowerleft',
});

context.db.coordinates = [
  actualCorner,
  coordinateRow('Coordinate UpperRight', 'Pump_upperright', 0, 110, 130),
  coordinateRow('Coordinate', 'Pump', -10, 60, 80),
];
let coordinateIndex = context._viewer3dCoordIndex();
assert.strictEqual(context._viewer3dCoordIndex(), coordinateIndex, 'unchanged coordinates should reuse the 3D index');
let indexedPump = context._viewer3dCoordFor(coordinateIndex, 'component', 'Facility A', 'Pump');
assert.strictEqual(indexedPump.base.RowName, 'Pump', 'corner ordering must not replace the base row');
let pumpBounds = context._viewer3dBounds(indexedPump, 700);
assert.strictEqual(pumpBounds.hasCorners, true);
assert.deepStrictEqual(
  { minX:pumpBounds.minX, maxX:pumpBounds.maxX, minY:pumpBounds.minY, maxY:pumpBounds.maxY, minZ:pumpBounds.minZ, maxZ:pumpBounds.maxZ },
  { minX:10, maxX:110, minY:30, maxY:130, minZ:0, maxZ:20 },
);

const pointEntry = { base:coordinateRow('Coordinate', 'Point', -25, 15, 35), lowerLeft:null, upperRight:null, corners:[] };
const pointBounds = context._viewer3dBounds(pointEntry, 100);
assert.strictEqual(pointBounds.isPoint, true);
assert.deepStrictEqual({ x:pointBounds.centerX, y:pointBounds.centerY, z:pointBounds.centerZ }, { x:15, y:35, z:25 });
assert.strictEqual(context._viewer3dModalAverage([-1200, -0.2, 0, 0.1, 6]), (-0.2 + 0 + 0.1) / 3);
const partialEntry = { ...pointEntry, lowerLeft:coordinateRow('Coordinate LowerLeft', 'Point_lowerleft', -999, 999, 999) };
const partialBounds = context._viewer3dBounds(partialEntry, 100);
assert.strictEqual(partialBounds.isPoint, true, 'one corner must not masquerade as a box');
assert.deepStrictEqual({ x:partialBounds.centerX, y:partialBounds.centerY, z:partialBounds.centerZ }, { x:15, y:35, z:25 });
context.db.coordinates = [
  coordinateRow('Coordinate', 'Duplicate', '', 10, 20),
  coordinateRow('Coordinate', 'Duplicate', -30, 40, 50),
];
coordinateIndex = context._viewer3dCoordIndex();
const duplicateEntry = context._viewer3dCoordFor(coordinateIndex, 'component', 'Facility A', 'Duplicate');
assert.strictEqual(duplicateEntry.base.CoordinateXAxis, '-30', 'a valid duplicate must replace an invalid row');
assert.strictEqual(duplicateEntry.corners.length, 0, 'duplicate base rows must not become corners');

const bounds = { minX:10, maxX:110, minZ:20, maxZ:220, sizeX:100, sizeZ:200 };
assert.deepStrictEqual({ ...context._roomUvToWorldXZ(bounds, 0, 0) }, { x:10, z:220 });
for (const rotation of [0, 90, 180, 270, 33]) {
  const alignment = { rotation, flipHorizontal:true, flipVertical:false };
  const aligned = context._applyFloorAlignmentToUv(0.2, 0.7, alignment);
  const restored = context._invertFloorAlignmentFromUv(aligned.u, aligned.v, alignment);
  assert(Math.abs(restored.u - 0.2) < 1e-10);
  assert(Math.abs(restored.v - 0.7) < 1e-10);
}
const affineAlignment = { floorToSvg:{ a:0.8, b:0.1, c:-0.2, d:-0.05, e:1.1, f:0.15 } };
const svgUv = context._floorUvToSvgUv(0.3, 0.7, affineAlignment);
const restoredFloorUv = context._svgUvToFloorUv(svgUv.u, svgUv.v, affineAlignment);
assert(Math.abs(restoredFloorUv.u - 0.3) < 1e-10);
assert(Math.abs(restoredFloorUv.v - 0.7) < 1e-10);

loadModule('floor-svg-panel.js');
const legacyAlignment = context._floorAlignmentFromRaw('{"scale":0.25}');
assert.strictEqual(legacyAlignment.scale, 0.25, 'legacy uniform alignment scale must remain unchanged');
const nonUniformAlignment = context._floorAlignmentFromRaw('{"scale":1,"scaleX":0.3,"scaleY":0.5}');
assert.strictEqual(nonUniformAlignment.scale, 0.3, 'nonuniform saved alignment must migrate to the contained uniform scale');
const rotatedViewBounds = context._svgRotatedBounds(100, 50, 90);
assert(Math.abs(rotatedViewBounds.width - 50) < 1e-10);
assert(Math.abs(rotatedViewBounds.height - 100) < 1e-10);
const floor = context.db.floors[0];
const svg = '<svg>' + 'x'.repeat(70000) + '</svg>';
assert(context._writeChunkedFloorAttribute(floor, svg, 'svg', /^svg(?:[^\d]*(\d+))?$/i, 30000));
const stored = context._collectChunkedFloorAttributes(/^svg(?:[^\d]*(\d+))?$/i);
assert.strictEqual(stored[context._rowKey(floor, 'Level 01')], svg);

loadModule('component-placement.js');
assert.strictEqual(context._componentPlacementMarkerCoordinate(undefined, 862), 862, 'missing saved marker coordinates must use the recovered UV position');
assert.strictEqual(context._componentPlacementMarkerCoordinate(0, 862), 0, 'valid SVG origin coordinates must be preserved');
context.db.spaces = [
  { Name:'Room 101', FloorName:'Level 01', _facility:'Facility A' },
  { Name:'Room 102', FloorName:'Level 01', _facility:'Facility A' },
];
const roomCoordinateRows = [
  coordinateRow('Coordinate LowerLeft', 'Room 101_lowerleft', -8000, 0, 3000, 'Space'),
  coordinateRow('Coordinate UpperRight', 'Room 101_upperright', 0, 10000, 6000, 'Space'),
];
context.db.coordinates = roomCoordinateRows;
coordinateIndex = context._viewer3dCoordIndex();
const floorPlans = context._viewer3dFloorPlans([floor], coordinateIndex);
assert.strictEqual(floorPlans.length, 1);
assert.strictEqual(floorPlans[0].key, context._rowKey(floor, 'Level 01'));
assert.strictEqual(floorPlans[0].svgRaw, svg);
assert.strictEqual(floorPlans[0].bounds.y, 3000, 'the floor SVG should use the associated room base elevation');
const originalSvgRoomPolygons = context._viewer3dSvgRoomPolygons;
const cachedPolygon = [{ x:0, z:0 }, { x:10000, z:0 }, { x:10000, z:8000 }, { x:0, z:8000 }];
context._viewer3dSvgRoomPolygons = () => new Map([
  ['room 101', cachedPolygon],
  ['room 102', cachedPolygon],
]);
context._viewer3dRebuildRoomGeometryCache();
const roomScene = context._viewer3dSceneData([], {});
const cachedRooms = roomScene.objects.filter(object => object.kind === 'space');
assert.strictEqual(cachedRooms.length, 2, 'SVG polygons should create rooms with or without coordinate bounds');
assert(cachedRooms.every(object => object.polygon), 'cached SVG polygons must take precedence over coordinate cubes');
assert.strictEqual(cachedRooms.find(object => object.spaceKey === 'room 101').sizeY, 3000, 'SVG rooms should retain coordinate height when available');
assert.strictEqual(cachedRooms.find(object => object.spaceKey === 'room 102').sizeY, 3000, 'SVG-only rooms should use the floor default height');
context._viewer3dSvgRoomPolygons = originalSvgRoomPolygons;
context.db.spaces = [context.db.spaces[0]];
assert.strictEqual(context._viewer3dRoomOpacity({ kind:'space', floorKey:'level 01' }, 'level 00'), 0.04);
assert.strictEqual(context._viewer3dRoomOpacity({ kind:'space', floorKey:'level 00' }, 'level 00'), 0.35);
assert.strictEqual(context._viewer3dRoomOpacity({ kind:'space', floorKey:'level 00', highlighted:true }, 'level 00'), 0.9);
assert.strictEqual(context._viewer3dRoomInteractive({ kind:'space', floorKey:'level 01' }, 'level 00'), false);
assert.strictEqual(context._viewer3dRoomInteractive({ kind:'space', floorKey:'level 00' }, 'level 00'), true);
assert.strictEqual(context._viewer3dRoomInteractive({ kind:'space', floorKey:'level 01' }, ''), true);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context._viewer3dClosedSvgPoints({
    tagName:'rect',
    getAttribute:name => ({ x:'10', y:'20', width:'30', height:'40' })[name],
  }))),
  [{ x:10, y:20 }, { x:40, y:20 }, { x:40, y:60 }, { x:10, y:60 }],
);
assert.strictEqual(context._viewer3dClosedSvgPoints({ tagName:'path', getAttribute:() => 'M 0 0 L 1 0 L 1 1' }), null);
assert.deepStrictEqual(
  { ...context._viewer3dSvgRootPoint(
    { x:1, y:2 },
    { a:2, b:0, c:0, d:2, e:20, f:34 },
    { a:2, b:0, c:0, d:2, e:10, f:20 },
  ) },
  { x:6, y:9 },
  'SVG geometry must be converted from viewport CTM space back to root user coordinates',
);
const shallowVertex = [{ x:0, z:0 }, { x:10, z:0 }, { x:20, z:1 }, { x:20, z:10 }];
assert(context._viewer3dVertexTurnAngle(shallowVertex, 1) < 45);
const squarePolygon = [{ x:0, z:0 }, { x:10, z:0 }, { x:10, z:10 }, { x:0, z:10 }];
assert(Math.abs(context._viewer3dVertexTurnAngle(squarePolygon, 1) - 90) < 1e-10);
assert.strictEqual(context._viewer3dPrismEdges(squarePolygon, 0, 3).length, 12);
const roomBounds = context._componentPlacementSpaceBounds(context.db.spaces[0], coordinateIndex);
assert(roomBounds?.hasCorners, 'placement requires genuine Space corner bounds');
const floorEntry = { name:'Level 01', facility:'Facility A', key:'facility a::level 01' };
const placement = { spaceName:'Room 101', floorKey:floorEntry.key, roomU:0.25, roomV:0.75, height:0 };
const floorBounds = context._componentPlacementFloorBounds(floorEntry, coordinateIndex);
const geometry = context._componentPlacementGeometry(roomBounds, floorBounds, placement, floorEntry);
assert.deepStrictEqual(
  { x:geometry.centerX, y:geometry.centerY, z:geometry.centerZ, bottom:geometry.minY, size:geometry.sizeY },
  { x:2500, y:3300, z:2000, bottom:3000, size:600 },
);
const placementRows = context._componentPlacementRows('Placed Pump', 'Facility A', placement);
assert.strictEqual(placementRows.length, 3);
const placedIndex = (() => {
  const previous = context.db.coordinates;
  context.db.coordinates = placementRows;
  const value = context._viewer3dCoordIndex();
  context.db.coordinates = previous;
  return value;
})();
const placedBounds = context._viewer3dBounds(
  context._viewer3dCoordFor(placedIndex, 'component', 'Facility A', 'Placed Pump'),
  700,
);
assert.deepStrictEqual(
  { x:placedBounds.centerX, y:placedBounds.centerY, z:placedBounds.centerZ, minY:placedBounds.minY },
  { x:geometry.centerX, y:geometry.centerY, z:geometry.centerZ, minY:geometry.minY },
  'preview geometry and written coordinate bounds must agree',
);
const adjacentSpace = { Name:'Room 102', FloorName:'Level 01', _facility:'Facility A' };
const adjacentCoordinates = [
  coordinateRow('Coordinate LowerLeft', 'Room 102_lowerleft', -8000, 10000, 3000, 'Space'),
  coordinateRow('Coordinate UpperRight', 'Room 102_upperright', 0, 20000, 6000, 'Space'),
];
context.db.spaces.push(adjacentSpace);
context.db.coordinates.push(...adjacentCoordinates);
coordinateIndex = context._viewer3dCoordIndex();
const combinedFloorBounds = context._componentPlacementFloorBounds(floorEntry, coordinateIndex);
const combinedGeometry = context._componentPlacementGeometry(roomBounds, combinedFloorBounds, placement, floorEntry);
assert.strictEqual(combinedGeometry.centerX, 5000, 'placement must use 25% of the combined floor width, not 25% of one room');
context.db.spaces.pop();
context.db.coordinates = roomCoordinateRows;

context.db.coordinates = [
  coordinateRow('Coordinate', 'Alpha', -1, 1, 1),
  coordinateRow('Coordinate LowerLeft', 'Alpha_lowerleft', -2, 0, 0),
  coordinateRow('Coordinate', 'Alpha_extra', -3, 3, 3),
];
assert.strictEqual(context._removeComponentCoordinateRows('Facility A', 'Alpha'), 2);
assert.deepStrictEqual(context.db.coordinates.map(row => row.RowName), ['Alpha_extra']);
context.db.coordinates.unshift(coordinateRow('Coordinate', 'Alpha', -1, 1, 1));
const coordinateIndexBeforeRename = context._viewer3dCoordIndex();
assert.strictEqual(context._renameComponentCoordinateRows('Facility A', 'Alpha', 'Beta'), 1);
assert.deepStrictEqual(context.db.coordinates.map(row => row.RowName), ['Beta', 'Alpha_extra']);
const coordinateIndexAfterRename = context._viewer3dCoordIndex();
assert.notStrictEqual(coordinateIndexAfterRename, coordinateIndexBeforeRename, 'coordinate renames must invalidate the 3D index');
assert(context._viewer3dCoordFor(coordinateIndexAfterRename, 'component', 'Facility A', 'Beta'));

context.db.components = [
  { Name:'With Coordinate', Space:'Room 101', _facility:'Facility A' },
  { Name:'Other Coordinate', Space:'Room 101', _facility:'Facility A' },
  { Name:'Without Coordinate', Space:'Room 101', _facility:'Facility A' },
  { Name:'Malformed Coordinate', Space:'Room 101', _facility:'Facility A' },
  { Name:'Outside Room', Space:'Room 101', _facility:'Facility A' },
];
context.db.coordinates = [
  ...roomCoordinateRows,
  coordinateRow('Coordinate', 'With Coordinate', -2000, 2500, 3300),
  coordinateRow('Coordinate', 'Other Coordinate', -3000, 3500, 3300),
  coordinateRow('Coordinate', 'Malformed Coordinate', '', 2500, 3300),
  coordinateRow('Coordinate', 'Outside Room', -2000, 12000, 3300),
];
vm.runInContext('_lastFilteredComps = db.components', context);
let dotPositions = context._filteredDotPositionsForFloor(floorEntry);
assert.strictEqual(dotPositions.length, 3, 'all valid floor coordinates should produce dots regardless of room containment');
assert(dotPositions.every(point => !Object.prototype.hasOwnProperty.call(point, 'roomKey')), 'floor-wide dots must not depend on SVG room IDs');
const highlightedComponent = context.db.components[0];
context.getGroupHighlightContext = () => ({
  components:[highlightedComponent],
  componentKeys:new Set([context._scopeKey(highlightedComponent._facility, highlightedComponent.Name)]),
});
dotPositions = context._filteredDotPositionsForFloor(floorEntry);
assert.strictEqual(dotPositions.length, 1, 'a component highlight must exclude unrelated component dots');
assert(Math.abs(dotPositions[0].u - 0.25) < 1e-10);
assert(Math.abs(dotPositions[0].v - 0.75) < 1e-10);

loadModule('model-config.js');
loadModule('modals.js');
const modalQaFlags = JSON.parse(vm.runInContext(`JSON.stringify({
  error:_projectFieldIssueBadge([{ sev:'error', detail:'Broken reference' }]),
  warning:_projectFieldIssueBadge([{ sev:'warning', detail:'Missing value' }]),
  advisory:_projectFieldIssueBadge([{ sev:'info', detail:'Optional value' }]),
  mixed:_projectFieldIssueBadge([{ sev:'info', detail:'Optional value' }, { sev:'warning', detail:'Missing value' }]),
})`, context));
assert(modalQaFlags.error.includes('bi-exclamation-octagon-fill') && modalQaFlags.error.includes('aria-label="Error"'));
assert(modalQaFlags.warning.includes('bi-exclamation-triangle-fill') && modalQaFlags.warning.includes('aria-label="Warning"'));
assert(modalQaFlags.advisory.includes('bi-info-circle-fill') && modalQaFlags.advisory.includes('aria-label="Advisory"'));
assert(!modalQaFlags.advisory.includes('bi-exclamation-triangle-fill'), 'advisory modal flags must not use warning triangles');
assert(modalQaFlags.mixed.includes('bi-exclamation-triangle-fill'), 'mixed modal findings must display their highest severity');
const floorAttributeVisibility = JSON.parse(vm.runInContext(`JSON.stringify({
  svg:_projectAttributeVisible('floor', 'svg'),
  svgChunk:_projectAttributeVisible('floor', 'svg_2'),
  alignment:_projectAttributeVisible('floor', 'svg-alignment'),
  alignmentChunk:_projectAttributeVisible('floor', 'svg-alignment_2'),
  ordinary:_projectAttributeVisible('floor', 'Mapping Notes'),
  otherEntity:_projectAttributeVisible('type', 'svg'),
})`, context));
assert.deepStrictEqual(floorAttributeVisibility, {
  svg:false, svgChunk:false, alignment:false, alignmentChunk:false, ordinary:true, otherEntity:true,
}, 'Floor modals must hide only internal SVG payload and alignment mapping attributes');
const contactFieldConfig = JSON.parse(vm.runInContext(`JSON.stringify({
  createdBy:Object.values(MODEL_MODAL_CONFIG.component.cards).flatMap(card => card.fields || []).find(field => field.aliases.includes('CreatedBy')),
  manufacturer:MODEL_MODAL_CONFIG.type.cards.manufacturer.fields.find(field => field.aliases.includes('Manufacturer')),
  parts:MODEL_MODAL_CONFIG.type.cards.warranty.fields.find(field => field.aliases.includes('WarrantyGuarantorParts')),
  labor:MODEL_MODAL_CONFIG.type.cards.warranty.fields.find(field => field.aliases.includes('WarrantyGuarantorLabor'))
})`, context));
Object.values(contactFieldConfig).forEach(field => {
  assert.strictEqual(field.edit, 'lookup');
  assert.strictEqual(field.lookupSource, 'contact');
});
const createdByCoverage = JSON.parse(vm.runInContext(`JSON.stringify(
  Object.entries(MODEL_MODAL_CONFIG).map(([type, config]) => ({
    type,
    field:Object.values(config.cards).flatMap(card => card.fields || []).find(field => field.aliases.includes('CreatedBy'))
  }))
)`, context));
createdByCoverage.forEach(({ type, field }) => {
  assert(field, `${type} must expose CreatedBy`);
  assert.strictEqual(field.lookupSource, 'contact');
});
const checkedColumnsByType = Object.fromEntries([...qaSchemaSource.matchAll(
  /<sheet name="([^"]+)"[^>]*>[\s\S]*?<columns>([\s\S]*?)<\/columns>/g,
)].map(match => [
  match[1].toLowerCase(),
  [...match[2].matchAll(/<column name="([^"]+)"/g)].map(column => column[1]).sort(),
]));
const modalColumnsByType = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(
  Object.entries(MODEL_MODAL_CONFIG)
    .filter(([type]) => type !== 'document')
    .map(([type, config]) => [type, Object.values(config.cards)
      .flatMap(card => card.fields || [])
      .map(field => field.aliases[0])])
))`, context));
modalColumnsByType.system.push('ComponentNames');
Object.entries(checkedColumnsByType).forEach(([type, checkedColumns]) => {
  assert(modalColumnsByType[type], `${type} must have an information modal configuration`);
  assert.deepStrictEqual([...modalColumnsByType[type]].sort(), checkedColumns,
    `${type} information modal fields must exactly match its checked XML columns`);
});
const checkedEntityAssociations = JSON.parse(vm.runInContext(`JSON.stringify(
  Object.entries(MODEL_MODAL_CONFIG)
    .filter(([type]) => type !== 'document')
    .flatMap(([type, config]) => Object.values(config.cards)
      .filter(card => card.mode === 'associations')
      .flatMap(card => (card.associations || []).map(association => ({ type, key:association.key }))))
)`, context));
assert.deepStrictEqual(checkedEntityAssociations, [
  { type:'floor', key:'spaces' },
  { type:'space', key:'floor' },
  { type:'space', key:'components' },
  { type:'type', key:'components' },
  { type:'system', key:'components' },
  { type:'component', key:'type' },
  { type:'component', key:'space' },
  { type:'component', key:'systems' },
], 'entity information modals must expose their editable COBie relationships');
const documentAssociations = JSON.parse(vm.runInContext(
  'JSON.stringify(MODEL_MODAL_CONFIG.document.cards.associations.associations)', context,
));
assert.deepStrictEqual(documentAssociations.map(item => item.targetType),
  ['facility', 'floor', 'space', 'type', 'component', 'system']);
assert(documentAssociations.every(item => item.cardinality === 'many'), 'all Document associations must be one-to-many');

context.db.contacts = [
  { Name:'contact-01', Email:'person@example.test', GivenName:'Pat', FamilyName:'Jones', Company:'Example Ltd', _facility:'Facility A' },
];
const contactOptions = JSON.parse(vm.runInContext("JSON.stringify(_projectLookupOptions('contact'))", context));
assert.strictEqual(contactOptions[0].value, 'person@example.test', 'Contact lookups must persist email as the COBie key');
assert(contactOptions[0].label.includes('Pat Jones'));
assert.strictEqual(context._projectNormalizeLookupValue('contact', 'person@example.test'), 'person@example.test');
assert.strictEqual(context._projectNormalizeLookupValue('contact', 'not-a-contact', 'person@example.test'), 'person@example.test');

context.db.types = [{ Name:'Pump Type', Category:'Pr_65_53_86 : Pump products', _facility:'Facility A' }];
context.db.floors = [{ Name:'Level 01', _facility:'Facility A' }];
context.db.spaces = [{ Name:'Plant Room', FloorName:'', Category:'SL_90_50 : Plant rooms', _facility:'Facility A' }];
context.db.components = [
  { Name:'Pump 01', TypeName:'', Space:'', _facility:'Facility A' },
  { Name:'Pump 02', TypeName:'', Space:'', _facility:'Facility A' },
  { Name:'Classified Pump', TypeName:'Pump Type', Space:'', _facility:'Facility A' },
];
context.db.systems = [{ Name:'Heating', Category:'Ss_60_40 : Heating systems', ComponentNames:'', _facility:'Facility A' }];
context.db.documents = [{ Name:'Manual', Directory:'manual.pdf', SheetName:'Facility', RowName:'Facility A', _facility:'Facility A' }];
context.db.facilities = [{ Name:'Facility A', _facility:'Facility A' }];
context.buildIdx();
const component = context.db.components[0];
const type = context.db.types[0];
const associationFloor = context.db.floors[0];
const space = context.db.spaces[0];
const system = context.db.systems[0];
const documentRow = context.db.documents[0];
const relationshipHierarchy = JSON.parse(vm.runInContext(`JSON.stringify({
  type:_associationHierarchy(_associationTargetRows('type', 'Facility A').map(row => { const category = _associationCategory('type', row, 'Facility A'); return { categoryKey:category.key, categoryLabel:category.label }; }), 'type'),
  system:_associationHierarchy(_associationTargetRows('system', 'Facility A').map(row => { const category = _associationCategory('system', row, 'Facility A'); return { categoryKey:category.key, categoryLabel:category.label }; }), 'system'),
  space:_associationHierarchy(_associationTargetRows('space', 'Facility A').map(row => { const category = _associationCategory('space', row, 'Facility A'); return { categoryKey:category.key, categoryLabel:category.label }; }), 'space'),
  componentCategories:_associationTargetRows('component', 'Facility A').map(row => _associationCategory('component', row, 'Facility A')),
})`, context));
assert(relationshipHierarchy.type.some(node => node.key === 'pr_65_53_86' && node.label.includes('Pump products')));
assert(relationshipHierarchy.system.some(node => node.key === 'ss_60_40' && node.label.includes('Heating systems')));
assert(relationshipHierarchy.space.some(node => node.key === 'sl_90_50' && node.label.includes('Plant rooms')));
assert.strictEqual(relationshipHierarchy.componentCategories[2].key, 'pr_65_53_86',
  'Component relationships must inherit their Type Product classification');
assert.strictEqual(relationshipHierarchy.componentCategories[0].key, '(uncategorised)',
  'Components without a Type must remain available under Uncategorised');
const hierarchySearch = vm.runInContext(`(() => {
  const hierarchy = _associationHierarchy([{ categoryKey:'pr_65_53_86', categoryLabel:'Pump products' }], 'type');
  return _associationOptionSearchText({ name:'Pump 01', categoryKey:'pr_65_53_86' }, hierarchy);
})()`, context);
assert(hierarchySearch.includes('pump products') && hierarchySearch.includes('pr_65_53_86'),
  'association search metadata must include classification labels and codes');
context.db.systems.push({ Name:'Heating', ComponentNames:'Pump 02', _facility:'Facility A' });
assert.strictEqual(context._associationTargetRows('system', 'Facility A').length, 1,
  'System relationship options must deduplicate repeated COBie System rows by name');
context.db.systems.pop();

const originalComponents = context.db.components;
context.db.components = Array.from({ length:300 }, (_, index) => ({
  Name:`Component ${String(index + 1).padStart(3, '0')}`,
  _facility:'Facility A',
}));
const boundedComponentControl = context._associationControl(
  'type', type, { key:'components', label:'Components', targetType:'component', cardinality:'many' }, 'Facility A',
);
assert.strictEqual((boundedComponentControl.match(/class="form-check-input"/g) || []).length, 120,
  'large Component relationships must render a bounded initial option window');
assert(boundedComponentControl.includes('project-association-component'));
context._lazyAssociationCacheId = boundedComponentControl.match(/data-options-cache="([^"]+)"/)[1];
const lazyLoadState = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const limit = { textContent:'', classList:{ toggle() {} } };
  const host = { scrollTop:810, clientHeight:190, scrollHeight:1000, innerHTML:'', closest:() => control };
  const control = {
    dataset:{ optionsCache:_lazyAssociationCacheId },
    querySelector(selector) { return selector === '.project-association-options' ? host : limit; },
  };
  const loaded = _associationLoadMore(host);
  const afterScroll = _associationOptionsCache.get(_lazyAssociationCacheId).visibleLimit;
  _associationRenderOptions(control, 'component 2', true);
  return { loaded, afterScroll, afterSearch:_associationOptionsCache.get(_lazyAssociationCacheId).visibleLimit, searchScrollTop:host.scrollTop };
})())`, context));
assert.deepStrictEqual(lazyLoadState, { loaded:true, afterScroll:240, afterSearch:120, searchScrollTop:0 },
  'association lists must lazy-load the next chunk and reset pagination for a new search');
context.db.components = originalComponents;

const componentSpaceControl = context._associationControl(
  'component', component, { key:'space', label:'Space', targetType:'space', cardinality:'one' }, 'Facility A',
);
assert(componentSpaceControl.includes('project-component-locate'), 'Component Space must expose the shared Locate action');
assert(componentSpaceControl.includes('project-association-space'), 'Space relationships must carry their category color class');
assert(context._projectLookupMenuMarkup([], 'new@example.test', true).includes('project-lookup-create'),
  'an unmatched Contact lookup must offer Contact creation');
vm.runInContext('_originalDbState = JSON.parse(JSON.stringify(db))', context);
assert(!context._commitAssociationControl.toString().includes('refreshDisplay'),
  'association selections must not rerender the full result tree on every click');

context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', true);
assert(context._projectEntityDiffersFromBaseline('component', component, 'Pump 01', 'Facility A'));
context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', false);
assert(!context._projectEntityDiffersFromBaseline('component', component, 'Pump 01', 'Facility A'),
  'restoring the original Component associations must clear its dirty state');
context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', true);
context._setEntityAssociation('component', component, { key:'space' }, 'Plant Room', 'Facility A', true);
assert.strictEqual(component.TypeName, 'Pump Type');
assert.strictEqual(component.Space, 'Plant Room');
context._setEntityAssociation('space', space, { key:'floor' }, 'Level 01', 'Facility A', true);
assert.strictEqual(space.FloorName, 'Level 01', 'the Space modal must assign its Floor relationship');
context._setEntityAssociation('space', space, { key:'floor' }, 'Level 01', 'Facility A', false);
assert.strictEqual(space.FloorName, '', 'the Space modal must clear its Floor relationship');
context._setEntityAssociation('floor', associationFloor, { key:'spaces' }, 'Plant Room', 'Facility A', true);
assert.strictEqual(space.FloorName, 'Level 01', 'the Floor modal must assign its Space relationship');
context._setEntityAssociation('floor', associationFloor, { key:'spaces' }, 'Plant Room', 'Facility A', false);
assert.strictEqual(space.FloorName, '', 'the Floor modal must clear its Space relationship');
context.buildIdx();
context._setEntityAssociation('component', component, { key:'systems' }, 'Heating', 'Facility A', true);
assert.strictEqual(system.ComponentNames, 'Pump 01');
context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', false);
context.buildIdx();
context._setEntityAssociation('system', system, { key:'components' }, 'Pump 02', 'Facility A', true);
assert.deepStrictEqual(new Set(system.ComponentNames.split(',')), new Set(['Pump 01', 'Pump 02']));

context._setEntityAssociation('document', documentRow, { key:'floors', targetType:'floor' }, 'Level 01', 'Facility A', true);
assert(context._projectEntityDiffersFromBaseline('document', documentRow, 'Manual', 'Facility A'));
context._setEntityAssociation('document', documentRow, { key:'floors', targetType:'floor' }, 'Level 01', 'Facility A', false);
assert(!context._projectEntityDiffersFromBaseline('document', documentRow, 'Manual', 'Facility A'),
  'restoring Document links must clear its dirty state');
context._setEntityAssociation('document', documentRow, { key:'floors', targetType:'floor' }, 'Level 01', 'Facility A', true);
assert.strictEqual(context.db.documents.length, 2, 'a second Document association must create a sibling COBie row');
assert(context.db.documents.some(row => row.SheetName === 'Floor' && row.RowName === 'Level 01'));
context._setEntityAssociation('document', documentRow, { key:'facilities', targetType:'facility' }, 'Facility A', 'Facility A', false);
assert.strictEqual(context.db.documents.length, 1, 'removing one of several Document links must remove only that linkage row');
assert.strictEqual(context.db.documents[0].SheetName, 'Floor');

console.log('Regression checks passed');