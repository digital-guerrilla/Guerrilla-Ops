// Loads the example workbook through the real parser and runs the real QA audit,
// so tests can measure what the application measures. The workbook reader is the
// SheetJS build already inlined in the committed release, so no download is needed.
const crypto = require('crypto');
const fs = require('fs');
const { DOMParser } = require('linkedom');
const { createContext, loadModules, path, root, vm, xmlRequestFor, readText } = require('./test-helpers');

const examplePath = path.join(root, '..', 'examples', 'EECC-DGC-ZZ-ZZ-LIE-Z-00001.xlsx');

function sheetJs() {
  const release = readText(path.join(root, '..', 'release', 'Guerrilla-Ops-Airgapped.html'));
  const library = [...release.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
    .sort((a, b) => b.length - a.length)[0];
  const sandbox = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, setTimeout };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // The inlined bundle ends with browser-only libraries that need a document; the
  // spreadsheet reader is defined before that point.
  try { vm.runInContext(library, sandbox); } catch (error) { if (!/document/.test(error.message)) throw error; }
  if (!sandbox.XLSX?.read) throw new Error('the inlined SheetJS reader could not be found in the release');
  return sandbox.XLSX;
}

function loadExample(schemaPath = path.join(root, 'specification', 'guerrilla-ops-schema.xml')) {
  const context = createContext();
  context.XLSX = sheetJs();
  Object.assign(context, {
    DOMParser,
    XMLHttpRequest: xmlRequestFor(readText(schemaPath)),
    lastCounts: {},
    selectedCategoryLevels: {},
    esc: value => String(value ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`),
  });
  loadModules(context, ['state.js', 'utils.js', 'filters.js', 'cobie-parser.js', 'qa.js']);
  const workbook = context.XLSX.read(new Uint8Array(fs.readFileSync(examplePath)),
    { type: 'array', cellDates: true, cellStyles: true, bookVBA: true });
  vm.runInContext(`
    parseCOBieInto(${'__workbook'}, 'EECC-DGC-ZZ-ZZ-LIE-Z-00001.xlsx', null, null);
    canonicalizeLoadedFacilities();
    buildIdx();
  `.replace('__workbook', 'globalThis.__workbook'), Object.assign(context, { __workbook: workbook }));
  return context;
}

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// What the application shows for a stage: checks, findings, severities, tally, score.
function measureStages(context) {
  return JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const steps = _qaRunSteps('operation');
    let step = steps.next();
    while (!step.done) step = steps.next();
    qaAllFindings = step.value;
    qaAllRuleResults = qaRuleResults;
    const out = {};
    for (const stage of ['design', 'construction', 'operation']) {
      qaSelectedStage = stage;
      _qaApplyStageFilter();
      const severities = {};
      qaFindings.forEach(finding => { severities[finding.sev] = (severities[finding.sev] || 0) + 1; });
      const tally = _qaScoreTally(qaRuleResults);
      out[stage] = {
        checks: qaRuleResults.length,
        findings: qaFindings.length,
        severities,
        tally,
        score: _qaTallyScore(tally),
        findingsSha256: __sha(qaFindings.map(item => [item.check, item.sev, item.entityName, item.facility, item.detail].join('|')).join('\\n')),
        checksSha256: __sha(JSON.stringify(qaRuleResults.map(r => [r.check, r.sheet, r.column, r.stage, r.pass, r.fail]))),
      };
    }
    return out;
  })())`, Object.assign(context, { __sha: sha })));
}

module.exports = { loadExample, measureStages, examplePath };
