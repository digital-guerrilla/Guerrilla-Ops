function runDevChannelRegression({ assert, fs, path, javascriptDir, devIndexSource,
  currentJavascriptSource, qaSource, qaResultsSource, modelConfigSource, qaGraphSource,
  appLifecycleSource, modalsSource, resultsCssSource, qaSchemaSource }) {
  assert(!qaSource.includes('bi-pencil') && !qaSource.includes('data-edit-entity'),
    'QA finding cards must use only the editable information action');
  assert(modelConfigSource.includes('const MODEL_MODAL_CONFIG = Object.freeze(_buildModelModalConfig());') &&
    !modelConfigSource.includes('const MODEL_MODAL_CONFIG = Object.freeze({'),
    'modal configuration must be generated from the COBie XML rather than a hardcoded object');
  assert(!modelConfigSource.includes('MODEL_MODAL_PRESENTATION') && !modelConfigSource.includes('MODEL_MODAL_FIELD_LABELS'),
    'modal presentation and exceptional field labels must come from nested XML UI metadata');
  assert(!fs.readFileSync(path.join(javascriptDir, 'documents.js'), 'utf8').includes('function collectDocsForComps'),
    'the obsolete hardcoded document relationship traversal must remain removed');
  assert(!currentJavascriptSource.includes('db.facility') &&
    !modalsSource.includes('function _projectEntityIdentity') && !modalsSource.includes('_editNameConflict'),
    'obsolete single-facility state and modal compatibility hooks must remain removed');

  const placementSource = fs.readFileSync(path.join(javascriptDir, 'component-placement.js'), 'utf8');
  const placementApplySource = placementSource.slice(placementSource.indexOf("const applyBtn = event.target.closest('[data-component-placement-apply]')"));
  assert(placementApplySource.includes('_projectApplyMutation({') && !placementApplySource.includes('buildIdx();'),
    'component placement must use incremental mutation handling instead of rebuilding every index');
  assert(modalsSource.includes('let _projectMutationRenderPending = false;') &&
    modalsSource.includes('function _projectFlushMutationRender()'),
    'modal mutations must coalesce hidden result refreshes until the modal closes');

  const inlineLookupSource = modalsSource.slice(modalsSource.indexOf('function _projectCreateFloatingLookup'),
    modalsSource.indexOf('function _projectFilterDocuments'));
  assert(inlineLookupSource.includes('handleKeydown:event =>') &&
    inlineLookupSource.includes('if (floatingLookup?.handleKeydown(event)) return;'),
    'field lookup dropdowns must select their highlighted option before committing raw Enter input');
  assert(!inlineLookupSource.includes('setTimeout(() =>') && inlineLookupSource.includes("event.key === 'ArrowDown'"),
    'field lookup dropdowns must avoid delayed blur races and support arrow-key navigation');
  assert(inlineLookupSource.includes("editor.dataset.finishing === 'true'") &&
    inlineLookupSource.includes('event.stopPropagation();'),
    'lookup commits must be idempotent and Escape must not close the containing modal');

  const finishFieldSource = modalsSource.slice(modalsSource.indexOf('function _projectFinishFieldEdit'),
    modalsSource.indexOf('function _projectFinishAttributeEdit'));
  assert(finishFieldSource.indexOf("let qaPreviousName = '';") < finishFieldSource.indexOf('if (commit && newValue !== oldValue') &&
    finishFieldSource.includes('previousName:qaPreviousName'),
    'entity rename state must remain in scope through index and group-header mutation handling');
  const associationEventsSource = modalsSource.slice(modalsSource.indexOf("_projectModalEl.addEventListener('change'"),
    modalsSource.indexOf("_projectModalEl.addEventListener('click', event => {", modalsSource.indexOf("_projectModalEl.addEventListener('change'")));
  assert(associationEventsSource.includes('state && input.type === \'checkbox\'') &&
    associationEventsSource.includes("event.key === 'Escape'") && associationEventsSource.includes("event.key === 'Enter'") &&
    associationEventsSource.includes('event.stopPropagation();'),
    'association dropdowns must keep range anchors checkbox-only and support keyboard selection/closing');
  assert(modalsSource.includes("focused.closest?.('.project-association') === control") &&
    modalsSource.includes('refreshedHost.scrollTop = scrollTop'),
    'association dropdown rerenders must preserve focused options and scroll position');
  const mutationCoordinatorSource = modalsSource.slice(modalsSource.indexOf('function _projectApplyMutation'),
    modalsSource.indexOf('function _projectAssociationMutationChanges'));
  assert(mutationCoordinatorSource.includes('qaRevalidateFieldChanges(qaChanges)') &&
    !mutationCoordinatorSource.includes('qaRevalidateFieldChange('),
    'multi-row mutations must update QA and its graph once per batch');

  const floorSvgSource = fs.readFileSync(path.join(javascriptDir, 'floor-svg-panel.js'), 'utf8');
  assert(!floorSvgSource.includes('refreshDisplay();') && floorSvgSource.includes("entityType:'floor'"),
    'Floor SVG and alignment writes must use targeted mutation refreshes');
  assert(modalsSource.includes("info: { icon:'bi-info-circle-fill', color:'text-info', label:'Advisory' }") &&
    modalsSource.includes("warning: { icon:'bi-exclamation-triangle-fill', color:'text-warning', label:'Warning' }"),
    'modal QA flags must distinguish advisories from warning triangles');

  ['Reading ${file.name}', 'Decoding workbook structure', 'Merging COBie rows',
    'Rebuilding workbook indexes', 'Capturing workbook baseline', 'Rendering workspace'].forEach(stage => {
    assert(appLifecycleSource.includes(stage), `file loading progress must report the ${stage} phase`);
  });
  ['Collecting workbook rows', 'Synchronizing ${name} sheet', 'Serializing workbook and styles',
    'Packaging workbook bytes', 'Writing workbook bytes', 'Closing destination file',
    'Reopening saved workbook', 'Capturing saved baseline', 'Save complete'].forEach(stage => {
    assert(currentJavascriptSource.includes(stage), `file save progress must report the ${stage} phase`);
  });
  assert(resultsCssSource.includes('width: 50vw;') && resultsCssSource.includes('.qa-graph-collapsed'),
    'the QA graph must default to half width and support a collapsed state');
  assert(qaGraphSource.includes('_qaGraphDesiredWidth') && qaGraphSource.includes('_bindQaGraphResizeAndToggle'),
    'the QA graph must bind desktop drag resizing and click collapse behavior');
  assert(qaSchemaSource.includes('profile="NBIMS-US-V3-current-rules"'),
    'QA must use the current named NBIMS rule profile');
}

module.exports = { runDevChannelRegression };
