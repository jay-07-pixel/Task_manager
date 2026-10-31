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

/** Open work with no deadline, due today, or still overdue. Future days are upcoming. */
export function employeeTaskIsDueTodayOrEarlier(task, now = new Date()) {
  const ms = dueMs(task?.dueAt);
  if (!Number.isFinite(ms)) return true;
  return ms <= endOfLocalDay(now).getTime();
}

function seriesKey(task) {
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "none") return `once\0${task.id}`;
  const listId = task.listId ?? "";
  return `${listId}\0${task.title ?? ""}\0${recurrence}`;
}

/**
 * The next open card after today, inside `dayCount` days, one card per repeating series.
 * @param {EmpTaskLike[]} tasks
 * @param {number} [dayCount]
 * @param {{ isSubmitted?: (task: EmpTaskLike) => boolean; isActiveOpen?: (task: EmpTaskLike) => boolean }} [options]
 */
export function buildEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  const isSubmitted = options.isSubmitted ?? (() => false);
  const isActiveOpen = options.isActiveOpen ?? (() => true);
  const list = Array.isArray(tasks) ? tasks : [];
  const now = new Date();
  const windowStart = new Date(startOfLocalDay(now).getTime() + MS_DAY);
  const windowEnd = endOfLocalDay(new Date(startOfLocalDay(now).getTime() + dayCount * MS_DAY));

  const eligible = list
    .filter((task) => {
      const ms = dueMs(task.dueAt);
      return Number.isFinite(ms) && ms >= windowStart.getTime() && ms <= windowEnd.getTime();
    })
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
