const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser, parseHTML } = require('linkedom');
const scheduler = require('../javascript/ppm-scheduler');
const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'specification', 'guerrilla-ops-schema.xml'), 'utf8');

function contextFor(xml = schema) {
  const { document } = parseHTML('<html><body><div id="comp-list"></div><dialog id="ppm-dialog"></dialog></body></html>');
  class Request {
    open() {}
    send() { this.status = 200; this.responseText = xml; }
  }
  const context = {
    console, DOMParser, XMLHttpRequest:Request, document, crypto:require('crypto').webcrypto,
    Date, setTimeout, clearTimeout, alert:message => { throw new Error(message); },
    XLSX:{ utils:{ sheet_to_json:sheet => sheet.rows || [] } },
  };
  vm.createContext(context);
  ['state.js','utils.js','cobie-parser.js','filters.js','model-config.js','modals.js','ppm-scheduler.js','ppm-data.js','ppm.js','export.js','app-lifecycle.js']
    .forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'javascript', file), 'utf8'), context, { filename:file }));
  vm.runInContext(`
    _updateChangesBtn = () => {};
    parseCOBieInto({ Sheets:{
      Facility:{rows:[{Name:'Plant'}]},
      Contact:{rows:[{Email:'planner@example.test'}]},
      Type:{rows:[{Name:'Pump'}]},
      Resource:{rows:[{Name:'Technician'},{Name:'Tool kit'}]},
      Picklist:{rows:[
        {JobType:'PM',JobStatus:'Not Yet Started',DurationUnit:'hour',objJob:'IfcTask'},
        {JobType:'Inspection',JobStatus:'Started',DurationUnit:'month',objJob:'IfcProcedure'},
        {JobType:'Workbook-only category',JobStatus:'Workbook-only status',DurationUnit:'quarter'}
      ]},
      Component:{rows:[{Name:'Pump A',TypeName:'Pump'}, {Name:'Pump B',TypeName:'Pump'}]},
      Job:{rows:[
        {Name:'Service',TypeName:'Pump',TaskNumber:'0',Duration:'4',DurationUnit:'hour',Frequency:'1',FrequencyUnit:'month'},
        {Name:'Service',TypeName:'Pump',TaskNumber:'1',Priors:'0',Duration:'2',DurationUnit:'hour',Frequency:'1',FrequencyUnit:'month'},
        {Name:'Service',TypeName:'Pump',TaskNumber:'2',Priors:'1',Duration:'1',DurationUnit:'hour',Frequency:'1',FrequencyUnit:'month'}
      ]}
    }}, 'plant.xlsx');
  `, context);
  return context;
}
function run(context, code) { return vm.runInContext(code, context); }
function json(context, code) { return JSON.parse(run(context, `JSON.stringify(${code})`)); }
const context = contextFor();
const units = json(context, 'PPM_CONFIG.units');

assert.strictEqual(scheduler.shift('2024-01-31', 1, 'month', units), '2024-02-29');
assert.strictEqual(scheduler.shift('2024-01-31', 2, 'month', units), '2024-03-31');
assert.strictEqual(scheduler.shift('2024-02-29', 1, 'year', units), '2025-02-28');
assert.strictEqual(scheduler.shift('2024-01-31T23:30:00+02:00', 2, 'hour', units), '2024-02-01T01:30:00+02:00');
assert.strictEqual(scheduler.shift('2024-01-31', 2, 'hour', units), '2024-01-31T02:00:00');
assert.throws(() => scheduler.parse('2024-02-30'), /Invalid calendar/);
assert.throws(() => scheduler.parse('01/02/2024'), /ISO/);
assert.throws(() => scheduler.parse('2024-01-01T12:00+14:30'), /offset/);
assert.throws(() => scheduler.shift('2024-01-01', 1, 'cycles', units), /Unsupported/);
assert.throws(() => scheduler.shift('2024-01-01', .1, 'year', units), /whole calendar/);

assert.strictEqual(run(context, 'PPM_CONFIG.error'), undefined);
assert.strictEqual(scheduler.shift('2024-01-31', 1, 'quarter', units), '2024-04-30');
assert.strictEqual(run(context, '_ppmCatalog()[0].error'), '');
run(context, `
  const group = _ppmCatalog()[0];
  const scheduleA = _ppmCreateSchedule(group, group.components[0], '2024-01-31');
  const scheduleB = _ppmCreateSchedule(group, group.components[1], '2024-01-31');
  const from = '2024-01-01', to = '2024-04-01';
`);
let projected = json(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0], from, to).filter(item => item.cycle === 1).map(item => ({number:item.task.number,start:item.start,end:item.end,completed:item.completed}))");
assert.deepStrictEqual(projected.map(item => item.start), ['2024-02-29', '2024-02-29', '2024-02-29T02:00:00']);
assert.strictEqual(projected[0].completed, true, 'summary milestone must not block executable tasks');
assert.strictEqual(projected[1].end, '2024-02-29T02:00:00');
const baseline = run(context, 'JSON.stringify({events:db.events,attributes:db.attributes,changes:_changeLog})');
run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0], from, to)");
assert.strictEqual(run(context, 'JSON.stringify({events:db.events,attributes:db.attributes,changes:_changeLog})'), baseline, 'projection must be read-only');

run(context, `
  let schedule = _ppmSchedules(_ppmCatalog())[0];
  let occurrences = _ppmProject(schedule, from, to);
  let first = occurrences.find(item => item.cycle === 0 && item.task.number === '1');
  let second = occurrences.find(item => item.cycle === 0 && item.task.number === '2');
`);
assert.throws(() => run(context, "_ppmPreview(schedule,second,second.start,'one',PPM_CONFIG.completed,'2024-02-01',from,to)"), /predecessors/);
run(context, "const preview = _ppmPreview(schedule,first,'2024-02-02','one',PPM_CONFIG.initial,'',from,to)");
assert.strictEqual(run(context, 'preview.changes.length'), 2);
assert.strictEqual(run(context, 'JSON.stringify({events:db.events,attributes:db.attributes,changes:_changeLog})'), baseline, 'preview must be read-only');
run(context, '_ppmCommit(preview)');
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,to).find(item => item.cycle===0 && item.task.number==='2').start"), '2024-02-02T02:00:00');
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[1],from,to).find(item => item.cycle===0 && item.task.number==='1').start"), '2024-01-31');
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,to).find(item => item.cycle===1 && item.task.number==='1').start"), '2024-02-29');
run(context, `
  schedule = _ppmSchedules(_ppmCatalog())[0];
  first = _ppmProject(schedule,from,to).find(item => item.cycle===0 && item.task.number==='1');
  _ppmCommit(_ppmPreview(schedule,first,first.start,'one',PPM_CONFIG.completed,'2024-02-03',from,to));
`);
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,to).find(item => item.cycle===0 && item.task.number==='2').start"), '2024-02-03');
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,to).find(item => item.cycle===1 && item.task.number==='1').start"), '2024-02-29');
run(context, `
  schedule = _ppmSchedules(_ppmCatalog())[0];
  const next = _ppmProject(schedule,from,to).find(item => item.cycle===1 && item.task.number==='1');
  _ppmCommit(_ppmPreview(schedule,next,'2024-03-02','future',PPM_CONFIG.initial,'',from,to));
`);
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,'2024-05-01').find(item => item.cycle===2 && item.task.number==='1').start"), '2024-04-02');
assert.strictEqual(run(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,to).find(item => item.cycle===0 && item.task.number==='1').actual"), '2024-02-03');

run(context, '_captureDbState(); const savedRecords=JSON.stringify(db.attributes);');
run(context, `
  schedule = _ppmSchedules(_ppmCatalog())[0];
  second = _ppmProject(schedule,from,to).find(item => item.cycle===1 && item.task.number==='2');
  _ppmCommit(_ppmPreview(schedule,second,'2024-03-05','one',PPM_CONFIG.initial,'',from,to));
  _restoreDbState();
`);
assert.strictEqual(run(context, 'JSON.stringify(db.attributes) === savedRecords'), true);

const exported = json(context, "_exportSheetData(db.facilities[0])");
assert(exported.find(([name]) => name === 'Job')[1][0].Frequency, 'COBie 2.4 headers must survive export');
assert(!Object.hasOwn(exported.find(([name]) => name === 'Job')[1][0], 'Interval'));
assert(!exported.some(([name]) => ['Event','Company'].includes(name)), 'PPM must not generate non-2.4 worksheets');
assert(exported.find(([name]) => name === 'Attribute')[1].every(row => row.SheetName === 'Job' && row.RowName === 'Service'));
const reloaded = contextFor();
reloaded.sheets = Object.fromEntries(exported.map(([name, rows]) => [name, { rows }]));
run(reloaded, "resetDb(); parseCOBieInto({Sheets:sheets},'reopened.xlsx');");
const beforeReload = json(context, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],from,'2024-05-01').map(item => [item.cycle,item.key,item.start,item.status,item.actual])");
const afterReload = json(reloaded, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],'2024-01-01','2024-05-01').map(item => [item.cycle,item.key,item.start,item.status,item.actual])");
assert.deepStrictEqual(afterReload, beforeReload, 'saved anchors, segments and history must reconstruct identically');

run(context, `
  parseCOBieInto({Sheets:{Facility:{rows:[{Name:'Plant'}]},Job:{rows:[{Name:'Other',TypeName:'Pump',Duration:'1',DurationUnit:'hour',Frequency:'1',FrequencyUnit:'year'}]}}},'other.xlsx');
`);
const secondExport = json(context, "_exportSheetData(db.facilities[1])");
assert.deepStrictEqual(secondExport.find(([name]) => name === 'Attribute')[1], []);
assert.strictEqual(secondExport.find(([name]) => name === 'Job')[1].length, 1, 'same-facility workbook ownership must be respected');

const graphTasks = [
  {key:'a',number:'1',priors:[],duration:1,durationUnit:'day'},
  {key:'b',number:'2',priors:['1'],duration:2,durationUnit:'day'},
  {key:'c',number:'3',priors:['1'],duration:1,durationUnit:'day'},
  {key:'d',number:'4',priors:['2','3'],duration:1,durationUnit:'day'},
];
assert.strictEqual(scheduler.cycle(graphTasks,'2024-01-01',new Map(),units,'Completed')[3].start, '2024-01-04');
assert.throws(() => scheduler.graph([{...graphTasks[0],priors:['2']},graphTasks[1]]), /cycle/);
assert.throws(() => scheduler.graph([{...graphTasks[0],priors:['9']}]), /missing/);
assert.throws(() => scheduler.graph([{...graphTasks[0],priors:['1']}]), /itself/);
assert.throws(() => scheduler.graph([graphTasks[0],{...graphTasks[1],number:'1'}]), /Ambiguous/);

const extended = contextFor(schema.replace('<column name="Description"><ui groupTitle="Identification"/><ppm search="true" input="textarea"/></column>',
  '<column name="FutureNote"><ui groupTitle="Identification"/><ppm search="true"/></column>'));
assert(json(extended, "_ppmColumns('Job').map(column => column.name)").includes('FutureNote'));
const remapped = contextFor(schema.replace('name="Frequency"><ui', 'name="CustomInterval"><ui'));
run(remapped, "db.jobs.forEach(row=>{ row.CustomInterval=row.Frequency; delete row.Frequency; });");
assert.strictEqual(run(remapped, '_ppmCatalog()[0].interval'), 1, 'semantic mappings must come from XML, not hardcoded fields');

run(context, `
  _ppmState.month='2024-03';
  const counts=Object.fromEntries(COBIE_FILTER_DIMENSIONS.map(filter=>[filter.dimension,{}]));
  const viewData=_ppmBuildView(counts);
  _ppmRender(document.getElementById('comp-list'),viewData);
`);
assert(run(context, "document.querySelector('.ppm-gantt') !== null"));
assert(run(context, "_ppmCalendar(viewData).includes('data-ppm-date=\"2024-03-01\"')"));
assert.strictEqual(run(context, "viewData.occurrences.filter(item=>item.task.milestone).length"), 0);

const mixed = contextFor();
run(mixed, "db.jobs.forEach(row=>{ row.Interval='';row.IntervalUnit='';row.Table='';row['Table.Name']=''; });");
assert.strictEqual(run(mixed, '_ppmCatalog()[0].interval'), 1, 'unknown imported fields must not affect 2.4 scheduling');
run(mixed, "db.jobs.forEach(row=>{ row.Interval=row.Frequency;row.IntervalUnit=row.FrequencyUnit;row.Frequency='';row.FrequencyUnit=''; });");
assert(run(mixed, "_ppmCatalog()[0].error.includes('positive recurrence')"), 'V3 fields must no longer substitute for 2.4 fields');

const edit = contextFor();
run(edit, `
  const group=_ppmCatalog()[0];
  _ppmCreateSchedule(group,group.components[0],'2024-01-01');
  const before=JSON.stringify({jobs:db.jobs,events:db.events,attributes:db.attributes,changes:_changeLog});
  const original=db.jobs[1],draft={...original,Duration:'4'};
  const pendingEdit=_ppmSaveJob(original,draft,db.facilities[0],'2024-01-01','2024-02-01');
`);
assert(run(edit, 'pendingEdit.previews.some(preview=>preview.changes.length)'));
assert.strictEqual(run(edit, 'JSON.stringify({jobs:db.jobs,events:db.events,attributes:db.attributes,changes:_changeLog})===before'), true);
run(edit, "_ppmSaveJob(original,draft,db.facilities[0],'2024-01-01','2024-02-01',true)");
assert.strictEqual(run(edit, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],'2024-01-01','2024-02-01').find(item=>item.cycle===0 && item.task.number==='2').start"), '2024-01-01T04:00:00');
run(edit, `
  _ppmCascadeRename('type','Pump','New Pump','Plant');
  db.components.forEach(row=>row.TypeName='New Pump');
  _ppmCascadeRename('component','Pump A','Pump A renamed','Plant');
  db.components[0].Name='Pump A renamed';
`);
assert.strictEqual(run(edit, "_ppmSchedules(_ppmCatalog())[0].metadata.component"), 'Pump A renamed');
assert.strictEqual(run(edit, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],'2024-01-01','2024-02-01').find(item=>item.task.number==='1').end"), '2024-01-01T04:00:00');

const secondary = contextFor();
run(secondary, `
  const group=_ppmCatalog()[0];
  _ppmCreateSchedule(group,group.components[0],'2024-01-01');
  const s=_ppmSchedules(_ppmCatalog())[0];
  const selected=_ppmProject(s,'2024-01-01','2024-02-01').find(item=>item.cycle===0 && item.task.number==='2');
  const futureMove=_ppmPreview(s,selected,'2024-01-10T02:00:00','future',PPM_CONFIG.initial,'','2024-01-01','2024-02-01');
`);
assert.strictEqual(run(secondary, "futureMove.after.find(item=>item.cycle===0 && item.task.number==='2').start"), '2024-01-10T02:00:00', 'dragging a dependent task must not add its offset twice');

const small = contextFor(schema.replace('maxOccurrences="20000"', 'maxOccurrences="20"'));
run(small, `
  const group=_ppmCatalog()[0];
  _ppmCreateSchedule(group,group.components[0],'2024-01-01');
  const limitBaseline=JSON.stringify({events:db.events,attributes:db.attributes});
`);
assert.throws(() => run(small, "_ppmProject(_ppmSchedules(_ppmCatalog())[0],'2024-01-01','2030-01-01')"), /More than 20/);
assert.strictEqual(run(small, 'JSON.stringify({events:db.events,attributes:db.attributes})===limitBaseline'), true);

const boundary = contextFor();
run(boundary, `
  db.jobs=[_ppmTag({Name:'Boundary',TypeName:'Pump',Duration:'1',DurationUnit:'day',Frequency:'1',FrequencyUnit:'year'},db.jobs[0])];
  const group=_ppmCatalog()[0];
  _ppmCreateSchedule(group,group.components[0],'2024-01-31');
  _ppmState.month='2024-02';
  const counts=Object.fromEntries(COBIE_FILTER_DIMENSIONS.map(filter=>[filter.dimension,{}]));
`);
assert.strictEqual(run(boundary, '_ppmBuildView(counts).occurrences.length'), 0, 'exclusive finish boundaries must agree between cards and calendar');
run(boundary, "_ppmState.month='2024-01';_ppmState.from='2024-01-10';_ppmState.to='2024-01-12';");
assert.deepStrictEqual(json(boundary, '_ppmWindow()'), {from:'2024-01-10',to:'2024-01-12'});

const generatedForm = extended.document.getElementById('ppm-dialog');
generatedForm.showModal = () => {};
run(extended, '_ppmEditJob(db.jobs[0])');
assert([...generatedForm.querySelectorAll('label')].some(label => label.textContent.includes('Future Note')),
  'adding an XML display field must generate its editor without changing UI code');

const form = contextFor();
form.document.getElementById('ppm-dialog').showModal = () => {};
run(form, `
  _ppmRefresh=()=>{};
  parseCOBieInto({Sheets:{
    Facility:{rows:[{Name:'Elsewhere'}]},Type:{rows:[{Name:'Fan'}]},
    Job:{rows:[{name:'Other',typename:'Fan',extidentifier:'different-existing-id'}]},
    Picklist:{rows:[{JobType:'Other workbook'}]}
  }},'elsewhere.xlsx');
  _ppmEditJob();
  const field = name => document.querySelector('[data-ppm-field="'+_ppmColumns('Job').findIndex(column=>column.name===name)+'"]');
  const options = name => [...field(name).options].map(option=>option.value);
  const choose = (input,value) => [...input.options].find(option=>option.value===value).selected=true;
  const generatedId = field('ExtIdentifier').value;
`);
assert.match(run(form, 'generatedId'), /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
assert.strictEqual(run(form, "field('CreatedOn').getAttribute('type')"), 'datetime-local');
assert.strictEqual(run(form, "field('Start').getAttribute('type')"), 'number', 'Start is an offset, not a calendar date');
assert(json(form, "options('Category')").includes('Workbook-only category'));
assert(json(form, "options('Status')").includes('Workbook-only status'));
assert(json(form, "options('CreatedBy')").includes('planner@example.test'));
assert(json(form, "options('TypeName')").includes('Pump'));
assert(json(form, "options('DurationUnit')").includes('quarter'));
assert(json(form, "options('ExtObject')").includes('IfcProcedure'));
assert.deepStrictEqual(json(form, "options('ResourceNames')"), ['Technician','Tool kit']);
assert.strictEqual(run(form, "field('ResourceNames').hasAttribute('multiple')"), true);
assert.strictEqual(run(form, "document.getElementById('ppm-job-profile')"), null);
run(form, `
  field('Name').value='Service'; choose(field('TypeName'),'Pump'); field('TaskNumber').value='3';
  field('Name').dispatchEvent(new document.defaultView.Event('change'));
`);
assert.deepStrictEqual(json(form, "options('Priors')"), ['0','1','2']);
run(form, `
  field('Description').value='Keep this draft';
  choose(document.getElementById('ppm-job-source'),'1');
  document.getElementById('ppm-job-source').dispatchEvent(new document.defaultView.Event('change'));
`);
assert.strictEqual(run(form, "field('ExtIdentifier').value"), run(form, 'generatedId'), 'source changes must preserve generated identifiers');
assert.strictEqual(run(form, "field('Description').value"), 'Keep this draft');
assert(json(form, "options('TypeName')").includes('Fan'));
assert(!json(form, "options('Category')").includes('Workbook-only category'));
run(form, `
  const existing=db.jobs[1];
  existing.ExtIdentifier='external-id-to-keep'; existing.CreatedOn='2024-01-31T12:30:45+02:00';
  existing.Duration='n/a'; existing.CustomField='keep me'; existing.ResourceNames='Tool kit, Technician';
  _ppmEditJob(existing);
  const unchanged=_ppmReadJobFields(_ppmColumns('Job'),existing);
`);
assert.strictEqual(run(form, 'unchanged.ExtIdentifier'), 'external-id-to-keep');
assert.strictEqual(run(form, 'unchanged.CreatedOn'), '2024-01-31T12:30:45+02:00');
assert.strictEqual(run(form, 'unchanged.CustomField'), 'keep me');
assert.strictEqual(run(form, 'unchanged.Duration'), 'n/a');
assert.strictEqual(run(form, 'unchanged.ResourceNames'), 'Tool kit, Technician');
assert(!json(form, "options('Priors')").includes('1'), 'a task cannot select itself as its predecessor');
run(form, "field('CreatedOn').value='2024-02-01T10:15';");
assert.strictEqual(run(form, "_ppmControlValue(field('CreatedOn'))"), '2024-02-01T10:15+02:00');
run(form, `
  existing.CreatedOn='2024-01-31 12:30:45+02:00'; _ppmEditJob(existing);
  field('CreatedOn').value='2024-02-02T10:15';
`);
assert.strictEqual(run(form, "_ppmControlValue(field('CreatedOn'))"), '2024-02-02T10:15+02:00');
run(form, "_ppmDialog('Dates',_ppmDateControl('date-test','2024-02-01'));");
assert.strictEqual(run(form, "document.getElementById('date-test').type"), 'date');
run(form, `
  const dateMode=document.querySelector('[data-ppm-date-mode]');
  choose(dateMode,'datetime-local');dateMode.dispatchEvent(new document.defaultView.Event('change'));
`);
assert.strictEqual(run(form, "_ppmControlValue(document.getElementById('date-test'))"), '2024-02-01T00:00');

const compatibility = contextFor();
run(compatibility, `
  const source=db.facilities[0], task=_ppmTaskKey(db.jobs[0]);
  source._workbook.Sheets.Event={rows:[{Name:'Earlier PPM', 'Job.Name':'Service', StartDate:'2024-01-31'}]};
  Object.entries({record:'schedule',schedule:'previous-build',task,component:'Pump A',anchor:'2024-01-31',segments:'[]'})
    .forEach(([role,Value])=>db.attributes.push(_ppmTag({
      Name:PPM_CONFIG.attributes[role].name, SheetName:'Event',RowName:'Earlier PPM',Value
    },source)));
  const compatibilityBaseline=JSON.stringify(db.attributes);
`);
assert.strictEqual(run(compatibility, "_ppmSchedules(_ppmCatalog())[0].id"), 'previous-build');
assert(run(compatibility, 'JSON.stringify(db.attributes)===compatibilityBaseline'), 'reading previous PPM data must not dirty it');
run(compatibility, `
  const schedule=_ppmSchedules(_ppmCatalog())[0];
  const occurrence=_ppmProject(schedule,'2024-01-01','2024-03-01').find(item=>item.task.number==='1');
  _ppmCommit(_ppmPreview(schedule,occurrence,'2024-02-02','future',PPM_CONFIG.initial,'','2024-01-01','2024-03-01'));
`);
assert.strictEqual(run(compatibility, "_ppmSchedules(_ppmCatalog()).length"), 1, 'new Attribute records must supersede earlier app-owned records without duplication');
assert(run(compatibility, "db.attributes.some(row=>row.SheetName==='Job' && row.Name.startsWith(PPM_CONFIG.recordPrefix))"));
run(compatibility, "db.attributes.find(row=>row.SheetName==='Job').Value='{bad json';");
assert.throws(() => run(compatibility, '_ppmEvents()'), /Invalid .* Attribute/, 'corrupt scheduling records must fail explicitly');
console.log('PPM schema, recurrence, dependencies, persistence and rendering regressions passed.');
