import { prisma } from "../lib/prisma.js";
import { syncCompanyTrialSettings } from "../lib/companyTrial.js";
import { normalizeTimeHHmm } from "../lib/attendanceSchedule.js";

const COMPANY_SETTINGS_ID = "default";

/**
 * Whether this company requires employee live location (attendance).
 * Defaults to true when the setting row is missing or the column is unset.
 */
export async function isCompanyLiveLocationRequired() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { liveLocationRequired: true },
    });
    if (!row) return true;
    return row.liveLocationRequired !== false;
  } catch {
    return true;
  }
}

export async function getCompanyAttendanceSettings() {
  const liveLocationRequired = await isCompanyLiveLocationRequired();
  const schedule = await getDailyAttendanceSchedule();
  return { liveLocationRequired, ...schedule };
}

export async function getDailyAttendanceSchedule() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { dailyCheckInTime: true, dailyCheckOutTime: true },
    });
    return {
      checkInTime: row?.dailyCheckInTime ?? null,
      checkOutTime: row?.dailyCheckOutTime ?? null,
    };
  } catch {
    return { checkInTime: null, checkOutTime: null };
  }
}

/**
 * @param {{ checkInTime?: string | null, checkOutTime?: string | null }} data
 */
export async function setDailyAttendanceSchedule(data) {
  await syncCompanyTrialSettings();
  const checkInTime =
    data.checkInTime === undefined
      ? undefined
      : data.checkInTime
        ? normalizeTimeHHmm(data.checkInTime)
        : null;
  const checkOutTime =
    data.checkOutTime === undefined
      ? undefined
      : data.checkOutTime
        ? normalizeTimeHHmm(data.checkOutTime)
        : null;

  if (data.checkInTime && checkInTime === null) {
    throw new Error("Invalid check-in time. Use HH:mm format.");
  }
  if (data.checkOutTime && checkOutTime === null) {
    throw new Error("Invalid check-out time. Use HH:mm format.");
  }

  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: {
      ...(checkInTime !== undefined ? { dailyCheckInTime: checkInTime } : {}),
      ...(checkOutTime !== undefined ? { dailyCheckOutTime: checkOutTime } : {}),
    },
    select: { dailyCheckInTime: true, dailyCheckOutTime: true, updatedAt: true },
  });

  return {
    checkInTime: updated.dailyCheckInTime,
    checkOutTime: updated.dailyCheckOutTime,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * @param {boolean} liveLocationRequired
 */
export async function setCompanyLiveLocationRequired(liveLocationRequired) {
  await syncCompanyTrialSettings();
  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { liveLocationRequired: !!liveLocationRequired },
    select: { liveLocationRequired: true, updatedAt: true },
  });
  return {
    liveLocationRequired: updated.liveLocationRequired,
    updatedAt: updated.updatedAt.toISOString(),
  };
}
