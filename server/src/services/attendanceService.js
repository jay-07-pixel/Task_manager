import { prisma } from "../lib/prisma.js";

const STALE_PING_MS = 5 * 60 * 1000;

export async function getOrCreatePreference(userId) {
  let pref = await prisma.employeeLocationPreference.findUnique({ where: { userId } });
  if (!pref) {
    pref = await prisma.employeeLocationPreference.create({
      data: { userId, trackingEnabled: false },
    });
  }
  return pref;
}

export async function getEmployeeStatus(userId) {
  const pref = await getOrCreatePreference(userId);
  const lastPing = await prisma.employeeLocationPing.findFirst({
    where: { userId },
    orderBy: { recordedAt: "desc" },
  });
  const openOff = await prisma.employeeLocationOffPeriod.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  const canAccessApp =
    pref.trackingEnabled && !!pref.consentAt && !!lastPing && !openOff;
  return {
    consentAt: pref.consentAt?.toISOString() ?? null,
    trackingEnabled: pref.trackingEnabled,
    lastPing: lastPing
      ? {
          latitude: lastPing.latitude,
          longitude: lastPing.longitude,
          accuracy: lastPing.accuracy,
          recordedAt: lastPing.recordedAt.toISOString(),
        }
      : null,
    openOffPeriod: openOff
      ? {
          id: openOff.id,
          startedAt: openOff.startedAt.toISOString(),
          reason: openOff.reason,
        }
      : null,
    canAccessApp,
  };
}

export async function enableTrackingWithConsent(userId) {
  const hadOpenOff = await prisma.employeeLocationOffPeriod.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  await prisma.employeeLocationPreference.upsert({
    where: { userId },
    create: {
      userId,
      consentAt: new Date(),
      trackingEnabled: true,
    },
    update: {
      consentAt: new Date(),
      trackingEnabled: true,
    },
  });
  const resumedAt = new Date();
  await closeOpenOffPeriod(userId);
  return {
    resumedTracking: !!hadOpenOff,
    offStartedAt: hadOpenOff?.startedAt ?? null,
    resumedAt,
  };
}

export async function closeOpenOffPeriod(userId) {
  await prisma.employeeLocationOffPeriod.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

export async function startOffPeriod(userId, reason) {
  await closeOpenOffPeriod(userId);
  return prisma.employeeLocationOffPeriod.create({
    data: { userId, reason },
  });
}

export async function disableTracking(userId, reason = "user_disabled") {
  await prisma.employeeLocationPreference.upsert({
    where: { userId },
    create: { userId, trackingEnabled: false },
    update: { trackingEnabled: false },
  });
  const open = await prisma.employeeLocationOffPeriod.findFirst({
    where: { userId, endedAt: null },
  });
  if (!open) {
    await startOffPeriod(userId, reason);
  }
}

export async function recordPing(userId, { latitude, longitude, accuracy }) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Invalid coordinates");
  }
  if (typeof accuracy === "number" && !Number.isNaN(accuracy) && accuracy > 150) {
    throw new Error("Precise location required — approximate location is not accepted");
  }
  const pref = await getOrCreatePreference(userId);
  if (!pref.trackingEnabled) {
    throw new Error("Location tracking is disabled");
  }
  const ping = await prisma.employeeLocationPing.create({
    data: {
      userId,
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" && !Number.isNaN(accuracy) ? accuracy : null,
    },
  });
  return ping;
}

function isPingStale(recordedAt) {
  if (!recordedAt) return true;
  return Date.now() - new Date(recordedAt).getTime() > STALE_PING_MS;
}

export async function getLiveEmployeesForAdmin() {
  const employees = await prisma.user.findMany({
    where: { role: "employee" },
    select: {
      id: true,
      displayName: true,
      email: true,
      locationPreference: true,
      locationPings: {
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
      locationOffPeriods: {
        orderBy: { startedAt: "desc" },
        take: 5,
      },
    },
    orderBy: { displayName: "asc" },
  });

  const rows = employees.map((emp) => {
    const pref = emp.locationPreference;
    const lastPing = emp.locationPings[0] ?? null;
    const openOff = emp.locationOffPeriods.find((p) => !p.endedAt) ?? null;
    const lastClosedOff = emp.locationOffPeriods.find((p) => p.endedAt) ?? null;
    const trackingOn = !!pref?.trackingEnabled && !openOff;
    return {
      id: emp.id,
      displayName: emp.displayName,
      email: emp.email,
      trackingEnabled: !!pref?.trackingEnabled,
      consentAt: pref?.consentAt?.toISOString() ?? null,
      trackingOn,
      isOff: !!openOff || !pref?.trackingEnabled,
      offSince: openOff?.startedAt.toISOString() ?? null,
      offReason: openOff?.reason ?? null,
      trackingResumedAt: lastClosedOff?.endedAt?.toISOString() ?? null,
      lastPing: lastPing
        ? {
            latitude: lastPing.latitude,
            longitude: lastPing.longitude,
            accuracy: lastPing.accuracy,
            recordedAt: lastPing.recordedAt.toISOString(),
            stale: isPingStale(lastPing.recordedAt),
          }
        : null,
    };
  });

  // Live employees first, then by name
  rows.sort((a, b) => {
    const aLive = a.trackingOn && !a.isOff ? 0 : 1;
    const bLive = b.trackingOn && !b.isOff ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, {
      sensitivity: "base",
    });
  });

  return rows;
}

export async function getEmployeeOffHistory(userId, { limit = 50 } = {}) {
  const periods = await prisma.employeeLocationOffPeriod.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  const pings = await prisma.employeeLocationPing.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: 500,
  });

  return periods.map((p) => {
    const offPing = nearestPingBefore(pings, p.startedAt);
    const onPing = p.endedAt ? nearestPingAfter(pings, p.endedAt) : null;
    return {
      id: p.id,
      startedAt: p.startedAt.toISOString(),
      endedAt: p.endedAt?.toISOString() ?? null,
      reason: p.reason,
      durationMs: p.endedAt
        ? p.endedAt.getTime() - p.startedAt.getTime()
        : Date.now() - p.startedAt.getTime(),
      offLocation: offPing
        ? {
            latitude: offPing.latitude,
            longitude: offPing.longitude,
            recordedAt: offPing.recordedAt.toISOString(),
          }
        : null,
      onLocation: onPing
        ? {
            latitude: onPing.latitude,
            longitude: onPing.longitude,
            recordedAt: onPing.recordedAt.toISOString(),
          }
        : null,
    };
  });
}

function nearestPingBefore(pingsDesc, isoTime) {
  const t = new Date(isoTime).getTime();
  for (const p of pingsDesc) {
    if (new Date(p.recordedAt).getTime() <= t) return p;
  }
  return pingsDesc.length ? pingsDesc[pingsDesc.length - 1] : null;
}

function nearestPingAfter(pingsDesc, isoTime) {
  const t = new Date(isoTime).getTime();
  for (let i = pingsDesc.length - 1; i >= 0; i -= 1) {
    const p = pingsDesc[i];
    if (new Date(p.recordedAt).getTime() >= t) return p;
  }
  return null;
}

export async function getRecentPings(userId, { limit = 100 } = {}) {
  const pings = await prisma.employeeLocationPing.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
  return pings.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: p.accuracy,
    recordedAt: p.recordedAt.toISOString(),
  }));
}
