import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";
import { adminUserWhere } from "../lib/adminUsers.js";

const LOG = "[task-progress-notify]";

function previewTitle(title) {
  const t = String(title || "").trim();
  if (!t) return "Task";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function previewMessage(message) {
  const t = String(message || "").trim();
  if (!t || t === "(Attachment)") return "";
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function updateTypeLabel(updateType) {
  switch (updateType) {
    case "started":
      return "Started";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    default:
      return "Update";
  }
}

function buildOpenUrl({ taskId, listId, employeeId }) {
  const p = new URLSearchParams();
  p.set("openTask", taskId);
  if (listId) p.set("listId", listId);
  if (employeeId) p.set("employeeId", employeeId);
  p.set("openProgress", "1");
  p.set("from", "notify");
  return `/?${p.toString()}`;
}

/**
 * Notify all admins when an employee posts a progress / in-review update (text and/or attachments).
 * @param {{
 *   taskId: string,
 *   taskTitle: string,
 *   listId: string,
 *   employeeId: string,
 *   employeeName: string,
 *   updateType?: string,
 *   message?: string,
 *   attachmentCount?: number,
 * }} params
 */
export async function notifyAdminsTaskProgressUpdate({
  taskId,
  taskTitle,
  listId,
  employeeId,
  employeeName,
  updateType = "update",
  message = "",
  attachmentCount = 0,
}) {
  const admins = await prisma.user.findMany({
    where: { AND: [adminUserWhere, { id: { not: employeeId } }] },
    select: { id: true },
  });
  if (!admins.length) return;

  const shortTitle = previewTitle(taskTitle);
  const typeLabel = updateTypeLabel(updateType);
  const msgPreview = previewMessage(message);
  const hasFiles = Number(attachmentCount) > 0;
  const title = "Task update";
  let body = `${employeeName} posted a ${typeLabel.toLowerCase()} on “${shortTitle}”`;
  if (msgPreview) body += `: ${msgPreview}`;
  else if (hasFiles) body += ` with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  else body += ".";
  const url = buildOpenUrl({ taskId, listId, employeeId });
  const tag = `taskmgr-progress-${taskId}-${employeeId}-${Date.now()}`;

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
          type: "task_progress_update",
          payload: {
            type: "task_progress_update",
            taskId,
            listId,
            employeeId,
            employeeName,
            title: shortTitle,
            updateType,
            attachmentCount: String(attachmentCount || 0),
            openProgress: "1",
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
          type: "task_progress_update",
          taskId,
          listId,
          employeeId,
          employeeName,
          title: shortTitle,
          updateType,
          attachmentCount: String(attachmentCount || 0),
          openProgress: "1",
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
