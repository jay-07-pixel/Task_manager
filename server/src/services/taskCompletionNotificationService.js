import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";

const LOG = "[task-complete-notify]";

function previewTitle(title) {
  const t = String(title || "").trim();
  if (!t) return "Task";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function buildOpenUrl({ taskId, listId, employeeId, allAssigneesDone }) {
  const p = new URLSearchParams();
  p.set("openTask", taskId);
  if (listId) p.set("listId", listId);
  if (employeeId) p.set("employeeId", employeeId);
  if (allAssigneesDone) p.set("allAssigneesDone", "1");
  p.set("from", "notify");
  return `/?${p.toString()}`;
}

/**
 * Notify all admins when an employee submits or completes a task assignment.
 * @param {{ taskId: string, taskTitle: string, listId: string, employeeId: string, employeeName: string, allAssigneesDone: boolean }} params
 */
export async function notifyAdminsTaskSubmitted({
  taskId,
  taskTitle,
  listId,
  employeeId,
  employeeName,
  allAssigneesDone,
}) {
  const admins = await prisma.user.findMany({
    where: { role: "owner", id: { not: employeeId } },
    select: { id: true },
  });
  if (!admins.length) return;

  const shortTitle = previewTitle(taskTitle);
  const title = allAssigneesDone ? "Task completed" : "Task submitted";
  const body = allAssigneesDone
    ? `${employeeName} completed “${shortTitle}”. All assignees are done.`
    : `${employeeName} submitted work on “${shortTitle}”.`;
  const url = buildOpenUrl({ taskId, listId, employeeId, allAssigneesDone });
  const tag = `taskmgr-submit-${taskId}-${employeeId}`;

  for (const admin of admins) {
    if (isPushConfigured()) {
      const subs = await prisma.pushSubscription.findMany({
        where: { userId: admin.id },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      for (const sub of subs) {
        const payload = {
          title,
          body,
          tag,
          type: "task_submitted",
          payload: {
            type: "task_submitted",
            taskId,
            listId,
            employeeId,
            employeeName,
            title: shortTitle,
            allAssigneesDone,
            url,
          },
        };
        const result = await sendPushToSubscription(sub, payload);
        if (result.ok) {
          console.log(`${LOG} web push sent taskId=${taskId} adminId=${admin.id}`);
        } else if (result.gone) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    const devices = await getEmployeeDevicesForUser(admin.id);
    for (const device of devices) {
      const result = await sendFcmDataMessage({
        token: device.fcmToken,
        data: {
          type: "task_submitted",
          taskId,
          listId,
          employeeId,
          employeeName,
          title: shortTitle,
          allAssigneesDone: allAssigneesDone ? "1" : "0",
          url,
          notificationTitle: title,
          notificationBody: body,
        },
      });
      if (result.ok) {
        console.log(`${LOG} FCM sent taskId=${taskId} adminId=${admin.id} deviceId=${device.deviceId}`);
      }
    }
  }
}
