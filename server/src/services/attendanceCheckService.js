import { prisma } from "../lib/prisma.js";
import { findNearestWorkLocation, validateCoordinates } from "../lib/geofence.js";
import { getActiveWorkLocations } from "./workLocationService.js";
import {
  getDailyAttendanceSchedule,
  isCompanyAttendanceEnabled,
} from "./companyAttendanceSettings.js";
import {
  evaluateCheckInTiming,
  evaluateCheckOutTiming,
} from "../lib/attendanceSchedule.js";

function startOfDayLocal(dateStr) {
  let start;
  if (dateStr) {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error("Invalid date");
    start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(start.getTime())) throw new Error("Invalid date");
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function serializeCheck(row, schedule = null) {
  let timingStatus = row.timingStatus ?? null;
  if (schedule) {
    if (row.type === "check_in" && schedule.checkInTime) {
      timingStatus = evaluateCheckInTiming(row.recordedAt, schedule.checkInTime);
    } else if (row.type === "check_out" && schedule.checkOutTime) {
      timingStatus = evaluateCheckOutTiming(row.recordedAt, schedule.checkOutTime);
    }
  }
  return {
    id: row.id,
    type: row.type,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceMeters: Math.round(row.distanceMeters),
    withinRadius: row.withinRadius,
    timingStatus,
    recordedAt: row.recordedAt.toISOString(),
    locationName: row.workLocation?.name ?? null,
    workLocationId: row.workLocationId,
  };
}

async function evaluateProximity(latitude, longitude) {
  validateCoordinates(latitude, longitude);
  const locations = await getActiveWorkLocations();
  if (!locations.length) {
    return {
      locationsConfigured: false,
      nearest: null,
    };
  }
  const nearest = findNearestWorkLocation(latitude, longitude, locations);
  return {
    locationsConfigured: true,
    nearest: nearest
      ? {
          locationId: nearest.location.id,
          locationName: nearest.location.name,
          distanceMeters: Math.round(nearest.distanceMeters),
          radiusMeters: nearest.location.radiusMeters,
          withinRadius: nearest.withinRadius,
          coordinates: `${nearest.location.latitude}, ${nearest.location.longitude}`,
        }
      : null,
  };
}

async function getChecksForDay(userId, dayStart, dayEnd) {
  return prisma.attendanceCheck.findMany({
    where: {
      userId,
      recordedAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { recordedAt: "asc" },
    include: { workLocation: true },
  });
}

function summarizeDayChecks(checks, schedule = null) {
  const checkInRow = checks.find((c) => c.type === "check_in") ?? null;
  const checkOutRow = checks.find((c) => c.type === "check_out") ?? null;
  return {
    isCheckedIn: Boolean(checkInRow && !checkOutRow),
    checkIn: checkInRow ? serializeCheck(checkInRow, schedule) : null,
    checkOut: checkOutRow ? serializeCheck(checkOutRow, schedule) : null,
  };
}

function deriveTodayStatus(checks, schedule = null) {
  const summary = summarizeDayChecks(checks, schedule);
  const hasCheckIn = Boolean(summary.checkIn);
  const hasCheckOut = Boolean(summary.checkOut);
  return {
    isCheckedIn: summary.isCheckedIn,
    dayComplete: hasCheckIn && hasCheckOut,
    canCheckIn: !hasCheckIn,
    canCheckOut: hasCheckIn && !hasCheckOut,
    lastCheckIn: summary.checkIn,
    lastCheckOut: summary.checkOut,
  };
}

export async function getCheckStatus(userId, { latitude, longitude } = {}) {
  const attendanceEnabled = await isCompanyAttendanceEnabled();
  if (!attendanceEnabled) {
    return {
      attendanceEnabled: false,
      date: startOfDayLocal().start.toISOString().slice(0, 10),
      locationsCount: 0,
      schedule: await getDailyAttendanceSchedule(),
      isCheckedIn: false,
      dayComplete: false,
      canCheckIn: false,
      canCheckOut: false,
      lastCheckIn: null,
      lastCheckOut: null,
      proximity: null,
    };
  }

  const { start, end } = startOfDayLocal();
  const checks = await getChecksForDay(userId, start, end);
  const schedule = await getDailyAttendanceSchedule();
  const today = deriveTodayStatus(checks, schedule);

  let proximity = null;
  if (latitude != null && longitude != null) {
    proximity = await evaluateProximity(latitude, longitude);
  }

  const locations = await getActiveWorkLocations();

  return {
    attendanceEnabled: true,
    date: start.toISOString().slice(0, 10),
    locationsCount: locations.length,
    schedule,
    ...today,
    proximity,
  };
}

export async function performCheck(userId, type, latitude, longitude) {
  if (!(await isCompanyAttendanceEnabled())) {
    throw new Error("Attendance is turned off for your company.");
  }

  const proximity = await evaluateProximity(latitude, longitude);
  if (!proximity.locationsConfigured) {
    throw new Error("No work locations configured. Ask your admin to add locations in Settings.");
  }
  if (!proximity.nearest?.withinRadius) {
    const name = proximity.nearest?.locationName ?? "nearest location";
    const dist = proximity.nearest?.distanceMeters ?? 0;
    throw new Error(`You are ${dist} meters away from ${name}. Move closer to check ${type === "check_in" ? "in" : "out"}.`);
  }

  const { start, end } = startOfDayLocal();
  const checks = await getChecksForDay(userId, start, end);
  const today = deriveTodayStatus(checks);

  if (type === "check_in" && !today.canCheckIn) {
    if (today.dayComplete || today.lastCheckOut) {
      throw new Error("You already completed attendance for today.");
    }
    throw new Error("You already checked in today.");
  }
  if (type === "check_out" && !today.canCheckOut) {
    if (today.lastCheckOut) {
      throw new Error("You already checked out today.");
    }
    throw new Error("You are not checked in yet.");
  }

  const schedule = await getDailyAttendanceSchedule();
  const now = new Date();
  const timingStatus =
    type === "check_in"
      ? evaluateCheckInTiming(now, schedule.checkInTime)
      : evaluateCheckOutTiming(now, schedule.checkOutTime);

  const row = await prisma.attendanceCheck.create({
    data: {
      userId,
      type,
      latitude,
      longitude,
      workLocationId: proximity.nearest.locationId,
      distanceMeters: proximity.nearest.distanceMeters,
      withinRadius: true,
      timingStatus,
    },
    include: { workLocation: true },
  });

  return {
    check: serializeCheck(row, schedule),
    status: await getCheckStatus(userId),
  };
}

export async function getDailyAttendanceReport(dateStr) {
  const { start, end } = startOfDayLocal(dateStr);
  const schedule = await getDailyAttendanceSchedule();

  const employees = await prisma.user.findMany({
    where: { role: "employee" },
    select: { id: true, displayName: true, email: true },
    orderBy: { displayName: "asc" },
  });

  const checks = await prisma.attendanceCheck.findMany({
    where: { recordedAt: { gte: start, lt: end } },
    include: { workLocation: true },
    orderBy: { recordedAt: "asc" },
  });

  const byUser = new Map();
  for (const check of checks) {
    if (!byUser.has(check.userId)) byUser.set(check.userId, []);
    byUser.get(check.userId).push(check);
  }

  return {
    date: start.toISOString().slice(0, 10),
    employees: employees.map((emp) => {
      const userChecks = byUser.get(emp.id) ?? [];
      const summary = summarizeDayChecks(userChecks, schedule);
      return {
        userId: emp.id,
        displayName: emp.displayName,
        email: emp.email,
        checkIn: summary.checkIn,
        checkOut: summary.checkOut,
        isCheckedIn: summary.isCheckedIn,
        allChecks: userChecks.map((c) => serializeCheck(c, schedule)),
      };
    }),
  };
}

function dateKeyFromDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSundayDateKey(dateKey) {
  const { start } = startOfDayLocal(dateKey);
  return start.getDay() === 0;
}

function listWorkingDayKeysInMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const keys = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isSundayDateKey(dateKey)) keys.push(dateKey);
  }
  return keys;
}

function minutesFromDaySummary(summary, dateKey) {
  if (!summary.checkIn?.recordedAt) return 0;
  const start = new Date(summary.checkIn.recordedAt);
  let end = summary.checkOut?.recordedAt ? new Date(summary.checkOut.recordedAt) : null;
  if (!end && summary.isCheckedIn) {
    const todayKey = dateKeyFromDate(new Date());
    if (dateKey === todayKey) end = new Date();
  }
  if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes >= 0 ? minutes : 0;
}

export async function getMonthlyAttendanceReport(year, month) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Invalid year.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month.");
  }

  const schedule = await getDailyAttendanceSchedule();
  const workingDayKeys = listWorkingDayKeysInMonth(year, month);
  const workingDays = workingDayKeys.length;

  const firstKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastKey = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const { start } = startOfDayLocal(firstKey);
  const { end } = startOfDayLocal(lastKey);

  const employees = await prisma.user.findMany({
    where: { role: "employee" },
    select: { id: true, displayName: true, email: true, salary: true },
    orderBy: { displayName: "asc" },
  });

  const checks = await prisma.attendanceCheck.findMany({
    where: { recordedAt: { gte: start, lt: end } },
    include: { workLocation: true },
    orderBy: { recordedAt: "asc" },
  });

  const byUserDay = new Map();
  for (const check of checks) {
    const dayKey = dateKeyFromDate(check.recordedAt);
    if (!byUserDay.has(check.userId)) byUserDay.set(check.userId, new Map());
    const userDays = byUserDay.get(check.userId);
    if (!userDays.has(dayKey)) userDays.set(dayKey, []);
    userDays.get(dayKey).push(check);
  }

  return {
    year,
    month,
    workingDays,
    employees: employees.map((emp) => {
      const userDays = byUserDay.get(emp.id) ?? new Map();
      let present = 0;
      let totalMinutes = 0;

      for (const dayKey of workingDayKeys) {
        const dayChecks = userDays.get(dayKey) ?? [];
        const summary = summarizeDayChecks(dayChecks, schedule);
        if (summary.checkIn) {
          present += 1;
          totalMinutes += minutesFromDaySummary(summary, dayKey);
        }
      }

      return {
        userId: emp.id,
        displayName: emp.displayName,
        email: emp.email,
        salary: emp.salary ?? 15000,
        present,
        absent: workingDays - present,
        workingDays,
        totalMinutes,
      };
    }),
  };
}

export async function getMyAttendanceHistory(userId, { days = 14 } = {}) {
  const schedule = await getDailyAttendanceSchedule();
  const { start: todayStart } = startOfDayLocal();
  const safeDays = Math.min(30, Math.max(1, days));
  const history = [];

  for (let i = 1; i <= safeDays; i += 1) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const { start, end } = startOfDayLocal(dateStr);
    const checks = await getChecksForDay(userId, start, end);
    const summary = summarizeDayChecks(checks, schedule);
    history.push({
      date: dateStr,
      present: Boolean(summary.checkIn),
      checkIn: summary.checkIn,
      checkOut: summary.checkOut,
    });
  }

  return { history };
}
