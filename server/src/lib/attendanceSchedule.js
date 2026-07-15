/** @param {string | null | undefined} value */
export function parseTimeHHmm(value) {
  const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** @param {string | null | undefined} value */
export function normalizeTimeHHmm(value) {
  const parsed = parseTimeHHmm(value);
  if (!parsed) return null;
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

export function getCompanyTimeZone() {
  return process.env.COMPANY_TIMEZONE || "Asia/Kolkata";
}

/** @param {Date} date @param {string} [timeZone] */
function minutesSinceLocalMidnight(date, timeZone = getCompanyTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hours * 60 + minutes;
}

/**
 * @param {Date | string} recordedAt
 * @param {string | null | undefined} checkInTime
 * @returns {"late" | "on_time" | null}
 */
export function evaluateCheckInTiming(recordedAt, checkInTime) {
  const parsed = parseTimeHHmm(checkInTime);
  if (!parsed) return null;
  const at = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  if (Number.isNaN(at.getTime())) return null;
  const recordedMins = minutesSinceLocalMidnight(at);
  const deadlineMins = parsed.hours * 60 + parsed.minutes;
  return recordedMins > deadlineMins ? "late" : "on_time";
}

/**
 * @param {Date | string} recordedAt
 * @param {string | null | undefined} checkOutTime
 * @returns {"early" | "on_time" | "overtime" | null}
 */
export function evaluateCheckOutTiming(recordedAt, checkOutTime) {
  const parsed = parseTimeHHmm(checkOutTime);
  if (!parsed) return null;
  const at = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  if (Number.isNaN(at.getTime())) return null;
  const recordedMins = minutesSinceLocalMidnight(at);
  const targetMins = parsed.hours * 60 + parsed.minutes;
  if (recordedMins < targetMins) return "early";
  if (recordedMins > targetMins) return "overtime";
  return "on_time";
}

/**
 * Minutes worked past the scheduled check-out time (0 if early/on time / unknown).
 * @param {Date | string} recordedAt
 * @param {string | null | undefined} checkOutTime
 */
export function overtimeMinutesAfterCheckOut(recordedAt, checkOutTime) {
  const parsed = parseTimeHHmm(checkOutTime);
  if (!parsed) return 0;
  const at = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  if (Number.isNaN(at.getTime())) return 0;
  const recordedMins = minutesSinceLocalMidnight(at);
  const targetMins = parsed.hours * 60 + parsed.minutes;
  return recordedMins > targetMins ? recordedMins - targetMins : 0;
}
