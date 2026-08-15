function runReleaseHtmlRegression({ assert, fs, path, root, vm, qaSchemaSource, releaseBuilderSource }) {
  assert(releaseBuilderSource.includes("module == 'utils.js'") && releaseBuilderSource.includes('QA_SCHEMA_SOURCE'),
    'standalone builds must embed the active COBie XML profile once through the shared schema loader');
  [
    fs.readFileSync(path.join(root, '..', 'release', 'Guerrilla-Ops-Airgapped.html'), 'utf8'),
    fs.readFileSync(path.join(root, '..', 'release', 'Guerrilla-Ops.html'), 'utf8'),
  ].forEach((standaloneSource, index) => {
    const embedded = standaloneSource.match(/const _COBIE_EMBEDDED_SCHEMA\s*=\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"));/);
    assert(embedded, `standalone output ${index + 1} must contain an embedded COBie XML string`);
    assert.strictEqual(vm.runInNewContext(embedded[1]), qaSchemaSource,
      `standalone output ${index + 1} must embed the exact current QA XML source`);
    assert(!standaloneSource.includes('_qaDefaultSchema') && !standaloneSource.includes('fallbackUsed'),
      `standalone output ${index + 1} must not contain legacy QA fallback code`);
    assert(!standaloneSource.includes('specification/guerrilla-ops-schema.xml'),
      `standalone output ${index + 1} must not reference an external QA XML file`);
    assert(/const _COBIE_SCHEMA_PATHS\s*=\s*Object\.freeze\(\[\]\);/.test(standaloneSource),
      `standalone output ${index + 1} must disable external COBie schema loading`);
    assert(/const xmlText\s*=\s*_COBIE_EMBEDDED_SCHEMA;/.test(standaloneSource) &&
      !standaloneSource.includes('_COBIE_EMBEDDED_SCHEMA || _cobieReadXmlSync'),
      `standalone output ${index + 1} must load COBie metadata exclusively from embedded XML`);
  });
}

module.exports = { runReleaseHtmlRegression };
