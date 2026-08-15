function runDocumentViewRegression({ assert, context, fs, path, javascriptDir, loadModule, vm }) {
  loadModule('documents.js');
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
  loadModule('results.js');
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
}

module.exports = { runDocumentViewRegression };
