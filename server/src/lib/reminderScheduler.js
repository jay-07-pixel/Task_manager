import { prisma } from "./prisma.js";
import { isPushConfigured, sendPushToSubscription } from "./push.js";

const REMINDER_BEFORE_MS = 10 * 60 * 1000;
const FOLLOWUP_AFTER_FIRST_MS = 60 * 60 * 1000;
/** Follow-up: from 1h after the first reminder until this long past due */
const FOLLOWUP_GRACE_AFTER_DUE_MS = 24 * 60 * 60 * 1000;

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
  return `/alarm.html?${p.toString()}`;
}

/**
 * @param {Date} dueAt
 * @param {number} nowMs
 * @returns {"before10" | "followup1h" | null}
 */
export function reminderSlotForDue(dueAt, nowMs = Date.now()) {
  const due = dueAt.getTime();
  if (!Number.isFinite(due)) return null;

  const msUntilDue = due - nowMs;
  const firstAt = due - REMINDER_BEFORE_MS;
  const followupAt = firstAt + FOLLOWUP_AFTER_FIRST_MS;

  if (msUntilDue > 0 && msUntilDue <= REMINDER_BEFORE_MS) {
    return "before10";
  }

  if (nowMs >= followupAt && nowMs < due + FOLLOWUP_GRACE_AFTER_DUE_MS) {
    return "followup1h";
  }

  return null;
}

async function sendReminder(row, slot, title, body) {
  const dueAt = row.task.dueAt;
  if (!dueAt) {
    dbg("sendReminder skip: no dueAt", { taskId: row.taskId, userId: row.userId });
    return;
  }

  dbg("sendReminder enter", { taskId: row.taskId, userId: row.userId, slot, dueAt: dueAt.toISOString() });

  const existing = await prisma.reminderSent.findUnique({
    where: {
      taskId_userId_dueAt_slot: {
        taskId: row.taskId,
        userId: row.userId,
        dueAt,
        slot,
      },
    },
  });
  if (existing) {
    dbg("sendReminder skip: already sent", { taskId: row.taskId, slot });
    return;
  }

  const subs = await prisma.pushSubscription.findMany({ where: { userId: row.userId } });
  dbg("push subscriptions", { userId: row.userId, count: subs.length });
  if (!subs.length) {
    console.warn(`[reminder] no push_subscription for user ${row.userId} — cannot send ${slot}`);
    return;
  }

  const payload = {
    title,
    body,
    tag: `taskmgr-${row.taskId}-${dueAt.toISOString()}-${slot}`,
    payload: {
      taskId: row.taskId,
      title: row.task.title,
      dueAt: dueAt.toISOString(),
      slot,
      url: alarmPath(row.taskId, row.task.title, dueAt, slot),
    },
  };

  let anyOk = false;
  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, payload);
    dbg("sendPushToSubscription", {
      subId: sub.id,
      ok: result.ok,
      statusCode: result.statusCode,
      message: result.message,
      hint: result.hint,
      endpointHost: result.endpointHost,
    });
    if (result.ok) {
      anyOk = true;
    } else if (result.gone) {
      console.warn(`[reminder] removing invalid push_subscription ${sub.id} (${result.message})`);
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }

  if (!anyOk) {
    console.warn(
      `[reminder] push failed for all subscriptions (task ${row.taskId}, user ${row.userId}, slot ${slot}). ` +
        "Check [push] sendNotification failed logs above — usually VAPID mismatch (403) after key rotation."
    );
    return;
  }

  try {
    await prisma.reminderSent.create({
      data: {
        taskId: row.taskId,
        userId: row.userId,
        dueAt,
        slot,
      },
    });
    dbg("reminderSent.create ok", { taskId: row.taskId, slot });
  } catch (err) {
    if (err?.code === "P2002") {
      dbg("reminderSent.create race (P2002)", { taskId: row.taskId, slot });
      return;
    }
    throw err;
  }

  console.log(`[reminder] sent ${slot} for task ${row.taskId} → user ${row.userId}`);
}

export async function runReminderTick() {
  if (!isPushConfigured()) {
    dbg("runReminderTick skip: push not configured");
    return;
  }

  const now = Date.now();
  const rows = await prisma.taskAssignee.findMany({
    where: {
      assigneeDone: false,
      task: { dueAt: { not: null } },
    },
    include: {
      task: { select: { id: true, title: true, dueAt: true } },
    },
  });

  dbg("tick", { now: new Date(now).toISOString(), rowCount: rows.length });

  for (const row of rows) {
    const dueAt = row.task.dueAt;
    if (!dueAt) continue;

    const due = dueAt.getTime();
    if (!Number.isFinite(due)) continue;

    const msUntilDue = Math.round((due - now) / 1000);
    const firstAt = due - REMINDER_BEFORE_MS;
    const slot = reminderSlotForDue(dueAt, now);

    dbg("row", {
      taskId: row.taskId,
      userId: row.userId,
      title: row.task.title,
      dueAt: dueAt.toISOString(),
      firstAt: new Date(firstAt).toISOString(),
      now: new Date(now).toISOString(),
      msUntilDueSec: msUntilDue,
      slot: slot ?? "none",
    });

    if (slot === "before10") {
      dbg("entering before10");
      await sendReminder(
        row,
        "before10",
        "Task due in 10 minutes",
        `${row.task.title}\nTap to open the alarm screen.`
      );
    } else if (slot === "followup1h") {
      dbg("entering followup1h");
      await sendReminder(
        row,
        "followup1h",
        "Task still not submitted",
        `${row.task.title}\nFollow-up reminder — please submit now.`
      );
    }
  }
}

export function startReminderScheduler() {
  if (!isPushConfigured()) return null;
  console.log("[reminder] server push scheduler started (every 60s)");
  void runReminderTick();
  return setInterval(() => {
    runReminderTick().catch((err) => console.error("[reminder]", err));
  }, 60 * 1000);
}
