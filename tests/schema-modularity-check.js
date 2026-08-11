const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { DOMParser } = require('linkedom');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'dev', 'javascript');
const schemaPath = path.join(root, 'dev', 'specification', 'guerrilla-ops-schema.xml');
const schemaSource = fs.readFileSync(schemaPath, 'utf8');
execFileSync(process.env.PYTHON || 'python', [
  '-c',
  'import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])',
  schemaPath,
]);
const schemaDocument = new DOMParser().parseFromString(schemaSource, 'application/xml');
assert(!schemaDocument.querySelector('parsererror'), 'the COBie schema must be valid XML');

const columns = [...schemaDocument.querySelectorAll('sheets > sheet > columns > column')];
const flatAttributes = ['checks', 'groupTitle', 'stage', 'aliases', 'search', 'lookupSource'];
assert(columns.length > 0, 'the schema must define columns');
assert(columns.every(column => flatAttributes.every(attribute => !column.hasAttribute(attribute))),
  'column QA, UI, and runtime metadata must not use legacy flat attributes');

const column = (sheetName, columnName) => [...schemaDocument.querySelectorAll('sheets > sheet')]
  .find(sheet => sheet.getAttribute('name') === sheetName)
  ?.querySelector(`:scope > columns > column[name="${columnName}"]`);
const contactEmail = column('Contact', 'Email');
const contactEmailRules = contactEmail.querySelector(':scope > qa > rule').getAttribute('name').split('|');
assert(contactEmailRules.includes('NotNull'));
assert(contactEmailRules.includes('Unique') || contactEmail.querySelector(':scope > qa > unique'),
  'uniqueness must be activated by either a rule token or a unique tag');
assert.strictEqual(contactEmail.querySelector(':scope > qa > format').getAttribute('name'), 'email');
assert.strictEqual(contactEmail.querySelector(':scope > ui').getAttribute('groupTitle'), 'Identification');
assert.strictEqual(contactEmail.querySelector(':scope > ui').getAttribute('label'), 'Email Address');

const componentName = column('Component', 'Name');
assert.strictEqual(componentName.querySelector(':scope > runtime').getAttribute('search'), 'true');
const typeCategory = column('Type', 'Category');
assert.strictEqual(typeCategory.querySelector(':scope > qa > rule').getAttribute('name'), 'NotNull');
assert.strictEqual(typeCategory.querySelector(':scope > qa > reference').getAttribute('targetColumn'), 'Category-Product');
const typeReference = column('Component', 'TypeName').querySelector(':scope > qa > reference');
assert(typeReference && !typeReference.hasAttribute('ruleId'), 'reference rule IDs must be generated');
assert.strictEqual(typeReference.querySelector(':scope > runtime').getAttribute('forwardIndex'), 'byType');
assert.strictEqual(typeReference.querySelector(':scope > runtime').getAttribute('searchAttributes'), 'true');

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
  db:{
    contacts:[], facilities:[], floors:[], spaces:[], zones:[], types:[], components:[], systems:[],
    documents:[], attributes:[], coordinates:[], picklists:[],
  },
  idx:{},
  sel:{},
  searchQuery:'',
};
vm.createContext(context);
['utils.js', 'qa.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), context, { filename:file });
});
const parsed = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const schema = _qaParseSchema();
  const contact = schema.sheets.find(sheet => sheet.name === 'Contact');
  const component = schema.sheets.find(sheet => sheet.name === 'Component');
  return {
    error:schema.error,
    contactReference:contact.references.find(reference => reference.column === 'CreatedBy'),
    typeCategoryReference:schema.sheets.find(sheet => sheet.name === 'Type').references
      .find(reference => reference.column === 'Category'),
    componentReference:component.references.find(reference => reference.column === 'TypeName'),
    runtimeReference:COBIE_RUNTIME_MODEL.indexReferences.find(reference => reference.forwardIndex === 'byType'),
    referenceDescription:_qaRuleDescriptionForCheck('Contact.CreatedBy.Reference'),
  };
})())`, context));
assert.strictEqual(parsed.error, '', 'the modular schema must parse without QA errors');
assert.strictEqual(parsed.contactReference.ruleId, 'Contact.CreatedBy.Reference');
assert.strictEqual(parsed.typeCategoryReference.targetSheet, 'Picklist');
assert.strictEqual(parsed.typeCategoryReference.targetColumn, 'Category-Product');
assert.strictEqual(parsed.componentReference.ruleId, 'Component.TypeName.Reference');
assert.strictEqual(parsed.runtimeReference.name, 'Component.TypeName.Reference');
assert.strictEqual(parsed.referenceDescription,
  'Must match the referenced Name or key column in another worksheet.');

const extensionSheet = `
    <sheet name="AssetRegister" identityField="AssetId">
      <columns>
        <column name="AssetId"><ui groupTitle="Identification"/></column>
        <column name="FutureColumn"><ui groupTitle="Information"/></column>
      </columns>
    </sheet>`;
const extendedSchemaSource = schemaSource.replace(/\s*<\/sheets>/, `${extensionSheet}\n  </sheets>`);
class ExtendedSchemaRequest {
  open() {}
  send() {
    this.status = 200;
    this.responseText = extendedSchemaSource;
  }
}
const extendedContext = {
  console,
  DOMParser,
  XMLHttpRequest:ExtendedSchemaRequest,
  XLSX:{ utils:{ sheet_to_json:sheet => sheet.rows || [] } },
  db:{},
  idx:{},
  sel:{},
  lastCounts:{},
  selectedCategoryLevels:{},
};
vm.createContext(extendedContext);
['utils.js', 'cobie-parser.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), extendedContext, { filename:file });
});
const extensionResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const workbook = { Sheets:{
    Facility:{ rows:[{ Name:'Test Facility' }] },
    AssetRegister:{ rows:[{ AssetId:'A-001', FutureColumn:'Preserved' }] },
  } };
  parseCOBieInto(workbook, 'extension.xlsx', null, null);
  const descriptor = _cobieEntityDescriptor('AssetRegister');
  return {
    bucket:descriptor.bucket,
    initialized:Array.isArray(db[descriptor.bucket]),
    row:db[descriptor.bucket][0],
  };
})())`, extendedContext));
assert.strictEqual(extensionResult.bucket, 'assetregisters', 'sheets without a bucket must receive a stable default');
assert(extensionResult.initialized, 'schema-defined buckets must be initialized before workbook parsing');
assert.strictEqual(extensionResult.row.AssetId, 'A-001', 'new schema sheets must import without parser changes');
assert.strictEqual(extensionResult.row.FutureColumn, 'Preserved', 'new schema columns must survive import');

const futureSchemaSource = schemaSource
  .replace('version="2.0"', 'version="3.0"')
  .replace('profile="NBIMS-US-V3-current-rules"', 'profile="COBie-future-compatible"');
class FutureSchemaRequest {
  open() {}
  send() {
    this.status = 200;
    this.responseText = futureSchemaSource;
  }
}
const futureContext = {
  console,
  DOMParser,
  XMLHttpRequest:FutureSchemaRequest,
  db:{},
  idx:{},
  sel:{},
  lastCounts:{},
  selectedCategoryLevels:{},
};
vm.createContext(futureContext);
['utils.js', 'qa.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(javascriptDir, file), 'utf8'), futureContext, { filename:file });
});
const futureResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const schema = _qaParseSchema();
  return { error:schema.error, profile:schema.profile, version:schema.version, sheets:schema.sheets.length };
})())`, futureContext));
assert.strictEqual(futureResult.error, '', 'structurally compatible future profiles must not be rejected by name or version');
assert.strictEqual(futureResult.profile, 'COBie-future-compatible');
assert.strictEqual(futureResult.version, '3.0');
assert(futureResult.sheets > 0, 'future compatible profiles must retain their sheet definitions');

console.log('Schema modularity checks passed.');
