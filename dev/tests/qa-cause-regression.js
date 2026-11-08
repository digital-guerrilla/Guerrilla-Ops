// Causes explain why a finding failed. They come from the XML profile, never change a
// rule, severity, count or score, and unsupported cause configuration is reported.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require('linkedom');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'javascript');
const schemaSource = fs.readFileSync(path.join(root, 'specification', 'guerrilla-ops-schema.xml'), 'utf8');

const facility = 'Facility A';
const row = fields => ({ _facility:facility, ...fields });
const fixtureDb = () => ({
  contacts:[row({ Email:'a@example.com', CreatedBy:'a@example.com', Category:'Owner' })],
  facilities:[row({ Name:facility, CreatedBy:'a@example.com' })],
  floors:[], spaces:[], zones:[],
  types:[
    row({ Name:'Close', Category:'Pr_20_31: Different wording', CreatedBy:'a@example.com' }),
    row({ Name:'Missing', Category:'Zz_99: Nothing like it', CreatedBy:'a@example.com' }),
    row({ Name:'NotApplicable', Category:'n/a', CreatedBy:'a@example.com' }),
    row({ Name:'Empty', Category:'', CreatedBy:'a@example.com' }),
    row({ Name:'Fine', Category:'Pr_20_31: Agreed wording', CreatedBy:'a@example.com' }),
  ],
  components:[
    row({ Name:'C1', TypeName:'Fine', InstallationDate:'01/02/25', WarrantyStartDate:'n/a' }),
    row({ Name:'C2', TypeName:'Fine', InstallationDate:'02/03/25', WarrantyStartDate:'' }),
    row({ Name:'C3', TypeName:'Fine', InstallationDate:'2025-02-03', WarrantyStartDate:'' }),
    row({ Name:'C4', TypeName:'Fine', InstallationDate:'2025-02-03T00:00:00', WarrantyStartDate:'' }),
  ],
  systems:[], documents:[], attributes:[], coordinates:[],
  picklists:[row({ 'Category-Product':'Pr_20_31: Agreed wording' })],
});

// A fresh application context that loads the given profile text.
function contextFor(profile) {
  class SchemaRequest {
    open() {}
    send() { this.status = 200; this.responseText = profile; }
  }
  const context = {
    console, DOMParser, XMLHttpRequest:SchemaRequest, db:fixtureDb(), idx:{},
    sel:{ facility:new Set() }, searchQuery:'', collapseCounter:0, pendingGroups:{},
  };
  vm.createContext(context);
  ['utils.js', 'qa.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), context, { filename:file });
  });
  return context;
}
const runIn = (context, source) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${source} })())`, context));

// Edits the profile text; every edit must match exactly once so a typo cannot pass silently.
function edited(...pairs) {
  return pairs.reduce((text, [from, to]) => {
    assert.strictEqual(text.split(from).length - 1, 1, `profile edit must match once: ${from}`);
    return text.replace(from, to);
  }, schemaSource);
}

const AUDIT = `
  qaSelectedStage = 'operation';
  qaFindings = runQA();
`;
// Expands every collapsed level, as the page does on click, and returns all the markup.
const EXPAND_ALL = `
  const expand = html => {
    let all = html;
    const seen = new Set();
    for (let pending = true; pending;) {
      pending = false;
      for (const [, cid] of all.matchAll(/data-cid="(col_\\d+)"/g)) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        all += qaPendingGroupBody(pendingGroups[cid]);
        pending = true;
      }
    }
    return all;
  };
`;

// ---- Profile: causes are defined once, and descriptions are untouched by nesting.
const context = contextFor(schemaSource);
const parsed = runIn(context, `
  const schema = _qaParseSchema();
  return {
    error:schema.error,
    shared:schema.causes[''],
    reference:schema.causes[_qaCauseOwnerKey('rule:Reference')],
    isoDate:schema.causes['format:isoDate'],
    ruleDescriptions:schema.ruleDefinitions,
    formatDescriptions:schema.formatDescriptions,
    diagnostics:schema.sheets.flatMap(sheet => sheet.references
      .filter(reference => reference.causeDiagnostics.length)
      .map(reference => sheet.name + '.' + reference.column + ':' + reference.causeDiagnostics.join('|'))),
  };
`);
assert.strictEqual(parsed.error, '', 'the profile must parse without errors');
assert.strictEqual(parsed.shared.blank, 'Blank');
assert.strictEqual(parsed.shared['not-applicable'], 'Entered as "n/a"');
assert.strictEqual(parsed.reference['not-found'], 'Not found in the referenced column');
assert(!/equivalent|same/.test(parsed.reference['prefix-match']),
  'the prefix label must state what was measured, not imply equivalence');
assert.strictEqual(parsed.isoDate['invalid-format'], 'Invalid date format');
assert(parsed.diagnostics.length > 0 && parsed.diagnostics.every(entry => entry.endsWith(':colon-prefix')),
  'the colon-prefix diagnostic must be enabled by the profile on the classification references');

// Descriptions read exactly as before the causes were nested inside their rules and formats.
assert.deepStrictEqual(parsed.ruleDescriptions, {
  notnull:'Must have a text value that is not "n/a" or empty.',
  notempty:'Must have a text value; "n/a" is acceptable.',
  unique:'Must be unique within the scope of the worksheet.',
  reference:'Must match the referenced Name or key column in another worksheet.',
  oneandonlyonefacilityfound:'Only one Facility row is allowed.',
  validnumber:'Must represent a valid number; "n/a" is not acceptable.',
  validnumberorna:'If text is provided, it must represent a valid number or "n/a".',
  atleastonerowpresent:'The worksheet must contain at least one row.',
  zeroorgreaterorna:'If text is provided, it must represent zero or a positive number, or "n/a".',
  zeroorgreater:'If text is provided, it must represent zero or a positive number.',
});
assert.deepStrictEqual(parsed.formatDescriptions, {
  email:'Must have a valid email address.',
  isoDate:'Must use ISO date format YYYY-MM-DD.',
  isoDateTime:'Must use an ISO date and time with an optional timezone.',
  GUID:'Must be a valid GUID.',
});

// Nested <causes> must not leak into a description, whether the description is a child
// element or the rule's own text, even when a cause carries text of its own.
const leaky = runIn(contextFor(edited(
  ['<cause id="not-found" label="Not found in the referenced column"/>',
    '<cause id="not-found" label="Not found in the referenced column">LEAK</cause>'],
  ['<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.</rule>',
    '<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.' +
    '<causes><cause id="blank" label="Blank (rule)">LEAK</cause></causes></rule>'],
  ['<description>Must use ISO date format YYYY-MM-DD.</description>',
    '<causes><cause id="invalid-format" label="Invalid date format">LEAK</cause></causes>' +
    '<description>Must use ISO date format YYYY-MM-DD.</description>'],
)), `
  const schema = _qaParseSchema();
  return { error:schema.error, rules:schema.ruleDefinitions, formats:schema.formatDescriptions, notNullBlank:schema.causes[_qaCauseOwnerKey('rule:NotNull')]?.blank };
`);
assert.strictEqual(leaky.error, '');
assert.deepStrictEqual(leaky.rules, parsed.ruleDescriptions, 'nested causes must not change a rule description');
assert.deepStrictEqual(leaky.formats, parsed.formatDescriptions, 'nested causes must not change a format description');
assert.strictEqual(leaky.notNullBlank, 'Blank (rule)', 'a rule that carries its own text can still define causes');

// ---- Findings: exactly one spec-defined cause each, with the written pattern as a sub-level.
const audit = runIn(context, `${AUDIT}
  return {
    total:qaFindings.length,
    malformed:qaFindings.filter(item => typeof item.causeId !== 'string' || !item.causeId || !item.causeLabel
      || 'cause' in item || 'causes' in item).map(item => item.check),
    category:Object.fromEntries(qaFindings.filter(item => item.check === 'Type.Category.Reference')
      .map(item => [item.entityName, [item.causeId, item.causeLabel, item.sev]])),
    dates:qaFindings.filter(item => item.check === 'Component.InstallationDate.Format')
      .map(item => [item.entityName, item.causeId, item.causeLabel, item.valuePattern]),
    checks:[...new Set(qaFindings.map(item => item.check))].sort(),
    results:qaRuleResults.length,
  };
`);
assert(audit.total > 0, 'the fixture must produce findings');
assert.deepStrictEqual(audit.malformed, [], 'every finding must carry exactly one cause id and label');
assert.deepStrictEqual(audit.category.Close, ['prefix-match', parsed.reference['prefix-match'], 'error'],
  'a prefix match is still a failed reference and keeps the check severity');
assert.deepStrictEqual(audit.category.Missing, ['not-found', parsed.reference['not-found'], 'error']);
assert.deepStrictEqual(audit.category.NotApplicable, ['not-applicable', 'Entered as "n/a"', 'error']);
assert.deepStrictEqual(audit.category.Empty[0], 'blank');
assert.deepStrictEqual(audit.dates, [
  ['C1', 'invalid-format', 'Invalid date and time format', '##/##/##'],
  ['C2', 'invalid-format', 'Invalid date and time format', '##/##/##'],
  ['C3', 'invalid-format', 'Invalid date and time format', '####-##-##'],
]);

// ---- Causes add no checks: the same findings and results with the diagnostic enabled or not.
const withoutDiagnostics = contextFor(schemaSource.replace(/ causeDiagnostics="colon-prefix"/g, ''));
assert.notStrictEqual(schemaSource.length, schemaSource.replace(/ causeDiagnostics="colon-prefix"/g, '').length);
const plain = runIn(withoutDiagnostics, `${AUDIT}
  return {
    total:qaFindings.length,
    close:qaFindings.filter(item => item.check === 'Type.Category.Reference' && item.entityName === 'Close')
      .map(item => [item.causeId, item.sev]),
    results:qaRuleResults.length,
    checks:[...new Set(qaFindings.map(item => item.check))].sort(),
  };
`);
assert.deepStrictEqual(plain.close, [['not-found', 'error']],
  'the colon-prefix diagnostic must run only where the profile enables it');
assert.strictEqual(plain.total, audit.total, 'a diagnostic must not change the number of findings');
assert.strictEqual(plain.results, audit.results, 'a diagnostic must not add scored checks');
assert.deepStrictEqual(plain.checks, audit.checks, 'a diagnostic must not add checks');

// ---- XML-defined labels reach the page and the XLSX report.
const custom = contextFor(edited(
  ['label="Invalid date and time format"', 'label="Datum ongeldig"'],
  ['label="Not found in the referenced column"', 'label="Niet gevonden"'],
  ['<cause id="other" label="Other"/>', '<cause id="other" label="Overig"/>'],
));
const shown = runIn(custom, `${AUDIT}
  ${EXPAND_ALL}
  const dates = qaFindings.filter(item => item.check === 'Component.InstallationDate.Format');
  const refs = qaFindings.filter(item => item.check === 'Type.Category.Reference');
  const report = _qaReportRows();
  return {
    dates:expand(_qaCauseBlocks(dates, 1)),
    refs:expand(_qaCauseBlocks(refs, 1)),
    reportCauses:report.filter(item => item.Check === (QA_CHECKS['Type.Category.Reference'] || {}).label || /Reference/.test(item.Check))
      .map(item => [item.Item, item.Cause]),
    dateCauses:report.filter(item => /InstallationDate/.test(item.Check)).map(item => item.Cause),
    keys:Object.keys(report[0]),
    other:_qaCauseLabel(_qaParseSchema(), QA_CAUSE.OTHER),
  };
`);
assert(shown.dates.includes('Datum ongeldig'), 'the cause level must show the profile wording');
assert(shown.dates.includes('Written like ##/##/##') && shown.dates.includes('Written like ####-##-##'),
  'the written pattern must appear as a level under the cause');
assert(shown.dates.indexOf('Datum ongeldig') < shown.dates.indexOf('Written like ##/##/##'),
  'the written pattern must sit below its cause');
assert(shown.refs.includes('Niet gevonden'), 'the profile wording must reach the cause headings');
assert(!shown.dates.includes('Invalid date and time format'), 'the page must not hard-code wording');
assert(shown.dateCauses.length === 3 && shown.dateCauses.every(label => label === 'Datum ongeldig'),
  'the XLSX report must carry the profile wording');
assert(shown.reportCauses.some(([item, cause]) => item === 'Missing' && cause === 'Niet gevonden'));
assert.deepStrictEqual(shown.keys, ['Stage', 'Severity', 'Check', 'Cause', 'Sheet', 'Item', 'Facility', 'Detail']);
assert.strictEqual(shown.other, 'Overig', 'the fallback cause is also defined by the profile');

// Grouping with the real wording: counts and the single-cause note.
const grouped = runIn(context, `${AUDIT}
  ${EXPAND_ALL}
  const refs = qaFindings.filter(item => item.check === 'Type.Category.Reference');
  const single = qaFindings.filter(item => item.check === 'Component.InstallationDate.Format');
  return {
    refs:_qaCauseGroups(refs).map(group => [group.key, group.items.length]),
    singleCause:_qaCauseBlocks(single, 1),
    shapes:_qaShapeGroups(single).map(group => [group.label, group.items.length, group.distinct]),
    hostile:_qaCauseBlocks([
      { causeId:'x', causeLabel:'<b>x</b>', valuePattern:'<i>', value:'<img src=x onerror=alert(1)>' },
      { causeId:'x', causeLabel:'<b>x</b>', valuePattern:'<i>', value:'<img src=x onerror=alert(1)>' },
    ], 1),
    many:_qaShapeGroups(Array.from({ length:QA_SHAPE_GROUP_LIMIT + 3 }, (_, index) =>
      ({ causeId:'x', valuePattern:'p' + index, value:String(index) }))).map(group => [group.label, group.items.length]),
  };
`);
assert.deepStrictEqual(grouped.refs.map(([key]) => key).sort(), ['blank', 'not-applicable', 'not-found', 'prefix-match']);
assert(grouped.singleCause.includes('All 3: Invalid date and time format'), 'one cause shows a single line, not a level');
assert.deepStrictEqual(grouped.shapes, [['Written like ##/##/##', 2, 2], ['Written like ####-##-##', 1, 1]]);
assert(!grouped.hostile.includes('<img') && !grouped.hostile.includes('<b>x'), 'values and labels must be escaped');
assert.strictEqual(grouped.many.length, 8, 'the pattern list must stay readable');
assert.strictEqual(grouped.many.reduce((total, [, count]) => total + count, 0), 11, 'folding must not lose a finding');
assert.strictEqual(grouped.many[7][0], '4 other patterns');

// ---- Findings rebuilt after an edit agree with the full audit.
const revalidated = runIn(context, `
  const out = {};
  ['Close', 'Missing', 'NotApplicable'].forEach(name => {
    out[name] = _qaValidateEntityFields('type', name, 'Facility A', ['Category'], 'operation')
      .filter(item => item.check === 'Type.Category.Reference').map(item => [item.causeId, item.causeLabel]);
  });
  return out;
`);
['Close', 'Missing', 'NotApplicable'].forEach(name => {
  assert.deepStrictEqual(revalidated[name], [audit.category[name].slice(0, 2)], `${name}: revalidation must agree`);
});

// ---- Unsupported cause configuration is reported, never skipped.
const unsupported = [
  ['an unknown diagnostic', edited(['targetColumn="Category-Product" required="true" causeDiagnostics="colon-prefix"',
    'targetColumn="Category-Product" required="true" causeDiagnostics="colon-prefixx"']),
    /unsupported causeDiagnostics: Type\.Category:colon-prefixx/],
  ['a cause the code returns but the profile lacks', edited(['<cause id="prefix-match" label="Text before &quot;:&quot; matches a listed value, the rest differs"/>', '']),
    /the Reference rule must define "prefix-match"/],
  ['a missing shared cause', edited(['<cause id="other" label="Other"/>', '']),
    /the shared causes must define "other"/],
  ['a duplicate cause id', edited(['<cause id="blank" label="Blank"/>', '<cause id="blank" label="Blank"/><cause id="blank" label="Again"/>']),
    /causes defines "blank" twice/],
  ['a cause without a label', edited(['<cause id="blank" label="Blank"/>', '<cause id="blank"/>']),
    /causes has a cause without an id or label/],
  ['causes on a rule with no description', edited(
    ['<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.</rule>',
      '<rule name="NotNull" criticality="warning"><causes><cause id="blank" label="Blank"/></causes></rule>']),
    /rule NotNull defines causes but has no description/],
];
unsupported.forEach(([name, profile, expected]) => {
  const result = runIn(contextFor(profile), `${AUDIT}
    return { error:_qaParseSchema().error, checks:qaFindings.map(item => item.check), results:qaRuleResults.map(item => item.check) };
  `);
  assert(expected.test(result.error), `${name} must be named in the profile error: ${result.error}`);
  assert(/No rules were applied/.test(result.error), `${name} must stop the audit instead of falling back`);
  assert.deepStrictEqual(result.checks, ['schema-missing'], `${name} must surface as the schema error finding`);
});
assert.throws(() => vm.runInContext(`_qaCauseLabel(_qaParseSchema(), 'made-up')`, context),
  /"made-up" is not defined in the XML profile/, 'a cause id the profile lacks must fail loudly');

// A rule or format without causes of its own still gets exactly one defined cause.
const fallback = runIn(context, `
  const schema = _qaParseSchema();
  return {
    notNull:_qaCheckDiagnosis('NotNull', 'x'),
    other:_qaFindingCause(schema, _qaCheckDiagnosis('NotEmpty', 'svg-data')),
    noOwner:_qaFindingCause(schema, _qaCheckDiagnosis('Valid', 'Sept 2025')),
    shapes:['01/02/25', '2025-02-03', 'Sept 2025'].map(_qaWrittenShape),
    numbers:['ten', '-2', 'x'].map((value, index) => _qaCheckDiagnosis(['ValidNumber', 'ZeroOrGreater', 'ZeroOrGreater'][index], value).causeId),
    empties:['', 'n/a', '   '].map(value => _qaCheckDiagnosis('Format', value).causeId),
  };
`);
assert.strictEqual(fallback.other.causeId, 'other');
assert.strictEqual(fallback.other.causeLabel, 'Other');
assert.strictEqual(fallback.noOwner.causeLabel, 'Invalid format', 'a check with no owning format uses the shared wording');
assert.deepStrictEqual(fallback.shapes, ['##/##/##', '####-##-##', 'a ####']);
assert.deepStrictEqual(fallback.numbers, ['not-a-number', 'negative-number', 'not-a-number']);
assert.deepStrictEqual(fallback.empties, ['blank', 'not-applicable', 'blank']);

// ---- Rule, format and Reference wording reaches real findings, the page, the export and the
// incremental path. Each owner gets its own blank label so a missing owner shows as "Blank".
const overridden = contextFor(edited(
  ['<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.</rule>',
    '<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.' +
    '<causes><cause id="blank" label="RULE BLANK"/><cause id="not-applicable" label="RULE NA"/></causes></rule>'],
  ['<causes><cause id="invalid-format" label="Invalid date and time format"/></causes>',
    '<causes><cause id="invalid-format" label="Invalid date and time format"/>' +
    '<cause id="blank" label="FORMAT BLANK"/><cause id="not-applicable" label="FORMAT NA"/></causes>'],
  ['<cause id="not-found" label="Not found in the referenced column"/>',
    '<cause id="not-found" label="Not found in the referenced column"/>' +
    '<cause id="blank" label="REFERENCE BLANK"/><cause id="not-applicable" label="REFERENCE NA"/>'],
));
const owned = runIn(overridden, `${AUDIT}
  ${EXPAND_ALL}
  const summarise = list => list.map(item => [item.check, item.entityName, item.causeId, item.causeLabel, item.valuePattern]);
  const wanted = (item, entity, fields) => item.entityName === entity
    && fields.some(field => item.check.includes('.' + field + '.'));
  const cases = [['type', 'Empty', ['Category']], ['type', 'NotApplicable', ['Category']],
    ['component', 'C1', ['WarrantyStartDate', 'InstallationDate']], ['component', 'C2', ['WarrantyStartDate', 'InstallationDate']]];
  const same = cases.map(([type, name, fields]) => {
    const full = summarise(qaFindings.filter(item => wanted(item, name, fields))).sort();
    const incremental = summarise(_qaValidateEntityFields(type, name, 'Facility A', fields, 'operation')).sort();
    return [name, JSON.stringify(full) === JSON.stringify(incremental), full.length];
  });
  const pick = (suffix, causeId) => qaFindings.filter(item => item.check.endsWith(suffix) && item.causeId === causeId);
  const labels = list => [...new Set(list.map(item => item.causeLabel))];
  const html = expand(_qaCauseBlocks(qaFindings.filter(item => item.check === 'Type.Category.Reference'), 1))
    + expand(_qaCauseBlocks(qaFindings.filter(item => item.check === 'Component.WarrantyStartDate.Format'), 1))
    + expand(_qaCauseBlocks(qaFindings.filter(item => item.check === 'Component.WarrantyStartDate.NotNull'), 1));
  const exported = _qaReportRows().map(item => item.Cause);
  return {
    same,
    ruleBlank:labels(pick('.NotNull', 'blank')), ruleNa:labels(pick('.NotNull', 'not-applicable')),
    formatBlank:labels(pick('Date.Format', 'blank')), formatNa:labels(pick('Date.Format', 'not-applicable')),
    referenceBlank:labels(pick('.Reference', 'blank')), referenceNa:labels(pick('.Reference', 'not-applicable')),
    html,
    exported:['RULE BLANK', 'RULE NA', 'FORMAT BLANK', 'FORMAT NA', 'REFERENCE BLANK', 'REFERENCE NA']
      .map(label => [label, exported.filter(cause => cause === label).length]),
    plain:qaFindings.filter(item => /\.NotNull$|\.Reference$|Date\.Format$/.test(item.check) && ['blank', 'not-applicable'].includes(item.causeId)
      && ['Blank', 'Entered as "n/a"'].includes(item.causeLabel)).map(item => item.check + ':' + item.entityName),
  };
`);
assert.deepStrictEqual(owned.ruleBlank, ['RULE BLANK'], 'a NotNull blank override must reach the findings');
assert.deepStrictEqual(owned.ruleNa, ['RULE NA']);
assert.deepStrictEqual(owned.formatBlank, ['FORMAT BLANK'], 'a format blank override must reach Format findings');
assert.deepStrictEqual(owned.formatNa, ['FORMAT NA']);
assert.deepStrictEqual(owned.referenceBlank, ['REFERENCE BLANK'], 'a Reference blank override must reach reference findings');
assert.deepStrictEqual(owned.referenceNa, ['REFERENCE NA']);
['RULE BLANK', 'FORMAT BLANK', 'REFERENCE BLANK', 'REFERENCE NA'].forEach(label => {
  assert(owned.html.includes(label), `${label} must be rendered on the page`);
});
owned.exported.forEach(([label, count]) => assert(count > 0, `${label} must appear in the exported Cause column`));
assert.deepStrictEqual(owned.plain, [], 'no finding may fall back to the shared wording when its owner overrides it');
owned.same.forEach(([name, agrees, count]) => {
  assert(count > 0, `${name}: the full audit must produce findings to compare`);
  assert(agrees, `${name}: the incremental path must give the same causes as the full audit`);
});

// Structural rules own their causes too: Unique, AtLeastOneRowPresent, OneAndOnlyOneFacilityFound.
const structural = contextFor(edited(
  ['<rule name="Unique" criticality="error">Must be unique within the scope of the worksheet.</rule>',
    '<rule name="Unique" criticality="error">Must be unique within the scope of the worksheet.<causes><cause id="repeated-key" label="UNIQUE REPEATED"/></causes></rule>'],
  ['<rule name="OneAndOnlyOneFacilityFound" criticality="error">Only one Facility row is allowed.</rule>',
    '<rule name="OneAndOnlyOneFacilityFound" criticality="error">Only one Facility row is allowed.<causes><cause id="wrong-row-count" label="ONE FACILITY ONLY"/></causes></rule>'],
  ['<rule name="AtLeastOneRowPresent" criticality="error">The worksheet must contain at least one row.</rule>',
    '<rule name="AtLeastOneRowPresent" criticality="error">The worksheet must contain at least one row.<causes><cause id="no-rows" label="NO ROWS PRESENT"/></causes></rule>'],
));
const structuralLabels = runIn(structural, `
  db.contacts.splice(db.contacts.length, 0, { ...db.contacts[0] });
  ${AUDIT}
  const labels = causeId => [...new Set(qaFindings.filter(item => item.causeId === causeId).map(item => item.causeLabel))];
  return { repeated:labels('repeated-key'), rows:labels('no-rows'), count:labels('wrong-row-count') };
`);
assert.deepStrictEqual(structuralLabels.repeated, ['UNIQUE REPEATED']);
assert.deepStrictEqual(structuralLabels.rows, ['NO ROWS PRESENT']);
assert.deepStrictEqual(structuralLabels.count, ['ONE FACILITY ONLY']);

// ---- Names that only exist on Object.prototype are not recognised handlers.
['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach(name => {
  const result = runIn(contextFor(edited(['targetColumn="Category-Product" required="true" causeDiagnostics="colon-prefix"',
    `targetColumn="Category-Product" required="true" causeDiagnostics="${name}"`])), `${AUDIT}
    return { error:_qaParseSchema().error, checks:qaFindings.map(item => item.check), results:qaRuleResults.map(item => item.check) };
  `);
  assert(result.error.includes(`unsupported causeDiagnostics: Type.Category:${name}`), `${name} must be a named schema error: ${result.error}`);
  assert.deepStrictEqual(result.checks, ['schema-missing'], `${name}: no exception and no ordinary rules applied`);
  assert.deepStrictEqual(result.results, ['schema-missing']);
});
{
  const result = runIn(contextFor(schemaSource.replace('<rule name="NotNull|Unique"/>', '<rule name="NotNull|constructor"/>')), `${AUDIT}
    return { error:_qaParseSchema().error, checks:qaFindings.map(item => item.check) };
  `);
  assert(/unsupported checks: constructor/.test(result.error), `a check named after an Object.prototype member must be unsupported: ${result.error}`);
  assert.deepStrictEqual(result.checks, ['schema-missing']);
  const format = runIn(contextFor(schemaSource.replace('<format name="email"/>', '<format name="constructor"/>')), `${AUDIT}
    return { error:_qaParseSchema().error, checks:qaFindings.map(item => item.check) };
  `);
  assert(/unsupported formats: [^;]*constructor/.test(format.error), `a format named after an Object.prototype member must be unknown: ${format.error}`);
  assert.deepStrictEqual(format.checks, ['schema-missing']);
  assert.deepStrictEqual(runIn(context, `return [QA_CAUSE_DIAGNOSTICS, QA_NAMED_CHECK_HANDLERS, QA_RELATION_RULE_HANDLERS]
    .map(registry => Object.getPrototypeOf(registry));`), [null, null, null], 'handler registries must have no prototype');
}

// A check with several causes says how many in its header.
const header = runIn(context, `${AUDIT}
  return {
    several:_qaCheckBlocks(qaFindings.filter(item => item.check === 'Type.Category.Reference')),
    single:_qaCheckBlocks(qaFindings.filter(item => item.check === 'Type.Category.Reference' && item.causeId === 'not-found')),
  };
`);
assert(/<span class="grp-meta">4 causes<\/span>/.test(header.several), 'a check with four causes must read "4 causes"');
assert(!/ causes<\/span>/.test(header.single), 'a check with one cause shows no cause count');

// ---- Prefix measurements.
const prefix = runIn(context, `
  const ref = { causeDiagnostics:['colon-prefix'] };
  const target = new Set(['pr_20: agreed wording', 'plain value']);
  const id = (value, set = target, options = ref) => _qaReferenceDiagnosis(value, set, options).causeId;
  return {
    close:id('Pr_20: Other wording'), noColon:id('Pr_20'), absent:id('Pr_99: Nothing'), plain:id('plain'),
    emptyPrefix:id(': first', new Set([': second'])), spacePrefix:id('  : first', new Set(['  : second'])),
    off:id('Pr_20: Other wording', target, {}), blank:id(''), na:id('N/A'),
  };
`);
assert.deepStrictEqual(prefix, {
  close:'prefix-match', noColon:'not-found', absent:'not-found', plain:'not-found',
  emptyPrefix:'not-found', spacePrefix:'not-found', off:'not-found', blank:'blank', na:'not-applicable',
});

// ---- A rule's own causes follow its name case-insensitively, as its description and
// severity already do: a profile that spells the rule "notnull" keeps its own wording.
const lowerCased = runIn(contextFor(edited(
  ['<rule name="NotNull" criticality="warning">Must have a text value that is not "n/a" or empty.</rule>',
    '<rule name="notnull" criticality="warning">Must have a text value that is not "n/a" or empty.' +
    '<causes><cause id="blank" label="LOWER RULE BLANK"/></causes></rule>'],
)), `${AUDIT}
  return {
    error:_qaParseSchema().error,
    labels:[...new Set(qaFindings.filter(item => item.check.endsWith('.NotNull') && item.causeId === 'blank').map(item => item.causeLabel))],
  };
`);
assert.strictEqual(lowerCased.error, '', `a lower-case rule name must still load: ${lowerCased.error}`);
assert.deepStrictEqual(lowerCased.labels, ['LOWER RULE BLANK'], 'a rule spelled in another case must keep its own cause wording');

console.log('QA cause checks passed');
