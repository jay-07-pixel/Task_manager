/** Recurrence types that roll forward when an employee completes their assignment. */
export const PERIOD_RECURRENCES = new Set(["daily", "weekly", "monthly"]);

export function shouldRollOnEmployeeComplete(recurrence, recurrenceRuleJson) {
  if (PERIOD_RECURRENCES.has(recurrence)) return true;
  if (recurrence !== "custom" || !recurrenceRuleJson) return false;
  try {
    const unit = JSON.parse(recurrenceRuleJson).unit;
    return unit === "day" || unit === "week" || unit === "month";
  } catch {
    return false;
  }
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
  } else if (recurrence === "custom" && recurrenceRuleJson) {
    let rule;
    try {
      rule = JSON.parse(recurrenceRuleJson);
    } catch {
      return null;
    }
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
