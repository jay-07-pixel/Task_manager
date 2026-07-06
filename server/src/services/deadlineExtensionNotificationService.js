import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";
import { adminUserWhere } from "../lib/adminUsers.js";

const LOG = "[deadline-ext-notify]";
const DEADLINE_EXTENSIONS_URL = "/?openDeadlineExtensions=1";

async function sendDeadlineExtensionPushToAdmins({
  employeeId,
  employeeName,
  taskId,
  taskTitle,
  overdueDays,
  requestId,
}) {
  const admins = await prisma.user.findMany({
    where: { AND: [adminUserWhere, { id: { not: employeeId } }] },
    select: { id: true },
  });
  if (!admins.length) return;

  const title = "Deadline extension request";
  const body = `${employeeName} asked to postpone "${taskTitle}" (${overdueDays}+ days overdue).`;

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
          tag: `taskmgr-deadline-ext-${requestId}`,
          type: "deadline_extension_request",
          payload: {
            type: "deadline_extension_request",
            employeeId,
            employeeName,
            taskId,
            taskTitle,
            requestId,
            overdueDays: String(overdueDays),
            url: DEADLINE_EXTENSIONS_URL,
          },
        };
        const result = await sendPushToSubscription(sub, payload);
        if (result.ok) {
          console.log(`${LOG} web push sent requestId=${requestId} adminId=${admin.id}`);
        } else if (result.gone) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    const devices = await getEmployeeDevicesForUser(admin.id);
    for (const device of devices) {
      try {
        await sendFcmDataMessage({
          token: device.fcmToken,
          data: {
            type: "deadline_extension_request",
            title,
            body,
            employeeId,
            employeeName,
            taskId,
            taskTitle,
            requestId,
            overdueDays: String(overdueDays),
            url: DEADLINE_EXTENSIONS_URL,
          },
        });
      } catch (err) {
        console.warn(`${LOG} FCM failed adminId=${admin.id}`, err?.message || err);
      }
    }
  }
}

export async function notifyAdminsDeadlineExtensionRequest({
  employeeId,
  employeeName,
  taskId,
  taskTitle,
  overdueDays,
  requestId,
}) {
  await sendDeadlineExtensionPushToAdmins({
    employeeId,
    employeeName,
    taskId,
    taskTitle,
    overdueDays,
    requestId,
  });
}
