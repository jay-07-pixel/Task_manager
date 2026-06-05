import { prisma } from "../lib/prisma.js";

const LOG = "[employee-device]";
const MAX_DEVICES_PER_USER = 5;

/**
 * Register or refresh an Android/iOS device for FCM push.
 * Upserts by unique device_id; updates token, user, and last_seen_at on repeat logins.
 *
 * @param {object} params
 * @param {string} params.userId - Authenticated user id (session)
 * @param {string} params.deviceId - Stable per-install id from the app
 * @param {string} params.fcmToken - Firebase Cloud Messaging token
 * @param {string} params.platform - e.g. "android"
 * @param {string} params.appVersion - App version string
 * @returns {Promise<{ id: string, deviceId: string, created: boolean }>}
 */
export async function registerEmployeeDevice({
  userId,
  deviceId,
  fcmToken,
  platform,
  appVersion,
}) {
  const now = new Date();

  const existing = await prisma.employeeDevice.findUnique({
    where: { deviceId },
    select: { id: true, userId: true, fcmToken: true },
  });

  if (existing) {
    const device = await prisma.employeeDevice.update({
      where: { deviceId },
      data: {
        userId,
        fcmToken,
        platform,
        appVersion,
        lastSeenAt: now,
      },
    });
    console.log(
      `${LOG} updated deviceId=${deviceId} userId=${userId} platform=${platform} ` +
        `appVersion=${appVersion} tokenChanged=${existing.fcmToken !== fcmToken}`
    );
    await pruneExcessDevices(userId, MAX_DEVICES_PER_USER);
    return { id: device.id, deviceId: device.deviceId, created: false };
  }

  const device = await prisma.employeeDevice.create({
    data: {
      userId,
      deviceId,
      fcmToken,
      platform,
      appVersion,
      lastSeenAt: now,
    },
  });
  console.log(
    `${LOG} created deviceId=${deviceId} userId=${userId} platform=${platform} appVersion=${appVersion}`
  );
  await pruneExcessDevices(userId, MAX_DEVICES_PER_USER);
  return { id: device.id, deviceId: device.deviceId, created: true };
}

/**
 * Remove this install from push delivery (logout / device replacement).
 */
export async function unregisterEmployeeDevice({ userId, deviceId }) {
  const deleted = await prisma.employeeDevice.deleteMany({
    where: { userId, deviceId },
  });
  if (deleted.count > 0) {
    console.log(`${LOG} unregistered deviceId=${deviceId} userId=${userId}`);
  }
  return { removed: deleted.count > 0 };
}

async function pruneExcessDevices(userId, maxDevices) {
  const devices = await prisma.employeeDevice.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    select: { deviceId: true },
  });
  if (devices.length <= maxDevices) return;

  const toRemove = devices.slice(maxDevices);
  for (const row of toRemove) {
    await prisma.employeeDevice.delete({ where: { deviceId: row.deviceId } }).catch(() => {});
    console.log(`${LOG} pruned stale deviceId=${row.deviceId} userId=${userId}`);
  }
}
