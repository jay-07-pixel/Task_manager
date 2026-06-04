import { prisma } from "../lib/prisma.js";
import { sendFcmNotification } from "../lib/fcm.js";

const LOG = "[fcm-push]";

/**
 * Latest device for user by last_seen_at (most recently active).
 * @param {string} userId
 */
export async function getLatestEmployeeDevice(userId) {
  return prisma.employeeDevice.findFirst({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      deviceId: true,
      platform: true,
      appVersion: true,
      lastSeenAt: true,
      fcmToken: true,
    },
  });
}

/**
 * Send a test notification to the user's latest registered device.
 * @param {string} userId
 */
export async function sendTestPushToUser(userId) {
  const device = await getLatestEmployeeDevice(userId);
  if (!device) {
    return {
      ok: false,
      error: "No registered device found for this user.",
      code: "device/not-found",
    };
  }

  const result = await sendFcmNotification({
    token: device.fcmToken,
    title: "Task Manager test",
    body: "FCM delivery test — if you see this, push is working.",
    data: {
      type: "test",
      deviceId: device.deviceId,
    },
  });

  const deviceSummary = {
    id: device.id,
    deviceId: device.deviceId,
    platform: device.platform,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt.toISOString(),
  };

  if (!result.ok) {
    console.warn(`${LOG} test failed userId=${userId} deviceId=${device.deviceId} code=${result.code}`);
    return {
      ok: false,
      error: result.error,
      code: result.code,
      device: deviceSummary,
    };
  }

  console.log(
    `${LOG} test sent userId=${userId} deviceId=${device.deviceId} messageId=${result.messageId}`
  );

  return {
    ok: true,
    messageId: result.messageId,
    device: deviceSummary,
    message: "Test notification sent to your latest device.",
  };
}
