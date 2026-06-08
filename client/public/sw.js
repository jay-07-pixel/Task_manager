/* Task Manager — service worker: push notifications (Android-safe) */

const NOTIFICATION_ICON = "/icons/notification-icon.png";
const NOTIFICATION_SOUND = "/sounds/alarm-beep.wav";

function taskDashboardUrl(data) {
  if (data?.url && !String(data.url).includes("alarm.html")) {
    return data.url.startsWith("/") ? data.url : `/${data.url}`;
  }
  const p = new URLSearchParams();
  if (data?.taskId) p.set("taskId", data.taskId);
  if (data?.title) p.set("title", data.title);
  if (data?.dueAt) p.set("dueAt", data.dueAt);
  if (data?.slot) p.set("slot", data.slot);
  p.set("from", "notify");
  return `/?${p.toString()}`;
}

async function openTaskDashboard(data) {
  const path = taskDashboardUrl(data);
  const fullUrl = new URL(path, self.registration.scope).href;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  for (const client of clients) {
    if (client.url.includes(self.registration.scope) && !client.url.includes("/alarm.html")) {
      await client.focus();
      if ("navigate" in client) {
        await client.navigate(fullUrl);
      } else {
        client.postMessage({ type: "taskmgr-open-task", payload: data || {} });
      }
      return client;
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(fullUrl);
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
    body =
      slot === "followup1h"
        ? `${taskTitle} — please submit your task.`
        : `${taskTitle} — due in about 10 minutes.`;
  }

  return { title, body, data: data || {} };
}

/** Android Chrome rejects SVG icons — always fall back to minimal options if rich notify fails. */
async function showNotificationFromPayload(payload) {
  const { title, body, data } = formatNotificationCopy(payload);
  const tag = payload.tag || `taskmgr-${data.taskId || "reminder"}`;

  const base = {
    body,
    tag,
    requireInteraction: true,
    silent: false,
    vibrate: [600, 200, 600, 200, 600, 200, 600],
    data,
  };

  try {
    await self.registration.showNotification(title, {
      ...base,
      icon: NOTIFICATION_ICON,
      sound: NOTIFICATION_SOUND,
    });
    return;
  } catch (err) {
    console.warn("[sw] notification with icon/sound failed:", err);
  }

  try {
    await self.registration.showNotification(title, {
      ...base,
      icon: NOTIFICATION_ICON,
    });
    return;
  } catch (err) {
    console.warn("[sw] notification with icon failed:", err);
  }

  await self.registration.showNotification(title, base);
}

async function notifyOpenClients(data) {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "taskmgr-push-reminder", payload: data });
    }
  } catch (err) {
    console.warn("[sw] postMessage to clients failed:", err);
  }
}

/** Server Web Push — must show notification even when phone is on home screen / Chrome closed. */
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
      await notifyOpenClients(data);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openTaskDashboard(data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
