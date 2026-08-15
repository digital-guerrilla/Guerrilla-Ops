const assert = require('assert');
const fs = require('fs');
const { DOMParser } = require('linkedom');
const { runLogoThemeRegression } = require('./logo-theme-regression');
const { runDocumentViewRegression } = require('./document-view-regression');
const { runPostBuildIndexRegression } = require('./post-build-index-regression');
const { runReleaseHtmlRegression } = require('./release-html-regression');
const { runDevChannelRegression } = require('./dev-channel-regression');
const {
  javascriptDir,
  javascriptFiles,
  loadModule:loadModuleFor,
  loadModules:loadModulesFor,
  path,
  readJavascript,
  readText,
  root,
  vm,
  workbook,
  xmlRequestFor,
  checkJavaScriptSyntax,
} = require('./test-helpers');

const context = require('./test-helpers').createContext();
const loadModule = filename => loadModuleFor(context, filename);
const loadModules = filenames => loadModulesFor(context, filenames);
checkJavaScriptSyntax();

const logoThemeSource = readJavascript('logo-theme.js');
const logoSvgSource = readText(path.join(root, 'svgs', 'Guerrilla-Ops.svg')).trim();
const releaseBuilderSource = readText(path.join(root, 'build', 'build_release.py'));
const devIndexSource = readText(path.join(root, 'index.html'));
const modalsSource = readJavascript('modals.js');
const qaSource = readJavascript('qa.js');
const modelConfigSource = readJavascript('model-config.js');
const qaGraphSource = readJavascript('qa-graph.js');
const qaResultsSource = readJavascript('results.js');
const appLifecycleSource = readJavascript('app-lifecycle.js');
const qaSchemaSource = readText(path.join(root, 'specification', 'guerrilla-ops-schema.xml')).replace(/\r\n/g, '\n');
const resultsCssSource = readText(path.join(root, 'css', 'results.css'));
const currentJavascriptSource = javascriptFiles.map(readJavascript).join('\n');
assert(!fs.existsSync(path.join(javascriptDir, 'edit.js')), 'the legacy edit modal module must remain removed');
runPostBuildIndexRegression({ assert, fs, path, root, javascriptDir, devIndexSource,
  qaResultsSource, appLifecycleSource, currentJavascriptSource });
runDevChannelRegression({ assert, fs, path, javascriptDir, devIndexSource,
  currentJavascriptSource, qaSource, qaResultsSource, modelConfigSource, qaGraphSource,
  appLifecycleSource, modalsSource, resultsCssSource, qaSchemaSource });
assert(!qaSource.includes('bi-pencil') && !qaSource.includes('data-edit-entity'),
  'QA finding cards must use only the editable information action');
assert(modelConfigSource.includes('const MODEL_MODAL_CONFIG = Object.freeze(_buildModelModalConfig());') &&
  !modelConfigSource.includes('const MODEL_MODAL_CONFIG = Object.freeze({'),
  'modal configuration must be generated from the COBie XML rather than a hardcoded object');
assert(!modelConfigSource.includes('MODEL_MODAL_PRESENTATION') && !modelConfigSource.includes('MODEL_MODAL_FIELD_LABELS'),
  'modal presentation and exceptional field labels must come from nested XML UI metadata');
assert(!fs.readFileSync(path.join(javascriptDir, 'documents.js'), 'utf8').includes('function collectDocsForComps'),
  'the obsolete hardcoded document relationship traversal must remain removed');
assert(!currentJavascriptSource.includes('db.facility') &&
  !modalsSource.includes('function _projectEntityIdentity') &&
  !modalsSource.includes('_editNameConflict'),
  'obsolete single-facility state and modal compatibility hooks must remain removed');
const placementSource = fs.readFileSync(path.join(javascriptDir, 'component-placement.js'), 'utf8');
const placementApplySource = placementSource.slice(placementSource.indexOf("const applyBtn = event.target.closest('[data-component-placement-apply]')"));
assert(placementApplySource.includes('_projectApplyMutation({') && !placementApplySource.includes('buildIdx();'),
  'component placement must use incremental mutation handling instead of rebuilding every index');
assert(modalsSource.includes('let _projectMutationRenderPending = false;') &&
  modalsSource.includes('function _projectFlushMutationRender()'),
  'modal mutations must coalesce hidden result refreshes until the modal closes');
const inlineLookupSource = modalsSource.slice(modalsSource.indexOf('function _projectCreateFloatingLookup'),
  modalsSource.indexOf('function _projectFilterDocuments'));
assert(inlineLookupSource.includes('handleKeydown:event =>') &&
  inlineLookupSource.includes('if (floatingLookup?.handleKeydown(event)) return;'),
  'field lookup dropdowns must select their highlighted option before committing raw Enter input');
assert(!inlineLookupSource.includes('setTimeout(() =>') && inlineLookupSource.includes("event.key === 'ArrowDown'"),
  'field lookup dropdowns must avoid delayed blur races and support arrow-key navigation');
assert(inlineLookupSource.includes("editor.dataset.finishing === 'true'") &&
  inlineLookupSource.includes('event.stopPropagation();'),
  'lookup commits must be idempotent and Escape must not close the containing modal');
const finishFieldSource = modalsSource.slice(modalsSource.indexOf('function _projectFinishFieldEdit'),
  modalsSource.indexOf('function _projectFinishAttributeEdit'));
assert(finishFieldSource.indexOf("let qaPreviousName = '';") < finishFieldSource.indexOf('if (commit && newValue !== oldValue') &&
  finishFieldSource.includes('previousName:qaPreviousName'),
  'entity rename state must remain in scope through index and group-header mutation handling');
const associationEventsSource = modalsSource.slice(modalsSource.indexOf("_projectModalEl.addEventListener('change'"),
  modalsSource.indexOf("_projectModalEl.addEventListener('click', event => {", modalsSource.indexOf("_projectModalEl.addEventListener('change'")));
assert(associationEventsSource.includes("state && input.type === 'checkbox'") &&
  associationEventsSource.includes("event.key === 'Escape'") && associationEventsSource.includes("event.key === 'Enter'") &&
  associationEventsSource.includes('event.stopPropagation();'),
  'association dropdowns must keep range anchors checkbox-only and support keyboard selection/closing');
assert(modalsSource.includes("focused.closest?.('.project-association') === control") &&
  modalsSource.includes('refreshedHost.scrollTop = scrollTop'),
  'association dropdown rerenders must preserve focused options and scroll position');
const mutationCoordinatorSource = modalsSource.slice(modalsSource.indexOf('function _projectApplyMutation'),
  modalsSource.indexOf('function _projectAssociationMutationChanges'));
assert(mutationCoordinatorSource.includes('qaRevalidateFieldChanges(qaChanges)') &&
  !mutationCoordinatorSource.includes('qaRevalidateFieldChange('),
  'multi-row mutations must update QA and its graph once per batch');
const floorSvgSource = fs.readFileSync(path.join(javascriptDir, 'floor-svg-panel.js'), 'utf8');
assert(!floorSvgSource.includes('refreshDisplay();') && floorSvgSource.includes("entityType:'floor'"),
  'Floor SVG and alignment writes must use targeted mutation refreshes');
assert(modalsSource.includes("info: { icon:'bi-info-circle-fill', color:'text-info', label:'Advisory' }") &&
  modalsSource.includes("warning: { icon:'bi-exclamation-triangle-fill', color:'text-warning', label:'Warning' }"),
  'modal QA flags must distinguish advisories from warning triangles');
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
const categorizedSchema = new DOMParser().parseFromString(qaSchemaSource, 'application/xml');
const schemaColumn = (sheetName, columnName) => [...categorizedSchema.querySelectorAll('sheets > sheet')]
  .find(sheet => sheet.getAttribute('name') === sheetName)
  ?.querySelector(`:scope > columns > column[name="${columnName}"]`);
assert(schemaColumn('System', 'Name')?.querySelector(':scope > qa > unique')?.getAttribute('keys') === 'Name|ComponentNames',
  'System uniqueness must use Name and ComponentNames as its compound key');
assert(schemaColumn('Zone', 'Name')?.querySelector(':scope > qa > unique')?.getAttribute('keys') === 'Name|SpaceNames',
  'Zone uniqueness must use Name and SpaceNames as its compound key');
assert(!/<uniqueRules>|<references>/.test(qaSchemaSource),
  'legacy sheet-level uniqueness and cross-reference containers must not return');
assert([...categorizedSchema.querySelectorAll('unique, reference')]
  .every(rule => String(rule.parentNode?.localName || rule.parentNode?.nodeName).toLowerCase() === 'qa' &&
    String(rule.parentNode?.parentNode?.localName || rule.parentNode?.parentNode?.nodeName).toLowerCase() === 'column'),
  'every unique and reference parameter node must be owned by its column QA section');
assert([...categorizedSchema.querySelectorAll('column > qa > reference')]
  .every(reference => !reference.hasAttribute('ruleId')),
  'reference tags must derive rule IDs from their sheet and column');
assert([...categorizedSchema.querySelectorAll('column > qa > unique')]
  .every(unique => !unique.hasAttribute('ruleId')),
  'unique tags must derive rule IDs from their sheet and column');
['Document', 'Attribute', 'Coordinate', 'Picklist'].forEach(sheetName => {
  assert(qaSchemaSource.includes(`<sheet name="${sheetName}"`),
    `${sheetName} must use the shared sheet descriptor structure even before validation rules are enabled`);
});
[
  'Contact.AtLeastOneRowPresent', 'Facility.OneAndOnlyOneFacilityFound',
  'Type.Type.Component.AComponentForEachType',
].forEach(ruleId => assert(qaSchemaSource.includes(ruleId), `missing named QA rule ${ruleId}`));
assert(schemaColumn('Floor', 'Height')?.querySelector(':scope > qa > rule')?.getAttribute('name') === 'ZeroOrGreaterOrNA',
  'Floor Height must use ZeroOrGreaterOrNA');
assert(schemaColumn('Type', 'Description')?.querySelector(':scope > qa > rule')?.getAttribute('name') === 'NotNull',
  'Type Description must be checked by QA');
runReleaseHtmlRegression({ assert, fs, path, root, vm, qaSchemaSource, releaseBuilderSource });
assert(!qaSource.includes('_qaDefaultSchema') && !qaSource.includes('fallbackUsed') && qaSource.includes('No fallback rules were applied.'),
  'QA schema failures must be reported explicitly without legacy fallback rules');

const unsupportedSchemaContext = {
  console,
  DOMParser,
  XMLHttpRequest:xmlRequestFor(qaSchemaSource
    .replace('<rule name="NotNull"/>', '<rule name="UnsupportedCheck"/>')
    .replace('type="atLeastOneTargetPerRow"', 'type="unsupportedRelation"')),
};
vm.createContext(unsupportedSchemaContext);
vm.runInContext(fs.readFileSync(path.join(javascriptDir, 'utils.js'), 'utf8'), unsupportedSchemaContext);
vm.runInContext(qaSource, unsupportedSchemaContext);
const unsupportedSchemaError = vm.runInContext('_qaParseSchema().error', unsupportedSchemaContext);
assert(unsupportedSchemaError.includes('UnsupportedCheck') && unsupportedSchemaError.includes('unsupportedRelation'),
  'QA schema parsing must reject unsupported named checks and relation types');

const unknownFormatContext = {
  console,
  DOMParser,
  XMLHttpRequest:xmlRequestFor(qaSchemaSource.replace('<format name="email"/>', '<format name="unknown"/>')),
};
vm.createContext(unknownFormatContext);
vm.runInContext(fs.readFileSync(path.join(javascriptDir, 'utils.js'), 'utf8'), unknownFormatContext);
vm.runInContext(qaSource, unknownFormatContext);
const unknownFormatError = vm.runInContext('_qaParseSchema().error', unknownFormatContext);
assert(unknownFormatError.includes('Contact.Email:unknown'),
  'QA schema parsing must reject Format checks that reference an unknown regex');

const columnSchemaContext = {
  console,
  DOMParser,
  XMLHttpRequest:xmlRequestFor(qaSchemaSource),
  db:{
    contacts:[], facilities:[], floors:[], spaces:[], zones:[], types:[], components:[], systems:[],
    documents:[], attributes:[], coordinates:[], picklists:[],
  },
  idx:{},
  sel:{ facility:new Set(), floor:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() },
  searchQuery:'',
};
vm.createContext(columnSchemaContext);
vm.runInContext(fs.readFileSync(path.join(javascriptDir, 'utils.js'), 'utf8'), columnSchemaContext);
vm.runInContext(qaSource, columnSchemaContext);
const normalizedColumnRules = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const schema = _qaParseSchema();
  const contact = schema.sheets.find(sheet => sheet.name === 'Contact');
  const type = schema.sheets.find(sheet => sheet.name === 'Type');
  const component = schema.sheets.find(sheet => sheet.name === 'Component');
  const system = schema.sheets.find(sheet => sheet.name === 'System');
  return {
    error:schema.error,
    contactChecks:contact.columns.find(column => column.name === 'Email').checks,
    contactFormat:contact.columns.find(column => column.name === 'Email').formatName,
    emailFormatDescription:schema.formatDescriptions.email,
    emailFormatCriticality:schema.formatCriticalities.email,
    isoDateFormatDescription:schema.formatDescriptions.isoDate,
    manufacturerFormat:type.columns.find(column => column.name === 'Manufacturer').formatName,
    partsGuarantorFormat:type.columns.find(column => column.name === 'WarrantyGuarantorParts').formatName,
    laborGuarantorFormat:type.columns.find(column => column.name === 'WarrantyGuarantorLabor').formatName,
    installationDateFormat:component.columns.find(column => column.name === 'InstallationDate').formatName,
    warrantyStartDateFormat:component.columns.find(column => column.name === 'WarrantyStartDate').formatName,
    contactUnique:contact.uniqueRules,
    contactReference:contact.references.find(reference => reference.column === 'CreatedBy'),
    systemUnique:system.uniqueRules,
    systemReference:system.references.find(reference => reference.column === 'ComponentNames'),
  };
})())`, columnSchemaContext));
assert.strictEqual(normalizedColumnRules.error, '', 'column-level relational checks must parse without schema errors');
assert.deepStrictEqual(normalizedColumnRules.contactChecks, ['NotNull', 'Format'],
  'Unique must be normalized separately from scalar Contact Email checks');
assert.strictEqual(normalizedColumnRules.contactFormat, 'email',
  'Contact Email must reference the shared email regex');
assert.strictEqual(normalizedColumnRules.emailFormatDescription, 'Must have a valid email address.',
  'the email format must expose its XML description');
assert.strictEqual(normalizedColumnRules.emailFormatCriticality, 'warning',
  'the email format must expose its XML criticality');
assert.strictEqual(normalizedColumnRules.isoDateFormatDescription, 'Must use ISO date format YYYY-MM-DD.',
  'the ISO date format must expose its XML description');
assert.strictEqual(vm.runInContext("_qaRuleDescriptionForCheck('Contact.Email.Format')", columnSchemaContext),
  'Must have a valid email address.',
  'format check IDs must resolve their XML description for QA summaries and printable reports');
assert.strictEqual(vm.runInContext("_qaRuleDescriptionForCheck('Component.InstallationDate.Format')", columnSchemaContext),
  'Must use an ISO date and time with an optional timezone.',
  'format check IDs must resolve the description selected by their column');
assert.strictEqual(normalizedColumnRules.manufacturerFormat, 'email',
  'Type Manufacturer must reference the shared email regex');
assert.strictEqual(normalizedColumnRules.partsGuarantorFormat, 'email',
  'the parts warranty guarantor must reference the shared email regex');
assert.strictEqual(normalizedColumnRules.laborGuarantorFormat, 'email',
  'the labour warranty guarantor must reference the shared email regex');
assert.strictEqual(normalizedColumnRules.installationDateFormat, 'isoDateTime',
  'Component InstallationDate must reference the shared ISO date-time regex');
assert.strictEqual(normalizedColumnRules.warrantyStartDateFormat, 'isoDateTime',
  'Component WarrantyStartDate must reference the shared ISO date-time regex');
assert.deepStrictEqual(normalizedColumnRules.contactUnique[0].keys, ['Email'],
  'Contact Email must normalize into a single-column uniqueness rule');
assert.strictEqual(normalizedColumnRules.contactUnique[0].ruleId, 'Contact.Email.Unique',
  'a unique tag must derive its rule ID from its sheet and column');
assert.strictEqual(normalizedColumnRules.contactReference.targetColumn, 'Email',
  'a reference tag must normalize its cross-reference target without a CrossReference checks token');
assert.strictEqual(vm.runInContext("_qaRuleDescriptionForCheck('Contact.CreatedBy.Reference')", columnSchemaContext),
  'Must match the referenced Name or key column in another worksheet.',
  'inferred cross-reference checks must retain the shared XML rule description');
assert.deepStrictEqual(normalizedColumnRules.systemUnique[0].keys, ['Name', 'ComponentNames'],
  'System compound uniqueness must normalize from uniqueKeys');
assert.strictEqual(normalizedColumnRules.systemReference.targetSheet, 'Component',
  'System component membership must normalize its cross-reference target from the column');
vm.runInContext(`
  db.contacts.push(
    { Email:'duplicate@example.com', CreatedBy:'missing@example.com', _facility:'Facility A' },
    { Email:'duplicate@example.com', CreatedBy:'missing@example.com', _facility:'Facility A' },
    { Email:'invalid-email', CreatedBy:'missing@example.com', _facility:'Facility A' }
  );
  db.components.push({ Name:'AHU-01', CreatedBy:'duplicate@example.com', TypeName:'Missing Type', Space:'Missing Space', _facility:'Facility A' });
`, columnSchemaContext);
const columnRuleFindings = JSON.parse(vm.runInContext('JSON.stringify(runQA())', columnSchemaContext));
assert.strictEqual(columnRuleFindings.filter(finding => finding.check === 'Contact.Email.Unique').length, 1,
  'a duplicate Contact Email must produce one consolidated uniqueness finding');
assert(columnRuleFindings.some(finding => finding.check === 'Contact.Email.Format' &&
  finding.detail.includes('Must have a valid email address.') && finding.sev === 'warning'),
  'a format finding must use the selected format definition description and criticality');
assert(columnRuleFindings.some(finding => finding.check === 'Contact.CreatedBy.Reference'),
  'an unresolved Contact CreatedBy must be reported from its column-level cross-reference');
assert(columnRuleFindings.some(finding => finding.check === 'Component.TypeName.Reference'),
  'an unresolved Component TypeName must be reported from its column-level cross-reference');

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
        { ruleId:'System.CreatedBy.Reference', column:'CreatedBy', targetSheet:'Contact', targetColumn:'Email', required:true, severity:'error', multiValueDelimiter:';' },
        { ruleId:'System.ComponentNames.Reference', column:'ComponentNames', targetSheet:'Component', targetColumn:'Name', required:true, severity:'error', multiValueDelimiter:';' },
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
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('Format', 'person@example.com', _qaSchemaCache, { formatName:'email' })", qaContext), true,
  'Format must dispatch to the regex named by the column tag');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('Format', 'not-an-email', _qaSchemaCache, { formatName:'email' })", qaContext), false,
  'Format must reject values that do not match the named regex');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('Format', 'person@example.com', _qaSchemaCache, { formatName:'missing' })", qaContext), false,
  'Format must never pass when its named regex is unavailable');
assert.strictEqual(vm.runInContext("_qaNamedCheckResult('UnsupportedCheck', 'value', _qaSchemaCache)", qaContext), false,
  'unknown XML checks must never silently pass');
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
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(qaRuleResults.slice(0, 6).map(result => result.column))", qaContext)),
  ['CreatedBy', 'Category', 'ExternalSystem', 'Description', 'Name', 'ComponentNames'],
  'QA rule scores must retain the column order supplied by the XML schema');
const explicitSchemaOrdering = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const sheet = _qaParseSchema().sheets.find(candidate => candidate.columns.length >= 3);
  const expected = sheet.columns.slice(0, 3).map(column => column.name);
  const scrambled = [...expected].reverse().map(column => ({ sheet:sheet.name, column }));
  return { expected, actual:scrambled.sort(_qaSchemaOrderComparator()).map(result => result.column) };
})())`, qaContext));
assert.deepStrictEqual(explicitSchemaOrdering.actual, explicitSchemaOrdering.expected,
  'QA result ordering must be restored from XML even when incremental results arrive out of order');
vm.runInContext(`
  _qaSchemaCache.sheets[0].columns[0].stage = 'design';
  _qaSchemaCache.sheets[0].columns[1].stage = 'construction';
  _qaSchemaCache.sheets[0].columns[2].stage = 'operation';
  _qaSchemaCache.sheets[0].columns[3].stage = 'operation';
  _qaSchemaCache.sheets[0].columns[4].stage = 'operation';
  _qaSchemaCache.sheets[0].columns[5].stage = 'operation';
  _qaSchemaCache.sheets[0].uniqueRules[0].stage = 'construction';
`, qaContext);
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(_qaSheetForStage(_qaSchemaCache.sheets[0], 'design').columns.map(rule => rule.name))", qaContext)),
  ['CreatedBy'], 'Design QA must include only Design rules');
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(_qaSheetForStage(_qaSchemaCache.sheets[0], 'construction').columns.map(rule => rule.name))", qaContext)),
  ['CreatedBy', 'Category'], 'Construction QA must include Design and Construction rules');
assert.deepStrictEqual(
  JSON.parse(vm.runInContext("JSON.stringify(_qaSheetForStage(_qaSchemaCache.sheets[0], 'operation').columns.map(rule => rule.name))", qaContext)),
  ['CreatedBy', 'Category', 'ExternalSystem', 'Description', 'Name', 'ComponentNames'],
  'Operation QA must include all stages and unkeyed baseline rules');
assert(vm.runInContext("_qaSheetForStage(_qaSchemaCache.sheets[0], 'design').uniqueRules.length === 0", qaContext),
  'Design QA must exclude Construction uniqueness rules');
assert(vm.runInContext("_qaSheetForStage(_qaSchemaCache.sheets[0], 'construction').uniqueRules.length === 1", qaContext),
  'Construction QA must include Construction uniqueness rules');
vm.runInContext(`
  qaAllFindings = [
    { check:'design-check', stage:'design' },
    { check:'construction-check', stage:'construction' },
    { check:'operation-check', stage:'operation' },
  ];
  qaAllRuleResults = qaAllFindings.map(finding => ({ check:finding.check, stage:finding.stage, pass:1, fail:0 }));
  qaSelectedStage = 'design';
  _qaApplyStageFilter();
`, qaContext);
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(qaFindings.map(finding => finding.check))', qaContext)),
  ['design-check'], 'cached Design findings must exclude later stages without rerunning QA');
vm.runInContext("qaSelectedStage = 'construction'; _qaApplyStageFilter();", qaContext);
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(qaRuleResults.map(result => result.check))', qaContext)),
  ['design-check', 'construction-check'], 'cached Construction scores must include Design and Construction only');
const pdfReportContract = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  globalThis.esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  db.facilities = [{ Name:'Facility A', _facility:'Facility A' }];
  const html = _qaPdfReportHtml('<svg id="qa-report-brand"></svg>');
  return {
    hasA4:html.includes('size:A4 portrait;'),
    hasPrintFooter:html.includes('@bottom-left') && html.includes('@bottom-right'),
    hasPageNumbers:html.includes('counter(page)') && html.includes('counter(pages)'),
    hidesFlowFooter:html.includes('.report-footer { display:none; }'),
    hasFacility:html.includes('Facility A'),
    hasBrand:html.includes('qa-report-brand'),
    hasSummaries:html.includes('Overall score') && html.includes('Rules assessed') && html.includes('Advisories'),
    hasDisclaimer:html.includes('provided without guarantee of accuracy'),
    hasAllResults:qaRuleResults.every(result => html.includes(esc(result.label || result.check)) && html.includes(esc(result.column || 'Sheet'))),
  };
})())`, qaContext));
assert.deepStrictEqual(pdfReportContract, {
  hasA4:true, hasPrintFooter:true, hasPageNumbers:true, hidesFlowFooter:true,
  hasFacility:true, hasBrand:true, hasSummaries:true, hasDisclaimer:true, hasAllResults:true,
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
vm.runInContext(`
  _qaCreateFullRunCalls = 0;
  startQaRun = () => { _qaCreateFullRunCalls++; };
  qaRevalidateAfterEntityCreate('system', db.systems[0]);
`, qaContext);
assert.strictEqual(vm.runInContext('_qaCreateFullRunCalls', qaContext), 0,
  'creating a row without a sheet-level structural rule must use incremental QA');
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
assert(qaSource.includes('const checks = [...byCheck.keys()];') && !qaSource.includes('const checks = [...byCheck.keys()].sort'),
  'QA finding checks must retain XML evaluation order');
assert(qaSource.includes('const sheets = [...grouped.entries()];') && qaSource.includes('const rows = results.map(result => {'),
  'QA PDF sheets and checks must retain XML evaluation order');
assert(qaGraphSource.includes("const sheets = _qaGraphAggregate(ruleResults, 'sheet');") && !/function _qaGraphRuleRows[\s\S]*?\.sort\(/.test(qaGraphSource),
  'QA graph sheets and checks must retain XML evaluation order');
const setQaStageSource = qaSource.match(/function setQaStage\(stage\) \{[\s\S]*?\n\}/)?.[0] || '';
assert(setQaStageSource.includes('_qaApplyStageFilter()') && !setQaStageSource.includes('startQaRun('),
  'changing QA stage must filter the completed full audit without rerunning checks');
assert(qaSource.includes('_projectRefreshFieldIssueBadges(context.entityType, context.entityName, context.facility)'),
  'changing QA stage must immediately clear stale modal warning badges');
assert(qaSource.includes('Stage: stageLabel') && qaSource.includes('<span class="meta-label">QA stage</span>'),
  'QA spreadsheet and PDF exports must identify the selected stage');
const incrementalQaSource = qaSource.slice(qaSource.indexOf('function _qaRevalidateFieldChangeCache'),
  qaSource.indexOf('function _qaAdjustRuleResultsForRow'));
assert(incrementalQaSource.includes('function qaRevalidateFieldChanges') &&
  !incrementalQaSource.includes('runQA(') && !incrementalQaSource.includes('startQaRun('),
  'modal field changes must batch row-level QA without starting a full audit');
assert(modalsSource.includes("const identityField = _cobieEntityDescriptor(state.type)?.identityField || 'Name';") && modalsSource.includes('alert(`${identityField} is required.`);'),
  'new entity identity must come from the XML sheet descriptor, including Contact Email');
assert(modalsSource.includes("qaRevalidateAfterEntityCreate(state.type, state.row)"),
  'saving a new item must revalidate the created row and its dependent QA findings');
assert(modalsSource.includes('if (isNewEntity) _projectClearRowDirty(row);'),
  'unsaved draft fields must not show persisted-change styling or Undo controls');
assert(modalsSource.includes('const _projectCreatedEntityRows = new WeakSet();') && modalsSource.includes('_projectCreatedEntityRows.add(state.row);'),
  'saved new rows must retain new-item semantics for the session');
assert(modalsSource.includes('if (_projectIsNewEntityRow(entity)) {') && modalsSource.includes('_projectClearRowDirty(row);'),
  'stale Undo controls must never revert values on newly created rows');
assert(modalsSource.includes("project-attr-row${isNewEntity ? '' : ' project-dirty'}") && modalsSource.includes('if (!isNewEntity) _projectMarkRowDirty(newRow'),
  'new attributes on new entities must not start with pending-change styling');
const saveCreateBody = modalsSource.slice(modalsSource.indexOf('function _saveNewEntityInfo()'), modalsSource.indexOf('function _projectFieldValue'));
assert(!saveCreateBody.includes('buildIdx();') && !saveCreateBody.includes('refreshDisplay();') && saveCreateBody.includes('_projectApplyMutation({'),
  'new entity save must update affected indexes through the shared mutation coordinator');
assert(modalsSource.includes('function _projectApplyMutation(context = {})') && !modalsSource.includes('_projectScheduleIndexRefresh'),
  'ordinary modal edits must use the context-driven coordinator without scheduling global index rebuilds');
assert(!modalsSource.includes('_INFO_ENTITY_SHEET') && !modalsSource.includes('_INFO_ENTITY_DB'),
  'modal entity routing must resolve schema sheet names and database buckets dynamically');
assert(modalsSource.includes('function _modalAssociationRelationship') &&
  !modalsSource.includes('function _updateSysComponents') && !modalsSource.includes('function _updateCompSystems'),
  'modal associations must use XML relationship descriptors without System-specific mutation helpers');
assert(!fs.readFileSync(path.join(javascriptDir, 'utils.js'), 'utf8').includes('dataSheets > dataSheet'),
  'runtime entities must come from the authoritative XML sheets collection only');
assert(modalsSource.includes("Name:type === 'contact' ? '' : String(prefillName || '').trim()"),
  'Contact email prefills must not populate a phantom Name field');
assert.strictEqual(vm.runInContext("_qaRowIdentity('Contact', { Email:'person@example.com', Name:'' })", qaContext), 'person@example.com',
  'QA must identify Contact rows by Email');
assert(qaSource.includes("if (col.checks?.length)") && qaSource.includes('_qaNamedCheckResult(checkName, v, schema, col)'),
  'row revalidation must evaluate named XML column checks');
assert(modalsSource.includes('return qaHasRun && Array.isArray(qaFindings) ? qaFindings : [];'),
  'opening a project modal must not trigger QA before the first audit');
assert(appLifecycleSource.includes("if (typeof resetQaAudit === 'function') resetQaAudit();"),
  'workbook lifecycle changes must invalidate the completed QA audit');
assert(modalsSource.includes("if (entityType === 'facility' && renamedFacility) resolvedName = renamedFacility;"),
  'non-facility rename previews must retain the edited item name instead of the facility scope');
runLogoThemeRegression({ assert, vm,
  devIndexSource, logoSvgSource, logoThemeSource, releaseBuilderSource });

context.DOMParser = DOMParser;
context.XMLHttpRequest = xmlRequestFor(qaSchemaSource);
loadModules(['utils.js', 'cobie-parser.js', 'filters.js', 'three-d-viewer.js']);

const runtimeFilterContract = JSON.parse(vm.runInContext(`JSON.stringify(COBIE_FILTER_DIMENSIONS.map(filter => ({
  dimension:filter.dimension, order:filter.order, valueField:filter.valueField,
  valueIndex:filter.valueIndex, throughIndex:filter.throughIndex,
  contextProperty:filter.contextProperty, defaultActive:filter.defaultActive,
})))`, context));
const schemaFilterOrder = [...categorizedSchema.querySelectorAll('sheets > sheet')]
  .map(sheet => ({ sheet, filter:sheet.querySelector(':scope > filter') }))
  .filter(entry => entry.filter)
  .sort((left, right) => Number(left.filter.getAttribute('order')) - Number(right.filter.getAttribute('order')))
  .map(entry => (entry.filter.getAttribute('dimension') || entry.sheet.getAttribute('name')).toLowerCase());
assert.deepStrictEqual(runtimeFilterContract.map(filter => filter.dimension),
  schemaFilterOrder,
  'filter and group order must come from XML filter metadata');
assert.strictEqual(runtimeFilterContract.find(filter => filter.dimension === 'floor').throughIndex, 'spFloor',
  'Floor filtering must declare its component relationship traversal in XML');
assert.strictEqual(runtimeFilterContract.find(filter => filter.dimension === 'type').defaultActive, true,
  'the default active grouping dimension must come from XML');
assert.strictEqual(vm.runInContext("COBIE_RUNTIME_MODEL.searches.find(search => search.source === 'component').includeAttributes", context), true,
  'component search must include bound attributes from nested runtime metadata');
const selectiveIndexCalls = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const calls = [];
  const original = updateIdxForEntities;
  updateIdxForEntities = types => calls.push(types);
  updateIdxForChanges([{ entityType:'contact', row:{}, aliases:['Phone'] }]);
  updateIdxForChanges([{ entityType:'contact', row:{}, aliases:['Email'] }]);
  updateIdxForChanges([{ entityType:'component', row:{}, aliases:['CreatedOn'] }]);
  updateIdxForChanges([{ entityType:'component', row:{}, aliases:['Space'] }]);
  updateIdxForChanges([{ entityType:'component', row:{}, aliases:[], attributes:true }]);
  updateIdxForEntities = original;
  return calls;
})())`, context));
assert.deepStrictEqual(selectiveIndexCalls, [['contact'], ['component'], ['component']],
  'only identity, relationship, filter, search, document-context, and searchable attribute changes may rebuild derived indexes');
assert(!fs.readFileSync(path.join(javascriptDir, 'state.js'), 'utf8').includes('facility: new Set()') &&
  fs.readFileSync(path.join(javascriptDir, 'panels.js'), 'utf8').includes('COBIE_FILTER_DIMENSIONS.forEach'),
  'filter state and panels must enumerate XML descriptors instead of static dimensions');

assert.strictEqual(context.readSheet({ Sheets:{ Type:[
  { Name:'', Category:'', Description:'' },
  { Name:'', Category:'Pump', Description:'' },
] } }, 'Type').length, 1, 'import must discard fully blank rows but retain populated unnamed rows for QA');

context.parseCOBieInto(workbook('Facility A', { Name:'Level 01', Description:'First' }), 'a.xlsx');
context.parseCOBieInto(workbook('Facility A', { Name:'Level 01', Elevation:'3000' }), 'b.xlsx');
assert.strictEqual(context.db.floors.length, 1, 'overlapping Floor rows should merge');
assert.strictEqual(context.db.floors[0].Description, 'First');
assert.strictEqual(context.db.floors[0].Elevation, '3000');

const logicalFacilityBuckets = JSON.parse(vm.runInContext('JSON.stringify([...COBIE_RUNTIME_MODEL.entities.values()].map(descriptor => descriptor.bucket))', context));
const savedLogicalFacilityRows = Object.fromEntries(logicalFacilityBuckets.map(bucket => [bucket, context.db[bucket]]));
logicalFacilityBuckets.forEach(bucket => { context.db[bucket] = []; });
context.db.facilities = [
  { Name:'Main Facility', ExternalFacilityIdentifier:'project-guid-1', _sourceFacility:'Main Facility', _facility:'Main Facility', _facilityIdentifier:'project-guid-1', _hasFacilityInfo:true, _workbookKey:'facility.xlsx', _fileName:'facility.xlsx', _facRowCount:1 },
  { Name:'Alternate Name', ExternalFacilityIdentifier:'project-guid-1', _sourceFacility:'Alternate Name', _facility:'Alternate Name', _facilityIdentifier:'project-guid-1', _hasFacilityInfo:true, _workbookKey:'types.xlsx', _fileName:'types.xlsx', _facRowCount:1 },
  { _sourceFacility:'components', _facility:'components', _facilityIdentifier:'', _hasFacilityInfo:false, _workbookKey:'components.xlsx', _fileName:'components.xlsx', _facRowCount:0 },
];
context.db.types = [{ Name:'Pump Type', _facility:'Alternate Name', _workbookKey:'types.xlsx', _fileName:'types.xlsx' }];
context.db.components = [{ Name:'Pump 01', TypeName:'Pump Type', _facility:'components', _workbookKey:'components.xlsx', _fileName:'components.xlsx' }];
context.canonicalizeLoadedFacilities();
assert.deepStrictEqual(context.db.facilities.map(row => row._facility), ['Main Facility', 'Main Facility', 'Main Facility'],
  'matching ExternalFacilityIdentifier values and facility-less workbooks must share the first explicit facility name');
assert.strictEqual(context.db.types[0]._facility, 'Main Facility');
assert.strictEqual(context.db.components[0]._facility, 'Main Facility');
assert.strictEqual(context._logicalFacilityRows().length, 1,
  'split source workbooks must expose one logical facility while retaining physical workbook rows');
assert.strictEqual(context.db.facilities.length, 3,
  'logical facility grouping must retain every physical workbook for round-trip export');
logicalFacilityBuckets.forEach(bucket => { context.db[bucket] = savedLogicalFacilityRows[bucket]; });

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
const genericDocumentEntry = JSON.parse(vm.runInContext(`JSON.stringify(_documentContextEntry({
  doc:{ Name:'Manual' }, linkedType:'component', linkedName:'AHU-01',
  facilities:new Set(['facility a']), types:new Set(['acid neutralizer']), systems:new Set(['foundations']),
  spaces:new Set(['meeting room']), floors:new Set(['level 01']), categories:new Set(['pm_70_15_07']),
}))`, context));
assert.deepStrictEqual(Object.keys(genericDocumentEntry.valuesByDimension),
  runtimeFilterContract.filter(filter => filter.contextProperty).map(filter => filter.dimension),
  'document entries must project every XML filter context through valuesByDimension');
assert(!Object.prototype.hasOwnProperty.call(genericDocumentEntry, 'facilityNames'),
  'document entries must not retain statically named dimension properties');
assert(context.idx.floors.includes('Level 01'),
  'the Floor filter must use Floor identity values when Floor rows exist');
const parsedFloorRows = context.db.floors;
context.db.floors = [];
context.db.spaces.push({ Name:'Fallback Room', FloorName:'Fallback Level', _facility:'Facility B' });
context.updateIdxForEntities('floor');
assert(context.idx.floors.includes('Fallback Level'),
  'the Floor filter must fall back to Space.FloorName when no Floor rows exist');
context.db.floors = parsedFloorRows;
context.updateIdxForEntities('floor');
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

context.db.types.push({ Name:'Live Pump', Category:'Pr_99_01', Description:'Created live', _facility:'Facility B' });
context.db.spaces.push({ Name:'Live Room', FloorName:'Live Floor', Category:'SL_99', _facility:'Facility B' });
context.db.floors.push({ Name:'Live Floor', _facility:'Facility B' });
context.db.components.push({ Name:'Live Component', TypeName:'Live Pump', Space:'Live Room', _facility:'Facility B' });
context.updateIdxForEntities('type');
assert(context.idx.types.includes('Live Pump'), 'incremental Type creation must update lookup options immediately');
assert(context.idx.catGroups.type['pr_99'].includes('Live Pump'), 'incremental Type creation must update category filters immediately');
assert.strictEqual(context.idx.byType['facility b::live pump'][0].Name, 'Live Component',
  'incremental Type changes must update assigned Component relationships');
assert(context.idx.searchText['facility b::live component'].includes('created live'),
  'incremental Type changes must replace dependent Component search text');
context.db.systems.push({ Name:'Live System', ComponentNames:'Live Component', _facility:'Facility B' });
context.updateIdxForEntities('system');
assert(context.idx.systems.includes('Live System') && context.idx.compSys['facility b::live component'].includes('live system'),
  'incremental System creation must update forward and reverse relationship indexes');
context.db.documents.push({
  Name:'Live Manual', Category:'PM_99', SheetName:'Component', RowName:'Live Component', _facility:'Facility B',
});
context.updateIdxForEntities('document');
assert.strictEqual(context.idx.docs['facility b::component::live component'][0].Name, 'Live Manual',
  'incremental Document creation must update entity document links');
assert(context.idx.docCatByComp['facility b::live component'].has('pm_99'),
  'incremental Document creation must update component document categories');
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

runDocumentViewRegression({ assert, context, fs, path, javascriptDir, loadModule, vm });

loadModule('panels.js');
const filterBarHost = { innerHTML:'' };
const groupListHost = { innerHTML:'' };
const previousGetElementById = context.document.getElementById;
context.document.getElementById = id => ({ 'filter-bar':filterBarHost, 'group-sortable':groupListHost }[id] || null);
context.hydrateFilterControls();
context.document.getElementById = previousGetElementById;
const hydratedFilterControls = runtimeFilterContract.map(filter => ({
  dimension:filter.dimension,
  badge:filterBarHost.innerHTML.includes(`id="fb-${filter.dimension}"`),
  list:filterBarHost.innerHTML.includes(`id="fpl-${filter.dimension}"`),
  group:groupListHost.innerHTML.includes(`data-dim="${filter.dimension}"`),
}));
assert(hydratedFilterControls.every(control => control.badge && control.list && control.group),
  'every XML filter dimension must generate its panel controls and result-group chip');
assert(hydratedFilterControls.some(control => control.dimension === 'zone'),
  'Zone must be available as an XML-driven filter and result grouping control');
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
assert.deepStrictEqual(
  { ...context._normalizedFloorToSvgAffine({ a:'1', b:'0', c:'0.25', d:'0', e:'1', f:'-0.5' }) },
  { a:1, b:0, c:0.25, d:0, e:1, f:-0.5 },
  'loaded affine values must be normalized to finite numbers'
);
assert.strictEqual(context._normalizedFloorToSvgAffine({ a:1, b:2, c:0, d:2, e:4, f:0 }), null, 'singular affine mappings must be rejected');
assert.deepStrictEqual({ ...context._floorToSvgAffineFromUnitPoints(
  { u:1, v:0 }, { u:0, v:0 }, { u:1, v:1 }
) }, { a:-1, b:0, c:1, d:0, e:1, f:0 }, 'the saved affine must preserve the reflected UI correspondence');

loadModule('floor-svg-panel.js');
const namespacedRoomSvg = new DOMParser().parseFromString(
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:serif="http://www.serif.com/">' +
    '<g id="rooms"><path id="_00-019" serif:id="00-019" d="M0 0h10v10H0Z"/></g></svg>',
  'image/svg+xml'
);
const namespacedRoom = namespacedRoomSvg.querySelector('path');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context._svgNodeIdentifiers(namespacedRoom))), ['00-019', '_00-019'],
  'SVG room lookup must prefer a namespaced source identifier and retain the XML-safe id as fallback');
assert.strictEqual(context._svgNodeMatchedIdentifier(namespacedRoom, new Set(['00-019'])), '00-019',
  'SVG room lookup must match COBie spaces through serif:id');
const legacyAlignment = context._floorAlignmentFromRaw('{"scale":0.25}');
assert.strictEqual(legacyAlignment.scale, 0.25, 'legacy uniform alignment scale must remain unchanged');
const nonUniformAlignment = context._floorAlignmentFromRaw('{"scale":1,"scaleX":0.3,"scaleY":0.5}');
assert.strictEqual(nonUniformAlignment.scale, 0.3, 'nonuniform saved alignment must migrate to the contained uniform scale');
const persistedAlignment = context._floorAlignmentFromRaw('{"floorToSvg":{"a":"1","b":"0","c":"0.2","d":"0","e":"1","f":"0.3"}}');
assert.deepStrictEqual({ ...persistedAlignment.floorToSvg }, { a:1, b:0, c:0.2, d:0, e:1, f:0.3 });
const roundTripAlignment = context._floorAlignmentFromRaw(context._floorAlignmentToRaw(affineAlignment));
assert.deepStrictEqual({ ...roundTripAlignment.floorToSvg }, affineAlignment.floorToSvg, 'saved affine alignment must load without coordinate drift');
const flippedRoundTrip = context._floorAlignmentFromRaw(context._floorAlignmentToRaw({ ...affineAlignment, flipHorizontal:true, flipVertical:true }));
assert.strictEqual(flippedRoundTrip.flipHorizontal, true, 'horizontal UI reflection must remain set after load');
assert.strictEqual(flippedRoundTrip.flipVertical, true, 'vertical UI reflection must remain set after load');
const rotatedViewBounds = context._svgRotatedBounds(100, 50, 90);
assert(Math.abs(rotatedViewBounds.width - 50) < 1e-10);
assert(Math.abs(rotatedViewBounds.height - 100) < 1e-10);
const horizontallyFlippedBounds = context._svgRotatedBounds(100, 50, 0, { x:-1, y:1 });
assert.deepStrictEqual({ ...horizontallyFlippedBounds }, { minX:-100, minY:0, width:100, height:50 },
  'horizontal display reflection must retain the SVG dimensions and expose its translated origin');
const rotatedFlippedBounds = context._svgRotatedBounds(100, 50, 90, { x:-1, y:-1 });
assert(Math.abs(rotatedFlippedBounds.width - 50) < 1e-10);
assert(Math.abs(rotatedFlippedBounds.height - 100) < 1e-10);
const floor = context.db.floors[0];
const svg = '<svg>' + 'x'.repeat(70000) + '</svg>';
const declaredSvg = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
  '<svg width="100%" height="100%" viewBox="0 0 1200 1324" version="1.1" xmlns="http://www.w3.org/2000/svg"></svg>';
assert.strictEqual(context._extractInlineSvgMarkup(declaredSvg), declaredSvg,
  'SVG loading must accept an XML declaration and SVG 1.1 DOCTYPE');
assert(context._writeChunkedFloorAttribute(floor, svg, 'svg', /^svg(?:[^\d]*(\d+))?$/i, 30000));
const stored = context._collectChunkedFloorAttributes(/^svg(?:[^\d]*(\d+))?$/i);
assert.strictEqual(stored[context._rowKey(floor, 'Level 01')], svg);

loadModule('component-placement.js');
assert.strictEqual(context._componentPlacementMarkerCoordinate(undefined, 862), 862, 'missing saved marker coordinates must use the recovered UV position');
assert.strictEqual(context._componentPlacementMarkerCoordinate(0, 862), 0, 'valid SVG origin coordinates must be preserved');
const originalResolvedFloorAlignmentForEntry = context._resolvedFloorAlignmentForEntry;
context._resolvedFloorAlignmentForEntry = () => ({ floorToSvg:{ a:1, b:0, c:0, d:0, e:1, f:0 } });
const placementSceneKeyBeforeAlignment = context._componentPlacementPreviewSceneKey({ spaceName:'Room 101' }, { key:'level 01' });
context._resolvedFloorAlignmentForEntry = () => ({ floorToSvg:{ a:1, b:0, c:0.2, d:0, e:1, f:0 } });
const placementSceneKeyAfterAlignment = context._componentPlacementPreviewSceneKey({ spaceName:'Room 101' }, { key:'level 01' });
assert.notStrictEqual(placementSceneKeyAfterAlignment, placementSceneKeyBeforeAlignment, 'affine alignment changes must invalidate the placement preview cache');
context._resolvedFloorAlignmentForEntry = originalResolvedFloorAlignmentForEntry;
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
floorPlans[0].alignment = null;
context._viewer3dRebuildRoomGeometryCache();
assert(context._viewer3dSceneData([], {}).objects.filter(object => object.kind === 'space').every(object => !object.polygon), 'SVG rooms must not extrude before a valid alignment is saved');
floorPlans[0].alignment = affineAlignment;
const originalFloorAlignmentAttrValueForRow = context._floorAlignmentAttrValueForRow;
context._floorAlignmentAttrValueForRow = () => context._floorAlignmentToRaw(affineAlignment);
context._viewer3dRebuildRoomGeometryCache();
const roomScene = context._viewer3dSceneData([], {});
const cachedRooms = roomScene.objects.filter(object => object.kind === 'space');
assert.strictEqual(cachedRooms.length, 2, 'SVG polygons should create rooms with or without coordinate bounds');
assert(cachedRooms.every(object => object.polygon), 'cached SVG polygons must take precedence over coordinate cubes');
assert.strictEqual(cachedRooms.find(object => object.spaceKey === 'room 101').sizeY, 3000, 'SVG rooms should retain coordinate height when available');
assert.strictEqual(cachedRooms.find(object => object.spaceKey === 'room 102').sizeY, 3000, 'SVG-only rooms should use the floor default height');
context._floorAlignmentAttrValueForRow = originalFloorAlignmentAttrValueForRow;
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

loadModules(['model-config.js', 'modals.js']);
assert.strictEqual(vm.runInContext('MODEL_CONFIG_SCHEMA_STATUS.loaded', context), true,
  'modal configuration must hydrate from the shared COBie XML document');
const facilityModalTitle = [...categorizedSchema.querySelectorAll('sheets > sheet')]
  .find(sheet => sheet.getAttribute('name') === 'Facility')
  ?.querySelector(':scope > ui')?.getAttribute('modalTitle');
assert.strictEqual(vm.runInContext('MODEL_MODAL_CONFIG.facility.title', context), facilityModalTitle,
  'modal titles must come from sheet UI metadata');
assert.strictEqual(vm.runInContext("MODEL_MODAL_CONFIG.type.cards.warranty.fields.find(field => field.aliases.includes('WarrantyGuarantorParts')).label", context), 'Parts Guarantor',
  'exceptional field labels must come from column UI metadata');
vm.runInContext("db.contacts.push({ Email:'identity@example.com', _facility:'Facility A' })", context);
assert.strictEqual(vm.runInContext("_findInfoEntityRow('contact', 'identity@example.com', 'Facility A').Email", context), 'identity@example.com',
  'generic entity lookup must honor the XML identityField instead of assuming Name');
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
const assetTypeFieldConfig = JSON.parse(vm.runInContext(`JSON.stringify(
  MODEL_MODAL_CONFIG.type.cards.identification.fields.find(field => field.aliases.includes('AssetType'))
)`, context));
assert.strictEqual(assetTypeFieldConfig.edit, 'lookup');
assert.strictEqual(assetTypeFieldConfig.lookupSource, 'picklist:AssetType');
const assetTypeLookupOptions = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  db.picklists.push(
    { AssetType:'Fixed' },
    { AssetType:'Moveable' },
    { AssetType:'fixed' },
    { AssetType:'' }
  );
  return _projectLookupOptions('picklist:AssetType');
})())`, context));
assert.deepStrictEqual(assetTypeLookupOptions.map(option => option.value), ['Fixed', 'Moveable'],
  'Picklist references must expose unique sorted values from their target column');
assert(assetTypeLookupOptions.every(option => option.search === option.value.toLowerCase()),
  'Picklist reference options must provide searchable text');
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
const checkedColumnsByType = Object.fromEntries([...categorizedSchema.querySelectorAll('sheets > sheet')]
  .map(sheet => [
    sheet.getAttribute('name').toLowerCase(),
    [...sheet.querySelectorAll(':scope > columns > column')]
      .filter(column => column.querySelector(':scope > qa > rule'))
      .map(column => column.getAttribute('name')).sort(),
  ]).filter(([, columns]) => columns.length));
const modalColumnsByType = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(
  Object.entries(MODEL_MODAL_CONFIG)
    .filter(([type]) => type !== 'document')
    .map(([type, config]) => [type, Object.values(config.cards)
      .flatMap(card => card.fields || [])
      .map(field => field.aliases[0])])
))`, context));
modalColumnsByType.system.push('ComponentNames');
const ordinaryModalTypes = new Set([...categorizedSchema.querySelectorAll('sheets > sheet')]
  .filter(sheet => sheet.querySelector(':scope > runtime')?.getAttribute('modal') === 'true')
  .map(sheet => sheet.getAttribute('name').toLowerCase())
  .filter(type => type !== 'document'));
Object.entries(checkedColumnsByType).filter(([type]) => ordinaryModalTypes.has(type)).forEach(([type, checkedColumns]) => {
  assert(modalColumnsByType[type], `${type} must have an information modal configuration`);
  assert.deepStrictEqual([...modalColumnsByType[type]].sort(), checkedColumns,
    `${type} information modal fields must exactly match its checked XML columns`);
});
const parsedSchema = new DOMParser().parseFromString(qaSchemaSource, 'application/xml');
const groupedColumnsByType = Object.fromEntries([...parsedSchema.querySelectorAll('sheets > sheet')].map(sheet => [
  sheet.getAttribute('name').toLowerCase(),
  Object.fromEntries([...sheet.querySelectorAll(':scope > columns > column[groupTitle]')]
    .map(column => [column.getAttribute('name'), column.getAttribute('groupTitle')])),
]));
const modalGroupsByType = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(
  Object.entries(MODEL_MODAL_CONFIG).map(([type, config]) => [type, Object.fromEntries(
    Object.values(config.cards).flatMap(card => (card.fields || []).map(field => [field.aliases[0], card.title]))
  )])
))`, context));
Object.entries(groupedColumnsByType).forEach(([type, groupedColumns]) => {
  Object.entries(groupedColumns).forEach(([column, groupTitle]) => {
    assert.strictEqual(modalGroupsByType[type]?.[column], groupTitle,
      `${type}.${column} must render in the XML-defined ${groupTitle} card`);
  });
});
const checkedEntityAssociations = JSON.parse(vm.runInContext(`JSON.stringify(
  Object.entries(MODEL_MODAL_CONFIG)
    .filter(([type]) => type !== 'document')
    .flatMap(([type, config]) => Object.values(config.cards)
      .filter(card => card.mode === 'associations')
      .flatMap(card => (card.associations || []).map(association => ({ type, key:association.key }))))
)`, context));
assert.deepStrictEqual(checkedEntityAssociations.sort((left, right) => `${left.type}.${left.key}`.localeCompare(`${right.type}.${right.key}`)), [
  { type:'floor', key:'spaces' },
  { type:'space', key:'floor' },
  { type:'space', key:'zones' },
  { type:'space', key:'components' },
  { type:'zone', key:'spaces' },
  { type:'type', key:'components' },
  { type:'system', key:'components' },
  { type:'component', key:'type' },
  { type:'component', key:'space' },
  { type:'component', key:'systems' },
].sort((left, right) => `${left.type}.${left.key}`.localeCompare(`${right.type}.${right.key}`)), 'entity information modals must expose their editable COBie relationships');
const documentAssociations = JSON.parse(vm.runInContext(
  'JSON.stringify(MODEL_MODAL_CONFIG.document.cards.associations.associations)', context,
));
assert.deepStrictEqual(documentAssociations.map(item => item.targetType),
  ['facility', 'floor', 'space', 'type', 'component', 'system']);
assert(documentAssociations.every(item => item.cardinality === 'many'), 'all Document associations must be one-to-many');
const documentApplicableTo = JSON.parse(vm.runInContext(
  'JSON.stringify(MODEL_MODAL_CONFIG.document.cards.applicableTo)', context,
));
assert.strictEqual(documentApplicableTo.title, 'Applicable to', 'Document modal must include an Applicable to card');
assert.strictEqual(documentApplicableTo.mode, 'association-summary', 'Applicable to must use the association summary renderer');
assert.deepStrictEqual(documentApplicableTo.associations.map(item => item.targetType),
  ['facility', 'floor', 'space', 'type', 'component', 'system'],
  'Applicable to groups must retain the configured relationship order');
assert(modalsSource.includes('if (!selected.size) return') && modalsSource.includes('data-document-applicable-summary'),
  'Applicable to must omit empty relationship headers');
assert(modalsSource.includes("const activeRow = entityType === 'document' ? (_projectActiveEntityContext()?.row || row) : row;") &&
  modalsSource.includes('_associationRefreshDocumentSummary(entityType, activeRow);'),
  'Document association changes must refresh Applicable to from the surviving active link row');
assert(resultsCssSource.includes('.project-applicable-group') && resultsCssSource.includes('.project-applicable-values span'),
  'Applicable to groups and selected values must be styled');
const applicableGroupCss = resultsCssSource.match(/\.project-applicable-group \{[\s\S]*?\n\}/)?.[0] || '';
assert(!applicableGroupCss.includes('--project-association-bg') && !applicableGroupCss.includes('--project-association-text'),
  'Applicable to groups must inherit the fill and text colors of their association type');

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
context.db.spaces = [
  { Name:'Plant Room', FloorName:'', Category:'SL_90_50 : Plant rooms', _facility:'Facility A' },
  { Name:'Store', FloorName:'', Category:'SL_90_60 : Storage spaces', _facility:'Facility A' },
];
context.db.components = [
  { Name:'Pump 01', TypeName:'', Space:'', _facility:'Facility A' },
  { Name:'Pump 02', TypeName:'', Space:'', _facility:'Facility A' },
  { Name:'Classified Pump', TypeName:'Pump Type', Space:'', _facility:'Facility A' },
];
context.db.systems = [{ Name:'Heating', Category:'Ss_60_40 : Heating systems', ComponentNames:'', _facility:'Facility A' }];
context.db.documents = [{ Name:'Manual', Directory:'manual.pdf', SheetName:'Facility', RowName:'Facility A', _facility:'Facility A' }];
context.db.facilities = [{ Name:'Facility A', _facility:'Facility A' }];
context.buildIdx();
const draftDocument = { Name:'Draft Manual', SheetName:'Facility', RowName:'', _facility:'Facility A' };
context._draftDocument = draftDocument;
vm.runInContext('_newEntityDraft = { type:"document", row:_draftDocument, associations:Object.create(null), saving:false }', context);
assert.strictEqual(context._associationSelectedNames('document', draftDocument,
  { key:'facilities', targetType:'facility' }, 'Facility A').size, 0,
  'a blank draft Document RowName must not appear as a selected Facility');
const documentCountBeforeDraftAssociation = context.db.documents.length;
context._setEntityAssociation('document', draftDocument,
  { key:'floors', targetType:'floor', cardinality:'many' }, 'Level 01', 'Facility A', true);
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([..._newEntityDraft.associations.floors])', context)), ['level 01'],
  'create-view Document associations must stage immediately');
assert.strictEqual(context.db.documents.length, documentCountBeforeDraftAssociation,
  'staging a draft Document association must not mutate persisted rows before Save');
const draftComponent = { Name:'Draft Pump', TypeName:'', _facility:'Facility A' };
context._draftComponent = draftComponent;
vm.runInContext('_newEntityDraft = { type:"component", row:_draftComponent, associations:Object.create(null), saving:false }', context);
context._setEntityAssociation('component', draftComponent,
  { key:'type', targetType:'type', cardinality:'one' }, 'Pump Type', 'Facility A', true);
assert.strictEqual(draftComponent.TypeName, 'Pump Type',
  'direct draft associations must update their Applicable To field immediately');
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([..._newEntityDraft.associations.type])', context)), ['pump type'],
  'direct draft associations must remain selected when controls rerender');
vm.runInContext('_newEntityDraft = null', context);
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

const componentSpaceAssociation = JSON.parse(vm.runInContext(
  'JSON.stringify(MODEL_MODAL_CONFIG.component.cards.associations.associations.find(item => item.key === "space"))', context,
));
assert.strictEqual(componentSpaceAssociation.cardinality, 'many',
  'the XML-generated Component Spaces picker must be one-to-many');
component.Space = 'Plant Room,Store';
const componentSpaceControl = context._associationControl('component', component, componentSpaceAssociation, 'Facility A');
assert(componentSpaceControl.includes('project-component-locate'), 'Component Space must expose the shared Locate action');
assert(componentSpaceControl.includes('project-association-space'), 'Space relationships must carry their category color class');
assert.strictEqual((componentSpaceControl.match(/type="checkbox"/g) || []).length, 2,
  'the one-to-many Component Spaces picker must render checkboxes');
assert.strictEqual((componentSpaceControl.match(/ checked/g) || []).length, 2,
  'comma-delimited Component Space values must preselect every associated Space');
context._setEntityAssociation('component', component, componentSpaceAssociation, 'Plant Room', 'Facility A', false);
assert.strictEqual(component.Space, 'Store', 'removing one Space must preserve the other association');
context._setEntityAssociation('component', component, componentSpaceAssociation, 'Plant Room', 'Facility A', true);
assert.strictEqual(component.Space, 'Store,Plant Room', 'Component Spaces must be written back with a comma delimiter');
component.Space = '';
assert(context._projectLookupMenuMarkup([], 'new@example.test', true).includes('project-lookup-create'),
  'an unmatched Contact lookup must offer Contact creation');
assert(context._projectLookupOptions('type').some(option => option.value === 'Pump Type') &&
  context._projectLookupOptions('space').some(option => option.value === 'Plant Room'),
  'XML entity field lookups must include facility-scoped canonical Type and Space rows');
vm.runInContext('_originalDbState = JSON.parse(JSON.stringify(db))', context);
assert(!context._commitAssociationControl.toString().includes('refreshDisplay'),
  'association selections must not rerender the full result tree on every click');

context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', true);
assert(context._projectEntityDiffersFromBaseline('component', component, 'Pump 01', 'Facility A'));
context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', false);
assert(!context._projectEntityDiffersFromBaseline('component', component, 'Pump 01', 'Facility A'),
  'restoring the original Component associations must clear its dirty state');
context._setEntityAssociation('component', component, { key:'type' }, 'Pump Type', 'Facility A', true);
context._setEntityAssociation('component', component, componentSpaceAssociation, 'Plant Room', 'Facility A', true);
assert.strictEqual(component.TypeName, 'Pump Type');
assert.strictEqual(component.Space, 'Plant Room');
const associationValueCell = { dataset:{}, innerHTML:'', querySelector:() => null };
const associationFieldClasses = new Set();
const associationFieldRow = {
  dataset:{ aliases:'TypeName|Type Name', originalValue:'' },
  querySelector:selector => selector === '[data-role="field-value"]' ? associationValueCell : null,
  classList:{ toggle:(name, enabled) => enabled ? associationFieldClasses.add(name) : associationFieldClasses.delete(name) },
};
context.document.querySelectorAll = selector => selector.includes('.project-field-row[data-aliases]') ? [associationFieldRow] : [];
vm.runInContext('_projectModalContext = { entityType:"component", entityName:"Pump 01", facility:"Facility A", row:db.components[0] }', context);
context._associationRefreshModelFields('component', component);
assert.strictEqual(associationValueCell.dataset.rawValue, 'Pump Type',
  'association selection must immediately refresh the corresponding modal field value');
assert(associationValueCell.innerHTML.includes('Pump Type') && associationFieldClasses.has('project-dirty'),
  'association-backed modal fields must immediately show their changed state');
const associationOptionsHost = { innerHTML:'', scrollTop:0 };
const associationLimitClasses = { toggle:() => {} };
const associationControl = {
  dataset:{ associationKey:'type', optionsCache:'field-sync-test' },
  querySelector:selector => ({
    '.project-association-search':{ value:'' },
    '.project-association-options':associationOptionsHost,
    '.project-association-limit':{ classList:associationLimitClasses, textContent:'' },
  }[selector] || null),
  querySelectorAll:() => [],
};
vm.runInContext(`_associationOptionsCache.set('field-sync-test', {
  options:[
    { name:'Pump Type', targetFacility:'Facility A', selected:false, search:'pump type', categoryKey:'', categoryLabel:'' },
    { name:'Other Type', targetFacility:'Facility A', selected:true, search:'other type', categoryKey:'', categoryLabel:'' }
  ],
  inputType:'radio', inputName:'association-component-type', hierarchy:[], collapsed:new Set(), visibleLimit:120, query:''
})`, context);
context.document.querySelectorAll = selector => selector.includes('.project-association[data-association-key]') ? [associationControl] : [];
context._associationRefreshControlsFromModel('component', component);
const synchronizedAssociationOptions = JSON.parse(vm.runInContext(
  `JSON.stringify(_associationOptionsCache.get('field-sync-test').options.map(option => ({ name:option.name, selected:option.selected })))`, context,
));
assert.deepStrictEqual(synchronizedAssociationOptions, [
  { name:'Pump Type', selected:true },
  { name:'Other Type', selected:false },
], 'restoring an association-backed field must synchronize the dropdown selection cache');
context.document.querySelectorAll = () => [];
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