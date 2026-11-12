function _ppmReadConfig() {
  const xml = _cobieSchemaDocument();
  const root = _cobieDirectChild(xml?.documentElement, 'ppm');
  if (!root) throw new Error('The XML specification has no PPM configuration.');
  const describe = column => {
    const metadata = _cobieDirectChild(column, 'ppm');
    return {
      name:column.getAttribute('name'),
      label:_cobieColumnAttribute(column, 'ui', 'label') || _modalConfigLabel(column.getAttribute('name')),
      group:_cobieColumnAttribute(column, 'ui', 'groupTitle'),
      role:metadata?.getAttribute('role') || '',
      search:metadata?.getAttribute('search') === 'true',
      input:metadata?.getAttribute('input') || 'text',
      lookup:metadata?.getAttribute('lookup') || '',
      valueField:metadata?.getAttribute('valueField') || '',
      scope:metadata?.getAttribute('scope') || '',
      picklist:metadata?.getAttribute('picklist') || '',
      values:_cobieRuntimeList(metadata?.getAttribute('values')),
      units:metadata?.getAttribute('units') === 'true',
      defaultValue:metadata?.getAttribute('default') || '',
      generate:metadata?.getAttribute('generate') || '',
      min:metadata?.getAttribute('min') || '',
      step:metadata?.getAttribute('step') || '',
      hint:metadata?.getAttribute('hint') || '',
    };
  };
  const columns = new Map(_cobieSheetNodes(xml).map(sheet => [
    sheet.getAttribute('name'), _cobieColumnNodes(sheet).map(describe),
  ]));
  const records = _cobieDirectChild(root, 'records');
  columns.set('Record', _cobieChildren(records, 'column').map(describe));
  const units = _cobieChildren(_cobieDirectChild(root, 'units'), 'unit').map(node => ({
    name:node.getAttribute('name'), aliases:_cobieRuntimeList(node.getAttribute('aliases')),
    minutes:Number(node.getAttribute('minutes') || 0), months:Number(node.getAttribute('months') || 0),
  }));
  const statuses = _cobieChildren(_cobieDirectChild(root, 'statuses'), 'status').map(node => ({
    name:node.getAttribute('name'), initial:node.getAttribute('initial') === 'true',
    completed:node.getAttribute('completed') === 'true',
  }));
  const attributes = Object.fromEntries(_cobieChildren(_cobieDirectChild(root, 'attributes'), 'attribute')
    .map(node => [node.getAttribute('role'), { name:node.getAttribute('name'), label:node.getAttribute('label') }]));
  const required = ['record','schedule','task','component','anchor','segments','cycle','nominal','requested','status','actual'];
  if (required.some(role => !attributes[role]?.name) || !units.length ||
      new Set(Object.values(attributes).map(attribute => attribute.name)).size !== Object.keys(attributes).length ||
      new Set(statuses.map(status => status.name)).size !== statuses.length ||
      statuses.some(status => !status.name) ||
      units.some(unit => !unit.name || !unit.aliases.length || !Number.isFinite(unit.minutes) || !Number.isFinite(unit.months) ||
        unit.minutes < 0 || unit.months < 0 || Number(unit.minutes > 0) + Number(unit.months > 0) !== 1) ||
      new Set(units.flatMap(unit => unit.aliases)).size !== units.flatMap(unit => unit.aliases).length ||
      statuses.filter(status => status.initial).length !== 1 || statuses.filter(status => status.completed).length !== 1 ||
      !Number.isSafeInteger(Number(root.getAttribute('maxOccurrences'))) || Number(root.getAttribute('maxOccurrences')) < 1 ||
      root.getAttribute('dependency') !== 'finish-to-start' || root.getAttribute('recurrence') !== 'fixed') {
    throw new Error('Invalid PPM attributes, units, statuses or scheduling policies in the XML specification.');
  }
  const config = {
    columns, units, statuses, attributes, recordPrefix:records?.getAttribute('attributePrefix'),
    maxOccurrences:Number(root.getAttribute('maxOccurrences')),
    category:root.getAttribute('attributeCategory'), defaultView:root.getAttribute('defaultView'),
    initial:statuses.find(status => status.initial).name,
    completed:statuses.find(status => status.completed).name,
  };
  for (const [sheet, roles] of [
    ['Job', ['name','identifier','resources','duration','durationUnit','interval','intervalUnit','number','priors','type']],
    ['Record', ['name','job','start','end','component']],
  ]) {
    if (roles.some(role => !columns.get(sheet)?.some(column => column.role === role))) {
      throw new Error(`Missing PPM role mapping on the ${sheet} worksheet.`);
    }
  }
  if (!config.recordPrefix) throw new Error('Missing PPM record Attribute prefix.');
  return config;
}

let PPM_CONFIG;
try { PPM_CONFIG = _ppmReadConfig(); }
catch (error) {
  PPM_CONFIG = { error:error.message };
  console.error('PPM configuration:', error.message);
}

function _ppmColumns(sheet) {
  return PPM_CONFIG.columns.get(sheet) || [];
}

function _ppmValue(sheet, row, role) {
  const column = PPM_CONFIG.columns.get(sheet)?.find(item => item.role === role);
  if (!column) throw new Error(`Missing ${sheet} role: ${role}.`);
  const names = [column.name.toLowerCase()];
  const keys = Object.keys(row).filter(name => names.includes(name.toLowerCase()));
  const populated = keys.filter(key => v(row[key]));
  if (new Set(populated.map(key => v(row[key]).toLowerCase())).size > 1) {
    throw new Error(`Conflicting ${sheet} fields for ${role}: ${populated.join(', ')}.`);
  }
  const key = populated[0] || keys[0];
  return key ? v(row[key]) : '';
}

function _ppmSet(sheet, row, role, value) {
  const column = PPM_CONFIG.columns.get(sheet).find(item => item.role === role);
  if (!column) throw new Error(`Missing ${sheet} role: ${role}.`);
  const names = [column.name.toLowerCase()];
  const keys = Object.keys(row).filter(name => names.includes(name.toLowerCase()));
  const populated = keys.filter(key => v(row[key]));
  (populated.length ? populated : [keys[0] || column.name]).forEach(key => { row[key] = value; });
}

function _ppmOwner(row, other) {
  return row._facility === other._facility && row._workbookKey === other._workbookKey;
}

function _ppmOwnsAttribute(row) {
  return !PPM_CONFIG.error && (
    (f(row, 'Name').startsWith(PPM_CONFIG.recordPrefix) && f(row, 'SheetName').toLowerCase() === 'job') ||
    (Object.values(PPM_CONFIG.attributes).some(definition => definition.name === f(row, 'Name')) &&
      f(row, 'SheetName', 'Table').toLowerCase() === 'event'));
}

function _ppmTag(row, source) {
  return Object.assign(row, {
    _facility:source._facility, _workbookKey:source._workbookKey,
    _fileName:source._fileName, _projectCode:source._projectCode,
  });
}

function _ppmTaskKey(row) {
  // Retain the tuple shape used by previously saved COBie 2.4 PPM schedules.
  return JSON.stringify([...['name','number','identifier','type']
    .map(role => _ppmValue('Job', row, role).toLowerCase()), '', '', '']);
}

function _ppmCatalog(rows = db.jobs) {
  if (PPM_CONFIG.error) throw new Error(PPM_CONFIG.error);
  const groups = new Map();
  rows.forEach(row => {
    const name = _ppmValue('Job', row, 'name'), type = _ppmValue('Job', row, 'type');
    const key = JSON.stringify([row._workbookKey, row._facility, name.toLowerCase(), type.toLowerCase()]);
    if (!groups.has(key)) groups.set(key, { key, name, source:row, rows:[], tasks:[], components:[], error:'' });
    groups.get(key).rows.push(row);
  });
  groups.forEach(group => {
    try {
      group.tasks = group.rows.map(row => {
        const number = _ppmValue('Job', row, 'number');
        if (number && !/^\d+$/.test(number)) throw new Error('TaskNumber must be a nonnegative integer.');
        const durationText = _ppmValue('Job', row, 'duration');
        const duration = Number(durationText);
        const milestone = group.rows.length > 1 && number === '0';
        if (!milestone && (!durationText || !Number.isFinite(duration) || duration < 0)) throw new Error('A nonnegative Duration is required.');
        const durationUnit = milestone ? PPM_CONFIG.units[0].name : _ppmValue('Job', row, 'durationUnit');
        PPMScheduler.unit(durationUnit, PPM_CONFIG.units);
        return {
          key:_ppmTaskKey(row), number, row, duration, durationUnit, milestone,
          priors:_ppmValue('Job', row, 'priors').split(',').map(value => value.trim()).filter(Boolean),
        };
      });
      if (new Set(group.tasks.map(task => task.key)).size !== group.tasks.length) throw new Error('Duplicate task identities must be resolved before scheduling.');
      PPMScheduler.graph(group.tasks);
      const root = group.tasks.find(task => task.number === '0') || group.tasks[0];
      group.interval = Number(_ppmValue('Job', root.row, 'interval'));
      group.intervalUnit = _ppmValue('Job', root.row, 'intervalUnit');
      if (!(group.interval > 0) || !Number.isFinite(group.interval)) throw new Error('A positive recurrence interval is required.');
      PPMScheduler.shift('2024-01-01', group.interval, group.intervalUnit, PPM_CONFIG.units);
      group.rows.forEach(row => {
        const interval = _ppmValue('Job', row, 'interval'), unit = _ppmValue('Job', row, 'intervalUnit');
        if (interval && (Number(interval) !== group.interval ||
            PPMScheduler.unit(unit, PPM_CONFIG.units).name !== PPMScheduler.unit(group.intervalUnit, PPM_CONFIG.units).name)) {
          throw new Error('Tasks in a series must have the same recurrence interval.');
        }
      });
      const source = group.source;
      const name = _ppmValue('Job', source, 'type').toLowerCase();
      if (!name) throw new Error('Choose a Type maintenance target.');
      group.components = db.components.filter(component => component._facility === source._facility &&
        _cobieField(component, 'typeName').toLowerCase() === name);
      const names = group.components.map(component => f(component, 'Name').toLowerCase());
      if (new Set(names).size !== names.length) throw new Error('Component names are ambiguous in this facility; resolve duplicate targets first.');
      if (!group.components.length) throw new Error('No matching installed Components; fix the target or load its asset workbook.');
    } catch (error) { group.error = error.message; }
  });
  return [...groups.values()];
}

function _ppmAttributeRows(event) {
  const name = PPM_CONFIG.recordPrefix + _ppmValue('Record', event, 'name');
  return db.attributes.filter(row => _ppmOwner(row, event) &&
    f(row, 'SheetName').toLowerCase() === 'job' && f(row, 'Name') === name);
}

function _ppmMetadata(event) {
  return { ...event._ppmMetadata };
}

function _ppmEvents() {
  const records = db.attributes.filter(row => f(row, 'Name').startsWith(PPM_CONFIG.recordPrefix) &&
    f(row, 'SheetName').toLowerCase() === 'job').map(attribute => {
    let data;
    try { data = JSON.parse(f(attribute, 'Value')); }
    catch (error) { throw new Error(`Invalid ${f(attribute, 'Name')} Attribute: ${error.message}`); }
    if (!data || typeof data !== 'object' || !data.fields || typeof data.fields !== 'object' ||
        Array.isArray(data.fields) || Object.values(data.fields).some(value => typeof value !== 'string') ||
        !data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata) ||
        !['schedule','occurrence'].includes(data.metadata.record) ||
        Object.entries(data.metadata).some(([role, value]) => !PPM_CONFIG.attributes[role] || typeof value !== 'string')) {
      throw new Error(`Invalid maintenance record in ${f(attribute, 'Name')}.`);
    }
    const row = _ppmTag({ ...data.fields, _ppmMetadata:data.metadata }, attribute);
    if (PPM_CONFIG.recordPrefix + _ppmValue('Record', row, 'name') !== f(attribute, 'Name') ||
        _ppmValue('Record', row, 'job') !== f(attribute, 'RowName')) {
      throw new Error(`Inconsistent maintenance record identity in ${f(attribute, 'Name')}.`);
    }
    return { row, metadata:_ppmMetadata(row) };
  });
  // Read only app-owned records from earlier builds; never adopt arbitrary Event data.
  db.facilities.forEach(source => {
    const attributes = db.attributes.filter(row => _ppmOwner(row, source) &&
      f(row, 'SheetName', 'Table').toLowerCase() === 'event');
    if (!attributes.some(row => f(row, 'Name') === PPM_CONFIG.attributes.record.name)) return;
    readSheet(source._workbook, 'Event').forEach(legacy => {
      const name = f(legacy, 'Name');
      if (records.some(record => _ppmOwner(record.row, source) && _ppmValue('Record', record.row, 'name') === name)) return;
      const metadata = {};
      Object.entries(PPM_CONFIG.attributes).forEach(([role, definition]) => {
        const matches = attributes.filter(row => f(row, 'RowName', 'Table.Name') === name && f(row, 'Name') === definition.name);
        if (matches.length > 1) throw new Error(`Duplicate ${definition.name} on maintenance record ${name}.`);
        if (matches.length) metadata[role] = f(matches[0], 'Value');
      });
      if (!['schedule','occurrence'].includes(metadata.record)) return;
      const row = _ppmNewEvent(source);
      [['name',name], ['job',f(legacy, 'Job.Name')], ['component',metadata.component],
        ['start',f(legacy, 'StartDate')], ['end',f(legacy, 'EndDate')]].forEach(([role, value]) => _ppmSet('Record', row, role, value));
      row._ppmMetadata = metadata;
      records.push({ row, metadata });
    });
  });
  const identities = records.map(record => JSON.stringify([record.row._workbookKey, record.row._facility, _ppmValue('Record', record.row, 'name')]));
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate maintenance record identities.');
  return records;
}

function _ppmSchedules(catalog, events = _ppmEvents()) {
  const schedules = events.filter(event => event.metadata.record === 'schedule').map(event => {
    const group = catalog.find(candidate => candidate.tasks.some(task => task.key === event.metadata.task) && _ppmOwner(candidate.source, event.row));
    if (!group) throw new Error(`Schedule ${f(event.row, 'Name')} has an unresolved or changed Job identity.`);
    if (group.error) throw new Error(`${group.name}: ${group.error}`);
    const component = group.components.find(row => f(row, 'Name') === event.metadata.component);
    if (!component) throw new Error(`Schedule ${f(event.row, 'Name')} has an unresolved Component.`);
    let segments;
    try { segments = JSON.parse(event.metadata.segments || '[]'); }
    catch (error) { throw new Error(`Invalid series segments on ${f(event.row, 'Name')}: ${error.message}`); }
    if (!Array.isArray(segments) || segments.some(segment => !Number.isSafeInteger(segment.cycle) || segment.cycle < 0 || !segment.anchor)) {
      throw new Error(`Invalid series segment structure on ${f(event.row, 'Name')}.`);
    }
    segments.forEach(segment => PPMScheduler.parse(segment.anchor));
    const ordinals = segments.map(segment => segment.cycle);
    if (new Set(ordinals).size !== ordinals.length) throw new Error('Duplicate series segment ordinals.');
    PPMScheduler.parse(event.metadata.anchor);
    return { ...event, group, component, segments:segments.sort((a, b) => a.cycle - b.cycle), id:event.metadata.schedule };
  });
  if (schedules.some(schedule => !schedule.id) || new Set(schedules.map(schedule => schedule.id)).size !== schedules.length) {
    throw new Error('Missing or duplicated schedule identifiers. Resolve copied schedule anchors before editing.');
  }
  const targets = schedules.map(schedule => JSON.stringify([schedule.group.key, f(schedule.component, 'Name')]));
  if (new Set(targets).size !== targets.length) throw new Error('Duplicate Component / Job schedules must be resolved.');
  return schedules;
}

function _ppmSaved(schedule, events) {
  const matches = events.filter(event => event.metadata.record === 'occurrence' &&
    event.metadata.schedule === schedule.id && _ppmOwner(event.row, schedule.row));
  const saved = new Map();
  matches.forEach(event => {
    const metadata = event.metadata;
    const cycle = Number(metadata.cycle);
    if (!Number.isSafeInteger(cycle) || cycle < 0 || !schedule.group.tasks.some(task => task.key === metadata.task)) {
      throw new Error(`Invalid occurrence identity on ${f(event.row, 'Name')}.`);
    }
    const key = JSON.stringify([cycle, metadata.task]);
    if (saved.has(key)) throw new Error('Duplicate saved occurrence identities.');
    if (!PPM_CONFIG.statuses.some(status => status.name === metadata.status)) throw new Error('An occurrence has an unknown operational status.');
    saved.set(key, {
      ...event, cycle, key:metadata.task, nominal:metadata.nominal,
      requested:metadata.requested, status:metadata.status, actual:metadata.actual,
      start:_ppmValue('Record', event.row, 'start'), end:_ppmValue('Record', event.row, 'end'),
    });
  });
  return saved;
}

function _ppmNominal(schedule, cycle) {
  const segment = [...schedule.segments].reverse().find(item => item.cycle <= cycle);
  return PPMScheduler.shift(segment?.anchor || schedule.metadata.anchor,
    (cycle - (segment?.cycle || 0)) * schedule.group.interval, schedule.group.intervalUnit, PPM_CONFIG.units);
}

function _ppmProject(schedule, from, to, events = _ppmEvents(), overrides = new Map()) {
  const saved = _ppmSaved(schedule, events), ordinals = new Set([0]);
  const lookbackMinutes = schedule.group.tasks.reduce((sum, task) => {
    const unit = PPMScheduler.unit(task.durationUnit, PPM_CONFIG.units);
    return sum + (task.milestone ? 0 : task.duration * (unit.minutes || unit.months * 31 * 1440));
  }, 0);
  const rangeStart = PPMScheduler.parse(from);
  const lookback = PPMScheduler.format({ ...rangeStart, ms:rangeStart.ms - lookbackMinutes * 60000, dateOnly:false });
  saved.forEach(occurrence => ordinals.add(occurrence.cycle));
  overrides.forEach(occurrence => ordinals.add(occurrence.cycle));
  const boundaries = [{ cycle:0, anchor:schedule.metadata.anchor }, ...schedule.segments];
  boundaries.forEach((segment, index) => {
    const first = Math.max(segment.cycle, segment.cycle + PPMScheduler.ordinal(segment.anchor, lookback,
      schedule.group.interval, schedule.group.intervalUnit, PPM_CONFIG.units) - 1);
    const last = Math.min(boundaries[index + 1] ? boundaries[index + 1].cycle - 1 : Infinity,
      segment.cycle + PPMScheduler.ordinal(segment.anchor, to, schedule.group.interval, schedule.group.intervalUnit, PPM_CONFIG.units) + 1);
    if ((last - first + 1) * schedule.group.tasks.length > PPM_CONFIG.maxOccurrences) {
      throw new Error(`More than ${PPM_CONFIG.maxOccurrences} occurrences. Narrow the date window.`);
    }
    for (let cycle = first; cycle <= last; cycle++) ordinals.add(cycle);
  });
  if (ordinals.size * schedule.group.tasks.length > PPM_CONFIG.maxOccurrences) throw new Error('Too many saved occurrences to safely recalculate.');
  return [...ordinals].sort((a, b) => a - b).flatMap(cycle => {
    const nominal = _ppmNominal(schedule, cycle), inputs = new Map();
    schedule.group.tasks.forEach(task => {
      const key = JSON.stringify([cycle, task.key]);
      const previous = saved.get(key);
      const override = overrides.get(key);
      if (previous || override) inputs.set(task.key, { ...previous, ...override });
    });
    return PPMScheduler.cycle(schedule.group.tasks, nominal, inputs, PPM_CONFIG.units, PPM_CONFIG.completed)
      .map(occurrence => ({
        ...occurrence, cycle, schedule, id:JSON.stringify([schedule.id, cycle, occurrence.key]),
        status:occurrence.status || PPM_CONFIG.initial,
        task:schedule.group.tasks.find(task => task.key === occurrence.key),
      }));
  });
}

function _ppmNewEvent(source) {
  return _ppmTag(Object.fromEntries(_ppmColumns('Record').map(column => [column.name, ''])), source);
}

function _ppmWriteMetadata(event, metadata) {
  const values = { ..._ppmMetadata(event) };
  Object.entries(metadata).forEach(([role, value]) => {
    if (!PPM_CONFIG.attributes[role]) throw new Error(`Unknown PPM Attribute role: ${role}.`);
    values[role] = String(value ?? '');
  });
  const matches = _ppmAttributeRows(event);
  if (matches.length > 1) throw new Error('Duplicate maintenance record Attributes.');
  let row = matches[0];
  if (!row) {
    row = _ppmTag({
      Name:PPM_CONFIG.recordPrefix + _ppmValue('Record', event, 'name'),
      CreatedBy:'n/a', CreatedOn:new Date().toISOString(), Category:PPM_CONFIG.category,
      SheetName:'Job', RowName:'', Value:'', Unit:'n/a',
      ExtSystem:'Guerrilla Ops', ExtObject:'n/a', ExtIdentifier:_projectGenerateGuid(),
      Description:'Planned preventive maintenance scheduling record', AllowedValues:'n/a',
    }, event);
    db.attributes.push(row);
  }
  row.RowName = _ppmValue('Record', event, 'job');
  row.Value = JSON.stringify({
    fields:Object.fromEntries(_ppmColumns('Record').map(column => [column.name, event[column.name] ?? ''])),
    metadata:values,
  });
  event._ppmMetadata = values;
  return [row];
}

function _ppmNotify(event, attributes) {
  attributes.forEach(row => _logChange('attribute', f(row, 'Name'), row._facility));
}

function _ppmCreateSchedule(group, component, anchor) {
  if (group.error) throw new Error(group.error);
  PPMScheduler.parse(anchor);
  const existing = _ppmSchedules(_ppmCatalog()).some(schedule => schedule.group.key === group.key &&
    f(schedule.component, 'Name') === f(component, 'Name'));
  if (existing) throw new Error('This Component already has a schedule for this task series.');
  const id = _projectGenerateGuid(), event = _ppmNewEvent(group.source);
  _ppmSet('Record', event, 'name', `PPM-${id}`);
  _ppmSet('Record', event, 'job', group.name);
  _ppmSet('Record', event, 'component', f(component, 'Name'));
  _ppmSet('Record', event, 'start', anchor);
  const schedule = {
    id, row:event, group, component, segments:[],
    metadata:{ anchor, task:group.tasks[0].key, component:f(component, 'Name') },
  };
  _ppmProject(schedule, anchor, anchor);
  const attributes = _ppmWriteMetadata(event, {
    record:'schedule', schedule:id, task:group.tasks[0].key, component:f(component, 'Name'), anchor, segments:'[]',
  });
  _ppmNotify(event, attributes);
  return schedule;
}

function _ppmPreview(schedule, occurrence, request, scope, status, actual, from, to) {
  if (!['one','future'].includes(scope)) throw new Error('Choose this occurrence or this and future occurrences.');
  if (occurrence.completed) throw new Error('Completed history cannot be changed.');
  if (!PPM_CONFIG.statuses.some(item => item.name === status)) throw new Error('Choose a valid operational status.');
  PPMScheduler.parse(request);
  const events = _ppmEvents(), before = _ppmProject(schedule, from, to, events);
  const selected = before.find(item => item.id === occurrence.id);
  if (!selected) throw new Error('The selected occurrence is no longer available.');
  if (status === PPM_CONFIG.completed) {
    PPMScheduler.parse(actual);
    if (selected.predecessors.some(key => !before.some(item => item.cycle === selected.cycle && item.key === key && item.completed))) {
      throw new Error('Complete all predecessors before completing this task.');
    }
    if (PPMScheduler.parse(actual).ms < PPMScheduler.parse(selected.start).ms) throw new Error('Completion cannot precede the planned start.');
    if (request !== selected.start || scope === 'future') throw new Error('Reschedule first, then record completion separately.');
  }
  const proposed = { ...schedule, segments:[...schedule.segments] }, overrides = new Map();
  if (scope === 'future') {
    proposed.segments = proposed.segments.filter(segment => segment.cycle < selected.cycle);
    const nominal = PPMScheduler.parse(selected.nominal), requested = PPMScheduler.parse(request);
    const delta = requested.ms - PPMScheduler.parse(selected.start).ms;
    const anchor = PPMScheduler.format({ ...nominal, ms:nominal.ms + delta,
      dateOnly:nominal.dateOnly && requested.dateOnly && delta % 86400000 === 0 });
    proposed.segments.push({ cycle:selected.cycle, anchor });
    before.filter(item => item.cycle >= selected.cycle && !item.completed).forEach(item => {
      overrides.set(JSON.stringify([item.cycle, item.key]), { cycle:item.cycle, requested:'' });
    });
  }
  overrides.set(JSON.stringify([selected.cycle, selected.key]), {
    cycle:selected.cycle, requested:scope === 'future' ? '' : request,
    status, actual:status === PPM_CONFIG.completed ? actual : '',
    start:selected.start, end:selected.end,
  });
  const after = _ppmProject(proposed, from, to, events, overrides);
  const changes = after.filter(item => {
    if (item.task.milestone) return false;
    const old = before.find(previous => previous.id === item.id);
    return !old || item.start !== old.start || item.end !== old.end || item.status !== old.status ||
      item.actual !== old.actual || item.requested !== old.requested;
  });
  return { schedule, proposed, selected, before, after, changes, scope };
}

function _ppmCommit(preview) {
  if (preview.scope === 'future') {
    const attributes = _ppmWriteMetadata(preview.schedule.row, { segments:JSON.stringify(preview.proposed.segments) });
    _ppmNotify(preview.schedule.row, attributes);
  }
  preview.changes.forEach(occurrence => {
    let event = occurrence.row;
    if (!event) {
      event = _ppmNewEvent(preview.schedule.row);
      _ppmSet('Record', event, 'name', `PPM-${_projectGenerateGuid()}`);
    }
    _ppmSet('Record', event, 'job', _ppmValue('Job', occurrence.task.row, 'name'));
    _ppmSet('Record', event, 'component', f(preview.schedule.component, 'Name'));
    _ppmSet('Record', event, 'start', occurrence.start);
    _ppmSet('Record', event, 'end', occurrence.end);
    const attributes = _ppmWriteMetadata(event, {
      record:'occurrence', schedule:preview.schedule.id, task:occurrence.key,
      component:f(preview.schedule.component, 'Name'), cycle:occurrence.cycle,
      nominal:occurrence.nominal, requested:occurrence.requested || '',
      status:occurrence.status, actual:occurrence.actual || '',
    });
    _ppmNotify(event, attributes);
  });
}

function _ppmSaveJob(original, draft, source, from, to, approved = false) {
  if (!_ppmValue('Job', draft, 'name')) throw new Error('A Job name is required.');
  const row = _ppmTag({ ...draft }, source);
  const oldKey = original ? _ppmTaskKey(original) : '';
  const newKey = _ppmTaskKey(row);
  const events = _ppmEvents();
  const proposedEvents = events.map(event => ({
    ...event,
    metadata:original && _ppmOwner(original, event.row) && event.metadata.task === oldKey
      ? { ...event.metadata, task:newKey } : event.metadata,
  }));
  const catalog = _ppmCatalog(original ? db.jobs.map(candidate => candidate === original ? row : candidate) : [...db.jobs, row]);
  const schedules = _ppmSchedules(catalog, proposedEvents);
  const previews = schedules.map(schedule => {
    const after = _ppmProject(schedule, from, to, proposedEvents);
    const beforeSchedule = _ppmSchedules(_ppmCatalog(), events).find(candidate => candidate.id === schedule.id);
    const before = _ppmProject(beforeSchedule, from, to, events);
    return {
      schedule, scope:'one',
      changes:after.filter(item => {
        const previous = before.find(candidate => candidate.cycle === item.cycle &&
          (candidate.key === item.key || (candidate.key === oldKey && item.key === newKey)));
        return !item.task.milestone && (!previous || (!previous.completed && (previous.start !== item.start || previous.end !== item.end)));
      }),
    };
  });
  if (!approved && previews.some(preview => preview.changes.length)) return { previews };
  if (original) {
    Object.keys(original).filter(key => !key.startsWith('_')).forEach(key => delete original[key]);
    Object.assign(original, row);
  } else db.jobs.push(row);
  proposedEvents.forEach((event, index) => {
    if (event.metadata.task === events[index].metadata.task) return;
    _ppmSet('Record', event.row, 'job', _ppmValue('Job', row, 'name'));
    _ppmNotify(event.row, _ppmWriteMetadata(event.row, { task:newKey }));
  });
  previews.forEach(_ppmCommit);
  _logChange('job', _ppmValue('Job', row, 'name'), row._facility, original ? JSON.parse(oldKey)[0] : _ppmValue('Job', row, 'name'));
  return { row:original || row };
}

function _ppmCascadeRename(entityType, oldName, newName, facility) {
  if (PPM_CONFIG.error || !['type','component'].includes(entityType)) return;
  const sameName = value => String(value).toLowerCase() === oldName.toLowerCase();
  const scoped = row => !facility || row._facility === facility;
  const rekeys = [];
  db.jobs.filter(scoped).forEach(row => {
    const oldKey = _ppmTaskKey(row);
    if (entityType === 'type' && sameName(_ppmValue('Job', row, 'type'))) {
      _ppmSet('Job', row, 'type', newName);
    }
    const newKey = _ppmTaskKey(row);
    if (oldKey !== newKey) {
      rekeys.push({ row, oldKey, newKey });
      _logChange('job', _ppmValue('Job', row, 'name'), row._facility);
    }
  });
  _ppmEvents().filter(record => scoped(record.row)).forEach(({ row:event, metadata }) => {
    const updates = {};
    const rekey = rekeys.find(item => _ppmOwner(item.row, event) && item.oldKey === metadata.task);
    if (rekey) updates.task = rekey.newKey;
    if (entityType === 'component' && sameName(metadata.component)) {
      updates.component = newName;
      _ppmSet('Record', event, 'component', newName);
    }
    if (Object.keys(updates).length) _ppmNotify(event, _ppmWriteMetadata(event, updates));
  });
}
