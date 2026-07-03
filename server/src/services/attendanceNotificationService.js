import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";
import { adminUserWhere } from "../lib/adminUsers.js";

const LOG = "[attendance-notify]";

export async function notifyAdminsLocationTrackingOff({ employeeId, employeeName, reason }) {
  const admins = await prisma.user.findMany({
    where: { AND: [adminUserWhere, { id: { not: employeeId } }] },
    select: { id: true },
  });
  if (!admins.length) return;

  const title = "Location tracking turned off";
  const body = `${employeeName} turned off live location tracking.`;
  const url = "/?openAttendance=1";
  const tag = `taskmgr-loc-off-${employeeId}`;

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
          type: "location_tracking_off",
          payload: {
            type: "location_tracking_off",
            employeeId,
            employeeName,
            reason,
            url,
          },
        };
        const result = await sendPushToSubscription(sub, payload);
        if (result.ok) {
          console.log(`${LOG} web push sent employeeId=${employeeId} adminId=${admin.id}`);
        } else if (result.gone) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    const devices = await getEmployeeDevicesForUser(admin.id);
    for (const device of devices) {
      try {
        await sendFcmDataMessage(device.fcmToken, {
          type: "location_tracking_off",
          title,
          body,
          employeeId,
          employeeName,
          reason,
          url,
        });
      } catch (err) {
        console.warn(`${LOG} FCM failed adminId=${admin.id}`, err?.message || err);
      }
    }
  }
}
