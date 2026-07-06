import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";

const LOG = "[task-reopen-notify]";

function previewTitle(title) {
  const t = String(title || "").trim();
  if (!t) return "Task";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function buildOpenUrl({ taskId }) {
  const p = new URLSearchParams();
  p.set("from", "notify");
  p.set("taskId", taskId);
  p.set("reopened", "1");
  return `/?${p.toString()}`;
}

/**
 * Notify an employee when admin reopens their submitted task for resubmission.
 * @param {{ taskId: string, taskTitle: string, employeeUserId: string, adminName?: string }} params
 */
export async function notifyEmployeeTaskReopened({
  taskId,
  taskTitle,
  employeeUserId,
  adminName = "Admin",
}) {
  const shortTitle = previewTitle(taskTitle);
  const title = "Task reassigned";
  const body = `${adminName} asked you to resubmit work on “${shortTitle}”.`;
  const url = buildOpenUrl({ taskId });
  const tag = `taskmgr-reopen-${taskId}-${employeeUserId}`;

  if (isPushConfigured()) {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: employeeUserId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    for (const sub of subs) {
      const payload = {
        title,
        body,
        tag,
        type: "task_reopened",
        payload: {
          type: "task_reopened",
          taskId,
          title: shortTitle,
          url,
        },
      };
      const result = await sendPushToSubscription(sub, payload);
      if (result.ok) {
        console.log(`${LOG} web push sent taskId=${taskId} userId=${employeeUserId}`);
      } else if (result.gone) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }

  const devices = await getEmployeeDevicesForUser(employeeUserId);
  for (const device of devices) {
    const result = await sendFcmDataMessage({
      token: device.fcmToken,
      data: {
        type: "task_reopened",
        taskId,
        title: shortTitle,
        url,
        notificationTitle: title,
        notificationBody: body,
      },
    });
    if (result.ok) {
      console.log(`${LOG} FCM sent taskId=${taskId} userId=${employeeUserId} deviceId=${device.deviceId}`);
    }
  }
}
