// ── String and value helpers ─────────────────────────────────
function v(x) {
  const s = String(x ?? '').trim();
  return (s === '' || s.toLowerCase() === 'n/a') ? '' : s;
}
function f(row, ...names) {
  for (const n of names) { const r = v(row[n]); if (r) return r; }
  return '';
}

const _COBIE_SCHEMA_PATHS = Object.freeze(['dev/specification/ids_cobie.xml', 'specification/ids_cobie.xml']);
const _COBIE_EMBEDDED_SCHEMA = '';
let _COBIE_SCHEMA_DOCUMENT_CACHE;
let COBIE_SCHEMA_STATUS = { loaded:false, error:'' };

function _cobieNormKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _cobieReadXmlSync(paths) {
  for (const p of paths) {
    try {
      const req = new XMLHttpRequest();
      req.open('GET', p, false);
      req.send(null);
      if (req.status === 200 || req.status === 0) {
        const text = req.responseText || '';
        if (text.trim()) return text;
      }
    } catch (_) {
      // Try next candidate path.
    }
  }
  return '';
}

function _cobieSchemaDocument() {
  if (_COBIE_SCHEMA_DOCUMENT_CACHE !== undefined) return _COBIE_SCHEMA_DOCUMENT_CACHE;
  const xmlText = _COBIE_EMBEDDED_SCHEMA || _cobieReadXmlSync(_COBIE_SCHEMA_PATHS);
  if (!xmlText) {
    COBIE_SCHEMA_STATUS = { loaded:false, error:'COBie XML could not be loaded.' };
    _COBIE_SCHEMA_DOCUMENT_CACHE = null;
    return null;
  }
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) {
    COBIE_SCHEMA_STATUS = { loaded:false, error:'COBie XML is invalid.' };
    _COBIE_SCHEMA_DOCUMENT_CACHE = null;
    return null;
  }
  COBIE_SCHEMA_STATUS = { loaded:true, error:'' };
  _COBIE_SCHEMA_DOCUMENT_CACHE = xml;
  return xml;
}

function _cobieEntityType(value) {
  return _cobieNormKey(value);
}

function _cobieRuntimeList(value) {
  return String(value || '').split('|').map(item => item.trim()).filter(Boolean);
}

function _cobieDirectChild(node, name) {
  return [...(node?.children || [])].find(child => _cobieNormKey(child.localName || child.nodeName) === _cobieNormKey(name)) || null;
}

function _buildCobieRuntimeModel() {
  const xml = _cobieSchemaDocument();
  const entities = new Map();
  const sheetNodes = [...(xml?.querySelectorAll('sheets > sheet') || [])];
  sheetNodes.forEach(node => {
    const type = _cobieEntityType(node.getAttribute('name'));
    if (!type) return;
    const runtime = _cobieDirectChild(node, 'runtime') || node;
    const ui = _cobieDirectChild(node, 'ui');
    const documents = _cobieDirectChild(node, 'documents');
    const validation = _cobieDirectChild(node, 'validation');
    entities.set(type, {
      type,
      sheet:String(node.getAttribute('name') || '').trim(),
      bucket:String(node.getAttribute('bucket') || '').trim(),
      identityField:String(node.getAttribute('identityField') || 'Name').trim(),
      mergeRows:runtime.getAttribute('mergeRows') === 'true',
      scopeIdentity:runtime.getAttribute('scopeIdentity') === 'true',
      modal:runtime.getAttribute('modal') === 'true',
      attributes:runtime.getAttribute('attributes') === 'true',
      listIndex:String(runtime.getAttribute('listIndex') || '').trim(),
      listFallbackSheet:_cobieEntityType(runtime.getAttribute('listFallbackSheet')),
      listFallbackField:String(runtime.getAttribute('listFallbackField') || '').trim(),
      descriptionIndex:String(runtime.getAttribute('descriptionIndex') || '').trim(),
      categoryPicklist:String(runtime.getAttribute('categoryPicklist') || '').trim(),
      categoryDimension:String(runtime.getAttribute('categoryDimension') || type).trim(),
      searchIndex:String(runtime.getAttribute('searchIndex') || '').trim(),
      documentTarget:documents?.getAttribute('target') === 'true',
      documentDimension:String(documents?.getAttribute('dimension') || '').trim(),
      validation:{
        stage:String(validation?.getAttribute('stage') || '').trim(),
        presenceRule:String(validation?.getAttribute('presenceRule') || '').trim(),
        singleRowRule:String(validation?.getAttribute('singleRowRule') || '').trim(),
      },
      ui:{
        label:String(ui?.getAttribute('label') || node.getAttribute('name') || '').trim(),
        pluralLabel:String(ui?.getAttribute('pluralLabel') || '').trim(),
        icon:String(ui?.getAttribute('icon') || '').trim(),
        colorToken:String(ui?.getAttribute('colorToken') || type).trim(),
        modalTitle:String(ui?.getAttribute('modalTitle') || '').trim(),
      },
    });
  });
  const filters = sheetNodes.map(sheet => {
    const node = _cobieDirectChild(sheet, 'filter');
    if (!node) return null;
    const source = _cobieEntityType(sheet.getAttribute('name'));
    const entity = entities.get(source);
    return {
      source,
      dimension:_cobieEntityType(node.getAttribute('dimension') || source),
      order:Number(node.getAttribute('order') || 0),
      category:node.getAttribute('category') === 'true',
      defaultActive:node.getAttribute('defaultActive') === 'true',
      contextProperty:String(node.getAttribute('contextProperty') || '').trim(),
      valueField:String(node.getAttribute('valueField') || '').trim(),
      valueIndex:String(node.getAttribute('valueIndex') || '').trim(),
      throughField:String(node.getAttribute('throughField') || '').trim(),
      throughIndex:String(node.getAttribute('throughIndex') || '').trim(),
      emptyLabel:String(node.getAttribute('emptyLabel') || 'Unassigned').trim(),
      listIndex:entity?.listIndex || (source === 'document' ? 'docCategories' : ''),
      label:entity?.ui.label || source,
      pluralLabel:entity?.ui.pluralLabel || entity?.ui.label || source,
      icon:entity?.ui.icon || 'bi-folder',
      colorToken:entity?.ui.colorToken || source,
    };
  }).filter(Boolean).sort((left, right) => left.order - right.order);
  const references = sheetNodes.flatMap(sheet => [...sheet.querySelectorAll(':scope > columns > column')]
    .filter(column => _cobieRuntimeList(column.getAttribute('checks')).includes('CrossReference'))
    .map(column => ({
      node:_cobieDirectChild(column, 'reference'),
      source:_cobieEntityType(sheet.getAttribute('name')),
      field:String(column.getAttribute('name') || '').trim(),
    })).filter(reference => reference.node));
  const indexReferences = references.filter(({ node }) => node.getAttribute('forwardIndex') || node.getAttribute('reverseIndex'))
      .map(({ node, source, field }) => ({
    name:String(node.getAttribute('ruleId') || '').trim(),
    source,
    field,
    target:_cobieEntityType(node.getAttribute('targetSheet')),
    mode:String(node.getAttribute('indexMode') || 'targetSources').trim(),
    delimiter:String(node.getAttribute('runtimeDelimiter') || node.getAttribute('multiValueDelimiter') || '').trim(),
    forwardIndex:String(node.getAttribute('forwardIndex') || '').trim(),
    reverseIndex:String(node.getAttribute('reverseIndex') || '').trim(),
  }));
  const searches = sheetNodes.filter(node => entities.get(_cobieEntityType(node.getAttribute('name')))?.searchIndex).map(sheet => {
    const source = _cobieEntityType(sheet.getAttribute('name'));
    return {
      source,
      index:entities.get(source).searchIndex,
      fields:[...sheet.querySelectorAll(':scope > columns > column[search="true"]')]
        .map(column => String(column.getAttribute('name') || '').trim()).filter(Boolean),
      includeAttributes:entities.get(source)?.attributes === true,
      joins:references.filter(reference => reference.source === source && reference.node.getAttribute('searchFields'))
        .map(reference => ({
          field:reference.field,
          target:_cobieEntityType(reference.node.getAttribute('targetSheet')),
          fields:_cobieRuntimeList(reference.node.getAttribute('searchFields')),
          includeAttributes:reference.node.getAttribute('searchAttributes') === 'true',
        })),
    };
  });
  const associations = references.flatMap(({ node, source, field }) => {
    const target = _cobieEntityType(node.getAttribute('targetSheet'));
    const delimiter = String(node.getAttribute('runtimeDelimiter') || node.getAttribute('multiValueDelimiter') || '').trim();
    return [...node.querySelectorAll(':scope > association')].map(association => {
      const owner = _cobieEntityType(association.getAttribute('ownerSheet'));
      return {
        source,
        field,
        target,
        owner,
        targetType:owner === source ? target : source,
        key:String(association.getAttribute('key') || '').trim(),
        label:String(association.getAttribute('label') || '').trim(),
        cardinality:String(association.getAttribute('cardinality') || 'one').trim(),
        delimiter,
      };
    });
  });
  const documentTargets = [...entities.values()].filter(entity => entity.documentTarget);
  const documentContexts = documentTargets.filter(entity => entity.documentDimension).map(entity => ({
    source:entity.type, field:'', sourceIndex:'', target:'', targetField:'', dimension:entity.documentDimension,
  }));
  searches.forEach(search => {
    search.joins.forEach(join => {
      const dimension = entities.get(join.target)?.documentDimension;
      if (dimension) documentContexts.push({
        source:search.source, field:join.field, sourceIndex:'', target:'', targetField:'', dimension,
      });
      references.filter(reference => reference.source === join.target && reference.node.getAttribute('documentContext') === 'true')
        .forEach(reference => documentContexts.push({
          source:search.source,
          field:join.field,
          sourceIndex:'',
          target:join.target,
          targetField:reference.field,
          dimension:entities.get(_cobieEntityType(reference.node.getAttribute('targetSheet')))?.documentDimension || 'floors',
        }));
    });
  });
  indexReferences.filter(reference => reference.reverseIndex).forEach(reference => {
    const dimension = entities.get(reference.source)?.documentDimension;
    if (dimension) documentContexts.push({
      source:reference.target, field:'', sourceIndex:reference.reverseIndex, target:'', targetField:'', dimension,
    });
  });
  const documents = {
    sheet:'document',
    categoryDimension:entities.get('document')?.categoryDimension || 'doccat',
    contexts:documentContexts,
  };
  return { entities, filters, indexReferences, searches, associations, documents };
}

const COBIE_RUNTIME_MODEL = _buildCobieRuntimeModel();
const COBIE_FILTER_DIMENSIONS = Object.freeze(COBIE_RUNTIME_MODEL.filters);
if (typeof sel !== 'undefined' && typeof lastCounts !== 'undefined' && typeof selectedCategoryLevels !== 'undefined') {
  COBIE_FILTER_DIMENSIONS.forEach(filter => {
    if (!sel[filter.dimension]) sel[filter.dimension] = new Set();
    if (!lastCounts[filter.dimension]) lastCounts[filter.dimension] = {};
    if (filter.category && !selectedCategoryLevels[filter.dimension]) selectedCategoryLevels[filter.dimension] = new Set();
  });
}
if (typeof _GRP_ICONS !== 'undefined' && typeof _GRP_LABELS !== 'undefined') {
  COBIE_RUNTIME_MODEL.entities.forEach(entity => {
    _GRP_ICONS[entity.type] = entity.ui.icon;
    _GRP_LABELS[entity.type] = entity.ui.label;
  });
  COBIE_FILTER_DIMENSIONS.forEach(filter => {
    _GRP_ICONS[filter.dimension] = filter.icon;
    _GRP_LABELS[filter.dimension] = filter.label;
  });
}

function _cobieEntityDescriptor(entityType) {
  return COBIE_RUNTIME_MODEL.entities.get(_cobieEntityType(entityType)) || null;
}

function _cobieFilterDescriptor(dimension) {
  const key = _cobieEntityType(dimension);
  return COBIE_FILTER_DIMENSIONS.find(filter => filter.dimension === key) || null;
}

function _cobieDocumentCategoryDimension() {
  return COBIE_RUNTIME_MODEL.documents.categoryDimension;
}

function _cobieScopeFilterDimension() {
  return COBIE_FILTER_DIMENSIONS.find(filter => _cobieEntityDescriptor(filter.source)?.scopeIdentity)?.dimension || 'facility';
}

function _cobieEntityUi(entityType) {
  return _cobieEntityDescriptor(entityType)?.ui || { label:String(entityType || ''), pluralLabel:'', icon:'bi-folder', colorToken:'' };
}

function _cobieEntityBucket(entityType) {
  const type = _cobieEntityType(entityType);
  if (!type) return '';
  return _cobieEntityDescriptor(type)?.bucket || (type.endsWith('y') ? `${type.slice(0, -1)}ies` : `${type}s`);
}

function _cobieSheetName(entityType) {
  const type = _cobieEntityType(entityType);
  return _cobieEntityDescriptor(type)?.sheet || type;
}

function _cobieEntityIdentity(entityType, row, fallback = '') {
  const descriptor = _cobieEntityDescriptor(entityType);
  if (descriptor?.scopeIdentity && row?._facility) return String(row._facility).trim();
  return String(f(row || {}, descriptor?.identityField || 'Name') || fallback).trim();
}

function _cobieDocumentTargetTypes() {
  return new Set([...COBIE_RUNTIME_MODEL.entities.values()]
    .filter(descriptor => descriptor.documentTarget).map(descriptor => descriptor.type));
}

function _cobieSchemaRelationships() {
  const xml = _cobieSchemaDocument();
  if (!xml) return [];
  return [...xml.querySelectorAll('sheets > sheet')].flatMap(sheet => {
    const source = _cobieEntityType(sheet.getAttribute('name'));
    return [...sheet.querySelectorAll(':scope > columns > column')]
      .filter(column => _cobieRuntimeList(column.getAttribute('checks')).includes('CrossReference'))
      .map(column => ({ column, reference:_cobieDirectChild(column, 'reference') }))
      .filter(({ reference }) => reference)
      .map(({ column, reference }) => ({
      source,
      field:String(column.getAttribute('name') || '').trim(),
      target:_cobieEntityType(reference.getAttribute('targetSheet')),
      targetField:String(reference.getAttribute('targetColumn') || 'Name').trim(),
      delimiter:String(reference.getAttribute('multiValueDelimiter') || '').trim(),
    })).filter(relationship => relationship.source && relationship.target);
  });
}

const COBIE_SCHEMA_RELATIONSHIPS = Object.freeze(_cobieSchemaRelationships());

function _cobieDependentEntityTypes(entityTypes) {
  const dependencies = new Set((Array.isArray(entityTypes) ? entityTypes : [entityTypes])
    .map(_cobieEntityType).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    COBIE_SCHEMA_RELATIONSHIPS.forEach(relationship => {
      if (!dependencies.has(relationship.target) || dependencies.has(relationship.source)) return;
      dependencies.add(relationship.source);
      changed = true;
    });
  }
  return dependencies;
}

function _buildCobieSchemaAliasMap() {
  const map = new Map();
  const xml = _cobieSchemaDocument();
  if (!xml) return map;

  const upsert = names => {
    const list = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))];
    if (!list.length) return;
    const merged = [...list];
    list.forEach(name => {
      const existing = map.get(_cobieNormKey(name));
      if (!existing) return;
      existing.forEach(alias => {
        if (!merged.some(item => _cobieNormKey(item) === _cobieNormKey(alias))) merged.push(alias);
      });
    });
    merged.forEach(name => map.set(_cobieNormKey(name), merged));
  };

  xml.querySelectorAll('sheets > sheet > columns > column').forEach(column => {
    const primary = column.getAttribute('name') || '';
    const aliases = String(column.getAttribute('aliases') || '')
      .split('|').map(value => value.trim()).filter(Boolean);
    upsert([primary, ...aliases]);
  });

  return map;
}

const _COBIE_SCHEMA_ALIAS_MAP = _buildCobieSchemaAliasMap();

function _cobieFieldAliasesFor(field) {
  const aliases = _COBIE_SCHEMA_ALIAS_MAP.get(_cobieNormKey(field));
  if (aliases?.length) return [...aliases];
  return [String(field || '').trim()].filter(Boolean);
}

function _cobieMergeAliases(...lists) {
  const merged = [];
  const seen = new Set();
  lists.forEach(list => {
    (list || []).forEach(alias => {
      const text = String(alias || '').trim();
      const key = text.toLowerCase();
      if (!text || !key || seen.has(key)) return;
      seen.add(key);
      merged.push(text);
    });
  });
  return merged;
}

const COBIE_FIELD_ALIASES = Object.freeze({
  typeName:_cobieMergeAliases(_cobieFieldAliasesFor('TypeName'), ['TypeName', 'Type Name']),
  floorName:_cobieMergeAliases(_cobieFieldAliasesFor('FloorName'), ['FloorName', 'Floor Name', 'Floor']),
  sheetName:_cobieMergeAliases(_cobieFieldAliasesFor('SheetName'), ['SheetName', 'Sheet Name']),
  rowName:_cobieMergeAliases(_cobieFieldAliasesFor('RowName'), ['RowName', 'Row Name']),
});

function _cobieField(row, field) {
  const mapped = COBIE_FIELD_ALIASES[field];
  const aliases = mapped?.length ? mapped : _cobieFieldAliasesFor(field);
  return f(row, ...aliases);
}
function _scopeKey(facility, name) {
  return String(facility || '').toLowerCase() + '::' + String(name || '').toLowerCase();
}
function _rowKey(row, name) { return _scopeKey(row?._facility, name); }
function _findEntity(rows, name, facility = '') {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !Array.isArray(rows)) return null;
  return rows.find(row =>
    f(row, 'Name').toLowerCase() === key && (!facility || row._facility === facility)
  ) || null;
}

function _logicalFacilityRows() {
  const representatives = new Map();
  (db.facilities || []).forEach(row => {
    const key = String(row._facilityIdentifier || row._facility || '').trim().toLowerCase();
    if (key && !representatives.has(key)) representatives.set(key, row);
  });
  return [...representatives.values()];
}

function _cobieReferenceValues(entityType, row, field) {
  const aliases = _cobieFieldAliasesFor(field);
  const raw = f(row, ...aliases);
  if (!raw) return [];
  const reference = COBIE_RUNTIME_MODEL.indexReferences.find(item =>
    item.source === _cobieEntityType(entityType) && aliases.includes(item.field)
  );
  return (reference?.delimiter ? raw.split(reference.delimiter) : [raw])
    .map(value => value.trim()).filter(Boolean);
}

function _cobieFindEntity(entityType, name, facility = '') {
  const descriptor = _cobieEntityDescriptor(entityType);
  const key = String(name || '').trim().toLowerCase();
  if (!descriptor || !key) return null;
  return (db[descriptor.bucket] || []).find(row =>
    _cobieEntityIdentity(descriptor.type, row).toLowerCase() === key && (!facility || row._facility === facility)
  ) || null;
}

function _selectionRange(items, anchor, target) {
  const start = items.indexOf(anchor);
  const end = items.indexOf(target);
  if (start < 0 || end < 0) return target === undefined ? [] : [target];
  return items.slice(Math.min(start, end), Math.max(start, end) + 1);
}
function _facilityProjectCode(facObj) {
  return f(facObj, 'ProjectCode', 'Project Code', 'ProjectName', 'Project Name', 'ProjectId', 'Project ID', 'Code');
}

function _facilityWorkbookSourceInfo(facObj) {
  const fileName = String(facObj?._fileName || '').trim();
  const projectCode = String(facObj?._projectCode || _facilityProjectCode(facObj) || '').trim();
  const facName = String(facObj?._facility || '').trim();
  const sharedProject = projectCode && db.facilities.filter(x => {
    if ((x._facility || '') !== facName) return false;
    return String(x._projectCode || _facilityProjectCode(x) || '').trim() === projectCode;
  }).length > 1;

  if (sharedProject) {
    return { kind: 'Project code', value: projectCode };
  }
  return { kind: 'Source file', value: fileName || projectCode };
}

function _projectAlignmentKey(facObj) {
  return String(_facilityProjectCode(facObj) || facObj?._facility || '').trim().toLowerCase();
}

function _projectAlignmentRow(facObj) {
  const facility = String(facObj?._facility || '').trim();
  const key = _projectAlignmentKey(facObj);
  if (!facility || !key) return null;
  return db.attributes.find(row =>
    (row._facility || '') === facility &&
    _cobieField(row, 'sheetName').toLowerCase() === 'project' &&
    _cobieField(row, 'rowName').toLowerCase() === key &&
    f(row, 'Name').toLowerCase() === 'floorplanalignment'
  ) || null;
}

function _resolvedFloorAlignmentForEntry(entry) {
  const fallback = { rotation:0, flipHorizontal:false, flipVertical:false, originXPct:0.5, originYPct:0.5, floorToSvg:null };
  if (!entry) return fallback;
  if (typeof _floorAlignmentValueForEntry === 'function' && typeof _floorAlignmentFromRaw === 'function') {
    try {
      const raw = _floorAlignmentValueForEntry(entry);
      const parsed = _floorAlignmentFromRaw(raw);
      return {
        rotation: Number(parsed?.rotation) || 0,
        flipHorizontal: !!parsed?.flipHorizontal,
        flipVertical: !!parsed?.flipVertical,
        originXPct: _unitInterval(parsed?.originXPct ?? parsed?.originX),
        originYPct: _unitInterval(parsed?.originYPct ?? parsed?.originY),
        floorToSvg:parsed?.floorToSvg || null,
      };
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function _unitInterval(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function _finiteNumber(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _normalizedFloorToSvgAffine(map) {
  if (!map) return null;
  const normalized = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, Number(map[key])])
  );
  if (!Object.values(normalized).every(Number.isFinite)) return null;
  const determinant = (normalized.a * normalized.e) - (normalized.b * normalized.d);
  return Math.abs(determinant) > 1e-12 ? normalized : null;
}

function _floorToSvgAffineFromUnitPoints(topLeft, topRight, bottomLeft) {
  if (![topLeft, topRight, bottomLeft].every(point => point && Number.isFinite(point.u) && Number.isFinite(point.v))) return null;
  return _normalizedFloorToSvgAffine({
    a:topRight.u - topLeft.u,
    b:bottomLeft.u - topLeft.u,
    c:topLeft.u,
    d:topRight.v - topLeft.v,
    e:bottomLeft.v - topLeft.v,
    f:topLeft.v,
  });
}

function _applyFloorAlignmentToUv(u, v, alignment) {
  const uu = _finiteNumber(u);
  const vv = _finiteNumber(v);
  const theta = (Number(alignment?.rotation) || 0) * Math.PI / 180;
  const sx = alignment?.flipHorizontal ? -1 : 1;
  const sy = alignment?.flipVertical ? -1 : 1;

  let x = uu - 0.5;
  let y = vv - 0.5;

  x *= sx;
  y *= sy;

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const xr = (x * cos) - (y * sin);
  const yr = (x * sin) + (y * cos);

  return {
    u: xr + 0.5,
    v: yr + 0.5,
  };
}

function _invertFloorAlignmentFromUv(u, v, alignment) {
  const uu = _finiteNumber(u);
  const vv = _finiteNumber(v);
  const theta = (Number(alignment?.rotation) || 0) * Math.PI / 180;
  const sx = alignment?.flipHorizontal ? -1 : 1;
  const sy = alignment?.flipVertical ? -1 : 1;

  const x = uu - 0.5;
  const y = vv - 0.5;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Inverse rotation first.
  let xr = (x * cos) + (y * sin);
  let yr = (-x * sin) + (y * cos);

  // Then inverse flip.
  xr /= sx;
  yr /= sy;

  return {
    u: xr + 0.5,
    v: yr + 0.5,
  };
}

function _floorUvToSvgUv(u, v, alignment) {
  const map = _normalizedFloorToSvgAffine(alignment?.floorToSvg);
  if (map) {
    return {
      u:(map.a * u) + (map.b * v) + map.c,
      v:(map.d * u) + (map.e * v) + map.f,
    };
  }
  return _invertFloorAlignmentFromUv(u, v, alignment);
}

function _svgUvToFloorUv(u, v, alignment) {
  const map = _normalizedFloorToSvgAffine(alignment?.floorToSvg);
  if (map) {
    const determinant = (map.a * map.e) - (map.b * map.d);
    if (Math.abs(determinant) > 1e-12) {
      const x = u - map.c;
      const y = v - map.f;
      return {
        u:((map.e * x) - (map.b * y)) / determinant,
        v:((-map.d * x) + (map.a * y)) / determinant,
      };
    }
  }
  return _applyFloorAlignmentToUv(u, v, alignment);
}

function _projectFloorPlanAlignment(facObj) {
  const row = _projectAlignmentRow(facObj);
  if (!row) return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  const raw = f(row, 'Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value');
  if (!raw) return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      xPct: _unitInterval(parsed?.xPct ?? parsed?.centerX),
      yPct: _unitInterval(parsed?.yPct ?? parsed?.centerY),
      scale: Number(parsed?.scale) || 1,
      rotation: Number(parsed?.rotation) || 0,
      flipHorizontal: !!(parsed?.flipHorizontal || parsed?.flipX),
      flipVertical: !!(parsed?.flipVertical || parsed?.flipY),
    };
  } catch (_) {
    return { xPct: 0.5, yPct: 0.5, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
  }
}

function _setProjectFloorPlanAlignment(facObj, alignment) {
  const facility = String(facObj?._facility || '').trim();
  const key = _projectAlignmentKey(facObj);
  if (!facility || !key) return null;

  const row = _projectAlignmentRow(facObj) || {
    SheetName: 'Project',
    RowName: key,
    Name: 'FloorPlanAlignment',
    CreatedBy: '',
    CreatedOn: new Date().toISOString().slice(0, 10),
    ExtSystem: '',
    ExtObject: '',
    ExtIdentifier: '',
    _facility: facility,
    _projectCode: _facilityProjectCode(facObj) || '',
  };

  const payload = {
    xPct: _unitInterval(alignment?.xPct ?? alignment?.centerX),
    yPct: _unitInterval(alignment?.yPct ?? alignment?.centerY),
    scale: Number(alignment?.scale) || 1,
    rotation: Number(alignment?.rotation) || 0,
    flipHorizontal: !!(alignment?.flipHorizontal || alignment?.flipX),
    flipVertical: !!(alignment?.flipVertical || alignment?.flipY),
  };
  const value = JSON.stringify(payload);
  row.Value = value;
  row.AttributeValue = value;
  row['Attribute Value'] = value;
  row.NominalValue = value;
  row['Nominal Value'] = value;

  if (!db.attributes.includes(row)) db.attributes.push(row);
  return row;
}

function _roomUvToWorldXZ(bounds, u, v, clamp = true) {
  if (!bounds) return null;
  const rawU = _finiteNumber(u);
  const rawV = _finiteNumber(v);
  const uu = clamp ? _unitInterval(rawU) : rawU;
  const vv = clamp ? _unitInterval(rawV) : rawV;
  return {
    x: bounds.minX + (uu * bounds.sizeX),
    // SVG Y grows downward; map this to decreasing world Z for consistent orientation.
    z: bounds.maxZ - (vv * bounds.sizeZ),
  };
}

function _worldXZToRoomUv(bounds, x, z, clamp = true) {
  if (!bounds) return { u:0.5, v:0.5 };
  const sizeX = Math.max(1, Number(bounds.sizeX) || 1);
  const sizeZ = Math.max(1, Number(bounds.sizeZ) || 1);
  const rawU = (Number(x) - bounds.minX) / sizeX;
  const rawV = (bounds.maxZ - Number(z)) / sizeZ;
  const u = Number.isFinite(rawU) ? rawU : 0.5;
  const v = Number.isFinite(rawV) ? rawV : 0.5;
  return {
    u: clamp ? _unitInterval(u) : u,
    v: clamp ? _unitInterval(v) : v,
  };
}

// ── HTML escaping ────────────────────────────────────────────
const _ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s) { return String(s||'').replace(/[&<>"']/g, c => _ESC_MAP[c]); }

// ── Date formatting ──────────────────────────────────────────
function fmtDate(x) {
  if (!x) return '';
  if (x instanceof Date && !isNaN(x)) return x.toLocaleDateString();
  const s=String(x).trim();
  if (!s||s.toLowerCase()==='n/a') return '';
  const d=new Date(s);
  return !isNaN(d.getTime()) ? d.toLocaleDateString() : s;
}

// ── Document path and icon helpers ───────────────────────────
function _docTarget(directory) {
  return v(directory);
}
function _docUniqueKey(doc) {
  const facility = String(doc?._facility || '').trim().toLowerCase();
  const path = f(doc,'Directory').toLowerCase();
  const fallback = f(doc,'Name').toLowerCase() || [
    f(doc,'Description'), f(doc,'Category'),
    _cobieField(doc, 'sheetName'), _cobieField(doc, 'rowName'),
  ].join('::').toLowerCase();
  return facility + '::' + (path ? 'path::' + path : 'name::' + fallback);
}
function _docHref(path) {
  if (!path || /^(https?:|file:)/i.test(path)) return path || '';
  if (/^\\\\/.test(path)) return 'file:' + path.replace(/\\/g,'/');
  if (/^[a-z]:[\\\/]/i.test(path)) return 'file:///' + path.replace(/\\/g,'/');
  return path;
}

// Shared result-view templates used by asset and document modes.
function _groupNodeKey(dim, name, facility, depth, parentPath) {
  return JSON.stringify([
    String(parentPath || ''),
    String(depth || 0),
    String(dim || '').toLowerCase(),
    String(name || '').toLowerCase(),
    String(facility || '').toLowerCase(),
  ]);
}

function _groupNodeIsOpen(key) {
  const expandAll = typeof allExpanded !== 'undefined' && allExpanded;
  const expanded = typeof groupExpandedState !== 'undefined' && groupExpandedState?.has(key);
  return !!(expandAll || expanded);
}

function _groupHighlightBuildKey(dim, name, facility) {
  return JSON.stringify([
    String(dim || '').trim().toLowerCase(),
    String(name || '').trim().toLowerCase(),
    String(facility || '').trim().toLowerCase(),
  ]);
}

function buildGroupActions(dim, name, facility, count) {
  const infoAllowed = !!name && (dim === _cobieDocumentCategoryDimension() || !name.startsWith('(')) &&
    (dim === 'facility' || db.facilities.length <= 1 || !!facility);
  let infoIndex = -1;
  if (infoAllowed) {
    infoIndex = groupInfoStore.length;
    groupInfoStore.push({ dim, name, facility });
  }
  const key = _groupHighlightBuildKey(dim, name, facility);
  const activeClass = typeof groupHighlightStore !== 'undefined' && groupHighlightStore.has(key) ? ' is-active' : '';
  return `<span class="grp-actions">
    <span class="grp-action grp-count" title="Count"><span class="grp-action-label">Count</span><span class="grp-cnt">${count}</span></span>
    ${infoIndex >= 0 ? `<button class="type-info-btn" data-grpidx="${infoIndex}" title="${esc(_GRP_LABELS[dim] || 'Group')} info"><i class="bi bi-info-circle"></i><span>Info</span></button>` : '<span class="grp-action-unavailable">Info</span>'}
    <button class="grp-highlight-btn${activeClass}" data-grphl="${infoIndex >= 0 ? infoIndex : 'group'}" data-grphlkey="${esc(key)}" title="Toggle highlight"><i class="bi bi-highlighter"></i><span>Highlight</span></button>
  </span>`;
}

function buildGroupHeader({ dim, name, facility = '', count = 0, subtitle = '', icon = 'bi-folder', cid, gkey = '', isOpen = false, displayName = '' }) {
  return `<div class="grp-hdr grp-cat-${dim}${isOpen ? '' : ' grp-collapsed'}" data-cid="${cid}"${gkey ? ` data-gkey="${esc(gkey)}"` : ''}>
    <i class="bi bi-chevron-down grp-chev"></i>
    <i class="bi ${icon} me-1 grp-icon"></i>
    <span class="grp-name">${esc(displayName || withDesc(name, dim))}</span>
    ${subtitle ? `<span class="grp-meta">${esc(subtitle)}</span>` : '<span class="grp-meta"></span>'}
    ${buildGroupActions(dim, name, facility, count)}
  </div>`;
}

function buildSelectableResultCard(highlightKey, contentHtml, infoHtml, extraClass = '') {
  const activeClass = typeof groupHighlightStore !== 'undefined' && groupHighlightStore.has(highlightKey) ? ' is-active' : '';
  return `<div class="cc selectable-result-card${activeClass}${extraClass ? ` ${extraClass}` : ''}" data-card-highlight-key="${esc(highlightKey)}" role="button" tabindex="0" aria-pressed="${activeClass ? 'true' : 'false'}">
    <div class="d-flex align-items-start gap-2">
      <div class="selectable-result-card-content">${contentHtml}</div>
      <div class="selectable-result-card-actions">${infoHtml}</div>
    </div>
  </div>`;
}

function _isSvgReference(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\.svg(?:[?#].*)?$/i.test(text);
}

function _isSvgDataUri(value) {
  return /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(String(value || '').trim());
}

function _looksLikeInlineSvg(value) {
  const text = String(value || '').trim();
  return /^<svg\b[\s\S]*<\/svg>$/i.test(text);
}

function _svgDataUri(svgText) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
}

function renderAttributeValue(value, attributeName = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  const isSvgNamed = String(attributeName || '').trim().toLowerCase() === 'svg';

  if (isSvgNamed && _looksLikeInlineSvg(text)) {
    const src = _svgDataUri(text);
    const safeText = esc(text);
    return `<div>
      <div style="margin-top:.15rem">
        <img src="${src}" alt="SVG attribute preview" loading="lazy"
          style="max-width:360px;max-height:200px;border:1px solid #d7dbe1;border-radius:4px;background:#fff;padding:2px"
          onerror="this.style.display='none'">
      </div>
      <details style="margin-top:.35rem">
        <summary style="cursor:pointer;color:#5b6470">Show SVG markup</summary>
        <pre style="white-space:pre-wrap;word-break:break-word;max-width:480px;max-height:220px;overflow:auto;margin-top:.3rem">${safeText}</pre>
      </details>
    </div>`;
  }

  if (!_isSvgReference(text) && !_isSvgDataUri(text)) return esc(text);

  const href = _docHref(text);
  // Guard against unsafe URI schemes before rendering in href/src.
  if (/^\s*javascript:/i.test(href)) return esc(text);

  const safeHref = esc(href);
  const safeText = esc(text);
  return `<div>
    <a href="${safeHref}" target="_blank" rel="noopener">${safeText}</a>
    <div style="margin-top:.35rem">
      <img src="${safeHref}" alt="${safeText}" loading="lazy"
        style="max-width:220px;max-height:120px;border:1px solid #d7dbe1;border-radius:4px;background:#fff;padding:2px"
        onerror="this.style.display='none'">
    </div>
  </div>`;
}

const _DOC_ICONS = {
  pdf:'bi-file-earmark-pdf', doc:'bi-file-earmark-word',  docx:'bi-file-earmark-word',
  xls:'bi-file-earmark-excel',xlsx:'bi-file-earmark-excel',xlsm:'bi-file-earmark-excel',
  dwg:'bi-file-earmark-code', dxf:'bi-file-earmark-code', ifc:'bi-box',
  png:'bi-file-earmark-image',jpg:'bi-file-earmark-image', jpeg:'bi-file-earmark-image',
  zip:'bi-file-earmark-zip',  rar:'bi-file-earmark-zip'
};
function docIcon(fn) {
  const ext = (String(fn||'').split('.').pop()||'').toLowerCase();
  return `<i class="bi ${_DOC_ICONS[ext]||'bi-file-earmark'}"></i>`;
}
