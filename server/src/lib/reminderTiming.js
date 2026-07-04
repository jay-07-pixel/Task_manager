/** Default pre-deadline reminder when task.reminderBeforeMinutes is null. */
export const DEFAULT_REMINDER_BEFORE_MINUTES = 30;

const FOLLOWUP_1H_AFTER_DUE_MS = 60 * 60 * 1000;
const FOLLOWUP_6H_AFTER_DUE_MS = 6 * 60 * 60 * 1000;
const FOLLOWUP_24H_AFTER_DUE_MS = 24 * 60 * 60 * 1000;
export const FOLLOWUP_STOP_AFTER_DUE_MS = 25 * 60 * 60 * 1000;

/**
 * @param {number | null | undefined} reminderBeforeMinutes
 * @returns {number | null} Milliseconds before due, or null if disabled.
 */
export function reminderBeforeMs(reminderBeforeMinutes) {
  if (reminderBeforeMinutes === 0) return null;
  const minutes =
    reminderBeforeMinutes == null ? DEFAULT_REMINDER_BEFORE_MINUTES : reminderBeforeMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * 60 * 1000;
}

/** @param {number} minutes */
export function beforeReminderSlot(minutes) {
  return `before${minutes}`;
}

/** @param {string | null | undefined} slot */
export function minutesFromBeforeSlot(slot) {
  const m = /^before(\d+)$/.exec(String(slot || ""));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * @param {Date} dueAt
 * @param {number} [nowMs]
 * @param {number | null | undefined} [reminderBeforeMinutes]
 * @returns {string | null}
 */
export function reminderSlotForDue(dueAt, nowMs = Date.now(), reminderBeforeMinutes = null) {
  const due = dueAt.getTime();
  if (!Number.isFinite(due)) return null;

  const beforeMs = reminderBeforeMs(reminderBeforeMinutes);
  if (beforeMs != null) {
    const msUntilDue = due - nowMs;
    if (msUntilDue > 0 && msUntilDue <= beforeMs) {
      const minutes =
        reminderBeforeMinutes == null ? DEFAULT_REMINDER_BEFORE_MINUTES : reminderBeforeMinutes;
      return beforeReminderSlot(minutes);
    }
  }

  const msAfterDue = nowMs - due;
  if (msAfterDue < 0) return null;

  if (msAfterDue >= FOLLOWUP_24H_AFTER_DUE_MS && msAfterDue < FOLLOWUP_STOP_AFTER_DUE_MS) {
    return "followup24h";
  }
  if (msAfterDue >= FOLLOWUP_6H_AFTER_DUE_MS && msAfterDue < FOLLOWUP_24H_AFTER_DUE_MS) {
    return "followup6h";
  }
  if (msAfterDue >= FOLLOWUP_1H_AFTER_DUE_MS && msAfterDue < FOLLOWUP_6H_AFTER_DUE_MS) {
    return "followup1h";
  }

  return null;
}

/** @param {number} minutes */
export function formatBeforeDueReminderTitle(minutes) {
  if (minutes < 60) {
    return minutes === 1 ? "Task due in 1 minute" : `Task due in ${minutes} minutes`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "Task due in 1 day" : `Task due in ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Task due in 1 hour" : `Task due in ${hours} hours`;
  }
  return `Task due in ${minutes} minutes`;
}
