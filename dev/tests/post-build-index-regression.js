function runPostBuildIndexRegression({ assert, fs, path, root, javascriptDir, devIndexSource,
  qaResultsSource, appLifecycleSource, currentJavascriptSource }) {
  assert(!devIndexSource.includes('id="edit-modal"') && !devIndexSource.includes('javascript/edit.js'),
    'post-build index must not contain or load the legacy edit modal');
  assert(qaResultsSource.includes('active: new Set()') && !appLifecycleSource.includes("groupState.active.add('type')") &&
    !devIndexSource.includes('class="group-chip gchip-active" data-dim="type"'),
    'post-build index must not default result grouping to Type');
  assert(devIndexSource.includes('id="qa-graph-edge-toggle"'),
    'the post-build index must expose the QA graph edge control');
  assert(devIndexSource.includes('id="file-operation-progress"') && appLifecycleSource.includes('function _fileOperationProgress'),
    'the post-build index must expose the shared file-operation progress surface');
  assert(devIndexSource.includes('<span id="go-logo-hdr" class="go-logo go-logo-hdr" aria-hidden="true"></span>'),
    'the post-build index must provide the header logo host');
  assert(devIndexSource.includes('<span id="go-logo-upload" class="go-logo go-logo-upload" aria-hidden="true"></span>'),
    'the post-build index must provide the upload logo host');
  assert(devIndexSource.includes('<link rel="icon" type="image/svg+xml" href="svgs/Guerrilla-Ops.svg">'),
    'the post-build index must use the canonical SVG favicon');
  assert(!devIndexSource.includes('id="create-modal"'), 'the post-build index must not contain the legacy Create Item modal');
  assert(!fs.readFileSync(path.join(javascriptDir, 'create.js'), 'utf8').includes('saveCreate'),
    'the legacy Create Item form engine must remain absent');
  ['openEditModal', 'data-edit-entity', "getElementById('edit-modal')", '_editState'].forEach(reference => {
    assert(!currentJavascriptSource.includes(reference), `legacy edit modal reference must remain removed: ${reference}`);
  });
}

module.exports = { runPostBuildIndexRegression };
