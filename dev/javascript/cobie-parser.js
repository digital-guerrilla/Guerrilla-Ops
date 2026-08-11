// ── COBie parsing and identity helpers ───────────────────────
function readSheet(wb, name) {
  if (!wb || !wb.Sheets || !name) return [];
  const k = Object.keys(wb.Sheets).find(key => key.toLowerCase() === String(name).toLowerCase());
  if (!k || !wb.Sheets[k]) return [];
  try {
    return XLSX.utils.sheet_to_json(wb.Sheets[k], { defval:'', raw:false }).filter(row =>
      Object.values(row).some(value => value !== null && value !== undefined && String(value).trim() !== '')
    );
  } catch (err) {
    console.warn('Skipped unreadable sheet', String(name), err?.message || err);
    return [];
  }
}

function classificationParts(value) {
  const text = String(value || '').trim();
  const separator = text.indexOf(':');
  const code = (separator >= 0 ? text.slice(0, separator) : text).trim();
  return { code, label:text || code };
}

function classificationAncestors(code) {
  const parts = String(code || '').split('_').filter(Boolean);
  if (parts.length < 2) return parts;
  return parts.slice(1).map((_, index) => parts.slice(0, index + 2).join('_'));
}

function picklistCategoryValues(entityType) {
  const normalized = _cobieEntityType(entityType);
  const descriptor = [...COBIE_RUNTIME_MODEL.entities.values()].find(entity =>
    entity.type === normalized || entity.categoryDimension === normalized
  );
  if (!descriptor?.categoryPicklist) return [];
  const values = new Map();
  (db.picklists || []).forEach(row => {
    const value = f(row, descriptor.categoryPicklist).trim();
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  });
  (db[descriptor.bucket] || []).forEach(row => {
    const value = f(row, 'Category').trim();
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  });
  return [...values.values()].sort((a, b) => {
    const aCode = classificationParts(a).code;
    const bCode = classificationParts(b).code;
    return aCode.localeCompare(bCode, undefined, { numeric:true }) || a.localeCompare(b);
  });
}
function _mergeRowData(target, source) {
  if (!target || !source) return target;
  Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('_')) return;
    if (value === undefined || value === null || value === '') return;
    if (target[key] === undefined || target[key] === null || target[key] === '') target[key] = value;
  });
  return target;
}

function _readProjectCode(wb, facRow) {
  const projectRows = readSheet(wb, 'Project');
  const projectRow = projectRows[0] || {};
  return f(projectRow,
    'ProjectCode', 'Project Code',
    'ProjectName', 'Project Name',
    'ProjectId', 'Project ID',
    'Code', 'Name'
  ) || f(facRow, 'ProjectCode', 'Project Code', 'ProjectName', 'Project Name') || '';
}

function _facilityExternalIdentifier(facilityRow) {
  return f(facilityRow,
    'ExternalFacilityIdentifier', 'External Facility Identifier',
    'ExternalIdentifier', 'External Identifier', 'ExtIdentifier'
  ).trim();
}

function canonicalizeLoadedFacilities() {
  const facilities = db.facilities || [];
  if (!facilities.length) return;
  const explicit = facilities.filter(row => row._hasFacilityInfo);
  const firstExplicit = explicit[0] || facilities[0];
  const canonicalByIdentifier = new Map();

  explicit.forEach(row => {
    const identifier = String(row._facilityIdentifier || row._sourceFacility || '').trim().toLowerCase();
    if (!identifier || canonicalByIdentifier.has(identifier)) return;
    canonicalByIdentifier.set(identifier, String(row._sourceFacility || row._facility || '').trim());
  });
  facilities.forEach(row => {
    const identifier = row._hasFacilityInfo
      ? String(row._facilityIdentifier || row._sourceFacility || '').trim().toLowerCase()
      : String(firstExplicit._facilityIdentifier || firstExplicit._sourceFacility || firstExplicit._facility || '').trim().toLowerCase();
    const canonicalName = canonicalByIdentifier.get(identifier)
      || String(firstExplicit._sourceFacility || firstExplicit._facility || '').trim();
    row._facilityIdentifier = identifier;
    row._facility = canonicalName;
  });

  const facilityByWorkbook = new Map(facilities.map(row => [row._workbookKey, row]));
  [...COBIE_RUNTIME_MODEL.entities.values()].filter(descriptor => descriptor.type !== 'facility')
    .forEach(descriptor => (db[descriptor.bucket] || []).forEach(row => {
      const facility = facilityByWorkbook.get(row._workbookKey);
      if (!facility) return;
      row._facility = facility._facility;
      row._facilityIdentifier = facility._facilityIdentifier;
    }));
}

function parseCOBieInto(wb, fileName, sourceBuffer, fileHandle) {
  const facRows = readSheet(wb,_cobieSheetName('facility'));
  const facRow  = facRows[0] || {};
  const facName = f(facRow,'Name') || fileName.replace(/\.[^.]+$/, '');
  const facilityIdentifier = _facilityExternalIdentifier(facRow);
  const workbookKey = `${fileName}::${db.facilities.length}`;
  const projectCode = _readProjectCode(wb, facRow);
  const tag = rec => { rec._facility = facName; rec._fileName = fileName; rec._workbookKey = workbookKey; rec._projectCode = projectCode; return rec; };

  [...COBIE_RUNTIME_MODEL.entities.values()].filter(descriptor => descriptor.type !== 'facility')
    .forEach(descriptor => {
      const bucket = db[descriptor.bucket] ||= [];
      readSheet(wb, descriptor.sheet).map(tag).forEach(row => {
        const identity = _cobieEntityIdentity(descriptor.type, row);
        const existing = descriptor.mergeRows && identity
          ? bucket.find(candidate => candidate._facility === facName &&
            _cobieEntityIdentity(descriptor.type, candidate).toLowerCase() === identity.toLowerCase())
          : null;
        if (existing) _mergeRowData(existing, row); else bucket.push(row);
      });
    });
  db.facilities .push({ ...facRow, _facility: facName, _sourceFacility: facName,
    _facilityIdentifier: facilityIdentifier, _hasFacilityInfo:facRows.length > 0,
    _fileName: fileName, _workbookKey:workbookKey,
    _projectCode: projectCode,
    _facRowCount: facRows.length, _workbook: wb,
    _sourceBuffer: sourceBuffer ? sourceBuffer.slice(0) : null, _fileHandle: fileHandle });
}

function _addBoundAttribute(target, name, value) {
  if (!target || !name || !value) return;
  const attrs = target._attrs || (target._attrs = {});
  const existing = attrs[name];
  if (!existing) {
    attrs[name] = value;
    return;
  }
  const seen = new Set(existing.split(';').map(item => item.trim().toLowerCase()).filter(Boolean));
  if (!seen.has(value.toLowerCase())) attrs[name] = existing + '; ' + value;
}

function _bindAttributeData() {
  const descriptors = [...COBIE_RUNTIME_MODEL.entities.values()].filter(descriptor => descriptor.attributes);
  descriptors.forEach(descriptor => (db[descriptor.bucket] || []).forEach(row => { delete row._attrs; }));
  if (!db.attributes.length) return;
  const rowsByType = new Map(descriptors.map(descriptor => [descriptor.type, Object.create(null)]));
  descriptors.forEach(descriptor => {
    const lookup = rowsByType.get(descriptor.type);
    (db[descriptor.bucket] || []).forEach(row => {
      const identity = _cobieEntityIdentity(descriptor.type, row);
      if (!identity) return;
      (lookup[_rowKey(row, identity)] ||= []).push(row);
    });
  });

  db.attributes.forEach(attr => {
    const sheetName = _cobieField(attr, 'sheetName').toLowerCase();
    const rowName = _cobieField(attr, 'rowName');
    const attrName = f(attr,'Name');
    const rawValue = f(attr,'Value','AttributeValue','Attribute Value','NominalValue','Nominal Value');
    const unit = f(attr,'Unit','UnitName','Unit Name');
    const attrValue = rawValue && unit ? (rawValue + ' ' + unit) : (rawValue || unit);
    if (!sheetName || !rowName || !attrName || !attrValue) return;
    const key = _rowKey(attr, rowName);
    (rowsByType.get(sheetName)?.[key] || []).forEach(row => _addBoundAttribute(row, attrName, attrValue));
  });
}

// ── Derived indexes and document contexts ────────────────────
function buildIdx() {
  _bindAttributeData();
  idx.desc = {};
  idx.catGroups = {};
  idx.categoryTrees = {};
  updateIdxForEntities([...COBIE_RUNTIME_MODEL.entities.keys()]);

}

function _rebuildCategoryIndex(dim) {
  const descriptor = [...COBIE_RUNTIME_MODEL.entities.values()]
    .find(entity => entity.categoryDimension === dim && entity.categoryPicklist);
  if (!descriptor) return;
  const labels = new Map();
  (db.picklists || []).forEach(row => {
    const { code, label } = classificationParts(f(row, descriptor.categoryPicklist));
    if (code && !labels.has(code.toLowerCase())) labels.set(code.toLowerCase(), label);
  });
  const direct = new Map();
  (db[descriptor.bucket] || []).forEach(row => {
    const isDocumentCategory = dim === _cobieDocumentCategoryDimension();
    const name = isDocumentCategory ? f(row,'Category') : _cobieEntityIdentity(descriptor.type, row);
    const category = isDocumentCategory ? name : f(row,'Category');
    if (!name) return;
    const { code, label } = classificationParts(category || '(Uncategorised)');
    const key = (code || '(Uncategorised)').toLowerCase();
    if (!labels.has(key)) labels.set(key, label || code || '(Uncategorised)');
    const values = direct.get(key) || new Set();
    values.add(name);
    direct.set(key, values);
  });
  [...labels.keys()].forEach(key => {
    if (key.startsWith('(')) return;
    classificationAncestors(key).forEach(parent => {
      const parentKey = parent.toLowerCase();
      if (!labels.has(parentKey)) labels.set(parentKey, parent);
    });
  });
  const groups = {};
  const nodes = [...labels.entries()].map(([key, label]) => {
    const names = new Set();
    direct.forEach((values, categoryKey) => {
      if (categoryKey === key || categoryKey.startsWith(key + '_')) values.forEach(name => names.add(name));
    });
    groups[key] = [...names].sort((a,b) => a.localeCompare(b));
    return {
      key,
      label,
      depth:key.startsWith('(') ? 0 : Math.max(0, key.split('_').length - 2),
      direct:[...(direct.get(key) || [])].sort((a,b) => a.localeCompare(b)),
    };
  }).filter(node => groups[node.key].length > 0)
    .sort((a,b) => {
      const uncategorised = Number(a.key.startsWith('(')) - Number(b.key.startsWith('('));
      return uncategorised || a.key.localeCompare(b.key, undefined, { numeric:true });
    });
  (idx.catGroups ||= {})[dim] = groups;
  (idx.categoryTrees ||= {})[dim] = nodes;
}

function _runtimeReferenceValues(row, reference) {
  const raw = f(row, ..._cobieFieldAliasesFor(reference.field));
  if (!raw) return [];
  return (reference.delimiter ? raw.split(reference.delimiter) : [raw])
    .map(value => value.trim()).filter(Boolean);
}

function _rebuildConfiguredRelationshipIndexes(references = COBIE_RUNTIME_MODEL.indexReferences) {
  references.forEach(reference => {
    if (reference.forwardIndex) idx[reference.forwardIndex] = {};
    if (reference.reverseIndex) idx[reference.reverseIndex] = {};
  });
  references.forEach(reference => {
    const sourceDescriptor = _cobieEntityDescriptor(reference.source);
    const targetDescriptor = _cobieEntityDescriptor(reference.target);
    const sourceRows = db[sourceDescriptor?.bucket] || [];
    const targetRows = db[targetDescriptor?.bucket] || [];
    const targetsByIdentity = Object.create(null);
    targetRows.forEach(row => {
      const identity = _cobieEntityIdentity(reference.target, row);
      if (identity) targetsByIdentity[_rowKey(row, identity)] = row;
    });
    sourceRows.forEach(sourceRow => {
      const sourceIdentity = _cobieEntityIdentity(reference.source, sourceRow);
      const values = _runtimeReferenceValues(sourceRow, reference);
      if (reference.mode === 'scalar') {
        if (sourceIdentity) idx[reference.forwardIndex][_rowKey(sourceRow, sourceIdentity)] = (values[0] || '').toLowerCase();
        return;
      }
      if (reference.mode === 'targetSources') {
        values.forEach(value => { (idx[reference.forwardIndex][_rowKey(sourceRow, value)] ||= []).push(sourceRow); });
        return;
      }
      const sourceKey = _rowKey(sourceRow, sourceIdentity);
      const targets = values.map(value => targetsByIdentity[_rowKey(sourceRow, value)]).filter(Boolean);
      if (reference.forwardIndex) {
        const existing = idx[reference.forwardIndex][sourceKey] || [];
        idx[reference.forwardIndex][sourceKey] = [...new Set([...existing, ...targets])];
      }
      if (reference.reverseIndex) targets.forEach(targetRow => {
        const targetKey = _rowKey(targetRow, _cobieEntityIdentity(reference.target, targetRow));
        const valuesForTarget = idx[reference.reverseIndex][targetKey] ||= [];
        const normalized = sourceIdentity.toLowerCase();
        if (!valuesForTarget.includes(normalized)) valuesForTarget.push(normalized);
      });
    });
  });
}

function _runtimeSearchRowText(row, fields, includeAttributes) {
  const values = fields.map(field => f(row, ..._cobieFieldAliasesFor(field)));
  if (includeAttributes) {
    values.push(Object.entries(row?._attrs || {}).map(([key,value]) => `${key} ${value}`).join(' '));
  }
  return values.filter(Boolean).join(' ');
}

function _rebuildConfiguredSearchIndexes(searches = COBIE_RUNTIME_MODEL.searches) {
  searches.forEach(search => {
    const sourceDescriptor = _cobieEntityDescriptor(search.source);
    const rows = db[sourceDescriptor?.bucket] || [];
    const joins = search.joins.map(join => {
      const targetDescriptor = _cobieEntityDescriptor(join.target);
      const byIdentity = Object.create(null);
      (db[targetDescriptor?.bucket] || []).forEach(row => {
        const identity = _cobieEntityIdentity(join.target, row);
        if (identity) byIdentity[_rowKey(row, identity)] = row;
      });
      return { ...join, byIdentity };
    });
    idx[search.index] = {};
    rows.forEach(row => {
      const parts = [_runtimeSearchRowText(row, search.fields, search.includeAttributes)];
      joins.forEach(join => {
        const targetName = f(row, ..._cobieFieldAliasesFor(join.field));
        const targetRow = join.byIdentity[_rowKey(row, targetName)];
        if (targetRow) parts.push(_runtimeSearchRowText(targetRow, join.fields, join.includeAttributes));
      });
      idx[search.index][_rowKey(row, _cobieEntityIdentity(search.source, row))] = parts.filter(Boolean).join(' ').toLowerCase();
    });
  });
}

function _rebuildDocumentIndexes() {
  idx.docs = {};
  const categories = {};
  const facilityCategories = new Set();
  const entityCategories = new Set();
  db.documents.forEach(documentRow => {
    const sheetName = _cobieField(documentRow, 'sheetName').toLowerCase();
    const rowName = _cobieField(documentRow, 'rowName').toLowerCase();
    if (sheetName && rowName) (idx.docs[_scopeKey(documentRow._facility, sheetName + '::' + rowName)] ||= []).push(documentRow);
    const category = f(documentRow,'Category');
    if (!category) return;
    categories[category.toLowerCase()] = category;
    const linkedDescriptor = _cobieEntityDescriptor(sheetName);
    if (linkedDescriptor?.scopeIdentity) facilityCategories.add(category.toLowerCase());
    else if (linkedDescriptor?.documentTarget) entityCategories.add(category.toLowerCase());
  });
  idx.docCatFacilityOnly = new Set([...facilityCategories].filter(category => !entityCategories.has(category)));
  idx.documentContexts = _buildDocumentContexts();
  idx.docCatByComp = {};
  idx.documentContexts.forEach(context => context.components.forEach(componentKey => {
    const values = idx.docCatByComp[componentKey] ||= new Set();
    context.categories.forEach(category => values.add(category));
  }));
  idx.docCategories = Object.values(categories).sort((left,right) => {
    const leftUncategorised = left.startsWith('('), rightUncategorised = right.startsWith('(');
    return leftUncategorised !== rightUncategorised ? (leftUncategorised ? 1 : -1) : left.localeCompare(right);
  });
  _rebuildCategoryIndex('doccat');
}

function updateIdxForEntities(entityTypes) {
  const requested = new Set((Array.isArray(entityTypes) ? entityTypes : [entityTypes])
    .map(_cobieEntityType).filter(Boolean));
  const domains = _cobieDependentEntityTypes([...requested]);
  const documentTargets = _cobieDocumentTargetTypes();
  if ([...domains].some(type => documentTargets.has(type))) domains.add('document');
  [...COBIE_RUNTIME_MODEL.entities.values()].forEach(descriptor => {
    if (!domains.has(descriptor.type)) return;
    let rows = db[descriptor.bucket] || [];
    let usingFallback = false;
    if (!rows.length && descriptor.listFallbackSheet) {
      rows = db[_cobieEntityBucket(descriptor.listFallbackSheet)] || [];
      usingFallback = true;
    }
    if (descriptor.listIndex) {
      const values = rows.map(row => usingFallback && descriptor.listFallbackField
        ? f(row, ..._cobieFieldAliasesFor(descriptor.listFallbackField))
        : _cobieEntityIdentity(descriptor.type, row));
      idx[descriptor.listIndex] = [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
    }
    if (descriptor.descriptionIndex) {
      (idx.desc ||= {})[descriptor.descriptionIndex] = {};
      (db[descriptor.bucket] || []).forEach(row => {
        const identity = _cobieEntityIdentity(descriptor.type, row).toLowerCase();
        if (identity && idx.desc[descriptor.descriptionIndex][identity] === undefined) {
          idx.desc[descriptor.descriptionIndex][identity] = f(row,'Description');
        }
      });
    }
    if (descriptor.categoryPicklist) _rebuildCategoryIndex(descriptor.categoryDimension);
  });
  const relationshipIndexes = COBIE_RUNTIME_MODEL.indexReferences.filter(reference =>
    domains.has(reference.source) || domains.has(reference.target));
  if (relationshipIndexes.length) _rebuildConfiguredRelationshipIndexes(relationshipIndexes);
  const searchIndexes = COBIE_RUNTIME_MODEL.searches.filter(search =>
    domains.has(search.source) || search.joins.some(join => domains.has(join.target)));
  if (searchIndexes.length) _rebuildConfiguredSearchIndexes(searchIndexes);
  if (domains.has('document')) _rebuildDocumentIndexes();
}

function _indexChangeTouchesFields(change, fields) {
  const changed = new Set((change.aliases || []).map(_cobieNormKey).filter(Boolean));
  return fields.some(field => changed.has(_cobieNormKey(field)) ||
    _cobieFieldAliasesFor(field).some(alias => changed.has(_cobieNormKey(alias))));
}

function _indexChangeAffectsDerivedData(change) {
  if (!change || change.index === false) return false;
  const entityType = _cobieEntityType(change.entityType);
  const descriptor = _cobieEntityDescriptor(entityType);
  const aliases = Array.isArray(change.aliases) ? change.aliases : [];
  if (!descriptor || (!aliases.length && !change.attributes)) return true;

  if (change.attributes) {
    return COBIE_RUNTIME_MODEL.searches.some(search =>
      (search.source === entityType && search.includeAttributes) ||
      search.joins.some(join => join.target === entityType && join.includeAttributes)
    );
  }

  const descriptorFields = [descriptor.identityField];
  if (descriptor.descriptionIndex) descriptorFields.push('Description');
  if (descriptor.categoryPicklist) descriptorFields.push('Category');
  if (_indexChangeTouchesFields(change, descriptorFields)) return true;

  if (COBIE_FILTER_DIMENSIONS.some(filter => filter.source === entityType &&
    _indexChangeTouchesFields(change, [filter.valueField, filter.throughField].filter(Boolean)))) return true;

  if (COBIE_RUNTIME_MODEL.indexReferences.some(reference =>
    (reference.source === entityType && _indexChangeTouchesFields(change, [reference.field])) ||
    (reference.target === entityType && _indexChangeTouchesFields(change, [descriptor.identityField]))
  )) return true;

  if (COBIE_RUNTIME_MODEL.searches.some(search => {
    if (search.source === entityType && _indexChangeTouchesFields(change,
      [descriptor.identityField, ...search.fields, ...search.joins.map(join => join.field)])) return true;
    return search.joins.some(join => join.target === entityType &&
      _indexChangeTouchesFields(change, [_cobieEntityDescriptor(join.target)?.identityField, ...join.fields]));
  })) return true;

  if (entityType === COBIE_RUNTIME_MODEL.documents.sheet) return true;
  return COBIE_RUNTIME_MODEL.documents.contexts.some(rule =>
    (rule.source === entityType && _indexChangeTouchesFields(change,
      [rule.field || descriptor.identityField].filter(Boolean))) ||
    (rule.target === entityType && _indexChangeTouchesFields(change, [rule.targetField].filter(Boolean)))
  );
}

function updateIdxForChanges(changes, affectedTypes = []) {
  const requested = new Set((affectedTypes || []).map(_cobieEntityType).filter(Boolean));
  (changes || []).forEach(change => {
    if (_indexChangeAffectsDerivedData(change)) requested.add(_cobieEntityType(change.entityType));
  });
  if (requested.size) updateIdxForEntities([...requested]);
}

function docsFor(sheet, name, facility) {
  if (facility) return idx.docs[_scopeKey(facility, sheet + '::' + name)] || [];
  const suffix = '::' + (sheet + '::' + name).toLowerCase();
  return Object.entries(idx.docs).filter(([key]) => key.endsWith(suffix)).flatMap(([,docs]) => docs);
}

function _buildDocumentContexts() {
  const contexts = new Map();
  const contextDimensions = [...new Set(COBIE_RUNTIME_MODEL.documents.contexts.map(rule => rule.dimension).filter(Boolean))];
  const rowsByType = new Map();
  [...COBIE_RUNTIME_MODEL.entities.values()].forEach(descriptor => {
    const lookup = Object.create(null);
    (db[descriptor.bucket] || []).forEach(row => {
      const identity = _cobieEntityIdentity(descriptor.type, row);
      if (identity) lookup[_rowKey(row, identity)] = row;
    });
    rowsByType.set(descriptor.type, lookup);
  });

  const addRuleValues = (context, rule, sourceRow) => {
    const values = [];
    if (rule.sourceIndex) {
      values.push(...(idx[rule.sourceIndex]?.[_rowKey(sourceRow, _cobieEntityIdentity(rule.source, sourceRow))] || []));
    } else if (rule.target && rule.targetField) {
      const targetName = f(sourceRow, ..._cobieFieldAliasesFor(rule.field));
      const targetRow = rowsByType.get(rule.target)?.[_rowKey(sourceRow, targetName)];
      if (targetRow) values.push(f(targetRow, ..._cobieFieldAliasesFor(rule.targetField)));
    } else if (rule.field) {
      values.push(f(sourceRow, ..._cobieFieldAliasesFor(rule.field)));
    } else {
      const identity = _cobieEntityIdentity(rule.source, sourceRow);
      const searchRoot = COBIE_RUNTIME_MODEL.searches.some(search => search.source === rule.source);
      values.push(searchRoot ? _rowKey(sourceRow, identity) : identity);
    }
    values.map(value => String(value || '').toLowerCase()).filter(Boolean)
      .forEach(value => context[rule.dimension]?.add(value));
  };

  db.documents.forEach(doc => {
    const linkedType = _cobieField(doc, 'sheetName').toLowerCase();
    if (!_SUPPORTED_DOC_SHEETS.has(linkedType)) return;
    const linkedName = _cobieField(doc, 'rowName');
    const facility = (doc._facility || '').toLowerCase();
    const category = f(doc,'Category').toLowerCase();
    const contextKey = _docUniqueKey(doc);
    let context = contexts.get(contextKey);
    if (!context) {
      context = {
        key:contextKey, identity:_docUniqueKey(doc), doc, linkedType, linkedName,
        categories:new Set(),
      };
      contextDimensions.forEach(dimension => { context[dimension] = new Set(); });
      contexts.set(contextKey, context);
    }
    if (category) context.categories.add(category);
    if (facility) context.facilities?.add(facility);
    const sourceRow = rowsByType.get(linkedType)?.[_scopeKey(facility, linkedName)];
    if (sourceRow) COBIE_RUNTIME_MODEL.documents.contexts.filter(rule => rule.source === linkedType)
      .forEach(rule => addRuleValues(context, rule, sourceRow));
  });
  return [...contexts.values()];
}
