// ── Entity information modal ──────────────────────────────────
let _typeModalViewContext = null;
let _typeModalReturnContext = null;
let _projectAssociationsChanged = false;
let _projectOpeningChildModal = false;
const _associationOptionsCache = new Map();
let _associationOptionsCacheCounter = 0;
const _ASSOCIATION_OPTION_LIMIT = 120;
const _ALIASES_ROW_NAME = _cobieFieldAliasesFor('RowName');
const _ALIASES_SHEET_NAME = _cobieFieldAliasesFor('SheetName');
const _ALIASES_TYPE_NAME = _cobieFieldAliasesFor('TypeName');
const _ALIASES_FLOOR_NAME = _cobieFieldAliasesFor('FloorName');

function _setReference(row, aliases, oldName, newName) {
  if (f(row, ...aliases).toLowerCase() !== oldName.toLowerCase()) return;
  const key = aliases.find(alias => v(row[alias]).toLowerCase() === oldName.toLowerCase())
    || aliases.find(alias => Object.prototype.hasOwnProperty.call(row, alias)) || aliases[0];
  row[key] = newName;
}

function _renameDocumentRows(sheetName, oldName, newName, facility) {
  db.documents.forEach(doc => {
    if (facility && doc._facility !== facility) return;
    if (_cobieField(doc, 'sheetName').toLowerCase() !== sheetName.toLowerCase()) return;
    _setReference(doc, _ALIASES_ROW_NAME, oldName, newName);
  });
}

function _replaceSelectedKey(dim, oldName, newName) {
  if (!sel[dim]) return;
  const oldKey = oldName.toLowerCase();
  const newKey = newName.toLowerCase();
  if (sel[dim].delete(oldKey)) sel[dim].add(newKey);
}

function _cascadeEntityRename(entityType, oldName, newName, facility) {
  if (!newName || oldName === newName) return facility;
  _renameDocumentRows(entityType, oldName, newName, facility);

  if (entityType === 'component') {
    db.systems.forEach(system => {
      if (facility && system._facility !== facility) return;
      const key = v(system.ComponentNames) ? 'ComponentNames'
        : Object.prototype.hasOwnProperty.call(system, 'Component Names') ? 'Component Names' : 'ComponentNames';
      const names = String(system[key] || '').split(',').map(name => name.trim()).filter(Boolean);
      system[key] = names.map(name => name.toLowerCase() === oldName.toLowerCase() ? newName : name).join(',');
    });
  } else if (entityType === 'type') {
    db.components.forEach(component => {
      if (!facility || component._facility === facility) _setReference(component, _ALIASES_TYPE_NAME, oldName, newName);
    });
    _replaceSelectedKey('type', oldName, newName);
  } else if (entityType === 'space') {
    db.components.forEach(component => {
      if (!facility || component._facility === facility) _setReference(component, ['Space'], oldName, newName);
    });
    _replaceSelectedKey('space', oldName, newName);
  } else if (entityType === 'floor') {
    db.spaces.forEach(space => {
      if (!facility || space._facility === facility) _setReference(space, _ALIASES_FLOOR_NAME, oldName, newName);
    });
    _replaceSelectedKey('floor', oldName, newName);
  } else if (entityType === 'system') {
    _replaceSelectedKey('system', oldName, newName);
  } else if (entityType === 'facility') {
    const oldFacility = facility || oldName;
    ['components', 'types', 'spaces', 'floors', 'zones', 'systems', 'documents', 'contacts', 'facilities'].forEach(key => {
      db[key].forEach(row => { if (row._facility === oldFacility) row._facility = newName; });
    });
    if (db.facility) db.facility.Name = newName;
    _replaceSelectedKey('facility', oldFacility, newName);
    return newName;
  }
  return facility;
}

function _updateSysComponents(sysName, newComps, facility) {
  const rows = db.systems.filter(system =>
    f(system, 'Name') === sysName && (!facility || system._facility === facility)
  );
  if (rows.length) {
    rows.forEach((row, index) => {
      const key = row.ComponentNames !== undefined ? 'ComponentNames' : 'Component Names';
      row[key] = index === 0 ? newComps.join(',') : '';
    });
  } else if (newComps.length) {
    db.systems.push({
      Name:sysName,
      ComponentNames:newComps.join(','),
      _facility:facility || db.facilities[0]?._facility || '',
    });
  }
}

function _updateCompSystems(componentName, newSystems, facility) {
  const componentKey = componentName.toLowerCase();
  idx.systems.forEach(systemName => {
    const rows = db.systems.filter(system =>
      f(system, 'Name') === systemName && (!facility || system._facility === facility)
    );
    const shouldInclude = newSystems.has(systemName);
    rows.forEach(system => {
      const key = system.ComponentNames !== undefined ? 'ComponentNames' : 'Component Names';
      const names = String(system[key] || '').split(',').map(name => name.trim()).filter(Boolean);
      const index = names.findIndex(name => name.toLowerCase() === componentKey);
      if (shouldInclude && index < 0) names.push(componentName);
      if (!shouldInclude && index >= 0) names.splice(index, 1);
      system[key] = names.join(',');
    });
    if (shouldInclude && !rows.length) {
      const component = db.components.find(row => f(row, 'Name') === componentName);
      db.systems.push({
        Name:systemName,
        ComponentNames:componentName,
        _facility:facility || component?._facility || '',
      });
    }
  });
}

function _setTypeModalCloseReturns(shouldReturn) {
  const closeButton = document.querySelector('#type-modal .modal-header .btn-close');
  if (!closeButton) return;
  if (shouldReturn) closeButton.removeAttribute('data-bs-dismiss');
  else closeButton.setAttribute('data-bs-dismiss', 'modal');
}

function _setProjectModalColor(modal, token) {
  if (!modal) return;
  const normalized = String(token || 'facility').toLowerCase();
  modal.dataset.projectColor = normalized === 'doccat' ? 'document' : normalized;
  modal.querySelector('.modal-header .btn-close')?.classList.remove('btn-close-white');
}

function _projectReturnContext(context = _projectActiveEntityContext()) {
  if (!context) return null;
  if (context.entityType === 'document') return { kind:'document', documentRow:context.row };
  if (context.entityType === 'component') {
    return { kind:'component', entityName:context.entityName, facility:context.facility };
  }
  return { kind:'group', entityType:context.entityType, entityName:context.entityName, facility:context.facility };
}

function restoreTypeModalView(context) {
  if (!context) return;
  if (context.kind === 'group') {
    openGroupInfo(context.entityType, context.entityName, context.facility || '');
  } else if (context.kind === 'document' && context.documentRow) {
    openDoc(context.documentRow, context.returnContext || null);
  } else if (context.kind === 'component') {
    openComponentInfo(context.entityName, context.facility || '');
  }
}

function openGroupInfo(dim, name, facility) {
  const entityType = String(dim || '').toLowerCase();
  _typeModalReturnContext = null;
  _setTypeModalCloseReturns(false);
  _typeModalViewContext = { kind:'group', entityType, entityName:name, facility:facility || '' };
  const modalConfig = MODEL_MODAL_CONFIG?.[entityType] || null;
  const typeModal = document.getElementById('type-modal');
  const useProjectLayout = Boolean(modalConfig);
  _projectDocCollapsedCategories.clear();
  typeModal.classList.toggle('project-modal', useProjectLayout);
  _setProjectModalColor(typeModal, modalConfig?.headerColorToken || entityType);
  document.getElementById('mtype-icon').className  = `bi ${_GRP_ICONS[entityType]||'bi-info-circle'} me-2`;
  document.getElementById('mtype-title').textContent = modalConfig?.title
    ? (name ? `${modalConfig.title}: ${name}` : modalConfig.title)
    : String(name || 'Information');
  let body = '';
  if (entityType === 'facility') {
    body = buildFacilityBody(name);
  } else if (entityType === 'doccat') {
    body = buildDocumentCategoryBody(name, facility);
  } else if (modalConfig) {
    body = buildEntityInfoBody(entityType, name, facility);
  } else {
    body = '<p class="text-muted small mb-0">No information view is available for this group yet.</p>';
  }
  document.getElementById('mtype-body').innerHTML = body;
  const docTree = typeModal.querySelector('.project-doc-tree');
  if (docTree) _projectApplyDocTreeVisibility(docTree);
  bootstrap.Modal.getOrCreateInstance(typeModal).show();
}

function buildDocumentCategoryBody(categoryKey, facility) {
  const key = String(categoryKey || '').toLowerCase();
  const docs = db.documents.filter(doc => {
    if (facility && String(doc._facility || '').toLowerCase() !== String(facility).toLowerCase()) return false;
    const code = classificationParts(f(doc, 'Category') || '(Uncategorised)').code.toLowerCase();
    return code === key || code.startsWith(key + '_');
  });
  if (!docs.length) return '<p class="text-muted small mb-0">No documents are linked to this category.</p>';
  return `<div class="small text-muted mb-2">${docs.length} document${docs.length === 1 ? '' : 's'}</div>
    <div class="doc-list">${docs.map(doc => _docListItem(doc, true)).join('')}</div>`;
}

const _INFO_ENTITY_SHEET = Object.freeze({
  type: 'Type',
  system: 'System',
  space: 'Space',
  zone: 'Zone',
  floor: 'Floor',
  facility: 'Facility',
  component: 'Component',
  contact: 'Contact',
  document: 'Document',
});

const _INFO_ENTITY_DB = Object.freeze({
  type: 'types',
  system: 'systems',
  space: 'spaces',
  zone: 'zones',
  floor: 'floors',
  facility: 'facilities',
  component: 'components',
  contact: 'contacts',
  document: 'documents',
});

function _infoCardTintClass(token) {
  const t = String(token || '').toLowerCase();
  return t ? `project-card-${t}` : '';
}

function _projectAddActionButton(className, title) {
  return `<button class="${esc(className)}" type="button" title="${esc(title)}" aria-label="${esc(title)}"><i class="bi bi-plus-circle"></i></button>`;
}

function _infoDocumentsCard(entityType, entityName, facility) {
  const sheet = _INFO_ENTITY_SHEET[entityType] || '';
  const docs = (sheet && entityName) ? docsFor(sheet, entityName, facility) : [];
  const entityLabel = {
    facility: 'project',
    floor: 'floor',
    space: 'space',
    type: 'type',
    system: 'system',
    document: 'document',
  }[String(entityType || '').toLowerCase()] || 'record';
  const treeActions = docs.length
    ? `<button class="project-doc-tree-step" type="button" data-project-doc-tree-step="collapse" title="Collapse one classification level"><i class="bi bi-chevron-up"></i></button>
      <button class="project-doc-tree-step" type="button" data-project-doc-tree-step="expand" title="Expand one classification level"><i class="bi bi-chevron-down"></i></button>`
    : '';
  const actions = `<span class="project-doc-level-actions">
    ${_projectAddActionButton('project-doc-add-btn', 'Add document')}
    ${treeActions}
  </span>`;

  if (!docs.length) {
    return {
      body: `<p class="project-empty mb-0">No documents are linked to this ${entityLabel}.</p>`,
      actions,
    };
  }

  return {
    body: `<div class="project-doc-filter-wrap">
      <i class="bi bi-search"></i>
      <input type="search" class="project-doc-search" placeholder="Search document names, descriptions, links, and categories" autocomplete="off">
    </div>
    <div class="project-doc-scroll"><div class="project-doc-tree">${_projectDocTree(docs)}</div></div>`,
    actions,
  };
}

function _associationTargetRows(targetType, facility) {
  const bucket = _INFO_ENTITY_DB[targetType];
  const rows = bucket ? db[bucket] : [];
  if (!Array.isArray(rows)) return [];
  const scoped = targetType === 'facility'
    ? rows
    : rows.filter(row => !facility || String(row._facility || '') === String(facility));
  const unique = new Map();
  scoped.forEach(row => {
    const name = _associationTargetName(targetType, row);
    const key = name.toLowerCase();
    if (key && !unique.has(key)) unique.set(key, row);
  });
  return [...unique.values()];
}

function _associationTargetName(targetType, row) {
  return _projectEntityIdentity(targetType, row);
}

function _projectEntityIdentity(entityType, row, fallback = '') {
  if (entityType === 'facility') return String(row?._facility || f(row, 'Name') || fallback).trim();
  if (entityType === 'contact') return String(f(row, 'Email') || fallback).trim();
  return String(f(row, 'Name') || fallback).trim();
}

function _associationCategory(targetType, row, facility) {
  let categoryRow = row;
  let dimension = targetType;
  if (targetType === 'component') {
    dimension = 'type';
    const typeName = _cobieField(row, 'typeName');
    categoryRow = _findEntity(db.types, typeName, row?._facility || facility || '') || null;
  }
  if (!['type', 'system', 'space'].includes(dimension)) return null;
  const categoryValue = categoryRow ? f(categoryRow, 'Category') : '';
  const { code, label } = classificationParts(categoryValue || '(Uncategorised)');
  const key = String(code || '(Uncategorised)').toLowerCase();
  return { dimension, key, label:label || code || '(Uncategorised)' };
}

function _associationHierarchy(options, targetType) {
  if (!['type', 'system', 'space', 'component'].includes(targetType)) return [];
  const dimension = targetType === 'component' ? 'type' : targetType;
  const known = new Map((idx.categoryTrees?.[dimension] || []).map(node => [node.key, node]));
  const directLabels = new Map(options.map(option => [option.categoryKey, option.categoryLabel]).filter(([, label]) => label));
  const keys = new Set();
  options.forEach(option => {
    const key = option.categoryKey || '(uncategorised)';
    if (key.startsWith('(')) {
      keys.add(key);
    } else {
      classificationAncestors(key).forEach(parent => keys.add(parent.toLowerCase()));
    }
  });
  return [...keys].map(key => {
    const node = known.get(key);
    return {
      key,
      label:directLabels.get(key) || node?.label || (key.startsWith('(') ? '(Uncategorised)' : key),
      depth:node?.depth ?? (key.startsWith('(') ? 0 : Math.max(0, key.split('_').length - 2)),
    };
  }).sort((a, b) => {
    const uncategorised = Number(a.key.startsWith('(')) - Number(b.key.startsWith('('));
    return uncategorised || a.key.localeCompare(b.key, undefined, { numeric:true });
  });
}

function _associationOptionSearchText(option, hierarchy) {
  const categoryText = hierarchy
    .filter(node => option.categoryKey === node.key || option.categoryKey?.startsWith(node.key + '_'))
    .flatMap(node => [node.key, node.label]);
  return [option.name, ...categoryText].join(' ').toLowerCase();
}

function _documentAssociationRows(documentRow) {
  if (!documentRow) return [];
  if (!db.documents.includes(documentRow)) return [documentRow];
  const group = String(documentRow._associationGroup || '');
  if (group) return db.documents.filter(row => row._associationGroup === group);
  const name = f(documentRow, 'Name').toLowerCase();
  const directory = f(documentRow, 'Directory').toLowerCase();
  const file = f(documentRow, 'File').toLowerCase();
  return db.documents.filter(row =>
    f(row, 'Name').toLowerCase() === name &&
    f(row, 'Directory').toLowerCase() === directory &&
    f(row, 'File').toLowerCase() === file
  );
}

function _associationSelectedNames(entityType, row, association, facility) {
  const selected = new Set();
  if (!row || !association) return selected;
  const key = String(association.key || '');
  const staged = _newEntityDraft?.row === row ? _newEntityDraft.associations?.[key] : null;
  if (staged instanceof Set) return new Set(staged);

  if (entityType === 'component' && key === 'type') {
    const value = _cobieField(row, 'typeName');
    if (value) selected.add(value.toLowerCase());
  } else if (entityType === 'component' && key === 'space') {
    const value = f(row, 'Space');
    if (value) selected.add(value.toLowerCase());
  } else if (entityType === 'component' && key === 'systems') {
    (idx.compSys?.[_rowKey(row, f(row, 'Name'))] || []).forEach(name => selected.add(name.toLowerCase()));
  } else if (entityType === 'space' && key === 'floor') {
    const value = _cobieField(row, 'floorName');
    if (value) selected.add(value.toLowerCase());
  } else if (entityType === 'type' && key === 'components') {
    db.components.forEach(component => {
      if ((!facility || component._facility === facility) && _cobieField(component, 'typeName').toLowerCase() === f(row, 'Name').toLowerCase()) {
        selected.add(f(component, 'Name').toLowerCase());
      }
    });
  } else if (entityType === 'space' && key === 'components') {
    db.components.forEach(component => {
      if ((!facility || component._facility === facility) && f(component, 'Space').toLowerCase() === f(row, 'Name').toLowerCase()) {
        selected.add(f(component, 'Name').toLowerCase());
      }
    });
  } else if (entityType === 'floor' && key === 'spaces') {
    db.spaces.forEach(space => {
      if ((!facility || space._facility === facility) && _cobieField(space, 'floorName').toLowerCase() === f(row, 'Name').toLowerCase()) {
        selected.add(f(space, 'Name').toLowerCase());
      }
    });
  } else if (entityType === 'system' && key === 'components') {
    const systemName = f(row, 'Name').toLowerCase();
    db.systems.forEach(system => {
      if ((!facility || system._facility === facility) && f(system, 'Name').toLowerCase() === systemName) {
        f(system, 'ComponentNames', 'Component Names').split(',').map(name => name.trim().toLowerCase()).filter(Boolean).forEach(name => selected.add(name));
      }
    });
  } else if (entityType === 'document') {
    const targetSheet = _INFO_ENTITY_SHEET[association.targetType]?.toLowerCase();
    _documentAssociationRows(row).forEach(documentLink => {
      if (_cobieField(documentLink, 'sheetName').toLowerCase() === targetSheet) {
        selected.add(_cobieField(documentLink, 'rowName').toLowerCase());
      }
    });
  }
  return selected;
}

function _associationControl(entityType, row, association, facility) {
  const targetType = String(association?.targetType || '').toLowerCase();
  const selected = _associationSelectedNames(entityType, row, association, facility);
  const options = _associationTargetRows(targetType, facility)
    .map(targetRow => {
      const name = _associationTargetName(targetType, targetRow);
      const targetFacility = String(targetRow?._facility || (targetType === 'facility' ? name : facility) || '');
      const category = _associationCategory(targetType, targetRow, facility);
      return {
        name,
        targetFacility,
        selected:selected.has(name.toLowerCase()),
        categoryKey:category?.key || '',
        categoryLabel:category?.label || '',
      };
    })
    .filter(option => option.name)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name, undefined, { numeric:true }));
  const inputType = association.cardinality === 'one' ? 'radio' : 'checkbox';
  const inputName = `association-${entityType}-${association.key}`;
  const hierarchy = _associationHierarchy(options, targetType);
  options.forEach(option => { option.search = _associationOptionSearchText(option, hierarchy); });
  const cacheId = `association-options-${++_associationOptionsCacheCounter}`;
  const state = {
    options,
    inputType,
    inputName,
    hierarchy,
    collapsed:new Set(),
    visibleLimit:_ASSOCIATION_OPTION_LIMIT,
    query:'',
  };
  _associationOptionsCache.set(cacheId, state);
  const visibleOptions = [
    ...options.filter(option => option.selected),
    ...options.filter(option => !option.selected).slice(0, _ASSOCIATION_OPTION_LIMIT),
  ];
  const optionHtml = _associationOptionsMarkup(visibleOptions, state);
  const hasMore = options.length > visibleOptions.length;
  const locateAction = entityType === 'component' && association.key === 'space'
    ? '<button type="button" class="btn btn-sm btn-outline-secondary project-component-locate"><i class="bi bi-geo-alt me-1"></i>Locate in 2D / 3D</button>'
    : '';
  const countLabel = selected.size ? `${selected.size} selected` : 'None selected';

  return `<details class="project-association project-association-${esc(targetType)}" data-association-key="${esc(association.key)}" data-target-type="${esc(targetType)}" data-cardinality="${esc(association.cardinality || 'many')}" data-options-cache="${esc(cacheId)}">
    <summary><span>${esc(association.label || association.key)}</span><span class="project-association-count">${countLabel}</span></summary>
    <div class="project-association-menu">
      <div class="project-association-search-wrap"><i class="bi bi-search"></i><input type="search" class="project-association-search" placeholder="Search ${esc(String(association.label || association.key).toLowerCase())}" autocomplete="off"></div>
      <div class="project-association-options">${optionHtml || '<div class="project-association-empty">No items available.</div>'}</div>
      <div class="project-association-limit${hasMore ? '' : ' d-none'}">Scroll for more</div>
      ${locateAction}
      <button type="button" class="btn btn-sm btn-outline-secondary project-association-create${options.length ? ' d-none' : ''}"><i class="bi bi-plus-circle me-1"></i>New ${esc(MODEL_MODAL_CONFIG?.[targetType]?.title?.replace(/ Information$/, '') || targetType)}</button>
      ${association.cardinality === 'many' ? '<button type="button" class="btn btn-sm btn-link project-association-clear">Clear All</button>' : ''}
    </div>
  </details>`;
}

function _associationOptionMarkup(option, state, depth = 0) {
  return `<label class="project-association-option${option.selected ? ' project-association-selected' : ''}" data-search="${esc(option.search || option.name.toLowerCase())}" style="--association-depth:${depth}">
    <input class="form-check-input" type="${state.inputType}" name="${esc(state.inputName)}" value="${esc(option.name)}" data-target-facility="${esc(option.targetFacility)}"${option.selected ? ' checked' : ''}>
    <span title="${esc(option.name)}">${esc(option.name)}</span>
  </label>`;
}

function _associationCategoryHidden(state, categoryKey) {
  if (state.searching) return false;
  return [...state.collapsed].some(parent => categoryKey === parent || categoryKey.startsWith(parent + '_'));
}

function _associationOptionsMarkup(options, state) {
  if (!state.hierarchy.length) return options.map(option => _associationOptionMarkup(option, state)).join('');
  const html = [];
  state.hierarchy.forEach(node => {
    const subtree = options.filter(option =>
      option.categoryKey === node.key || option.categoryKey?.startsWith(node.key + '_'));
    if (!subtree.length) return;
    const direct = options.filter(option => option.categoryKey === node.key);
    const hasChildren = direct.length > 0 || state.hierarchy.some(child =>
      child.depth > node.depth && child.key.startsWith(node.key + '_') &&
      options.some(option => option.categoryKey === child.key || option.categoryKey?.startsWith(child.key + '_')));
    const hidden = !state.searching && [...state.collapsed].some(parent => node.key !== parent && node.key.startsWith(parent + '_'));
    const collapsed = !state.searching && state.collapsed.has(node.key);
    const grade = Math.max(28, 78 - node.depth * 13);
    html.push(`<div class="project-association-cat${hidden ? ' d-none' : ''}${collapsed ? ' project-association-cat-collapsed' : ''}" data-association-cat="${esc(node.key)}" data-depth="${node.depth}" style="--association-depth:${node.depth};--cat-grade:${grade}%">
      ${hasChildren ? `<button type="button" class="project-association-cat-toggle" title="${collapsed ? 'Expand' : 'Collapse'} ${esc(node.label)}" aria-expanded="${collapsed ? 'false' : 'true'}"><i class="bi bi-chevron-down"></i></button>` : '<span class="project-association-cat-spacer"></span>'}
      <span class="project-association-cat-name" title="${esc(node.label)}">${esc(node.label)}</span>
      <span class="project-association-cat-count">${subtree.length}</span>
    </div>`);
    if (!collapsed && !_associationCategoryHidden(state, node.key)) {
      direct.forEach(option => html.push(_associationOptionMarkup(option, state, node.depth + 1)));
    }
  });
  return html.join('');
}

function _associationRenderOptions(control, query = '', resetLimit = false) {
  const state = _associationOptionsCache.get(control?.dataset.optionsCache || '');
  const host = control?.querySelector('.project-association-options');
  if (!state || !host) return { hasMatch:false };
  const q = String(query || '').trim().toLowerCase();
  const resetScroll = resetLimit || q !== state.query;
  if (resetScroll) state.visibleLimit = _ASSOCIATION_OPTION_LIMIT;
  state.query = q;
  state.searching = Boolean(q);
  const matches = state.options.filter(option => !q || option.search.includes(q));
  const unselectedMatches = matches.filter(option => !option.selected);
  const visible = [
    ...state.options.filter(option => option.selected && !matches.includes(option)),
    ...matches.filter(option => option.selected),
    ...unselectedMatches.slice(0, state.visibleLimit),
  ];
  host.innerHTML = _associationOptionsMarkup(visible, state)
    || '<div class="project-association-empty">No matching items.</div>';
  if (resetScroll) host.scrollTop = 0;
  const hasMore = unselectedMatches.length > state.visibleLimit;
  const limit = control.querySelector('.project-association-limit');
  if (limit) {
    limit.classList.toggle('d-none', !hasMore);
    limit.textContent = hasMore
      ? `Showing ${Math.min(state.visibleLimit, unselectedMatches.length)} of ${unselectedMatches.length}. Scroll for more.`
      : '';
  }
  return { hasMatch:matches.length > 0 };
}

function _associationLoadMore(optionsHost) {
  const control = optionsHost?.closest('.project-association');
  const state = _associationOptionsCache.get(control?.dataset.optionsCache || '');
  if (!control || !state || optionsHost.scrollTop + optionsHost.clientHeight < optionsHost.scrollHeight - 32) return false;
  const matches = state.options.filter(option => !state.query || option.search.includes(state.query));
  const unselectedCount = matches.filter(option => !option.selected).length;
  if (state.visibleLimit >= unselectedCount) return false;
  const scrollTop = optionsHost.scrollTop;
  state.visibleLimit = Math.min(state.visibleLimit + _ASSOCIATION_OPTION_LIMIT, unselectedCount);
  _associationRenderOptions(control, state.query);
  optionsHost.scrollTop = scrollTop;
  return true;
}

function _infoAssociationsCard(entityType, row, associations, facility) {
  const controls = (associations || []).map(association => _associationControl(entityType, row, association, facility)).join('');
  return controls || '<div class="project-empty">No associations configured.</div>';
}

function _documentApplicableToMarkup(row, associations, facility) {
  const groups = (associations || []).map(association => {
    const selected = _associationSelectedNames('document', row, association, facility);
    if (!selected.size) return '';
    const displayNames = new Map(_associationTargetRows(association.targetType, facility)
      .map(targetRow => {
        const name = _associationTargetName(association.targetType, targetRow);
        return [name.toLowerCase(), name];
      }));
    const names = [...selected].map(name => displayNames.get(name) || name);
    return `<div class="project-applicable-group project-association-${esc(association.targetType)}">
      <div class="project-applicable-heading">${esc(association.label || association.key)}</div>
      <div class="project-applicable-values">${names.map(name => `<span>${esc(name)}</span>`).join('')}</div>
    </div>`;
  }).filter(Boolean).join('');
  return groups || '<div class="project-empty">No applicable records selected.</div>';
}

function _associationRefreshDocumentSummary(entityType, row) {
  if (entityType !== 'document' || !row) return;
  const card = MODEL_MODAL_CONFIG?.document?.cards?.applicableTo;
  const host = document.querySelector('#type-modal [data-document-applicable-summary]');
  if (!card || !host) return;
  host.innerHTML = _documentApplicableToMarkup(row, card.associations, row._facility || _projectActiveFacilityName() || '');
}

function _setDocumentAssociation(documentRow, targetType, targetName, targetFacility, selected) {
  const sheetName = _INFO_ENTITY_SHEET[targetType] || '';
  if (!documentRow || !sheetName || !targetName) return;
  const links = _documentAssociationRows(documentRow);
  const associationGroup = String(documentRow._associationGroup || `document-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  links.forEach(row => { row._associationGroup = associationGroup; });
  documentRow._associationGroup = associationGroup;
  const match = links.find(row =>
    _cobieField(row, 'sheetName').toLowerCase() === sheetName.toLowerCase() &&
    _cobieField(row, 'rowName').toLowerCase() === targetName.toLowerCase()
  );
  if (selected && !match) {
    const blank = links.find(row => !_cobieField(row, 'sheetName') && !_cobieField(row, 'rowName'));
    const target = blank || { ...documentRow };
    _projectSetFieldValue(target, _ALIASES_SHEET_NAME, sheetName);
    _projectSetFieldValue(target, _ALIASES_ROW_NAME, targetName);
    target._facility = targetFacility || documentRow._facility || '';
    target._associationGroup = associationGroup;
    if (!blank) db.documents.push(target);
  } else if (!selected && match) {
    if (links.length === 1) {
      _projectSetFieldValue(match, _ALIASES_SHEET_NAME, '');
      _projectSetFieldValue(match, _ALIASES_ROW_NAME, '');
    } else {
      const index = db.documents.indexOf(match);
      if (index !== -1) db.documents.splice(index, 1);
      if (_projectModalContext?.row === match) _projectModalContext.row = links.find(row => row !== match) || documentRow;
    }
  }
}

function _setEntityAssociation(entityType, row, association, targetName, targetFacility, selected) {
  if (!row || !association || !targetName) return;
  const key = String(association.key || '');
  const facility = String(row._facility || _projectActiveFacilityName() || '');
  const isDraft = _newEntityDraft?.row === row && !_newEntityDraft.saving;
  const directDraftField = (entityType === 'component' && (key === 'type' || key === 'space'))
    || (entityType === 'space' && key === 'floor');
  if (isDraft && !directDraftField) {
    const staged = _newEntityDraft.associations || (_newEntityDraft.associations = Object.create(null));
    const values = staged[key] || _associationSelectedNames(entityType, row, association, facility);
    if (association.cardinality === 'one') values.clear();
    if (selected) values.add(targetName.toLowerCase()); else values.delete(targetName.toLowerCase());
    staged[key] = values;
    return;
  }
  if (entityType === 'component' && key === 'type') {
    _projectSetFieldValue(row, _ALIASES_TYPE_NAME, selected ? targetName : '');
    if (typeof qaRevalidateFieldChange === 'function') {
      qaRevalidateFieldChange(entityType, f(row, 'Name'), facility, _ALIASES_TYPE_NAME);
      _projectRefreshFieldIssueBadges(entityType, f(row, 'Name'), facility);
    }
  } else if (entityType === 'component' && key === 'space') {
    _projectSetFieldValue(row, ['Space'], selected ? targetName : '');
    if (typeof qaRevalidateFieldChange === 'function') {
      qaRevalidateFieldChange(entityType, f(row, 'Name'), facility, ['Space']);
      _projectRefreshFieldIssueBadges(entityType, f(row, 'Name'), facility);
    }
  } else if (entityType === 'component' && key === 'systems') {
    const systems = new Set(idx.compSys?.[_rowKey(row, f(row, 'Name'))] || []);
    if (selected) systems.add(targetName); else systems.delete(targetName);
    _updateCompSystems(f(row, 'Name'), systems, facility);
  } else if (entityType === 'space' && key === 'floor') {
    _projectSetFieldValue(row, _ALIASES_FLOOR_NAME, selected ? targetName : '');
    if (typeof qaRevalidateFieldChange === 'function') {
      qaRevalidateFieldChange(entityType, f(row, 'Name'), facility, _ALIASES_FLOOR_NAME);
      _projectRefreshFieldIssueBadges(entityType, f(row, 'Name'), facility);
    }
  } else if ((entityType === 'type' || entityType === 'space') && key === 'components') {
    const component = _findEntity(db.components, targetName, targetFacility || facility);
    if (component) {
      const aliases = entityType === 'type' ? _ALIASES_TYPE_NAME : ['Space'];
      _projectSetFieldValue(component, aliases, selected ? f(row, 'Name') : '');
      if (typeof qaRevalidateFieldChange === 'function') {
        qaRevalidateFieldChange('component', f(component, 'Name'), component._facility || facility, aliases);
      }
    }
  } else if (entityType === 'floor' && key === 'spaces') {
    const space = _findEntity(db.spaces, targetName, targetFacility || facility);
    if (space) {
      _projectSetFieldValue(space, _ALIASES_FLOOR_NAME, selected ? f(row, 'Name') : '');
      if (typeof qaRevalidateFieldChange === 'function') {
        qaRevalidateFieldChange('space', f(space, 'Name'), space._facility || facility, _ALIASES_FLOOR_NAME);
      }
    }
  } else if (entityType === 'system' && key === 'components') {
    const current = _associationSelectedNames(entityType, row, association, facility);
    if (selected) current.add(targetName.toLowerCase()); else current.delete(targetName.toLowerCase());
    const names = db.components
      .filter(component => (!facility || component._facility === facility) && current.has(f(component, 'Name').toLowerCase()))
      .map(component => f(component, 'Name'));
    _updateSysComponents(f(row, 'Name'), names, facility);
  } else if (entityType === 'document') {
    _setDocumentAssociation(row, association.targetType, targetName, targetFacility, selected);
  }
}

function _associationRefreshControl(control) {
  if (!control) return;
  const checked = [...control.querySelectorAll('.project-association-option input:checked')];
  control.querySelectorAll('.project-association-option').forEach(option => {
    option.classList.toggle('project-association-selected', Boolean(option.querySelector('input:checked')));
  });
  const count = control.querySelector('.project-association-count');
  if (count) count.textContent = checked.length ? `${checked.length} selected` : 'None selected';
}

function _associationRefreshModelFields(entityType, row) {
  const context = _projectActiveEntityContext();
  if (!row || context?.row !== row || String(context.entityType || '') !== String(entityType || '')) return;
  document.querySelectorAll('#type-modal .project-field-row[data-aliases]').forEach(fieldRow => {
    const aliases = String(fieldRow.dataset.aliases || '').split('|').map(alias => alias.trim()).filter(Boolean);
    if (!aliases.length) return;
    const value = f(row, ...aliases);
    const original = String(fieldRow.dataset.originalValue || '');
    const valueCell = fieldRow.querySelector('[data-role="field-value"]');
    if (!valueCell || valueCell.querySelector('.project-inline-editor')) return;
    const dirty = !_projectIsNewEntityRow(row) && value !== original;
    valueCell.dataset.rawValue = value;
    valueCell.innerHTML = _projectValueMarkup(value, dirty);
    fieldRow.classList.toggle('project-dirty', dirty);
    if (dirty) fieldRow.dataset.dirtyKind = 'field';
    else delete fieldRow.dataset.dirtyKind;
  });
}

function _associationRefreshControlsFromModel(entityType, row) {
  const type = String(entityType || '');
  const associations = MODEL_MODAL_CONFIG?.[type]?.cards?.associations?.associations || [];
  if (!row || !associations.length) return;
  const facility = String(row._facility || _projectActiveFacilityName() || '');
  document.querySelectorAll('#type-modal .project-association[data-association-key]').forEach(control => {
    const association = associations.find(item => item.key === control.dataset.associationKey);
    const state = _associationOptionsCache.get(control.dataset.optionsCache || '');
    if (!association || !state) return;
    const selected = _associationSelectedNames(type, row, association, facility);
    state.options.forEach(option => { option.selected = selected.has(option.name.toLowerCase()); });
    _associationRenderOptions(control, control.querySelector('.project-association-search')?.value || '');
    _associationRefreshControl(control);
  });
  _associationRefreshDocumentSummary(type, row);
}

function _commitAssociationControl(control, changedInputs) {
  const context = _projectActiveEntityContext();
  const entityType = String(context?.entityType || '');
  const row = context?.row;
  const association = MODEL_MODAL_CONFIG?.[entityType]?.cards?.associations?.associations
    ?.find(item => item.key === control?.dataset.associationKey);
  if (!row || !association) return;
  const cached = _associationOptionsCache.get(control.dataset.optionsCache || '');
  if (association.cardinality === 'one' && changedInputs.some(input => input.checked)) {
    cached?.options.forEach(option => { option.selected = false; });
  }
  changedInputs.forEach(input => {
    _setEntityAssociation(entityType, row, association, input.value, input.dataset.targetFacility || '', input.checked);
    const option = cached?.options.find(item => item.name.toLowerCase() === input.value.toLowerCase());
    if (option) option.selected = input.checked;
  });
  const activeRow = entityType === 'document' ? (_projectActiveEntityContext()?.row || row) : row;
  buildIdx();
  _projectSyncEntityChangeState(
    entityType,
    activeRow,
    f(activeRow, 'Name') || context.entityName || '',
    activeRow._facility || context.facility || '',
  );
  _associationRefreshModelFields(entityType, activeRow);
  _projectAssociationsChanged = true;
  if (typeof _renderSummary === 'function') _renderSummary();
  _associationRefreshControl(control);
  _associationRefreshDocumentSummary(entityType, activeRow);
}

function _findInfoEntityRow(entityType, entityName, facility = '') {
  const bucket = _INFO_ENTITY_DB[entityType];
  const rows = bucket ? db[bucket] : null;
  if (!Array.isArray(rows)) return null;
  if (entityType === 'contact') {
    const key = String(entityName || '').trim().toLowerCase();
    return rows.find(row => f(row, 'Email').toLowerCase() === key && (!facility || row._facility === facility)) || null;
  }
  return _findEntity(rows, entityName, facility);
}

function _infoEntityActionBar(type, row, rowName, rowFacility) {
  if (type === 'document') {
    const dir = f(row, 'Directory');
    const lpath = _docTarget(dir);
    const href = _docHref(lpath);
    return `<div class="d-flex flex-wrap gap-2 mb-2 align-items-center">
      <span class="small text-muted">Double-click any value to edit inline.</span>
      ${lpath ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary py-1" style="font-size:.77rem"><i class="bi bi-box-arrow-up-right me-1"></i>Open link</a>` : ''}
      ${lpath ? `<button class="btn btn-sm btn-outline-secondary py-1 cp-btn" data-p="${esc(lpath)}" style="font-size:.77rem"><i class="bi bi-clipboard me-1"></i>Copy path</button>` : ''}
    </div>`;
  }
  return '<div class="small text-muted mb-2">Double-click any value to edit inline. Use Undo to revert a change.</div>';
}

function _projectAttributeVisible(entityType, attributeName) {
  if (String(entityType || '').toLowerCase() !== 'floor') return true;
  const name = String(attributeName || '').trim();
  return !/^svg(?:[^\d]*(\d+))?$/i.test(name)
    && !/^svg-alignment(?:[^\d]*(\d+))?$/i.test(name);
}

function buildEntityInfoBody(entityType, entityName, facility = '', entityRow = null) {
  const type = String(entityType || '').toLowerCase();
  const config = MODEL_MODAL_CONFIG?.[type];
  if (!config || !config.cards) {
    return '<p class="text-muted small mb-0">No information view is configured for this type.</p>';
  }

  const row = entityRow || _findInfoEntityRow(type, entityName, facility);
  if (!row) {
    return `<p class="text-muted small mb-0">${esc(config.title || 'Record')} not found.</p>`;
  }
  _associationOptionsCache.clear();

  const rowName = _projectEntityIdentity(type, row, entityName);
  const rowFacility = String(row._facility || facility || '');
  const originalRow = _projectOriginalEntityRow(type, rowName, rowFacility) || row;
  const originalAttrValues = _projectOriginalAttributeMapForEntity(type, rowName, rowFacility);
  const fieldIssueMap = _projectEntityFieldIssueMap(type, rowName, rowFacility);
  _projectModalContext = {
    entityType: type,
    entityName: rowName,
    facility: rowFacility,
    row,
  };

  const cards = Object.values(config.cards);
  const infoCards = [];
  let documentCardHtml = '';

  cards.forEach(card => {
    const colorToken = card?.colorToken || config.headerColorToken || type;
    const tintClass = _infoCardTintClass(colorToken);
    let bodyHtml = '';
    let actionsHtml = '';

    if (card?.mode === 'attributes') {
      const attrs = _projectEntityAttributeRows(type, rowName, rowFacility, row?._attrs || null)
        .filter(attr => _projectAttributeVisible(type, attr.name));
      bodyHtml = attrs.length
        ? attrs.map(attr => {
          const original = originalAttrValues.get(String(attr.name || '').toLowerCase()) || { value:'', unit:'' };
          return _projectAttributeRowMarkup(attr.name, attr.value, attr.unit, original.value, original.unit);
        }).join('')
        : '<p class="project-empty mb-0">No additional attributes provided.</p>';
      actionsHtml = _projectAddActionButton('project-doc-add-btn project-add-attribute-btn', 'Add attribute');
    } else if (card?.mode === 'association-summary') {
      bodyHtml = `<div data-document-applicable-summary>${_documentApplicableToMarkup(row, card.associations, rowFacility)}</div>`;
    } else if (card?.mode === 'associations') {
      bodyHtml = _infoAssociationsCard(type, row, card.associations, rowFacility);
    } else if (card?.mode === 'documents') {
      const docCard = _infoDocumentsCard(type, rowName, rowFacility);
      documentCardHtml = _projectCard(card?.title || 'Documents', _infoCardTintClass('document'), docCard?.body || '', docCard?.actions || '');
      return;
    } else {
      const fields = Array.isArray(card?.fields) ? card.fields : [];
      bodyHtml = fields.map(field => {
        const label = String(field?.label || '');
        const aliases = Array.isArray(field?.aliases) ? field.aliases : [];
        const value = aliases.length ? f(row, ...aliases) : '';
        const originalValue = aliases.length ? f(originalRow, ...aliases) : value;
        const lookup = field?.edit === 'lookup'
          ? (field.lookupSource === 'category' ? 'category' : (field.lookupSource || ''))
          : '';
        const keys = [...new Set([label, ...aliases].map(_projectIssueKey).filter(Boolean))];
        const related = [];
        keys.forEach(key => {
          (fieldIssueMap.get(key) || []).forEach(item => related.push(item));
        });
        if (!related.length && _projectIssueKey(label) === 'name') {
          (fieldIssueMap.get('__entity') || []).forEach(item => related.push(item));
        }
        return _projectFieldRow({ label, aliases, lookup }, value, originalValue, _projectDedupeIssues(related));
      }).join('');
      if (!bodyHtml) bodyHtml = '<div class="project-empty">No configured fields.</div>';
    }

    infoCards.push(_projectCard(card?.title || 'Details', tintClass, bodyHtml, actionsHtml));
  });

  const cardsHtml = infoCards.filter(Boolean).join('');

  return `${_infoEntityActionBar(type, row, rowName, rowFacility)}
    <div class="project-modal-layout">
      <div class="project-modal-cards">${cardsHtml}</div>
      ${documentCardHtml}
    </div>`;
}

const _PROJECT_FIELD_GROUPS = (() => {
  const facilityCards = MODEL_MODAL_CONFIG?.facility?.cards || {};
  const normalize = (fields = []) => fields.map(field => ({
    label: field.label,
    aliases: field.aliases || [],
    lookup: field.edit === 'lookup'
      ? (field.lookupSource === 'category' ? 'category' : (field.lookupSource || ''))
      : (field.lookup || ''),
  }));
  return Object.fromEntries(Object.entries(facilityCards)
    .filter(([, card]) => !card?.mode && Array.isArray(card?.fields))
    .map(([key, card]) => [key, normalize(card.fields)]));
})();

let _projectModalFacility = '';
let _projectModalContext = null;
let _newEntityDraft = null;
const _projectCreatedEntityRows = new WeakSet();
const _projectDocCollapsedCategories = new Set();
let _projectIndexRefreshFrame = 0;

function _projectIsNewEntityRow(row) {
  return !!row && (_newEntityDraft?.row === row || _projectCreatedEntityRows.has(row));
}

function _projectScheduleIndexRefresh() {
  if (_projectIndexRefreshFrame) return;
  if (typeof requestAnimationFrame !== 'function') {
    buildIdx();
    return;
  }
  _projectIndexRefreshFrame = requestAnimationFrame(() => {
    _projectIndexRefreshFrame = 0;
    buildIdx();
  });
}

function _projectCancelIndexRefresh() {
  if (!_projectIndexRefreshFrame) return;
  cancelAnimationFrame(_projectIndexRefreshFrame);
  _projectIndexRefreshFrame = 0;
}

function _restoreNewEntityInfoContext(returnContext, savedType = '', savedRow = null) {
  _newEntityDraft = null;
  if (returnContext) {
    restoreTypeModalView(returnContext);
  } else if (savedType === 'document' && savedRow) {
    openDoc(savedRow);
  } else if (savedType && savedRow) {
    openGroupInfo(savedType, _projectEntityIdentity(savedType, savedRow), savedRow._facility || '');
  } else {
    bootstrap.Modal.getInstance(document.getElementById('type-modal'))?.hide();
  }
}

function openNewEntityInfoModal(entityType, prefillName = '', facility = '', returnInfoContext = null, documentContext = null, associationReturn = null, fieldReturn = null) {
  const type = String(entityType || 'space').toLowerCase();
  const config = MODEL_MODAL_CONFIG?.[type];
  const bucket = _INFO_ENTITY_DB[type];
  if (!config || !bucket || !Array.isArray(db[bucket])) return;

  const draft = {
    Name:type === 'contact' ? '' : String(prefillName || '').trim(),
    CreatedBy:'', CreatedOn:'', ExtSystem:'', ExtObject:'', ExtIdentifier:'', Reference:'',
    _facility:String(facility || db.facilities[0]?._facility || '').trim(),
  };
  Object.values(config.cards || {}).forEach(card => {
    (card?.fields || []).forEach(field => {
      const alias = field?.aliases?.[0];
      if (alias && draft[alias] === undefined) draft[alias] = '';
    });
  });
  if (type === 'document') {
    draft.File = '';
    draft.SheetName = String(documentContext?.sheetName || 'Facility').trim();
    draft.RowName = String(documentContext?.rowName || '').trim();
  }
  if (type === 'contact' && String(prefillName || '').includes('@')) draft.Email = String(prefillName).trim();
  _newEntityDraft = { type, row:draft, returnContext:returnInfoContext, associationReturn, fieldReturn, associations:Object.create(null), saving:false };
  _setTypeModalCloseReturns(Boolean(returnInfoContext));

  const typeModal = document.getElementById('type-modal');
  typeModal.classList.add('project-modal');
  _setProjectModalColor(typeModal, config.headerColorToken || type);
  document.getElementById('mtype-icon').className = `bi ${_GRP_ICONS[type] || 'bi-plus-circle'} me-2`;
  document.getElementById('mtype-title').textContent = `${config.title}: New ${type}`;
  document.getElementById('mtype-body').innerHTML = buildEntityInfoBody(type, draft.Name, draft._facility, draft);
  const facilityOptions = db.facilities.map(row => {
    const name = String(row._facility || f(row, 'Name') || '');
    return `<option value="${esc(name)}"${name === draft._facility ? ' selected' : ''}>${esc(name)}</option>`;
  }).join('');
  document.getElementById('mtype-body').insertAdjacentHTML('afterbegin', `<div class="d-flex flex-wrap justify-content-end align-items-center gap-2 mb-3 project-new-entity-actions">
    ${db.facilities.length > 1 ? `<label class="d-flex align-items-center gap-2 small mb-0">Facility <select class="form-select form-select-sm project-new-entity-facility">${facilityOptions}</select></label>` : ''}
    <button type="button" class="btn btn-sm btn-secondary project-new-entity-cancel">Cancel</button>
    <button type="button" class="btn btn-sm btn-primary project-new-entity-save" style="background:var(--navy);border-color:var(--navy)"><i class="bi bi-check2 me-1"></i>Save ${esc(type === 'document' ? 'Document' : config.title.replace(/ Information$/, ''))}</button>
  </div>`);
  bootstrap.Modal.getOrCreateInstance(typeModal).show();
}

function openNewDocumentInfoModal(sheetName, rowName, facility = '', returnInfoContext = null) {
  openNewEntityInfoModal('document', '', facility, returnInfoContext, { sheetName, rowName });
}

function _saveNewEntityInfo() {
  const state = _newEntityDraft;
  if (!state?.row || !state.type) return;

  const editor = document.querySelector('#type-modal .project-inline-editor');
  if (editor) {
    const row = editor.closest('.project-field-row');
    const role = row?.querySelector('.d-none[data-role]')?.dataset.role || 'field-value';
    if (role === 'field-value') _projectFinishFieldEdit(editor, true);
    else _projectFinishAttributeEdit(editor, role, true);
  }

  const identityField = state.type === 'contact' ? 'Email' : 'Name';
  const entityName = f(state.row, identityField).trim();
  if (!entityName) {
    alert(`${identityField} is required.`);
    return;
  }
  const rows = db[_INFO_ENTITY_DB[state.type]];
  const duplicate = rows.some(row => {
    if (f(row, identityField).toLowerCase() !== entityName.toLowerCase()) return false;
    if (String(row._facility || '').toLowerCase() !== String(state.row._facility || '').toLowerCase()) return false;
    if (state.type !== 'document') return true;
    return _cobieField(row, 'sheetName').toLowerCase() === _cobieField(state.row, 'sheetName').toLowerCase() &&
      _cobieField(row, 'rowName').toLowerCase() === _cobieField(state.row, 'rowName').toLowerCase();
  });
  if (duplicate) {
    alert(`"${entityName}" already exists in this facility.`);
    return;
  }

  rows.push(state.row);
  _projectCreatedEntityRows.add(state.row);
  state.saving = true;
  Object.entries(state.associations || {}).forEach(([key, values]) => {
    const association = MODEL_MODAL_CONFIG?.[state.type]?.cards?.associations?.associations?.find(item => item.key === key);
    if (!association) return;
    values.forEach(targetKey => {
      const targetRow = _associationTargetRows(association.targetType, state.row._facility)
        .find(row => _associationTargetName(association.targetType, row).toLowerCase() === targetKey);
      if (targetRow) _setEntityAssociation(state.type, state.row, association,
        _associationTargetName(association.targetType, targetRow), targetRow._facility || '', true);
    });
  });
  const associationReturn = state.associationReturn;
  if (associationReturn?.row && associationReturn.association) {
    _setEntityAssociation(
      associationReturn.entityType,
      associationReturn.row,
      associationReturn.association,
      entityName,
      state.row._facility || '',
      true,
    );
    _logChange(associationReturn.entityType, f(associationReturn.row, 'Name'), associationReturn.row._facility || '');
  }
  const fieldReturn = state.fieldReturn;
  if (fieldReturn?.row && Array.isArray(fieldReturn.aliases)) {
    const contactValue = f(state.row, 'Email').trim() || entityName;
    _projectSetFieldValue(fieldReturn.row, fieldReturn.aliases, contactValue);
    _projectSyncEntityChangeState(
      fieldReturn.entityType,
      fieldReturn.row,
      f(fieldReturn.row, 'Name'),
      fieldReturn.row._facility || '',
    );
  }
  _logChange(state.type, entityName, state.row._facility || '');
  if (typeof qaRevalidateAfterEntityCreate === 'function') qaRevalidateAfterEntityCreate();
  if (['type', 'space', 'system'].includes(state.type)) {
    _justCreated.add(`${state.type}::${entityName.toLowerCase()}`);
  }
  _projectCancelIndexRefresh();
  refreshDisplay();
  _restoreNewEntityInfoContext(state.returnContext, state.type, state.row);
}

function _projectFieldValue(row, aliases) {
  return f(row, ...aliases);
}

function _projectSetFieldValue(row, aliases, value) {
  const existing = aliases.find(alias => Object.prototype.hasOwnProperty.call(row, alias));
  row[existing || aliases[0]] = value;
}

function _projectUnitInfo(fac) {
  return {
    linear: _projectFieldValue(fac, ['LinearUnits', 'Linear Units']),
    area: _projectFieldValue(fac, ['AreaUnits', 'Area Units']) || _projectFieldValue(fac, ['AreaMeasurement', 'Area Measurement']),
    volume: _projectFieldValue(fac, ['VolumeUnits', 'Volume Units']),
    currency: _projectFieldValue(fac, ['CurrencyUnit', 'Currency Unit']),
  };
}

function _projectAttributeDisplayValue(value, unit = '') {
  const raw = String(value || '').trim();
  const suffix = String(unit || '').trim();
  if (raw && suffix) return `${raw} ${suffix}`;
  return raw || suffix;
}

function _projectAttributeUnit(row) {
  return f(row, 'Unit', 'UnitName', 'Unit Name');
}

function _projectSetAttributeUnit(row, value) {
  const aliases = ['Unit', 'UnitName', 'Unit Name'];
  const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(row, alias));
  row[key || aliases[0]] = value;
}

function _projectAttributeUnitSuffix(attrName, fac) {
  const units = _projectUnitInfo(fac);
  const name = String(attrName || '').toLowerCase();
  if (!name) return '';
  if (/(cost|price|currency|amount)/i.test(name) && units.currency) return ` ${units.currency}`;
  if (/(volume|cubic|m3|ft3|litre|liter)/i.test(name) && units.volume) return ` ${units.volume}`;
  if (/(area|sqm|sqft|m2|ft2)/i.test(name) && units.area) return ` ${units.area}`;
  if (/(length|height|width|depth|distance|perimeter|diameter|radius)/i.test(name) && units.linear) return ` ${units.linear}`;
  return '';
}

function _projectAttrRows(fac) {
  const facilityName = String(fac?._facility || f(fac, 'Name') || '').trim();
  return _projectEntityAttributeRows('facility', facilityName, facilityName, fac?._attrs || null);
}

function _projectEntityAttributeRows(entityType, entityName, facilityName, fallbackAttrs = null) {
  const type = String(entityType || '').toLowerCase();
  const rowName = String(entityName || '').toLowerCase();
  const fac = String(facilityName || '').toLowerCase();
  const entries = new Map();

  (db.attributes || []).forEach(row => {
    if (String(row._facility || '').toLowerCase() !== fac) return;
    if (_cobieField(row, 'sheetName').toLowerCase() !== type) return;
    if (_cobieField(row, 'rowName').toLowerCase() !== rowName) return;
    const name = String(f(row, 'Name') || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (entries.has(key)) return;
    entries.set(key, {
      name,
      value:String(f(row, 'Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value') || ''),
      unit:String(_projectAttributeUnit(row) || ''),
    });
  });

  if (!entries.size && fallbackAttrs && typeof fallbackAttrs === 'object') {
    Object.entries(fallbackAttrs).forEach(([name, value]) => {
      const label = String(name || '').trim();
      if (!label) return;
      entries.set(label.toLowerCase(), {
        name:label,
        value:String(value || ''),
        unit:'',
      });
    });
  }

  return [...entries.values()]
    .filter(attr => attr.name && (attr.value || attr.unit))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function _projectLookupOptionsFromFacilities(aliases) {
  const values = new Map();
  db.facilities.forEach(row => {
    const value = _projectFieldValue(row, aliases).trim();
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  });
  return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric:true }));
}

function _projectLookupOptions(type) {
  if (type === 'contact') {
    const options = new Map();
    db.contacts.forEach(contact => {
      const email = f(contact, 'Email').trim();
      const name = f(contact, 'Name').trim();
      const value = email || name;
      if (!value || options.has(value.toLowerCase())) return;
      const person = [f(contact, 'GivenName', 'Given Name'), f(contact, 'FamilyName', 'Family Name')]
        .filter(Boolean).join(' ').trim();
      const company = f(contact, 'Company').trim();
      const context = [person && person !== value ? person : '', company].filter(Boolean).join(' · ');
      const label = context ? `${value} — ${context}` : value;
      options.set(value.toLowerCase(), {
        value,
        label,
        depth:0,
        search:[value, name, email, person, company].join(' ').toLowerCase(),
      });
    });
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  if (type === 'category') {
    const activeType = _projectActiveEntityType();
    const dim = activeType === 'document' ? 'doccat' : (activeType || 'facility');
    const values = picklistCategoryValues(dim);
    const fallback = values.length ? values : picklistCategoryValues('facility');
    return fallback.map(value => {
      const code = classificationParts(value).code;
      const depth = Math.max(0, code.split('_').filter(Boolean).length - 1);
      return { value, label:value, depth, search:(value + ' ' + code).toLowerCase() };
    });
  }

  const predefined = {
    'linear-unit':['mm', 'cm', 'm', 'km', 'in', 'ft'],
    'area-unit':['m2', 'ft2', 'ha'],
    'volume-unit':['m3', 'ft3', 'L'],
    'currency-unit':['GBP', 'USD', 'EUR'],
    'area-measurement':['Gross', 'Net', 'Usable'],
  };
  const fieldAliases = {
    'linear-unit':['LinearUnits', 'Linear Units'],
    'area-unit':['AreaUnits', 'Area Units'],
    'volume-unit':['VolumeUnits', 'Volume Units'],
    'currency-unit':['CurrencyUnit', 'Currency Unit'],
    'area-measurement':['AreaMeasurement', 'Area Measurement'],
  };
  const merged = new Map();
  (predefined[type] || []).forEach(value => merged.set(value.toLowerCase(), value));
  (fieldAliases[type] ? _projectLookupOptionsFromFacilities(fieldAliases[type]) : []).forEach(value => {
    if (!merged.has(value.toLowerCase())) merged.set(value.toLowerCase(), value);
  });
  return [...merged.values()].map(value => ({ value, label:value, depth:0, search:value.toLowerCase() }));
}

function _projectNormalizeLookupValue(type, value, previousValue = '') {
  const raw = String(value || '').trim();
  if (type !== 'contact' || !raw) return raw;
  const match = _projectLookupOptions('contact').find(option =>
    option.value.toLowerCase() === raw.toLowerCase() || option.label.toLowerCase() === raw.toLowerCase()
  );
  return match?.value || String(previousValue || '').trim();
}

function _projectBaselineFacilityName(currentFacilityName) {
  const current = String(currentFacilityName || '').trim();
  if (!current) return '';
  const direct = _originalDbState?.facilities?.some(row => (row._facility || '') === current);
  if (direct) return current;
  const match = [...(_changeLog || [])].reverse().find(entry =>
    entry?.entityType === 'facility' &&
    Array.isArray(entry.facNames) &&
    entry.facNames.includes(current) &&
    entry.originalName
  );
  return String(match?.originalName || current).trim();
}

function _projectOriginalFacilityRow(currentFacilityName) {
  const baselineName = _projectBaselineFacilityName(currentFacilityName);
  return _originalDbState?.facilities?.find(row => (row._facility || '') === baselineName) || null;
}

function _projectOriginalAttributeMap(currentFacilityName) {
  const baselineName = _projectBaselineFacilityName(currentFacilityName);
  const map = new Map();
  (_originalDbState?.attributes || []).forEach(row => {
    if ((row._facility || '') !== baselineName) return;
    if (_cobieField(row, 'sheetName').toLowerCase() !== 'facility') return;
    if (_cobieField(row, 'rowName').toLowerCase() !== baselineName.toLowerCase()) return;
    const key = f(row, 'Name').toLowerCase();
    if (!key) return;
    map.set(key, {
      value:String(f(row, 'Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value') || ''),
      unit:String(_projectAttributeUnit(row) || ''),
    });
  });
  return map;
}

function _projectBaselineEntityName(entityType, currentName, facility = '') {
  const type = String(entityType || '').toLowerCase();
  const current = String(currentName || '').trim();
  const fac = String(facility || '').trim();
  if (!type || !current) return current;

  const sourceKey = _INFO_ENTITY_DB[type];
  const baselineRows = _originalDbState?.[sourceKey] || [];
  const existsDirect = baselineRows.some(row => {
    const rowName = f(row, 'Name');
    return rowName.toLowerCase() === current.toLowerCase() && (!fac || (row._facility || '') === fac);
  });
  if (existsDirect) return current;

  const fromLog = [...(_changeLog || [])].reverse().find(entry =>
    String(entry?.entityType || '').toLowerCase() === type &&
    String(entry?.entityName || '').toLowerCase() === current.toLowerCase() &&
    (!fac || (Array.isArray(entry?.facNames) && entry.facNames.includes(fac))) &&
    entry?.originalName
  );
  return String(fromLog?.originalName || current).trim();
}

function _projectOriginalEntityRow(entityType, currentName, facility = '') {
  const type = String(entityType || '').toLowerCase();
  const sourceKey = _INFO_ENTITY_DB[type];
  const baselineRows = _originalDbState?.[sourceKey] || [];
  const baselineName = _projectBaselineEntityName(type, currentName, facility);
  return baselineRows.find(row =>
    f(row, 'Name').toLowerCase() === baselineName.toLowerCase() &&
    (!facility || (row._facility || '') === facility)
  ) || null;
}

function _projectOriginalAttributeMapForEntity(entityType, currentName, facility = '') {
  const type = String(entityType || '').toLowerCase();
  const baselineName = _projectBaselineEntityName(type, currentName, facility);
  const fac = String(facility || '').trim();
  const map = new Map();
  (_originalDbState?.attributes || []).forEach(row => {
    if ((row._facility || '') !== fac) return;
    if (_cobieField(row, 'sheetName').toLowerCase() !== type) return;
    if (_cobieField(row, 'rowName').toLowerCase() !== baselineName.toLowerCase()) return;
    const key = f(row, 'Name').toLowerCase();
    if (!key) return;
    map.set(key, {
      value:String(f(row, 'Value', 'AttributeValue', 'Attribute Value', 'NominalValue', 'Nominal Value') || ''),
      unit:String(_projectAttributeUnit(row) || ''),
    });
  });
  return map;
}

function _projectAssociationNamesFromState(entityType, entityRow, association, facility, state) {
  const type = String(entityType || '').toLowerCase();
  const key = String(association?.key || '');
  const name = f(entityRow, 'Name').toLowerCase();
  const fac = String(facility || entityRow?._facility || '');
  const values = new Set();
  const inFacility = row => !fac || String(row?._facility || '') === fac;

  if (type === 'component' && key === 'type') {
    const value = _cobieField(entityRow, 'typeName');
    if (value) values.add(value.toLowerCase());
  } else if (type === 'component' && key === 'space') {
    const value = f(entityRow, 'Space');
    if (value) values.add(value.toLowerCase());
  } else if (type === 'component' && key === 'systems') {
    (state.systems || []).forEach(system => {
      if (!inFacility(system)) return;
      const components = f(system, 'ComponentNames', 'Component Names').split(',').map(value => value.trim().toLowerCase());
      if (components.includes(name)) values.add(f(system, 'Name').toLowerCase());
    });
  } else if ((type === 'type' || type === 'space') && key === 'components') {
    (state.components || []).forEach(component => {
      if (!inFacility(component)) return;
      const owner = type === 'type' ? _cobieField(component, 'typeName') : f(component, 'Space');
      if (owner.toLowerCase() === name) values.add(f(component, 'Name').toLowerCase());
    });
  } else if (type === 'system' && key === 'components') {
    (state.systems || []).forEach(system => {
      if (!inFacility(system) || f(system, 'Name').toLowerCase() !== name) return;
      f(system, 'ComponentNames', 'Component Names').split(',')
        .map(value => value.trim().toLowerCase()).filter(Boolean).forEach(value => values.add(value));
    });
  } else if (type === 'document') {
    const sheetName = String(_INFO_ENTITY_SHEET[association.targetType] || '').toLowerCase();
    const documentName = f(entityRow, 'Name').toLowerCase();
    const directory = f(entityRow, 'Directory').toLowerCase();
    const file = f(entityRow, 'File').toLowerCase();
    (state.documents || []).forEach(documentLink => {
      if (f(documentLink, 'Name').toLowerCase() !== documentName ||
          f(documentLink, 'Directory').toLowerCase() !== directory ||
          f(documentLink, 'File').toLowerCase() !== file ||
          _cobieField(documentLink, 'sheetName').toLowerCase() !== sheetName) return;
      const target = _cobieField(documentLink, 'rowName');
      if (target) values.add(target.toLowerCase());
    });
  }
  return values;
}

function _projectSetsEqual(left, right) {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function _projectAssociationsDifferFromBaseline(entityType, entityRow, facility, cards) {
  if (!_originalDbState) return false;
  const originalRow = _projectOriginalEntityRow(entityType, f(entityRow, 'Name'), facility) || entityRow;
  for (const card of Object.values(cards)) {
    if (card?.mode !== 'associations') continue;
    for (const association of card.associations || []) {
      const current = _projectAssociationNamesFromState(entityType, entityRow, association, facility, db);
      const original = _projectAssociationNamesFromState(entityType, originalRow, association, facility, _originalDbState);
      if (!_projectSetsEqual(current, original)) return true;
    }
  }
  return false;
}

function _projectEntityDiffersFromBaseline(entityType, entityRow, entityName, facility) {
  const type = String(entityType || '').toLowerCase();
  if (!entityRow || !type) return false;

  const originalRow = _projectOriginalEntityRow(type, entityName, facility) || entityRow;
  const cards = MODEL_MODAL_CONFIG?.[type]?.cards || {};

  for (const card of Object.values(cards)) {
    if (!card || card.mode) continue;
    const fields = Array.isArray(card.fields) ? card.fields : [];
    for (const field of fields) {
      const aliases = Array.isArray(field?.aliases) ? field.aliases : [];
      if (!aliases.length) continue;
      if (f(entityRow, ...aliases) !== f(originalRow, ...aliases)) return true;
    }
  }

  const currentAttrs = _projectEntityAttributeRows(type, entityName, facility, entityRow._attrs || null)
    .map(attr => [
      String(attr.name || '').toLowerCase(),
      { value:String(attr.value || ''), unit:String(attr.unit || '') },
    ]);
  const baselineAttrs = _projectOriginalAttributeMapForEntity(type, entityName, facility);
  if (currentAttrs.length !== baselineAttrs.size) return true;
  for (const [name, attr] of currentAttrs) {
    const baseline = baselineAttrs.get(name) || { value:'', unit:'' };
    if (baseline.value !== attr.value || baseline.unit !== attr.unit) return true;
  }
  if (_projectAssociationsDifferFromBaseline(type, entityRow, facility, cards)) return true;
  return false;
}

function _projectSyncEntityChangeState(entityType, entityRow, entityName, facility) {
  const type = String(entityType || '').toLowerCase();
  const name = String(entityName || '').trim();
  const fac = String(facility || '').trim();
  if (!type || !name || !entityRow) return;

  const baselineName = type === 'facility'
    ? _projectBaselineFacilityName(name)
    : _projectBaselineEntityName(type, name, fac);
  const changed = _projectEntityDiffersFromBaseline(type, entityRow, name, fac);

  if (changed) {
    _logChange(type, name, fac, baselineName || name);
    return;
  }
  if (typeof _clearChangeEntries === 'function') {
    _clearChangeEntries(type, name, fac, baselineName || name);
  }
}

function _projectValueMarkup(value, dirty) {
  const text = String(value || '');
  return `<span class="project-value-text">${text ? esc(text) : '<span class="project-empty">Not provided</span>'}</span>${dirty ? '<button type="button" class="project-undo-btn" title="Undo change"><i class="bi bi-arrow-counterclockwise"></i>Undo</button>' : ''}`;
}

function _projectIssueKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _projectDedupeIssues(issues = []) {
  const seen = new Set();
  const out = [];
  issues.forEach(issue => {
    const sev = String(issue?.sev || 'warning').toLowerCase();
    const detail = String(issue?.detail || '');
    const key = `${sev}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sev, detail });
  });
  return out;
}

function _projectIssueFieldsFromDetail(detail) {
  const text = String(detail || '').trim();
  if (!text) return [];

  let m = text.match(/Required column\s+(.+?)\s+is blank\./i);
  if (m) return [m[1].trim()];

  m = text.match(/^Column\s+(.+?)\s+value\s+"/i);
  if (m) return [m[1].trim()];

  m = text.match(/^Reference column\s+(.+?)\s+is blank\s+/i);
  if (m) return [m[1].trim()];

  m = text.match(/^(.+?)\s+value\s+".*"\s+does not resolve\s+/i);
  if (m) return [m[1].trim()];

  m = text.match(/same key\s+\[([^\]]+)\]/i);
  if (m) return m[1].split(',').map(v => v.trim()).filter(Boolean);

  return [];
}

function _projectEnsureQaFindings() {
  return qaHasRun && Array.isArray(qaFindings) ? qaFindings : [];
}

function _projectEntityFieldIssueMap(entityType, entityName, facility) {
  const issues = _projectEnsureQaFindings();
  const map = new Map();
  const type = String(entityType || '').toLowerCase();
  const name = String(entityName || '').toLowerCase();
  const fac = String(facility || '').toLowerCase();

  issues.forEach(issue => {
    const issueType = String(issue?.entityType || '').toLowerCase();
    const issueName = String(issue?.entityName || '').toLowerCase();
    const issueFac = String(issue?.facility || '').toLowerCase();
    if (issueType !== type) return;
    if (issueName !== name) return;
    if (fac && issueFac && issueFac !== fac) return;

    const explicitFields = Array.isArray(issue?.fields)
      ? issue.fields.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    const fields = explicitFields.length ? explicitFields : _projectIssueFieldsFromDetail(issue.detail);
    const targets = fields.length ? [...new Set(fields.map(_projectIssueKey).filter(Boolean))] : ['__entity'];
    targets.forEach(key => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ sev:String(issue.sev || 'warning').toLowerCase(), detail:String(issue.detail || '') });
    });
  });

  return map;
}

function _projectFieldIssueBadge(fieldIssues = []) {
  if (!fieldIssues.length) return '';
  const severity = fieldIssues.some(issue => issue.sev === 'error')
    ? 'error'
    : (fieldIssues.some(issue => issue.sev === 'warning') ? 'warning' : 'info');
  const visual = {
    error: { icon:'bi-exclamation-octagon-fill', color:'text-danger', label:'Error' },
    warning: { icon:'bi-exclamation-triangle-fill', color:'text-warning', label:'Warning' },
    info: { icon:'bi-info-circle-fill', color:'text-info', label:'Advisory' },
  }[severity];
  const lines = fieldIssues.map(issue => `${issue.sev === 'info' ? 'ADVISORY' : issue.sev.toUpperCase()}: ${issue.detail}`);
  const title = lines.join('\n');
  return `<span class="project-field-issue-icon project-field-issue-${severity}" title="${esc(title)}" aria-label="${visual.label}"><i class="bi ${visual.icon} ${visual.color}"></i></span>`;
}

function _projectFieldIssuesForRow(row, fieldIssueMap) {
  if (!row || !fieldIssueMap) return [];
  const label = row.dataset.fieldLabel || '';
  const aliases = String(row.dataset.aliases || '').split('|').filter(Boolean);
  const keys = [...new Set([label, ...aliases].map(_projectIssueKey).filter(Boolean))];
  const related = [];
  keys.forEach(key => {
    (fieldIssueMap.get(key) || []).forEach(item => related.push(item));
  });
  if (!related.length && _projectIssueKey(label) === 'name') {
    (fieldIssueMap.get('__entity') || []).forEach(item => related.push(item));
  }
  return _projectDedupeIssues(related);
}

function _projectApplyFieldIssueBadge(row, fieldIssues = []) {
  const nameHost = row?.querySelector('.project-field-name .project-field-issue-badge');
  if (!nameHost) return;
  nameHost.innerHTML = _projectFieldIssueBadge(fieldIssues);
}

function _projectRefreshFieldIssueBadges(entityType, entityName, facility) {
  const map = _projectEntityFieldIssueMap(entityType, entityName, facility);
  document.querySelectorAll('#type-modal .project-field-row[data-field-label]').forEach(row => {
    _projectApplyFieldIssueBadge(row, _projectFieldIssuesForRow(row, map));
  });
}

function _projectFieldRow(field, value, originalValue = value, fieldIssues = []) {
  const text = String(value || '');
  const original = String(originalValue || '');
  const dirty = text !== original;
  const badge = _projectFieldIssueBadge(fieldIssues);
  return `<div class="project-field-row${dirty ? ' project-dirty' : ''}" data-field-label="${esc(field.label)}" data-aliases="${esc(field.aliases.join('|'))}" data-lookup="${esc(field.lookup || '')}" data-original-value="${esc(original)}"${dirty ? ' data-dirty-kind="field"' : ''}>
    <div class="project-field-name"><span class="project-field-label">${esc(field.label)}</span><span class="project-field-issue-badge">${badge}</span></div>
    <div class="project-field-value project-editable" data-role="field-value" data-raw-value="${esc(text)}" title="Double click to edit">${_projectValueMarkup(text, dirty)}</div>
  </div>`;
}

function _projectAttributeRowMarkup(name, value, unit = '', originalValue = value, originalUnit = unit) {
  const raw = String(value || '');
  const rawUnit = String(unit || '');
  const rawName = String(name || '');
  const original = String(originalValue || '');
  const originalUnitText = String(originalUnit || '');
  const dirty = raw !== original || rawUnit !== originalUnitText;
  return `<div class="project-field-row project-attr-row${dirty ? ' project-dirty' : ''}" data-attr-name="${esc(name)}" data-original-attr-name="${esc(name)}" data-original-attr-value="${esc(original)}" data-original-attr-unit="${esc(originalUnitText)}"${dirty ? ' data-dirty-kind="attribute"' : ''}>
    <div class="project-attr-fields">
      <div class="project-attr-subfield">
        <span class="project-attr-subfield-label">Name</span>
        <div class="project-field-value project-editable" data-role="attr-name" data-raw-value="${esc(rawName)}" title="Double click to edit">${_projectValueMarkup(rawName, false)}</div>
      </div>
      <div class="project-attr-subfield">
        <span class="project-attr-subfield-label">Value</span>
        <div class="project-field-value project-editable" data-role="attr-value" data-raw-value="${esc(raw)}" title="Double click to edit">${_projectValueMarkup(raw, dirty)}</div>
      </div>
      <div class="project-attr-subfield">
        <span class="project-attr-subfield-label">Unit</span>
        <div class="project-field-value project-editable" data-role="attr-unit" data-raw-value="${esc(rawUnit)}" title="Double click to edit">${_projectValueMarkup(rawUnit, false)}</div>
      </div>
    </div>
  </div>`;
}

function _projectCard(title, tintClass, bodyHtml, actionsHtml = '') {
  if (!String(bodyHtml || '').trim()) return '';
  const actions = `${actionsHtml || ''}`;
  return `<section class="project-card ${tintClass}">
    <div class="project-card-header">
      <span>${esc(title)}</span>
      <span class="project-card-actions">${actions}</span>
    </div>
    <div class="project-card-body">${bodyHtml}</div>
  </section>`;
}

function _projectDocCategoryCode(doc) {
  return classificationParts(f(doc, 'Category') || '(Uncategorised)').code || '(Uncategorised)';
}

function _projectDocKey(key) {
  return String(key || '').trim().toLowerCase();
}

function _projectDocTree(docs) {
  const docsByCode = new Map();
  docs.forEach(doc => {
    const code = String(_projectDocCategoryCode(doc) || '(Uncategorised)').toLowerCase();
    if (!docsByCode.has(code)) docsByCode.set(code, []);
    docsByCode.get(code).push(doc);
  });

  const knownNodes = idx.categoryTrees?.doccat || [];
  const knownKeys = new Set(knownNodes.map(node => String(node.key || '').toLowerCase()).filter(Boolean));
  const syntheticNodes = [...docsByCode.keys()]
    .filter(code => !knownKeys.has(code))
    .map(code => ({
      key: code,
      label: code === '(uncategorised)' ? '(Uncategorised)' : classificationParts(code).label || code,
      depth: code.startsWith('(') ? 0 : Math.max(0, code.split('_').length - 2),
    }));

  const nodes = [...knownNodes, ...syntheticNodes]
    .filter(node => {
      const key = String(node.key || '').toLowerCase();
      return [...docsByCode.keys()].some(code => code === key || code.startsWith(key + '_'));
    })
    .sort((a, b) => {
      const uncategorised = Number(String(a.key || '').startsWith('(')) - Number(String(b.key || '').startsWith('('));
      return uncategorised || String(a.key || '').localeCompare(String(b.key || ''), undefined, { numeric:true });
    });

  const html = [];
  nodes.forEach(node => {
    const key = String(node.key || '').toLowerCase();
    const depth = Number(node.depth || 0);
    const directDocs = (docsByCode.get(key) || []).slice().sort((a, b) => f(a, 'Name').localeCompare(f(b, 'Name')));
    const subtreeCount = [...docsByCode.entries()].reduce((sum, [code, items]) =>
      sum + ((code === key || code.startsWith(key + '_')) ? items.length : 0), 0);
    const hasChildren = nodes.some(child => Number(child.depth || 0) > depth && String(child.key || '').toLowerCase().startsWith(key + '_'));
    const collapsible = hasChildren || directDocs.length > 0;
    const collapsed = _projectDocCollapsedCategories.has(_projectDocKey(key));
    const grade = Math.max(28, 78 - depth * 13);

    html.push(`<div class="project-doc-cat-hdr${collapsed ? ' project-doc-cat-collapsed' : ''}${collapsible ? ' project-doc-cat-clickable' : ''}" data-cat="${esc(key)}" data-depth="${depth}" data-collapsible="${collapsible ? '1' : '0'}" data-search="${esc((String(node.label || key) + ' ' + key).toLowerCase())}" style="--cat-depth:${depth};--cat-grade:${grade}%">
      ${collapsible ? `<button class="project-doc-cat-toggle" type="button" title="${collapsed ? 'Expand' : 'Collapse'} ${esc(node.label || key)}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(node.label || key)}" aria-expanded="${collapsed ? 'false' : 'true'}"><i class="bi bi-chevron-down"></i></button>` : '<span class="project-doc-cat-toggle-spacer"></span>'}
      <span class="project-doc-cat-name" title="${esc(node.label || key)}">${esc(node.label || key)}</span>
      <span class="project-doc-cat-cnt">${subtreeCount}</span>
    </div>`);

    directDocs.forEach(doc => {
      const search = [f(doc, 'Name'), f(doc, 'Description'), f(doc, 'Category'), f(doc, 'Directory')].join(' ').toLowerCase();
      html.push(`<div class="project-doc-item" data-cat-path="${esc(key)}" data-search="${esc(search)}" style="--cat-depth:${depth + 1}">${_docListItem(doc, true)}</div>`);
    });
  });

  return html.join('');
}

function _projectDocHiddenByCollapsedAncestor(categoryKey) {
  const key = _projectDocKey(categoryKey);
  return [..._projectDocCollapsedCategories].some(parent => {
    const p = _projectDocKey(parent);
    return key !== p && key.startsWith(p + '_');
  });
}

function _projectApplyDocTreeVisibility(container) {
  if (!container) return;

  container.querySelectorAll('.project-doc-cat-hdr').forEach(header => {
    const key = _projectDocKey(header.dataset.cat);
    const collapsed = _projectDocCollapsedCategories.has(key);
    const hiddenByCollapse = _projectDocHiddenByCollapsedAncestor(key);
    const hiddenBySearch = header.classList.contains('project-search-hidden');
    header.classList.toggle('project-doc-cat-collapsed', collapsed);
    header.classList.toggle('d-none', hiddenByCollapse || hiddenBySearch);
    const button = header.querySelector('.project-doc-cat-toggle');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} ${header.querySelector('.project-doc-cat-name')?.textContent || 'category'}`);
    }
  });

  container.querySelectorAll('.project-doc-item').forEach(item => {
    const path = _projectDocKey(item.dataset.catPath);
    const hiddenByCollapse = [..._projectDocCollapsedCategories].some(parent => {
      const p = _projectDocKey(parent);
      return path === p || path.startsWith(p + '_');
    });
    const hiddenBySearch = item.classList.contains('project-search-hidden');
    item.classList.toggle('d-none', hiddenByCollapse || hiddenBySearch);
  });
}

function _projectDocTreeParentNodes(container) {
  const headers = [...container.querySelectorAll('.project-doc-cat-hdr[data-collapsible="1"]')];
  return headers;
}

function _projectStepDocTreeDepth(container, direction) {
  const headers = _projectDocTreeParentNodes(container);
  if (!headers.length) return;

  if (direction === 'collapse') {
    const visibleExpanded = headers.filter(header => {
      const key = _projectDocKey(header.dataset.cat);
      return !_projectDocCollapsedCategories.has(key) && !_projectDocHiddenByCollapsedAncestor(key);
    });
    if (visibleExpanded.length) {
      const depth = Math.max(...visibleExpanded.map(header => Number(header.dataset.depth || 0)));
      visibleExpanded
        .filter(header => Number(header.dataset.depth || 0) === depth)
        .forEach(header => _projectDocCollapsedCategories.add(_projectDocKey(header.dataset.cat)));
    }
  } else if (direction === 'expand') {
    const collapsed = headers.filter(header => _projectDocCollapsedCategories.has(_projectDocKey(header.dataset.cat)));
    if (collapsed.length) {
      const depth = Math.min(...collapsed.map(header => Number(header.dataset.depth || 0)));
      collapsed
        .filter(header => Number(header.dataset.depth || 0) === depth)
        .forEach(header => _projectDocCollapsedCategories.delete(_projectDocKey(header.dataset.cat)));
    }
  }

  _projectApplyDocTreeVisibility(container);
}

function _projectToggleDocCategory(container, key) {
  if (!container || !key) return;
  const normalized = _projectDocKey(key);
  if (_projectDocCollapsedCategories.has(normalized)) _projectDocCollapsedCategories.delete(normalized);
  else _projectDocCollapsedCategories.add(normalized);
  _projectApplyDocTreeVisibility(container);
}

function _projectAdditionalAttributesCard(fac, originalAttrValues) {
  const attrs = _projectAttrRows(fac);
  const rows = attrs.map(attr => {
    const original = originalAttrValues.get(String(attr.name || '').toLowerCase()) || { value:'', unit:'' };
    return _projectAttributeRowMarkup(attr.name, attr.value, attr.unit, original.value, original.unit);
  }).join('');

  const body = rows || '<p class="project-empty mb-0">No additional attributes provided.</p>';
  const addButton = _projectAddActionButton('project-doc-add-btn project-add-attribute-btn', 'Add attribute');
  return _projectCard('Additional Attributes', 'project-card-facility', body, addButton);
}

function _projectDocumentsCard(facilityName) {
  const docCard = _infoDocumentsCard('facility', facilityName, facilityName);
  return _projectCard('Documents', 'project-card-document', docCard?.body || '', docCard?.actions || '');
}

function buildFacilityBody(name) {
  const fac = db.facilities.find(x => x._facility === name);
  if (!fac) return '<p class="text-muted small mb-0">Project not found.</p>';

  _projectModalFacility = fac._facility || name;
  _projectModalContext = {
    entityType: 'facility',
    entityName: fac._facility || name,
    facility: fac._facility || name,
    row: fac,
  };
  _projectDocCollapsedCategories.clear();
  const originalFac = _projectOriginalFacilityRow(_projectModalFacility);
  const originalAttrValues = _projectOriginalAttributeMap(_projectModalFacility);

  const fieldRows = fields => fields
    .map(field => _projectFieldRow(
      field,
      _projectFieldValue(fac, field.aliases),
      originalFac ? _projectFieldValue(originalFac, field.aliases) : _projectFieldValue(fac, field.aliases)
    )).join('');

  const facilityCards = MODEL_MODAL_CONFIG.facility.cards;
  const cards = Object.entries(_PROJECT_FIELD_GROUPS)
    .map(([key, fields]) => _projectCard(
      facilityCards[key]?.title || key,
      'project-card-facility',
      fieldRows(fields),
    ))
    .concat(_projectAdditionalAttributesCard(fac, originalAttrValues))
    .join('');

  return `<div class="project-modal-layout" data-project-facility="${esc(fac._facility || name)}">
    <div class="project-modal-cards">${cards}</div>
    ${_projectDocumentsCard(fac._facility || name)}
  </div>`;
}

function _projectFacilityRow() {
  const name = String(_projectModalFacility || '').trim();
  return db.facilities.find(row => row._facility === name) || null;
}

function _projectActiveEntityContext() {
  return _projectModalContext || null;
}

function _projectActiveEntityRow() {
  const context = _projectActiveEntityContext();
  if (!context) return _projectFacilityRow();
  if (context.entityType === 'facility') return _projectFacilityRow();
  return context.row || null;
}

function _projectActiveEntityType() {
  return _projectActiveEntityContext()?.entityType || 'facility';
}

function _projectActiveEntityName() {
  const context = _projectActiveEntityContext();
  if (!context) {
    const facilityRow = _projectFacilityRow();
    return facilityRow ? (f(facilityRow, 'Name') || facilityRow._facility || '') : '';
  }
  return context.entityName || '';
}

function _projectActiveFacilityName() {
  const context = _projectActiveEntityContext();
  const row = _projectActiveEntityRow();
  return String(row?._facility || context?.facility || _projectModalFacility || '').trim();
}

function _projectAttributeRecordForEntity(entityType, entityName, facilityName, attrName) {
  const sheetKey = String(entityType || '').toLowerCase();
  const rowKey = String(entityName || '').toLowerCase();
  const facKey = String(facilityName || '').toLowerCase();
  const attrKey = String(attrName || '').toLowerCase();
  return db.attributes.find(row =>
    (row._facility || '').toLowerCase() === facKey &&
    _cobieField(row, 'sheetName').toLowerCase() === sheetKey &&
    _cobieField(row, 'rowName').toLowerCase() === rowKey &&
    f(row, 'Name').toLowerCase() === attrKey
  ) || null;
}

function _projectAttributeRecord(facilityName, attrName) {
  return _projectAttributeRecordForEntity('facility', facilityName, facilityName, attrName);
}

function _projectSetAttributeValue(row, value) {
  row.Value = value;
  row.AttributeValue = value;
  row['Attribute Value'] = value;
  row.NominalValue = value;
  row['Nominal Value'] = value;
}

function _projectEnsureAttributeRow(facilityName, attrName) {
  const current = _projectAttributeRecord(facilityName, attrName);
  if (current) return current;
  const row = {
    SheetName:'Facility',
    RowName:facilityName,
    Name:attrName,
    CreatedBy:'',
    CreatedOn:new Date().toISOString().slice(0, 10),
    ExtSystem:'',
    ExtObject:'',
    ExtIdentifier:'',
    _facility:facilityName,
  };
  _projectSetAttributeValue(row, '');
  _projectSetAttributeUnit(row, '');
  db.attributes.push(row);
  return row;
}

function _projectEnsureAttributeRowForEntity(entityType, entityName, facilityName, attrName) {
  const current = _projectAttributeRecordForEntity(entityType, entityName, facilityName, attrName);
  if (current) return current;
  const row = {
    SheetName:(_INFO_ENTITY_SHEET[entityType] || entityType || 'Facility'),
    RowName:entityName,
    Name:attrName,
    CreatedBy:'',
    CreatedOn:new Date().toISOString().slice(0, 10),
    ExtSystem:'',
    ExtObject:'',
    ExtIdentifier:'',
    _facility:facilityName,
  };
  _projectSetAttributeValue(row, '');
  _projectSetAttributeUnit(row, '');
  db.attributes.push(row);
  return row;
}

function _projectSetValueCellMarkup(cell, rawValue, displayValue = '') {
  if (!cell) return;
  const raw = String(rawValue || '');
  const show = String(displayValue || raw);
  cell.dataset.rawValue = raw;
  cell.innerHTML = `<span class="project-value-text">${show ? esc(show) : '<span class="project-empty">Not provided</span>'}</span>`;
}

function _projectMarkRowDirty(row, kind) {
  if (!row) return;
  row.classList.add('project-dirty');
  row.dataset.dirtyKind = kind || 'field';
  const valueCell = kind === 'attribute'
    ? (row.querySelector('[data-role="attr-unit"]') || row.querySelector('[data-role="attr-value"]'))
    : row.querySelector('[data-role="field-value"]');
  if (!valueCell) return;
  if (!valueCell.querySelector('.project-value-text')) {
    valueCell.innerHTML = `<span class="project-value-text">${valueCell.innerHTML}</span>`;
  }
  if (!valueCell.querySelector('.project-undo-btn')) {
    valueCell.insertAdjacentHTML('beforeend', '<button type="button" class="project-undo-btn" title="Undo change"><i class="bi bi-arrow-counterclockwise"></i>Undo</button>');
  }
}

function _projectClearRowDirty(row) {
  if (!row) return;
  row.classList.remove('project-dirty');
  delete row.dataset.dirtyKind;
  row.querySelector('.project-undo-btn')?.remove();
}

function _projectDeleteAttributeRow(row, options = {}) {
  const entity = _projectActiveEntityRow();
  if (!row || !entity) return;
  const shouldLog = options.log !== false;
  const entityType = _projectActiveEntityType();
  const entityName = _projectActiveEntityName() || f(entity, 'Name') || entity._facility || '';
  const facilityName = _projectActiveFacilityName();
  const attrName = String(row.dataset.attrName || '').trim();
  if (entity._attrs && attrName) delete entity._attrs[attrName];

  const facilityKey = String(facilityName || '').toLowerCase();
  const entityKey = String(entityName || '').toLowerCase();
  const sheetKey = String(entityType || '').toLowerCase();
  const attrKey = attrName.toLowerCase();
  for (let index = db.attributes.length - 1; index >= 0; index -= 1) {
    const entry = db.attributes[index];
    if ((entry._facility || '').toLowerCase() !== facilityKey) continue;
    if (_cobieField(entry, 'sheetName').toLowerCase() !== sheetKey) continue;
    if (_cobieField(entry, 'rowName').toLowerCase() !== entityKey) continue;
    if (f(entry, 'Name').toLowerCase() !== attrKey) continue;
    db.attributes.splice(index, 1);
  }

  row.remove();
  const body = document.querySelector('#type-modal.project-modal .project-attr-row')?.closest('.project-card-body')
    || document.querySelector('#type-modal.project-modal .project-add-attribute-btn')?.closest('.project-card')?.querySelector('.project-card-body');
  if (body && !body.querySelector('.project-attr-row')) {
    body.insertAdjacentHTML('beforeend', '<p class="project-empty mb-0">No additional attributes provided.</p>');
  }
  if (shouldLog) {
    _logChange('attribute', attrName || 'Attribute', facilityName || '');
  } else if (typeof _clearChangeEntries === 'function' && attrName) {
    _clearChangeEntries('attribute', attrName, facilityName || '', attrName);
  }
}

function _projectLookupMenuMarkup(options, query, allowCreate = false) {
  const q = String(query || '').trim().toLowerCase();
  const filtered = options.filter(option => !q || option.search.includes(q));
  return filtered.length
    ? filtered.map(option => `<button type="button" class="project-lookup-option" data-value="${esc(option.value)}" style="padding-left:${0.65 + (option.depth || 0) * 0.8}rem">${esc(option.label)}</button>`).join('')
    : allowCreate && q
      ? `<button type="button" class="project-lookup-option project-lookup-create"><i class="bi bi-person-plus me-1"></i>Create contact "${esc(String(query).trim())}"</button>`
      : '<div class="project-lookup-empty">No matching values</div>';
}

function _projectCreateFloatingLookup(input, options, onPick, initialQuery = '', onCreate = null) {
  const menu = document.createElement('div');
  menu.className = 'project-lookup-floating-menu';
  document.body.appendChild(menu);

  const position = () => {
    if (!document.body.contains(menu) || !document.body.contains(input)) return;
    const rect = input.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const maxHeight = Math.max(140, Math.min(320, viewportHeight - rect.bottom - 14));
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    menu.style.width = `${Math.max(220, Math.round(rect.width))}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  };

  let currentQuery = initialQuery;
  const render = q => {
    currentQuery = String(q || '');
    menu.innerHTML = _projectLookupMenuMarkup(options, currentQuery, Boolean(onCreate));
    position();
  };

  const onMouseDown = event => {
    const create = event.target.closest('.project-lookup-create');
    if (create && onCreate) {
      event.preventDefault();
      onCreate(currentQuery.trim());
      return;
    }
    const option = event.target.closest('.project-lookup-option');
    if (!option) return;
    event.preventDefault();
    onPick(option.dataset.value || '');
  };

  let positionFrame = 0;
  const onViewportChange = () => {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      position();
    });
  };
  menu.addEventListener('mousedown', onMouseDown);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);

  render(initialQuery);

  return {
    render,
    destroy: () => {
      menu.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      if (positionFrame) cancelAnimationFrame(positionFrame);
      if (document.body.contains(menu)) menu.remove();
    },
  };
}

function _projectFinishFieldEdit(editor, commit) {
  const row = editor.closest('.project-field-row');
  if (!row) return;
  const valueCell = row.querySelector('[data-role="field-value"]');
  if (!valueCell) return;
  const input = editor.querySelector('input');
  const entity = _projectActiveEntityRow();
  if (!entity) return;
  const entityType = _projectActiveEntityType();
  const entityFacility = _projectActiveFacilityName();
  const aliases = (row.dataset.aliases || '').split('|').filter(Boolean);
  const fieldLabel = row.dataset.fieldLabel || aliases[0] || 'Field';
  const oldValue = valueCell.dataset.rawValue || '';
  const lookupType = row.dataset.lookup || '';
  const newValue = commit
    ? _projectNormalizeLookupValue(lookupType, input?.value || '', oldValue)
    : oldValue;
  const isNewEntity = _projectIsNewEntityRow(entity);

  let displayValue = oldValue;
  if (commit && newValue !== oldValue && aliases.length) {
    let qaPreviousName = '';
    if (fieldLabel === 'Name') {
      if (!newValue) {
        alert('Name is required.');
      } else if (typeof _editNameConflict === 'function' && _editNameConflict(entityType, oldValue || _projectActiveEntityName() || '', newValue, entityFacility || '')) {
        alert(`"${newValue}" already exists.`);
      } else {
        _projectSetFieldValue(entity, aliases, newValue);
        const oldEntityName = oldValue || _projectActiveEntityName() || '';
        qaPreviousName = oldEntityName;
        let resolvedName = newValue;
        if (!isNewEntity && typeof _cascadeEntityRename === 'function') {
          const renamedFacility = _cascadeEntityRename(entityType, oldEntityName, newValue, entityFacility || '');
          if (entityType === 'facility' && renamedFacility) resolvedName = renamedFacility;
        }
        if (entityType === 'facility') {
          if (resolvedName) _projectModalFacility = resolvedName;
          document.getElementById('mtype-title').textContent = resolvedName;
        } else {
          const modalTitle = MODEL_MODAL_CONFIG?.[entityType]?.title || 'Information';
          document.getElementById('mtype-title').textContent = `${modalTitle}: ${resolvedName}`;
        }
        if (_projectModalContext) _projectModalContext.entityName = resolvedName;
        displayValue = resolvedName;
        if (!isNewEntity) row.classList.add('project-dirty');
        if (!isNewEntity) _logChange(entityType, resolvedName, entityFacility || '', oldEntityName || '');
      }
    } else {
      _projectSetFieldValue(entity, aliases, newValue);
      displayValue = newValue;
      if (!isNewEntity) row.classList.add('project-dirty');
      if (!isNewEntity) _logChange(entityType, _projectActiveEntityName() || f(entity, 'Name') || '', entityFacility || '');
    }

    if (!isNewEntity && typeof qaRevalidateFieldChange === 'function') {
      qaRevalidateFieldChange(
        entityType,
        _projectActiveEntityName() || f(entity, 'Name') || '',
        entityFacility || '',
        aliases,
        qaPreviousName,
      );
      _projectRefreshFieldIssueBadges(
        entityType,
        _projectActiveEntityName() || f(entity, 'Name') || '',
        entityFacility || '',
      );
    }
  }

  _projectSetValueCellMarkup(valueCell, displayValue);
  if (commit && aliases.length && displayValue !== oldValue) {
    if (isNewEntity) _projectClearRowDirty(row);
    else if (displayValue !== (row.dataset.originalValue || '')) _projectMarkRowDirty(row, 'field');
    else _projectClearRowDirty(row);
    _projectScheduleIndexRefresh();
    _associationRefreshControlsFromModel(entityType, entity);
    if (!isNewEntity) {
      _projectSyncEntityChangeState(entityType, entity, _projectActiveEntityName() || f(entity, 'Name') || '', entityFacility || '');
    }
  }
  if (typeof editor._cleanupLookup === 'function') editor._cleanupLookup();
  editor.remove();
  valueCell.classList.remove('d-none');
}

function _projectFinishAttributeEdit(editor, role, commit) {
  const row = editor.closest('.project-attr-row');
  if (!row) return;
  const entity = _projectActiveEntityRow();
  if (!entity) return;
  const isNewEntity = _projectIsNewEntityRow(entity);
  const entityType = _projectActiveEntityType();
  const entityName = _projectActiveEntityName() || f(entity, 'Name') || entity._facility || '';
  const entityFacility = _projectActiveFacilityName();
  const nameCell = row.querySelector('[data-role="attr-name"]');
  const valueCell = row.querySelector('[data-role="attr-value"]');
  const unitCell = row.querySelector('[data-role="attr-unit"]');
  const input = editor.querySelector('input');
  if (!nameCell || !valueCell || !unitCell) return;

  const oldName = row.dataset.attrName || '';
  const oldValue = valueCell.dataset.rawValue || '';
  const oldUnit = unitCell.dataset.rawValue || '';
  const originalValue = row.dataset.originalAttrValue || '';
  const originalUnit = row.dataset.originalAttrUnit || '';
  const newRaw = commit
    ? String(input?.value || '').trim()
    : (role === 'attr-name' ? oldName : (role === 'attr-unit' ? oldUnit : oldValue));

  if (role === 'attr-name') {
    const finalName = newRaw || oldName;
    row.dataset.attrName = finalName;
    _projectSetValueCellMarkup(nameCell, finalName);
    if (commit && finalName && finalName !== oldName) {
      if (entity._attrs && oldName) delete entity._attrs[oldName];
      (entity._attrs ||= {})[finalName] = _projectAttributeDisplayValue(oldValue, oldUnit);
      const attrRow = _projectEnsureAttributeRowForEntity(entityType, entityName, entityFacility || '', oldName || finalName);
      attrRow.Name = finalName;
      _projectSetAttributeValue(attrRow, oldValue);
      _projectSetAttributeUnit(attrRow, oldUnit);
      if (isNewEntity) _projectClearRowDirty(row);
      else if (finalName !== (row.dataset.originalAttrName || oldName || '')) _projectMarkRowDirty(row, 'attribute');
      else _projectClearRowDirty(row);
      if (!isNewEntity) _logChange('attribute', finalName, entityFacility || '');
      if (typeof _clearChangeEntries === 'function' && oldName && oldName !== finalName) {
        _clearChangeEntries('attribute', oldName, entityFacility || '', oldName);
      }
      if (!isNewEntity) _projectSyncEntityChangeState(entityType, entity, _projectActiveEntityName() || f(entity, 'Name') || '', entityFacility || '');
    }
  } else if (role === 'attr-value') {
    const finalValue = newRaw;
    _projectSetValueCellMarkup(valueCell, finalValue);
    if (commit && finalValue !== oldValue) {
      const attrName = row.dataset.attrName || oldName || 'New Attribute';
      (entity._attrs ||= {})[attrName] = _projectAttributeDisplayValue(finalValue, oldUnit);
      const attrRow = _projectEnsureAttributeRowForEntity(entityType, entityName, entityFacility || '', attrName);
      _projectSetAttributeValue(attrRow, finalValue);
      _projectSetAttributeUnit(attrRow, oldUnit);
      if (isNewEntity) _projectClearRowDirty(row);
      else if (finalValue !== originalValue || oldUnit !== originalUnit) _projectMarkRowDirty(row, 'attribute');
      else _projectClearRowDirty(row);
      if (!isNewEntity) _logChange('attribute', attrName, entityFacility || '');
      if (typeof _clearChangeEntries === 'function' && finalValue === originalValue && oldUnit === originalUnit) {
        _clearChangeEntries('attribute', attrName, entityFacility || '', attrName);
      }
      if (!isNewEntity) _projectSyncEntityChangeState(entityType, entity, _projectActiveEntityName() || f(entity, 'Name') || '', entityFacility || '');
    }
  } else if (role === 'attr-unit') {
    const finalUnit = newRaw;
    _projectSetValueCellMarkup(unitCell, finalUnit);
    if (commit && finalUnit !== oldUnit) {
      const attrName = row.dataset.attrName || oldName || 'New Attribute';
      const currentValue = valueCell.dataset.rawValue || '';
      (entity._attrs ||= {})[attrName] = _projectAttributeDisplayValue(currentValue, finalUnit);
      const attrRow = _projectEnsureAttributeRowForEntity(entityType, entityName, entityFacility || '', attrName);
      _projectSetAttributeValue(attrRow, currentValue);
      _projectSetAttributeUnit(attrRow, finalUnit);
      if (isNewEntity) _projectClearRowDirty(row);
      else if (currentValue !== originalValue || finalUnit !== originalUnit) _projectMarkRowDirty(row, 'attribute');
      else _projectClearRowDirty(row);
      if (!isNewEntity) _logChange('attribute', attrName, entityFacility || '');
      if (typeof _clearChangeEntries === 'function' && currentValue === originalValue && finalUnit === originalUnit) {
        _clearChangeEntries('attribute', attrName, entityFacility || '', attrName);
      }
      if (!isNewEntity) _projectSyncEntityChangeState(entityType, entity, _projectActiveEntityName() || f(entity, 'Name') || '', entityFacility || '');
    }
  }

  if (typeof editor._cleanupLookup === 'function') editor._cleanupLookup();
  editor.remove();
  if (role === 'attr-name') nameCell.classList.remove('d-none');
  else if (role === 'attr-unit') unitCell.classList.remove('d-none');
  else valueCell.classList.remove('d-none');
}

function _projectStartInlineEdit(target) {
  const row = target.closest('.project-field-row');
  if (!row || row.querySelector('.project-inline-editor')) return;
  const role = target.dataset.role || 'field-value';
  const valueCell = row.querySelector('[data-role="field-value"]');
  const attrValueCell = row.querySelector('[data-role="attr-value"]');
  const attrUnitCell = row.querySelector('[data-role="attr-unit"]');
  const current = role === 'field-value'
    ? (valueCell?.dataset.rawValue || '')
    : role === 'attr-name' ? (row.dataset.attrName || '')
      : role === 'attr-unit' ? (attrUnitCell?.dataset.rawValue || '')
        : (attrValueCell?.dataset.rawValue || '');

  const lookupType = role === 'field-value' ? (row.dataset.lookup || '') : '';
  const lookupOptions = lookupType ? _projectLookupOptions(lookupType) : [];
  const editor = document.createElement('div');
  const useLookup = Boolean(lookupType);
  editor.className = 'project-inline-editor' + (useLookup ? ' project-lookup-editor' : '');
  editor.innerHTML = `<input type="${useLookup ? 'search' : 'text'}" class="form-control form-control-sm project-inline-input" value="${esc(current)}" autocomplete="off">`;

  target.classList.add('d-none');
  target.insertAdjacentElement('afterend', editor);

  const input = editor.querySelector('input');
  let floatingLookup = null;
  if (useLookup) {
    floatingLookup = _projectCreateFloatingLookup(input, lookupOptions, picked => {
      input.value = picked;
      _projectFinishFieldEdit(editor, true);
    }, current, lookupType === 'contact' ? query => {
      const entity = _projectActiveEntityRow();
      const context = _projectActiveEntityContext();
      const aliases = (row.dataset.aliases || '').split('|').filter(Boolean);
      const returnContext = _projectReturnContext(context);
      _projectFinishFieldEdit(editor, false);
      openNewEntityInfoModal(
        'contact', query, context?.facility || '', returnContext, null, null,
        { entityType:context?.entityType || '', row:entity, aliases },
      );
    } : null);
    editor._cleanupLookup = () => {
      floatingLookup?.destroy();
      floatingLookup = null;
      editor._cleanupLookup = null;
    };
    input.addEventListener('input', () => floatingLookup?.render(input.value));
  }

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (role === 'field-value') _projectFinishFieldEdit(editor, true);
      else _projectFinishAttributeEdit(editor, role, true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (role === 'field-value') _projectFinishFieldEdit(editor, false);
      else _projectFinishAttributeEdit(editor, role, false);
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.body.contains(editor)) return;
      if (role === 'field-value') _projectFinishFieldEdit(editor, true);
      else _projectFinishAttributeEdit(editor, role, true);
    }, 120);
  });

  input.focus();
  input.select();
}

function _projectFilterDocuments(container, query) {
  const q = String(query || '').trim().toLowerCase();
  const headers = [...container.querySelectorAll('.project-doc-cat-hdr')];
  const items = [...container.querySelectorAll('.project-doc-item')];

  if (!q) {
    headers.forEach(header => header.classList.remove('project-search-hidden'));
    items.forEach(item => item.classList.remove('project-search-hidden'));
    _projectApplyDocTreeVisibility(container);
    return;
  }

  const shown = new Set();
  const includeAncestors = key => {
    if (!key) return;
    shown.add(key);
    if (!key.includes('_')) return;
    const parts = key.split('_');
    for (let i = 1; i < parts.length; i += 1) {
      shown.add(parts.slice(0, i).join('_').toLowerCase());
    }
  };

  items.forEach(item => {
    const hit = (item.dataset.search || '').includes(q);
    item.classList.toggle('project-search-hidden', !hit);
    if (hit) includeAncestors((item.dataset.catPath || '').toLowerCase());
  });
  headers.forEach(header => {
    if ((header.dataset.search || '').includes(q)) includeAncestors((header.dataset.cat || '').toLowerCase());
  });

  headers.forEach(header => {
    const key = (header.dataset.cat || '').toLowerCase();
    header.classList.toggle('project-search-hidden', !shown.has(key));
  });

  _projectApplyDocTreeVisibility(container);
}

const _projectModalEl = document.getElementById('type-modal');
if (_projectModalEl) {
  let associationShiftInput = null;
  _projectModalEl.addEventListener('click', event => {
    const input = event.target.closest('.project-association-option input[type="checkbox"]');
    associationShiftInput = event.shiftKey ? input : null;
  }, true);

  _projectModalEl.addEventListener('dblclick', event => {
    if (!_projectModalEl.classList.contains('project-modal')) return;
    const editable = event.target.closest('.project-editable');
    if (!editable) return;
    _projectStartInlineEdit(editable);
  });

  _projectModalEl.addEventListener('input', event => {
    if (!_projectModalEl.classList.contains('project-modal')) return;
    const facilitySelect = event.target.closest('.project-new-entity-facility');
    if (facilitySelect && _newEntityDraft?.row) {
      _newEntityDraft.row._facility = facilitySelect.value;
      if (_projectModalContext) _projectModalContext.facility = facilitySelect.value;
      return;
    }
    const associationSearch = event.target.closest('.project-association-search');
    if (associationSearch) {
      const query = associationSearch.value.trim().toLowerCase();
      const control = associationSearch.closest('.project-association');
      const { hasMatch } = _associationRenderOptions(control, query, true);
      control?.querySelector('.project-association-create')?.classList.toggle('d-none', !query || hasMatch);
      return;
    }
    const search = event.target.closest('.project-doc-search');
    if (!search) return;
    const container = _projectModalEl.querySelector('.project-doc-tree');
    if (container) _projectFilterDocuments(container, search.value);
  });

  _projectModalEl.addEventListener('change', event => {
    if (!_projectModalEl.classList.contains('project-modal')) return;
    const input = event.target.closest('.project-association-option input');
    if (!input) return;
    const control = input.closest('.project-association');
    const state = _associationOptionsCache.get(control?.dataset.optionsCache || '');
    let changedInputs = [input];
    if (input.type === 'checkbox' && associationShiftInput === input && state?.anchorName) {
      const visibleInputs = [...control.querySelectorAll('.project-association-option input[type="checkbox"]')];
      const names = visibleInputs.map(option => option.value);
      const rangeNames = new Set(_selectionRange(names, state.anchorName, input.value));
      changedInputs = visibleInputs.filter(option => rangeNames.has(option.value)).filter(option => {
        const cached = state.options.find(item => item.name.toLowerCase() === option.value.toLowerCase());
        option.checked = input.checked;
        return cached?.selected !== option.checked;
      });
    }
    if (state) state.anchorName = input.value;
    associationShiftInput = null;
    if (changedInputs.length) _commitAssociationControl(control, changedInputs);
  });

  _projectModalEl.addEventListener('scroll', event => {
    const optionsHost = event.target.closest?.('.project-association-options');
    if (optionsHost) _associationLoadMore(optionsHost);
  }, true);

  _projectModalEl.addEventListener('click', event => {
    if (!_projectModalEl.classList.contains('project-modal')) return;
    const closeButton = event.target.closest('.modal-header .btn-close');
    if (closeButton && (_newEntityDraft?.returnContext || _typeModalReturnContext)) {
      event.preventDefault();
      event.stopPropagation();
      if (_newEntityDraft) {
        const returnContext = _newEntityDraft.returnContext || null;
        setTimeout(() => _restoreNewEntityInfoContext(returnContext), 0);
      } else {
        const returnContext = _typeModalReturnContext;
        _typeModalReturnContext = null;
        setTimeout(() => restoreTypeModalView(returnContext), 0);
      }
      return;
    }
    const header = event.target.closest('.project-card-header');
    if (header && !event.target.closest('button,a,input,select,textarea,[role="button"]')) {
      const card = header.closest('.project-card');
      if (!card) return;
      card.classList.toggle('project-card-collapsed');
      return;
    }
    const undoButton = event.target.closest('.project-undo-btn');
    if (undoButton) {
      const row = undoButton.closest('.project-field-row');
      if (!row) return;
      const entity = _projectActiveEntityRow();
      if (!entity) return;
      if (_projectIsNewEntityRow(entity)) {
        _projectClearRowDirty(row);
        return;
      }
      const entityType = _projectActiveEntityType();
      const entityName = _projectActiveEntityName() || f(entity, 'Name') || '';
      const entityFacility = _projectActiveFacilityName() || '';
      if (row.classList.contains('project-attr-row') || row.dataset.dirtyKind === 'attribute') {
        _projectDeleteAttributeRow(row, { log:false });
        _projectSyncEntityChangeState(entityType, entity, entityName, entityFacility);
        return;
      }
      const aliases = (row.dataset.aliases || '').split('|').filter(Boolean);
      const original = row.dataset.originalValue || '';
      const fieldLabel = row.dataset.fieldLabel || aliases[0] || '';
      const previousEntityName = entityName;
      let resolvedEntityName = entityName;
      let resolvedFacility = entityFacility;
      if (aliases.length) _projectSetFieldValue(entity, aliases, original);
      if (fieldLabel === 'Name' && original && original !== previousEntityName) {
        const renamedFacility = _cascadeEntityRename(entityType, previousEntityName, original, entityFacility);
        resolvedEntityName = original;
        if (entityType === 'facility') {
          resolvedFacility = renamedFacility || original;
          _projectModalFacility = resolvedFacility;
          document.getElementById('mtype-title').textContent = resolvedEntityName;
        } else {
          const modalTitle = MODEL_MODAL_CONFIG?.[entityType]?.title || 'Information';
          document.getElementById('mtype-title').textContent = `${modalTitle}: ${resolvedEntityName}`;
        }
        if (_projectModalContext) {
          _projectModalContext.entityName = resolvedEntityName;
          _projectModalContext.facility = resolvedFacility;
        }
      }
      _projectSetValueCellMarkup(row.querySelector('[data-role="field-value"]'), original);
      _projectClearRowDirty(row);
      _projectScheduleIndexRefresh();
      _associationRefreshControlsFromModel(entityType, entity);
      _projectSyncEntityChangeState(entityType, entity, resolvedEntityName, resolvedFacility);
      if (typeof qaRevalidateFieldChange === 'function') {
        qaRevalidateFieldChange(
          entityType,
          resolvedEntityName,
          resolvedFacility,
          aliases,
          fieldLabel === 'Name' ? previousEntityName : '',
        );
        _projectRefreshFieldIssueBadges(entityType, resolvedEntityName, resolvedFacility);
      }
      return;
    }
    const clearAssociations = event.target.closest('.project-association-clear');
    if (clearAssociations) {
      const control = clearAssociations.closest('.project-association');
      const checked = [...control.querySelectorAll('.project-association-option input:checked')];
      checked.forEach(input => { input.checked = false; });
      if (checked.length) _commitAssociationControl(control, checked);
      return;
    }
    const associationCategoryToggle = event.target.closest('.project-association-cat-toggle');
    if (associationCategoryToggle) {
      const control = associationCategoryToggle.closest('.project-association');
      const category = associationCategoryToggle.closest('.project-association-cat')?.dataset.associationCat || '';
      const state = _associationOptionsCache.get(control?.dataset.optionsCache || '');
      if (!state || !category) return;
      if (state.collapsed.has(category)) state.collapsed.delete(category);
      else state.collapsed.add(category);
      _associationRenderOptions(control, control.querySelector('.project-association-search')?.value || '');
      return;
    }
    if (event.target.closest('.project-component-locate')) {
      openComponentPlacementModal();
      return;
    }
    const createAssociation = event.target.closest('.project-association-create');
    if (createAssociation) {
      const control = createAssociation.closest('.project-association');
      const context = _projectActiveEntityContext();
      if (!control || !context?.row || _newEntityDraft) return;
      const association = MODEL_MODAL_CONFIG?.[context.entityType]?.cards?.associations?.associations
        ?.find(item => item.key === control.dataset.associationKey);
      if (!association) return;
      const returnContext = _projectReturnContext(context);
      openNewEntityInfoModal(
        association.targetType,
        control.querySelector('.project-association-search')?.value || '',
        context.facility || '',
        returnContext,
        null,
        { entityType:context.entityType, row:context.row, association },
      );
      return;
    }
    const addDocumentButton = event.target.closest('.project-doc-add-btn:not(.project-add-attribute-btn)');
    if (addDocumentButton) {
      const context = _projectActiveEntityContext();
      const entityType = String(context?.entityType || 'facility').toLowerCase();
      const facility = String(context?.facility || _projectActiveFacilityName() || '').trim();
      const rowName = String(context?.entityName || _projectActiveEntityName() || '').trim();
      const sheetName = _INFO_ENTITY_SHEET[entityType] || 'Facility';
      const returnInfoContext = {
        kind: 'group',
        entityType,
        entityName: rowName,
        facility,
      };
      openNewDocumentInfoModal(sheetName, rowName, facility, returnInfoContext);
      return;
    }
    if (event.target.closest('.project-new-entity-save')) {
      _saveNewEntityInfo();
      return;
    }
    if (event.target.closest('.project-new-entity-cancel')) {
      const returnContext = _newEntityDraft?.returnContext || null;
      _restoreNewEntityInfoContext(returnContext);
      return;
    }
    const treeStep = event.target.closest('[data-project-doc-tree-step]');
    if (treeStep) {
      const container = _projectModalEl.querySelector('.project-doc-tree');
      if (container) _projectStepDocTreeDepth(container, treeStep.dataset.projectDocTreeStep);
      return;
    }
    const categoryToggle = event.target.closest('.project-doc-cat-toggle');
    if (categoryToggle) {
      const header = categoryToggle.closest('.project-doc-cat-hdr');
      const key = header?.dataset.cat || '';
      const container = _projectModalEl.querySelector('.project-doc-tree');
      _projectToggleDocCategory(container, key);
      return;
    }
    const categoryHeader = event.target.closest('.project-doc-cat-hdr[data-collapsible="1"]');
    if (categoryHeader && !event.target.closest('.project-doc-cat-toggle')) {
      const container = _projectModalEl.querySelector('.project-doc-tree');
      _projectToggleDocCategory(container, categoryHeader.dataset.cat || '');
      return;
    }
    const addAttributeButton = event.target.closest('.project-add-attribute-btn');
    if (!addAttributeButton) return;
    const body = addAttributeButton.closest('.project-card')?.querySelector('.project-card-body');
    if (!body) return;
    const empty = body.querySelector('.project-empty');
    if (empty) empty.remove();
    const isNewEntity = _projectIsNewEntityRow(_projectActiveEntityRow());
    body.insertAdjacentHTML('beforeend', `<div class="project-field-row project-attr-row${isNewEntity ? '' : ' project-dirty'}" data-attr-name="New Attribute" data-original-attr-name="" data-original-attr-value="" data-original-attr-unit="">
      <div class="project-attr-fields">
        <div class="project-attr-subfield">
          <span class="project-attr-subfield-label">Name</span>
          <div class="project-field-value project-editable" data-role="attr-name" data-raw-value="New Attribute" title="Double click to edit">New Attribute</div>
        </div>
        <div class="project-attr-subfield">
          <span class="project-attr-subfield-label">Value</span>
          <div class="project-field-value project-editable" data-role="attr-value" data-raw-value="" title="Double click to edit"><span class="project-empty">Not provided</span></div>
        </div>
        <div class="project-attr-subfield">
          <span class="project-attr-subfield-label">Unit</span>
          <div class="project-field-value project-editable" data-role="attr-unit" data-raw-value="" title="Double click to edit"><span class="project-empty">Not provided</span></div>
        </div>
      </div>
    </div>`);
    const newRow = body.querySelector('.project-attr-row:last-child');
    if (!isNewEntity) _projectMarkRowDirty(newRow, 'attribute');
    const added = body.querySelector('.project-attr-row:last-child [data-role="attr-name"]');
    if (added) _projectStartInlineEdit(added);
  });

  _projectModalEl.addEventListener('hidden.bs.modal', () => {
    if (_projectOpeningChildModal) return;
    const returnContext = _newEntityDraft?.returnContext || null;
    const shouldRestore = Boolean(_newEntityDraft);
    _newEntityDraft = null;
    _projectModalEl.classList.remove('project-modal');
    _projectModalFacility = '';
    _projectModalContext = null;
    if (_projectAssociationsChanged) {
      _projectAssociationsChanged = false;
      if (typeof applyFilters === 'function') applyFilters();
    }
    if (shouldRestore && returnContext) restoreTypeModalView(returnContext);
  });
}

function openComponentInfo(name, facility) {
  const compName = String(name || '').trim();
  const compFacility = String(facility || '').trim();
  if (!compName) return;
  _setTypeModalCloseReturns(false);
  _typeModalViewContext = { kind:'component', entityName:compName, facility:compFacility };
  const typeModal = document.getElementById('type-modal');
  typeModal.classList.add('project-modal');
  _setProjectModalColor(typeModal, MODEL_MODAL_CONFIG.component.headerColorToken);

  const c = (compFacility
    ? db.components.find(x => f(x,'Name') === compName && x._facility === compFacility)
    : db.components.find(x => f(x,'Name') === compName)) || null;

  document.getElementById('mtype-icon').className = 'bi bi-tools me-2';
  document.getElementById('mtype-title').textContent = `Component Information: ${compName}`;

  if (!c) {
    document.getElementById('mtype-body').innerHTML = '<p class="text-muted small mb-0">Component not found.</p>';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('type-modal')).show();
    return;
  }

  document.getElementById('mtype-body').innerHTML = buildEntityInfoBody('component', compName, compFacility, c);
  bootstrap.Modal.getOrCreateInstance(typeModal).show();
}

// ── Document information modal ────────────────────────────────
function openDoc(doc, returnContext = null) {
  const name = f(doc, 'Name') || 'Document';
  const facility = String(doc?._facility || '');
  _typeModalReturnContext = returnContext;
  _setTypeModalCloseReturns(Boolean(returnContext));
  _typeModalViewContext = { kind:'document', documentRow:doc, returnContext };
  const typeModal = document.getElementById('type-modal');
  typeModal.classList.add('project-modal');
  _setProjectModalColor(typeModal, MODEL_MODAL_CONFIG.document.headerColorToken);

  document.getElementById('mtype-icon').className = `bi ${_GRP_ICONS.doccat || 'bi-file-earmark-text'} me-2`;
  document.getElementById('mtype-title').textContent = `Document Information: ${name}`;

  const closeBtn = typeModal.querySelector('.modal-header .btn-close');
  if (closeBtn) closeBtn.classList.add('btn-close-white');

  document.getElementById('mtype-body').innerHTML = buildEntityInfoBody('document', name, facility, doc);
  bootstrap.Modal.getOrCreateInstance(typeModal).show();
}
