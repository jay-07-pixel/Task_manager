/** Recurrence types that roll forward when an employee completes their assignment. */
export const PERIOD_RECURRENCES = new Set(["daily", "weekly", "monthly", "yearly"]);

/**
 * @param {string | null | undefined} recurrenceRuleJson
 * @returns {Record<string, unknown> | null}
 */
export function parseRecurrenceRuleJson(recurrenceRuleJson) {
  if (!recurrenceRuleJson) return null;
  try {
    return JSON.parse(recurrenceRuleJson);
  } catch {
    return null;
  }
}

export function shouldRollOnEmployeeComplete(recurrence, recurrenceRuleJson) {
  if (PERIOD_RECURRENCES.has(recurrence)) return true;
  if (recurrence !== "custom" || !recurrenceRuleJson) return false;
  const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
  if (!rule || typeof rule.unit !== "string") return false;
  return ["day", "week", "month", "year"].includes(rule.unit);
}

/**
 * @param {string} dateStr YYYY-MM-DD
 */
function endOfDayUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/** Custom rule: this completion is the last occurrence (endType "after"). */
export function recurrenceEndsAfterThisCompletion(recurrence, recurrenceRuleJson) {
  if (recurrence !== "custom") return false;
  const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
  if (!rule || rule.endType !== "after" || rule.endAfterOccurrences == null) return false;
  const completed = Number(rule.occurrencesCompleted) || 0;
  const limit = Number(rule.endAfterOccurrences);
  return completed + 1 >= limit;
}

/** Custom rule: computed next due is after the "end on" date. */
export function recurrenceNextDueExceedsEndOn(nextDue, recurrenceRuleJson) {
  const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
  if (!rule || rule.endType !== "on" || !rule.endOn) return false;
  const endStr = String(rule.endOn).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return false;
  return nextDue.getTime() > endOfDayUtc(endStr).getTime();
}

/**
 * @param {string | null} recurrenceRuleJson
 * @returns {string | null}
 */
export function bumpedRecurrenceRuleJson(recurrenceRuleJson) {
  const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
  if (!rule) return recurrenceRuleJson;
  const completed = Number(rule.occurrencesCompleted) || 0;
  return JSON.stringify({ ...rule, occurrencesCompleted: completed + 1 });
}

/**
 * @param {Date | null | undefined} dueAt
 * @param {string} recurrence
 * @param {boolean} allDay
 * @param {string | null} recurrenceRuleJson
 */
export function computeNextDueAt(dueAt, recurrence, allDay, recurrenceRuleJson) {
  const base = dueAt ? new Date(dueAt) : new Date();
  let next = new Date(base);

  if (recurrence === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (recurrence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (recurrence === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else if (recurrence === "yearly") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else if (recurrence === "custom" && recurrenceRuleJson) {
    const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
    if (!rule) return null;
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

/**
 * Previous occurrence due date (inverse of computeNextDueAt).
 * @param {Date | null | undefined} dueAt
 * @param {string} recurrence
 * @param {boolean} allDay
 * @param {string | null} recurrenceRuleJson
 */
export function computePreviousDueAt(dueAt, recurrence, allDay, recurrenceRuleJson) {
  const base = dueAt ? new Date(dueAt) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  const prev = new Date(base);

  if (recurrence === "daily") {
    prev.setUTCDate(prev.getUTCDate() - 1);
  } else if (recurrence === "weekly") {
    prev.setUTCDate(prev.getUTCDate() - 7);
  } else if (recurrence === "monthly") {
    prev.setUTCMonth(prev.getUTCMonth() - 1);
  } else if (recurrence === "yearly") {
    prev.setUTCFullYear(prev.getUTCFullYear() - 1);
  } else if (recurrence === "custom" && recurrenceRuleJson) {
    const rule = parseRecurrenceRuleJson(recurrenceRuleJson);
    if (!rule) return null;
    const every = Math.max(1, Number(rule.every) || 1);
    const unit = rule.unit;
    if (unit === "day") prev.setUTCDate(prev.getUTCDate() - every);
    else if (unit === "week") prev.setUTCDate(prev.getUTCDate() - 7 * every);
    else if (unit === "month") prev.setUTCMonth(prev.getUTCMonth() - every);
    else if (unit === "year") prev.setUTCFullYear(prev.getUTCFullYear() - every);
    else return null;
  } else {
    return null;
  }

  if (allDay) {
    return new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 12, 0, 0, 0));
  }

  return prev;
}

export function appTimeZone() {
  return (process.env.APP_TIMEZONE || process.env.REMINDER_TIMEZONE || "Asia/Kolkata").trim() || "Asia/Kolkata";
}

/** Calendar day YYYY-MM-DD in the company timezone (matches dedupe scripts). */
export function dueCalendarDayKey(dueAt, timeZone = appTimeZone()) {
  if (!dueAt) return "none";
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "none";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Find an existing series occurrence on the same list/title/recurrence/due day.
 * Used to prevent duplicate cards from double Mark Reviewed or restart backfill.
 */
export async function findExistingSeriesOccurrence(
  prisma,
  { listId, title, recurrence, dueAt, excludeTaskId = null }
) {
  if (!listId || !title || !dueAt) return null;
  const targetDay = dueCalendarDayKey(dueAt);
  if (targetDay === "none") return null;

  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const windowStart = new Date(due.getTime() - 36 * 60 * 60 * 1000);
  const windowEnd = new Date(due.getTime() + 36 * 60 * 60 * 1000);

  const candidates = await prisma.task.findMany({
    where: {
      listId,
      title,
      recurrence,
      dueAt: { gte: windowStart, lte: windowEnd },
      ...(excludeTaskId ? { NOT: { id: excludeTaskId } } : {}),
    },
    select: { id: true, dueAt: true, completed: true },
  });

  return candidates.find((row) => dueCalendarDayKey(row.dueAt) === targetDay) ?? null;
}
