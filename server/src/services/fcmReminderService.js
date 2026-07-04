import { formatDueTime } from "../lib/formatDueTime.js";
import { minutesFromBeforeSlot } from "../lib/reminderTiming.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";

const LOG = "[fcm-reminder]";
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function bodyForSlot(slot, title, dueLabel) {
  const dueSuffix = dueLabel ? ` — ${dueLabel}` : "";
  const beforeMinutes = minutesFromBeforeSlot(slot);
  if (beforeMinutes != null) {
    return `${title}${dueSuffix}`;
  }
  if (slot === "followup1h") {
    return `${title}${dueSuffix} (overdue 1 hour)`;
  }
  if (slot === "followup6h") {
    return `${title}${dueSuffix} (overdue 6 hours)`;
  }
  if (slot === "followup24h") {
    return `${title}${dueSuffix} (overdue 24 hours)`;
  }
  return dueLabel ? `${title} — ${dueLabel}` : title;
}

/**
 * Send task_reminder to every registered device for the user.
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
  const devices = await getEmployeeDevicesForUser(userId);
  if (!devices.length) {
    return {
      ok: false,
      code: "device/not-found",
      error: "No registered device for user.",
    };
  }

  const dueLabel = formatDueTime(dueAt, allDay, dueTimeZone);
  const body = bodyForSlot(slot, title, dueLabel);

  let anyOk = false;
  let lastError = null;
  const staleDeviceIds = [];

  for (const device of devices) {
    const result = await sendFcmDataMessage({
      token: device.fcmToken,
      data: {
        type: "task_reminder",
        taskId,
        title,
        slot,
        dueAt: dueAt.toISOString(),
        body,
      },
    });

    if (result.ok) {
      anyOk = true;
      console.log(
        `${LOG} sent taskId=${taskId} userId=${userId} slot=${slot} deviceId=${device.deviceId} messageId=${result.messageId}`
      );
      continue;
    }

    lastError = result.error ?? result.code ?? "FCM send failed";
    console.warn(
      `${LOG} send failed taskId=${taskId} userId=${userId} slot=${slot} deviceId=${device.deviceId} code=${result.code}`
    );

    if (INVALID_TOKEN_CODES.has(result.code)) {
      staleDeviceIds.push(device.deviceId);
    }
  }

  return {
    ok: anyOk,
    code: anyOk ? undefined : "fcm/all-failed",
    error: anyOk ? undefined : lastError,
    deviceId: staleDeviceIds[0] ?? devices[0]?.deviceId,
    invalidateDevice: staleDeviceIds.length > 0,
    staleDeviceIds,
  };
}
