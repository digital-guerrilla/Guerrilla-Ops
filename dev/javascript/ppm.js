let _ppmState = { month:new Date().toISOString().slice(0, 7), view:'', status:'', data:null };
let _ppmDialogAction = null;
let _ppmDrag = null;

function _ppmWindow() {
  const first = _ppmState.month + '-01';
  const last = PPMScheduler.shift(first, 1, 'month', PPM_CONFIG.units);
  const from = _ppmState.from || first, to = _ppmState.to || last;
  PPMScheduler.parse(from);
  PPMScheduler.parse(to);
  if (from < first || to > last || from >= to) throw new Error('Choose a nonempty date window within the selected month; the end date is exclusive.');
  return { from, to };
}

function _ppmRangeControls() {
  const first = _ppmState.month + '-01';
  return `<label>Window start <input type="date" id="ppm-from" value="${esc(_ppmState.from || first)}"></label>
    <label>End (exclusive) <input type="date" id="ppm-to" value="${esc(_ppmState.to || PPMScheduler.shift(first, 1, 'month', PPM_CONFIG.units))}"></label>`;
}

function _ppmDateText(value) {
  return String(value || '').replace('T', ' ');
}

function _ppmFailure(error) {
  console.error('PPM:', error);
  const message = document.getElementById('ppm-dialog-error');
  if (message) {
    message.textContent = error.message;
    message.focus();
  } else alert('PPM: ' + error.message);
}

function _ppmValues(group, component) {
  const values = {};
  COBIE_FILTER_DIMENSIONS.forEach(filter => {
    values[filter.dimension] = component ? _componentFilterValues(component, filter) : [];
    if (filter.source === 'facility') values[filter.dimension] = [group.source._facility.toLowerCase()];
    if (filter.source === 'type' && !component) {
      values[filter.dimension] = [_ppmValue('Job', group.source, 'type').toLowerCase()].filter(Boolean);
    }
  });
  return values;
}

function _ppmFilter(groups, schedules, occurrences, counts) {
  const applicable = COBIE_FILTER_DIMENSIONS.filter(filter => filter.dimension !== _cobieDocumentCategoryDimension());
  const candidates = groups.flatMap(group => {
    const components = group.components.length ? group.components : [null];
    return components.map(component => ({
      group, component, values:_ppmValues(group, component),
      schedule:schedules.find(schedule => schedule.group.key === group.key && f(schedule.component, 'Name') === f(component || {}, 'Name')),
    }));
  });
  const matches = [];
  candidates.forEach(candidate => {
    const text = [
      ...candidate.group.rows.flatMap(row => _ppmColumns('Job').filter(column => column.search)
        .map(column => f(row, column.name))),
      candidate.group.name, f(candidate.component || {}, 'Name'), candidate.group.source._facility,
    ].join(' ').toLowerCase();
    if (searchQuery && !text.includes(searchQuery)) return;
    const failed = applicable.filter(filter => sel[filter.dimension].size &&
      !candidate.values[filter.dimension].some(value => sel[filter.dimension].has(value)));
    if (!failed.length) matches.push(candidate);
    applicable.forEach(filter => {
      if (failed.some(other => other !== filter)) return;
      candidate.values[filter.dimension].forEach(value => {
        counts[filter.dimension][value] = (counts[filter.dimension][value] || 0) + 1;
      });
    });
  });
  const scheduleIds = new Set(matches.map(candidate => candidate.schedule?.id).filter(Boolean));
  const filtered = occurrences.filter(occurrence => scheduleIds.has(occurrence.schedule.id) && !occurrence.task.milestone &&
    (!_ppmState.status || occurrence.status === _ppmState.status));
  return { candidates:matches, occurrences:filtered };
}

function _ppmBuildView(counts) {
  const groups = _ppmCatalog(), events = _ppmEvents(), schedules = _ppmSchedules(groups, events);
  const { from, to } = _ppmWindow();
  const start = PPMScheduler.parse(from).ms, end = PPMScheduler.parse(to).ms;
  const all = schedules.flatMap(schedule => _ppmProject(schedule, from, to, events));
  if (all.length > PPM_CONFIG.maxOccurrences) throw new Error(`More than ${PPM_CONFIG.maxOccurrences} occurrences. Narrow the date window or loaded workbooks.`);
  const inWindow = all.filter(item => {
    const begins = PPMScheduler.parse(item.start).ms, finishes = PPMScheduler.parse(item.end).ms;
    return begins < end && (finishes > start || (begins === finishes && begins >= start));
  });
  return { groups, events, schedules, all, from, to, ..._ppmFilter(groups, schedules, inWindow, counts) };
}

function applyPpmFilters() {
  const counts = Object.fromEntries(COBIE_FILTER_DIMENSIONS.map(filter => [filter.dimension, {}]));
  const list = document.getElementById('comp-list');
  try {
    if (PPM_CONFIG.error) throw new Error(PPM_CONFIG.error);
    const data = _ppmBuildView(counts);
    _ppmState.data = data;
    lastCounts = counts;
    renderPanels(counts);
    reapplyPanelSearches();
    renderPills();
    _ppmRender(list, data);
    document.getElementById('res-count').textContent = `${data.occurrences.length} maintenance occurrences`;
  } catch (error) {
    _ppmState.data = null;
    console.error('PPM:', error.message);
    list.innerHTML = `<section class="ppm"><h3>PPM needs attention</h3><p role="alert">${esc(error.message)}</p>
      ${PPM_CONFIG.error ? '' : `<div class="ppm-toolbar">${_ppmRangeControls()}</div>`}
      <button class="btn btn-outline-secondary" data-ppm-action="jobs">Inspect Jobs</button></section>`;
    document.getElementById('res-count').textContent = 'PPM data error';
  }
  document.getElementById('expand-all-btn').classList.add('d-none');
  if (typeof refreshQaGraphPanel === 'function') refreshQaGraphPanel();
  if (typeof refreshFloorSvgPanel === 'function') refreshFloorSvgPanel([], counts);
  if (typeof refreshThreeDViewerPanel === 'function') refreshThreeDViewerPanel([], counts);
}

function _ppmOccurrenceButton(item, index, extra = '') {
  const completed = item.completed;
  return `<button type="button" class="ppm-event ${completed ? 'ppm-completed' : ''} ${extra}"
    data-ppm-occurrence="${index}" ${completed ? '' : 'data-ppm-draggable="true"'}
    title="${esc(`${item.schedule.group.name} / ${f(item.schedule.component, 'Name')}: ${item.status}; ${_ppmDateText(item.start)} to ${_ppmDateText(item.end)}`)}">
    <span>${esc(item.task.number ? item.task.number + ': ' : '')}${esc(_ppmValue('Job', item.task.row, 'name'))}</span>
    <small>${esc(f(item.schedule.component, 'Name'))} &middot; ${esc(item.status)}</small></button>`;
}

function _ppmRender(list, data) {
  const now = Date.now(), unscheduled = data.candidates.filter(candidate => !candidate.schedule);
  const visible = data.occurrences;
  const overdue = visible.filter(item => !item.completed &&
    PPMScheduler.parse(item.end).ms + (item.start === item.end && item.end.length === 10 ? 86400000 : 0) < now).length;
  const completed = visible.filter(item => item.completed).length;
  const view = _ppmState.view || PPM_CONFIG.defaultView;
  const ignored = sel[_cobieDocumentCategoryDimension()]?.size
    ? '<p class="ppm-note">Document Category selections are retained but do not filter maintenance.</p>' : '';
  list.innerHTML = `<section class="ppm" aria-label="Planned preventive maintenance">
    <div class="ppm-toolbar">
      <h2>Planned Preventive Maintenance</h2>
      <button class="btn btn-sm btn-primary" data-ppm-action="new">New Job</button>
      <button class="btn btn-sm btn-outline-secondary" data-ppm-action="jobs">Jobs</button>
    </div>
    <div class="ppm-summary">
      <div><strong>${overdue}</strong>Overdue in window</div>
      <div><strong>${visible.length - completed}</strong>Outstanding in window</div>
      <div><strong>${completed}</strong>Completed in window</div>
      <div><strong>${unscheduled.length}</strong>Unscheduled Component / Job series</div>
    </div>
    <div class="ppm-toolbar">
      <button class="btn btn-sm btn-outline-secondary" data-ppm-action="previous" aria-label="Previous month">&lt;</button>
      <label>Month <input type="month" id="ppm-month" value="${esc(_ppmState.month)}"></label>
      <button class="btn btn-sm btn-outline-secondary" data-ppm-action="next" aria-label="Next month">&gt;</button>
      <button class="btn btn-sm btn-outline-secondary" data-ppm-action="today">Today</button>
      <label>Status <select id="ppm-status"><option value="">All statuses</option>${PPM_CONFIG.statuses.map(status =>
        `<option${status.name === _ppmState.status ? ' selected' : ''}>${esc(status.name)}</option>`).join('')}</select></label>
      <div role="group" aria-label="PPM presentation">
        <button class="btn btn-sm ${view === 'gantt' ? 'btn-primary' : 'btn-outline-secondary'}" data-ppm-action="gantt" aria-pressed="${view === 'gantt'}">Gantt</button>
        <button class="btn btn-sm ${view === 'calendar' ? 'btn-primary' : 'btn-outline-secondary'}" data-ppm-action="calendar" aria-pressed="${view === 'calendar'}">Calendar</button>
      </div>
    </div>${ignored}
    <div class="ppm-toolbar">${_ppmRangeControls()}</div>
    <p class="ppm-note">Charts count executable task occurrences in this month. Filter drawer counts are Component / Job series.
      Drag unfinished work to reschedule, or open it to use the date form. Dependency changes require confirmation.</p>
    ${view === 'calendar' ? _ppmCalendar(data) : _ppmGantt(data)}
    <details${unscheduled.length ? ' open' : ''}><summary>Unscheduled / unresolved (${unscheduled.length})</summary>
      <div class="ppm-job-list">${unscheduled.map(candidate => {
        const index = data.candidates.indexOf(candidate);
        return `<article><strong>${esc(candidate.group.name)}</strong> &middot; ${esc(f(candidate.component || {}, 'Name') || 'No resolved Component')}
          <p>${esc(candidate.group.error || 'Choose a first maintenance date. Future dates stay on a fixed cycle.')}</p>
          <button class="btn btn-sm btn-outline-secondary" data-ppm-job="${data.groups.indexOf(candidate.group)}">Job details</button>
          ${!candidate.group.error && candidate.component ? `<button class="btn btn-sm btn-primary" data-ppm-schedule="${index}">Schedule</button>` : ''}</article>`;
      }).join('') || '<p>All resolved Job series are scheduled.</p>'}</div>
    </details>
  </section>`;
}

function _ppmDays(data) {
  const days = [];
  let date = data.from;
  while (date < data.to) {
    days.push(date);
    date = PPMScheduler.shift(date, 1, 'day', PPM_CONFIG.units);
  }
  return days;
}

function _ppmCalendar(data) {
  const days = _ppmDays(data);
  const offset = (new Date(days[0] + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return `<div class="ppm-calendar" aria-label="Monthly maintenance calendar">
    ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => `<div class="ppm-weekday">${day}</div>`).join('')}
    ${Array.from({ length:offset }, () => '<div class="ppm-day ppm-day-blank"></div>').join('')}
    ${days.map(date => `<div class="ppm-day" data-ppm-date="${date}"><strong>${Number(date.slice(8))}</strong>
      ${data.occurrences.map((item, index) => {
        const dayStart = PPMScheduler.parse(date).ms;
        const nextDay = dayStart + 86400000;
        const start = PPMScheduler.parse(item.start).ms, end = PPMScheduler.parse(item.end).ms;
        return start < nextDay && (end > dayStart || start === dayStart)
          ? _ppmOccurrenceButton(item, index) : '';
      }).join('')}</div>`).join('')}
  </div>`;
}

function _ppmGantt(data) {
  const days = _ppmDays(data), width = days.length * 38;
  const start = PPMScheduler.parse(data.from).ms;
  const rows = data.occurrences.map((item, index) => {
    const left = Math.max(0, (PPMScheduler.parse(item.start).ms - start) / 86400000 * 38);
    const right = Math.min(width, Math.max(left + 8, (PPMScheduler.parse(item.end).ms - start) / 86400000 * 38));
    const priors = item.predecessors.map(key => item.schedule.group.tasks.find(task => task.key === key)?.number).filter(Boolean);
    return `<div class="ppm-gantt-row">
      <div class="ppm-gantt-label">${esc(f(item.schedule.component, 'Name'))}<br>
        <small>${esc(_ppmValue('Job', item.task.row, 'name'))} ${esc(item.task.number)}
        ${priors.length ? ` &larr; ${esc(priors.join(', '))}` : ''}</small></div>
      <div class="ppm-gantt-track" data-ppm-track="${index}" style="width:${width}px">
        <div class="ppm-bar" style="left:${left}px;width:${Math.max(8, right - left)}px">${_ppmOccurrenceButton(item, index)}</div>
      </div></div>`;
  }).join('');
  const lines = data.occurrences.flatMap((item, index) => item.predecessors.map(key => {
    const predecessorIndex = data.occurrences.findIndex(other => other.schedule.id === item.schedule.id &&
      other.cycle === item.cycle && other.key === key);
    if (predecessorIndex < 0) return '';
    const predecessor = data.occurrences[predecessorIndex];
    const x1 = Math.min(width, Math.max(0, (PPMScheduler.parse(predecessor.end).ms - start) / 86400000 * 38));
    const x2 = Math.min(width, Math.max(0, (PPMScheduler.parse(item.start).ms - start) / 86400000 * 38));
    return `<path d="M${x1} ${predecessorIndex * 64 + 32} H${x1 + 6} V${index * 64 + 32} H${x2}" />`;
  })).join('');
  return `<div class="ppm-gantt-scroll"><div class="ppm-gantt" style="width:${width + 210}px">
    <div class="ppm-gantt-row"><div class="ppm-gantt-label">Component / Job task</div><div class="ppm-gantt-dates">
      ${days.map(date => `<span>${Number(date.slice(8))}</span>`).join('')}</div></div>
    <div class="ppm-gantt-body">${rows}<svg class="ppm-dependencies" width="${width}" height="${data.occurrences.length * 64}" aria-hidden="true">${lines}</svg></div>
    ${!rows ? '<p>No maintenance occurrences in this month. Schedule a Job below or choose another month.</p>' : ''}
  </div></div>`;
}

function _ppmDialog(title, body, action = null, label = 'Save') {
  const dialog = document.getElementById('ppm-dialog');
  _ppmDialogAction = action;
  dialog.innerHTML = `<form method="dialog" id="ppm-form">
    <header><h3 id="ppm-dialog-title">${esc(title)}</h3><button value="cancel" formnovalidate aria-label="Close" class="btn btn-sm btn-outline-secondary">Close</button></header>
    <div id="ppm-dialog-error" class="ppm-error" role="alert" tabindex="-1"></div>
    <div class="ppm-dialog-body">${body}</div>
    <footer><button value="cancel" formnovalidate class="btn btn-outline-secondary">Cancel</button>
      ${action ? `<button type="button" id="ppm-dialog-save" class="btn btn-primary">${esc(label)}</button>` : ''}</footer>
  </form>`;
  _ppmInitControls(dialog);
  if (!dialog.open) dialog.showModal();
}

function _ppmControlValue(input) {
  const value = input.hasAttribute('multiple')
    ? [...input.options].filter(option => option.selected && option.value).map(option => option.value).join(', ')
    : String(input.value ?? '').trim();
  if (value === input.dataset.ppmInitial) return input.dataset.ppmOriginal ?? value;
  if (input.type === 'datetime-local' && value) {
    const offset = (input.dataset.ppmOriginal || '').match(/(?:[T ].*)(Z|[+-]\d{2}:\d{2})$/)?.[1] || '';
    return value + offset;
  }
  return value;
}

function _ppmInitControls(container) {
  container.querySelectorAll('[data-ppm-original]').forEach(input => {
    input.dataset.ppmInitial = input.hasAttribute('multiple')
      ? [...input.options].filter(option => option.selected && option.value).map(option => option.value).join(', ')
      : String(input.value ?? '').trim();
  });
  container.querySelectorAll('[data-ppm-date-mode]').forEach(select => select.addEventListener('change', () => {
    const input = document.getElementById(select.dataset.ppmDateMode), value = input.value;
    input.type = select.value;
    input.step = select.value === 'date' ? '1' : '0.001';
    input.value = select.value === 'date' ? value.slice(0, 10) : (value.length === 10 ? value + 'T00:00' : value);
  }));
}

function _ppmDateControl(id, value = '', required = false, format = '', field = '') {
  const type = format || (/[T ]\d{2}:\d{2}/.test(value) ? 'datetime-local' : 'date');
  const offset = value.match(/(?:[T ].*)(Z|[+-]\d{2}:\d{2})$/)?.[1];
  const dateValue = _projectDateInputValue(type === 'date' ? 'date' : 'datetime', value);
  return `${!format ? `<select data-ppm-date-mode="${id}" aria-label="Date precision">
      <option value="date"${type === 'date' ? ' selected' : ''}>Date only</option>
      <option value="datetime-local"${type === 'datetime-local' ? ' selected' : ''}>Date and time</option></select>` : ''}
    <input id="${id}" ${field} type="${type}" step="${type === 'date' ? '1' : '0.001'}" value="${esc(dateValue)}"
      data-ppm-original="${esc(value)}"${required ? ' required' : ''}>
    ${value && !dateValue ? `<small>Stored value: ${esc(value)}. Choose a date to replace it.</small>` : ''}
    ${offset ? `<small>Stored UTC offset ${esc(offset)} is preserved; no local-time conversion.</small>` : ''}`;
}

function _ppmRefresh() {
  document.getElementById('ppm-dialog').close();
  buildIdx();
  applyFilters();
}

function _ppmInspect() {
  const groups = _ppmCatalog();
  _ppmDialog('Maintenance Jobs', `<div class="ppm-job-list">${groups.map((group, index) => `<article>
    <strong>${esc(group.name)}</strong> &middot; ${esc(group.source._fileName)}
    ${group.error ? `<p class="ppm-error">${esc(group.error)}</p>` : ''}
    <button type="button" class="btn btn-sm btn-outline-secondary" data-ppm-inspect-job="${index}">Inspect / edit tasks</button>
    </article>`).join('') || '<p>No Job worksheet rows loaded. Use New Job to create maintenance templates.</p>'}
    </div>`);
}

function _ppmJobDetails(group) {
  const resources = group.rows.flatMap(row => _ppmValue('Job', row, 'resources').split(',').map(name => name.trim()).filter(Boolean));
  const documents = db.documents.filter(row => row._facility === group.source._facility &&
    f(row, 'SheetName', 'Table').toLowerCase() === 'job' && group.rows.some(job => _ppmValue('Job', job, 'name') === f(row, 'RowName', 'Table.Name')));
  _ppmDialog(group.name, `${group.error ? `<p class="ppm-error">${esc(group.error)}</p>` : ''}
    <div class="ppm-job-list">${group.rows.map((row, index) => `<article><h4>Task ${esc(_ppmValue('Job', row, 'number') || '(single)')}</h4>
      <dl>${_ppmColumns('Job').map(column => `<dt>${esc(column.label)}</dt><dd>${esc(f(row, column.name)) || '&mdash;'}</dd>`).join('')}</dl>
      <button type="button" class="btn btn-sm btn-primary" data-ppm-edit-task="${index}">Edit task</button></article>`).join('')}</div>
    <h4>Resources</h4>${resources.map(name => {
      const matches = db.resources.filter(row => _ppmOwner(row, group.source) && f(row, 'Name') === name);
      return `<p>${esc(name)}: ${esc(matches.length === 1 ? f(matches[0], 'Description') : 'Unresolved or ambiguous Resource reference')}</p>`;
    }).join('') || '<p>No resources specified.</p>'}
    <h4>Linked documents</h4>${documents.map(row => `<p>${esc(f(row, 'Name'))}: ${esc(f(row, 'Directory', 'Path'))}</p>`).join('') || '<p>No linked Job documents.</p>'}`);
  document.getElementById('ppm-dialog').querySelectorAll('[data-ppm-edit-task]').forEach(button =>
    button.addEventListener('click', () => _ppmEditJob(group.rows[Number(button.dataset.ppmEditTask)])));
}

function _ppmJobChoices(column, source, draft, original) {
  let choices = [];
  if (column.lookup) {
    const descriptor = COBIE_RUNTIME_MODEL.entities.get(column.lookup.toLowerCase());
    if (!descriptor) throw new Error(`Unknown PPM lookup worksheet: ${column.lookup}.`);
    choices = (db[descriptor.bucket] || []).filter(row => {
      if (column.scope === 'facility') return row._facility === source._facility;
      if (!_ppmOwner(row, source)) return false;
      return column.scope !== 'series' || (row !== original &&
        _ppmValue('Job', row, 'name').toLowerCase() === _ppmValue('Job', draft, 'name').toLowerCase() &&
        _ppmValue('Job', row, 'type').toLowerCase() === _ppmValue('Job', draft, 'type').toLowerCase() &&
        _ppmValue('Job', row, 'number') !== _ppmValue('Job', draft, 'number'));
    }).map(row => f(row, column.valueField));
  } else if (column.picklist) {
    choices = db.picklists.filter(row => _ppmOwner(row, source)).map(row => {
      const key = Object.keys(row).find(key => key.toLowerCase() === column.picklist.toLowerCase());
      return key ? v(row[key]) : '';
    }).filter(Boolean);
    if (!choices.length) choices = column.units ? PPM_CONFIG.units.map(unit => unit.name) : column.values;
  }
  return [...new Set(choices.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric:true }));
}

function _ppmJobControl(column, index, value, source, draft, original) {
  const id = `ppm-job-${index}`, attributes = `id="${id}" data-ppm-field="${index}" data-ppm-original="${esc(value)}"`;
  let control;
  if (column.input === 'select' || column.input === 'multiselect') {
    const multiple = column.input === 'multiselect', choices = _ppmJobChoices(column, source, draft, original);
    const selected = multiple ? value.split(',').map(value => value.trim()).filter(Boolean) : [value];
    const missing = selected.filter(value => value && !choices.includes(value));
    control = `<select ${attributes}${multiple ? ' multiple size="4"' : ''}>
      ${multiple ? '' : `<option value=""${!value ? ' selected' : ''}>Choose...</option>`}
      ${[...choices, ...new Set(missing)].map(choice => `<option value="${esc(choice)}"${selected.includes(choice) ? ' selected' : ''}>
        ${esc(choice)}${missing.includes(choice) ? ' (current; not in available choices)' : ''}</option>`).join('')}</select>
      ${multiple ? '<small>Use Ctrl or Cmd to select multiple items.</small>' : ''}
      ${!choices.length ? '<small>No matching workbook choices are available.</small>' : ''}`;
  } else if (column.input === 'datetime-local' || column.input === 'date') {
    control = _ppmDateControl(id, value, false, column.input, `data-ppm-field="${index}"`);
  } else if (column.input === 'textarea') {
    control = `<textarea ${attributes} rows="3">${esc(value)}</textarea>`;
  } else {
    const numeric = column.input === 'number';
    const invalid = numeric && value && !Number.isFinite(Number(value));
    control = `<input ${attributes} type="${esc(column.input)}" value="${esc(invalid ? '' : value)}"
      ${column.role === 'name' ? 'required' : ''}${column.generate === 'guid' ? ' readonly' : ''}
      ${numeric ? `min="${esc(column.min)}" step="${esc(column.step || 'any')}"` : ''}>
      ${invalid ? `<small>Stored value: ${esc(value)}. Choose a number to replace it.</small>` : ''}
      ${column.generate === 'guid' ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-ppm-generate="${id}">Generate identifier</button>` : ''}`;
  }
  return `<div class="ppm-field"><label for="${id}">${esc(column.label)}</label>${control}
    ${column.hint ? `<small>${esc(column.hint)}</small>` : ''}</div>`;
}

function _ppmReadJobFields(columns, original) {
  const values = { ...original };
  document.querySelectorAll('#ppm-dialog [data-ppm-field]').forEach(input => {
    const name = columns[Number(input.dataset.ppmField)].name, value = _ppmControlValue(input);
    if (!original || Object.hasOwn(original, name) || value) values[name] = value;
  });
  return values;
}

function _ppmEditJob(original = null, chosenSource = null, savedDraft = null) {
  const source = chosenSource || (original ? db.facilities.find(row => row._workbookKey === original._workbookKey) : db.facilities[0]);
  if (!source) throw new Error('Load a workbook before creating a Job.');
  const headerSource = original || db.jobs.find(row => _ppmOwner(row, source)) || {};
  const columns = _ppmColumns('Job').map(column => ({
    ...column, name:Object.keys(headerSource).find(key => key.toLowerCase() === column.name.toLowerCase()) || column.name,
  }));
  const draft = { ...(savedDraft || original) };
  columns.forEach(column => {
    const key = Object.keys(draft).find(key => key.toLowerCase() === column.name.toLowerCase());
    if (key && key !== column.name) {
      draft[column.name] = draft[key];
      delete draft[key];
    }
  });
  if (!original && !savedDraft) columns.forEach(column => {
    draft[column.name] = column.generate === 'guid' ? _projectGenerateGuid() :
      column.generate === 'timestamp' ? new Date().toISOString() : column.defaultValue;
    if (column.defaultValue && column.picklist &&
        !_ppmJobChoices(column, source, draft, original).includes(column.defaultValue)) draft[column.name] = '';
  });
  const groups = [...new Set(columns.map(column => column.group))];
  _ppmDialog(original ? 'Edit maintenance Job task' : 'New maintenance Job task',
    `${!original ? `<label>Workbook <select id="ppm-job-source">${db.facilities.map((row, index) =>
      `      <option value="${index}"${row === source ? ' selected' : ''}>${esc(row._fileName)} / ${esc(row._facility)}</option>`).join('')}</select></label>` : ''}
    <p>COBie 2.4: each row is one task. Use the same Name and TypeName for a task series.
      Task 0 is its summary milestone. Picklists come from the selected workbook; defaults and controls are defined in XML.</p>
    ${groups.map(group => `<fieldset class="ppm-fieldset"><legend>${esc(group || 'Job')}</legend><div class="ppm-fields">
      ${columns.map((column, index) => column.group === group
        ? _ppmJobControl(column, index, String(draft[column.name] ?? ''), source, draft, original) : '').join('')}
      </div></fieldset>`).join('')}`,
    () => {
      const values = _ppmReadJobFields(columns, original);
      const { from, to } = _ppmWindow();
      const result = _ppmSaveJob(original, values, source, from, to);
      if (result.previews) {
        _ppmDialog('Review template scheduling changes', `<p>This template edit also changes unfinished occurrences. Completed history is preserved.</p>
          ${result.previews.flatMap(preview => preview.changes).map(item =>
            `<p>${esc(f(item.schedule.component, 'Name'))}, task ${esc(item.task.number || 'single')}, cycle ${item.cycle + 1}:
            ${esc(_ppmDateText(item.start))} &ndash; ${esc(_ppmDateText(item.end))}</p>`).join('')}`, () => {
          _ppmSaveJob(original, values, source, from, to, true);
          _ppmRefresh();
        }, 'Apply template and schedule changes');
      } else _ppmRefresh();
    });
  if (!original) {
    const rerender = () => _ppmEditJob(null, db.facilities[Number(document.getElementById('ppm-job-source').value)],
      _ppmReadJobFields(columns, null));
    document.getElementById('ppm-job-source').addEventListener('change', rerender);
  }
  document.querySelectorAll('#ppm-dialog [data-ppm-generate]').forEach(button => button.addEventListener('click', () => {
    document.getElementById(button.dataset.ppmGenerate).value = _projectGenerateGuid();
  }));
  columns.forEach((column, index) => {
    if (!['name','type','number'].includes(column.role)) return;
    document.getElementById(`ppm-job-${index}`).addEventListener('change', () => {
      const values = _ppmReadJobFields(columns, original);
      columns.forEach((dependent, dependentIndex) => {
        if (dependent.scope !== 'series') return;
        const input = document.getElementById(`ppm-job-${dependentIndex}`);
        const temporary = document.createElement('div');
        temporary.innerHTML = _ppmJobControl(dependent, dependentIndex, String(values[dependent.name] || ''), source, values, original);
        input.parentElement.replaceWith(temporary.firstElementChild);
        _ppmInitControls(document.getElementById(`ppm-job-${dependentIndex}`).parentElement);
      });
    });
  });
}

function _ppmScheduleForm(candidate) {
  _ppmDialog(`Schedule ${candidate.group.name}`, `<p>Component: <strong>${esc(f(candidate.component, 'Name'))}</strong></p>
    <div class="ppm-field"><label for="ppm-anchor">First maintenance date/time</label>${_ppmDateControl('ppm-anchor', '', true)}</div>
    <p>The anchor is explicit. CreatedOn and numeric Start values are not interpreted as dates.</p>`, () => {
    _ppmCreateSchedule(candidate.group, candidate.component, _ppmControlValue(document.getElementById('ppm-anchor')));
    _ppmRefresh();
  }, 'Create fixed-cycle schedule');
}

function _ppmOccurrenceForm(item, proposedDate = null) {
  const data = _ppmState.data;
  const history = data.all.filter(other => other.schedule.id === item.schedule.id && other.key === item.key && other.completed);
  _ppmDialog(`${item.schedule.group.name} / ${f(item.schedule.component, 'Name')}`,
    `<p>Task ${esc(item.task.number || '(single)')}, cycle ${item.cycle + 1}.
      ${item.row ? 'Saved occurrence' : 'Projected from the saved schedule anchor'}.</p>
    <dl><dt>Original cycle start</dt><dd>${esc(_ppmDateText(item.nominal))}</dd><dt>Planned start</dt><dd>${esc(_ppmDateText(item.start))}</dd>
    <dt>Planned finish</dt><dd>${esc(_ppmDateText(item.end))}</dd><dt>Predecessors</dt>
    <dd>${esc(item.task.priors.join(', ') || 'None')}</dd></dl>
    ${!item.completed ? `<div class="ppm-fields">
      <div class="ppm-field"><label for="ppm-request">Requested start</label>${_ppmDateControl('ppm-request', proposedDate || item.start, true)}</div>
      <label>Apply move to <select id="ppm-scope"><option value="one">This occurrence only</option><option value="future">This and future unfinished cycles</option></select></label>
      <label>${esc(PPM_CONFIG.attributes.status.label)} <select id="ppm-occurrence-status">${PPM_CONFIG.statuses.map(status =>
        `<option${status.name === item.status ? ' selected' : ''}>${esc(status.name)}</option>`).join('')}</select></label>
      <div class="ppm-field"><label for="ppm-actual">${esc(PPM_CONFIG.attributes.actual.label)}</label>${_ppmDateControl('ppm-actual')}</div>
    </div><p>Future-series moves re-anchor from this cycle. Completed history is never moved.
      Completion and rescheduling are separate actions.</p>` : `<p>${esc(item.status)}: ${esc(_ppmDateText(item.actual))}. Completed history is read-only.</p>`}
    <details><summary>Saved completion history (${history.length})</summary>${history.map(other =>
      `<p>Cycle ${other.cycle + 1}: ${esc(_ppmDateText(other.actual))}</p>`).join('')}</details>`,
    item.completed ? null : () => {
      const preview = _ppmPreview(item.schedule, item,
        _ppmControlValue(document.getElementById('ppm-request')),
        document.getElementById('ppm-scope').value,
        document.getElementById('ppm-occurrence-status').value,
        _ppmControlValue(document.getElementById('ppm-actual')), data.from, data.to);
      _ppmPreviewDialog(preview);
    }, 'Preview changes');
}

function _ppmPreviewDialog(preview) {
  const data = _ppmState.data;
  _ppmDialog('Review maintenance changes', `<p>${preview.changes.length} affected occurrences in the calculated window and saved history.
    ${preview.scope === 'future' ? 'Later projected cycles will also use the new fixed anchor.' : 'The future fixed cycle is unchanged.'}</p>
    <div class="ppm-preview"><table><thead><tr><th>Task / cycle</th><th>Previous</th><th>New dates</th><th>Status</th></tr></thead><tbody>
      ${preview.changes.map(item => {
        const previous = preview.before.find(old => old.id === item.id);
        return `<tr><td>${esc(item.task.number || 'Job')} / ${item.cycle + 1}</td><td>${esc(_ppmDateText(previous?.start))}</td>
          <td>${esc(_ppmDateText(item.start))} &ndash; ${esc(_ppmDateText(item.end))}</td><td>${esc(item.status)}</td></tr>`;
      }).join('')}</tbody></table></div>`, () => {
    const fresh = _ppmSchedules(_ppmCatalog()).find(schedule => schedule.id === preview.schedule.id);
    if (!fresh) throw new Error('The schedule is no longer available.');
    // The modal prevents concurrent edits; revalidate before committing any rows.
    _ppmProject(preview.proposed, data.from, data.to);
    _ppmCommit(preview);
    _ppmRefresh();
  }, 'Apply all changes');
}

function initPpm() {
  const dialog = document.getElementById('ppm-dialog'), list = document.getElementById('comp-list');
  dialog.addEventListener('click', event => {
    if (event.target.closest('#ppm-dialog-save')) {
      try { if (dialog.querySelector('form').reportValidity()) _ppmDialogAction?.(); }
      catch (error) { _ppmFailure(error); }
    }
    const inspect = event.target.closest('[data-ppm-inspect-job]');
    if (inspect) {
      try { _ppmJobDetails(_ppmCatalog()[Number(inspect.dataset.ppmInspectJob)]); }
      catch (error) { _ppmFailure(error); }
    }
  });
  list.addEventListener('click', event => {
    if (viewMode !== 'ppm' || _ppmDrag?.moved) return;
    try {
      const occurrence = event.target.closest('[data-ppm-occurrence]');
      if (occurrence) return _ppmOccurrenceForm(_ppmState.data.occurrences[Number(occurrence.dataset.ppmOccurrence)]);
      const job = event.target.closest('[data-ppm-job]');
      if (job) return _ppmJobDetails(_ppmState.data.groups[Number(job.dataset.ppmJob)]);
      const schedule = event.target.closest('[data-ppm-schedule]');
      if (schedule) return _ppmScheduleForm(_ppmState.data.candidates[Number(schedule.dataset.ppmSchedule)]);
      const action = event.target.closest('[data-ppm-action]')?.dataset.ppmAction;
      if (action === 'new') return _ppmEditJob();
      if (action === 'jobs') return _ppmInspect();
      if (!action) return;
      if (['gantt','calendar'].includes(action)) _ppmState.view = action;
      if (action === 'today') _ppmState.month = new Date().toISOString().slice(0, 7);
      if (['next','previous'].includes(action)) {
        const date = new Date(_ppmState.month + '-01T00:00:00Z');
        date.setUTCMonth(date.getUTCMonth() + (action === 'next' ? 1 : -1));
        _ppmState.month = date.toISOString().slice(0, 7);
      }
      if (['next','previous','today'].includes(action)) { _ppmState.from = ''; _ppmState.to = ''; }
      applyFilters();
    } catch (error) { _ppmFailure(error); }
  });
  list.addEventListener('change', event => {
    if (event.target.id === 'ppm-month') {
      if (!/^\d{4}-\d{2}$/.test(event.target.value)) return _ppmFailure(new Error('Choose a valid month.'));
      _ppmState.month = event.target.value;
      _ppmState.from = '';
      _ppmState.to = '';
      applyFilters();
    }
    if (['ppm-from','ppm-to'].includes(event.target.id)) {
      _ppmState[event.target.id === 'ppm-from' ? 'from' : 'to'] = event.target.value;
      applyFilters();
    }
    if (event.target.id === 'ppm-status') {
      _ppmState.status = event.target.value;
      applyFilters();
    }
  });
  list.addEventListener('pointerdown', event => {
    if (viewMode !== 'ppm' || event.button !== 0 || event.isPrimary === false) return;
    const button = event.target.closest('[data-ppm-draggable]');
    if (!button) return;
    _ppmDrag = { button, pointerId:event.pointerId, x:event.clientX, y:event.clientY, moved:false,
      index:Number(button.dataset.ppmOccurrence), track:button.closest('.ppm-gantt-track') };
  });
  document.addEventListener('pointermove', event => {
    if (!_ppmDrag || event.pointerId !== _ppmDrag.pointerId) return;
    if (Math.hypot(event.clientX - _ppmDrag.x, event.clientY - _ppmDrag.y) > 5) {
      _ppmDrag.moved = true;
      _ppmDrag.button.classList.add('ppm-dragging');
      event.preventDefault();
    }
  }, { passive:false });
  document.addEventListener('pointerup', event => {
    const drag = _ppmDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.button.classList.remove('ppm-dragging');
    if (drag.moved) {
      try {
        const item = _ppmState.data.occurrences[drag.index];
        let date;
        if (drag.track) {
          const amount = Math.round((event.clientX - drag.x) / 38);
          if (amount >= 0) date = PPMScheduler.shift(item.start, amount, 'day', PPM_CONFIG.units);
          else {
            const parsed = PPMScheduler.parse(item.start);
            date = PPMScheduler.format({ ...parsed, ms:parsed.ms + amount * 86400000 });
          }
        } else {
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-ppm-date]');
          if (!target) throw new Error('Drop onto a calendar day, or use the occurrence date form.');
          date = target.dataset.ppmDate + (item.start.length > 10 ? item.start.slice(10) : '');
        }
        _ppmOccurrenceForm(item, date);
      } catch (error) { _ppmFailure(error); }
      setTimeout(() => { if (_ppmDrag === drag) _ppmDrag = null; }, 0);
    } else _ppmDrag = null;
  });
  const cancelDrag = () => {
    _ppmDrag?.button.classList.remove('ppm-dragging');
    _ppmDrag = null;
  };
  document.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelDrag(); });
}

function resetPpm() {
  _ppmDrag = null;
  _ppmState = { month:new Date().toISOString().slice(0, 7), view:'', status:'', data:null };
  document.getElementById('ppm-dialog')?.close();
}
