import { prisma } from "../lib/prisma.js";
import { findNearestWorkLocation, validateCoordinates } from "../lib/geofence.js";
import { getActiveWorkLocations } from "./workLocationService.js";

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

function serializeCheck(row) {
  return {
    id: row.id,
    type: row.type,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceMeters: Math.round(row.distanceMeters),
    withinRadius: row.withinRadius,
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

function summarizeDayChecks(checks) {
  const checkIns = checks.filter((c) => c.type === "check_in");
  const checkOuts = checks.filter((c) => c.type === "check_out");
  const isCheckedIn = checkIns.length > checkOuts.length;

  let displayCheckIn = checkIns[0] ?? null;
  let displayCheckOut = null;

  if (isCheckedIn) {
    displayCheckIn = checkIns[checkIns.length - 1] ?? null;
  } else if (checkOuts.length) {
    displayCheckOut = checkOuts[checkOuts.length - 1];
    const idx = checks.findIndex((c) => c.id === displayCheckOut.id);
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (checks[i].type === "check_in") {
        displayCheckIn = checks[i];
        break;
      }
    }
  }

  return {
    isCheckedIn,
    checkIn: displayCheckIn ? serializeCheck(displayCheckIn) : null,
    checkOut: displayCheckOut ? serializeCheck(displayCheckOut) : null,
  };
}

function deriveTodayStatus(checks) {
  const summary = summarizeDayChecks(checks);
  return {
    isCheckedIn: summary.isCheckedIn,
    canCheckIn: !summary.isCheckedIn,
    canCheckOut: summary.isCheckedIn,
    lastCheckIn: summary.checkIn,
    lastCheckOut: summary.checkOut,
  };
}

export async function getCheckStatus(userId, { latitude, longitude } = {}) {
  const { start, end } = startOfDayLocal();
  const checks = await getChecksForDay(userId, start, end);
  const today = deriveTodayStatus(checks);

  let proximity = null;
  if (latitude != null && longitude != null) {
    proximity = await evaluateProximity(latitude, longitude);
  }

  const locations = await getActiveWorkLocations();

  return {
    date: start.toISOString().slice(0, 10),
    locationsCount: locations.length,
    ...today,
    proximity,
  };
}

export async function performCheck(userId, type, latitude, longitude) {
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
    throw new Error("You are already checked in. Check out first.");
  }
  if (type === "check_out" && !today.canCheckOut) {
    throw new Error("You are not checked in yet.");
  }

  const row = await prisma.attendanceCheck.create({
    data: {
      userId,
      type,
      latitude,
      longitude,
      workLocationId: proximity.nearest.locationId,
      distanceMeters: proximity.nearest.distanceMeters,
      withinRadius: true,
    },
    include: { workLocation: true },
  });

  return {
    check: serializeCheck(row),
    status: await getCheckStatus(userId),
  };
}

export async function getDailyAttendanceReport(dateStr) {
  const { start, end } = startOfDayLocal(dateStr);

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
      const summary = summarizeDayChecks(userChecks);
      return {
        userId: emp.id,
        displayName: emp.displayName,
        email: emp.email,
        checkIn: summary.checkIn,
        checkOut: summary.checkOut,
        isCheckedIn: summary.isCheckedIn,
        allChecks: userChecks.map(serializeCheck),
      };
    }),
  };
}
