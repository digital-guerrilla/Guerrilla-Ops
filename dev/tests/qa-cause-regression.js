const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require('linkedom');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'javascript');
const schemaSource = fs.readFileSync(path.join(root, 'specification', 'guerrilla-ops-schema.xml'), 'utf8');

class SchemaRequest {
  open() {}
  send() {
    this.status = 200;
    this.responseText = schemaSource;
  }
}

const facility = 'Facility A';
const row = fields => ({ _facility:facility, ...fields });
const context = {
  console,
  DOMParser,
  XMLHttpRequest:SchemaRequest,
  db:{
    contacts:[row({ Email:'a@example.com', CreatedBy:'a@example.com', Category:'Owner' })],
    facilities:[row({ Name:facility, CreatedBy:'a@example.com' })],
    floors:[],
    spaces:[],
    zones:[],
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
    systems:[],
    documents:[],
    attributes:[],
    coordinates:[],
    picklists:[row({ 'Category-Product':'Pr_20_31: Agreed wording' })],
  },
  idx:{},
  sel:{ facility:new Set() },
  searchQuery:'',
  collapseCounter:0,
  pendingGroups:{},
};
vm.createContext(context);
['utils.js', 'qa.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), context, { filename:file });
});

const run = source => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${source} })())`, context));

// The pure rules a cause is made from.
const pure = run(`
  const ref = { targetSheet:'Picklist', targetColumn:'Category' };
  const target = new Set(['pr_20: agreed wording', 'plain value']);
  return {
    blank:_qaReferenceCause('', target, ref),
    na:_qaReferenceCause('N/A', target, ref),
    close:_qaReferenceCause('Pr_20: Other wording', target, ref),
    noColon:_qaReferenceCause('Pr_20', target, ref),
    absent:_qaReferenceCause('Pr_99: Nothing', target, ref),
    plainCode:_qaReferenceCause('plain', target, ref),
    emptyPrefix:_qaReferenceCause(': first', new Set([': second']), ref),
    spacePrefix:_qaReferenceCause('  : first', new Set(['  : second']), ref),
    shapes:[_qaCheckCause('Format', '01/02/25'), _qaCheckCause('Format', '2025-02-03'), _qaCheckCause('Valid', 'Sept 2025')],
    empties:[_qaCheckCause('Format', ''), _qaCheckCause('NotNull', 'n/a'), _qaCheckCause('NotNull', '   ')],
    numbers:[_qaCheckCause('ValidNumber', 'ten'), _qaCheckCause('ZeroOrGreater', '-2'), _qaCheckCause('ZeroOrGreater', 'x')],
  };
`);
assert.strictEqual(pure.blank, 'Blank');
assert.strictEqual(pure.na, 'Entered as "n/a"');
assert.strictEqual(pure.close, 'Text before ":" matches Picklist.Category, the rest differs');
assert.strictEqual(pure.noColon, 'Not found in Picklist.Category');
assert.strictEqual(pure.absent, 'Not found in Picklist.Category');
assert.strictEqual(pure.plainCode, 'Not found in Picklist.Category',
  'a target with no prefix must not produce a prefix match');
assert.strictEqual(pure.emptyPrefix, 'Not found in Picklist.Category', 'an empty prefix is not a match');
assert.strictEqual(pure.spacePrefix, 'Not found in Picklist.Category', 'a blank prefix is not a match');
assert.deepStrictEqual(pure.shapes, ['Written like ##/##/##', 'Written like ####-##-##', 'Written like a ####']);
assert.deepStrictEqual(pure.empties, ['Blank', 'Entered as "n/a"', 'Blank']);
assert.deepStrictEqual(pure.numbers, ['Not a number', 'Negative number', 'Not a number']);

// A full audit: every finding carries a cause, and a failing reference separates by cause.
const audit = run(`
  qaSelectedStage = 'operation';
  const findings = runQA();
  qaFindings = findings;
  return {
    total:findings.length,
    uncaused:findings.filter(item => !item.cause).map(item => item.check),
    category:Object.fromEntries(findings.filter(item => item.check === 'Type.Category.Reference')
      .map(item => [item.entityName, item.cause])),
    dates:findings.filter(item => item.check === 'Component.InstallationDate.Format')
      .map(item => [item.entityName, item.cause]),
    report:_qaReportRows(),
  };
`);
assert(audit.total > 0, 'the fixture must produce findings');
assert.deepStrictEqual(audit.uncaused, [], 'every finding must carry a cause');
assert.strictEqual(audit.category.Close, 'Text before ":" matches Picklist.Category-Product, the rest differs');
assert.strictEqual(audit.category.Missing, 'Not found in Picklist.Category-Product');
assert.strictEqual(audit.category.NotApplicable, 'Entered as "n/a"');
assert.deepStrictEqual(audit.dates, [
  ['C1', 'Written like ##/##/##'],
  ['C2', 'Written like ##/##/##'],
  ['C3', 'Written like ####-##-##'],
]);

// The report keeps every row and adds the cause beside the check it explains.
assert.strictEqual(audit.report.length, audit.total, 'the report must keep every finding');
assert(audit.report.every(item => item.Cause), 'every report row must carry a cause');
assert.deepStrictEqual(Object.keys(audit.report[0]),
  ['Stage', 'Severity', 'Check', 'Cause', 'Sheet', 'Item', 'Facility', 'Detail']);

// Findings rebuilt after an edit must agree with the full audit.
const revalidated = run(`
  const out = {};
  ['Close', 'Missing', 'NotApplicable'].forEach(name => {
    const found = _qaValidateEntityFields('type', name, 'Facility A', ['Category'], 'operation');
    out[name] = found.filter(item => item.check === 'Type.Category.Reference').map(item => item.cause);
  });
  return out;
`);
assert.deepStrictEqual(revalidated.Close, [audit.category.Close]);
assert.deepStrictEqual(revalidated.Missing, [audit.category.Missing]);
assert.deepStrictEqual(revalidated.NotApplicable, [audit.category.NotApplicable]);

// Grouping: most common first, distinct values rather than rows, and a bounded list.
const grouped = run(`
  const groups = _qaCauseGroups([
    { cause:'Rare', value:'x' },
    { cause:'Common', value:'A ' },
    { cause:'Common', value:'a' },
    { cause:'Common', value:'b' },
    { cause:'Blank', value:'' },
    { cause:QA_CAUSE_NA, value:'n/a' },
  ]);
  const many = Array.from({ length:QA_CAUSE_GROUP_LIMIT + 3 }, (_, index) => ({ cause:'Cause ' + index, value:String(index) }));
  return {
    groups:groups.map(group => [group.cause, group.items.length, group.distinct]),
    many:_qaCauseGroups(many).map(group => [group.cause, group.items.length]),
    single:_qaDistinctLabel(1, 4, ' 2025-08-08 '),
    several:_qaDistinctLabel(3, 4, 'ignored'),
    none:_qaDistinctLabel(0, 4, 'ignored'),
    oneRow:_qaDistinctLabel(1, 1, 'ignored'),
    long:_qaDistinctLabel(1, 2, 'x'.repeat(QA_CAUSE_VALUE_LIMIT + 5)),
    limit:QA_CAUSE_VALUE_LIMIT,
    sample:_qaCauseGroups([{ cause:'One', value:'first' }, { cause:'One', value:'first' }])[0].sample,
  };
`);
assert.deepStrictEqual(grouped.groups, [['Common', 3, 2], ['Blank', 1, 0], ['Entered as "n/a"', 1, 0], ['Rare', 1, 1]]);
assert.strictEqual(grouped.many.length, 8, 'the breakdown must stay readable');
assert.strictEqual(grouped.many.reduce((total, [, count]) => total + count, 0), 11, 'folding must not lose a finding');
assert.strictEqual(grouped.many[7][0], '4 other types');
assert.deepStrictEqual([grouped.single, grouped.several, grouped.none, grouped.oneRow],
  ['all the same value: 2025-08-08', '3 distinct values', '', '']);
assert.strictEqual(grouped.long, `all the same value: ${'x'.repeat(grouped.limit)}...`,
  'a long value must not break the header');
assert.strictEqual(grouped.sample, 'first');

// Hostile values reach the rendered note and header escaped.
const rendered = run(`
  const value = '<img src=x onerror=alert(1)>';
  const single = _qaCauseBlocks([{ cause:'Written like a', value }, { cause:'Written like a', value }]);
  const several = _qaCauseBlocks([
    { cause:'One', value }, { cause:'One', value }, { cause:'Two', value:'other' }, { cause:'Two', value:'more' },
  ]);
  const oneRow = _qaCauseBlocks([{ cause:'Blank', value:'' }]);
  return { single, several, oneRow };
`);
assert(rendered.single.includes('All 2: Written like a'), 'the note must give the count');
assert(rendered.oneRow.includes('>Blank<'), 'a single finding needs no count');
assert(!rendered.single.includes('<img'), 'a value in the note must be escaped');
assert(!rendered.several.includes('<img'), 'a value in a header must be escaped');
assert(rendered.single.includes('all the same value: &lt;img'), 'the note must name the value');

console.log('QA cause checks passed');
