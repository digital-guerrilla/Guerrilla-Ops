// The example workbook must keep producing the same checks, findings, severities,
// counts and scores. Cause breakdowns are a reading aid and may not move any of them.
// Regenerate the fixture only for a deliberate rule change: QA_BASELINE_CAPTURE=1.
const assert = require('assert');
const fs = require('fs');
const { path, root } = require('./test-helpers');
const { loadExample, measureStages } = require('./qa-example');

const fixturePath = path.join(__dirname, 'fixtures', 'qa-example-baseline.json');
const measured = measureStages(loadExample());

if (process.env.QA_BASELINE_CAPTURE) {
  fs.writeFileSync(fixturePath, JSON.stringify(measured, null, 2) + '\n');
  console.log('QA example baseline written');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
for (const stage of ['design', 'construction', 'operation']) {
  assert.deepStrictEqual(measured[stage], baseline[stage], `${stage}: checks, findings, severities or scores changed`);
}
assert.strictEqual(baseline.design.findings, 318);
assert.strictEqual(baseline.construction.findings, 35033);
assert.strictEqual(baseline.operation.findings, 35080);
console.log('QA example baseline checks passed');
