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
  contact:'bi-person-fill', facility:'bi-building', floor:'bi-layers-fill', space:'bi-grid-fill',
  type:'bi-tag-fill', component:'bi-tools', system:'bi-diagram-3-fill', document:'bi-file-earmark-text',
  attribute:'bi-list-check', coordinate:'bi-crosshair', multiple:'bi-list-check', schema:'bi-filetype-xml',
};

const QA_CHECK_ICON_BY_ISSUE_TYPE = {
  completeness: 'bi-exclamation-octagon-fill',
  format: 'bi-input-cursor-text',
  reference: 'bi-diagram-3-fill',
  uniqueness: 'bi-files',
  scope: 'bi-table',
  consistency: 'bi-shuffle',
};

const _QA_SCHEMA_PATHS = ['dev/specification/ids_cobie.xml', 'specification/ids_cobie.xml'];
const _QA_EMBEDDED_SCHEMA = '';

let qaFindings = [];
let qaScopeCounts = { comps:0, spaces:0, types:0, docs:0 };
let qaRuleResults = [];
let qaHasRun = false;
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

function _qaRowsForSheet(sheetName, inScope) {
  const map = {
    contact: db.contacts || [],
    facility: db.facilities || [],
    floor: db.floors || [],
    space: db.spaces || [],
    zone: db.zones || [],
    type: db.types || [],
    component: db.components || [],
    system: db.systems || [],
    assembly: [],
    connection: [],
    spare: [],
    resource: [],
    job: [],
    impact: [],
    document: db.documents || [],
    attribute: db.attributes || [],
    coordinate: db.coordinates || [],
    issue: [],
  };
  return (map[_qaNorm(sheetName)] || []).filter(inScope);
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

function _qaReadXmlSync(paths) {
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

function _qaAttr(node, name) {
  return node?.getAttribute?.(name) || '';
}

function _qaSeverity(value, fallback = 'error') {
  const sev = _qaNorm(value);
  return sev === 'error' || sev === 'warning' || sev === 'info' ? sev : fallback;
}

function _qaNamedCheckSeverity(checkName, explicitSeverity = '') {
  if (explicitSeverity) return _qaSeverity(explicitSeverity, 'warning');
  if (_qaNorm(checkName) === 'notempty') return 'info';
  return 'warning';
}

function _qaIssueType(value, fallback = '') {
  const t = _qaNorm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || fallback;
}

function _qaIssueLabel(issueType) {
  if (!issueType) return '';
  return issueType.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function _qaResolveIcon({ icon = '', issueType = '', sheet = '' } = {}) {
  return icon
    || QA_CHECK_ICON_BY_ISSUE_TYPE[_qaIssueType(issueType)]
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
    sheets: [],
    checkSeverities: Object.create(null),
    checkSeverityByField: Object.create(null),
  };
}

function _qaParseSchema() {
  if (_qaSchemaCache) return _qaSchemaCache;

  const xmlText = _QA_EMBEDDED_SCHEMA || _qaReadXmlSync(_QA_SCHEMA_PATHS);
  if (!xmlText) {
    _qaSchemaCache = _qaSchemaError('The current QA XML profile could not be loaded. No fallback rules were applied.');
    return _qaSchemaCache;
  }

  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) {
    _qaSchemaCache = _qaSchemaError('The current QA XML profile is invalid. No fallback rules were applied.');
    return _qaSchemaCache;
  }
  const root = xml.documentElement;
  if (_qaAttr(root, 'profile') !== 'NBIMS-US-V3-current-rules' || _qaAttr(root, 'version') !== '2.0') {
    _qaSchemaCache = _qaSchemaError('The embedded QA XML is not the required NBIMS-US-V3 current-rules profile. No fallback rules were applied.');
    return _qaSchemaCache;
  }

  const formats = {};
  xml.querySelectorAll('formats > format').forEach(fx => {
    const id = _qaAttr(fx, 'id');
    const regex = _qaAttr(fx, 'regex');
    if (!id || !regex) return;
    try {
      formats[id] = new RegExp(regex);
    } catch (_) {
      // Ignore invalid regex definitions.
    }
  });

  const sheets = [];
  const checkSeverities = Object.create(null);
  const checkSeverityByField = Object.create(null);

  xml.querySelectorAll('globalRules > rule').forEach(rule => {
    const sev = _qaSeverity(_qaAttr(rule, 'severity'), '');
    if (!sev) return;
    const type = _qaNorm(_qaAttr(rule, 'type'));
    const desc = _qaNorm(rule.textContent || _qaAttr(rule, 'description'));
    if (type === 'column' && desc.includes('createdon') && (desc.includes('iso date') || desc.includes('iso datetime') || desc.includes('format'))) {
      if (!checkSeverityByField['format-invalid']) checkSeverityByField['format-invalid'] = Object.create(null);
      checkSeverityByField['format-invalid'][_qaNormKey('CreatedOn')] = sev;
    }
  });

  xml.querySelectorAll('sheets > sheet').forEach(sheetNode => {
    const sheet = {
      name: _qaAttr(sheetNode, 'name'),
      required: _qaNorm(_qaAttr(sheetNode, 'required')) === 'true',
      requiredSeverity: _qaSeverity(_qaAttr(sheetNode, 'requiredSeverity') || _qaAttr(sheetNode, 'severity'), 'error'),
      requiredIssueType: _qaIssueType(_qaAttr(sheetNode, 'requiredIssueType'), 'scope'),
      requiredIcon: _qaAttr(sheetNode, 'requiredIcon'),
      formatSeverity: _qaSeverity(_qaAttr(sheetNode, 'formatSeverity'), 'error'),
      formatIssueType: _qaIssueType(_qaAttr(sheetNode, 'formatIssueType'), 'format'),
      formatIcon: _qaAttr(sheetNode, 'formatIcon'),
      uniqueSeverity: _qaSeverity(_qaAttr(sheetNode, 'uniqueSeverity'), 'error'),
      uniqueIssueType: _qaIssueType(_qaAttr(sheetNode, 'uniqueIssueType'), 'uniqueness'),
      uniqueIcon: _qaAttr(sheetNode, 'uniqueIcon'),
      referenceSeverity: _qaSeverity(_qaAttr(sheetNode, 'referenceSeverity'), 'error'),
      referenceIssueType: _qaIssueType(_qaAttr(sheetNode, 'referenceIssueType'), 'reference'),
      referenceIcon: _qaAttr(sheetNode, 'referenceIcon'),
      primaryKey: _qaAttr(sheetNode, 'primaryKey'),
      presenceRule: _qaAttr(sheetNode, 'presenceRule'),
      singleRowRule: _qaAttr(sheetNode, 'singleRowRule'),
      columns: [],
      references: [],
      uniqueRules: [],
      relationRules: [],
    };

    sheetNode.querySelectorAll(':scope > columns > column').forEach(col => {
      sheet.columns.push({
        name: _qaAttr(col, 'name'),
        required: _qaNorm(_qaAttr(col, 'required')) === 'true',
        unique: _qaNorm(_qaAttr(col, 'unique')) === 'true',
        severity: _qaSeverity(_qaAttr(col, 'severity'), ''),
        issueType: _qaIssueType(_qaAttr(col, 'issueType'), ''),
        icon: _qaAttr(col, 'icon'),
        formatRef: _qaAttr(col, 'formatRef'),
        allowAlternateFormatRef: _qaAttr(col, 'allowAlternateFormatRef'),
        aliases: _qaAttr(col, 'aliases').split('|').map(value => value.trim()).filter(Boolean),
        checks: _qaAttr(col, 'checks').split('|').map(value => value.trim()).filter(Boolean),
      });
    });

    sheetNode.querySelectorAll(':scope > references > reference').forEach(ref => {
      sheet.references.push({
        column: _qaAttr(ref, 'column'),
        targetSheet: _qaAttr(ref, 'targetSheet'),
        targetColumn: _qaAttr(ref, 'targetColumn'),
        required: _qaNorm(_qaAttr(ref, 'required')) === 'true',
        severity: _qaSeverity(_qaAttr(ref, 'severity'), ''),
        issueType: _qaIssueType(_qaAttr(ref, 'issueType'), ''),
        icon: _qaAttr(ref, 'icon'),
        multiValueDelimiter: _qaAttr(ref, 'multiValueDelimiter') || ';',
        ruleId: _qaAttr(ref, 'ruleId'),
      });
    });

    sheetNode.querySelectorAll(':scope > uniqueRules > unique').forEach(rule => {
      sheet.uniqueRules.push({
        ruleId: _qaAttr(rule, 'ruleId'),
        keys: _qaAttr(rule, 'keys').split('|').map(value => value.trim()).filter(Boolean),
        severity: _qaSeverity(_qaAttr(rule, 'severity'), 'error'),
      });
    });

    sheetNode.querySelectorAll(':scope > relationRules > relation').forEach(rule => {
      sheet.relationRules.push({
        ruleId: _qaAttr(rule, 'ruleId'),
        type: _qaAttr(rule, 'type'),
        targetSheet: _qaAttr(rule, 'targetSheet'),
        targetColumn: _qaAttr(rule, 'targetColumn'),
        severity: _qaSeverity(_qaAttr(rule, 'severity'), 'error'),
      });
    });

    sheets.push(sheet);
  });

  _qaSchemaCache = { error: '', formats, sheets, checkSeverities, checkSeverityByField };
  return _qaSchemaCache;
}

const QA_NAMED_CHECK_WORDING = Object.freeze({
  NotNull: 'Must contain a text value other than "n/a".',
  NotEmpty: 'Must contain a text value; "n/a" is acceptable.',
  Format: 'Must contain a valid email address.',
  Valid: 'Must contain a valid ISO date or date-time.',
  ValidNumber: 'Must contain a valid number; "n/a" is not acceptable.',
  ValidNumberOrNA: 'When populated, must contain a valid number or "n/a".',
  ZeroOrGreaterOrNA: 'When populated, must contain zero or a positive number, or "n/a".',
  ZeroOrGreater: 'When populated, must contain zero or a positive number.',
});

function _qaNamedCheckResult(checkName, value, schema) {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase();
  const isNA = normalized === 'n/a';
  const isNumber = text !== '' && Number.isFinite(Number(text.replace(/,/g, '')));
  const number = isNumber ? Number(text.replace(/,/g, '')) : NaN;
  if (checkName === 'NotNull') return !!text && !isNA;
  if (checkName === 'NotEmpty') return !!text;
  if (checkName === 'Format') return !!text && !isNA && !!schema.formats.email?.test(text);
  if (checkName === 'Valid') {
    if (!text || isNA) return false;
    schema.formats.isoDate.lastIndex = 0;
    schema.formats.isoDateTime.lastIndex = 0;
    return schema.formats.isoDate.test(text) || schema.formats.isoDateTime.test(text);
  }
  if (checkName === 'ValidNumber') return isNumber;
  if (checkName === 'ValidNumberOrNA') return !text || isNA || isNumber;
  if (checkName === 'ZeroOrGreaterOrNA') return !text || isNA || (isNumber && number >= 0);
  if (checkName === 'ZeroOrGreater') return !text || (isNumber && number >= 0);
  return true;
}

function* _qaRunSteps() {
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
  const totalSteps = (schema.sheets || []).reduce((total, sheet) => total
    + 1
    + (sheet.columns || []).length
    + ((sheet.uniqueRules || []).length ? 1 : 0)
    + ((sheet.references || []).length ? 1 : 0)
    + ((sheet.relationRules || []).length ? 1 : 0), 0);
  let completedSteps = 0;
  const ruleCounts = new Map();
  const recordRule = (check, passed, sheet = 'Workbook', column = 'Sheet') => {
    const key = `${_qaNorm(sheet)}|${_qaNormKey(column)}|${check}`;
    if (!ruleCounts.has(key)) ruleCounts.set(key, { check, sheet, column, pass:0, fail:0 });
    ruleCounts.get(key)[passed ? 'pass' : 'fail']++;
  };
  const publishRuleResults = () => {
    qaRuleResults = [...ruleCounts.values()].map(result => ({
      ...result,
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
  const getTargetSet = (sheetName, columnName, facL, fileName = '') => {
    const k = `${_qaNorm(sheetName)}|${_qaNorm(columnName)}|${facL}|${_qaNorm(fileName)}`;
    if (targetSetCache.has(k)) return targetSetCache.get(k);
    const set = new Set();
    _qaRowsForSheet(sheetName, row => {
      if (fileName && row._fileName) return row._fileName === fileName;
      return (row._facility || '').toLowerCase() === facL;
    }).forEach(row => {
      const v = _qaCell(row, columnName);
      if (v) set.add(v.toLowerCase());
    });
    targetSetCache.set(k, set);
    return set;
  };
  const workbookScopes = (db.facilities || []).filter(inScope).map(facility => ({
    fileName: String(facility._fileName || ''),
    facility: String(facility._facility || ''),
    label: String(facility._fileName || facility._facility || 'Loaded workbook'),
    facilityRow: facility,
  }));
  const rowsInWorkbook = (rows, scope) => rows.filter(row => {
    if (!scope.fileName && !scope.facility) return true;
    if (scope.fileName && row._fileName) return row._fileName === scope.fileName;
    return _qaNorm(row._facility) === _qaNorm(scope.facility);
  });

  for (const sheetRule of schema.sheets) {
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
        add({
          check: sheetRule.presenceRule,
          sev: 'error',
          sheet: sheetRule.name,
          issueType: 'scope',
          entityType: 'sheet',
          entityName: `${sheetRule.name} sheet`,
          facility: scope.facility,
          detail: `${sheetRule.name} must contain at least one data row in ${scope.label}.`,
          label: `${sheetRule.name}: at least one row must be present`,
        });
      });
    }

    if (sheetRule.singleRowRule) {
      const scopes = workbookScopes.length ? workbookScopes : rows.map(row => ({ facilityRow:row, label:row._fileName || row._facility || 'Current workbook' }));
      scopes.forEach(scope => {
        const count = Number(scope.facilityRow?._facRowCount) || rowsInWorkbook(sheetRows, scope).length;
        const passed = count === 1;
        recordRule(sheetRule.singleRowRule, passed, sheetRule.name, 'Sheet');
        if (passed) return;
        add({
          check: sheetRule.singleRowRule,
          sev: 'error',
          sheet: sheetRule.name,
          issueType: 'scope',
          entityType: 'sheet',
          entityName: `${sheetRule.name} sheet`,
          facility: scope.facility,
          detail: `Exactly one Facility row is required in ${scope.label}; ${count} were found.`,
          label: 'Facility: exactly one row must be present',
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
            const passed = _qaNamedCheckResult(checkName, value, schema);
            recordRule(ruleId, passed, sheetRule.name, col.name);
            if (passed) return;
            add({
              check: ruleId,
              sev: _qaNamedCheckSeverity(checkName, col.severity),
              sheet: sheetRule.name,
              issueType: checkName === 'Format' || checkName === 'Valid' ? 'format' : 'completeness',
              entityType: _qaNorm(sheetRule.name),
              entityName: _qaCell(row, 'Name') || '(Unnamed row)',
              facility: row._facility || '',
              detail: `${col.name}: ${QA_NAMED_CHECK_WORDING[checkName] || `Failed ${checkName}.`} Value was ${value ? `"${value}"` : 'empty'}.`,
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
            entityName: _qaCell(row, 'Name') || '(Unnamed row)',
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
            entityName: _qaCell(row, 'Name') || '(Unnamed row)',
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
        add({
          check: rule.ruleId,
          sev: rule.severity,
          sheet: sheetRule.name,
          issueType: 'uniqueness',
          entityType: _qaNorm(sheetRule.name),
          entityName: _qaCell(entry.row, 'Name') || '(Unnamed row)',
          facility: entry.row._facility || '',
          detail: `${entry.count} rows share worksheet key [${rule.keys.join(', ')}] = "${entry.values.join(' | ')}".`,
          fields: rule.keys,
          label: `${rule.ruleId}: must be unique within the worksheet`,
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
          entityName: _qaCell(rec.row, 'Name') || '(Unnamed row)',
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
            entityName: _qaCell(row, 'Name') || '(Unnamed row)',
            facility: row._facility || '',
            detail: `Reference column ${ref.column} is blank but required to resolve ${ref.targetSheet}.${ref.targetColumn}.`,
            fields: [ref.column],
            label: ref.ruleId || 'Cross-sheet reference is missing',
          });
          return;
        }

        const targetSet = getTargetSet(ref.targetSheet, ref.targetColumn, facL, row._fileName || '');
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
            entityName: _qaCell(row, 'Name') || '(Unnamed row)',
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
      if (rule.type !== 'atLeastOneTargetPerRow') return;
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
let _qaResultsSelectedCheck = '';
let _qaRunProgress = null;

function qaIsRunning() {
  return !!(_qaRunToken && !_qaRunToken.done && !_qaRunToken.cancelled);
}

function resetQaAudit() {
  cancelQaRun(true);
  qaFindings = [];
  qaRuleResults = [];
  qaScopeCounts = { comps:0, spaces:0, types:0, docs:0 };
  qaHasRun = false;
  _qaResultsSelectedSheet = '';
  _qaResultsSelectedCheck = '';
  _qaCellCache = new WeakMap();
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

  const steps = _qaRunSteps();
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

  qaFindings = result.value || [];
  qaHasRun = true;
  token.done = true;
  _qaRunToken = null;
  _qaRunProgress = null;
  if (viewMode !== 'qa') return;
  renderQAMode(list, false);
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
}

function _qaSheetRuleForEntity(schema, entityType) {
  const type = _qaNorm(entityType);
  return (schema?.sheets || []).find(sheet => _qaNorm(sheet.name) === type) || null;
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

function _qaValidateEntityFields(entityType, entityName, facility, fields = []) {
  _qaCellCache = new WeakMap();
  const schema = _qaParseSchema();
  const sheetRule = _qaSheetRuleForEntity(schema, entityType);
  if (!sheetRule) return [];

  const nameKey = _qaNorm(entityName);
  const facKey = _qaNorm(facility);
  const fieldKeys = [...new Set(fields.map(_qaNormKey).filter(Boolean))];
  const rows = _qaRowsForSheet(sheetRule.name, row =>
    _qaNorm(_qaCell(row, 'Name')) === nameKey && (!facKey || _qaNorm(row?._facility) === facKey)
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
          if (_qaNamedCheckResult(checkName, v, schema)) return;
          const ruleId = `${sheetRule.name}.${col.name}.${checkName}`;
          push({
            check: ruleId,
            sev: _qaNamedCheckSeverity(checkName, col.severity),
            issueType: checkName === 'Format' || checkName === 'Valid' ? 'format' : 'completeness',
            detail: `${col.name}: ${QA_NAMED_CHECK_WORDING[checkName] || `Failed ${checkName}.`} Value was ${v ? `"${v}"` : 'empty'}.`,
            fields: [col.name],
            label: ruleId,
          });
        });
        return;
      }

      if (col.required && !v) {
        push({
          check: 'required-missing',
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
        if (rule.type !== 'atLeastOneTargetPerRow') return;
        const name = _qaCell(row, 'Name');
        const matched = _qaRowsForSheet(rule.targetSheet, target =>
          _qaNorm(_qaCell(target, rule.targetColumn)) === _qaNorm(name)
        ).length > 0;
        if (matched) return;
        push({
          check:rule.ruleId,
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

function qaRevalidateFieldChange(entityType, entityName, facility, fields = [], previousEntityName = '') {
  if (!qaHasRun) return;

  const schema = _qaParseSchema();
  const sheetRule = _qaSheetRuleForEntity(schema, entityType);
  const fieldKeys = new Set(fields.map(_qaNormKey).filter(Boolean));
  (sheetRule?.columns || []).forEach(column => {
    const columnKeys = [column.name, ...(column.aliases || [])].map(_qaNormKey).filter(Boolean);
    if (!columnKeys.some(key => fieldKeys.has(key))) return;
    columnKeys.forEach(key => fieldKeys.add(key));
  });
  const affectedFieldKeys = [...fieldKeys];
  const removed = qaFindings.filter(issue =>
    _qaFindingMatchesEntityFields(issue, entityType, entityName, facility, affectedFieldKeys, previousEntityName)
  );
  qaFindings = qaFindings.filter(issue =>
    !_qaFindingMatchesEntityFields(issue, entityType, entityName, facility, affectedFieldKeys, previousEntityName)
  );
  if (previousEntityName && _qaNorm(previousEntityName) !== _qaNorm(entityName)) {
    qaFindings.forEach(issue => {
      if (_qaNorm(issue.entityType) !== _qaNorm(entityType)) return;
      if (_qaNorm(issue.entityName) !== _qaNorm(previousEntityName)) return;
      if (facility && _qaNorm(issue.facility) !== _qaNorm(facility)) return;
      issue.entityName = entityName;
    });
  }

  const next = _qaValidateEntityFields(entityType, entityName, facility, fields);
  if (next.length) qaFindings.push(...next);
  _qaAdjustRuleResultsForRow(entityType, removed, next);

  if (viewMode === 'qa') {
    const list = document.getElementById('comp-list');
    if (list) renderQAMode(list, false);
  }
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
}

function _qaAdjustRuleResultsForRow(entityType, previousFindings, nextFindings) {
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
    const result = qaRuleResults.find(item =>
      item.check === check && _qaNorm(item.sheet) === _qaNorm(entityType) && _qaNormKey(item.column) === columnKey
    );
    if (!result) return;
    result.fail = Math.max(0, result.fail + delta);
    result.pass = Math.max(0, result.pass - delta);
  });
}

// ── QA rendering and report export ───────────────────────────
const QA_ENTITY_GROUP_DIMS = Object.freeze(['type', 'system', 'space', 'floor']);

function setQaResultsSheetFilter(sheetName = '', shouldRender = true) {
  _qaResultsSelectedSheet = _qaNorm(sheetName);
  _qaResultsSelectedCheck = '';
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
  _qaResultsSelectedCheck = String(checkName || '');
  if (viewMode !== 'qa') return;
  const list = document.getElementById('comp-list');
  if (list) renderQAMode(list, false);
}

function _qaVisibleFindings() {
  const activeEntityDim = QA_ENTITY_GROUP_DIMS.find(dim => groupState.active.has(dim)) || '';
  const selectedSheet = _qaResultsSelectedSheet || activeEntityDim;
  return qaFindings.filter(finding => {
    if (selectedSheet && _qaNorm(finding.sheet || finding.entityType) !== selectedSheet) return false;
    if (_qaResultsSelectedCheck && finding.check !== _qaResultsSelectedCheck) return false;
    return true;
  });
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
    <span class="qa-sev qa-sev-error">${bySev.error} error${bySev.error!==1?'s':''}</span>
    <span class="qa-sev qa-sev-warning">${bySev.warning} warning${bySev.warning!==1?'s':''}</span>
    ${bySev.info?`<span class="qa-sev qa-sev-info">${bySev.info} advisor${bySev.info!==1?'ies':'y'}</span>`:''}
    <span class="qa-scope">${esc(scopeTxt)} — active filters set the row-level scope; worksheet-presence checks remain workbook-wide.</span>
    ${_qaResultsSelectedSheet ? `<span class="qa-scope">Sheet: ${esc(_qaResultsSelectedSheet)}</span>` : ''}
    ${_qaResultsSelectedCheck ? `<span class="qa-scope">Rule: ${esc(_qaResultsSelectedCheck)}</span>` : ''}
    ${visibleFindings.length?`<button class="xbtn" onclick="exportQAReport()"><i class="bi bi-download me-1"></i>Download XLSX</button>`:''}
    ${qaRuleResults.length?`<button class="xbtn" onclick="exportQAPdf()"><i class="bi bi-file-earmark-pdf me-1"></i>Export PDF</button>`:''}
  </div>`;

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
  const allowed = new Set(['facility', 'type', 'system', 'space', 'floor']);
  return (groupState?.order || [])
    .filter(dim => allowed.has(dim) && groupState.active.has(dim));
}

function _qaDimIcon(dim) {
  return {
    facility: 'bi-building',
    floor: 'bi-layers-fill',
    space: 'bi-grid-fill',
    type: 'bi-tag-fill',
    system: 'bi-diagram-3-fill',
  }[dim] || 'bi-folder';
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
  const SEV_ORDER = { error:0, warning:1, info:2 };
  const byCheck = new Map();
  items.forEach(item => {
    if (!byCheck.has(item.check)) byCheck.set(item.check, []);
    byCheck.get(item.check).push(item);
  });
  const checks = [...byCheck.keys()].sort((a,b) =>
    (SEV_ORDER[QA_CHECKS[a]?.sev] ?? 9) - (SEV_ORDER[QA_CHECKS[b]?.sev] ?? 9)
    || String(QA_CHECKS[a]?.label || a).localeCompare(String(QA_CHECKS[b]?.label || b))
  );

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
  const rows = qaFindings.map(x => ({
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

function _qaPdfReportHtml(logoMarkup = '') {
  const generated = new Date();
  const selectedFacilities = sel?.facility?.size
    ? [...sel.facility].map(key => idx.facilityNames.find(name => name.toLowerCase() === key) || key)
    : [];
  const facilities = [...new Set((selectedFacilities.length ? selectedFacilities : (db.facilities || [])
    .map(row => String(row._facility || f(row, 'Name') || '').trim()))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const severityCounts = { error:0, warning:0, info:0 };
  qaFindings.forEach(finding => {
    const severity = String(finding.sev || 'warning').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(severityCounts, severity)) severityCounts[severity]++;
  });
  const totalPass = qaRuleResults.reduce((sum, result) => sum + Number(result.pass || 0), 0);
  const totalFail = qaRuleResults.reduce((sum, result) => sum + Number(result.fail || 0), 0);
  const totalChecks = totalPass + totalFail;
  const overallScore = totalChecks ? Math.round((totalPass / totalChecks) * 100) : 100;
  const grouped = new Map();
  qaRuleResults.forEach(result => {
    const sheet = String(result.sheet || 'Workbook');
    if (!grouped.has(sheet)) grouped.set(sheet, []);
    grouped.get(sheet).push(result);
  });
  const sheets = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  const severityFor = result => {
    const finding = qaFindings.find(item => item.check === result.check && _qaNorm(item.sheet || item.entityType) === _qaNorm(result.sheet));
    return String(finding?.sev || QA_CHECKS[result.check]?.sev || 'warning').toLowerCase();
  };
  const scoreFor = result => {
    const pass = Number(result.pass || 0);
    const fail = Number(result.fail || 0);
    return pass + fail ? Math.round((pass / (pass + fail)) * 100) : 100;
  };
  const sheetSummaryRows = sheets.map(([sheet, results]) => {
    const pass = results.reduce((sum, result) => sum + Number(result.pass || 0), 0);
    const fail = results.reduce((sum, result) => sum + Number(result.fail || 0), 0);
    const score = pass + fail ? Math.round((pass / (pass + fail)) * 100) : 100;
    return `<tr><td>${esc(sheet)}</td><td>${results.length}</td><td>${pass}</td><td>${fail}</td><td><strong>${score}%</strong></td></tr>`;
  }).join('');
  const sheetSections = sheets.map(([sheet, results]) => {
    const rows = [...results]
      .sort((a, b) => String(a.column || '').localeCompare(String(b.column || '')) || String(a.label || a.check).localeCompare(String(b.label || b.check)))
      .map(result => {
        const severity = severityFor(result);
        const fail = Number(result.fail || 0);
        const status = fail ? (severity === 'info' ? 'Advisory' : severity.charAt(0).toUpperCase() + severity.slice(1)) : 'Pass';
        return `<tr>
          <td>${esc(result.column || 'Sheet')}</td>
          <td><span class="rule-name">${esc(result.label || result.check)}</span><span class="rule-id">${esc(result.check)}</span></td>
          <td class="num">${Number(result.pass || 0)}</td>
          <td class="num">${fail}</td>
          <td class="num">${scoreFor(result)}%</td>
          <td><span class="status status-${fail ? severity : 'pass'}">${esc(status)}</span></td>
        </tr>`;
      }).join('');
    return `<section class="sheet-section">
      <h2>${esc(sheet)} <span>${results.length} rule${results.length === 1 ? '' : 's'}</span></h2>
      <table class="results-table"><thead><tr><th>Column / Scope</th><th>Rule</th><th>Pass</th><th>Fail</th><th>Score</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guerrilla Ops QA Report ${generated.toISOString().slice(0, 10)}</title>
  <style>
    @page { size:A4 portrait; margin:14mm 12mm 19mm; }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { margin:0; color:#17202a; background:#fff; font-family:"Segoe UI",Arial,sans-serif; font-size:9pt; line-height:1.35; }
    .report-header { display:flex; align-items:center; gap:12px; padding-bottom:10px; border-bottom:3px solid #16324f; }
    .report-logo { width:42px; height:48px; flex:0 0 auto; }
    .report-logo svg { width:100%; height:100%; display:block; }
    h1 { margin:0; color:#16324f; font-size:20pt; letter-spacing:0; }
    .subtitle { margin-top:2px; color:#536273; font-size:9pt; }
    .meta { display:grid; grid-template-columns:1fr 2fr; gap:6px 14px; margin:12px 0; padding:9px 10px; background:#f1f5f8; border-left:4px solid #00a9a5; }
    .meta-label { color:#607080; font-weight:700; }
    .summary { display:grid; grid-template-columns:repeat(5,1fr); gap:7px; margin:0 0 12px; }
    .summary-card { padding:8px; border:1px solid #d9e1e8; border-radius:4px; }
    .summary-value { display:block; color:#16324f; font-size:16pt; font-weight:800; }
    .summary-label { color:#607080; font-size:7.5pt; text-transform:uppercase; }
    table { width:100%; border-collapse:collapse; }
    th { color:#fff; background:#16324f; font-size:7.5pt; text-align:left; text-transform:uppercase; }
    th, td { padding:5px 6px; border:1px solid #d9e1e8; vertical-align:top; }
    tbody tr:nth-child(even) { background:#f7f9fb; }
    .sheet-summary { margin-bottom:14px; }
    .sheet-section { margin:0 0 13px; }
    .sheet-section h2 { break-after:avoid; margin:0; padding:6px 8px; color:#16324f; background:#e8f1f5; border-left:4px solid #00a9a5; font-size:12pt; }
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
    .report-footer { position:fixed; left:0; right:0; bottom:-13mm; padding-top:4px; border-top:1px solid #bdc8d2; color:#697887; font-size:7pt; text-align:center; }
    @media screen { body { width:210mm; min-height:297mm; margin:10mm auto; padding:14mm 12mm 19mm; box-shadow:0 2px 18px #0002; } .report-footer { position:static; margin-top:16px; } }
  </style></head><body>
    <header class="report-header"><div class="report-logo">${logoMarkup}</div><div><h1>COBie QA Report</h1><div class="subtitle">Guerrilla Ops workbook quality assessment</div></div></header>
    <div class="meta"><div><span class="meta-label">Generated</span><br>${esc(generated.toLocaleString())}</div><div><span class="meta-label">Facilities</span><br>${esc(facilities.join(', ') || 'No facility names available')}</div></div>
    <div class="summary">
      <div class="summary-card"><span class="summary-value">${overallScore}%</span><span class="summary-label">Overall score</span></div>
      <div class="summary-card"><span class="summary-value">${qaRuleResults.length}</span><span class="summary-label">Rules assessed</span></div>
      <div class="summary-card"><span class="summary-value">${severityCounts.error}</span><span class="summary-label">Errors</span></div>
      <div class="summary-card"><span class="summary-value">${severityCounts.warning}</span><span class="summary-label">Warnings</span></div>
      <div class="summary-card"><span class="summary-value">${severityCounts.info}</span><span class="summary-label">Advisories</span></div>
    </div>
    <table class="sheet-summary"><thead><tr><th>Sheet</th><th>Rules</th><th>Pass</th><th>Fail</th><th>Score</th></tr></thead><tbody>${sheetSummaryRows}</tbody></table>
    ${sheetSections || '<p>No QA rule results are available.</p>'}
    <footer class="report-footer">Generated by Guerrilla Ops. This report and software are provided without guarantee of accuracy. Verify results against source information and applicable requirements.</footer>
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
