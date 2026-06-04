/**
 * Human-readable due time for reminder notification bodies.
 * @param {Date | string} dueAt
 * @param {boolean} [allDay]
 */
export function formatDueTime(dueAt, allDay = false) {
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "";

  if (allDay) {
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
