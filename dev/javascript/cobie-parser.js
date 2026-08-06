// ── COBie parsing and identity helpers ───────────────────────
function readSheet(wb, name) {
  const k = Object.keys(wb.Sheets).find(k => k.toLowerCase() === name.toLowerCase());
  return k ? XLSX.utils.sheet_to_json(wb.Sheets[k], { defval:'', raw:false }) : [];
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
  const specs = {
    facility:{ column:'Category-Facility', rows:db.facilities },
    space:{ column:'Category-Space', rows:db.spaces },
    type:{ column:'Category-Product', rows:db.types },
    system:{ column:'Category-Element', rows:db.systems },
    document:{ column:'DocumentType', rows:db.documents },
    doccat:{ column:'DocumentType', rows:db.documents },
  };
  const spec = specs[entityType];
  if (!spec) return [];
  const values = new Map();
  (db.picklists || []).forEach(row => {
    const value = f(row, spec.column).trim();
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  });
  spec.rows.forEach(row => {
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

function parseCOBieInto(wb, fileName, sourceBuffer, fileHandle) {
  const facRows = readSheet(wb,'Facility');
  const facRow  = facRows[0] || {};
  const facName = f(facRow,'Name') || fileName.replace(/\.[^.]+$/, '');
  const projectCode = _readProjectCode(wb, facRow);
  const tag = rec => { rec._facility = facName; rec._fileName = fileName; rec._projectCode = projectCode; return rec; };

  db.types      .push(...readSheet(wb,'Type')     .map(tag));
  db.components .push(...readSheet(wb,'Component').map(tag));
  db.spaces     .push(...readSheet(wb,'Space')    .map(tag));
  readSheet(wb,'Floor').map(tag).forEach(row => {
    const floorName = f(row, 'Name');
    if (!floorName) {
      db.floors.push(row);
      return;
    }
    const existing = db.floors.find(floor =>
      floor._facility === facName && f(floor, 'Name').toLowerCase() === floorName.toLowerCase()
    );
    if (existing) {
      _mergeRowData(existing, row);
    } else {
      db.floors.push(row);
    }
  });
  db.systems    .push(...readSheet(wb,'System')   .map(tag));
  db.documents  .push(...readSheet(wb,'Document') .map(tag));
  db.contacts   .push(...readSheet(wb,'Contact')  .map(tag));
  db.attributes .push(...readSheet(wb,'Attribute').map(tag));
  db.coordinates.push(...readSheet(wb,'Coordinate').map(tag));
  (db.picklists ||= []).push(...readSheet(wb,'Picklist').map(tag));
  db.facilities .push({ ...facRow, _facility: facName, _fileName: fileName,
    _projectCode: projectCode,
    _facRowCount: facRows.length, _workbook: wb,
    _sourceBuffer: sourceBuffer ? sourceBuffer.slice(0) : null, _fileHandle: fileHandle });
  if (!db.facility) db.facility = facRow; // backward compat
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
  [db.components, db.types, db.spaces, db.floors, db.systems, db.facilities, db.contacts]
    .forEach(rows => rows.forEach(row => { delete row._attrs; }));

  if (!db.attributes.length) return;

  const by = {
    component: Object.create(null),
    type: Object.create(null),
    space: Object.create(null),
    floor: Object.create(null),
    facility: Object.create(null),
    contact: Object.create(null),
    system: Object.create(null),
  };

  const setSingle = (bucket, row, name) => {
    const key = _rowKey(row, name);
    if (key) bucket[key] = row;
  };

  db.components.forEach(row => setSingle(by.component, row, f(row,'Name')));
  db.types.forEach(row => setSingle(by.type, row, f(row,'Name')));
  db.spaces.forEach(row => setSingle(by.space, row, f(row,'Name')));
  db.floors.forEach(row => setSingle(by.floor, row, f(row,'Name')));
  db.contacts.forEach(row => {
    setSingle(by.contact, row, f(row,'Name'));
    setSingle(by.contact, row, f(row,'Email'));
  });
  db.facilities.forEach(row => {
    setSingle(by.facility, row, f(row,'Name'));
    setSingle(by.facility, row, row._facility);
  });
  db.systems.forEach(row => {
    const key = _rowKey(row, f(row,'Name'));
    if (!key) return;
    (by.system[key] = by.system[key] || []).push(row);
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
    if (sheetName === 'component') {
      _addBoundAttribute(by.component[key], attrName, attrValue);
    } else if (sheetName === 'type') {
      _addBoundAttribute(by.type[key], attrName, attrValue);
    } else if (sheetName === 'space') {
      _addBoundAttribute(by.space[key], attrName, attrValue);
    } else if (sheetName === 'floor') {
      _addBoundAttribute(by.floor[key], attrName, attrValue);
    } else if (sheetName === 'facility') {
      _addBoundAttribute(by.facility[key], attrName, attrValue);
    } else if (sheetName === 'contact') {
      _addBoundAttribute(by.contact[key], attrName, attrValue);
    } else if (sheetName === 'system') {
      (by.system[key] || []).forEach(systemRow => _addBoundAttribute(systemRow, attrName, attrValue));
    }
  });
}

// ── Derived indexes and document contexts ────────────────────
function buildIdx() {
  _bindAttributeData();

  // Documents
  idx.docs = {};
  db.documents.forEach(d => {
    const s = _cobieField(d, 'sheetName').toLowerCase();
    const r = _cobieField(d, 'rowName').toLowerCase();
    const key = _scopeKey(d._facility, s + '::' + r);
    if (s && r) (idx.docs[key] = idx.docs[key] || []).push(d);
  });

  // Space to floor
  idx.spFloor = {};
  db.spaces.forEach(s => {
    const sp = f(s,'Name').toLowerCase();
    const fl = _cobieField(s, 'floorName').toLowerCase();
    if (sp) idx.spFloor[_rowKey(s, sp)] = fl;
  });

  // By type / by space
  idx.byType  = {};
  idx.bySpace = {};
  db.components.forEach(c => {
    const tn = _cobieField(c, 'typeName').toLowerCase();
    const typeKey = _rowKey(c, tn);
    (idx.byType[typeKey] = idx.byType[typeKey] || []).push(c);
    const sp = f(c,'Space').toLowerCase();
    if (sp) {
      const spaceKey = _rowKey(c, sp);
      (idx.bySpace[spaceKey] = idx.bySpace[spaceKey] || []).push(c);
    }
  });

  // Systems (handles multiple-row-per-component pattern)
  const byName = {};
  db.components.forEach(c => { byName[_rowKey(c, f(c,'Name'))] = c; });

  const sysSets = {};
  db.systems.forEach(s => {
    const systemName = f(s,'Name').toLowerCase();
    if (!systemName) return;
    const key = _rowKey(s, systemName);
    if (!sysSets[key]) sysSets[key] = new Set();
    const raw = f(s,'ComponentNames','Component Names');
    if (raw) raw.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)
                .forEach(cn => sysSets[key].add(cn));
  });

  idx.bySys = {};
  Object.entries(sysSets).forEach(([k,set]) => {
    const facility = k.split('::')[0];
    idx.bySys[k] = [...set].map(n => byName[_scopeKey(facility, n)]).filter(Boolean);
  });

  // Reverse: component to systems
  idx.compSys = {};
  Object.entries(idx.bySys).forEach(([sk,comps]) => {
    comps.forEach(c => {
      const cn = _rowKey(c, f(c,'Name'));
      const systemName = sk.slice(sk.indexOf('::') + 2);
      (idx.compSys[cn] = idx.compSys[cn] || []).push(systemName);
    });
  });

  // Sorted unique lists (deduplicated across multiple files)
  idx.floors = [...new Set(
    db.floors.length
      ? db.floors.map(x => f(x,'Name'))
      : db.spaces.map(x => _cobieField(x, 'floorName'))
  )].filter(Boolean).sort();

  idx.spaces  = [...new Set(db.spaces .map(s=>f(s,'Name')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  idx.types   = [...new Set(db.types  .map(t=>f(t,'Name')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  idx.systems = [...new Set(db.systems.map(s=>f(s,'Name')))].filter(Boolean).sort();
  idx.facilityNames = [...new Set(db.facilities.map(fac => fac._facility||'').filter(Boolean))].sort();

  // Description lookup indices
  idx.desc = { facility:{}, floor:{}, space:{}, type:{}, system:{}, doccat:{} };
  db.facilities.forEach(x => { const n=(x._facility||'').toLowerCase(); if(n) idx.desc.facility[n] = f(x,'Description'); });
  db.floors .forEach(x => { const n=f(x,'Name').toLowerCase(); if(n) idx.desc.floor[n]  = f(x,'Description'); });
  db.spaces .forEach(x => { const n=f(x,'Name').toLowerCase(); if(n) idx.desc.space[n]  = f(x,'Description'); });
  db.types  .forEach(x => { const n=f(x,'Name').toLowerCase(); if(n) idx.desc.type[n]   = f(x,'Description'); });
  const _seenSys = new Set();
  db.systems.forEach(x => {
    const n=f(x,'Name').toLowerCase();
    if(n && !_seenSys.has(n)) { _seenSys.add(n); idx.desc.system[n] = f(x,'Description'); }
  });

  // Category groups for Space, Type, System filter panels
  // Classification hierarchy from the Picklist master columns.
  idx.catGroups = {};
  idx.categoryTrees = {};
  const categorySpecs = {
    facility:{ column:'Category-Facility', rows:db.facilities, names:row => row._facility || f(row,'Name') },
    space:{ column:'Category-Space', rows:db.spaces, names:row => f(row,'Name') },
    type:{ column:'Category-Product', rows:db.types, names:row => f(row,'Name') },
    system:{ column:'Category-Element', rows:db.systems, names:row => f(row,'Name') },
    doccat:{ column:'DocumentType', rows:db.documents, names:row => f(row,'Category') },
  };
  Object.entries(categorySpecs).forEach(([dim, spec]) => {
    const labels = new Map();
    (db.picklists || []).forEach(row => {
      const value = f(row, spec.column);
      const { code, label } = classificationParts(value);
      if (code && !labels.has(code.toLowerCase())) labels.set(code.toLowerCase(), label);
    });

    const direct = new Map();
    spec.rows.forEach(row => {
      const name = spec.names(row);
      const category = dim === 'doccat' ? name : f(row,'Category');
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
    idx.catGroups[dim] = groups;
    idx.categoryTrees[dim] = nodes;
  });

  // Search text cache — one lowercase string per component covering all relevant fields
  const tByN = {}, sByN = {};
  db.types .forEach(t => { tByN[_rowKey(t, f(t,'Name'))] = t; });
  db.spaces.forEach(s => { sByN[_rowKey(s, f(s,'Name'))] = s; });
  idx.searchText = {};
  db.components.forEach(c => {
    const tn = _cobieField(c, 'typeName').toLowerCase();
    const sp = f(c,'Space').toLowerCase();
    const t2 = tByN[_rowKey(c, tn)], s2 = sByN[_rowKey(c, sp)];
    const cAttr = Object.entries(c._attrs || {}).map(([k,val]) => k + ' ' + val).join(' ');
    const tAttr = t2 ? Object.entries(t2._attrs || {}).map(([k,val]) => k + ' ' + val).join(' ') : '';
    const sAttr = s2 ? Object.entries(s2._attrs || {}).map(([k,val]) => k + ' ' + val).join(' ') : '';
    idx.searchText[_rowKey(c, f(c,'Name'))] = [
      f(c,'Name'), _cobieField(c, 'typeName'), f(c,'Space'),
      f(c,'Description'), f(c,'SerialNumber','Serial Number'),
      f(c,'TagNumber','Tag Number'), f(c,'BarCode','Bar Code'),
      f(c,'AssetIdentifier','Asset Identifier'),
      t2 ? [f(t2,'Category'),f(t2,'Manufacturer'),f(t2,'ModelNumber','Model Number'),f(t2,'Description')].join(' ') : '',
      s2 ? [f(s2,'Description'),f(s2,'Category'),f(s2,'FloorName','Floor Name')].join(' ') : '',
      cAttr, tAttr, sAttr,
    ].filter(Boolean).join(' ').toLowerCase();
  });

  // Document category index
  const _dcDisp = {};
  db.documents.forEach(d => {
    const c = f(d,'Category'); if (!c) return;
    _dcDisp[c.toLowerCase()] = c;
  });
  // Track which categories appear on facility docs vs other supported entity docs
  const _catsOnFac  = new Set();
  const _catsOnComp = new Set();
  db.documents.forEach(d => {
    const sn  = _cobieField(d, 'sheetName').toLowerCase();
    const cv  = f(d,'Category'); if (!cv) return;
    const cvl = cv.toLowerCase();
    if (sn === 'facility') {
      _catsOnFac.add(cvl);
    } else if (['component','type','space','floor','system'].includes(sn)) {
      _catsOnComp.add(cvl);
    }
  });
  // Categories that ONLY exist on facility docs
  idx.docCatFacilityOnly = new Set([..._catsOnFac].filter(c => !_catsOnComp.has(c)));
  idx.documentContexts = _buildDocumentContexts();
  idx.docCatByComp = {};
  idx.documentContexts.forEach(context => {
    context.components.forEach(componentKey => {
      const cats = idx.docCatByComp[componentKey] ||= new Set();
      context.categories.forEach(category => cats.add(category));
    });
  });
  idx.docCategories = Object.keys(_dcDisp).map(k => _dcDisp[k]).sort((a,b) => {
    const pa=a.startsWith('('), pb=b.startsWith('(');
    return pa!==pb ? (pa?1:-1) : a.localeCompare(b);
  });
}

function docsFor(sheet, name, facility) {
  if (facility) return idx.docs[_scopeKey(facility, sheet + '::' + name)] || [];
  const suffix = '::' + (sheet + '::' + name).toLowerCase();
  return Object.entries(idx.docs).filter(([key]) => key.endsWith(suffix)).flatMap(([,docs]) => docs);
}

function _buildDocumentContexts() {
  const contexts = new Map();
  const componentsByKey = {};
  db.components.forEach(component => { componentsByKey[_rowKey(component, f(component,'Name'))] = component; });

  const addComponentContext = (context, component) => {
    if (!component) return;
    const facility = (component._facility || '').toLowerCase();
    const componentName = f(component,'Name').toLowerCase();
    const typeName = _cobieField(component, 'typeName').toLowerCase();
    const spaceName = f(component,'Space').toLowerCase();
    const floorName = idx.spFloor[_scopeKey(facility, spaceName)] || '';
    context.components.add(_rowKey(component, componentName));
    if (typeName) context.types.add(typeName);
    if (spaceName) context.spaces.add(spaceName);
    if (floorName) context.floors.add(floorName);
    (idx.compSys[_rowKey(component, componentName)] || []).forEach(system => context.systems.add(system));
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
        categories:new Set(), facilities:new Set(), floors:new Set(), spaces:new Set(),
        types:new Set(), systems:new Set(), components:new Set(),
      };
      contexts.set(contextKey, context);
    }
    if (category) context.categories.add(category);
    if (facility) context.facilities.add(facility);
    const linkedKey = linkedName.toLowerCase();
    if (linkedType === 'component') {
      addComponentContext(context, componentsByKey[_scopeKey(facility, linkedKey)]);
    } else if (linkedType === 'type' && linkedKey) {
      context.types.add(linkedKey);
    } else if (linkedType === 'space' && linkedKey) {
      context.spaces.add(linkedKey);
      const floor = idx.spFloor[_scopeKey(facility, linkedKey)] || '';
      if (floor) context.floors.add(floor);
    } else if (linkedType === 'floor' && linkedKey) {
      context.floors.add(linkedKey);
    } else if (linkedType === 'system' && linkedKey) {
      context.systems.add(linkedKey);
    }
  });
  return [...contexts.values()];
}
