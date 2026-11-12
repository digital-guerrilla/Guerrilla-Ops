// Scheduling uses UTC arithmetic for date-only values and fixed offsets for timestamps.
const PPMScheduler = (() => {
  const minute = 60000;
  function parse(value) {
    const text = String(value || '');
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
    if (!match) throw new Error(`Use an ISO date or date/time: ${text || '(empty)'}.`);
    const [, y, m, d, h = '0', min = '0', s = '0', fraction = '', zone = ''] = match;
    const local = new Date(0);
    local.setUTCFullYear(+y, +m - 1, +d);
    local.setUTCHours(+h, +min, +s, +(fraction.padEnd(3, '0')));
    if (local.getUTCFullYear() !== +y || local.getUTCMonth() !== +m - 1 ||
        local.getUTCDate() !== +d || +h > 23 || +min > 59 || +s > 59) {
      throw new Error(`Invalid calendar date: ${text}.`);
    }
    let offset = 0;
    if (zone && zone !== 'Z') {
      const digits = zone.replace(':', '');
      const hours = +digits.slice(1, 3), minutes = +digits.slice(3);
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes)) throw new Error(`Invalid UTC offset: ${text}.`);
      offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
    }
    return { ms:local.getTime() - offset * minute, offset, zone, dateOnly:!match[4] };
  }
  function format(date) {
    const local = new Date(date.ms + date.offset * minute);
    if (!Number.isFinite(date.ms) || local.getUTCFullYear() < 1 || local.getUTCFullYear() > 9999) {
      throw new Error('The schedule is outside the supported calendar range.');
    }
    const text = local.toISOString();
    return date.dateOnly ? text.slice(0, 10) : text.slice(0, 23).replace(/\.000$/, '') + date.zone;
  }
  function unit(value, units) {
    const key = String(value || '').trim().toLowerCase();
    const result = units.find(item => item.aliases.includes(key));
    if (!result) throw new Error(`Unsupported time unit "${value}". Use a calendar-based unit.`);
    return result;
  }
  function shift(value, amount, unitName, units) {
    const date = parse(value), definition = unit(unitName, units);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Time values must be nonnegative numbers.');
    if (definition.months) {
      const months = amount * definition.months;
      if (!Number.isInteger(months)) throw new Error('Month and year values must be whole calendar months.');
      const local = new Date(date.ms + date.offset * minute);
      const day = local.getUTCDate();
      local.setUTCDate(1);
      local.setUTCMonth(local.getUTCMonth() + months);
      const last = new Date(local.getTime());
      last.setUTCMonth(last.getUTCMonth() + 1, 0);
      local.setUTCDate(Math.min(day, last.getUTCDate()));
      date.ms = local.getTime() - date.offset * minute;
    } else {
      date.ms += amount * definition.minutes * minute;
      if (date.dateOnly && (amount * definition.minutes) % 1440) date.dateOnly = false;
    }
    return format(date);
  }
  function graph(tasks) {
    const byNumber = new Map(), byKey = new Map(tasks.map(task => [task.key, task]));
    tasks.forEach(task => {
      if (task.number && byNumber.has(task.number)) throw new Error(`Ambiguous task number ${task.number}.`);
      if (task.number) byNumber.set(task.number, task);
    });
    const predecessors = new Map(tasks.map(task => [task.key, task.priors.map(number => {
      const predecessor = byNumber.get(number);
      if (!predecessor) throw new Error(`Task ${task.number || task.key}: predecessor ${number} is missing.`);
      if (predecessor === task) throw new Error(`Task ${number} cannot depend on itself.`);
      return predecessor.key;
    })]));
    const order = [], active = new Set(), visited = new Set();
    function visit(key) {
      if (active.has(key)) throw new Error('The maintenance tasks contain a dependency cycle.');
      if (visited.has(key)) return;
      active.add(key);
      predecessors.get(key).forEach(visit);
      active.delete(key);
      visited.add(key);
      order.push(byKey.get(key));
    }
    tasks.forEach(task => visit(task.key));
    return { order, predecessors };
  }
  function cycle(tasks, nominal, saved, units, completedStatus) {
    const { order, predecessors } = graph(tasks), results = new Map();
    order.forEach(task => {
      const previous = saved.get(task.key) || {};
      const completed = previous.status === completedStatus;
      let start = completed ? previous.start : (previous.requested || nominal);
      parse(start);
      predecessors.get(task.key).forEach(key => {
        const predecessor = results.get(key);
        if (completed && predecessor.milestone) return;
        const finish = predecessor.actual || predecessor.end;
        if (parse(finish).ms > parse(start).ms) start = finish;
      });
      if (completed) {
        if (!previous.start || !previous.end || !previous.actual) throw new Error('Completed history has missing dates.');
        if (parse(start).ms > parse(previous.start).ms) {
          throw new Error('This change would move completed history. Resolve the dependency conflict first.');
        }
        start = previous.start;
      }
      const end = completed ? previous.end : shift(start, task.milestone ? 0 : task.duration, task.durationUnit, units);
      const result = {
        ...previous, key:task.key, nominal:completed ? (previous.nominal || nominal) : nominal,
        start, end, completed, milestone:task.milestone,
        predecessors:predecessors.get(task.key),
      };
      if (task.milestone) Object.assign(result, { completed:true, status:completedStatus, actual:end });
      if (completed && parse(previous.actual).ms < parse(start).ms) throw new Error('Completion cannot precede the occurrence start.');
      results.set(task.key, result);
    });
    return [...results.values()];
  }
  function ordinal(anchor, value, interval, intervalUnit, units) {
    const definition = unit(intervalUnit, units);
    if (!(interval > 0) || !Number.isFinite(interval)) throw new Error('The recurrence interval must be positive.');
    if (definition.months) {
      if (!Number.isInteger(interval * definition.months)) throw new Error('The recurrence must use whole calendar months.');
      const a = parse(anchor), b = parse(value);
      const start = new Date(a.ms + a.offset * minute), end = new Date(b.ms + b.offset * minute);
      return Math.max(0, Math.floor(((end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        end.getUTCMonth() - start.getUTCMonth()) / (interval * definition.months)));
    }
    return Math.max(0, Math.floor((parse(value).ms - parse(anchor).ms) / (interval * definition.minutes * minute)));
  }
  return Object.freeze({ parse, format, shift, unit, graph, cycle, ordinal });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PPMScheduler;
