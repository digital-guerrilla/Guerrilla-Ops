// ── Workbook quality audit (schema-driven) ───────────────────
const QA_CHECKS = {
  'schema-missing': { label:'QA schema could not be loaded', sev:'error', sheet:'Schema', ico:'bi-exclamation-triangle-fill' },
  'sheet-required-missing': { label:'Required COBie sheet is missing or empty', sev:'error', sheet:'Multiple', ico:'bi-table' },
  'required-missing': { label:'Required column value is missing', sev:'warning', sheet:'Multiple', ico:'bi-key' },
  'format-invalid': { label:'Column value has invalid format', sev:'warning', sheet:'Multiple', ico:'bi-input-cursor-text' },
  'unique-duplicate': { label:'Duplicate value in unique key column(s)', sev:'error', sheet:'Multiple', ico:'bi-files' },
  'reference-missing': { label:'Cross-sheet reference is missing', sev:'error', sheet:'Multiple', ico:'bi-diagram-3-fill' },
};

const QA_CHECK_ICON_BY_SHEET = {
  multiple:'bi-list-check', schema:'bi-filetype-xml',
};

const QA_CHECK_ICON_BY_ISSUE_TYPE = {
  completeness: 'bi-exclamation-octagon-fill',
  format: 'bi-input-cursor-text',
  reference: 'bi-diagram-3-fill',
  uniqueness: 'bi-files',
  scope: 'bi-table',
  consistency: 'bi-shuffle',
};

const QA_NAMED_CHECK_HANDLERS = Object.freeze({
  NotNull: ({ text, isNA }) => !!text && !isNA,
  NotEmpty: ({ text }) => !!text && !text.startsWith('svg'),
  Format: ({ text, isNA, schema, formatName }) => {
    const regex = schema.formats[formatName];
    if (!text || isNA || !regex) return false;
    regex.lastIndex = 0;
    return regex.test(text);
  },
  Valid: ({ text, isNA, schema }) => {
    if (!text || isNA) return false;
    schema.formats.isoDate.lastIndex = 0;
    schema.formats.isoDateTime.lastIndex = 0;
    return schema.formats.isoDate.test(text) || schema.formats.isoDateTime.test(text);
  },
  ValidNumber: ({ isNumber }) => isNumber,
  ValidNumberOrNA: ({ text, isNA, isNumber }) => !text || isNA || isNumber,
  ZeroOrGreaterOrNA: ({ text, isNA, isNumber, number }) => !text || isNA || (isNumber && number >= 0),
  ZeroOrGreater: ({ text, isNumber, number }) => !text || (isNumber && number >= 0),
});

const QA_RELATION_RULE_HANDLERS = Object.freeze({
  atLeastOneTargetPerRow: true,
});

let qaFindings = [];
let qaAllFindings = [];
let qaScopeCounts = { comps:0, spaces:0, types:0, docs:0 };
let qaRuleResults = [];
let qaAllRuleResults = [];
let qaHasRun = false;
const QA_STAGE_ORDER = Object.freeze(['design', 'construction', 'operation']);

// The COBie worksheets this tool RECOGNISES, independent of which ones the active QA
// profile happens to describe. Coverage needs both sets: without this inventory a
// client's own tab ("Notes", "Revisions") would be reported as COBie work that failed
// assessment, which is a false statement about their data.
const COBIE_WORKSHEETS = Object.freeze([
  'Contact', 'Facility', 'Floor', 'Space', 'Zone', 'Type', 'Component', 'System',
  'Assembly', 'Connection', 'Spare', 'Resource', 'Job', 'Impact', 'Document',
  'Attribute', 'Coordinate', 'Issue', 'Picklist',
]);
const _COBIE_WORKSHEET_KEYS = Object.freeze(COBIE_WORKSHEETS.map(name => name.toLowerCase()));

// Part of the COBie template, but guidance rather than project data. Calling Instruction
// an "additional worksheet outside this profile" is false — it is COBie — and calling it
// "not assessed" implies rules should have run against it. It carries nothing to assess,
// so it is excluded from the data-coverage count entirely. Andy's own example workbook
// ships it, which is how this surfaced.
const COBIE_TEMPLATE_SHEETS = Object.freeze(['Instruction']);
const _COBIE_TEMPLATE_KEYS = Object.freeze(COBIE_TEMPLATE_SHEETS.map(name => name.toLowerCase()));
let qaSelectedStage = 'operation';
let _qaSchemaCache = null;
let _qaFilterScope = null;
let _qaCellCache = new WeakMap();
let _qaGroupEntityLookups = null;
let _qaGroupValueCache = new Map();

function _qaNorm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function _qaNormKey(s) {
  return _qaNorm(s).replace(/[^a-z0-9]/g, '');
}

function _qaChildren(node, name) {
  const key = _qaNormKey(name);
  return [...(node?.children || [])].filter(child => _qaNormKey(child.localName || child.nodeName) === key);
}

function _qaDirectChild(node, name) {
  return _qaChildren(node, name)[0] || null;
}

function _qaCell(row, columnName) {
  if (!row || typeof row !== 'object') return '';
  const key = _qaNormKey(columnName);
  let rowCache = _qaCellCache.get(row);
  if (!rowCache) {
    rowCache = new Map();
    _qaCellCache.set(row, rowCache);
  } else if (rowCache.has(key)) {
    return rowCache.get(key);
  }
  const direct = String(row[columnName] ?? '').trim();
  if (direct) {
    rowCache.set(key, direct);
    return direct;
  }
  for (const k of Object.keys(row || {})) {
    if (_qaNormKey(k) === key) {
      const val = String(row[k] ?? '').trim();
      if (val) {
        rowCache.set(key, val);
        return val;
      }
    }
  }
  rowCache.set(key, '');
  return '';
}

function _qaCellSplit(row, columnName, delim) {
  const raw = _qaCell(row, columnName);
  if (!raw) return [];
  return raw.split(delim || ';').map(x => x.trim()).filter(Boolean);
}

function _qaColumnCell(row, column) {
  const names = [column?.name, ...(column?.aliases || [])].filter(Boolean);
  for (const name of names) {
    const value = _qaCell(row, name);
    if (value) return value;
  }
  return '';
}

function _qaRowIdentity(sheetName, row) {
  const sheets = _qaParseSchema().sheets || [];
  const descriptor = sheets.find(sheet => _qaNorm(sheet.name) === _qaNorm(sheetName));
  const referencedIdentity = sheets.flatMap(sheet => sheet.references || [])
    .find(reference => _qaNorm(reference.targetSheet) === _qaNorm(sheetName))?.targetColumn;
  const identityField = descriptor?.identityField ||
    descriptor?.uniqueRules?.find(rule => rule.keys.length === 1)?.keys[0] || referencedIdentity || 'Name';
  return _qaCell(row, identityField);
}

function _qaRowsForSheet(sheetName, inScope) {
  const descriptor = (_qaParseSchema().sheets || []).find(sheet => _qaNorm(sheet.name) === _qaNorm(sheetName));
  const type = _qaNorm(descriptor?.name || sheetName);
  const bucket = descriptor?.bucket || (type === 'facility' ? 'facilities' : type === 'category' ? 'categories' : `${type}s`);
  return (db[bucket] || []).filter(inScope);
}

function setQaFilterScope(components, documentContexts) {
  const filterActive = !!searchQuery || Object.values(sel).some(selection => selection.size);
  if (!filterActive) {
    _qaFilterScope = null;
    return;
  }

  const rows = Array.isArray(components) ? components : [];
  const documents = (documentContexts || []).map(context => context.doc).filter(Boolean);
  const keys = dimension => new Set();
  const typeKeys = keys('type');
  const spaceKeys = keys('space');
  const systemKeys = keys('system');
  const floorKeys = keys('floor');
  rows.forEach(row => {
    const facility = _qaNorm(row._facility);
    const componentName = _qaNorm(_qaCell(row, 'Name'));
    const typeName = _qaNorm(_qaCell(row, 'TypeName'));
    const spaceName = _qaNorm(_qaCell(row, 'Space'));
    if (typeName) typeKeys.add(`${facility}::${typeName}`);
    if (spaceName) {
      spaceKeys.add(`${facility}::${spaceName}`);
      const floorName = _qaNorm(idx.spFloor?.[_scopeKey(facility, spaceName)]);
      if (floorName) floorKeys.add(`${facility}::${floorName}`);
    }
    (idx.compSys?.[_scopeKey(facility, componentName)] || []).forEach(name => {
      systemKeys.add(`${facility}::${_qaNorm(name)}`);
    });
  });

  _qaFilterScope = {
    componentRows: new Set(rows),
    documentRows: new Set(documents),
    typeKeys, spaceKeys, systemKeys, floorKeys,
  };
}

function _qaRowMatchesFilterScope(sheetName, row) {
  if (!_qaFilterScope) return true;
  const sheet = _qaNorm(sheetName);
  if (sheet === 'component') return _qaFilterScope.componentRows.has(row);
  if (sheet === 'document') return _qaFilterScope.documentRows.has(row);
  const key = `${_qaNorm(row._facility)}::${_qaNorm(_qaCell(row, 'Name'))}`;
  if (sheet === 'type') return _qaFilterScope.typeKeys.has(key);
  if (sheet === 'space') return _qaFilterScope.spaceKeys.has(key);
  if (sheet === 'system') return _qaFilterScope.systemKeys.has(key);
  if (sheet === 'floor') return _qaFilterScope.floorKeys.has(key);
  return true;
}

function _qaCheckMeta(check, patch) {
  if (!QA_CHECKS[check]) {
    QA_CHECKS[check] = {
      label: patch.label || check,
      sev: patch.sev || 'error',
      sheet: patch.sheet || 'Multiple',
      ico: patch.ico || QA_CHECK_ICON_BY_SHEET[_qaNorm(patch.sheet || 'multiple')] || 'bi-list-check',
    };
    return;
  }
  QA_CHECKS[check].label = patch.label || QA_CHECKS[check].label;
  QA_CHECKS[check].sev = patch.sev || QA_CHECKS[check].sev;
  QA_CHECKS[check].sheet = patch.sheet || QA_CHECKS[check].sheet;
  QA_CHECKS[check].ico = patch.ico || QA_CHECKS[check].ico;
}

function _qaAttr(node, name) {
  return node?.getAttribute?.(name) || '';
}

function _qaSeverity(value, fallback = 'error') {
  const sev = _qaNorm(value);
  return sev === 'error' || sev === 'warning' || sev === 'info' ? sev : fallback;
}

function _qaNamedCheckSeverity(checkName, explicitSeverity = '', schemaObj = null, column = null) {
  if (explicitSeverity) return _qaSeverity(explicitSeverity, 'warning');
  const schema = schemaObj || _qaParseSchema();
  if (_qaNorm(checkName) === 'format' && column?.formatName) {
    const formatCriticality = schema?.formatCriticalities?.[column.formatName] || '';
    if (formatCriticality) return _qaSeverity(formatCriticality, 'warning');
  }
  const criticality = schema?.ruleCriticalities?.[_qaNorm(checkName)] || '';
  if (criticality) return _qaSeverity(criticality, 'warning');
  if (_qaNorm(checkName) === 'notempty') return 'info';
  return 'warning';
}

function _qaIssueType(value, fallback = '') {
  const t = _qaNorm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || fallback;
}

function _qaStages(value) {
  return String(value || '').split('|').map(_qaNorm).filter(Boolean);
}

function _qaStage(value, fallback = '') {
  const stage = _qaNorm(value || fallback);
  return QA_STAGE_ORDER.includes(stage) ? stage : '';
}

function _qaStageIncluded(stage, selectedStage = qaSelectedStage) {
  const ruleIndex = QA_STAGE_ORDER.indexOf(_qaStage(stage, 'design'));
  const selectedIndex = QA_STAGE_ORDER.indexOf(_qaStage(selectedStage, 'operation'));
  return ruleIndex >= 0 && ruleIndex <= selectedIndex;
}

function _qaSheetForStage(sheet, selectedStage = qaSelectedStage) {
  if (!sheet || !_qaStageIncluded(sheet.stage, selectedStage)) return null;
  return {
    ...sheet,
    columns:(sheet.columns || []).filter(rule => _qaStageIncluded(rule.stage, selectedStage)),
    references:(sheet.references || []).filter(rule => _qaStageIncluded(rule.stage, selectedStage)),
    uniqueRules:(sheet.uniqueRules || []).filter(rule => _qaStageIncluded(rule.stage, selectedStage)),
    relationRules:(sheet.relationRules || []).filter(rule => _qaStageIncluded(rule.stage, selectedStage)),
  };
}

function _qaSchemaOrderComparator(schema = _qaParseSchema()) {
  const sheets = schema?.sheets || [];
  const sheetOrder = new Map(sheets.map((sheet, index) => [_qaNorm(sheet.name), index]));
  const columnOrder = new Map(sheets.map(sheet => [
    _qaNorm(sheet.name),
    new Map((sheet.columns || []).map((column, index) => [_qaNormKey(column.name), index])),
  ]));
  const position = item => {
    const sheet = _qaNorm(item?.sheet || item?.entityType);
    const field = item?.column || item?.fields?.[0] || '';
    const firstField = String(field).split(/\s*\+\s*/)[0];
    const key = _qaNormKey(firstField);
    const index = key ? columnOrder.get(sheet)?.get(key) : undefined;
    // Sheet-level results carry the 'Sheet' pseudo-column and lead their worksheet.
    const sheetLevel = !key || (index === undefined && key === _qaNormKey('Sheet'));
    return {
      sheet:sheetOrder.get(sheet) ?? Number.MAX_SAFE_INTEGER,
      column:sheetLevel ? -1 : (index ?? Number.MAX_SAFE_INTEGER),
    };
  };
  return (left, right) => {
    const leftPosition = position(left);
    const rightPosition = position(right);
    return leftPosition.sheet - rightPosition.sheet || leftPosition.column - rightPosition.column;
  };
}

function _qaApplyStageFilter() {
  const compareSchemaOrder = _qaSchemaOrderComparator();
  qaFindings = qaAllFindings.filter(finding => _qaStageIncluded(finding.stage)).sort(compareSchemaOrder);
  qaRuleResults = qaAllRuleResults.filter(result => _qaStageIncluded(result.stage)).sort(compareSchemaOrder);
}

function _qaIssueLabel(issueType) {
  if (!issueType) return '';
  return issueType.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function _qaResolveIcon({ icon = '', issueType = '', sheet = '' } = {}) {
  const entityIcon = typeof _cobieEntityUi === 'function' ? _cobieEntityUi(sheet).icon : '';
  return icon
    || QA_CHECK_ICON_BY_ISSUE_TYPE[_qaIssueType(issueType)]
    || entityIcon
    || QA_CHECK_ICON_BY_SHEET[_qaNorm(sheet)]
    || QA_CHECK_ICON_BY_SHEET.multiple;
}

function _qaCheckId(baseCheck, issueType) {
  if (String(baseCheck || '').includes('.')) return baseCheck;
  const t = _qaIssueType(issueType);
  return t ? `${baseCheck}:${t}` : baseCheck;
}

function _qaEnsureCheckMeta(baseCheck, cfg) {
  const check = _qaCheckId(baseCheck, cfg.issueType);
  const issueLabel = _qaIssueLabel(cfg.issueType);
  const label = String(baseCheck || '').includes('.')
    ? (cfg.label || baseCheck)
    : (issueLabel ? `${cfg.label} (${issueLabel})` : cfg.label);
  _qaCheckMeta(check, {
    label,
    sev: cfg.sev,
    sheet: cfg.sheet,
    ico: _qaResolveIcon({ icon: cfg.icon, issueType: cfg.issueType, sheet: cfg.sheet }),
  });
  return check;
}

function _qaSchemaError(message) {
  return {
    error: message,
    formats: {},
    formatDescriptions: {},
    formatCriticalities: {},
    sheets: [],
    ruleDefinitions: Object.create(null),
    ruleCriticalities: Object.create(null),
    checkSeverities: Object.create(null),
    checkSeverityByField: Object.create(null),
  };
}

function _qaNamedRuleDescription(ruleName, schemaObj = null) {
  const schema = schemaObj || _qaParseSchema();
  const key = _qaNorm(ruleName);
  return String(schema?.ruleDefinitions?.[key] || '').trim();
}

function _qaColumnCheckDescription(checkName, column, schemaObj = null) {
  const schema = schemaObj || _qaParseSchema();
  if (checkName === 'Format' && column?.formatName) {
    const description = String(schema?.formatDescriptions?.[column.formatName] || '').trim();
    if (description) return description;
  }
  return _qaNamedRuleDescription(checkName, schema);
}

function _qaRuleDescriptionForCheck(checkId, schemaObj = null) {
  const schema = schemaObj || _qaParseSchema();
  const parts = String(checkId || '').split('.').map(part => String(part || '').trim()).filter(Boolean);
  if (_qaNorm(parts.at(-1)) === 'format' && parts.length >= 3) {
    const sheet = (schema?.sheets || []).find(item => _qaNorm(item.name) === _qaNorm(parts[0]));
    const column = (sheet?.columns || []).find(item => _qaNorm(item.name) === _qaNorm(parts.slice(1, -1).join('.')));
    const description = String(schema?.formatDescriptions?.[column?.formatName] || '').trim();
    if (description) return description;
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const desc = _qaNamedRuleDescription(parts[index], schema);
    if (desc) return desc;
  }
  return '';
}

function _qaParseSchema() {
  if (_qaSchemaCache) return _qaSchemaCache;

  const xml = _cobieSchemaDocument();
  if (!xml) {
    _qaSchemaCache = _qaSchemaError(`${COBIE_SCHEMA_STATUS.error || 'The current QA XML profile could not be loaded.'} No fallback rules were applied.`);
    return _qaSchemaCache;
  }
  const root = xml.documentElement;
  if (_qaNormKey(root?.localName || root?.nodeName) !== 'cobieworkbookspecification') {
    _qaSchemaCache = _qaSchemaError('The QA XML root must be cobieWorkbookSpecification. No fallback rules were applied.');
    return _qaSchemaCache;
  }
  const profile = _qaAttr(root, 'profile');
  const version = _qaAttr(root, 'version');

  const formats = {};
  const formatDescriptions = {};
  const formatCriticalities = {};
  _qaChildren(_qaDirectChild(root, 'formats'), 'format').forEach(fx => {
    const name = _qaAttr(fx, 'name');
    const regex = _qaAttr(fx, 'regex');
    if (!name || !regex) return;
    try {
      formats[name] = new RegExp(regex);
      formatDescriptions[name] = String(fx.textContent || '').trim();
      const criticality = _qaSeverity(_qaAttr(fx, 'criticality') || _qaAttr(fx, 'criticallity'), '');
      if (criticality) formatCriticalities[name] = criticality;
    } catch (_) {
      // Ignore invalid regex definitions.
    }
  });

  const ruleDefinitions = Object.create(null);
  const ruleCriticalities = Object.create(null);
  _qaChildren(_qaDirectChild(root, 'ruleDefinitions'), 'rule').forEach(rule => {
    const name = _qaNorm(_qaAttr(rule, 'name'));
    const text = String(rule.textContent || '').trim();
    if (!name || !text) return;
    ruleDefinitions[name] = text;
    const sev = _qaSeverity(_qaAttr(rule, 'criticality') || _qaAttr(rule, 'criticallity') || _qaAttr(rule, 'severity'), '');
    if (sev) ruleCriticalities[name] = sev;
  });

  const sheets = [];
  const checkSeverities = Object.create(null);
  const checkSeverityByField = Object.create(null);
  const invalidReferences = [];

  _qaChildren(_qaDirectChild(root, 'globalRules'), 'rule').forEach(rule => {
    const sev = _qaSeverity(_qaAttr(rule, 'severity'), '');
    if (!sev) return;
    const type = _qaNorm(_qaAttr(rule, 'type'));
    const desc = _qaNorm(rule.textContent || _qaAttr(rule, 'description'));
    if (type === 'column' && desc.includes('createdon') && (desc.includes('iso date') || desc.includes('iso datetime') || desc.includes('format'))) {
      if (!checkSeverityByField['format-invalid']) checkSeverityByField['format-invalid'] = Object.create(null);
      checkSeverityByField['format-invalid'][_qaNormKey('CreatedOn')] = sev;
    }
  });

  _qaChildren(_qaDirectChild(root, 'sheets'), 'sheet').forEach(sheetNode => {
    const validation = _qaDirectChild(sheetNode, 'validation') || sheetNode;
    const sheetStages = _qaStages(_qaAttr(validation, 'stage'));
    const inheritedStage = sheetStages.length === 1 ? _qaStage(sheetStages[0], 'design') : '';
    const sheet = {
      name: _qaAttr(sheetNode, 'name'),
      bucket:_qaAttr(sheetNode, 'bucket'),
      identityField:_qaAttr(sheetNode, 'identityField'),
      stages:sheetStages,
      stage:inheritedStage || _qaStage(sheetStages[0], 'design'),
      required: _qaNorm(_qaAttr(validation, 'required')) === 'true',
      requiredSeverity: _qaSeverity(_qaAttr(validation, 'requiredSeverity') || _qaAttr(validation, 'severity'), 'error'),
      requiredIssueType: _qaIssueType(_qaAttr(validation, 'requiredIssueType'), 'scope'),
      requiredIcon: _qaAttr(validation, 'requiredIcon'),
      formatSeverity: _qaSeverity(_qaAttr(validation, 'formatSeverity'), 'error'),
      formatIssueType: _qaIssueType(_qaAttr(validation, 'formatIssueType'), 'format'),
      formatIcon: _qaAttr(validation, 'formatIcon'),
      uniqueSeverity: _qaSeverity(_qaAttr(validation, 'uniqueSeverity'), 'error'),
      uniqueIssueType: _qaIssueType(_qaAttr(validation, 'uniqueIssueType'), 'uniqueness'),
      uniqueIcon: _qaAttr(validation, 'uniqueIcon'),
      referenceSeverity: _qaSeverity(_qaAttr(validation, 'referenceSeverity'), 'error'),
      referenceIssueType: _qaIssueType(_qaAttr(validation, 'referenceIssueType'), 'reference'),
      referenceIcon: _qaAttr(validation, 'referenceIcon'),
      primaryKey: _qaAttr(validation, 'primaryKey'),
      presenceRule: _qaAttr(validation, 'presenceRule'),
      singleRowRule: _qaAttr(validation, 'singleRowRule'),
      columns: [],
      references: [],
      uniqueRules: [],
      relationRules: [],
    };

    _qaChildren(_qaDirectChild(sheetNode, 'columns'), 'column').forEach(col => {
      const qa = _qaDirectChild(col, 'qa');
      const qaAttr = name => _qaAttr(qa, name) || _qaAttr(col, name);
      const nestedChecks = [...(qa?.children || [])]
        .filter(child => _qaNormKey(child.localName || child.nodeName) === 'rule')
        .flatMap(rule => _qaAttr(rule, 'name').split('|'));
      const allChecks = [..._qaAttr(col, 'checks').split('|'), ...nestedChecks]
        .map(value => value.trim()).filter(Boolean);
      const format = _qaDirectChild(qa, 'format') || _qaDirectChild(col, 'format');
      const unique = _qaDirectChild(qa, 'unique') || _qaDirectChild(col, 'unique');
      const hasUnique = !!unique || allChecks.includes('Unique');
      const reference = _qaDirectChild(qa, 'reference') || _qaDirectChild(col, 'reference');
      const hasReference = !!reference || allChecks.includes('Reference') || allChecks.includes('CrossReference');
      if (hasReference && (!reference || !_qaAttr(reference, 'targetSheet') || !_qaAttr(reference, 'targetColumn'))) {
        invalidReferences.push(`${_qaAttr(sheetNode, 'name')}.${_qaAttr(col, 'name')}`);
      }
      const scalarChecks = allChecks.filter(check => !['Unique', 'Reference', 'CrossReference'].includes(check));
      if (format && !scalarChecks.includes('Format')) scalarChecks.push('Format');
      const stage = _qaStage(qaAttr('stage'), inheritedStage || 'design');
      const column = {
        name: _qaAttr(col, 'name'),
        colorToken: _qaAttr(_qaDirectChild(col, 'ui'), 'colorToken'),
        required: _qaNorm(qaAttr('required')) === 'true',
        unique: _qaNorm(qaAttr('unique')) === 'true',
        severity: _qaSeverity(qaAttr('severity'), ''),
        issueType: _qaIssueType(qaAttr('issueType'), ''),
        icon: qaAttr('icon'),
        formatName: _qaAttr(format, 'name'),
        formatRef: qaAttr('formatRef'),
        allowAlternateFormatRef: qaAttr('allowAlternateFormatRef'),
        aliases: (_qaAttr(_qaDirectChild(col, 'runtime'), 'aliases') || _qaAttr(col, 'aliases'))
          .split('|').map(value => value.trim()).filter(Boolean),
        checks:scalarChecks,
        stage,
      };
      sheet.columns.push(column);
      if (hasUnique) {
        sheet.uniqueRules.push({
          ruleId:_qaAttr(unique, 'ruleId') || `${sheet.name}.${column.name}.Unique`,
          keys:(_qaAttr(unique, 'keys') || column.name).split('|').map(value => value.trim()).filter(Boolean),
          severity:_qaSeverity(_qaAttr(unique, 'severity') || _qaAttr(col, 'severity'), 'error'),
          stage,
        });
      }
      if (hasReference && reference) {
        sheet.references.push({
          column:column.name,
          targetSheet:_qaAttr(reference, 'targetSheet'),
          targetColumn:_qaAttr(reference, 'targetColumn'),
          required:_qaNorm(_qaAttr(reference, 'required')) === 'true',
          severity:_qaSeverity(_qaAttr(reference, 'severity') || _qaAttr(col, 'severity'), ''),
          issueType:_qaIssueType(_qaAttr(reference, 'issueType') || _qaAttr(col, 'issueType'), ''),
          icon:_qaAttr(reference, 'icon') || _qaAttr(col, 'icon'),
          multiValueDelimiter:_qaAttr(reference, 'multiValueDelimiter') || ';',
          ruleId:_qaAttr(reference, 'ruleId') || `${sheet.name}.${column.name}.Reference`,
          stage,
        });
      }
    });

    _qaChildren(_qaDirectChild(sheetNode, 'relationRules'), 'relation').forEach(rule => {
      sheet.relationRules.push({
        ruleId: _qaAttr(rule, 'ruleId'),
        type: _qaAttr(rule, 'type'),
        targetSheet: _qaAttr(rule, 'targetSheet'),
        targetColumn: _qaAttr(rule, 'targetColumn'),
        severity: _qaSeverity(_qaAttr(rule, 'severity'), 'error'),
        stage:_qaStage(_qaAttr(rule, 'stage'), inheritedStage || 'design'),
      });
    });

    sheets.push(sheet);
  });

  const unsupportedChecks = [...new Set(sheets.flatMap(sheet =>
    sheet.columns.flatMap(column => column.checks || [])
  ).filter(check => !QA_NAMED_CHECK_HANDLERS[check]))];
  const unsupportedRelations = [...new Set(sheets.flatMap(sheet =>
    sheet.relationRules.map(rule => rule.type)
  ).filter(type => !QA_RELATION_RULE_HANDLERS[type]))];
  const invalidFormats = sheets.flatMap(sheet => sheet.columns
    .filter(column => column.checks.includes('Format') && !formats[column.formatName])
    .map(column => `${sheet.name}.${column.name}:${column.formatName || '(missing)'}`));
  const invalidStages = [...new Set(sheets.flatMap(sheet => [
    ...sheet.stages.filter(stage => !QA_STAGE_ORDER.includes(stage)),
    ...sheet.columns.map(rule => rule.stage),
    ...sheet.references.map(rule => rule.stage),
    ...sheet.uniqueRules.map(rule => rule.stage),
    ...sheet.relationRules.map(rule => rule.stage),
  ].filter(stage => !QA_STAGE_ORDER.includes(stage))))];
  if (unsupportedChecks.length || unsupportedRelations.length || invalidFormats.length || invalidStages.length || invalidReferences.length) {
    const details = [
      unsupportedChecks.length ? `checks: ${unsupportedChecks.join(', ')}` : '',
      unsupportedRelations.length ? `relation types: ${unsupportedRelations.join(', ')}` : '',
      invalidFormats.length ? `formats: ${invalidFormats.join(', ')}` : '',
      invalidStages.length ? `stages: ${invalidStages.join(', ')}` : '',
      invalidReferences.length ? `references without targetSheet/targetColumn: ${invalidReferences.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    _qaSchemaCache = _qaSchemaError(`The current QA XML profile uses unsupported ${details}. No rules were applied.`);
    return _qaSchemaCache;
  }

  _qaSchemaCache = { error:'', profile, version, formats, formatDescriptions, formatCriticalities, sheets, ruleDefinitions, ruleCriticalities, checkSeverities, checkSeverityByField };
  return _qaSchemaCache;
}

function _qaNamedCheckResult(checkName, value, schema, column = null) {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase();
  const isNA = normalized === 'n/a';
  const isNumber = text !== '' && Number.isFinite(Number(text.replace(/,/g, '')));
  const number = isNumber ? Number(text.replace(/,/g, '')) : NaN;
  const handler = QA_NAMED_CHECK_HANDLERS[checkName];
  return handler ? handler({ text, normalized, isNA, isNumber, number, schema, formatName:column?.formatName || '' }) : false;
}

function _qaLogicalFacilityRows() {
  const representatives = new Map();
  (db.facilities || []).forEach(row => {
    const key = String(row._facilityIdentifier || row._facility || '').trim().toLowerCase();
    if (key && !representatives.has(key)) representatives.set(key, row);
  });
  return [...representatives.values()];
}

function* _qaRunSteps(selectedStage = qaSelectedStage) {
  _qaCellCache = new WeakMap();
  const facSel = sel.facility;
  const inScope = r => !facSel.size || facSel.has((r._facility || '').toLowerCase());
  const scopedCount = sheetName => _qaRowsForSheet(
    sheetName,
    row => inScope(row) && _qaRowMatchesFilterScope(sheetName, row),
  ).length;
  qaScopeCounts = {
    comps: scopedCount('Component'),
    spaces: scopedCount('Space'),
    types: scopedCount('Type'),
    docs: scopedCount('Document'),
  };

  const schema = _qaParseSchema();
  const stageSheets = (schema.sheets || []).map(sheet => _qaSheetForStage(sheet, selectedStage)).filter(Boolean);
  const totalSteps = stageSheets.reduce((total, sheet) => total
    + 1
    + (sheet.columns || []).length
    + ((sheet.uniqueRules || []).length ? 1 : 0)
    + ((sheet.references || []).length ? 1 : 0)
    + ((sheet.relationRules || []).length ? 1 : 0), 0);
  let completedSteps = 0;
  let activeRuleStage = 'design';
  const ruleCounts = new Map();
  const recordRule = (check, passed, sheet = 'Workbook', column = 'Sheet', stage = activeRuleStage) => {
    const normalizedStage = _qaStage(stage, 'design');
    const key = `${_qaNorm(sheet)}|${_qaNormKey(column)}|${check}|${normalizedStage}`;
    if (!ruleCounts.has(key)) ruleCounts.set(key, { check, sheet, column, stage:normalizedStage, pass:0, fail:0 });
    ruleCounts.get(key)[passed ? 'pass' : 'fail']++;
  };
  const publishRuleResults = () => {
    qaRuleResults = [...ruleCounts.values()].map(result => ({
      ...result,
      colorToken: schema.sheets
        .find(sheet => _qaNorm(sheet.name) === _qaNorm(result.sheet))?.columns
        .find(column => _qaNormKey(column.name) === _qaNormKey(result.column))?.colorToken || '',
      label: QA_CHECKS[result.check]?.label || result.check,
    }));
  };
  const resolveSeverity = (check, fallback = 'error', field = '') => {
    const byField = schema?.checkSeverityByField?.[check];
    const key = _qaNormKey(field);
    if (byField && key && byField[key]) return _qaSeverity(byField[key], fallback);
    const byCheck = schema?.checkSeverities?.[check];
    if (byCheck) return _qaSeverity(byCheck, fallback);
    return _qaSeverity(fallback, QA_CHECKS[check]?.sev || 'error');
  };
  const out = [];
  const add = (cfg) => {
    const check = _qaEnsureCheckMeta(cfg.check, cfg);
    out.push({
      check,
      sev: cfg.sev || QA_CHECKS[check]?.sev || QA_CHECKS[cfg.check]?.sev,
      entityType: cfg.entityType || 'sheet',
      entityName: cfg.entityName || (cfg.sheet ? cfg.sheet + ' sheet' : 'Workbook'),
      facility: cfg.facility || '',
      detail: cfg.detail || '',
      fields: Array.isArray(cfg.fields) ? cfg.fields.filter(Boolean) : [],
      issueType: _qaIssueType(cfg.issueType),
      stage: _qaStage(cfg.stage, activeRuleStage || 'design'),
    });
  };

  if (schema.error) {
    recordRule('schema-missing', false, 'Schema', 'Schema');
    add({
      check: 'schema-missing',
      sev: 'error',
      sheet: 'Schema',
      entityType: 'sheet',
      entityName: 'QA schema',
      detail: schema.error,
      label: 'QA schema could not be loaded',
    });
    publishRuleResults();
    return out;
  }

  const targetSetCache = new Map();
  const getTargetSet = (sheetName, columnName, facL) => {
    const k = `${_qaNorm(sheetName)}|${_qaNorm(columnName)}|${facL}`;
    if (targetSetCache.has(k)) return targetSetCache.get(k);
    const set = new Set();
    _qaRowsForSheet(sheetName, row => {
      return (row._facility || '').toLowerCase() === facL;
    }).forEach(row => {
      const v = _qaCell(row, columnName);
      if (v) set.add(v.toLowerCase());
    });
    targetSetCache.set(k, set);
    return set;
  };
  const workbookScopes = _qaLogicalFacilityRows().filter(inScope).map(facility => ({
    facility: String(facility._facility || ''),
    label: String(facility._facility || facility._fileName || 'Loaded facility'),
    facilityRow: facility,
  }));
  const rowsInWorkbook = (rows, scope) => rows.filter(row => {
    if (!scope.facility) return true;
    return _qaNorm(row._facility) === _qaNorm(scope.facility);
  });

  for (const sheetRule of stageSheets) {
    activeRuleStage = _qaStage(sheetRule.stage, 'design');
    yield { completed:completedSteps, total:totalSteps, sheet:sheetRule.name, status:`Preparing ${sheetRule.name} worksheet` };
    const sheetRows = _qaRowsForSheet(sheetRule.name, inScope);
    const rows = _qaRowsForSheet(sheetRule.name, row => inScope(row) && _qaRowMatchesFilterScope(sheetRule.name, row));
    const sheetPresent = sheetRows.length > 0;

    if (sheetRule.presenceRule) {
      const scopes = workbookScopes.length ? workbookScopes : [{ label:'Current workbook', fileName:'', facility:'' }];
      scopes.forEach(scope => {
        const passed = rowsInWorkbook(sheetRows, scope).length > 0;
        recordRule(sheetRule.presenceRule, passed, sheetRule.name, 'Sheet');
        if (passed) return;
        const ruleDescription = _qaRuleDescriptionForCheck(sheetRule.presenceRule, schema);
        add({
          check: sheetRule.presenceRule,
          sev: 'error',
          sheet: sheetRule.name,
          issueType: 'scope',
          entityType: 'sheet',
          entityName: `${sheetRule.name} sheet`,
          facility: scope.facility,
          detail: `${sheetRule.name}: ${ruleDescription || sheetRule.presenceRule} Scope: ${scope.label}.`,
          label: `${sheetRule.name}.${sheetRule.presenceRule.split('.').pop()}`,
        });
      });
    }

    if (sheetRule.singleRowRule) {
      const scopes = workbookScopes.length ? workbookScopes : rows.map(row => ({ facilityRow:row, label:row._fileName || row._facility || 'Current workbook' }));
      scopes.forEach(scope => {
        const sourceFacilities = (db.facilities || []).filter(row => _qaNorm(row._facility) === _qaNorm(scope.facility));
        const count = Math.max(0, ...sourceFacilities.map(row => Number(row._facRowCount) || 0));
        const passed = count === 1;
        recordRule(sheetRule.singleRowRule, passed, sheetRule.name, 'Sheet');
        if (passed) return;
        const ruleDescription = _qaRuleDescriptionForCheck(sheetRule.singleRowRule, schema);
        add({
          check: sheetRule.singleRowRule,
          sev: 'error',
          sheet: sheetRule.name,
          issueType: 'scope',
          entityType: 'sheet',
          entityName: `${sheetRule.name} sheet`,
          facility: scope.facility,
          detail: `${sheetRule.name}: ${ruleDescription || sheetRule.singleRowRule} Scope: ${scope.label}; found ${count}.`,
          label: `${sheetRule.name}.${sheetRule.singleRowRule.split('.').pop()}`,
        });
      });
    }

    if (!sheetRule.presenceRule && !sheetRule.singleRowRule && sheetRule.required) recordRule('sheet-required-missing', sheetPresent, sheetRule.name, 'Sheet');
    if (!sheetRule.presenceRule && !sheetRule.singleRowRule && sheetRule.required && !sheetPresent) {
      add({
        check: 'sheet-required-missing',
        sev: resolveSeverity('sheet-required-missing', sheetRule.requiredSeverity || 'error'),
        sheet: sheetRule.name,
        issueType: sheetRule.requiredIssueType || 'scope',
        icon: sheetRule.requiredIcon,
        entityType: 'sheet',
        entityName: sheetRule.name + ' sheet',
        detail: `${sheetRule.name} sheet is required by schema but missing or empty in current scope.`,
        label: 'Required COBie sheet is missing or empty',
      });
    }
    completedSteps++;

    for (const col of sheetRule.columns) {
      activeRuleStage = _qaStage(col.stage, sheetRule.stage || 'design');
      yield { completed:completedSteps, total:totalSteps, sheet:sheetRule.name, column:col.name, status:`Checking ${sheetRule.name}.${col.name}` };
      if (!col.name) {
        completedSteps++;
        continue;
      }

      if (col.checks?.length) {
        rows.forEach(row => {
          const value = _qaColumnCell(row, col);
          col.checks.forEach(checkName => {
            const ruleId = `${sheetRule.name}.${col.name}.${checkName}`;
            const passed = _qaNamedCheckResult(checkName, value, schema, col);
            recordRule(ruleId, passed, sheetRule.name, col.name);
            if (passed) return;
            const ruleWording = _qaColumnCheckDescription(checkName, col, schema);
            add({
              check: ruleId,
              sev: _qaNamedCheckSeverity(checkName, col.severity, schema, col),
              sheet: sheetRule.name,
              issueType: checkName === 'Format' || checkName === 'Valid' ? 'format' : 'completeness',
              entityType: _qaNorm(sheetRule.name),
              entityName: _qaRowIdentity(sheetRule.name, row) || '(Unnamed row)',
              facility: row._facility || '',
              detail: `${col.name}: ${ruleWording || checkName}. Value was ${value ? `"${value}"` : 'empty'}.`,
              fields: [col.name],
              label: `${sheetRule.name}.${col.name}.${checkName}`,
            });
          });
        });
        completedSteps++;
        continue;
      }

      if (col.required) {
        rows.forEach(row => {
          const v = _qaCell(row, col.name);
          recordRule('required-missing', !!v, sheetRule.name, col.name);
          if (v) return;
          add({
            check: 'required-missing',
            sev: resolveSeverity('required-missing', col.severity || 'warning', col.name),
            sheet: sheetRule.name,
            issueType: col.issueType || 'completeness',
            icon: col.icon,
            entityType: _qaNorm(sheetRule.name),
            entityName: _qaRowIdentity(sheetRule.name, row) || '(Unnamed row)',
            facility: row._facility || '',
            detail: `Required column ${col.name} is blank.`,
            fields: [col.name],
            label: 'Required column value is missing',
          });
        });
      }

      if (col.formatRef && schema.formats[col.formatRef]) {
        const mainRx = schema.formats[col.formatRef];
        const altRx = col.allowAlternateFormatRef ? schema.formats[col.allowAlternateFormatRef] : null;
        rows.forEach(row => {
          const v = _qaCell(row, col.name);
          if (!v) return;
          mainRx.lastIndex = 0;
          if (altRx) altRx.lastIndex = 0;
          const valid = mainRx.test(v) || !!(altRx && altRx.test(v));
          recordRule('format-invalid', valid, sheetRule.name, col.name);
          if (valid) return;
          add({
            check: 'format-invalid',
            sev: resolveSeverity('format-invalid', col.severity || sheetRule.formatSeverity || 'warning', col.name),
            sheet: sheetRule.name,
            issueType: col.issueType || sheetRule.formatIssueType || 'format',
            icon: col.icon || sheetRule.formatIcon,
            entityType: _qaNorm(sheetRule.name),
            entityName: _qaRowIdentity(sheetRule.name, row) || '(Unnamed row)',
            facility: row._facility || '',
            detail: `Column ${col.name} value "${v}" does not match ${col.formatRef}${altRx ? ` or ${col.allowAlternateFormatRef}` : ''}.`,
            fields: [col.name],
            label: 'Column value has invalid format',
          });
        });
      }
      completedSteps++;
    }

    if (sheetRule.uniqueRules?.length) {
      yield { completed:completedSteps, total:totalSteps, sheet:sheetRule.name, status:`Checking ${sheetRule.name} uniqueness` };
    }
    (sheetRule.uniqueRules || []).forEach(rule => {
      activeRuleStage = _qaStage(rule.stage, sheetRule.stage || 'design');
      const seen = new Map();
      rows.forEach(row => {
        const values = rule.keys.map(key => _qaCell(row, key));
        if (values.every(value => !value)) return;
        const worksheet = _qaNorm(row._fileName || row._facility);
        const key = `${worksheet}::${values.map(_qaNorm).join('|')}`;
        const existing = seen.get(key);
        if (existing) existing.count++;
        else seen.set(key, { row, values, count:1 });
      });
      seen.forEach(entry => {
        const passed = entry.count === 1;
        recordRule(rule.ruleId, passed, sheetRule.name, rule.keys.join(' + '));
        if (passed) return;
        const ruleDescription = _qaRuleDescriptionForCheck(rule.ruleId, schema);
        add({
          check: rule.ruleId,
          sev: rule.severity,
          sheet: sheetRule.name,
          issueType: 'uniqueness',
          entityType: _qaNorm(sheetRule.name),
          entityName: _qaRowIdentity(sheetRule.name, entry.row) || '(Unnamed row)',
          facility: entry.row._facility || '',
          detail: `${entry.count} rows share worksheet key [${rule.keys.join(', ')}] = "${entry.values.join(' | ')}".`,
          fields: rule.keys,
          label: ruleDescription || rule.ruleId,
        });
      });
    });
    if (sheetRule.uniqueRules?.length) completedSteps++;

    const uniqueKeys = [];
    sheetRule.columns.forEach(col => { if (col.unique) uniqueKeys.push(col.name); });
    if (sheetRule.primaryKey) {
      sheetRule.primaryKey.split('|').map(x => x.trim()).filter(Boolean).forEach(k => {
        if (!uniqueKeys.includes(k)) uniqueKeys.push(k);
      });
    }

    if (!sheetRule.uniqueRules?.length && uniqueKeys.length) {
      activeRuleStage = _qaStage(sheetRule.stage, 'design');
      const seen = new Map();
      rows.forEach(row => {
        const fac = (row._facility || '').toLowerCase();
        const vals = uniqueKeys.map(k => _qaCell(row, k));
        if (vals.every(v => !v)) return;
        const key = fac + '::' + vals.map(v => v.toLowerCase()).join('|');
        if (!seen.has(key)) {
          seen.set(key, { row, count: 1, vals });
          return;
        }
        const rec = seen.get(key);
        rec.count++;
      });
      seen.forEach(rec => {
        recordRule('unique-duplicate', rec.count < 2, sheetRule.name, uniqueKeys.join(' + '));
        if (rec.count < 2) return;
        add({
          check: 'unique-duplicate',
          sev: resolveSeverity('unique-duplicate', sheetRule.uniqueSeverity || 'error', uniqueKeys[0] || ''),
          sheet: sheetRule.name,
          issueType: sheetRule.uniqueIssueType || 'uniqueness',
          icon: sheetRule.uniqueIcon,
          entityType: _qaNorm(sheetRule.name),
          entityName: _qaRowIdentity(sheetRule.name, rec.row) || '(Unnamed row)',
          facility: rec.row._facility || '',
          detail: `${sheetRule.name} has ${rec.count} rows with same key [${uniqueKeys.join(', ')}] = "${rec.vals.join(' | ')}".`,
          fields: uniqueKeys,
          label: 'Duplicate value in unique key column(s)',
        });
      });
    }

    if (sheetRule.references?.length) {
      yield { completed:completedSteps, total:totalSteps, sheet:sheetRule.name, status:`Resolving ${sheetRule.name} cross-references` };
    }
    sheetRule.references.forEach(ref => {
      activeRuleStage = _qaStage(ref.stage, sheetRule.stage || 'design');
      if (!ref.column || !ref.targetSheet || !ref.targetColumn) return;

      rows.forEach(row => {
        const facL = (row._facility || '').toLowerCase();
        const vals = _qaCellSplit(row, ref.column, ref.multiValueDelimiter);

        if (!vals.length) {
          if (!ref.required) return;
          const checkId = ref.ruleId || 'reference-missing';
          recordRule(checkId, false, sheetRule.name, ref.column);
          add({
            check: checkId,
            sev: resolveSeverity('reference-missing', ref.severity || sheetRule.referenceSeverity || 'error', ref.column),
            sheet: sheetRule.name,
            issueType: ref.issueType || sheetRule.referenceIssueType || 'reference',
            icon: ref.icon || sheetRule.referenceIcon,
            entityType: _qaNorm(sheetRule.name),
            entityName: _qaRowIdentity(sheetRule.name, row) || '(Unnamed row)',
            facility: row._facility || '',
            detail: `Reference column ${ref.column} is blank but required to resolve ${ref.targetSheet}.${ref.targetColumn}.`,
            fields: [ref.column],
            label: ref.ruleId || 'Cross-sheet reference is missing',
          });
          return;
        }

        const targetSet = getTargetSet(ref.targetSheet, ref.targetColumn, facL);
        vals.forEach(v => {
          const resolved = targetSet.has(v.toLowerCase());
          const checkId = ref.ruleId || 'reference-missing';
          recordRule(checkId, resolved, sheetRule.name, ref.column);
          if (resolved) return;
          add({
            check: checkId,
            sev: resolveSeverity('reference-missing', ref.severity || sheetRule.referenceSeverity || 'error', ref.column),
            sheet: sheetRule.name,
            issueType: ref.issueType || sheetRule.referenceIssueType || 'reference',
            icon: ref.icon || sheetRule.referenceIcon,
            entityType: _qaNorm(sheetRule.name),
            entityName: _qaRowIdentity(sheetRule.name, row) || '(Unnamed row)',
            facility: row._facility || '',
            detail: `${ref.column} value "${v}" does not resolve to ${ref.targetSheet}.${ref.targetColumn}.`,
            fields: [ref.column],
            label: ref.ruleId || 'Cross-sheet reference is missing',
          });
        });
      });
    });
    if (sheetRule.references?.length) completedSteps++;

    if (sheetRule.relationRules?.length) {
      yield { completed:completedSteps, total:totalSteps, sheet:sheetRule.name, status:`Checking ${sheetRule.name} relationships` };
    }
    (sheetRule.relationRules || []).forEach(rule => {
      activeRuleStage = _qaStage(rule.stage, sheetRule.stage || 'design');
      if (!QA_RELATION_RULE_HANDLERS[rule.type]) return;
      const targets = _qaRowsForSheet(rule.targetSheet, inScope);
      rows.forEach(row => {
        const name = _qaCell(row, 'Name');
        const passed = targets.some(target => _qaNorm(_qaCell(target, rule.targetColumn)) === _qaNorm(name));
        recordRule(rule.ruleId, passed, sheetRule.name, rule.targetColumn || 'Relationship');
        if (passed) return;
        add({
          check: rule.ruleId,
          sev: rule.severity,
          sheet: sheetRule.name,
          issueType: 'consistency',
          entityType: _qaNorm(sheetRule.name),
          entityName: name || '(Unnamed row)',
          facility: row._facility || '',
          detail: `${sheetRule.name} "${name}" has no matching ${rule.targetSheet}.${rule.targetColumn} row.`,
          fields: ['Name'],
          label: rule.ruleId,
        });
      });
    });
    if (sheetRule.relationRules?.length) completedSteps++;
  }

  publishRuleResults();
  return out;
}

function runQA() {
  const steps = _qaRunSteps();
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value || [];
}

let _qaRunToken = null;
let _qaResultsSelectedSheet = '';
let _qaResultsSelectedChecks = [];
let _qaRunProgress = null;

function qaIsRunning() {
  return !!(_qaRunToken && !_qaRunToken.done && !_qaRunToken.cancelled);
}

function qaRevalidateAfterEntityCreate(entityType, row) {
  if (!qaHasRun || qaIsRunning()) return;
  const schema = _qaParseSchema();
  const sheetRule = _qaSheetRuleForEntity(schema, entityType, 'operation');
  if (!sheetRule || !row) return;
  const sheetRows = _qaRowsForSheet(sheetRule.name, () => true);
  if (sheetRule.singleRowRule || (sheetRule.presenceRule && sheetRows.length === 1)) {
    const list = document.getElementById('comp-list');
    if (list) startQaRun(list);
    return;
  }

  const changes = new Map();
  const addChange = (sheet, candidate, fields) => {
    if (!candidate) return;
    const name = _qaRowIdentity(sheet, candidate);
    const facility = candidate._facility || '';
    const key = `${_qaNorm(sheet)}|${_qaNorm(facility)}|${_qaNorm(name)}`;
    const existing = changes.get(key) || { entityType:_qaNorm(sheet), entityName:name, facility, fields:new Set() };
    fields.filter(Boolean).forEach(field => existing.fields.add(field));
    changes.set(key, existing);
  };

  addChange(sheetRule.name, row, (sheetRule.columns || []).map(column => column.name));
  (sheetRule.uniqueRules || []).forEach(rule => {
    const keys = rule.keys || [];
    const values = keys.map(key => _qaNorm(_qaCell(row, key)));
    if (!keys.length || values.every(value => !value)) return;
    sheetRows.forEach(candidate => {
      const candidateValues = keys.map(key => _qaNorm(_qaCell(candidate, key)));
      if (candidateValues.every((value, index) => value === values[index])) addChange(sheetRule.name, candidate, keys);
    });
  });

  (schema.sheets || []).forEach(sourceSheet => {
    (sourceSheet.references || []).forEach(reference => {
      if (_qaNorm(reference.targetSheet) !== _qaNorm(sheetRule.name)) return;
      const targetValue = _qaNorm(_qaCell(row, reference.targetColumn));
      if (!targetValue) return;
      _qaRowsForSheet(sourceSheet.name, sourceRow => !row._facility || !sourceRow._facility ||
        _qaNorm(sourceRow._facility) === _qaNorm(row._facility)).forEach(sourceRow => {
        const values = _qaCellSplit(sourceRow, reference.column, reference.multiValueDelimiter).map(_qaNorm);
        if (values.includes(targetValue)) addChange(sourceSheet.name, sourceRow, [reference.column]);
      });
    });
    (sourceSheet.relationRules || []).forEach(rule => {
      if (_qaNorm(rule.targetSheet) !== _qaNorm(sheetRule.name)) return;
      const targetValue = _qaNorm(_qaCell(row, rule.targetColumn));
      if (!targetValue) return;
      _qaRowsForSheet(sourceSheet.name, sourceRow =>
        _qaNorm(_qaCell(sourceRow, 'Name')) === targetValue
      ).forEach(sourceRow => addChange(sourceSheet.name, sourceRow, ['Name']));
    });
  });

  qaRevalidateFieldChanges([...changes.values()].map(change => ({ ...change, fields:[...change.fields] })));
}

function resetQaAudit() {
  cancelQaRun(true);
  qaFindings = [];
  qaAllFindings = [];
  qaRuleResults = [];
  qaAllRuleResults = [];
  qaScopeCounts = { comps:0, spaces:0, types:0, docs:0 };
  qaHasRun = false;
  _qaResultsSelectedSheet = '';
  _qaResultsSelectedChecks = [];
  _qaCellCache = new WeakMap();
}

function setQaStage(stage) {
  const nextStage = _qaStage(stage, 'operation');
  if (nextStage === qaSelectedStage) return;
  qaSelectedStage = nextStage;
  _qaApplyStageFilter();
  _qaResultsSelectedChecks = [];
  const context = typeof _projectActiveEntityContext === 'function' ? _projectActiveEntityContext() : null;
  if (context?.row && typeof _projectRefreshFieldIssueBadges === 'function') {
    _projectRefreshFieldIssueBadges(context.entityType, context.entityName, context.facility);
  }
  if (viewMode === 'qa') {
    const list = document.getElementById('comp-list');
    if (list) renderQAMode(list, false);
  }
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
}

function showQAMode(list = document.getElementById('comp-list')) {
  if (!list) return;
  if (qaHasRun) {
    renderQAMode(list, false);
    if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
    return;
  }
  startQaRun(list);
}

function _qaProgressMarkup(progress = {}, compact = false) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  return `<div class="qa-run-progress${compact ? ' qa-run-progress-compact' : ''}" aria-live="polite">
    <div class="qa-run-progress-head">
      <span class="qa-run-progress-title"><i class="bi bi-clipboard-pulse"></i> Running QA checks</span>
      <span class="qa-run-progress-percent">${percent}%</span>
    </div>
    <div class="qa-run-progress-track" role="progressbar" aria-label="QA validation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <span class="qa-run-progress-fill" style="width:${percent}%"></span>
    </div>
    <div class="qa-run-progress-status">${esc(progress.status || 'Loading validation profile')}</div>
    <div class="qa-run-progress-foot">
      <span class="qa-run-progress-detail">${esc(progress.detail || 'Preparing workbook data')}</span>
      <button type="button" class="qa-run-cancel" onclick="cancelQaRun()"><i class="bi bi-x-circle"></i> Cancel</button>
    </div>
  </div>`;
}

function _qaUpdateProgressSurfaces(progress) {
  _qaRunProgress = progress;
  document.querySelectorAll('.qa-run-progress').forEach(surface => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
    const bar = surface.querySelector('.qa-run-progress-track');
    const fill = surface.querySelector('.qa-run-progress-fill');
    const percentEl = surface.querySelector('.qa-run-progress-percent');
    const statusEl = surface.querySelector('.qa-run-progress-status');
    const detailEl = surface.querySelector('.qa-run-progress-detail');
    if (bar) bar.setAttribute('aria-valuenow', String(percent));
    if (fill) fill.style.width = percent + '%';
    if (percentEl) percentEl.textContent = percent + '%';
    if (statusEl) statusEl.textContent = progress.status || 'Running QA checks';
    if (detailEl) detailEl.textContent = progress.detail || '';
  });
}

function cancelQaRun(silent = false) {
  if (!_qaRunToken || _qaRunToken.done) return;
  _qaRunToken.cancelled = true;
  _qaRunToken.silent = !!silent;
  document.querySelectorAll('.qa-run-cancel').forEach(button => {
    button.disabled = true;
    button.innerHTML = '<i class="bi bi-hourglass-split"></i> Cancelling';
  });
  if (!silent) {
    _qaUpdateProgressSurfaces({
      ...(_qaRunProgress || {}),
      status:'Stopping QA checks',
      detail:'Finishing the current check before stopping',
    });
  }
}

function _qaCancelledMarkup() {
  return `<div class="qa-run-cancelled" role="status">
    <i class="bi bi-slash-circle"></i>
    <strong>QA run cancelled</strong>
    <span>No partial results were applied.</span>
    <button type="button" class="xbtn" onclick="startQaRun()"><i class="bi bi-arrow-clockwise"></i> Run again</button>
  </div>`;
}

async function startQaRun(list = document.getElementById('comp-list')) {
  if (!list) return;
  if (_qaRunToken && !_qaRunToken.done) cancelQaRun(true);

  const token = { cancelled:false, silent:false, done:false, startedAt:performance.now() };
  _qaRunToken = token;
  const initial = { percent:0, status:'Loading validation profile', detail:'Preparing workbook data' };
  list.innerHTML = _qaProgressMarkup(initial);
  _qaUpdateProgressSurfaces(initial);
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();

  const steps = _qaRunSteps('operation');
  let result = steps.next();
  while (!result.done) {
    if (token !== _qaRunToken || token.cancelled) break;
    const step = result.value || {};
    const elapsedSeconds = Math.max(0, (performance.now() - token.startedAt) / 1000);
    _qaUpdateProgressSurfaces({
      percent:step.total ? (step.completed / step.total) * 100 : 0,
      status:step.status || 'Running QA checks',
      detail:`${step.completed} of ${step.total || 0} check groups · ${elapsedSeconds.toFixed(1)}s elapsed`,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (token !== _qaRunToken || token.cancelled) break;
    result = steps.next();
  }

  if (token !== _qaRunToken) return;
  if (token.cancelled) {
    steps.return?.();
    token.done = true;
    _qaRunToken = null;
    _qaRunProgress = null;
    if (!token.silent && viewMode === 'qa') list.innerHTML = _qaCancelledMarkup();
    if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
    return;
  }

  qaAllFindings = result.value || [];
  qaAllRuleResults = qaRuleResults;
  _qaApplyStageFilter();
  qaHasRun = true;
  token.done = true;
  _qaRunToken = null;
  _qaRunProgress = null;
  const modalContext = typeof _projectActiveEntityContext === 'function' ? _projectActiveEntityContext() : null;
  if (modalContext?.row && typeof _projectRefreshFieldIssueBadges === 'function') {
    _projectRefreshFieldIssueBadges(modalContext.entityType, modalContext.entityName, modalContext.facility);
  }
  if (viewMode !== 'qa') return;
  renderQAMode(list, false);
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
}

function _qaSheetRuleForEntity(schema, entityType, selectedStage = qaSelectedStage) {
  const type = _qaNorm(entityType);
  const sheet = (schema?.sheets || []).find(candidate => _qaNorm(candidate.name) === type) || null;
  return _qaSheetForStage(sheet, selectedStage);
}

function _qaFindingMatchesEntityFields(issue, entityType, entityName, facility, fieldKeys = [], previousEntityName = '') {
  if (_qaNorm(issue?.entityType) !== _qaNorm(entityType)) return false;
  const fac = _qaNorm(facility);
  if (fac && _qaNorm(issue?.facility) && _qaNorm(issue?.facility) !== fac) return false;

  const name = _qaNorm(entityName);
  const prev = _qaNorm(previousEntityName);
  const issueName = _qaNorm(issue?.entityName);
  if (issueName !== name && (!prev || issueName !== prev)) return false;

  if (!fieldKeys.length) return true;
  const issueFields = Array.isArray(issue?.fields) ? issue.fields.map(_qaNormKey).filter(Boolean) : [];
  if (!issueFields.length) return true;
  return issueFields.some(field => fieldKeys.includes(field));
}

function _qaValidateEntityFields(entityType, entityName, facility, fields = [], selectedStage = 'operation') {
  _qaCellCache = new WeakMap();
  const schema = _qaParseSchema();
  const sheetRule = _qaSheetRuleForEntity(schema, entityType, selectedStage);
  if (!sheetRule) return [];

  const nameKey = _qaNorm(entityName);
  const facKey = _qaNorm(facility);
  const fieldKeys = [...new Set(fields.map(_qaNormKey).filter(Boolean))];
  const rows = _qaRowsForSheet(sheetRule.name, row =>
    _qaNorm(_qaRowIdentity(sheetRule.name, row)) === nameKey && (!facKey || _qaNorm(row?._facility) === facKey)
  );
  if (!rows.length) return [];

  const findings = [];
  const resolveSeverity = (check, fallback = 'error', field = '') => {
    const byField = schema?.checkSeverityByField?.[check];
    const key = _qaNormKey(field);
    if (byField && key && byField[key]) return _qaSeverity(byField[key], fallback);
    return _qaSeverity(fallback, QA_CHECKS[check]?.sev || 'error');
  };
  const push = (cfg) => {
    const check = _qaEnsureCheckMeta(cfg.check, cfg);
    findings.push({
        sheet: sheetRule.name,
      check,
      sev: cfg.sev,
      entityType: _qaNorm(sheetRule.name),
      entityName,
      facility,
      detail: cfg.detail,
      fields: cfg.fields || [],
      issueType: _qaIssueType(cfg.issueType),
      stage: _qaStage(cfg.stage, sheetRule.stage || 'design'),
    });
  };

  const cols = sheetRule.columns || [];
  rows.forEach(row => {
    cols.forEach(col => {
      const colKey = _qaNormKey(col.name);
      const columnKeys = [col.name, ...(col.aliases || [])].map(_qaNormKey).filter(Boolean);
      if (fieldKeys.length && !columnKeys.some(key => fieldKeys.includes(key))) return;
      const v = _qaColumnCell(row, col);

      if (col.checks?.length) {
        col.checks.forEach(checkName => {
          if (_qaNamedCheckResult(checkName, v, schema, col)) return;
          const ruleId = `${sheetRule.name}.${col.name}.${checkName}`;
          const ruleWording = _qaColumnCheckDescription(checkName, col, schema);
          push({
            check: ruleId,
            stage: col.stage,
            sev: _qaNamedCheckSeverity(checkName, col.severity, schema, col),
            issueType: checkName === 'Format' || checkName === 'Valid' ? 'format' : 'completeness',
            detail: `${col.name}: ${ruleWording || checkName}. Value was ${v ? `"${v}"` : 'empty'}.`,
            fields: [col.name],
            label: ruleId,
          });
        });
        return;
      }

      if (col.required && !v) {
        push({
          check: 'required-missing',
          stage: col.stage,
          sev: resolveSeverity('required-missing', col.severity || 'warning', col.name),
          sheet: sheetRule.name,
          issueType: col.issueType || 'completeness',
          icon: col.icon,
          detail: `Required column ${col.name} is blank.`,
          fields: [col.name],
          label: 'Required column value is missing',
        });
      }

      if (v && col.formatRef && schema.formats[col.formatRef]) {
        const mainRx = schema.formats[col.formatRef];
        const altRx = col.allowAlternateFormatRef ? schema.formats[col.allowAlternateFormatRef] : null;
        if (!mainRx.test(v) && !(altRx && altRx.test(v))) {
          push({
            check: 'format-invalid',
            stage: col.stage,
            sev: resolveSeverity('format-invalid', col.severity || sheetRule.formatSeverity || 'warning', col.name),
            sheet: sheetRule.name,
            issueType: col.issueType || sheetRule.formatIssueType || 'format',
            icon: col.icon || sheetRule.formatIcon,
            detail: `Column ${col.name} value "${v}" does not match ${col.formatRef}${altRx ? ` or ${col.allowAlternateFormatRef}` : ''}.`,
            fields: [col.name],
            label: 'Column value has invalid format',
          });
        }
      }
    });

    const uniqueRules = sheetRule.uniqueRules?.length
      ? sheetRule.uniqueRules
      : [{
          ruleId:'unique-duplicate',
          severity:sheetRule.uniqueSeverity || 'error',
          keys:[
            ...cols.filter(col => col.unique).map(col => col.name),
            ...(sheetRule.primaryKey || '').split('|').map(key => key.trim()).filter(Boolean),
          ].filter((key, index, keys) => keys.indexOf(key) === index),
        }];
    uniqueRules.forEach(rule => {
      const uniqueKeys = rule.keys || [];
      const uniqueTouched = !fieldKeys.length || uniqueKeys.some(key => fieldKeys.includes(_qaNormKey(key)));
      if (!uniqueTouched || !uniqueKeys.length) return;
      const keyVals = uniqueKeys.map(key => _qaCell(row, key));
      if (keyVals.some(Boolean)) {
        const worksheet = _qaNorm(row?._fileName || row?._facility);
        let count = 0;
        _qaRowsForSheet(sheetRule.name, candidate => _qaNorm(candidate?._fileName || candidate?._facility) === worksheet).forEach(candidate => {
          const vals = uniqueKeys.map(key => _qaCell(candidate, key));
          if (vals.map(v => _qaNorm(v)).join('|') === keyVals.map(v => _qaNorm(v)).join('|')) count++;
        });
        if (count > 1) {
          push({
            check: rule.ruleId || 'unique-duplicate',
            stage: rule.stage,
            sev: rule.severity || resolveSeverity('unique-duplicate', sheetRule.uniqueSeverity || 'error', uniqueKeys[0] || ''),
            issueType: 'uniqueness',
            detail: `${sheetRule.name} has ${count} rows with same key [${uniqueKeys.join(', ')}] = "${keyVals.join(' | ')}".`,
            fields: uniqueKeys,
            label: rule.ruleId || 'Duplicate value in unique key column(s)',
          });
        }
      }
    });

    (sheetRule.references || []).forEach(ref => {
      const refKey = _qaNormKey(ref.column);
      if (fieldKeys.length && !fieldKeys.includes(refKey)) return;
      const vals = _qaCellSplit(row, ref.column, ref.multiValueDelimiter);
      if (!vals.length) {
        if (!ref.required) return;
        push({
          check: ref.ruleId || 'reference-missing',
          stage: ref.stage,
          sev: resolveSeverity('reference-missing', ref.severity || sheetRule.referenceSeverity || 'error', ref.column),
          sheet: sheetRule.name,
          issueType: ref.issueType || sheetRule.referenceIssueType || 'reference',
          icon: ref.icon || sheetRule.referenceIcon,
          detail: `Reference column ${ref.column} is blank but required to resolve ${ref.targetSheet}.${ref.targetColumn}.`,
          fields: [ref.column],
          label: 'Cross-sheet reference is missing',
        });
        return;
      }
      const targetSet = new Set(_qaRowsForSheet(ref.targetSheet, r => _qaNorm(r?._facility) === _qaNorm(row?._facility))
        .map(target => _qaCell(target, ref.targetColumn).toLowerCase())
        .filter(Boolean));
      vals.forEach(value => {
        if (targetSet.has(value.toLowerCase())) return;
        push({
          check: ref.ruleId || 'reference-missing',
          stage: ref.stage,
          sev: resolveSeverity('reference-missing', ref.severity || sheetRule.referenceSeverity || 'error', ref.column),
          sheet: sheetRule.name,
          issueType: ref.issueType || sheetRule.referenceIssueType || 'reference',
          icon: ref.icon || sheetRule.referenceIcon,
          detail: `${ref.column} value "${value}" does not resolve to ${ref.targetSheet}.${ref.targetColumn}.`,
          fields: [ref.column],
          label: 'Cross-sheet reference is missing',
        });
      });
    });

    if (!fieldKeys.length || fieldKeys.includes(_qaNormKey('Name'))) {
      (sheetRule.relationRules || []).forEach(rule => {
        if (!QA_RELATION_RULE_HANDLERS[rule.type]) return;
        const name = _qaCell(row, 'Name');
        const matched = _qaRowsForSheet(rule.targetSheet, target =>
          _qaNorm(_qaCell(target, rule.targetColumn)) === _qaNorm(name)
        ).length > 0;
        if (matched) return;
        push({
          check:rule.ruleId,
          stage:rule.stage,
          sev:rule.severity,
          issueType:'consistency',
          detail:`${sheetRule.name} "${name}" has no matching ${rule.targetSheet}.${rule.targetColumn} row.`,
          fields:['Name'],
          label:rule.ruleId,
        });
      });
    }
  });

  return findings;
}

function _qaRevalidateFieldChangeCache(entityType, entityName, facility, fields = [], previousEntityName = '') {
  const schema = _qaParseSchema();
  const sheetRule = _qaSheetRuleForEntity(schema, entityType, 'operation');
  const fieldKeys = new Set(fields.map(_qaNormKey).filter(Boolean));
  (sheetRule?.columns || []).forEach(column => {
    const columnKeys = [column.name, ...(column.aliases || [])].map(_qaNormKey).filter(Boolean);
    if (!columnKeys.some(key => fieldKeys.has(key))) return;
    columnKeys.forEach(key => fieldKeys.add(key));
  });
  const affectedFieldKeys = [...fieldKeys];
  const removed = qaAllFindings.filter(issue =>
    _qaFindingMatchesEntityFields(issue, entityType, entityName, facility, affectedFieldKeys, previousEntityName)
  );
  qaAllFindings = qaAllFindings.filter(issue =>
    !_qaFindingMatchesEntityFields(issue, entityType, entityName, facility, affectedFieldKeys, previousEntityName)
  );
  if (previousEntityName && _qaNorm(previousEntityName) !== _qaNorm(entityName)) {
    qaAllFindings.forEach(issue => {
      if (_qaNorm(issue.entityType) !== _qaNorm(entityType)) return;
      if (_qaNorm(issue.entityName) !== _qaNorm(previousEntityName)) return;
      if (facility && _qaNorm(issue.facility) !== _qaNorm(facility)) return;
      issue.entityName = entityName;
    });
  }

  const next = _qaValidateEntityFields(entityType, entityName, facility, fields, 'operation');
  if (next.length) qaAllFindings.push(...next);
  _qaAdjustRuleResultsForRow(entityType, removed, next, qaAllRuleResults);
}

function qaRevalidateFieldChanges(changes) {
  if (!qaHasRun || qaIsRunning()) return;
  (changes || []).forEach(change => _qaRevalidateFieldChangeCache(
    change.entityType,
    change.entityName,
    change.facility,
    change.fields || [],
    change.previousEntityName || '',
  ));
  _qaApplyStageFilter();

  if (viewMode === 'qa') {
    const list = document.getElementById('comp-list');
    if (list) renderQAMode(list, false);
  }
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
}

function qaRevalidateFieldChange(entityType, entityName, facility, fields = [], previousEntityName = '') {
  qaRevalidateFieldChanges([{ entityType, entityName, facility, fields, previousEntityName }]);
}

function _qaAdjustRuleResultsForRow(entityType, previousFindings, nextFindings, ruleResults = qaRuleResults) {
  const counts = findings => {
    const map = new Map();
    findings.forEach(finding => {
      const column = (finding.fields || []).join(' + ') || 'Sheet';
      const key = `${finding.check}|${_qaNormKey(column)}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  };
  const before = counts(previousFindings);
  const after = counts(nextFindings);
  new Set([...before.keys(), ...after.keys()]).forEach(key => {
    const separator = key.lastIndexOf('|');
    const check = key.slice(0, separator);
    const columnKey = key.slice(separator + 1);
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (!delta) return;
    const result = ruleResults.find(item =>
      item.check === check && _qaNorm(item.sheet) === _qaNorm(entityType) && _qaNormKey(item.column) === columnKey
    );
    if (!result) return;
    result.fail = Math.max(0, result.fail + delta);
    result.pass = Math.max(0, result.pass - delta);
  });
}

// ── QA rendering and report export ───────────────────────────
const QA_ENTITY_GROUP_DIMS = Object.freeze((typeof COBIE_FILTER_DIMENSIONS === 'undefined' ? [] : COBIE_FILTER_DIMENSIONS)
  .filter(filter => {
    const descriptor = _cobieEntityDescriptor(filter.source);
    return !descriptor?.scopeIdentity && filter.source !== COBIE_RUNTIME_MODEL.documents.sheet;
  })
  .map(filter => filter.dimension));

function setQaResultsSheetFilter(sheetName = '', shouldRender = true) {
  _qaResultsSelectedSheet = _qaNorm(sheetName);
  _qaResultsSelectedChecks = [];
  QA_ENTITY_GROUP_DIMS.forEach(dim => groupState.active.delete(dim));
  if (QA_ENTITY_GROUP_DIMS.includes(_qaResultsSelectedSheet)) {
    groupState.active.add(_qaResultsSelectedSheet);
  }
  document.querySelectorAll('#group-sortable .group-chip[data-dim]').forEach(chip => {
    chip.classList.toggle('gchip-active', groupState.active.has(chip.dataset.dim));
  });
  if (!shouldRender || viewMode !== 'qa') return;
  const list = document.getElementById('comp-list');
  if (list) renderQAMode(list, false);
}

function setQaResultsCheckFilter(checkName = '') {
  const names = Array.isArray(checkName) ? checkName : [checkName];
  _qaResultsSelectedChecks = names.map(name => String(name || '')).filter(Boolean);
  if (viewMode !== 'qa') return;
  const list = document.getElementById('comp-list');
  if (list) renderQAMode(list, false);
}

function _qaVisibleFindings() {
  const activeEntityDim = QA_ENTITY_GROUP_DIMS.find(dim => groupState.active.has(dim)) || '';
  const selectedSheet = _qaResultsSelectedSheet || activeEntityDim;
  return qaFindings.filter(finding => {
    if (selectedSheet && _qaNorm(finding.sheet || finding.entityType) !== selectedSheet) return false;
    if (_qaResultsSelectedChecks.length && !_qaResultsSelectedChecks.includes(finding.check)) return false;
    return true;
  });
}

// Coverage is descriptive, never evaluative: it reports what was looked at, and is
// deliberately kept out of qaFindings/qaRuleResults so it cannot reach _qaScoreTally()
// and move the score or the donut.
//
// Two deliberate choices, both of which are wrong the obvious way round:
//   * the DESCRIBED set is the profile's full sheet list, NOT the stage-filtered one.
//     A sheet excluded by the selected stage is described; calling it unassessed would
//     make coverage change every time a user switches stage.
//   * iteration is per SOURCE WORKBOOK, not per logical facility.
//     _qaLogicalFacilityRows() keeps one representative per facility identity, so a
//     second file describing the same facility would vanish from the report.
function _qaCoverage() {
  const schema = _qaParseSchema();
  const described = new Set((schema?.sheets || []).map(sheet => _qaNorm(sheet.name)));
  const recognised = new Set(_COBIE_WORKSHEET_KEYS);

  const workbooks = new Map();
  (db.facilities || []).forEach(row => {
    const key = String(row._workbookKey || row._fileName || '');
    if (key && row._workbook && !workbooks.has(key)) workbooks.set(key, row);
  });

  const notAssessed = [], additional = [], empty = [];
  let recognisedPresent = 0, coveredPresent = 0;

  workbooks.forEach(row => {
    const wb = row._workbook;
    const fileName = String(row._fileName || '').trim();
    (wb?.SheetNames || []).forEach(sheetName => {
      const key = _qaNorm(sheetName);
      if (!key) return;
      if (_COBIE_TEMPLATE_KEYS.includes(key)) return;   // guidance, not project data
      const rows = readSheet(wb, sheetName).length;
      const entry = { sheet: String(sheetName).trim(), file: fileName, rows };
      if (!recognised.has(key)) { additional.push(entry); return; }
      recognisedPresent += 1;
      if (!described.has(key)) { notAssessed.push(entry); return; }
      coveredPresent += 1;
      if (rows === 0) empty.push(entry);
    });
  });

  const order = (a, b) => a.sheet.localeCompare(b.sheet) || a.file.localeCompare(b.file);
  return {
    covered: coveredPresent, recognisedPresent,
    notAssessed: notAssessed.sort(order),
    additional: additional.sort(order),
    empty: empty.sort(order),
    workbooks: workbooks.size,
  };
}

// Rendered identically in the QA view and the PDF cover so the two can never disagree.
function _qaCoverageHtml(coverage) {
  if (!coverage || !coverage.recognisedPresent && !coverage.additional.length) return '';
  // The filename only earns its place when more than one workbook is loaded; repeating
  // it on every entry of a single-file report is noise, not provenance.
  const showFile = coverage.workbooks > 1;
  const line = items => items
    .map(item => `${esc(item.sheet)}${showFile && item.file ? ` (${esc(item.file)})` : ''} — ${item.rows.toLocaleString()} row${item.rows === 1 ? '' : 's'}`)
    .join('; ');
  const parts = [];
  if (coverage.notAssessed.length) {
    parts.push(`<li><strong>Not assessed</strong> — recognised COBie worksheets this profile does not describe: ${line(coverage.notAssessed)}</li>`);
  }
  if (coverage.empty.length) {
    parts.push(`<li><strong>Present, empty</strong> — described, but no data rows to assess: ${coverage.empty.map(item => esc(item.sheet) + (showFile && item.file ? ` (${esc(item.file)})` : '')).join('; ')}</li>`);
  }
  if (coverage.additional.length) {
    parts.push(`<li><strong>Additional worksheets outside this COBie profile</strong>: ${line(coverage.additional)}</li>`);
  }
  return `<div class="qa-coverage">
    <span class="qa-coverage-head">Coverage and scope</span>
    <p class="qa-coverage-line">The active profile describes ${coverage.covered} of ${coverage.recognisedPresent} recognised COBie worksheet${coverage.recognisedPresent === 1 ? '' : 's'} present${coverage.additional.length ? `. ${coverage.additional.length} additional worksheet${coverage.additional.length === 1 ? ' was' : 's were'} outside this profile` : ''}. Does not affect QA score.</p>
    ${parts.length ? `<ul class="qa-coverage-list">${parts.join('')}</ul>` : ''}
  </div>`;
}

function renderQAMode(list) {
  const visibleFindings = _qaVisibleFindings();
  const bySev = { error:0, warning:0, info:0 };
  visibleFindings.forEach(x => bySev[x.sev]++);

  const facSel = sel.facility;
  const scopeTxt = facSel.size
    ? 'Auditing: ' + [...facSel].map(k => idx.facilityNames.find(n=>n.toLowerCase()===k)||k).join(', ')
    : 'Auditing all loaded facilities';
  const summary = `<div id="qa-summary">
    <label class="qa-stage-control"><span>QA stage</span><select onchange="setQaStage(this.value)" aria-label="QA check stage">
      ${QA_STAGE_ORDER.map(stage => `<option value="${stage}"${qaSelectedStage === stage ? ' selected' : ''}>${stage.charAt(0).toUpperCase() + stage.slice(1)}</option>`).join('')}
    </select></label>
    <span class="qa-sev qa-sev-error">${bySev.error} error${bySev.error!==1?'s':''}</span>
    <span class="qa-sev qa-sev-warning">${bySev.warning} warning${bySev.warning!==1?'s':''}</span>
    ${bySev.info?`<span class="qa-sev qa-sev-info">${bySev.info} advisor${bySev.info!==1?'ies':'y'}</span>`:''}
    <span class="qa-scope">${esc(scopeTxt)} — ${esc(qaSelectedStage.charAt(0).toUpperCase() + qaSelectedStage.slice(1))} includes all preceding stages; active filters set the row-level scope.</span>
    ${_qaResultsSelectedSheet ? `<span class="qa-scope">Sheet: ${esc(_qaResultsSelectedSheet)}</span>` : ''}
    ${visibleFindings.length?`<button class="xbtn" onclick="exportQAReport()"><i class="bi bi-download me-1"></i>Download XLSX</button>`:''}
    ${qaRuleResults.length?`<button class="xbtn" onclick="exportQAPdf()"><i class="bi bi-file-earmark-pdf me-1"></i>Export PDF</button>`:''}
  </div>` + _qaCoverageHtml(_qaCoverage());

  if (!visibleFindings.length) {
    list.innerHTML = summary + `<div class="qa-clear"><i class="bi bi-patch-check"></i>
      <p>No issues found for the selected sheet in the current filtered workbook scope.</p></div>`;
    return;
  }

  const dims = _qaActiveGroupingDims();
  _qaPrepareGroupingLookups();
  const groupedHtml = dims.length
    ? _qaGroupBlocks(visibleFindings, dims)
    : _qaCheckBlocks(visibleFindings);

  list.innerHTML = summary + groupedHtml;
}

function _qaPrepareGroupingLookups() {
  const indexRows = rows => {
    const map = new Map();
    (rows || []).forEach(row => {
      const key = _scopeKey(row._facility, f(row, 'Name'));
      if (!map.has(key)) map.set(key, row);
    });
    return map;
  };
  _qaGroupEntityLookups = {
    component:indexRows(db.components),
    space:indexRows(db.spaces),
  };
  _qaGroupValueCache = new Map();
}

function _qaGroupingEntity(type, name, facility) {
  const row = _qaGroupEntityLookups?.[type]?.get(_scopeKey(facility, name));
  if (row) return row;
  return _findEntity(type === 'component' ? db.components : db.spaces, name, facility);
}

function _qaActiveGroupingDims() {
  const allowed = new Set([_cobieScopeFilterDimension(), ...QA_ENTITY_GROUP_DIMS]);
  return (groupState?.order || [])
    .filter(dim => allowed.has(dim) && groupState.active.has(dim));
}

function _qaDimIcon(dim) {
  return _cobieFilterDescriptor(dim)?.icon || 'bi-folder';
}

function _qaFindingGroupValue(item, dim) {
  const cacheKey = `${dim}|${item.entityType}|${_scopeKey(item.facility, item.entityName)}`;
  if (_qaGroupValueCache.has(cacheKey)) return _qaGroupValueCache.get(cacheKey);
  const value = _qaResolveFindingGroupValue(item, dim);
  _qaGroupValueCache.set(cacheKey, value);
  return value;
}

function _qaResolveFindingGroupValue(item, dim) {
  if (dim === 'facility') return item.facility || '(No Facility)';
  if (dim === 'type') {
    if (item.entityType === 'type') return item.entityName || '(Unnamed)';
    if (item.entityType === 'component') {
      const row = _qaGroupingEntity('component', item.entityName, item.facility || '');
      return row ? (_cobieField(row, 'typeName') || '(Unassigned Type)') : '(Unmapped Type)';
    }
    return '(Unmapped Type)';
  }
  if (dim === 'space') {
    if (item.entityType === 'space') return item.entityName || '(Unnamed)';
    if (item.entityType === 'component') {
      const row = _qaGroupingEntity('component', item.entityName, item.facility || '');
      return row ? (f(row, 'Space') || '(No Space)') : '(Unmapped Space)';
    }
    return '(Unmapped Space)';
  }
  if (dim === 'floor') {
    if (item.entityType === 'floor') return item.entityName || '(Unnamed)';
    if (item.entityType === 'space') {
      const row = _qaGroupingEntity('space', item.entityName, item.facility || '');
      return row ? (_cobieField(row, 'floorName') || '(No Floor)') : '(Unmapped Floor)';
    }
    if (item.entityType === 'component') {
      const row = _qaGroupingEntity('component', item.entityName, item.facility || '');
      if (!row) return '(Unmapped Floor)';
      const spaceName = f(row, 'Space');
      const spaceRow = _qaGroupingEntity('space', spaceName, item.facility || '');
      return spaceRow ? (_cobieField(spaceRow, 'floorName') || '(No Floor)') : '(Unmapped Floor)';
    }
    return '(Unmapped Floor)';
  }
  if (dim === 'system') {
    if (item.entityType === 'system') return item.entityName || '(Unnamed)';
    if (item.entityType === 'component') {
      const comp = _qaGroupingEntity('component', item.entityName, item.facility || '');
      if (!comp) return '(No System)';
      const key = _scopeKey(comp._facility, f(comp, 'Name'));
      const systems = idx.compSys?.[key] || [];
      return systems.length ? (idx.systems.find(name => name.toLowerCase() === systems[0]) || systems[0]) : '(No System)';
    }
    return '(Unmapped System)';
  }
  return '(Other)';
}

function _qaCheckBlocks(items, depth = 0) {
  const byCheck = new Map();
  items.forEach(item => {
    if (!byCheck.has(item.check)) byCheck.set(item.check, []);
    byCheck.get(item.check).push(item);
  });
  const checks = [...byCheck.keys()];

  return checks.map(check => {
    const cfg = QA_CHECKS[check] || { label:check, sheet:'Multiple', sev:'warning', ico:'bi-list-check' };
    const checkItems = byCheck.get(check) || [];
    const cid = 'col_' + (collapseCounter++);
    pendingGroups[cid] = { isQA: true, qaItems: checkItems };
    return `<div class="grp-block grp-d${depth}">
      <div class="grp-hdr grp-collapsed" data-cid="${cid}">
        <i class="bi bi-chevron-down grp-chev"></i>
        <i class="bi ${cfg.ico} me-1" style="opacity:.72;font-size:.82rem"></i>
        <span class="grp-name">${esc(cfg.label)}</span>
        <span class="grp-meta">${esc(cfg.sheet)} sheet</span>
        <span class="qa-sev qa-sev-${cfg.sev}">${cfg.sev}</span>
        <span class="grp-cnt">${checkItems.length}</span>
      </div>
      <div class="grp-body grp-closed" id="${cid}"></div>
    </div>`;
  }).join('');
}

function _qaGroupBlocks(items, dims, depth = 0) {
  if (!dims.length) return _qaCheckBlocks(items, depth);
  const [dim, ...rest] = dims;
  const grouped = new Map();
  items.forEach(item => {
    const value = _qaFindingGroupValue(item, dim);
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(item);
  });
  return [...grouped.entries()].sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric:true })).map(([name, groupedItems]) => {
    const cid = 'col_' + (collapseCounter++);
    pendingGroups[cid] = { isQA:true, qaItems:groupedItems, qaDims:rest, depth:depth + 1 };
    return `<div class="grp-block grp-d${depth}">
      <div class="grp-hdr grp-collapsed" data-cid="${cid}">
        <i class="bi bi-chevron-down grp-chev"></i>
        <i class="bi ${_qaDimIcon(dim)} me-1" style="opacity:.72;font-size:.82rem"></i>
        <span class="grp-name">${esc(_GRP_LABELS?.[dim] || dim)}: ${esc(name)}</span>
        <span class="grp-cnt">${groupedItems.length}</span>
      </div>
      <div class="grp-body grp-closed" id="${cid}"></div>
    </div>`;
  }).join('');
}

function qaPendingGroupBody(pending) {
  if (Object.prototype.hasOwnProperty.call(pending, 'qaDims')) {
    return pending.qaDims.length
      ? _qaGroupBlocks(pending.qaItems, pending.qaDims, pending.depth || 0)
      : _qaCheckBlocks(pending.qaItems, pending.depth || 0);
  }
  return qaGroupBody(pending.qaItems);
}

const QA_GROUP_CAP = 200;
function qaGroupBody(items) {
  const cards = items.slice(0, QA_GROUP_CAP).map(x => {
    const infoBtn = `<button class="xbtn" data-qa-info-entity="${esc(x.entityType)}" data-qa-info-key="${esc(x.entityName)}" data-qa-info-fac="${esc(x.facility)}" title="Open editable information"><i class="bi bi-info-circle"></i></button>`;
    return `<div class="cc qa-${x.sev}">
      <div class="d-flex align-items-start gap-2">
        <div style="flex:1;min-width:0">
          <div class="cc-name">${esc(x.entityName)}</div>
          <div class="cc-meta"><span>${esc(x.detail)}</span>${x.facility?`<span><i class="bi bi-building me-1"></i>${esc(x.facility)}</span>`:''}</div>
        </div>
        ${infoBtn}
      </div>
    </div>`;
  }).join('');
  const rest = items.length - QA_GROUP_CAP;
  return cards + (rest > 0
    ? `<div class="load-more-wrap"><div class="load-more-btn" style="cursor:default">
        Showing ${QA_GROUP_CAP} of ${items.length} — download the report for the full list.</div></div>`
    : '');
}

function exportQAReport() {
  if (!qaFindings.length) return;
  const stageLabel = qaSelectedStage.charAt(0).toUpperCase() + qaSelectedStage.slice(1);
  const rows = qaFindings.map(x => ({
    Stage: stageLabel,
    Severity: x.sev === 'info' ? 'Advisory' : x.sev.charAt(0).toUpperCase() + x.sev.slice(1),
    Check: (QA_CHECKS[x.check] || {}).label || x.check,
    Sheet: (QA_CHECKS[x.check] || {}).sheet || 'Multiple',
    Item: x.entityName,
    Facility: x.facility,
    Detail: x.detail,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'QA Findings');
  XLSX.writeFile(wb, 'QA-Report_' + new Date().toISOString().slice(0,10) + '.xlsx');
}

function _qaRuleSubtitle(result) {
  const check = String(result?.check || '').trim();
  const parts = check.split('.').map(part => String(part || '').trim()).filter(Boolean);
  if (parts.length < 3) return '';

  const named = _qaRuleDescriptionForCheck(check);
  return named || '';
}

function _qaResultSeverity(result) {
  const findings = Array.isArray(qaFindings) ? qaFindings : [];
  const finding = findings.find(item => item.check === result.check && _qaNorm(item.sheet || item.entityType) === _qaNorm(result.sheet));
  return String(finding?.sev || QA_CHECKS[result.check]?.sev || 'warning').toLowerCase();
}

// Advisory (info) failures score as passes; warning and error failures score as fails.
function _qaScoreTally(results) {
  return (results || []).reduce((totals, result) => {
    const pass = Number(result.pass || 0);
    const fail = Number(result.fail || 0);
    const severity = _qaResultSeverity(result);
    totals.pass += pass;
    if (severity === 'info') totals.advisory += fail;
    else if (severity === 'error') totals.error += fail;
    else totals.warning += fail;
    totals.fail = totals.warning + totals.error;
    totals.total += pass + fail;
    return totals;
  }, { pass:0, advisory:0, warning:0, error:0, fail:0, total:0 });
}

function _qaTallyScore(tally) {
  return tally && tally.total ? Math.round(((tally.pass + tally.advisory) / tally.total) * 100) : 100;
}

function _qaPdfReportHtml(logoMarkup = '') {
  const generated = new Date();
  const selectedFacilityKeys = sel?.facility?.size
    ? new Set([...sel.facility].map(key => _qaNorm(key)))
    : null;
  const rootStyles = (typeof getComputedStyle === 'function' && document?.documentElement)
    ? getComputedStyle(document.documentElement)
    : null;
  const themeToken = name => String(rootStyles?.getPropertyValue(name) || '').trim();
  const columnBackground = result => {
    const token = String(result?.colorToken || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return token ? themeToken(`--${token}`) : '';
  };
  const headerThemeBySheet = {
    facility:  { bg:themeToken('--pill-fac-bg'), text:themeToken('--pill-fac-text'), border:themeToken('--pill-fac-text') },
    floor:     { bg:themeToken('--pill-floor-bg'), text:themeToken('--pill-floor-text'), border:themeToken('--pill-floor-text') },
    space:     { bg:themeToken('--pill-space-bg'), text:themeToken('--pill-space-text'), border:themeToken('--pill-space-text') },
    type:      { bg:themeToken('--pill-type-bg'), text:themeToken('--pill-type-text'), border:themeToken('--pill-type-text') },
    system:    { bg:themeToken('--pill-system-bg'), text:themeToken('--pill-system-text'), border:themeToken('--pill-system-text') },
    component: { bg:themeToken('--pill-component-bg'), text:themeToken('--pill-component-text'), border:themeToken('--pill-component-text') },
    contact:   { bg:themeToken('--pill-contact-bg'), text:themeToken('--pill-contact-text'), border:themeToken('--pill-contact-text') },
    document:  { bg:themeToken('--pill-doc-bg'), text:themeToken('--pill-doc-text'), border:themeToken('--pill-doc-text') },
    doccat:    { bg:themeToken('--pill-doc-bg'), text:themeToken('--pill-doc-text'), border:themeToken('--pill-doc-text') },
  };
  const sheetHeaderThemeCss = Object.entries(headerThemeBySheet)
    .map(([sheetKey, tone]) => {
      const bg = tone.bg || '#e8f1f5';
      const text = tone.text || '#16324f';
      const border = tone.border || text;
      return `.sheet-section.sheet-${sheetKey} h2 { background:${bg}; color:${text}; border-left-color:${border}; }`;
    }).join('\n');
  const selectedFacilities = sel?.facility?.size
    ? [...sel.facility].map(key => idx.facilityNames.find(name => name.toLowerCase() === key) || key)
    : [];
  const workbookFiles = [...new Set(_qaLogicalFacilityRows()
    .filter(row => !selectedFacilityKeys || selectedFacilityKeys.has(_qaNorm(row._facility)))
    .map(row => String(row._fileName || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const facilities = [...new Set((selectedFacilities.length ? selectedFacilities : (db.facilities || [])
    .map(row => String(row._facility || f(row, 'Name') || '').trim()))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const severityCounts = { error:0, warning:0, info:0 };
  qaFindings.forEach(finding => {
    const severity = String(finding.sev || 'warning').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(severityCounts, severity)) severityCounts[severity]++;
  });
  const grouped = new Map();
  qaRuleResults.forEach(result => {
    const sheet = String(result.sheet || 'Workbook');
    if (!grouped.has(sheet)) grouped.set(sheet, []);
    grouped.get(sheet).push(result);
  });
  const sheets = [...grouped.entries()];
  const severityFor = _qaResultSeverity;
  const overallTally = _qaScoreTally(qaRuleResults);
  const totalChecks = overallTally.total;
  const overallScore = _qaTallyScore(overallTally);
  const scoreFor = result => _qaTallyScore(_qaScoreTally([result]));
  const donut = (tally, size, thickness) => {
    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const centre = size / 2;
    const segments = [
      { value:tally.pass, color:'#1f9d55' },
      { value:tally.advisory, color:'#0f8ab0' },
      { value:tally.warning, color:'#e8873a' },
      { value:tally.error, color:'#d64545' },
    ].filter(segment => segment.value > 0);
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    let offset = 0;
    const arcs = segments.map(segment => {
      const length = (segment.value / total) * circumference;
      const arc = `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="${thickness}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${centre} ${centre})"></circle>`;
      offset += length;
      return arc;
    }).join('');
    return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="#e6ecf1" stroke-width="${thickness}"></circle>
      ${arcs}
      <text x="${centre}" y="${centre}" text-anchor="middle" dominant-baseline="central" font-size="${(size * 0.25).toFixed(1)}" font-weight="800" fill="#16324f">${_qaTallyScore(tally)}%</text>
    </svg>`;
  };
  const sheetSummaryRows = sheets.map(([sheet, results]) => {
    const tally = _qaScoreTally(results);
    return `<tr>
      <td>${esc(sheet)}</td>
      <td class="num">${results.length}</td>
      <td class="num cell-pass">${tally.pass.toLocaleString()}</td>
      <td class="num cell-advisory">${tally.advisory.toLocaleString()}</td>
      <td class="num cell-warning">${tally.warning.toLocaleString()}</td>
      <td class="num cell-error">${tally.error.toLocaleString()}</td>
      <td class="num"><strong>${_qaTallyScore(tally)}%</strong></td>
    </tr>`;
  }).join('');
  const sheetSections = sheets.map(([sheet, results]) => {
    const sheetKey = _qaNorm(sheet).replace(/[^a-z0-9]+/g, '-');
    const columnGroups = new Map();
    results.forEach(result => {
      const column = String(result.column || 'Sheet');
      const key = _qaNormKey(column);
      if (!columnGroups.has(key)) columnGroups.set(key, []);
      columnGroups.get(key).push(result);
    });
    const rows = [...columnGroups.values()].map(columnResults => `<tbody class="column-group">${columnResults.map(result => {
        const severity = severityFor(result);
        const fail = Number(result.fail || 0);
        const status = fail ? (severity === 'info' ? 'Advisory' : severity.charAt(0).toUpperCase() + severity.slice(1)) : 'Pass';
        const ruleName = String(result.check || result.label || 'rule');
        const ruleDescription = _qaRuleSubtitle(result);
        const columnBg = columnBackground(result);
        return `<tr>
          <td${columnBg ? ` style="background:${esc(columnBg)}"` : ''}>${esc(result.column || 'Sheet')}</td>
          <td><span class="rule-name">${esc(ruleName)}</span>${ruleDescription ? `<span class="rule-id">${esc(ruleDescription)}</span>` : ''}</td>
          <td class="num">${Number(result.pass || 0)}</td>
          <td class="num">${fail}</td>
          <td class="num">${scoreFor(result)}%</td>
          <td><span class="status status-${fail ? severity : 'pass'}">${esc(status)}</span></td>
        </tr>`;
      }).join('')}</tbody>`).join('');
    return `<section class="sheet-section sheet-${esc(sheetKey)}">
      <h2>${esc(sheet)} <span>${results.length} rule${results.length === 1 ? '' : 's'}</span></h2>
      <table class="results-table"><thead><tr><th>Column / Scope</th><th>Rule</th><th>Pass</th><th>Fail</th><th>Score</th><th>Status</th></tr></thead>${rows}</table>
    </section>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guerrilla Ops QA Report ${generated.toISOString().slice(0, 10)}</title>
  <style>
    @page {
      size:A4 portrait;
      margin:14mm 12mm 19mm;
      @bottom-left {
        content:"Generated by Guerrilla Ops and provided without guarantee of accuracy. Verify results against source information and applicable requirements.";
        color:#697887;
        font-family:"Segoe UI",Arial,sans-serif;
        font-size:6.5pt;
        text-align:left;
        white-space:nowrap;
      }
      @bottom-right {
        content:"Page " counter(page) " of " counter(pages);
        color:#697887;
        font-family:"Segoe UI",Arial,sans-serif;
        font-size:7pt;
        font-variant-numeric:tabular-nums;
        text-align:right;
        white-space:nowrap;
      }
    }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { margin:0; padding-bottom:16mm; color:#17202a; background:#fff; font-family:"Segoe UI",Arial,sans-serif; font-size:9pt; line-height:1.35; }
    .report-header { display:flex; align-items:center; gap:12px; padding-bottom:10px; border-bottom:3px solid #16324f; }
    .report-logo { width:42px; height:48px; flex:0 0 auto; }
    .report-logo svg { width:100%; height:100%; display:block; }
    h1 { margin:0; color:#16324f; font-size:20pt; letter-spacing:0; }
    .subtitle { margin-top:2px; color:#536273; font-size:9pt; }
    .meta { display:grid; grid-template-columns:1fr 1.5fr 1.5fr; gap:6px 14px; margin:12px 0; padding:9px 10px; background:#f1f5f8; border-left:4px solid #00a9a5; }
    .meta-label { color:#607080; font-weight:700; }
    .cover { break-after:page; }
    /* Coverage and scope: descriptive, not evaluative — no severity colour, no icon. */
    .qa-coverage { margin:14px 0 0; padding:9px 11px; border:1px solid #d8e0e6; border-radius:4px; background:#f7f9fa; font-size:11px; }
    .qa-coverage-head { display:block; font-weight:600; margin-bottom:3px; }
    .qa-coverage-line { margin:0; }
    .qa-coverage-list { margin:5px 0 0; padding-left:16px; }
    .qa-coverage-list li { margin:2px 0; }
    .hero { display:flex; align-items:center; gap:14px; margin:0 0 10px; padding:10px 12px; border:1px solid #d9e1e8; border-radius:8px; background:linear-gradient(135deg,#f6fafc 0%,#eef4f8 100%); }
    .hero-headline { flex:1 1 auto; }
    .hero-title { display:block; color:#16324f; font-size:13pt; font-weight:800; }
    .hero-note { display:block; margin-top:2px; color:#607080; font-size:8pt; }
    .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin:10px 0 0; }
    .summary-card { padding:8px; border:1px solid #d9e1e8; border-radius:5px; background:#fff; }
    .summary-value { display:block; color:#16324f; font-size:16pt; font-weight:800; }
    .summary-label { color:#607080; font-size:7.5pt; text-transform:uppercase; }
    .summary-card-error { border-left:4px solid #d64545; } .summary-card-warning { border-left:4px solid #e0a800; }
    .summary-card-info { border-left:4px solid #0f8ab0; } .summary-card-rules { border-left:4px solid #16324f; }
    .section-title { margin:14px 0 7px; padding-bottom:4px; color:#16324f; border-bottom:2px solid #00a9a5; font-size:10pt; text-transform:uppercase; letter-spacing:.06em; }
    .sheet-summary th:nth-child(1) { width:34%; }
    .sheet-summary td, .sheet-summary th { padding:5px 7px; }
    .cell-pass { color:#17653a; } .cell-advisory { color:#075c78; }
    .cell-warning { color:#a8600f; } .cell-error { color:#9d1c1c; }
    .donut { flex:0 0 auto; }
    table { width:100%; border-collapse:collapse; }
    th { color:#fff; background:#16324f; font-size:7.5pt; text-align:left; text-transform:uppercase; }
    th, td { padding:5px 6px; border:1px solid #d9e1e8; vertical-align:top; }
    .results-table th, .results-table td { border-color:#e8edf1; }
    tbody tr:nth-child(even) { background:#f7f9fb; }
    .sheet-section { margin:0 0 13px; }
    .sheet-section h2 { break-after:avoid; margin:0; padding:6px 8px; color:#16324f; background:#e8f1f5; border-left:4px solid #00a9a5; font-size:12pt; }
    .results-table { border-right:1px solid #536273; }
    .results-table tbody.column-group tr:first-child td { border-top:1px solid #536273; }
    .results-table tbody.column-group tr:last-child td { border-bottom:1px solid #536273; }
    .results-table tbody.column-group td:first-child { border-left:1px solid #536273; }
    .results-table tbody.column-group td:last-child { border-right:1px solid #536273; }
    ${sheetHeaderThemeCss}
    .sheet-section h2 span { float:right; color:#607080; font-size:8pt; font-weight:500; }
    .results-table thead { display:table-header-group; }
    .results-table tr { break-inside:avoid; }
    .results-table th:nth-child(1) { width:18%; } .results-table th:nth-child(2) { width:48%; }
    .results-table th:nth-child(n+3) { width:8.5%; }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    .rule-name { display:block; font-weight:650; } .rule-id { display:block; color:#697887; font-size:7pt; overflow-wrap:anywhere; }
    .status { display:inline-block; padding:2px 5px; border-radius:3px; font-size:7pt; font-weight:800; text-transform:uppercase; }
    .status-pass { color:#17653a; background:#dff3e7; } .status-error { color:#9d1c1c; background:#fbe1e1; }
    .status-warning { color:#7b4a00; background:#fff0c8; } .status-info { color:#075c78; background:#dff3fa; }
    .report-footer { display:none; }
    @media screen { body { width:210mm; min-height:297mm; margin:10mm auto; padding:14mm 12mm 19mm; box-shadow:0 2px 18px #0002; } .report-footer { display:flex; justify-content:space-between; gap:12px; margin-top:16px; color:#697887; font-size:7pt; } .cover { padding-bottom:14px; margin-bottom:16px; border-bottom:2px dashed #c3ced8; } }
  </style></head><body>
    <div class="cover">
      <header class="report-header"><div class="report-logo">${logoMarkup}</div><div><h1>COBie QA Report</h1><div class="subtitle">Guerrilla Ops workbook quality assessment</div></div></header>
      <div class="meta"><div><span class="meta-label">Generated</span><br>${esc(generated.toLocaleString())}<br><span class="meta-label">QA stage</span><br>${esc(qaSelectedStage.charAt(0).toUpperCase() + qaSelectedStage.slice(1))}</div><div><span class="meta-label">Facilities</span><br>${esc(facilities.join(', ') || 'No facility names available')}</div><div><span class="meta-label">Workbooks</span><br>${esc(workbookFiles.join(', ') || 'No source file names available')}</div></div>
      <div class="hero">
        ${donut(overallTally, 82, 14)}
        <div class="hero-headline">
          <span class="hero-title">Overall quality score</span>
          <span class="hero-note">${(overallTally.pass + overallTally.advisory).toLocaleString()} of ${totalChecks.toLocaleString()} checks scored as complete across ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}. Advisories score as a pass; warnings and errors score as a fail.</span>
          <div class="summary">
            <div class="summary-card summary-card-rules"><span class="summary-value">${qaRuleResults.length}</span><span class="summary-label">Rules assessed</span></div>
            <div class="summary-card summary-card-error"><span class="summary-value">${severityCounts.error}</span><span class="summary-label">Errors</span></div>
            <div class="summary-card summary-card-warning"><span class="summary-value">${severityCounts.warning}</span><span class="summary-label">Warnings</span></div>
            <div class="summary-card summary-card-info"><span class="summary-value">${severityCounts.info}</span><span class="summary-label">Advisories</span></div>
          </div>
        </div>
      </div>
      ${_qaCoverageHtml(_qaCoverage())}
      <h2 class="section-title">Sheet scores</h2>
      <table class="sheet-summary"><thead><tr><th>Sheet</th><th class="num">Rules</th><th class="num">Passed</th><th class="num">Advisory</th><th class="num">Warning</th><th class="num">Error</th><th class="num">Score</th></tr></thead><tbody>${sheetSummaryRows || '<tr><td colspan="7">No QA rule results are available.</td></tr>'}</tbody></table>
    </div>
    ${sheetSections || '<p>No QA rule results are available.</p>'}
    <footer class="report-footer"><span>Generated by Guerrilla Ops and provided without guarantee of accuracy. Verify results against source information and applicable requirements.</span><span>Page numbers are included in the printed report.</span></footer>
  </body></html>`;
}

function exportQAPdf() {
  if (!qaRuleResults.length) return;
  const reportWindow = window.open('', '_blank', 'popup,width=920,height=1100');
  if (!reportWindow) {
    alert('The PDF report window was blocked. Allow pop-ups for this local file and try again.');
    return;
  }
  const logo = document.querySelector('#go-logo-hdr svg')?.cloneNode(true);
  if (logo) {
    logo.style.setProperty('--lines', '#16324f');
    logo.removeAttribute('aria-label');
  }
  reportWindow.document.open();
  reportWindow.document.write(_qaPdfReportHtml(logo?.outerHTML || ''));
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.requestAnimationFrame(() => reportWindow.requestAnimationFrame(() => reportWindow.print()));
}
