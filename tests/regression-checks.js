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
    types:[], components:[], spaces:[], floors:[], systems:[], documents:[],
    facilities:[], contacts:[], attributes:[], coordinates:[], picklists:[], facility:null,
  },
  idx:{},
  sel:{ facility:new Set(), floor:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() },
  collapsedFilterCategories:new Set(),
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

loadModule('utils.js');
loadModule('cobie-parser.js');
loadModule('filters.js');
loadModule('three-d-viewer.js');

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

loadModule('documents.js');
const documentEntries = context.db.documents.map(doc => ({ doc }));
const documentRoots = context.groupDocsByClassification(documentEntries);
assert(documentRoots.includes('PM_70 : Asset information'), 'Document view should start with the top used PM classification');
const documentChildren = context.groupDocsByClassification(documentEntries, [], 1, 'pm_70');
assert(documentChildren.includes('PM_70_15 : Asset information management'), 'Document view should nest the next PM classification level');

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
const floor = context.db.floors[0];
const svg = '<svg>' + 'x'.repeat(70000) + '</svg>';
assert(context._writeChunkedFloorAttribute(floor, svg, 'svg', /^svg(?:[^\d]*(\d+))?$/i, 30000));
const stored = context._collectChunkedFloorAttributes(/^svg(?:[^\d]*(\d+))?$/i);
assert.strictEqual(stored[context._rowKey(floor, 'Level 01')], svg);

loadModule('component-placement.js');
context.db.spaces = [{ Name:'Room 101', FloorName:'Level 01', _facility:'Facility A' }];
const roomCoordinateRows = [
  coordinateRow('Coordinate LowerLeft', 'Room 101_lowerleft', -8000, 0, 3000, 'Space'),
  coordinateRow('Coordinate UpperRight', 'Room 101_upperright', 0, 10000, 6000, 'Space'),
];
context.db.coordinates = roomCoordinateRows;
coordinateIndex = context._viewer3dCoordIndex();
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
assert.strictEqual(context._renameComponentCoordinateRows('Facility A', 'Alpha', 'Beta'), 1);
assert.deepStrictEqual(context.db.coordinates.map(row => row.RowName), ['Beta', 'Alpha_extra']);

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

console.log('Regression checks passed');