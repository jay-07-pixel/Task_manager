/* Task Manager — service worker v3: system notifications only, no alarm page */

const NOTIFICATION_ICON = "/icons/notification-icon.png";

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

  let title = payload.title;
  let body = payload.body;

  if (!title) {
    title = slot && String(slot).startsWith("followup") ? "Task overdue" : "Task due in 10 minutes";
  }

  if (!body) {
    body =
      slot && String(slot).startsWith("followup")
        ? `${taskTitle} — please complete and submit.`
        : `${taskTitle} — tap to open your task.`;
  }

  return { title, body, data: data || {} };
}

async function showNotificationFromPayload(payload) {
  const { title, body, data } = formatNotificationCopy(payload);
  const tag = payload.tag || `taskmgr-${data.taskId || "reminder"}-${data.slot || "alert"}`;

  const options = {
    body,
    tag,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    requireInteraction: true,
    renotify: true,
    silent: false,
    vibrate: [400, 150, 400, 150, 400],
    data: { ...data, url: taskDashboardUrl(data) },
  };

  try {
    await self.registration.showNotification(title, options);
  } catch (err) {
    console.warn("[sw] rich notification failed:", err);
    await self.registration.showNotification(title, {
      body,
      tag,
      requireInteraction: true,
      renotify: true,
      silent: false,
      data: options.data,
    });
  }
}

/** Server Web Push — show on phone lock screen / notification shade. */
self.addEventListener("push", (event) => {
  let payload = { title: "Task reminder", body: "You have a due task." };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    /* use defaults */
  }

  event.waitUntil(showNotificationFromPayload(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openTaskDashboard(data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
