// ── Schema-generated modal model configuration ──────────────

const MODEL_MODAL_PRESENTATION = Object.freeze({
  facility:{ title:'Project Information', colorToken:'facility' },
  floor:{ title:'Floor Information', colorToken:'floor' },
  space:{ title:'Space Information', colorToken:'space' },
  zone:{ title:'Zone Information', colorToken:'space' },
  type:{ title:'Type Information', colorToken:'type' },
  system:{ title:'System Information', colorToken:'system' },
  component:{ title:'Component Information', colorToken:'component' },
  contact:{ title:'Contact Information', colorToken:'contact' },
});

const MODEL_MODAL_FIELD_LABELS = Object.freeze({
  'space.floorname':'Floor',
  'component.typename':'Type',
  'type.warrantyguarantorparts':'Parts Guarantor',
  'type.warrantydurationparts':'Parts Duration',
  'type.warrantyguarantorlabor':'Labour Guarantor',
  'type.warrantydurationlabor':'Labour Duration',
  'contact.company':'Company / Organisation',
  'contact.organizationcode':'Organisation Code',
  'contact.town':'Town / City',
  'contact.stateregion':'State / Region',
});

const MODEL_MODAL_AUXILIARY_CARDS = Object.freeze({
  facility:['attributes', 'documents'],
  floor:['attributes', 'documents'],
  space:['attributes', 'documents'],
  type:['attributes', 'documents'],
  system:['attributes', 'documents'],
  component:['attributes', 'documents'],
});

const MODEL_MODAL_RELATIONSHIPS = Object.freeze([
  { source:'space', column:'FloorName', target:'floor', owner:'floor', key:'spaces', label:'Spaces', cardinality:'many' },
  { source:'space', column:'FloorName', target:'floor', owner:'space', key:'floor', label:'Floor', cardinality:'one' },
  { source:'component', column:'Space', target:'space', owner:'space', key:'components', label:'Components', cardinality:'many' },
  { source:'component', column:'TypeName', target:'type', owner:'type', key:'components', label:'Components', cardinality:'many' },
  { source:'system', column:'ComponentNames', target:'component', owner:'system', key:'components', label:'Components', cardinality:'many' },
  { source:'component', column:'TypeName', target:'type', owner:'component', key:'type', label:'Type', cardinality:'one' },
  { source:'component', column:'Space', target:'space', owner:'component', key:'space', label:'Space', cardinality:'one' },
  { source:'system', column:'ComponentNames', target:'component', owner:'component', key:'systems', label:'Systems', cardinality:'many' },
]);

let MODEL_CONFIG_SCHEMA_STATUS = { loaded:false, error:'' };

function _modalConfigNorm(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _modalConfigLabel(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function _modalConfigChildren(parent, localName) {
  const key = _modalConfigNorm(localName);
  return Array.from(parent?.childNodes || []).filter(node =>
    node?.nodeType === 1 && _modalConfigNorm(node.localName || node.nodeName) === key
  );
}

function _modalConfigAliases(column) {
  const names = [
    column.getAttribute('name') || '',
    ...String(column.getAttribute('aliases') || '').split('|'),
  ].map(value => value.trim()).filter(Boolean);
  const merged = [];
  const seen = new Set();
  [...names, ..._cobieFieldAliasesFor(names[0])].forEach(alias => {
    const key = String(alias || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(String(alias).trim());
  });
  return merged;
}

function _modalConfigReferenceMap(sheetNode) {
  const references = _modalConfigChildren(sheetNode, 'references')[0];
  return new Map(_modalConfigChildren(references, 'reference').map(reference => [
    _modalConfigNorm(reference.getAttribute('column')),
    _modalConfigNorm(reference.getAttribute('targetSheet')),
  ]));
}

function _modalConfigField(entityType, column, references) {
  const name = String(column.getAttribute('name') || '').trim();
  const key = _modalConfigNorm(name);
  const targetType = references.get(key) || '';
  const categoryLookup = key === 'category' && entityType !== 'contact';
  const lookupSource = categoryLookup ? 'category' : targetType;
  return {
    label:MODEL_MODAL_FIELD_LABELS[`${entityType}.${key}`] || _modalConfigLabel(name),
    aliases:_modalConfigAliases(column),
    edit:lookupSource ? 'lookup' : 'text',
    ...(lookupSource ? { lookupSource } : {}),
  };
}

function _modalConfigRelationshipSet(sheetNodes) {
  const relationships = new Set();
  sheetNodes.forEach(sheetNode => {
    const source = _modalConfigNorm(sheetNode.getAttribute('name'));
    const references = _modalConfigChildren(sheetNode, 'references')[0];
    _modalConfigChildren(references, 'reference').forEach(reference => {
      relationships.add([
        source,
        _modalConfigNorm(reference.getAttribute('column')),
        _modalConfigNorm(reference.getAttribute('targetSheet')),
      ].join('|'));
    });
  });
  return relationships;
}

function _modalConfigAuxiliaryCard(mode, colorToken) {
  return {
    title:mode === 'attributes' ? 'Additional Attributes' : 'Documents',
    colorToken:mode === 'documents' ? 'doccat' : colorToken,
    mode,
  };
}

function _buildModelModalConfig() {
  const xml = _cobieSchemaDocument();
  if (!xml) {
    MODEL_CONFIG_SCHEMA_STATUS = {
      loaded:false,
      error:`${COBIE_SCHEMA_STATUS.error || 'COBie XML could not be loaded.'} Modal configuration was not generated.`,
    };
    console.error(MODEL_CONFIG_SCHEMA_STATUS.error);
    return {};
  }

  const sheetsNode = _modalConfigChildren(xml.documentElement, 'sheets')[0];
  const sheetNodes = _modalConfigChildren(sheetsNode, 'sheet');
  if (!sheetNodes.length) {
    MODEL_CONFIG_SCHEMA_STATUS = { loaded:false, error:'COBie XML has no sheets; modal configuration was not generated.' };
    console.error(MODEL_CONFIG_SCHEMA_STATUS.error);
    return {};
  }

  const relationshipSet = _modalConfigRelationshipSet(sheetNodes);
  const config = {};
  sheetNodes.forEach(sheetNode => {
    const entityType = _modalConfigNorm(sheetNode.getAttribute('name'));
    const presentation = MODEL_MODAL_PRESENTATION[entityType];
    if (!presentation) return;

    const references = _modalConfigReferenceMap(sheetNode);
    const columnsNode = _modalConfigChildren(sheetNode, 'columns')[0];
    const cards = {};
    _modalConfigChildren(columnsNode, 'column').forEach(column => {
      const groupTitle = String(column.getAttribute('groupTitle') || '').trim();
      if (!groupTitle) return;
      const cardKey = _modalConfigNorm(groupTitle) || 'information';
      if (!cards[cardKey]) {
        cards[cardKey] = { title:groupTitle, colorToken:presentation.colorToken, fields:[] };
      }
      cards[cardKey].fields.push(_modalConfigField(entityType, column, references));
    });

    const associations = MODEL_MODAL_RELATIONSHIPS.filter(relationship =>
      relationship.owner === entityType && relationshipSet.has([
        relationship.source,
        _modalConfigNorm(relationship.column),
        relationship.target,
      ].join('|'))
    ).map(({ key, label, target, cardinality }) => ({ key, label, targetType:target, cardinality }));
    if (associations.length) {
      cards.associations = {
        title:'Associations',
        colorToken:presentation.colorToken,
        mode:'associations',
        associations,
      };
    }

    (MODEL_MODAL_AUXILIARY_CARDS[entityType] || []).forEach(mode => {
      cards[mode] = _modalConfigAuxiliaryCard(mode, presentation.colorToken);
    });
    config[entityType] = {
      title:presentation.title,
      headerColorToken:presentation.colorToken,
      cards,
    };
  });

  const documentAssociations = ['facility', 'floor', 'space', 'type', 'component', 'system'].map(targetType => ({
    key:targetType === 'facility' ? 'facilities' : `${targetType}s`,
    label:targetType === 'facility' ? 'Facilities' : `${_modalConfigLabel(targetType)}s`,
    targetType,
    cardinality:'many',
  }));
  config.document = {
    title:'Document Information',
    headerColorToken:'doccat',
    cards:{
      identification:{
        title:'Identification',
        colorToken:'doccat',
        fields:[
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Directory', aliases:['Directory'], edit:'text' },
          { label:'Created By', aliases:_cobieFieldAliasesFor('CreatedBy'), edit:'lookup', lookupSource:'contact' },
        ],
      },
      applicableTo:{
        title:'Applicable to',
        colorToken:'doccat',
        mode:'association-summary',
        associations:documentAssociations,
      },
      associations:{
        title:'Associations',
        colorToken:'doccat',
        mode:'associations',
        associations:documentAssociations,
      },
    },
  };

  MODEL_CONFIG_SCHEMA_STATUS = { loaded:true, error:'' };
  return config;
}

const MODEL_MODAL_CONFIG = Object.freeze(_buildModelModalConfig());