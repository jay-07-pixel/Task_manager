/** @typedef {{ id: string; listId?: string; title?: string; recurrence?: string; recurrenceRule?: object | string | null; dueAt?: string | null; allDay?: boolean; isUpcomingProjection?: boolean; upcomingDisplayDueAt?: string }} EmpTaskLike */

const MS_DAY = 86_400_000;

function parseRecurrenceRule(recurrenceRule) {
  if (!recurrenceRule) return null;
  if (typeof recurrenceRule === "object") return recurrenceRule;
  try {
    return JSON.parse(recurrenceRule);
  } catch {
    return null;
  }
}

/** Mirror server computeNextDueAt for upcoming schedule previews. */
export function computeNextDueAtClient(dueAt, recurrence, allDay, recurrenceRule) {
  const base = dueAt ? new Date(dueAt) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base);
  const ruleJson =
    typeof recurrenceRule === "string" ? recurrenceRule : recurrenceRule ? JSON.stringify(recurrenceRule) : null;
  const rule = parseRecurrenceRule(ruleJson);

  if (recurrence === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (recurrence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (recurrence === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else if (recurrence === "yearly") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else if (recurrence === "custom" && rule) {
    const every = Math.max(1, Number(rule.every) || 1);
    const unit = rule.unit;
    if (unit === "day") next.setUTCDate(next.getUTCDate() + every);
    else if (unit === "week") next.setUTCDate(next.getUTCDate() + 7 * every);
    else if (unit === "month") next.setUTCMonth(next.getUTCMonth() + every);
    else if (unit === "year") next.setUTCFullYear(next.getUTCFullYear() + every);
    else return null;
  } else {
    return null;
  }

  if (allDay) {
    return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 12, 0, 0, 0));
  }
  return next;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function localDayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dueInWindow(iso, windowStart, windowEnd) {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= windowStart.getTime() && ms <= windowEnd.getTime();
}

function seriesKey(task) {
  const listId = task.listId ?? task.ownerAllTasksListId ?? "";
  return `${listId}\0${task.title ?? ""}\0${task.recurrence ?? "none"}`;
}

function shouldProjectSeries(recurrence) {
  return recurrence === "daily" || recurrence === "weekly" || recurrence === "monthly" || recurrence === "yearly" || recurrence === "custom";
}

/**
 * Tasks to show in the employee Upcoming view (next `dayCount` calendar days, deadline-wise).
 * @param {EmpTaskLike[]} tasks
 * @param {number} [dayCount]
 * @param {{ isSubmitted?: (task: EmpTaskLike) => boolean }} [options]
 */
export function buildEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  const isSubmitted = options.isSubmitted ?? (() => false);
  const list = Array.isArray(tasks) ? tasks : [];
  const windowStart = startOfLocalDay();
  const windowEnd = endOfLocalDay(new Date(windowStart.getTime() + (dayCount - 1) * MS_DAY));

  /** @type {Map<string, EmpTaskLike>} */
  const bySeriesDay = new Map();

  const remember = (task, dueIso, projection = false) => {
    if (!dueIso || !dueInWindow(dueIso, windowStart, windowEnd)) return;
    const key = `${seriesKey(task)}\0${localDayKey(dueIso)}`;
    const existing = bySeriesDay.get(key);
    const entry = projection
      ? {
          ...task,
          isUpcomingProjection: true,
          upcomingDisplayDueAt: dueIso,
        }
      : { ...task, isUpcomingProjection: false, upcomingDisplayDueAt: undefined };
    if (!existing || (existing.isUpcomingProjection && !projection)) {
      bySeriesDay.set(key, entry);
    }
  };

  for (const task of list) {
    if (task.dueAt && !isSubmitted(task)) remember(task, task.dueAt, false);
  }

  const seriesMap = new Map();
  for (const task of list) {
    const recurrence = task.recurrence ?? "none";
    if (!shouldProjectSeries(recurrence)) continue;
    const key = seriesKey(task);
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key).push(task);
  }

  for (const seriesTasks of seriesMap.values()) {
    const open = seriesTasks
      .filter((t) => !t.completed)
      .sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
    const anchor = open[0] ?? seriesTasks.sort((a, b) => new Date(b.dueAt || 0).getTime() - new Date(a.dueAt || 0).getTime())[0];
    if (!anchor?.dueAt) continue;

    const recurrence = anchor.recurrence ?? "none";
    const rule = anchor.recurrenceRule ?? null;
    let cursor = new Date(anchor.dueAt);
    const seen = new Set();
    let guard = 0;

    while (guard < 64) {
      guard += 1;
      const dueIso = cursor.toISOString();
      const dayKey = localDayKey(dueIso);
      const mapKey = `${seriesKey(anchor)}\0${dayKey}`;
      if (cursor.getTime() > windowEnd.getTime()) break;
      if (cursor.getTime() >= windowStart.getTime() && !bySeriesDay.has(mapKey)) {
        remember(anchor, dueIso, true);
      }
      if (seen.has(dayKey)) break;
      seen.add(dayKey);
      const next = computeNextDueAtClient(dueIso, recurrence, anchor.allDay === true, rule);
      if (!next) break;
      cursor = next;
    }
  }

  return [...bySeriesDay.values()].sort((a, b) => {
    const aDue = new Date(a.upcomingDisplayDueAt || a.dueAt || 0).getTime();
    const bDue = new Date(b.upcomingDisplayDueAt || b.dueAt || 0).getTime();
    if (aDue !== bDue) return aDue - bDue;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function countEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  return buildEmployeeUpcomingTasks(tasks, dayCount, options).length;
}

export function employeeUpcomingDisplayDueAt(task) {
  return task?.upcomingDisplayDueAt || task?.dueAt || null;
}
