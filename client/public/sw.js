/* Task Manager — background due reminders (service worker) */
const REMINDER_BEFORE_MS = 10 * 60 * 1000;
const FOLLOWUP_AFTER_FIRST_MS = 60 * 60 * 1000;
const TAG_PREFIX = "taskmgr-";

function formatDue(dueAt) {
  try {
    return new Date(dueAt).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function alarmUrl(data) {
  const p = new URLSearchParams();
  if (data?.taskId) p.set("taskId", data.taskId);
  if (data?.title) p.set("title", data.title);
  if (data?.dueAt) p.set("dueAt", data.dueAt);
  if (data?.slot) p.set("slot", data.slot);
  return `/alarm.html?${p.toString()}`;
}

async function openAlarmWindow(data) {
  const url = alarmUrl(data);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if (client.url.includes("/alarm.html")) {
      await client.focus();
      if ("navigate" in client) {
        await client.navigate(url);
      }
      return client;
    }
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(url);
  }
}

async function scheduleOne(reg, task, userId, slot, trigger, title, body) {
  if (trigger <= Date.now()) return false;

  const tag = `${TAG_PREFIX}${task.id}-${task.dueAt}-${slot}`;
  const data = { taskId: task.id, title: task.title, dueAt: task.dueAt, slot };
  try {
    await reg.showNotification(title, {
      body,
      tag,
      requireInteraction: true,
      silent: false,
      vibrate: [500, 200, 500, 200, 500, 200, 500, 200, 500],
      data,
      showTrigger: { timestamp: trigger },
    });
    return true;
  } catch {
    return false;
  }
}

async function scheduleReminders(tasks, userId) {
  const reg = self.registration;
  const existing = await reg.getNotifications();
  for (const n of existing) {
    if (n.tag && n.tag.startsWith(TAG_PREFIX)) {
      n.close();
    }
  }

  let scheduled = 0;

  for (const task of tasks) {
    if (!task?.dueAt || !task?.id) continue;
    const me = (task.assignees || []).find((a) => a.id === userId);
    if (!me || me.assigneeDone) continue;

    const due = new Date(task.dueAt).getTime();
    if (!Number.isFinite(due)) continue;

    const firstAt = due - REMINDER_BEFORE_MS;
    const followupAt = firstAt + FOLLOWUP_AFTER_FIRST_MS;
    const dueLabel = formatDue(task.dueAt);

    if (
      await scheduleOne(
        reg,
        task,
        userId,
        "before10",
        firstAt,
        `Due in 10 min: ${task.title}`,
        `Due at ${dueLabel}. Opening full-screen alarm.`
      )
    ) {
      scheduled += 1;
    }

    if (
      await scheduleOne(
        reg,
        task,
        userId,
        "followup1h",
        followupAt,
        `Still not submitted: ${task.title}`,
        `One hour after your first reminder. Due was ${dueLabel}.`
      )
    ) {
      scheduled += 1;
    }
  }

  return scheduled;
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "SCHEDULE_REMINDERS") return;
  event.waitUntil(
    scheduleReminders(msg.tasks || [], msg.userId).then((count) => {
      if (event.ports[0]) {
        event.ports[0].postMessage({ ok: true, scheduled: count });
      }
    })
  );
});

self.addEventListener("notification", (event) => {
  const data = event.notification?.data;
  event.waitUntil(openAlarmWindow(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openAlarmWindow(event.notification.data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
