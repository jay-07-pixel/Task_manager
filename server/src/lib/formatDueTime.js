/**
 * IANA timezone for formatting due times (task field, then env, then UTC).
 * @param {string | null | undefined} taskDueTimeZone
 */
export function resolveDueTimeZone(taskDueTimeZone) {
  const fromTask = typeof taskDueTimeZone === "string" ? taskDueTimeZone.trim() : "";
  if (fromTask) return fromTask;

  const fromEnv = (process.env.APP_TIMEZONE || process.env.REMINDER_TIMEZONE || "").trim();
  if (fromEnv) return fromEnv;

  return "UTC";
}

/**
 * Human-readable due time for reminder notification bodies.
 * Uses the task's due_time_zone (browser local at save) so VPS UTC does not shift display.
 * @param {Date | string} dueAt
 * @param {boolean} [allDay]
 * @param {string | null | undefined} [dueTimeZone]
 */
export function formatDueTime(dueAt, allDay = false, dueTimeZone = null) {
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "";

  const timeZone = resolveDueTimeZone(dueTimeZone);

  if (allDay) {
    return d.toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return d.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
