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

/** @param {{ hours: number, minutes: number }} time */
export function getTodayAtTime(time, baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d;
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
  const deadline = getTodayAtTime(parsed, at);
  return at.getTime() > deadline.getTime() ? "late" : "on_time";
}

/**
 * @param {Date | string} recordedAt
 * @param {string | null | undefined} checkOutTime
 * @returns {"early" | "on_time" | null}
 */
export function evaluateCheckOutTiming(recordedAt, checkOutTime) {
  const parsed = parseTimeHHmm(checkOutTime);
  if (!parsed) return null;
  const at = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  const target = getTodayAtTime(parsed, at);
  return at.getTime() < target.getTime() ? "early" : "on_time";
}
