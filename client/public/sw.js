/* Task Manager — service worker: server push + local notification fallback */

function alarmUrl(data) {
  if (data?.url) return data.url;
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

function showNotificationFromPayload(payload) {
  const data = payload.payload || payload;
  return self.registration.showNotification(payload.title || "Task reminder", {
    body: payload.body || "",
    tag: payload.tag || "taskmgr-reminder",
    requireInteraction: true,
    silent: false,
    vibrate: [600, 200, 600, 200, 600, 200, 600],
    data,
  });
}

/** Server Web Push — works when browser tab is closed (Android Chrome, etc.) */
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
  event.waitUntil(openAlarmWindow(event.notification.data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
