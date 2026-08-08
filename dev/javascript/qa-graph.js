// -- QA graph side panel ------------------------------------------------------
let _qaGraphCollapsed = false;
let _qaGraphWidth = 0;
let _qaGraphLastWidth = 0;
let _qaGraphSelectedSheet = '';

function _qaGraphElements() {
  return {
    panel: document.getElementById('qa-graph-panel'),
    body: document.getElementById('qa-graph-body'),
    edgeToggle: document.getElementById('qa-graph-edge-toggle'),
  };
}

function _qaGraphDesiredWidth() {
  return Math.max(360, Math.round(window.innerWidth * 0.5));
}

function _qaGraphClampWidth(width) {
  const min = 320;
  const max = Math.max(min + 40, window.innerWidth - 320);
  return Math.max(min, Math.min(max, Math.round(width)));
}

function _qaGraphSetWidth(els, width) {
  if (!els?.panel) return;
  const finalWidth = _qaGraphClampWidth(width);
  _qaGraphWidth = finalWidth;
  els.panel.style.width = finalWidth + 'px';
  els.panel.style.flexBasis = finalWidth + 'px';
}

function _qaGraphApplyCollapsedState(els) {
  els.panel.classList.toggle('qa-graph-collapsed', _qaGraphCollapsed);
  els.edgeToggle?.setAttribute('aria-expanded', _qaGraphCollapsed ? 'false' : 'true');
  if (_qaGraphCollapsed) {
    _qaGraphLastWidth = _qaGraphWidth || _qaGraphDesiredWidth();
  } else {
    _qaGraphSetWidth(els, _qaGraphLastWidth || _qaGraphWidth || _qaGraphDesiredWidth());
  }
}

function _bindQaGraphResizeAndToggle(els) {
  const edge = els?.edgeToggle;
  if (!edge || edge.dataset.bound === '1') return;
  edge.dataset.bound = '1';

  edge.addEventListener('mousedown', event => {
    if (event.button !== 0 || window.matchMedia('(max-width: 1200px)').matches) return;
    const startX = event.clientX;
    const startWidth = els.panel.getBoundingClientRect().width;
    let dragged = false;

    const onMove = moveEvent => {
      const delta = startX - moveEvent.clientX;
      if (Math.abs(delta) > 3) dragged = true;
      if (_qaGraphCollapsed) {
        _qaGraphCollapsed = false;
        els.panel.classList.remove('qa-graph-collapsed');
        edge.setAttribute('aria-expanded', 'true');
      }
      _qaGraphSetWidth(els, startWidth + delta);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragged) {
        _qaGraphCollapsed = !_qaGraphCollapsed;
        _qaGraphApplyCollapsedState(els);
      } else {
        _qaGraphLastWidth = _qaGraphWidth;
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  window.addEventListener('resize', () => {
    if (_qaGraphCollapsed || !els.panel || window.matchMedia('(max-width: 1200px)').matches) return;
    _qaGraphSetWidth(els, _qaGraphWidth || _qaGraphDesiredWidth());
  });
}

function _bindQaGraphSheetSelection(els) {
  if (!els?.body || els.body.dataset.sheetSelectionBound === '1') return;
  els.body.dataset.sheetSelectionBound = '1';
  els.body.addEventListener('click', event => {
    const pill = event.target.closest('[data-qa-sheet]');
    if (pill) {
      _qaGraphSelectedSheet = pill.dataset.qaSheet || '';
      if (typeof setQaResultsSheetFilter === 'function') {
        setQaResultsSheetFilter(_qaGraphSelectedSheet);
      }
      refreshQaGraphPanel();
      return;
    }
    const ruleCard = event.target.closest('[data-qa-check]');
    if (ruleCard && typeof setQaResultsCheckFilter === 'function') {
      setQaResultsCheckFilter(ruleCard.dataset.qaCheck || '');
    }
  });
}

function _qaGraphFindings() {
  if (typeof qaIsRunning === 'function' && qaIsRunning()) return [];
  return qaHasRun && Array.isArray(qaFindings) ? qaFindings : [];
}

function _qaGraphAggregate(ruleResults, property) {
  const groups = new Map();
  (ruleResults || []).forEach(result => {
    if (result.pass + result.fail < 1) return;
    const name = String(result[property] || (property === 'sheet' ? 'Workbook' : 'Sheet'));
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label:name, pass:0, fail:0, total:0 });
    const group = groups.get(key);
    group.pass += result.pass;
    group.fail += result.fail;
    group.total += result.pass + result.fail;
  });
  return [...groups.values()].map(group => ({
    ...group,
    score: group.total ? Math.round((group.pass / group.total) * 100) : 100,
  }));
}

function _qaGraphRuleDescription(result) {
  const check = String(result?.check || '');
  const suffix = check.split('.').pop();
  if (typeof QA_NAMED_CHECK_WORDING !== 'undefined' && QA_NAMED_CHECK_WORDING[suffix]) {
    return QA_NAMED_CHECK_WORDING[suffix];
  }
  if (/\.Unique(?:\.|$)/i.test(check)) return 'Must be unique within the worksheet.';
  if (/\.CrossReference(?:\.|$)/i.test(check)) return 'Must match the referenced value in the related worksheet.';
  if (/AtLeastOneRowPresent/i.test(check)) return 'The worksheet must contain at least one data row.';
  if (/OneAndOnlyOneFacilityFound/i.test(check)) return 'The workbook must contain exactly one Facility row.';
  if (/AComponentForEachType/i.test(check)) return 'Each Type must be referenced by at least one Component.';
  return String(result?.label || QA_CHECKS?.[check]?.label || check);
}

function _qaGraphRuleRows(ruleResults) {
  return (ruleResults || []).filter(result => result.pass + result.fail > 0).map(result => {
    const total = result.pass + result.fail;
    return {
      ...result,
      total,
      score:total ? Math.round((result.pass / total) * 100) : 100,
      description:_qaGraphRuleDescription(result),
    };
  }).sort((a, b) => b.fail - a.fail || a.column.localeCompare(b.column) || a.check.localeCompare(b.check));
}

function _qaGraphSummary(findings, ruleResults = qaRuleResults) {
  const sev = { error:0, warning:0, info:0 };
  findings.forEach(item => {
    const level = String(item?.sev || 'warning').toLowerCase();
    if (sev[level] === undefined) sev[level] = 0;
    sev[level]++;
  });

  const sheets = _qaGraphAggregate(ruleResults, 'sheet')
    .sort((a, b) => a.label.localeCompare(b.label));
  if (_qaGraphSelectedSheet && !sheets.some(sheet => sheet.key === _qaGraphSelectedSheet)) {
    _qaGraphSelectedSheet = '';
  }
  const selectedResults = _qaGraphSelectedSheet
    ? (ruleResults || []).filter(result => String(result.sheet || 'Workbook').toLowerCase() === _qaGraphSelectedSheet)
    : ruleResults;
  const rows = _qaGraphSelectedSheet
    ? _qaGraphRuleRows(selectedResults)
    : sheets;
  const pass = (selectedResults || []).reduce((total, result) => total + result.pass, 0);
  const fail = (selectedResults || []).reduce((total, result) => total + result.fail, 0);
  const overallPass = (ruleResults || []).reduce((total, result) => total + result.pass, 0);
  const overallFail = (ruleResults || []).reduce((total, result) => total + result.fail, 0);

  return {
    total: pass + fail,
    pass,
    fail,
    sev,
    sheets,
    rows,
    overallPass,
    overallFail,
    overallTotal:overallPass + overallFail,
    selectedSheet: sheets.find(sheet => sheet.key === _qaGraphSelectedSheet) || null,
  };
}

function _qaGraphSummaryMarkup(summary) {
  const passPercent = summary.total ? (summary.pass / summary.total) * 100 : 100;
  return `<button type="button" class="qa-graph-summary" data-qa-sheet="" title="Show results for all sheets">
    <div class="qa-donut qa-donut-main" style="--qa-pass:${passPercent}%" role="img" aria-label="${summary.pass} checks passed and ${summary.fail} failed">
      <span>${Math.round(passPercent)}%</span>
    </div>
    <div class="qa-graph-totals">
      <div class="qa-graph-chip pass"><span class="n">${summary.pass}</span><span class="l">Passed</span></div>
      <div class="qa-graph-chip fail"><span class="n">${summary.fail}</span><span class="l">Failed</span></div>
    </div>
  </button>`;
}

function _qaGraphRowsMarkup(summary) {
  const heading = summary.selectedSheet
    ? `${esc(summary.selectedSheet.label)} rules`
    : 'Sheet scores';
  return `<div class="qa-graph-breakdown-title">${heading}</div>` + summary.rows.map(row => {
    const passPercent = row.total ? (row.pass / row.total) * 100 : 100;
    if (summary.selectedSheet) {
      return `<button type="button" class="qa-graph-row qa-graph-rule-row" data-qa-check="${esc(row.check)}" title="Filter results by ${esc(row.check)}">
        <div class="qa-donut" style="--qa-pass:${passPercent}%" role="img" aria-label="${row.score}% score"><span>${row.score}%</span></div>
        <div class="qa-graph-meta">
          <div class="qa-graph-rule-head">
            <span class="qa-graph-name">${esc(row.check)}</span>
            <span class="qa-graph-rule-column">${esc(row.column || 'Sheet')}</span>
          </div>
          <span class="qa-graph-rule-description">${esc(row.description)}</span>
          <span class="qa-graph-cnt"><b>${row.pass}</b> pass · <strong>${row.fail}</strong> fail</span>
        </div>
      </button>`;
    }
    return `<button type="button" class="qa-graph-row qa-graph-sheet-row" data-qa-sheet="${esc(row.key)}" title="Filter results by ${esc(row.label)}">
      <div class="qa-donut" style="--qa-pass:${passPercent}%" role="img" aria-label="${row.score}% score"><span>${row.score}%</span></div>
      <div class="qa-graph-meta">
        <span class="qa-graph-name">${esc(row.label)}</span>
        <span class="qa-graph-cnt"><b>${row.pass}</b> pass · <strong>${row.fail}</strong> fail</span>
      </div>
    </button>`;
  }).join('');
}

function refreshQaGraphPanel() {
  const els = _qaGraphElements();
  if (!els.panel || !els.body) return;
  _bindQaGraphResizeAndToggle(els);
  _bindQaGraphSheetSelection(els);

  if (viewMode !== 'qa') {
    els.panel.classList.add('d-none');
    return;
  }

  const findings = _qaGraphFindings();
  const summary = _qaGraphSummary(findings);

  els.panel.classList.remove('d-none');
  _qaGraphApplyCollapsedState(els);
  if (typeof qaIsRunning === 'function' && qaIsRunning()) {
    els.body.innerHTML = '';
    return;
  }
  if (!summary.total) {
    els.body.innerHTML = '<div class="qa-graph-empty"><div><i class="bi bi-patch-check" style="font-size:1.1rem"></i><div class="mt-2">No QA issues found in current scope.</div></div></div>';
    return;
  }

  els.body.innerHTML = _qaGraphSummaryMarkup(summary)
    + _qaGraphRowsMarkup(summary);
}

function resetQaGraphPanel() {
  const els = _qaGraphElements();
  if (!els.panel || !els.body) return;
  els.panel.classList.add('d-none');
  els.body.innerHTML = '';
  _qaGraphSelectedSheet = '';
  if (typeof setQaResultsSheetFilter === 'function') setQaResultsSheetFilter('');
}
