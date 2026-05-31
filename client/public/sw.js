/* Task Manager — service worker: push notifications with branded UI */

const NOTIFICATION_ICON = "/icons/notification-icon.svg";
const NOTIFICATION_BADGE = "/icons/notification-badge.svg";

function alarmUrl(data) {
  if (data?.url) return data.url;
  const p = new URLSearchParams();
  if (data?.taskId) p.set("taskId", data.taskId);
  if (data?.title) p.set("title", data.title);
  if (data?.dueAt) p.set("dueAt", data.dueAt);
  if (data?.slot) p.set("slot", data.slot);
  p.set("from", "notify");
  return `/alarm.html?${p.toString()}`;
}

async function openAppHome() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if (client.url.includes(self.registration.scope) && !client.url.includes("/alarm.html")) {
      await client.focus();
      return client;
    }
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow("/");
  }
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

function formatNotificationCopy(payload) {
  const data = payload.payload || payload;
  const taskTitle = data?.title || payload.taskTitle || "Your task";
  const slot = data?.slot || payload.slot;
  const dueAt = data?.dueAt || payload.dueAt;

  let title = payload.title;
  let body = payload.body;

  if (!title) {
    title = slot === "followup1h" ? "Still not submitted" : "Task due soon";
  }

  if (!body) {
    if (slot === "followup1h") {
      body = `${taskTitle} — please submit your task.`;
    } else {
      body = `${taskTitle} — due in about 10 minutes.`;
    }
  }

  if (dueAt && !body.includes("Due")) {
    try {
      const dueLabel = new Date(dueAt).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      body = `${body}\nDue: ${dueLabel}`;
    } catch {
      /* ignore */
    }
  }

  return { title, body, data: data || {} };
}

function showNotificationFromPayload(payload) {
  const { title, body, data } = formatNotificationCopy(payload);
  const tag = payload.tag || `taskmgr-${data.taskId || "reminder"}`;

  /** @type {NotificationOptions} */
  const options = {
    body,
    tag,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    requireInteraction: true,
    silent: false,
    vibrate: [600, 200, 600, 200, 600],
    timestamp: Date.now(),
    data,
    actions: [
      { action: "open-alarm", title: "Open alarm" },
      { action: "open-app", title: "Open app" },
    ],
  };

  return self.registration.showNotification(title, options);
}

/** Server Web Push — works when browser tab is closed (Android Chrome, etc.) */
self.addEventListener("push", (event) => {
  let payload = { title: "Task reminder", body: "You have a due task." };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    /* use defaults */
  }
  const data = payload.payload || payload;
  event.waitUntil(
    (async () => {
      await showNotificationFromPayload(payload);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "taskmgr-push-reminder", payload: data });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data;

  if (action === "open-app") {
    event.waitUntil(openAppHome());
    return;
  }

  event.waitUntil(openAlarmWindow(data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
