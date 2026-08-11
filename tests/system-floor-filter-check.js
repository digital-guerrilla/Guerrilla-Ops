const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require('linkedom');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'dev', 'javascript');
const schemaSource = fs.readFileSync(path.join(root, 'dev', 'specification', 'guerrilla-ops-schema.xml'), 'utf8');

class SchemaRequest {
  open() {}
  send() {
    this.status = 200;
    this.responseText = schemaSource;
  }
}

const context = {
  console,
  DOMParser,
  XMLHttpRequest:SchemaRequest,
};
vm.createContext(context);
['state.js', 'utils.js', 'cobie-parser.js', 'filters.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), context, { filename:file });
});

const runtimeRelationships = JSON.parse(vm.runInContext(`JSON.stringify({
  indexes:COBIE_RUNTIME_MODEL.indexReferences,
  dependencies:COBIE_SCHEMA_RELATIONSHIPS,
})`, context));
assert(runtimeRelationships.indexes.some(reference =>
  reference.source === 'space' && reference.target === 'floor' && reference.forwardIndex === 'spFloor'
), 'Space-to-Floor runtime index must be discovered from its nested reference');
assert(runtimeRelationships.indexes.some(reference =>
  reference.source === 'system' && reference.target === 'component' && reference.reverseIndex === 'compSys'
), 'System-to-Component runtime index must be discovered from its nested reference');
assert(runtimeRelationships.indexes.some(reference =>
  reference.source === 'zone' && reference.target === 'space' && reference.reverseIndex === 'spZones'
), 'Zone-to-Space runtime index must be discovered from its nested reference');
assert(runtimeRelationships.dependencies.some(reference =>
  reference.source === 'space' && reference.target === 'floor'
), 'Floor changes must include dependent Space indexes');
assert(runtimeRelationships.dependencies.some(reference =>
  reference.source === 'system' && reference.target === 'component'
), 'Component changes must include dependent System indexes');

vm.runInContext(`
db.facilities.push({ Name:'Facility A', _facility:'Facility A' });
db.floors.push({ Name:'Level 01', _facility:'Facility A' });
db.spaces.push({ Name:'Room 101', FloorName:'Level 01', _facility:'Facility A' });
db.components.push({ Name:'AHU-01', Space:'Room 101', _facility:'Facility A' });
db.zones.push(
  { Name:'Heating Zone', SpaceNames:'Room 101', _facility:'Facility A' },
  { Name:'Access Zone', SpaceNames:'Room 101', _facility:'Facility A' }
);
db.systems.push({ Name:'Heating', ComponentNames:'AHU-01', _facility:'Facility A' });
buildIdx();
`, context);

function componentFilterValues(dimension) {
  return JSON.parse(vm.runInContext(`JSON.stringify(
    _componentFilterValues(db.components[0], _cobieFilterDescriptor('${dimension}'))
  )`, context));
}

assert.deepStrictEqual(componentFilterValues('floor'), ['level 01'],
  'Floor filter and grouping values must resolve through Space.FloorName');
assert.deepStrictEqual(componentFilterValues('zone'), ['heating zone', 'access zone'],
  'Zone filter and grouping values must include every Zone containing a Component Space');
assert.deepStrictEqual(componentFilterValues('system'), ['heating'],
  'System filter and grouping values must resolve through System.ComponentNames');

vm.runInContext(`
db.floors.push({ Name:'Level 02', _facility:'Facility A' });
db.spaces[0].FloorName = 'Level 02';
updateIdxForEntities('floor');
`, context);
assert.deepStrictEqual(componentFilterValues('floor'), ['level 02'],
  'incremental Floor changes must rebuild the Space-to-Floor index');

vm.runInContext(`
db.systems[0].Name = 'Ventilation';
updateIdxForEntities('system');
`, context);
assert.deepStrictEqual(componentFilterValues('system'), ['ventilation'],
  'incremental System changes must rebuild the Component-to-System index');

vm.runInContext(`
idx.compSys = {};
updateIdxForEntities('component');
`, context);
assert.deepStrictEqual(componentFilterValues('system'), ['ventilation'],
  'incremental Component changes must rebuild dependent System indexes');

const manyDimensionState = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const dimensions = Array.from({ length:40 }, (_, index) => 'dimension-' + index);
  const state = _filterMatchState(dimensions, dimension => dimension !== 'dimension-35');
  return {
    failedCount:state.failedCount,
    failedDimensions:dimensions.filter((_, index) => !state.matches[index]),
    countableDimensions:dimensions.filter((_, index) => state.failedCount <= Number(!state.matches[index])),
  };
})())`, context));
assert.strictEqual(manyDimensionState.failedCount, 1, 'filter matching must support more than 32 XML dimensions');
assert.deepStrictEqual(manyDimensionState.failedDimensions, ['dimension-35']);
assert.deepStrictEqual(manyDimensionState.countableDimensions, ['dimension-35'],
  'cross-counts must remain available for the sole failing dimension');

console.log('System and Floor filter checks passed.');
