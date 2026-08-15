// -- QA graph side panel ------------------------------------------------------
let _qaGraphCollapsed = false;
let _qaGraphWidth = 0;
let _qaGraphLastWidth = 0;
let _qaGraphSelectedSheet = '';
let _qaGraphSelectedKey = '';

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

function _qaGraphScopedResults() {
  return (qaRuleResults || []).filter(result =>
    !_qaGraphSelectedSheet || String(result.sheet || 'Workbook').toLowerCase() === _qaGraphSelectedSheet);
}

function _qaGraphToneChecks(tone) {
  return _qaGraphScopedResults().filter(result => {
    const fail = Number(result.fail || 0);
    const severity = _qaResultSeverity(result);
    if (tone === 'pass') return fail === 0;
    if (tone === 'advisory') return fail > 0 && severity === 'info';
    if (tone === 'warning') return fail > 0 && severity === 'warning';
    return fail > 0 && severity === 'error';
  }).map(result => String(result.check || '')).filter(Boolean);
}

// Clicking the active item clears the filter again.
function _qaGraphToggleFilter(key, checks) {
  const clearing = _qaGraphSelectedKey === key;
  if (!clearing && !checks.length) return;
  _qaGraphSelectedKey = clearing ? '' : key;
  if (typeof setQaResultsCheckFilter === 'function') setQaResultsCheckFilter(clearing ? [] : checks);
  refreshQaGraphPanel();
}

function _bindQaGraphSheetSelection(els) {
  if (!els?.body || els.body.dataset.sheetSelectionBound === '1') return;
  els.body.dataset.sheetSelectionBound = '1';
  els.body.addEventListener('click', event => {
    const chip = event.target.closest('[data-qa-tone]');
    if (chip) {
      const tone = chip.dataset.qaTone || '';
      _qaGraphToggleFilter('tone:' + tone, _qaGraphToneChecks(tone));
      return;
    }
    const pill = event.target.closest('[data-qa-sheet]');
    if (pill) {
      _qaGraphSelectedSheet = pill.dataset.qaSheet || '';
      _qaGraphSelectedKey = '';
      if (typeof setQaResultsSheetFilter === 'function') {
        setQaResultsSheetFilter(_qaGraphSelectedSheet);
      }
      refreshQaGraphPanel();
      return;
    }
    const ruleCard = event.target.closest('[data-qa-check]');
    if (ruleCard) {
      const check = ruleCard.dataset.qaCheck || '';
      _qaGraphToggleFilter('check:' + check, [check].filter(Boolean));
      return;
    }
    const columnHead = event.target.closest('[data-qa-checks]');
    if (columnHead) {
      const checks = String(columnHead.dataset.qaChecks || '').split('|').filter(Boolean);
      _qaGraphToggleFilter('column:' + checks.join('|'), checks);
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
    if (!groups.has(key)) groups.set(key, { key, label:name, pass:0, advisory:0, warning:0, error:0, fail:0, total:0 });
    const group = groups.get(key);
    const tally = _qaScoreTally([result]);
    group.pass += tally.pass;
    group.advisory += tally.advisory;
    group.warning += tally.warning;
    group.error += tally.error;
    group.fail += tally.fail;
    group.total += tally.total;
  });
  return [...groups.values()].map(group => ({
    ...group,
    score: _qaTallyScore(group),
  }));
}

function _qaGraphRuleDescription(result) {
  const check = String(result?.check || '');
  if (typeof _qaRuleDescriptionForCheck === 'function') {
    const description = _qaRuleDescriptionForCheck(check);
    if (description) return description;
  }
  return String(result?.label || QA_CHECKS?.[check]?.label || check);
}

// Check ids look like Sheet.Column.Check; the header only shows the trailing parts.
function _qaGraphRuleTitle(check) {
  const parts = String(check || '').split('.').filter(Boolean);
  if (parts.length > 2) return parts.slice(1).join(' ');
  return parts.join(' ') || String(check || '');
}

function _qaGraphCheckLabel(check) {
  const parts = String(check || '').split('.').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(check || '');
}

function _qaGraphColumnGroups(rows) {
  const groups = new Map();
  (rows || []).forEach(row => {
    const label = String(row.column || 'Sheet');
    const key = label.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label, colorToken:row.colorToken || '', pass:0, advisory:0, warning:0, error:0, fail:0, total:0, checks:[] });
    const group = groups.get(key);
    group.pass += row.pass;
    group.advisory += row.advisory;
    group.warning += row.warning;
    group.error += row.error;
    group.fail += row.fail;
    group.total += row.total;
    group.checks.push(row);
  });
  return [...groups.values()].map(group => ({
    ...group,
    score: _qaTallyScore(group),
  }));
}

function _qaGraphRuleRows(ruleResults) {
  return (ruleResults || []).filter(result => result.pass + result.fail > 0).map(result => {
    const tally = _qaScoreTally([result]);
    return {
      ...result,
      ...tally,
      score:_qaTallyScore(tally),
      description:_qaGraphRuleDescription(result),
    };
  });
}

function _qaGraphSummary(findings, ruleResults = qaRuleResults) {
  const sev = { error:0, warning:0, info:0 };
  findings.forEach(item => {
    const level = String(item?.sev || 'warning').toLowerCase();
    if (sev[level] === undefined) sev[level] = 0;
    sev[level]++;
  });

  const sheets = _qaGraphAggregate(ruleResults, 'sheet');
  if (_qaGraphSelectedSheet && !sheets.some(sheet => sheet.key === _qaGraphSelectedSheet)) {
    _qaGraphSelectedSheet = '';
  }
  const selectedResults = _qaGraphSelectedSheet
    ? (ruleResults || []).filter(result => String(result.sheet || 'Workbook').toLowerCase() === _qaGraphSelectedSheet)
    : ruleResults;
  // A selected severity chip narrows the breakdown to the rules of that type.
  const tone = _qaGraphSelectedKey.startsWith('tone:') ? _qaGraphSelectedKey.slice(5) : '';
  const toneChecks = tone ? new Set(_qaGraphToneChecks(tone)) : null;
  const rowResults = toneChecks
    ? (selectedResults || []).filter(result => toneChecks.has(String(result.check || '')))
    : selectedResults;
  const rows = _qaGraphSelectedSheet
    ? _qaGraphRuleRows(rowResults)
    : _qaGraphAggregate(rowResults, 'sheet');
  const tally = _qaScoreTally(selectedResults);
  const overallTally = _qaScoreTally(ruleResults);

  return {
    total: tally.total,
    pass: tally.pass,
    advisory: tally.advisory,
    warning: tally.warning,
    error: tally.error,
    fail: tally.fail,
    score: _qaTallyScore(tally),
    sev,
    sheets,
    rows,
    overallPass: overallTally.pass,
    overallAdvisory: overallTally.advisory,
    overallFail: overallTally.fail,
    overallTotal: overallTally.total,
    selectedSheet: sheets.find(sheet => sheet.key === _qaGraphSelectedSheet) || null,
  };
}

// Donut and bar fills use three stops: green to --qa-pass, blue to --qa-adv, orange to --qa-warn, red beyond.
function _qaGraphFillVars(tally) {
  const total = tally.total || 0;
  const pass = total ? (tally.pass / total) * 100 : 100;
  const advisory = total ? pass + (tally.advisory / total) * 100 : 100;
  const warning = total ? advisory + (tally.warning / total) * 100 : 100;
  return `--qa-pass:${pass}%;--qa-adv:${advisory}%;--qa-warn:${warning}%`;
}

function _qaGraphChipsMarkup(tally, interactive = false) {
  const tones = [
    { tone:'pass', key:'pass', label:'Passed' },
    { tone:'advisory', key:'advisory', label:'Advisory' },
    { tone:'warning', key:'warning', label:'Warning' },
    { tone:'fail', key:'error', label:'Error' },
  ];
  return tones.map(({ tone, key, label }) => {
    const toneKey = tone === 'fail' ? 'error' : tone;
    const active = interactive && _qaGraphSelectedKey === 'tone:' + toneKey;
    const attrs = interactive ? ` data-qa-tone="${toneKey}" role="button" tabindex="0"` : '';
    return `<div class="qa-graph-chip ${tone}${interactive ? ' is-clickable' : ''}${active ? ' is-active' : ''}" title="${label}"${attrs}><span class="n">${tally[key]}</span>${interactive ? `<span class="l">${label}</span>` : ''}</div>`;
  }).join('');
}

function _qaGraphSummaryMarkup(summary) {
  const sheetLabel = summary.selectedSheet ? summary.selectedSheet.label : 'All';
  const back = summary.selectedSheet
    ? '<span class="qa-graph-back"><i class="bi bi-arrow-left"></i>Back</span>'
    : '';
  const title = summary.selectedSheet ? 'Back to all sheets' : 'Showing results for all sheets';
  return `<button type="button" class="qa-graph-summary" data-qa-sheet="" title="${title}">
    <div class="qa-donut qa-donut-main" style="${_qaGraphFillVars(summary)}" role="img" aria-label="${summary.pass} checks passed, ${summary.advisory} advisory, ${summary.warning} warnings and ${summary.error} errors">
      <span>${summary.score}%</span>
    </div>
    <div class="qa-graph-summary-sheet">${esc(sheetLabel)}</div>
    <div class="qa-graph-totals">
      ${_qaGraphChipsMarkup(summary, true)}
    </div>
    ${back}
  </button>`;
}

function _qaGraphColumnCardMarkup(group) {
  const checks = group.checks.map(row => {
    const checkLabel = _qaGraphCheckLabel(row.check);
    const active = _qaGraphSelectedKey === 'check:' + row.check;
    return `<button type="button" class="qa-graph-check-row${active ? ' is-active' : ''}" data-qa-check="${esc(row.check)}" title="Filter results by ${esc(_qaGraphRuleTitle(row.check))}">
      <span class="qa-graph-check-bar" style="${_qaGraphFillVars(row)}" role="img" aria-label="${row.score}% score"></span>
      <span class="qa-graph-check-meta">
        <span class="qa-graph-check-name">${esc(checkLabel)}</span>
        <span class="qa-graph-rule-description">${esc(row.description)}</span>
      </span>
      <span class="qa-graph-cnt"><b>${row.pass}</b> <i>${row.advisory}</i> <u>${row.warning}</u> <strong>${row.error}</strong></span>
    </button>`;
  }).join('');

  const colorToken = String(group.colorToken || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const columnChecks = group.checks.map(row => String(row.check || '')).filter(Boolean).join('|');
  const columnActive = _qaGraphSelectedKey === 'column:' + columnChecks;
  return `<div class="qa-graph-column-card">
    <button type="button" class="qa-graph-column-head${columnActive ? ' is-active' : ''}" data-qa-checks="${esc(columnChecks)}" title="Show all ${esc(group.label)} checks"${colorToken ? ` style="--qa-column-header-bg:var(--${colorToken})"` : ''}>
      <div class="qa-donut" style="${_qaGraphFillVars(group)}" role="img" aria-label="${group.score}% score"><span>${group.score}%</span></div>
      <div class="qa-graph-meta">
        <span class="qa-graph-name">${esc(group.label)}</span>
      </div>
      <div class="qa-graph-column-chips">
        ${_qaGraphChipsMarkup(group)}
      </div>
    </button>
    <div class="qa-graph-check-list">${checks}</div>
  </div>`;
}

function _qaGraphRowsMarkup(summary) {
  const heading = summary.selectedSheet
    ? `${esc(summary.selectedSheet.label)} rules`
    : 'Sheet scores';
  const title = `<div class="qa-graph-breakdown-title">${heading}</div>`;
  if (summary.selectedSheet) {
    return title + _qaGraphColumnGroups(summary.rows).map(_qaGraphColumnCardMarkup).join('');
  }
  return title + summary.rows.map(row => `<button type="button" class="qa-graph-row qa-graph-sheet-row" data-qa-sheet="${esc(row.key)}" title="Filter results by ${esc(row.label)}">
      <div class="qa-donut" style="${_qaGraphFillVars(row)}" role="img" aria-label="${row.score}% score"><span>${row.score}%</span></div>
      <div class="qa-graph-meta">
        <span class="qa-graph-name">${esc(row.label)}</span>
      </div>
      <div class="qa-graph-column-chips">
        ${_qaGraphChipsMarkup(row)}
      </div>
    </button>`).join('');
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
