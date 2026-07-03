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

async function openAppUrl(path) {
  const fullUrl = new URL(path, self.registration.scope).href;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  for (const client of clients) {
    if (client.url.includes(self.registration.scope) && !client.url.includes("/alarm.html")) {
      await client.focus();
      if ("navigate" in client) {
        await client.navigate(fullUrl);
      } else {
        client.postMessage({ type: "taskmgr-navigate", url: path });
      }
      return client;
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(fullUrl);
  }
}

async function openChatFromNotification(data) {
  const conversationId = data?.conversationId;
  const path = conversationId ? `/?openChat=${encodeURIComponent(conversationId)}` : "/";
  return openAppUrl(path);
}

async function openTaskDashboard(data) {
  const path = taskDashboardUrl(data);
  return openAppUrl(path);
}

function formatNotificationCopy(payload) {
  const data = payload.payload || payload;
  const msgType = data?.type || payload.type;

  if (msgType === "chat_message") {
    return {
      title: payload.title || `New message from ${data?.senderName || "someone"}`,
      body: payload.body || "Open Messages to read.",
      data: { ...data, type: "chat_message" },
    };
  }

  if (msgType === "task_submitted") {
    return {
      title: payload.title || "Task submitted",
      body: payload.body || "An employee submitted work on a task.",
      data: { ...data, type: "task_submitted" },
    };
  }

  if (msgType === "location_tracking_off") {
    return {
      title: payload.title || "Location tracking turned off",
      body: payload.body || "An employee turned off live location tracking.",
      data: { ...data, type: "location_tracking_off", url: data.url || "/?openAttendance=1" },
    };
  }

  if (msgType === "location_tracking_on") {
    return {
      title: payload.title || "Location tracking back on",
      body: payload.body || "An employee turned live location tracking back on.",
      data: { ...data, type: "location_tracking_on", url: data.url || "/?openAttendance=1" },
    };
  }

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

async function notifyOpenClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

async function showNotificationFromPayload(payload) {
  const { title, body, data } = formatNotificationCopy(payload);
  const isChat = data?.type === "chat_message";
  const isTaskSubmitted = data?.type === "task_submitted";
  const isLocationEvent =
    data?.type === "location_tracking_off" || data?.type === "location_tracking_on";
  const tag =
    payload.tag ||
    (isChat
      ? `taskmgr-chat-${data.conversationId || "message"}`
      : isTaskSubmitted
        ? `taskmgr-submit-${data.taskId || "task"}`
        : isLocationEvent
          ? `taskmgr-loc-${data.employeeId || "employee"}`
          : `taskmgr-${data.taskId || "reminder"}-${data.slot || "alert"}`);

  const locationUrl =
    data?.url && String(data.url).includes("openAttendance")
      ? data.url.startsWith("/")
        ? data.url
        : `/${data.url}`
      : "/?openAttendance=1";

  const notifyUrl =
    isTaskSubmitted && data?.url
      ? data.url.startsWith("/")
        ? data.url
        : `/${data.url}`
      : isLocationEvent
        ? locationUrl
        : taskDashboardUrl(data);

  const options = {
    body,
    tag,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    requireInteraction: true,
    renotify: true,
    silent: false,
    vibrate: [400, 150, 400, 150, 400],
    data: { ...data, url: notifyUrl },
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

  event.waitUntil(
    (async () => {
      await showNotificationFromPayload(payload);
      const data = payload.payload || payload;
      if (data?.type === "location_tracking_off" || data?.type === "location_tracking_on") {
        await notifyOpenClients({ type: "taskmgr-attendance-changed", detail: data });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.type === "chat_message") {
    event.waitUntil(openChatFromNotification(data));
    return;
  }
  if (data.type === "task_submitted" && data.url) {
    const path = data.url.startsWith("/") ? data.url : `/${data.url}`;
    event.waitUntil(openAppUrl(path));
    return;
  }
  if (data.type === "location_tracking_off" && data.url) {
    const path = data.url.startsWith("/") ? data.url : `/${data.url}`;
    event.waitUntil(openAppUrl(path));
    return;
  }
  if (data.type === "location_tracking_on" && data.url) {
    const path = data.url.startsWith("/") ? data.url : `/${data.url}`;
    event.waitUntil(openAppUrl(path));
    return;
  }
  event.waitUntil(openTaskDashboard(data));
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
