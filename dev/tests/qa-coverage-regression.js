// Coverage and scope — regression suite.
//
// The property under test is honesty about what was NOT looked at, and the hard
// boundary is that saying so must never move a number the QA engine computes.
const assert = require('assert');
const { createContext, loadModules, readJavascript, readText, path, root, vm, xmlRequestFor } = require('./test-helpers');
const { DOMParser } = require('linkedom');

const schemaSource = readText(path.join(root, 'specification', 'guerrilla-ops-schema.xml'));

function makeContext() {
  const context = createContext();
  loadModules(context, ['utils.js', 'cobie-parser.js', 'qa.js']);
  // readSheet() reaches for XLSX; the fixture sheets carry their rows directly.
  vm.runInContext(`
    XLSX = { utils: { sheet_to_json: sheet => (sheet && sheet.__rows) || [] } };
    function _wb(sheets) {
      const wb = { SheetNames: Object.keys(sheets), Sheets: {} };
      Object.entries(sheets).forEach(([name, rows]) => { wb.Sheets[name] = { __rows: rows }; });
      return wb;
    }
    function _row(v) { return { Name: v }; }
  `, context);
  return context;
}

// A profile that describes exactly two sheets, so "described" and "recognised" differ.
function withSchema(context, sheetNames) {
  vm.runInContext(
    `_qaSchemaCache = { sheets: ${JSON.stringify(sheetNames.map(name => ({ name, columns: [], references: [], uniqueRules: [], relationRules: [], stages: ['design'], stage: 'design' })))} };`,
    context);
}

function coverage(context, setup) {
  vm.runInContext(setup, context);
  return JSON.parse(vm.runInContext('JSON.stringify(_qaCoverage())', context));
}

const QA_STAGES = ['design', 'construction', 'operation'];
const results = [];
function check(name, fn) {
  try { fn(); results.push([name, true, '']); console.log(`  PASS  ${name}`); }
  catch (err) { results.push([name, false, err.message]); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

// ── A1 multi-workbook, same facility ──────────────────────────────────────────
// _qaLogicalFacilityRows() keeps one representative per facility identity, so a
// second file describing the same facility must not vanish from coverage.
check('A1 a second workbook for the same facility is still counted', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [
      { _facility:'Tower', _facilityIdentifier:'tower', _workbookKey:'wb1', _fileName:'one.xlsx',
        _workbook:_wb({ Facility:[_row('a')] }) },
      { _facility:'Tower', _facilityIdentifier:'tower', _workbookKey:'wb2', _fileName:'two.xlsx',
        _workbook:_wb({ Facility:[_row('b')], Job:[_row('c')] }) },
    ];`);
  assert.strictEqual(cov.workbooks, 2, 'both workbooks must be walked');
  assert.ok(cov.notAssessed.some(e => e.sheet === 'Job' && e.file === 'two.xlsx'),
    'the second workbook\'s unprofiled sheet must appear');
});

// ── A2 case-varied recognised sheet ───────────────────────────────────────────
check('A2 a case-varied described sheet is recognised, not reported as a gap', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ FACILITY:[_row('a')] }) }];`);
  assert.strictEqual(cov.notAssessed.length, 0, 'FACILITY must match Facility');
  assert.strictEqual(cov.additional.length, 0, 'and must not be called an extra worksheet');
  assert.strictEqual(cov.covered, 1);
});

// ── A3 empty but described ────────────────────────────────────────────────────
check('A3 a described sheet with no data rows reports Present, empty', () => {
  const context = makeContext();
  withSchema(context, ['Facility', 'Space']);
  const cov = coverage(context, `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Space:[] }) }];`);
  assert.deepStrictEqual(cov.empty.map(e => e.sheet), ['Space']);
  assert.strictEqual(cov.notAssessed.length, 0, 'empty is not the same claim as unassessed');
});

// ── A4 arbitrary client tab ───────────────────────────────────────────────────
// The whole reason present-minus-described was refused: this must NOT be called
// COBie work that failed assessment.
check('A4 a non-COBie tab is Additional, never Not assessed', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Notes:[_row('x')], Revisions:[_row('y')] }) }];`);
  assert.deepStrictEqual(cov.additional.map(e => e.sheet).sort(), ['Notes', 'Revisions']);
  assert.strictEqual(cov.notAssessed.length, 0, 'a client tab is not an unassessed COBie sheet');
  assert.strictEqual(cov.recognisedPresent, 1, 'client tabs are not recognised COBie worksheets');
});

// ── A5 recognised COBie sheet the profile does not describe ───────────────────
check('A5 a recognised COBie sheet outside the profile is Not assessed', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')], Spare:[_row('y')] }) }];`);
  assert.deepStrictEqual(cov.notAssessed.map(e => e.sheet), ['Job', 'Spare']);
  assert.strictEqual(cov.additional.length, 0);
  assert.strictEqual(cov.recognisedPresent, 3);
  assert.strictEqual(cov.covered, 1);
});

// ── A6 stage switch must not move coverage ────────────────────────────────────
// A sheet excluded by the selected stage is DESCRIBED, not unassessed.
check('A6 coverage is identical across every QA stage', () => {
  const context = makeContext();
  withSchema(context, ['Facility', 'Job']);
  const setup = `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')], Notes:[_row('n')] }) }];`;
  const seen = QA_STAGES.map(stage => {
    vm.runInContext(`qaSelectedStage = ${JSON.stringify(stage)};`, context);
    return JSON.stringify(coverage(context, setup));
  });
  assert.strictEqual(new Set(seen).size, 1,
    'coverage changed when the stage changed: ' + seen.join(' | '));
});

// ── A7 HTML-special sheet names are escaped on both surfaces ──────────────────
check('A7 an HTML-special sheet name is escaped in the rendered block', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  vm.runInContext(`
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'<img src=x>.xlsx',
      _workbook:_wb({ Facility:[_row('a')], "<script>alert(1)</script>":[_row('x')] }) }];`, context);
  const html = vm.runInContext('_qaCoverageHtml(_qaCoverage())', context);
  assert.ok(!html.includes('<script>'), 'raw script tag reached the output');
  assert.ok(!html.includes('<img src=x>'), 'raw filename markup reached the output');
  assert.ok(html.includes('&lt;script&gt;'), 'the name should appear, escaped');
});

// ── A8 SCORE INVARIANCE — the load-bearing arm ────────────────────────────────
// If coverage leaks into qaFindings/qaRuleResults it reaches _qaScoreTally() and
// moves the score and the donut. Nothing about the tally may change.
check('A8 computing and rendering coverage changes no scored value', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  vm.runInContext(`
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')], Notes:[_row('n')] }) }];
    qaRuleResults = [{ check:'c1', pass:3, fail:1, sheet:'Facility', column:'Name' }];
    qaAllRuleResults = qaRuleResults.slice();
    qaFindings = [{ sev:'error' }];
    qaAllFindings = qaFindings.slice();
  `, context);
  const before = vm.runInContext(`JSON.stringify({
    tally:_qaScoreTally(qaRuleResults), rules:qaRuleResults.length,
    findings:qaFindings.length, allRules:qaAllRuleResults.length, allFindings:qaAllFindings.length })`, context);
  vm.runInContext('_qaCoverageHtml(_qaCoverage());', context);
  const after = vm.runInContext(`JSON.stringify({
    tally:_qaScoreTally(qaRuleResults), rules:qaRuleResults.length,
    findings:qaFindings.length, allRules:qaAllRuleResults.length, allFindings:qaAllFindings.length })`, context);
  assert.strictEqual(after, before, 'a scored value moved:\n  before ' + before + '\n  after  ' + after);
});

// ── the real profile still parses with the inventory present ──────────────────
check('A9 every worksheet the shipped profile describes is a recognised COBie worksheet', () => {
  // Read the profile through the PARSER, never by scraping the XML. The first version
  // of this gate matched `<worksheet ...>`; the schema uses `<sheet ...>`, so it compared
  // an EMPTY described set against the inventory and passed unconditionally — a gate that
  // could not fail, added as a safety net. Hence the non-empty assertion below: a gate
  // must prove it had something to judge before its verdict means anything.
  const context = { console, DOMParser, XMLHttpRequest:xmlRequestFor(schemaSource) };
  vm.createContext(context);
  vm.runInContext(readJavascript('utils.js'), context);
  vm.runInContext(readJavascript('qa.js'), context);

  const error = vm.runInContext('_qaParseSchema().error || ""', context);
  assert.strictEqual(error, '', 'the shipped profile must parse cleanly: ' + error);

  const described = JSON.parse(vm.runInContext(
    'JSON.stringify((_qaParseSchema().sheets || []).map(sheet => sheet.name))', context));
  assert.ok(described.length > 0,
    'POSITIVE CONTROL: the profile described no sheets, so this gate cannot fail');

  const recognised = JSON.parse(vm.runInContext('JSON.stringify(COBIE_WORKSHEETS)', context))
    .map(name => name.toLowerCase());
  const strays = described.filter(name => !recognised.includes(String(name).toLowerCase()));
  assert.deepStrictEqual(strays, [],
    'the profile describes worksheets the inventory does not recognise: ' + strays.join(', '));
});

// ── A10-A12 added after a real-browser run against the repo's own example workbook.
// The suite above was 9/9 green while the rendered block read "present;1additional
// worksheet wasoutside this profile", repeated the filename on all eight entries, and
// called Instruction — a COBie template sheet — an additional worksheet outside the
// profile. Structure assertions cannot see a sentence. These read the sentence.
function renderedText(context) {
  const html = vm.runInContext('_qaCoverageHtml(_qaCoverage())', context);
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

check('A10 the rendered headline has no missing-space artefacts', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  vm.runInContext(`
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')], Notes:[_row('n')] }) }];`, context);
  const text = renderedText(context);
  assert.ok(text.includes('The active profile describes 1 of 2 recognised COBie worksheets present.'),
    'headline text is wrong or unspaced: ' + text.slice(0, 160));
  assert.ok(text.includes('1 additional worksheet was outside this profile.'),
    'the additional clause is unspaced or malformed: ' + text.slice(0, 200));
  assert.ok(!/\w[;.]\d|\w(?:was|were)outside|\wadditional/.test(text),
    'two words are joined without a space: ' + text.slice(0, 200));
});

check('A11 a COBie template sheet is neither Additional nor Not assessed', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'f.xlsx',
      _workbook:_wb({ Instruction:[_row('guidance')], Facility:[_row('a')] }) }];`);
  assert.strictEqual(cov.additional.length, 0, 'Instruction is COBie, not an outside worksheet');
  assert.strictEqual(cov.notAssessed.length, 0, 'Instruction carries no project data to assess');
  assert.strictEqual(cov.recognisedPresent, 1, 'and it must not inflate the coverage denominator');
});

check('A12 the filename is shown only when more than one workbook is loaded', () => {
  const one = makeContext(); withSchema(one, ['Facility']);
  vm.runInContext(`
    db.facilities = [{ _facility:'T', _facilityIdentifier:'t', _workbookKey:'wb', _fileName:'only.xlsx',
      _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')] }) }];`, one);
  assert.ok(!renderedText(one).includes('only.xlsx'),
    'a single-workbook report should not repeat the filename on every entry');

  const two = makeContext(); withSchema(two, ['Facility']);
  vm.runInContext(`
    db.facilities = [
      { _facility:'A', _facilityIdentifier:'a', _workbookKey:'w1', _fileName:'one.xlsx',
        _workbook:_wb({ Facility:[_row('a')], Job:[_row('x')] }) },
      { _facility:'B', _facilityIdentifier:'b', _workbookKey:'w2', _fileName:'two.xlsx',
        _workbook:_wb({ Facility:[_row('b')], Spare:[_row('y')] }) }];`, two);
  const text = renderedText(two);
  assert.ok(text.includes('one.xlsx') && text.includes('two.xlsx'),
    'with two workbooks the filename is what disambiguates: ' + text.slice(0, 200));
});

// ── A13-A19 follow-up to review of the merged coverage block ──────────────────
// Each arm below pins one behaviour that was wrong, and fails if it is reverted.
const fac = (name, id, key, file, sheets) =>
  `{ _facility:'${name}', _facilityIdentifier:'${id}', _workbookKey:'${key}', _fileName:'${file}', _workbook:_wb(${sheets}) }`;

// A13 an unreadable profile is "unavailable", never "describes 0 of N".
check('A13 a schema parse error suppresses the classification', () => {
  const context = makeContext();
  vm.runInContext(`_qaSchemaCache = { error:'The QA XML could not be loaded.', sheets:[] };
    db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ Facility:[_row('a')], Job:[_row('x')], Notes:[_row('n')] }")}];`, context);
  const cov = JSON.parse(vm.runInContext('JSON.stringify(_qaCoverage())', context));
  assert.strictEqual(cov.unavailable, true, 'coverage must report itself unavailable');
  assert.strictEqual(cov.notAssessed, undefined, 'no worksheet may be classified under a failed profile');
  const text = renderedText(context);
  assert.ok(/unavailable/i.test(text), 'the block must say it is unavailable: ' + text);
  assert.ok(!/describes \d+ of/.test(text) && !/Not assessed/.test(text),
    'a failed profile must not be reported as describing no worksheets: ' + text);
});

// A14 workbooks follow the selected facility, but every workbook of a selected facility stays.
check('A14 coverage is scoped to the selected facilities and keeps all their workbooks', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const setup = `
    db.facilities = [
      ${fac('Alpha', 'a', 'w1', 'a-one.xlsx', "{ Facility:[_row('a')], Job:[_row('x')] }")},
      ${fac('Alpha', 'a', 'w2', 'a-two.xlsx', "{ Facility:[_row('a')], Spare:[_row('y')] }")},
      ${fac('Beta', 'b', 'w3', 'b-one.xlsx', "{ Facility:[_row('b')], Resource:[_row('z')] }")}];`;
  const all = coverage(context, setup);
  assert.strictEqual(all.workbooks, 3, 'with nothing selected every workbook is covered');
  vm.runInContext("sel.facility.add('alpha');", context);
  const scoped = JSON.parse(vm.runInContext('JSON.stringify(_qaCoverage())', context));
  assert.strictEqual(scoped.workbooks, 2, 'both Alpha workbooks stay, Beta goes');
  const names = scoped.notAssessed.map(e => e.sheet).sort();
  assert.deepStrictEqual(names, ['Job', 'Spare'], 'Beta\'s Resource sheet must not appear: ' + names);
});

// A15 sheet matching follows readSheet(): case-insensitive, NOT trimmed.
check('A15 a tab the parser would not load is never reported as covered', () => {
  const context = makeContext();
  withSchema(context, ['Component', 'Space']);
  const cov = coverage(context, `
    db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ 'Component ':[_row('x')], SPACE:[_row('s')] }")}];`);
  // readSheet('Component') does not find 'Component ', so parseCOBieInto never loads it.
  assert.strictEqual(vm.runInContext("readSheet(db.facilities[0]._workbook, 'Component').length", context), 0,
    'precondition: the parser ignores a tab named with a trailing space');
  assert.strictEqual(cov.covered, 1, 'only SPACE (case-insensitive) is loaded: ' + JSON.stringify(cov));
  assert.ok(!cov.empty.some(e => e.sheet === 'Component'), 'an ignored tab cannot be "present, empty"');
  assert.ok(cov.additional.some(e => e.sheet === 'Component'),
    'an unloaded tab is outside the profile: ' + JSON.stringify(cov.additional));
});

// A16 the per-workbook counts are cached, and invalidated when the workbook changes.
check('A16 repeated coverage does not re-read sheets; a changed workbook is re-read', () => {
  const context = makeContext();
  withSchema(context, ['Facility', 'Space']);
  vm.runInContext(`
    var _reads = 0;
    var _origRead = readSheet;
    readSheet = function (wb, name) { _reads += 1; return _origRead(wb, name); };
    db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ Facility:[_row('a')], Space:[], Notes:[_row('n')] }")}];`, context);
  const reads = () => vm.runInContext('_reads', context);
  vm.runInContext('_qaCoverage();', context);
  const first = reads();
  assert.ok(first > 0, 'POSITIVE CONTROL: the first pass must read sheets, or this test counts nothing');
  vm.runInContext('_qaCoverageHtml(_qaCoverage()); _qaCoverage(); _qaCoverage();', context);
  assert.strictEqual(reads(), first, 'later renders re-read the workbook');
  // A save reopens the file: the workbook object is replaced.
  vm.runInContext("db.facilities[0]._workbook = _wb({ Facility:[_row('a')], Space:[_row('s')] });", context);
  const cov = JSON.parse(vm.runInContext('JSON.stringify(_qaCoverage())', context));
  assert.ok(reads() > first, 'a replaced workbook must be re-read');
  assert.deepStrictEqual(cov.empty, [], 'and the stale "Space is empty" must be gone');
  // A sheet resized in place (new !ref) also invalidates.
  const before = reads();
  vm.runInContext("db.facilities[0]._workbook.Sheets.Space['!ref'] = 'A1:B9';", context);
  vm.runInContext('_qaCoverage();', context);
  assert.ok(reads() > before, 'a changed sheet range must invalidate the cached counts');
});

// A17 additional tabs have no known header convention, so no row count.
check('A17 an additional worksheet is listed without a row count', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  const cov = coverage(context, `
    db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ Facility:[_row('a')], Notes:[] }")}];`);
  assert.strictEqual(cov.additional.length, 1);
  assert.strictEqual(cov.additional[0].rows, undefined, 'no row count may be computed for a Notes tab');
  const text = renderedText(context);
  assert.ok(/Notes(?! —)/.test(text) && !/Notes — \d/.test(text) && !/0 rows/.test(text),
    'the Notes tab must not be shown with a row count: ' + text);
  // A COBie sheet still gets its count.
  const notAssessed = coverage(context, `
    db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ Facility:[_row('a')], Job:[_row('x'), _row('y')] }")}];`);
  assert.ok(/Job — 2 rows/.test(renderedText(context)), 'recognised sheets keep their counts');
  assert.strictEqual(notAssessed.notAssessed[0].rows, 2);
});

// A18 the PDF cover's Workbooks field agrees with the coverage totals.
function pdfCover(context, setup) {
  vm.runInContext(`
    ${setup}
    qaRuleResults = []; qaFindings = []; qaAllFindings = [];
    idx.facilityNames = db.facilities.map(r => r._facility);
  `, context);
  return vm.runInContext("_qaPdfReportHtml('')", context);
}
check('A18 the PDF Workbooks field lists every workbook that coverage counts', () => {
  const context = makeContext();
  vm.runInContext('globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });', context);
  withSchema(context, ['Facility']);
  const html = pdfCover(context, `
    db.facilities = [
      ${fac('Alpha', 'a', 'w1', 'a-one.xlsx', "{ Facility:[_row('a')] }")},
      ${fac('Alpha', 'a', 'w2', 'a-two.xlsx', "{ Facility:[_row('a')] }")},
      ${fac('Beta', 'b', 'w3', 'b-one.xlsx', "{ Facility:[_row('b')] }")}];`);
  const field = /Workbooks<\/span><br>([^<]*)</.exec(html);
  assert.ok(field, 'POSITIVE CONTROL: the cover must contain a Workbooks field');
  assert.strictEqual(field[1], 'a-one.xlsx, a-two.xlsx, b-one.xlsx');
  vm.runInContext("sel.facility.add('alpha');", context);
  const scoped = pdfCover(context, '');
  assert.strictEqual(/Workbooks<\/span><br>([^<]*)</.exec(scoped)[1], 'a-one.xlsx, a-two.xlsx',
    'the facility filter and the de-duplication are kept');
});

// A19 the label says what the counts describe.
check('A19 the block states that it describes the workbooks as loaded', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  vm.runInContext(`db.facilities = [${fac('T', 't', 'wb', 'f.xlsx', "{ Facility:[_row('a')] }")}];`, context);
  assert.ok(/as loaded, not unsaved edits/.test(renderedText(context)),
    'pending model edits are not tracked, so the block must say so');
});

// A20 scoping coverage by facility must still leave every scored value alone.
check('A20 a facility-scoped coverage render changes no scored value', () => {
  const context = makeContext();
  withSchema(context, ['Facility']);
  vm.runInContext(`
    db.facilities = [${fac('Alpha', 'a', 'w1', 'a.xlsx', "{ Facility:[_row('a')], Notes:[] }")}];
    sel.facility.add('alpha');
    qaRuleResults = [{ check:'c1', pass:3, fail:1, sheet:'Facility', column:'Name' }];
    qaAllRuleResults = qaRuleResults.slice(); qaFindings = [{ sev:'error' }]; qaAllFindings = qaFindings.slice();`, context);
  const snap = () => vm.runInContext(`JSON.stringify({ tally:_qaScoreTally(qaRuleResults),
    rules:qaRuleResults, findings:qaFindings, allRules:qaAllRuleResults, allFindings:qaAllFindings })`, context);
  const before = snap();
  vm.runInContext('_qaCoverageHtml(_qaCoverage());', context);
  assert.strictEqual(snap(), before);
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n  ${results.length - failed.length}/${results.length} coverage checks passed`);
if (failed.length) { process.exitCode = 1; }
else { console.log('Coverage and scope checks passed.'); }
