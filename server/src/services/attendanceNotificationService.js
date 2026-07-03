import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";
import { adminUserWhere } from "../lib/adminUsers.js";

const LOG = "[attendance-notify]";
const ATTENDANCE_URL = "/?openAttendance=1";

async function sendAttendancePushToAdmins({
  employeeId,
  employeeName,
  type,
  title,
  body,
  tag,
  extra = {},
}) {
  const admins = await prisma.user.findMany({
    where: { AND: [adminUserWhere, { id: { not: employeeId } }] },
    select: { id: true },
  });
  if (!admins.length) return;

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
          type,
          payload: {
            type,
            employeeId,
            employeeName,
            url: ATTENDANCE_URL,
            ...extra,
          },
        };
        const result = await sendPushToSubscription(sub, payload);
        if (result.ok) {
          console.log(`${LOG} web push sent type=${type} employeeId=${employeeId} adminId=${admin.id}`);
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
            type,
            title,
            body,
            employeeId,
            employeeName,
            url: ATTENDANCE_URL,
            ...extra,
          },
        });
      } catch (err) {
        console.warn(`${LOG} FCM failed adminId=${admin.id}`, err?.message || err);
      }
    }
  }
}

export async function notifyAdminsLocationTrackingOff({ employeeId, employeeName, reason }) {
  await sendAttendancePushToAdmins({
    employeeId,
    employeeName,
    type: "location_tracking_off",
    title: "Location tracking turned off",
    body: `${employeeName} turned off live location tracking.`,
    tag: `taskmgr-loc-off-${employeeId}`,
    extra: { reason },
  });
}

export async function notifyAdminsLocationTrackingOn({ employeeId, employeeName, resumedAt }) {
  const when = resumedAt instanceof Date ? resumedAt.toISOString() : resumedAt;
  await sendAttendancePushToAdmins({
    employeeId,
    employeeName,
    type: "location_tracking_on",
    title: "Location tracking back on",
    body: `${employeeName} turned live location tracking back on.`,
    tag: `taskmgr-loc-on-${employeeId}`,
    extra: { resumedAt: when },
  });
}
