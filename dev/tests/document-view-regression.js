function runDocumentViewRegression({ assert, context, fs, path, javascriptDir, loadModule, vm }) {
  loadModule('documents.js');
  loadModule('results.js');
  context._GRP_LABELS = {};
  const documentEntries = context.db.documents.map(doc => ({ doc }));
  const documentRoots = context.groupDocsByClassification(documentEntries);
  assert(documentRoots.includes('PM_70 : Asset information'), 'Document view should start with the top used PM classification');
  assert(documentRoots.includes('grp-action-label">Count'), 'document group headers should use the shared Count action');
  assert(documentRoots.includes('>Info</span>'), 'document group headers should expose the shared Info action');
  assert(documentRoots.includes('>Highlight</span>'), 'document group headers should expose the shared Highlight action');
  const documentChildren = context.groupDocsByClassification(documentEntries, [], 1, 'pm_70');
  assert(documentChildren.includes('PM_70_15 : Asset information management'), 'Document view should nest the next PM classification level');
  context.docStore = [];
  const linkedDocument = { ...context.db.documents[0], Directory:'https://example.test/document.pdf' };
  const documentCardHtml = context.docCard({ doc:linkedDocument, linkedType:'facility', linkedName:'Facility A' });
  assert(documentCardHtml.includes('data-card-highlight-key'), 'document cards should be selectable as a whole');
  assert(documentCardHtml.includes('document-link-action'), 'document cards should retain the Link action');
  assert(!documentCardHtml.includes('data-edit-doc'), 'document cards must not expose the redundant edit action');
  const resultsSource = fs.readFileSync(path.join(javascriptDir, 'results.js'), 'utf8');
  assert(!resultsSource.includes('data-edit-doc'), 'document trees must not expose the redundant edit action');
  const canonicalTypes = context.idx.types;
  context.idx.types = [];
  const mixedCaseTypeGroups = [...context.buildGroupMap([
    { Name:'Mixed Component', TypeName:'MixedCaseType', _facility:'Facility A' },
  ], 'type').keys()];
  context.idx.types = canonicalTypes;
  assert.deepStrictEqual(mixedCaseTypeGroups, ['MixedCaseType'],
    'Type group headers must preserve source field casing when a canonical list entry is temporarily unavailable');
  context.componentHighlightFixture = { Name:'Highlight Pump', Description:'Edited component', _facility:'Facility A' };
  const componentHighlightFixture = context.componentHighlightFixture;
  const highlightKey = context._groupHighlightBuildKey('component', componentHighlightFixture.Name, componentHighlightFixture._facility);
  vm.runInContext(`groupHighlightStore.add(${JSON.stringify(highlightKey)})`, context);
  const highlightedComponentHtml = vm.runInContext('card(componentHighlightFixture)', context);
  assert(highlightedComponentHtml.includes('data-card-highlight-action'), 'component cards must expose a dedicated Highlight action');
  assert(highlightedComponentHtml.includes('grp-highlight-btn is-active'), 'the component Highlight action must show its active state');
  assert(highlightedComponentHtml.includes('component-result-card'), 'component highlight styling must remain scoped independently of edit state');
  context._changeLog.push({
    entityType:'document', entityName:linkedDocument.Name, originalName:linkedDocument.Name,
    facNames:[linkedDocument._facility], timestamp:Date.now(),
  });
  assert(context.docCard({ doc:linkedDocument, linkedType:'facility', linkedName:'Facility A' }).includes('document-result-card-unsaved'),
    'unsaved documents should be highlighted in the main document tree');
  context._changeLog.length = 0;

  const { parseHTML } = require('linkedom');
  loadModule('pills.js');
  const buckets = ['facilities', 'floors', 'spaces', 'types', 'systems', 'components', 'documents'];
  const savedRows = Object.fromEntries(buckets.map(bucket => [bucket, context.db[bucket]]));
  const savedSelections = Object.fromEntries(Object.entries(context.sel).map(([dim, values]) => [dim, new Set(values)]));
  const savedSearch = context.searchQuery;
  const savedExpanded = vm.runInContext('allExpanded', context);
  const row = (name, facility, fields = {}) => ({ Name:name, _facility:facility, ...fields });
  context.db.facilities = [row('Facility A', 'Facility A'), row('Facility B', 'Facility B')];
  context.db.floors = [row('Level 1', 'Facility A'), row('Level 1', 'Facility B')];
  context.db.spaces = [
    row('Room 1', 'Facility A', { FloorName:'Level 1' }),
    row('Room 2', 'Facility A', { FloorName:'Level 1' }),
    row('Room 1', 'Facility B', { FloorName:'Level 1' }),
  ];
  context.db.types = [
    row('Pump', 'Facility A'), row('Fan', 'Facility A'), row('Unused', 'Facility A'),
    row('Pump', 'Facility B'),
  ];
  context.db.components = [
    row('Pump 1', 'Facility A', { Space:'Room 1', TypeName:'Pump' }),
    row('Fan 1', 'Facility A', { Space:'Room 1', TypeName:'Fan' }),
    row('Other', 'Facility A', { Space:'Room 2', TypeName:'Unused' }),
    row('Pump 1', 'Facility B', { Space:'Room 1', TypeName:'Pump' }),
  ];
  context.db.systems = [
    row('Heating', 'Facility A', { ComponentNames:'Pump 1' }),
    row('Backup', 'Facility A', { ComponentNames:'Pump 1' }),
    row('Ventilation', 'Facility A', { ComponentNames:'Fan 1' }),
    row('Heating', 'Facility B', { ComponentNames:'Pump 1' }),
  ];
  const doc = (name, facility, sheet, linkedName, directory = name) =>
    row(name, facility, { SheetName:sheet, RowName:linkedName, Directory:directory, Category:'PM_70' });
  context.db.documents = [
    doc('Room Manual', 'Facility A', 'Space', 'Room 1'),
    doc('Room 2 Manual', 'Facility A', 'Space', 'Room 2'),
    doc('Pump Manual', 'Facility A', 'Type', 'Pump', 'shared'),
    doc('Pump Manual', 'Facility A', 'Component', 'Pump 1', 'shared'),
    doc('Heating Manual', 'Facility A', 'System', 'Heating'),
    doc('Backup Manual', 'Facility A', 'System', 'Backup'),
    doc('Other Manual', 'Facility A', 'Type', 'Unused'),
    doc('Foreign Manual', 'Facility B', 'Type', 'Pump'),
  ];
  context.db.documents.filter(document => document.SheetName === 'System')
    .forEach(document => { document.Category = 'PM_80'; });
  context.buildIdx();
  context.sel.zone ||= new Set();
  Object.values(context.sel).forEach(values => values.clear());
  context.sel.facility.add('facility a');
  context.sel.space.add('room 1');
  context.searchQuery = '';
  vm.runInContext('allExpanded = true', context);
  const counts = {};
  const entries = context._documentViewEntries(counts);
  assert.deepStrictEqual(Object.keys(counts.type).sort(), ['fan', 'pump'],
    'Space filtering must offer every related Type, including Types without documents');
  assert.deepStrictEqual(Object.keys(counts.system).sort(), ['backup', 'heating', 'ventilation'],
    'Space filtering must offer Systems even when they have no documents');
  const tree = dims => parseHTML('<html><body>' + context.groupDocsNested(entries, dims) + '</body></html>').document;
  const groups = (root, dim) => [...root.querySelectorAll('.grp-cat-' + dim)];
  const typeTree = tree(['space', 'type']);
  const typeGroups = groups(typeTree, 'type');
  assert.strictEqual(typeGroups.length, 2, 'Space -> Type must include both related Types');
  const pump = typeGroups.find(header => header.querySelector('.grp-name').textContent.includes('Pump'));
  const fan = typeGroups.find(header => header.querySelector('.grp-name').textContent.includes('Fan'));
  assert(pump.nextElementSibling.textContent.includes('Pump Manual'), 'Pump must show its Type document');
  assert(!pump.nextElementSibling.textContent.includes('Room Manual') &&
    !pump.nextElementSibling.textContent.includes('Heating Manual') &&
    !pump.nextElementSibling.textContent.includes('Foreign Manual'),
  'the lowest Type group must exclude documents attached to other levels and facilities');
  assert.strictEqual(pump.nextElementSibling.querySelectorAll('.document-result-card').length, 1,
    'duplicate logical documents must appear only once at the matching attachment level');
  assert.strictEqual(pump.querySelector('.grp-cnt').textContent, '1');
  assert.strictEqual(fan.querySelector('.grp-cnt').textContent, '0');
  assert.strictEqual(typeTree.querySelector('.grp-cat-space .grp-cnt').textContent, '1',
    'parent counts must reflect documents displayed at the lowest group level');
  assert.strictEqual(fan.nextElementSibling.querySelectorAll('.document-result-card').length, 0,
    'Types without documents must still have an empty group');
  const systemTree = tree(['space', 'system', 'type']);
  const heating = groups(systemTree, 'system').find(header => header.querySelector('.grp-name').textContent.includes('Heating'));
  assert.strictEqual(groups(heating.nextElementSibling, 'type').length, 1,
    'nested groups must retain the individual component relationship rather than cross-joining Types and Systems');
  assert(groups(heating.nextElementSibling, 'type')[0].textContent.includes('Pump'));
  const systemLeafTree = tree(['space', 'system']);
  const heatingLeaf = groups(systemLeafTree, 'system').find(header => header.querySelector('.grp-name').textContent.includes('Heating'));
  assert(heatingLeaf.nextElementSibling.textContent.includes('Heating Manual') &&
    !heatingLeaf.nextElementSibling.textContent.includes('Backup Manual'),
  'a component in multiple Systems must not place one System document under another System');
  const roomTree = tree(['space']);
  assert(roomTree.body.textContent.includes('Room Manual') && !roomTree.body.textContent.includes('Pump Manual'),
    'a Space as the lowest group must show only directly attached Space documents');
  const categoryTree = tree(['space', 'doccat']);
  assert(categoryTree.body.textContent.includes('Room Manual') && !categoryTree.body.textContent.includes('Pump Manual') &&
    !categoryTree.body.textContent.includes('Heating Manual') && !categoryTree.body.textContent.includes('Room 2 Manual'),
  'Space -> Document Category must show only documents attached to the parent Space');
  assert.strictEqual(categoryTree.querySelectorAll('.document-result-card').length, 1);
  assert.strictEqual(categoryTree.querySelector('.grp-cat-space .grp-cnt').textContent, '1',
    'parent counts must reflect the documents below the Document Category');
  const typeCategoryTree = tree(['space', 'type', 'doccat']);
  const pumpCategory = groups(typeCategoryTree, 'type').find(header => header.querySelector('.grp-name').textContent.includes('Pump'));
  const fanCategory = groups(typeCategoryTree, 'type').find(header => header.querySelector('.grp-name').textContent.includes('Fan'));
  assert(pumpCategory.nextElementSibling.textContent.includes('Pump Manual') &&
    !pumpCategory.nextElementSibling.textContent.includes('Room Manual') &&
    !pumpCategory.nextElementSibling.textContent.includes('Heating Manual'),
  'nested Type -> Document Category must show only Type documents in the parent Space');
  assert.strictEqual(fanCategory.nextElementSibling.querySelectorAll('.document-result-card').length, 0,
    'an asset with no directly attached documents must not inherit another level’s categories');
  const systemCategoryTree = tree(['space', 'system', 'doccat']);
  const heatingCategory = groups(systemCategoryTree, 'system').find(header => header.querySelector('.grp-name').textContent.includes('Heating'));
  assert(heatingCategory.nextElementSibling.textContent.includes('Heating Manual') &&
    !heatingCategory.nextElementSibling.textContent.includes('Backup Manual'),
  'Document Category must distinguish different Systems sharing a component');
  assert.strictEqual(new Set(context._documentEntriesForLeaf(entries, ['space', 'type', 'doccat'])
    .map(entry => context._docUniqueKey(entry.doc))).size, 1,
  'the result count must include only documents shown below the final asset group');
  const categoryOnlyTree = tree(['doccat']);
  assert.strictEqual(categoryOnlyTree.querySelectorAll('.document-result-card').length, 4,
    'Document Category on its own must continue showing all related documents without duplicates');
  const categoryFirstTree = tree(['doccat', 'type']);
  const categoryFirstCards = [...categoryFirstTree.querySelectorAll('.document-result-card')]
    .map(card => card.textContent);
  assert(categoryFirstCards.some(text => text.includes('Pump Manual')) &&
    categoryFirstCards.every(text => !text.includes('Heating Manual') && !text.includes('Room Manual')),
  'a category followed by Type must still display only documents directly attached to the Type');
  assert.strictEqual(context.renderDocumentCards(entries).match(/document-result-card/g).length, 4,
    'ungrouped results must include each related document only once');
  context.sel.doccat.add('pm_70');
  const categoryCounts = {};
  const categoryFiltered = context._documentViewEntries(categoryCounts);
  assert.deepStrictEqual([...new Set(context._documentEntriesForLeaf(categoryFiltered, [])
    .map(entry => entry.doc.Name))].sort(), ['Pump Manual', 'Room Manual']);
  assert.strictEqual(categoryCounts.doccat.pm_80, 2,
    'category cross-counts must ignore the selected category');
  context.sel.doccat.clear();
  context.searchQuery = 'pump manual';
  const searched = context._documentViewEntries({});
  assert.deepStrictEqual([...new Set(context._documentEntriesForLeaf(searched, [])
    .map(entry => entry.doc.Name))], ['Pump Manual'], 'document searches must not include unrelated shared documents');
  context.searchQuery = '';
  context.sel.system.add('heating');
  const filteredCounts = {};
  context._documentViewEntries(filteredCounts);
  assert.deepStrictEqual(Object.keys(filteredCounts.type).sort(), ['pump'],
    'combined Space and System filters must preserve component relationships');
  context.sel.system.clear();
  context.sel.space.clear();
  const allRooms = context._documentViewEntries({});
  const allRoomsTree = parseHTML('<html><body>' + context.groupDocsNested(allRooms, ['space', 'doccat']) + '</body></html>').document;
  const categoryKeys = groups(allRoomsTree, 'doccat').map(header => header.dataset.gkey);
  assert(categoryKeys.length >= 2 && new Set(categoryKeys).size === categoryKeys.length,
    'category expansion state must be independent for different parent groups');
  vm.runInContext('allExpanded = false; groupExpandedState.clear(); pendingGroups = {}', context);
  context.groupDocsNested(entries, ['space', 'type']);
  const pending = vm.runInContext('Object.values(pendingGroups)[0]', context);
  vm.runInContext('allExpanded = true', context);
  const lazyTree = parseHTML('<html><body>' + context.groupDocsNested(
    pending.docEntries, pending.dims, pending.depth, pending.parentPath,
  ) + '</body></html>').document;
  assert.strictEqual(groups(lazyTree, 'type').length, 2,
    'lazy expansion must preserve document-free related groups');
  vm.runInContext('allExpanded = false; groupExpandedState.clear(); pendingGroups = {}', context);
  context.groupDocsNested(entries, ['space', 'doccat']);
  const categoryPendingSpace = vm.runInContext('Object.values(pendingGroups)[0]', context);
  vm.runInContext('allExpanded = true', context);
  const lazyCategoryTree = parseHTML('<html><body>' + context.groupDocsNested(
    categoryPendingSpace.docEntries, categoryPendingSpace.dims, categoryPendingSpace.depth, categoryPendingSpace.parentPath,
  ) + '</body></html>').document;
  assert(lazyCategoryTree.body.textContent.includes('Room Manual') &&
    !lazyCategoryTree.body.textContent.includes('Pump Manual'),
  'lazy expansion must preserve the parent Space restriction for Document Category');

  context.db.components[0].Space = 'Room 1, Room 2';
  context.db.spaces[1].FloorName = 'Level 2';
  context.db.floors.push(row('Level 2', 'Facility A'));
  context.db.documents.push(
    doc('Level 1 Manual', 'Facility A', 'Floor', 'Level 1'),
    doc('Level 2 Manual', 'Facility A', 'Floor', 'Level 2'),
  );
  context.buildIdx();
  context.sel.space.add('room 1');
  const sharedComponent = context.db.components[0];
  assert.deepStrictEqual([...context.buildGroupMap([sharedComponent], 'space').keys()], ['Room 1'],
    'Asset view must not group a shared component under an unselected Space');
  assert.deepStrictEqual([...context.buildGroupMap([sharedComponent], 'floor').keys()], ['Level 1'],
    'Asset view must derive Floor groups from the selected Space');
  const sharedCard = context.card(sharedComponent);
  assert(sharedCard.includes('Room 1') && !sharedCard.includes('Room 2'),
    'Asset cards must only display selected Spaces while the Space filter is active');
  const sharedCounts = {};
  const sharedEntries = context._documentViewEntries(sharedCounts);
  const sharedTree = parseHTML('<html><body>' + context.groupDocsNested(sharedEntries, ['space', 'type']) + '</body></html>').document;
  assert.deepStrictEqual(groups(sharedTree, 'space').map(header => header.querySelector('.grp-name').textContent), ['Room 1'],
    'Document view must not show unselected Space groups for shared components');
  const sharedDocuments = context._documentEntriesForLeaf(sharedEntries, []).map(entry => entry.doc.Name);
  assert(sharedDocuments.includes('Room Manual') && sharedDocuments.includes('Level 1 Manual') &&
    sharedDocuments.includes('Pump Manual') && !sharedDocuments.includes('Room 2 Manual') &&
    !sharedDocuments.includes('Level 2 Manual'),
  'Space filtering must retain shared asset documents but exclude other Spaces and their Floor documents');
  assert(sharedCounts.space['room 2'] > 0,
    'Space cross-filter counts must still allow selecting another Space');
  context.sel.floor.add('level 2');
  context.sel.doccat.add('pm_70');
  const conflictingCounts = {};
  const conflictingEntries = context._documentViewEntries(conflictingCounts);
  assert.strictEqual(conflictingEntries.length, 0,
    'a Floor selected through another Space must not match the selected Space');
  assert(conflictingCounts.space['room 2'] > 0,
    'Space cross-counts must ignore the current Space selection, including with a Document Category selected');
  context.sel.floor.clear();
  context.sel.doccat.clear();
  context.sel.space.add('room 2');
  const bothSpaces = context._documentViewEntries({});
  const bothSpaceTree = parseHTML('<html><body>' + context.groupDocsNested(bothSpaces, ['space']) + '</body></html>').document;
  assert.deepStrictEqual(groups(bothSpaceTree, 'space').map(header => header.querySelector('.grp-name').textContent).sort(),
    ['Room 1', 'Room 2'], 'multiple selected Spaces must all remain visible');
  const bothDocuments = context._documentEntriesForLeaf(bothSpaces, []).map(entry => entry.doc.Name);
  assert(bothDocuments.includes('Room 2 Manual') && bothDocuments.includes('Level 2 Manual'),
    'documents for each selected Space and its Floor must remain available');
  context.sel.space.delete('room 1');
  const secondRoomDocuments = context._documentEntriesForLeaf(context._documentViewEntries({}), [])
    .map(entry => entry.doc.Name);
  assert(secondRoomDocuments.includes('Room 2 Manual') && secondRoomDocuments.includes('Level 2 Manual') &&
    !secondRoomDocuments.includes('Room Manual') && !secondRoomDocuments.includes('Level 1 Manual'),
  'filtering the other Space must exclude documents belonging only to the first Space and Floor');
  context.sel.space.clear();
  assert.deepStrictEqual([...context.buildGroupMap([sharedComponent], 'space').keys()], ['Room 1', 'Room 2'],
    'clearing the Space filter must restore all component Space groups');

  Object.values(context.sel).forEach(values => values.clear());
  context.db.components = Array.from({ length:2000 }, (_, index) =>
    row('Component ' + index, 'Bulk Facility', { TypeName:'Bulk Type' }));
  context.idx.types = ['Bulk Type'];
  context.idx.documentLinkContexts = Array.from({ length:2000 }, (_, index) => {
    const document = doc('Shared ' + index, 'Bulk Facility', 'Facility', 'Bulk Facility');
    return {
      doc:document, identity:context._docUniqueKey(document), linkedType:'facility', linkedName:'Bulk Facility',
      categories:new Set(['pm_70']), components:new Set(),
    };
  });
  const bulkCounts = {};
  const bulkEntries = context._documentViewEntries(bulkCounts);
  assert.strictEqual(bulkEntries.length, 2000, 'shared documents must not create one entry per component-document pair');
  assert.strictEqual(new Set(bulkEntries.flatMap(entry => entry.docGroups)).size, 1,
    'components must share one relationship document list');
  assert.strictEqual(context._documentEntriesForLeaf(bulkEntries, []).length, 2000);
  assert.strictEqual(bulkCounts.doccat.pm_70, 2000);
  vm.runInContext('allExpanded = false; groupExpandedState.clear(); pendingGroups = {}', context);
  const bulkTree = parseHTML('<html><body>' + context.groupDocsNested(bulkEntries, ['facility']) + '</body></html>').document;
  assert.strictEqual(bulkTree.querySelector('.grp-cnt').textContent, '2000',
    'group counts must remain correct with thousands of shared documents');
  const bulkCategoryTree = context.groupDocsNested(bulkEntries, ['doccat', 'type']);
  assert(bulkCategoryTree.includes('PM_70'), 'category grouping must handle shared document lists without expanding pairs');
  context.idx.documentLinkContexts.forEach((entry, index) => {
    entry.doc.Category = 'PM_70_' + String(index % 200).padStart(3, '0');
  });
  vm.runInContext('pendingGroups = {}', context);
  context.groupDocsByClassification(bulkEntries, ['type'], 1, 'pm_70');
  const categoryPending = vm.runInContext('Object.values(pendingGroups)', context);
  assert.strictEqual(categoryPending.length, 200);
  assert(categoryPending.every(pendingGroup => pendingGroup.docEntries === bulkEntries),
    'collapsed categories must share their source paths rather than copy them for every category');

  buckets.forEach(bucket => { context.db[bucket] = savedRows[bucket]; });
  Object.entries(savedSelections).forEach(([dim, values]) => { context.sel[dim] = values; });
  if (!savedSelections.zone) delete context.sel.zone;
  context.searchQuery = savedSearch;
  vm.runInContext(`allExpanded = ${savedExpanded}`, context);
  context.buildIdx();
}

module.exports = { runDocumentViewRegression };
