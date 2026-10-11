/** @typedef {{ id: string; dueAt?: string | null }} EmpTaskLike */

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

function dueInWindow(iso, windowStart, windowEnd) {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= windowStart.getTime() && ms <= windowEnd.getTime();
}

/**
 * Real assigned tasks due in the next `dayCount` calendar days (no placeholder rows).
 * @param {EmpTaskLike[]} tasks
 * @param {number} [dayCount]
 * @param {{ isSubmitted?: (task: EmpTaskLike) => boolean; isActiveOpen?: (task: EmpTaskLike) => boolean }} [options]
 */
export function buildEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  const isSubmitted = options.isSubmitted ?? (() => false);
  const isActiveOpen = options.isActiveOpen ?? (() => true);
  const list = Array.isArray(tasks) ? tasks : [];
  const windowStart = startOfLocalDay();
  const windowEnd = endOfLocalDay(new Date(windowStart.getTime() + (dayCount - 1) * MS_DAY));

  return list
    .filter((task) => task.dueAt && dueInWindow(task.dueAt, windowStart, windowEnd))
    .filter((task) => !isSubmitted(task) && isActiveOpen(task))
    .sort((a, b) => {
      const aDue = new Date(a.dueAt || 0).getTime();
      const bDue = new Date(b.dueAt || 0).getTime();
      if (aDue !== bDue) return aDue - bDue;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}

export function countEmployeeUpcomingTasks(tasks, dayCount = 8, options = {}) {
  return buildEmployeeUpcomingTasks(tasks, dayCount, options).length;
}

export function employeeUpcomingDisplayDueAt(task) {
  return task?.dueAt || null;
}
