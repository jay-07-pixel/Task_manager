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
