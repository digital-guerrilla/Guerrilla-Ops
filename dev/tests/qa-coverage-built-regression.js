// Coverage and scope — checks against the BUILT release files.
//
// The source suite (qa-coverage-regression.js) reads dev/javascript. The release is
// that source after a minifier, and the minifier is where whitespace inside nested
// template literals used to be lost ("present.1additional worksheet wasoutside this
// profile"), so a source-only check cannot see it. This suite loads the checked-in
// index.html and both release files, runs their own bundled code, and reads the
// sentences the user would read.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require('linkedom');

const repoRoot = path.resolve(__dirname, '..', '..');
const BUILDS = ['index.html', 'release/Guerrilla-Ops.html', 'release/Guerrilla-Ops-Airgapped.html'];

// Everything the page touches at load time answers; nothing is rendered.
function anything() {
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      if (key === 'length') return 0;
      if (key === 'then') return undefined;
      return anything();
    },
    apply() { return anything(); },
    construct() { return anything(); },
    set() { return true; },
  });
}

function loadBuild(relativePath) {
  const html = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const context = {
    console, DOMParser, document: anything(), window: anything(), navigator: anything(),
    localStorage: anything(), sessionStorage: anything(), location: anything(),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), setTimeout: () => 0,
    addEventListener() {}, requestAnimationFrame: () => 0, matchMedia: () => anything(),
  };
  context.globalThis = context;
  vm.createContext(context);
  scripts.forEach(script => vm.runInContext(script, context));
  return { html, context };
}

function run(context, code) { return vm.runInContext(code, context); }

// Real SheetJS where the build carries it (Airgapped); a stand-in for the others.
function installWorkbooks(context) {
  const real = run(context, "typeof XLSX !== 'undefined' && !!(XLSX.utils && XLSX.utils.aoa_to_sheet)");
  if (!real) {
    run(context, `XLSX = { utils: { sheet_to_json: sheet => (sheet && sheet.__rows) || [] } };`);
  }
  context.__real = real;
  context.__sheet = (rows, aoa) => (real
    ? (aoa ? run(context, 'XLSX').utils.aoa_to_sheet(aoa) : run(context, 'XLSX').utils.json_to_sheet(rows))
    : { __rows: aoa ? [] : rows });
  context.__wb = sheets => {
    const wb = { SheetNames: Object.keys(sheets), Sheets: {} };
    Object.entries(sheets).forEach(([name, spec]) => { wb.Sheets[name] = context.__sheet(spec.rows, spec.aoa); });
    return wb;
  };
  return real;
}

function facilityRow(context, name, id, key, file, sheets) {
  return { _facility: name, _facilityIdentifier: id, _workbookKey: key, _fileName: file, _workbook: context.__wb(sheets) };
}

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fails = [];
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (err) { fails.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

BUILDS.forEach(build => {
  const { html, context } = loadBuild(build);
  const real = installWorkbooks(context);
  console.log(`\n${build} (${real ? 'real SheetJS' : 'stand-in sheets'})`);

  const two = [
    facilityRow(context, 'Tower', 'tower', 'w1', 'one.xlsx', {
      Facility: { rows: [{ Name: 'Tower' }] },
      Space: { rows: [{ Name: 's1' }, { Name: 's2' }] },
      Job: { rows: [{ Name: 'j1' }] },
    }),
    facilityRow(context, 'Tower', 'tower', 'w2', 'two.xlsx', {
      Facility: { rows: [{ Name: 'Tower' }] },
      Notes: { rows: [], aoa: [['a note, not a header']] },
      Revisions: { rows: [{ Rev: 'A' }] },
    }),
  ];
  context.__two = two;
  const render = () => text(run(context, '_qaCoverageHtml(_qaCoverage())'));
  run(context, 'db.facilities = __two;');
  const rendered = render();

  check('the built headline and additional clause are spaced', () => {
    assert.ok(rendered.includes('The active profile describes 3 of 4 recognised COBie worksheets present. '
      + '2 additional worksheets were outside this profile. Counts describe the workbook files as loaded, '
      + 'not unsaved edits. Does not affect QA score.'), 'sentence is wrong or unspaced: ' + rendered);
    assert.ok(!/\w[;.]\d|\w(?:was|were)outside|\wadditional|profile\w/.test(rendered),
      'words are joined without a space: ' + rendered);
  });

  check('the built singular clause reads "1 additional worksheet was outside this profile"', () => {
    run(context, 'db.facilities = [__two[1]];');
    const bothAdditional = render();
    // Notes and Revisions are both additional in the second workbook.
    run(context, "db.facilities = [Object.assign({}, __two[1], { _workbook: __wb({ Facility:{ rows:[{ Name:'T' }] }, Notes:{ rows:[], aoa:[['x']] } }) })];");
    const one = render();
    run(context, 'db.facilities = __two;');
    assert.ok(bothAdditional.includes('2 additional worksheets were outside this profile.'), bothAdditional);
    assert.ok(one.includes('present. 1 additional worksheet was outside this profile. '), one);
  });

  check('the built list spaces filenames and keeps counts only on COBie sheets', () => {
    assert.ok(rendered.includes('Job (one.xlsx) — 1 row'), 'filename spacing / row count: ' + rendered);
    assert.ok(/Additional worksheets outside this COBie profile : Notes \(two\.xlsx\); Revisions \(two\.xlsx\)/.test(rendered),
      'additional entries must read "Notes (two.xlsx); Revisions (two.xlsx)" with no row count: ' + rendered);
    assert.ok(!/\w\(/.test(rendered), 'a filename is glued to its sheet name: ' + rendered);
  });

  check('the built PDF cover lists every workbook and carries the coverage block', () => {
    run(context, `qaRuleResults = []; qaFindings = []; qaAllFindings = [];
      idx.facilityNames = ['Tower']; sel.facility.clear();`);
    const cover = run(context, "_qaPdfReportHtml('')");
    const field = /Workbooks<\/span><br>([^<]*)</.exec(cover);
    assert.ok(field, 'POSITIVE CONTROL: no Workbooks field in the built cover');
    assert.strictEqual(field[1], 'one.xlsx, two.xlsx');
    assert.ok(text(cover).includes('present. 2 additional worksheets were outside this profile.'),
      'the PDF cover shares the unspaced sentence');
  });

  check('a failed profile reads "unavailable" in the built code', () => {
    run(context, "var __keep = _qaSchemaCache; _qaSchemaCache = { error:'The QA XML could not be loaded.', sheets:[] };");
    const failed = render();
    run(context, '_qaSchemaCache = __keep;');
    assert.ok(/unavailable/.test(failed) && !/describes \d+ of/.test(failed), failed);
  });

  check('other nested templates keep the spaces the source gives them', () => {
    // Each of these lost its space in the built file before the fix.
    [
      ["qa-scope\">Sheet: ${", 'Sheet: label'],
      ['</b> <i>${row.advisory}</i>', 'graph count badges'],
      ['<button class="xbtn" onclick="exportQAPdf()">', 'Export PDF button attributes'],
      ['Facility <select class="form-select', 'new-entity facility label'],
      ['<span class="cc-desc"> : ${', 'classification description'],
    ].forEach(([needle, what]) => assert.ok(html.includes(needle), `${what}: built file lacks ${JSON.stringify(needle)}`));
  });
});

console.log(fails.length ? `\n${fails.length} built-release check(s) failed` : '\nBuilt-release coverage checks passed.');
if (fails.length) process.exitCode = 1;
