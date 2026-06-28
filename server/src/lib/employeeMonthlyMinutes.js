import { parseRecurrenceRuleJson } from "./recurrenceRoll.js";

/** 26 working days × 8 hours × 60 minutes */
export const MONTHLY_BUDGET_MINUTES = 26 * 8 * 60;

export const WORKING_DAYS_PER_MONTH = 26;

/** Standard month planning: 4 weeks × weekly task duration */
export const WEEKS_PER_MONTH = 4;

function appTimeZone() {
  return process.env.APP_TIMEZONE || "Asia/Kolkata";
}

/** @returns {{ year: number, month: number }} 1-based month */
export function currentYearMonthInAppTz(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/**
 * @param {Date | string | null | undefined} dueAt
 * @param {number} year
 * @param {number} month 1–12
 */
function dueAtInYearMonth(dueAt, year, month) {
  if (!dueAt) return false;
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  return y === year && m === month;
}

/**
 * @param {{ recurrence?: string, recurrenceRule?: string | null, dueAt?: Date | string | null, completed?: boolean }} task
 * @param {number} year
 * @param {number} month 1–12
 */
export function monthlyOccurrenceCount(task, year, month) {
  const recurrence = task.recurrence ?? "none";

  if (recurrence === "none") {
    if (task.completed) return 0;
    return 1;
  }

  if (recurrence === "daily") {
    if (task.completed) return 0;
    return WORKING_DAYS_PER_MONTH;
  }

  if (recurrence === "weekly") {
    if (task.completed) return 0;
    return WEEKS_PER_MONTH;
  }

  if (recurrence === "monthly") {
    if (task.completed) return 0;
    return 1;
  }

  if (recurrence === "yearly") {
    if (task.completed) return 0;
    if (task.dueAt && !dueAtInYearMonth(task.dueAt, year, month)) return 0;
    return 1;
  }

  if (recurrence === "custom") {
    if (task.completed) return 0;
    return customMonthlyOccurrenceCount(task, year, month);
  }

  return 0;
}

/**
 * @param {{ recurrenceRule?: string | null, dueAt?: Date | string | null }} task
 * @param {number} year
 * @param {number} month
 */
function customMonthlyOccurrenceCount(task, year, month) {
  const rule = parseRecurrenceRuleJson(task.recurrenceRule);
  if (!rule) return 1;

  const every = Math.max(1, Number(rule.every) || 1);
  const unit = String(rule.unit || "day");

  if (unit === "day") {
    return Math.max(1, Math.floor(WORKING_DAYS_PER_MONTH / every));
  }
  if (unit === "week") {
    return Math.max(1, Math.floor(WEEKS_PER_MONTH / every));
  }
  if (unit === "month") {
    return every <= 1 ? 1 : 0;
  }
  if (unit === "year") {
    return dueAtInYearMonth(task.dueAt, year, month) ? 1 : 0;
  }

  return 1;
}

/**
 * @param {{ durationMinutes?: number | null, recurrence?: string, recurrenceRule?: string | null, dueAt?: Date | string | null, completed?: boolean }} task
 * @param {number} [year]
 * @param {number} [month]
 */
export function taskMonthlyMinutesCost(task, year, month) {
  const minutes = task.durationMinutes ?? 0;
  if (!minutes || minutes <= 0) return 0;

  let y = year;
  let m = month;
  if (y == null || m == null) {
    const cur = currentYearMonthInAppTz();
    y = cur.year;
    m = cur.month;
  }

  return minutes * monthlyOccurrenceCount(task, y, m);
}

/**
 * @param {{ durationMinutes?: number | null, recurrence?: string, recurrenceRule?: object | string | null, dueAt?: string | Date | null, completed?: boolean }} draft
 */
export function draftTaskMonthlyMinutesCost(draft) {
  let recurrenceRule = draft.recurrenceRule ?? null;
  if (recurrenceRule && typeof recurrenceRule === "object") {
    recurrenceRule = JSON.stringify(recurrenceRule);
  }
  return taskMonthlyMinutesCost({
    durationMinutes: draft.durationMinutes ?? null,
    recurrence: draft.recurrence ?? "none",
    recurrenceRule,
    dueAt: draft.dueAt ?? null,
    completed: false,
  });
}
