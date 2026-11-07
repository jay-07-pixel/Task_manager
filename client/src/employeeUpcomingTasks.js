/** @typedef {{ id: string; listId?: string; title?: string; recurrence?: string; dueAt?: string | null }} EmpTaskLike */

const MS_DAY = 86_400_000;

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

function dueMs(iso) {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

/** Past deadline — belongs in Active. */
export function employeeTaskIsOverdue(task, now = new Date()) {
  const ms = dueMs(task?.dueAt);
  if (!Number.isFinite(ms)) return false;
  return ms < now.getTime();
}

/** Still due later (including later today) through the next `dayCount` calendar days. */
export function employeeTaskIsUpcomingDue(task, dayCount = 8, now = new Date()) {
  const ms = dueMs(task?.dueAt);
  if (!Number.isFinite(ms)) return false;
  if (ms <= now.getTime()) return false;
  const windowEnd = endOfLocalDay(new Date(startOfLocalDay(now).getTime() + dayCount * MS_DAY));
  return ms <= windowEnd.getTime();
}

/** @deprecated Prefer employeeTaskIsOverdue for Active. Kept for older call sites. */
export function employeeTaskIsDueTodayOrEarlier(task, now = new Date()) {
  return employeeTaskIsOverdue(task, now);
}

function seriesKey(task) {
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "none") return `once\0${task.id}`;
  const listId = task.listId ?? "";
  return `${listId}\0${task.title ?? ""}\0${recurrence}`;
}

/**
 * Open assigned list: at most one open card per repeating series (keep submitted history).
 * @param {EmpTaskLike[]} tasks
 * @param {{ isSubmitted?: (task: EmpTaskLike) => boolean }} [options]
 */
export function dedupeOpenRecurringAssignedTasks(tasks, options = {}) {
  const isSubmitted = options.isSubmitted ?? (() => false);
  const list = Array.isArray(tasks) ? tasks : [];
  const kept = [];
  const openBySeries = new Map();

  for (const task of list) {
    if (isSubmitted(task) || (task.recurrence ?? "none") === "none") {
      kept.push(task);
      continue;
    }
    const key = seriesKey(task);
    const existing = openBySeries.get(key);
    if (!existing) {
      openBySeries.set(key, task);
      continue;
    }
    const a = dueMs(task.dueAt);
    const b = dueMs(existing.dueAt);
    if (Number.isFinite(a) && (!Number.isFinite(b) || a < b)) {
      openBySeries.set(key, task);
    }
  }

  for (const task of openBySeries.values()) kept.push(task);
  return kept;
}

/**
 * Open tasks due after now through the next `dayCount` days, one card per repeating series.
 * @param {EmpTaskLike[]} tasks
 * @param {number} [dayCount]
 * @param {{ isSubmitted?: (task: EmpTaskLike) => boolean; isActiveOpen?: (task: EmpTaskLike) => boolean }} [options]
 */
export function buildEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  const isSubmitted = options.isSubmitted ?? (() => false);
  const isActiveOpen = options.isActiveOpen ?? (() => true);
  const list = Array.isArray(tasks) ? tasks : [];
  const now = new Date();

  const eligible = list
    .filter((task) => employeeTaskIsUpcomingDue(task, dayCount, now))
    .filter((task) => !isSubmitted(task) && isActiveOpen(task))
    .sort((a, b) => dueMs(a.dueAt) - dueMs(b.dueAt));

  const seen = new Set();
  const onePerSeries = [];
  for (const task of eligible) {
    const key = seriesKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    onePerSeries.push(task);
  }
  return onePerSeries;
}

export function countEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  return buildEmployeeUpcomingTasks(tasks, dayCount, options).length;
}

export function employeeUpcomingDisplayDueAt(task) {
  return task?.dueAt || null;
}
