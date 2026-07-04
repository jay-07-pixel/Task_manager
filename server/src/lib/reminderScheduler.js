import { prisma } from "./prisma.js";
import { formatDueTime } from "./formatDueTime.js";
import { isFcmConfigured } from "./fcm.js";
import { isPushConfigured, sendPushToSubscription } from "./push.js";
import { sendFcmTaskReminder } from "../services/fcmReminderService.js";
import {
  formatBeforeDueReminderTitle,
  minutesFromBeforeSlot,
  reminderSlotForDue,
} from "./reminderTiming.js";

const CHANNEL_WEB = "web_push";
const CHANNEL_FCM = "fcm";
const STATUS_SENT = "sent";
const STATUS_FAILED = "failed";

const DEBUG = process.env.DEBUG_REMINDERS === "1" || process.env.DEBUG_REMINDERS === "true";

function dbg(...args) {
  if (DEBUG) console.log("[reminder:debug]", ...args);
}

function alarmPath(taskId, title, dueAt, slot) {
  const p = new URLSearchParams();
  p.set("taskId", taskId);
  p.set("title", title);
  p.set("dueAt", dueAt.toISOString());
  p.set("slot", slot);
  p.set("from", "notify");
  return `/?${p.toString()}`;
}

export { reminderSlotForDue } from "./reminderTiming.js";

function reminderSentKey(taskId, userId, dueAt, slot, channel) {
  return { taskId, userId, dueAt, slot, channel };
}

async function wasReminderDelivered(taskId, userId, dueAt, slot, channel) {
  const row = await prisma.reminderSent.findUnique({
    where: {
      taskId_userId_dueAt_slot_channel: reminderSentKey(taskId, userId, dueAt, slot, channel),
    },
    select: { status: true },
  });
  return row?.status === STATUS_SENT;
}

async function recordReminderDelivery({
  taskId,
  userId,
  dueAt,
  slot,
  channel,
  status,
  messageId = null,
  errorMessage = null,
}) {
  const key = reminderSentKey(taskId, userId, dueAt, slot, channel);
  try {
    await prisma.reminderSent.upsert({
      where: { taskId_userId_dueAt_slot_channel: key },
      create: {
        ...key,
        status,
        messageId,
        errorMessage,
      },
      update: {
        status,
        messageId,
        errorMessage,
        sentAt: new Date(),
      },
    });
    dbg("reminderSent recorded", { taskId, slot, channel, status });
  } catch (err) {
    if (err?.code === "P2002") {
      dbg("reminderSent race (P2002)", { taskId, slot, channel });
      return;
    }
    throw err;
  }
}

async function sendWebPushReminder(row, slot, title, body) {
  const dueAt = row.task.dueAt;
  if (!dueAt) return;

  const { taskId, userId } = row;
  if (await wasReminderDelivered(taskId, userId, dueAt, slot, CHANNEL_WEB)) {
    dbg("web push skip: already sent", { taskId, slot });
    return;
  }

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  dbg("push subscriptions", { userId, count: subs.length });
  if (!subs.length) {
    console.warn(`[reminder] no push_subscription for user ${userId} — cannot send ${slot}`);
    return;
  }

  const payload = {
    title,
    body,
    tag: `taskmgr-${taskId}-${dueAt.toISOString()}-${slot}`,
    payload: {
      taskId,
      title: row.task.title,
      dueAt: dueAt.toISOString(),
      slot,
      url: alarmPath(taskId, row.task.title, dueAt, slot),
    },
  };

  let anyOk = false;
  let lastError = null;
  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, payload);
    dbg("sendPushToSubscription", {
      subId: sub.id,
      ok: result.ok,
      statusCode: result.statusCode,
      message: result.message,
    });
    if (result.ok) {
      anyOk = true;
    } else {
      lastError = result.message ?? "web push failed";
      if (result.gone) {
        console.warn(`[reminder] removing invalid push_subscription ${sub.id} (${result.message})`);
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }

  if (!anyOk) {
    await recordReminderDelivery({
      taskId,
      userId,
      dueAt,
      slot,
      channel: CHANNEL_WEB,
      status: STATUS_FAILED,
      errorMessage: lastError,
    });
    console.warn(
      `[reminder] web push failed (task ${taskId}, user ${userId}, slot ${slot}). ` +
        "Check VAPID keys and subscription rows."
    );
    return;
  }

  await recordReminderDelivery({
    taskId,
    userId,
    dueAt,
    slot,
    channel: CHANNEL_WEB,
    status: STATUS_SENT,
  });
  console.log(`[reminder] web_push sent ${slot} for task ${taskId} → user ${userId}`);
}

async function sendFcmReminder(row, slot) {
  const dueAt = row.task.dueAt;
  if (!dueAt) return;

  const { taskId, userId } = row;
  if (await wasReminderDelivered(taskId, userId, dueAt, slot, CHANNEL_FCM)) {
    dbg("fcm skip: already sent", { taskId, slot });
    return;
  }

  const result = await sendFcmTaskReminder({
    userId,
    taskId,
    title: row.task.title,
    dueAt,
    allDay: row.task.allDay,
    dueTimeZone: row.task.dueTimeZone,
    slot,
  });

  if (result.ok) {
    await recordReminderDelivery({
      taskId,
      userId,
      dueAt,
      slot,
      channel: CHANNEL_FCM,
      status: STATUS_SENT,
      messageId: result.messageId ?? null,
    });
    return;
  }

  const staleIds = result.staleDeviceIds ?? (result.invalidateDevice && result.deviceId ? [result.deviceId] : []);
  for (const staleId of staleIds) {
    await prisma.employeeDevice.delete({ where: { deviceId: staleId } }).catch(() => {});
    console.warn(`[reminder] removed stale employee_device ${staleId}`);
  }

  if (result.code === "device/not-found") {
    dbg("fcm skip: no device", { userId, taskId });
    return;
  }

  await recordReminderDelivery({
    taskId,
    userId,
    dueAt,
    slot,
    channel: CHANNEL_FCM,
    status: STATUS_FAILED,
    errorMessage: result.error ?? result.code ?? "FCM send failed",
  });
}

function webPushCopyForSlot(row, slot) {
  const beforeMinutes = minutesFromBeforeSlot(slot);
  if (beforeMinutes != null) {
    return {
      title: formatBeforeDueReminderTitle(beforeMinutes),
      body: `${row.task.title}\nTap to open the alarm screen.`,
    };
  }
  if (slot === "followup1h") {
    return {
      title: "Task overdue — 1 hour",
      body: `${row.task.title}\nThis task was due 1 hour ago. Please complete it now.`,
    };
  }
  if (slot === "followup6h") {
    return {
      title: "Task overdue — 6 hours",
      body: `${row.task.title}\nThis task was due 6 hours ago. Please complete it now.`,
    };
  }
  if (slot === "followup24h") {
    return {
      title: "Task overdue — 24 hours",
      body: `${row.task.title}\nThis task was due 24 hours ago. Please complete it now.`,
    };
  }
  return {
    title: "Task still not submitted",
    body: `${row.task.title}\nFollow-up reminder — please submit now.`,
  };
}

export async function runReminderTick() {
  const fcmOn = isFcmConfigured();
  const webOn = isPushConfigured();
  if (!fcmOn && !webOn) {
    dbg("runReminderTick skip: no FCM or web push configured");
    return;
  }

  const now = Date.now();
  const rows = await prisma.taskAssignee.findMany({
    where: {
      assigneeDone: false,
      task: {
        dueAt: { not: null },
        completed: false,
      },
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          allDay: true,
          dueTimeZone: true,
          reminderBeforeMinutes: true,
        },
      },
    },
  });

  dbg("tick", { now: new Date(now).toISOString(), rowCount: rows.length, fcmOn, webOn });

  for (const row of rows) {
    const dueAt = row.task.dueAt;
    if (!dueAt) continue;

    const due = dueAt.getTime();
    if (!Number.isFinite(due)) continue;

    const slot = reminderSlotForDue(dueAt, now, row.task.reminderBeforeMinutes);
    if (!slot) continue;

    dbg("row", {
      taskId: row.taskId,
      userId: row.userId,
      title: row.task.title,
      dueAt: dueAt.toISOString(),
      slot,
      reminderBeforeMinutes: row.task.reminderBeforeMinutes,
    });

    if (fcmOn) {
      await sendFcmReminder(row, slot);
    }

    if (webOn) {
      const copy = webPushCopyForSlot(row, slot);
      await sendWebPushReminder(row, slot, copy.title, copy.body);
    }
  }
}

export function startReminderScheduler() {
  const fcmOn = isFcmConfigured();
  const webOn = isPushConfigured();
  if (!fcmOn && !webOn) {
    console.warn("[reminder] scheduler not started — configure FCM or VAPID push");
    return null;
  }

  console.log(
    `[reminder] scheduler started (every 60s) channels: ${[fcmOn && "fcm", webOn && "web_push"].filter(Boolean).join(", ")}`
  );
  void runReminderTick();
  return setInterval(() => {
    runReminderTick().catch((err) => console.error("[reminder]", err));
  }, 60 * 1000);
}
