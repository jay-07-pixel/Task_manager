import { formatDueTime } from "../lib/formatDueTime.js";
import { sendFcmNotification } from "../lib/fcm.js";
import { getLatestEmployeeDevice } from "./fcmPushService.js";

const LOG = "[fcm-reminder]";
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * @param {{ userId: string, taskId: string, title: string, dueAt: Date, allDay?: boolean, dueTimeZone?: string | null, slot: string }} params
 */
export async function sendFcmTaskReminder({
  userId,
  taskId,
  title,
  dueAt,
  allDay = false,
  dueTimeZone = null,
  slot,
}) {
  const device = await getLatestEmployeeDevice(userId);
  if (!device) {
    return {
      ok: false,
      code: "device/not-found",
      error: "No registered device for user.",
    };
  }

  const dueLabel = formatDueTime(dueAt, allDay, dueTimeZone);
  const body = dueLabel ? `${title} — ${dueLabel}` : title;

  const result = await sendFcmNotification({
    token: device.fcmToken,
    title: "Task Reminder",
    body,
    data: {
      type: "task_reminder",
      taskId,
      slot,
      dueAt: dueAt.toISOString(),
    },
  });

  if (!result.ok) {
    console.warn(
      `${LOG} send failed taskId=${taskId} userId=${userId} slot=${slot} code=${result.code}`
    );
    return {
      ...result,
      deviceId: device.deviceId,
      invalidateDevice: INVALID_TOKEN_CODES.has(result.code),
    };
  }

  console.log(
    `${LOG} sent taskId=${taskId} userId=${userId} slot=${slot} deviceId=${device.deviceId} messageId=${result.messageId}`
  );

  return {
    ok: true,
    messageId: result.messageId,
    deviceId: device.deviceId,
  };
}
