// ── Schema-generated modal model configuration ──────────────

const MODEL_MODAL_RELATIONSHIPS = Object.freeze(COBIE_RUNTIME_MODEL.associations);

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
  const columns = _modalConfigChildren(_modalConfigChildren(sheetNode, 'columns')[0], 'column');
  return new Map(columns.filter(column => String(column.getAttribute('checks') || '').split('|').includes('CrossReference'))
    .map(column => [column, _modalConfigChildren(column, 'reference')[0]])
    .filter(([, reference]) => reference)
    .map(([column, reference]) => [
        _modalConfigNorm(column.getAttribute('name')),
        _modalConfigNorm(reference.getAttribute('targetSheet')),
      ]));
}

function _modalConfigField(entityType, column, references) {
  const name = String(column.getAttribute('name') || '').trim();
  const key = _modalConfigNorm(name);
  const ui = _modalConfigChildren(column, 'ui')[0];
  const targetType = _modalConfigNorm(column.getAttribute('lookupSource')) || references.get(key) || '';
  const categoryLookup = key === 'category' && entityType !== 'contact';
  const lookupSource = categoryLookup ? 'category' : targetType;
  return {
    label:String(ui?.getAttribute('label') || '').trim() || _modalConfigLabel(name),
    aliases:_modalConfigAliases(column),
    edit:lookupSource ? 'lookup' : 'text',
    ...(lookupSource ? { lookupSource } : {}),
  };
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

  const config = {};
  sheetNodes.forEach(sheetNode => {
    const entityType = _modalConfigNorm(sheetNode.getAttribute('name'));
    const descriptor = _cobieEntityDescriptor(entityType);
    if (!descriptor?.modal) return;
    const presentation = { title:descriptor.ui.modalTitle || `${descriptor.ui.label} Information`, colorToken:descriptor.ui.colorToken };

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

    const associations = MODEL_MODAL_RELATIONSHIPS.filter(relationship => relationship.owner === entityType)
      .map(({ key, label, targetType, cardinality }) => ({ key, label, targetType, cardinality }));
    if (associations.length) {
      cards.associations = {
        title:'Associations',
        colorToken:presentation.colorToken,
        mode:'associations',
        associations,
      };
    }

    const auxiliaryModes = [
      ...(descriptor?.attributes ? ['attributes'] : []),
      ...(descriptor?.documentTarget ? ['documents'] : []),
    ];
    auxiliaryModes.forEach(mode => {
      cards[mode] = _modalConfigAuxiliaryCard(mode, presentation.colorToken);
    });
    config[entityType] = {
      title:presentation.title,
      headerColorToken:presentation.colorToken,
      cards,
    };
  });

  const documentAssociations = [..._cobieDocumentTargetTypes()].map(targetType => ({
    key:targetType === 'facility' ? 'facilities' : `${targetType}s`,
    label:targetType === 'facility' ? 'Facilities' : `${_modalConfigLabel(targetType)}s`,
    targetType,
    cardinality:'many',
  }));
  if (config.document) {
    config.document.cards.applicableTo = {
      title:'Applicable to', colorToken:'doccat', mode:'association-summary', associations:documentAssociations,
    };
    config.document.cards.associations = {
      title:'Associations', colorToken:'doccat', mode:'associations', associations:documentAssociations,
    };
  }

  MODEL_CONFIG_SCHEMA_STATUS = { loaded:true, error:'' };
  return config;
}

const MODEL_MODAL_CONFIG = Object.freeze(_buildModelModalConfig());