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
 * @param {Date | string | null | undefined} value
 * @returns {{ year: number, month: number } | null}
 */
function yearMonthInAppTz(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!year || !month) return null;
  return { year, month };
}

/**
 * @param {Date | string | null | undefined} dueAt
 * @param {number} year
 * @param {number} month 1–12
 */
function dueAtInYearMonth(dueAt, year, month) {
  const ym = yearMonthInAppTz(dueAt);
  if (!ym) return false;
  return ym.year === year && ym.month === month;
}

/**
 * Task is considered started by the end of the selected month when its due date
 * (or created date) is on or before that month.
 * @param {{ dueAt?: Date | string | null, createdAt?: Date | string | null }} task
 * @param {number} year
 * @param {number} month
 */
function taskStartedBySelectedMonth(task, year, month) {
  const start = yearMonthInAppTz(task.dueAt) || yearMonthInAppTz(task.createdAt);
  if (!start) return true;
  if (start.year < year) return true;
  if (start.year > year) return false;
  return start.month <= month;
}

/**
 * @param {{ recurrence?: string, recurrenceRule?: string | null, dueAt?: Date | string | null, createdAt?: Date | string | null, completed?: boolean }} task
 * @param {number} year
 * @param {number} month 1–12
 */
export function monthlyOccurrenceCount(task, year, month) {
  const recurrence = task.recurrence ?? "none";

  if (recurrence === "none") {
    // One-time tasks only count in the month they are due.
    if (task.dueAt) return dueAtInYearMonth(task.dueAt, year, month) ? 1 : 0;
    // No due date: only count in the current calendar month while still open.
    if (task.completed) return 0;
    const cur = currentYearMonthInAppTz();
    return year === cur.year && month === cur.month ? 1 : 0;
  }

  // Recurring tasks that have not started yet do not apply to earlier months.
  if (!taskStartedBySelectedMonth(task, year, month)) return 0;

  // Completed recurring tasks are excluded (no completedAt to scope by month).
  if (task.completed) return 0;

  if (recurrence === "daily") {
    return WORKING_DAYS_PER_MONTH;
  }

  if (recurrence === "weekly") {
    return WEEKS_PER_MONTH;
  }

  if (recurrence === "monthly") {
    return 1;
  }

  if (recurrence === "yearly") {
    if (task.dueAt && !dueAtInYearMonth(task.dueAt, year, month)) return 0;
    // Yearly without due month: use created month as anniversary.
    if (!task.dueAt) {
      const start = yearMonthInAppTz(task.createdAt);
      if (start && start.month !== month) return 0;
    }
    return 1;
  }

  if (recurrence === "custom") {
    return customMonthlyOccurrenceCount(task, year, month);
  }

  return 0;
}

/**
 * @param {{ recurrenceRule?: string | null, dueAt?: Date | string | null, createdAt?: Date | string | null }} task
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
    if (every <= 1) return 1;
    const start = yearMonthInAppTz(task.dueAt) || yearMonthInAppTz(task.createdAt);
    if (!start) return 0;
    const startIdx = start.year * 12 + start.month;
    const targetIdx = year * 12 + month;
    if (targetIdx < startIdx) return 0;
    return (targetIdx - startIdx) % every === 0 ? 1 : 0;
  }
  if (unit === "year") {
    return dueAtInYearMonth(task.dueAt, year, month) ? 1 : 0;
  }

  return 1;
}

/**
 * @param {{ durationMinutes?: number | null, recurrence?: string, recurrenceRule?: string | null, dueAt?: Date | string | null, createdAt?: Date | string | null, completed?: boolean }} task
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
