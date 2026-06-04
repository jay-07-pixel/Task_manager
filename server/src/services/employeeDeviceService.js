import { prisma } from "../lib/prisma.js";

const LOG = "[employee-device]";

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
  return { id: device.id, deviceId: device.deviceId, created: true };
}
