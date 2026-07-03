/** @param {any} task */
function parseRecurrenceRule(task) {
  const raw = task?.recurrenceRule;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Sort rank for active/upcoming tasks (lower = earlier in list).
 * none → daily → weekly → every 15 days → monthly → yearly
 */
export function taskRecurrenceSortRank(task) {
  const recurrence = task?.recurrence ?? "none";
  if (recurrence === "none") return 0;
  if (recurrence === "daily") return 10;
  if (recurrence === "weekly") return 20;
  if (recurrence === "monthly") return 40;
  if (recurrence === "yearly") return 50;
  if (recurrence === "custom") {
    const rule = parseRecurrenceRule(task);
    if (rule) {
      const every = Math.max(1, Number(rule.every) || 1);
      const unit = rule.unit || "day";
      if (unit === "day" && every === 1) return 10;
      if (unit === "week" && every === 1) return 20;
      if (unit === "day" && every === 15) return 30;
      if (unit === "week" && every === 2) return 30;
      if (unit === "month" && every === 1) return 40;
      if (unit === "year" && every === 1) return 50;
      if (unit === "month") return 40;
      if (unit === "year") return 50;
      if (unit === "day") return 25;
      if (unit === "week") return 22;
    }
    return 35;
  }
  return 60;
}

/** @param {any} task */
export function taskCreatedMs(task) {
  const at = task?.createdAt;
  if (!at) return 0;
  const ms = new Date(at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newer created first within the same recurrence band. */
/** High-priority tasks sort above all others. */
export function compareHighPriorityFirst(a, b) {
  const aP = !!a?.highPriority;
  const bP = !!b?.highPriority;
  if (aP !== bP) return aP ? -1 : 1;
  return 0;
}

export function compareTasksByRecurrenceThenCreated(a, b) {
  const prio = compareHighPriorityFirst(a, b);
  if (prio !== 0) return prio;
  const rankDiff = taskRecurrenceSortRank(a) - taskRecurrenceSortRank(b);
  if (rankDiff !== 0) return rankDiff;
  const createdDiff = taskCreatedMs(b) - taskCreatedMs(a);
  if (createdDiff !== 0) return createdDiff;
  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

export function sortTasksByRecurrenceThenCreated(tasks) {
  return [...tasks].sort(compareTasksByRecurrenceThenCreated);
}

/** Latest submission/completion time for sorting completed tasks (ms; higher = more recent). */
export function taskCompletedTimestampMs(task) {
  const assignees = task?.assignees ?? task?.assignments ?? [];
  let maxMs = 0;
  for (const a of assignees) {
    const at = a?.lastSubmittedAt;
    if (!at) continue;
    const ms = new Date(at).getTime();
    if (!Number.isNaN(ms) && ms > maxMs) maxMs = ms;
  }
  if (maxMs > 0) return maxMs;
  if (task?.completed && task?.updatedAt) {
    const ms = new Date(task.updatedAt).getTime();
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  return taskCreatedMs(task);
}

export function compareCompletedTasksRecentFirst(a, b) {
  const prio = compareHighPriorityFirst(a, b);
  if (prio !== 0) return prio;
  const byCompleted = taskCompletedTimestampMs(b) - taskCompletedTimestampMs(a);
  if (byCompleted !== 0) return byCompleted;
  return String(a?.title || "").localeCompare(String(b?.title || ""));
}
