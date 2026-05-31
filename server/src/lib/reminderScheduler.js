import { prisma } from "./prisma.js";
import { isPushConfigured, sendPushToSubscription } from "./push.js";

const REMINDER_BEFORE_MS = 10 * 60 * 1000;
const FOLLOWUP_AFTER_FIRST_MS = 60 * 60 * 1000;
/** Cron tick window — send if trigger was within this many ms ago */
const TICK_WINDOW_MS = 90 * 1000;

function formatDue(dueAt) {
  return dueAt.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function alarmPath(taskId, title, dueAt, slot) {
  const p = new URLSearchParams();
  p.set("taskId", taskId);
  p.set("title", title);
  p.set("dueAt", dueAt.toISOString());
  p.set("slot", slot);
  return `/alarm.html?${p.toString()}`;
}

async function sendReminder(row, slot, title, body) {
  const dueAt = row.task.dueAt;
  if (!dueAt) return;

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
  if (existing) return;

  const subs = await prisma.pushSubscription.findMany({ where: { userId: row.userId } });
  if (!subs.length) return;

  try {
    await prisma.reminderSent.create({
      data: {
        taskId: row.taskId,
        userId: row.userId,
        dueAt,
        slot,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") return;
    throw err;
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
    if (result.ok) {
      anyOk = true;
    } else if (result.gone) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }

  if (anyOk) {
    console.log(`[reminder] sent ${slot} for task ${row.taskId} → user ${row.userId}`);
  } else {
    await prisma.reminderSent
      .delete({
        where: {
          taskId_userId_dueAt_slot: {
            taskId: row.taskId,
            userId: row.userId,
            dueAt,
            slot,
          },
        },
      })
      .catch(() => {});
  }
}

export async function runReminderTick() {
  if (!isPushConfigured()) return;

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

  for (const row of rows) {
    const due = row.task.dueAt?.getTime();
    if (!due || !Number.isFinite(due)) continue;

    const firstAt = due - REMINDER_BEFORE_MS;
    const followupAt = firstAt + FOLLOWUP_AFTER_FIRST_MS;

    if (now >= firstAt && now < firstAt + TICK_WINDOW_MS) {
      await sendReminder(
        row,
        "before10",
        "Task due in 10 minutes",
        `${row.task.title}\nTap to open the alarm screen.`
      );
    }

    if (now >= followupAt && now < followupAt + TICK_WINDOW_MS) {
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
