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

/**
 * Whether check-in / check-out attendance is enabled for employees.
 * Opt-in: only on when explicitly set to true.
 */
export async function isCompanyAttendanceEnabled() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { attendanceEnabled: true },
    });
    if (!row) return false;
    return row.attendanceEnabled === true;
  } catch {
    return false;
  }
}

/**
 * Whether employees get email when an admin assigns or edits a task.
 * Opt-in: only on when explicitly set to true.
 */
export async function isCompanyTaskAssignmentEmailEnabled() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { taskAssignmentEmailEnabled: true },
    });
    if (!row) return false;
    return row.taskAssignmentEmailEnabled === true;
  } catch {
    return false;
  }
}

/**
 * When on (and attendance is on), employees cannot check out until today's due tasks are done.
 * Also enables the daily admin email report at `dailyTaskReportTime`.
 */
export async function isCheckoutRequiresTasksDone() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { checkoutRequiresTasksDone: true },
    });
    if (!row) return false;
    return row.checkoutRequiresTasksDone === true;
  } catch {
    return false;
  }
}

export async function getCheckoutTaskGateSettings() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: {
        checkoutRequiresTasksDone: true,
        dailyTaskReportTime: true,
        dailyTaskReportEmail: true,
        dailyTaskReportLastSentOn: true,
      },
    });
    return {
      checkoutRequiresTasksDone: row?.checkoutRequiresTasksDone === true,
      dailyTaskReportTime: row?.dailyTaskReportTime ?? null,
      dailyTaskReportEmail: row?.dailyTaskReportEmail ?? null,
      dailyTaskReportLastSentOn: row?.dailyTaskReportLastSentOn ?? null,
    };
  } catch {
    return {
      checkoutRequiresTasksDone: false,
      dailyTaskReportTime: null,
      dailyTaskReportEmail: null,
      dailyTaskReportLastSentOn: null,
    };
  }
}

export async function getCompanyAttendanceSettings() {
  const liveLocationRequired = await isCompanyLiveLocationRequired();
  const attendanceEnabled = await isCompanyAttendanceEnabled();
  const taskAssignmentEmailEnabled = await isCompanyTaskAssignmentEmailEnabled();
  const checkoutGate = await getCheckoutTaskGateSettings();
  const schedule = await getDailyAttendanceSchedule();
  return {
    liveLocationRequired,
    attendanceEnabled,
    taskAssignmentEmailEnabled,
    checkoutRequiresTasksDone: checkoutGate.checkoutRequiresTasksDone,
    dailyTaskReportTime: checkoutGate.dailyTaskReportTime,
    dailyTaskReportEmail: checkoutGate.dailyTaskReportEmail,
    ...schedule,
  };
}

export async function getDailyAttendanceSchedule() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: {
        dailyCheckInTime: true,
        dailyCheckOutTime: true,
        attendanceStartDate: true,
      },
    });
    return {
      checkInTime: row?.dailyCheckInTime ?? null,
      checkOutTime: row?.dailyCheckOutTime ?? null,
      attendanceStartDate: row?.attendanceStartDate ?? null,
    };
  } catch {
    return { checkInTime: null, checkOutTime: null, attendanceStartDate: null };
  }
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeAttendanceStartDate(value) {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return trimmed;
}

/**
 * @param {string} dateKey YYYY-MM-DD
 * @param {string | null | undefined} startDate YYYY-MM-DD
 */
export function isAttendanceDayApplicable(dateKey, startDate) {
  if (!startDate) return true;
  return String(dateKey) >= String(startDate);
}

/**
 * @param {{ checkInTime?: string | null, checkOutTime?: string | null, attendanceStartDate?: string | null }} data
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
  const attendanceStartDate =
    data.attendanceStartDate === undefined
      ? undefined
      : normalizeAttendanceStartDate(data.attendanceStartDate);

  if (data.checkInTime && checkInTime === null) {
    throw new Error("Invalid check-in time. Use HH:mm format.");
  }
  if (data.checkOutTime && checkOutTime === null) {
    throw new Error("Invalid check-out time. Use HH:mm format.");
  }
  if (
    data.attendanceStartDate !== undefined &&
    data.attendanceStartDate !== null &&
    data.attendanceStartDate !== "" &&
    attendanceStartDate === null
  ) {
    throw new Error("Invalid attendance start date. Use YYYY-MM-DD.");
  }

  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: {
      ...(checkInTime !== undefined ? { dailyCheckInTime: checkInTime } : {}),
      ...(checkOutTime !== undefined ? { dailyCheckOutTime: checkOutTime } : {}),
      ...(attendanceStartDate !== undefined
        ? { attendanceStartDate }
        : {}),
    },
    select: {
      dailyCheckInTime: true,
      dailyCheckOutTime: true,
      attendanceStartDate: true,
      updatedAt: true,
    },
  });

  return {
    checkInTime: updated.dailyCheckInTime,
    checkOutTime: updated.dailyCheckOutTime,
    attendanceStartDate: updated.attendanceStartDate,
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

/**
 * @param {boolean} attendanceEnabled
 */
export async function setCompanyAttendanceEnabled(attendanceEnabled) {
  await syncCompanyTrialSettings();
  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { attendanceEnabled: !!attendanceEnabled },
    select: { attendanceEnabled: true, updatedAt: true },
  });
  return {
    attendanceEnabled: updated.attendanceEnabled,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * @param {boolean} taskAssignmentEmailEnabled
 */
export async function setCompanyTaskAssignmentEmailEnabled(taskAssignmentEmailEnabled) {
  await syncCompanyTrialSettings();
  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { taskAssignmentEmailEnabled: !!taskAssignmentEmailEnabled },
    select: { taskAssignmentEmailEnabled: true, updatedAt: true },
  });
  return {
    taskAssignmentEmailEnabled: updated.taskAssignmentEmailEnabled,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

function normalizeReportEmail(value) {
  if (value == null || value === "") return null;
  const email = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 191) return null;
  return email;
}

/**
 * @param {{
 *   checkoutRequiresTasksDone?: boolean;
 *   dailyTaskReportTime?: string | null;
 *   dailyTaskReportEmail?: string | null;
 * }} data
 */
export async function setCheckoutTaskGateSettings(data) {
  await syncCompanyTrialSettings();
  const patch = {};
  if (data.checkoutRequiresTasksDone !== undefined) {
    patch.checkoutRequiresTasksDone = !!data.checkoutRequiresTasksDone;
  }
  if (data.dailyTaskReportTime !== undefined) {
    if (data.dailyTaskReportTime === null || data.dailyTaskReportTime === "") {
      patch.dailyTaskReportTime = null;
    } else {
      const normalized = normalizeTimeHHmm(data.dailyTaskReportTime);
      if (!normalized) {
        throw new Error("Invalid daily task report time. Use HH:mm format.");
      }
      patch.dailyTaskReportTime = normalized;
    }
  }
  if (data.dailyTaskReportEmail !== undefined) {
    if (data.dailyTaskReportEmail === null || data.dailyTaskReportEmail === "") {
      patch.dailyTaskReportEmail = null;
    } else {
      const email = normalizeReportEmail(data.dailyTaskReportEmail);
      if (!email) {
        throw new Error("Invalid daily task report email.");
      }
      patch.dailyTaskReportEmail = email;
    }
  }
  if (!Object.keys(patch).length) {
    return getCheckoutTaskGateSettings();
  }
  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: patch,
    select: {
      checkoutRequiresTasksDone: true,
      dailyTaskReportTime: true,
      dailyTaskReportEmail: true,
      updatedAt: true,
    },
  });
  return {
    checkoutRequiresTasksDone: updated.checkoutRequiresTasksDone === true,
    dailyTaskReportTime: updated.dailyTaskReportTime ?? null,
    dailyTaskReportEmail: updated.dailyTaskReportEmail ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/** @param {string} dateKey YYYY-MM-DD */
export async function markDailyTaskReportSent(dateKey) {
  await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { dailyTaskReportLastSentOn: String(dateKey).slice(0, 10) },
  });
}
