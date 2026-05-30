/** @typedef {{ id: string, title: string, dueAt: string | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ScheduleTask */

let swRegistration = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return swRegistration;
  } catch (err) {
    console.warn("Service worker registration failed:", err);
    return null;
  }
}

export async function requestNotificationPermissionForAlarms() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Schedule OS notifications + full-screen alarm (Chrome/Edge) when app is closed.
 * @param {ScheduleTask[]} tasks
 * @param {string} userId
 */
export async function syncBackgroundAlarms(tasks, userId) {
  if (!userId) return { scheduled: 0, supported: false };
  await registerServiceWorker();
  const reg = swRegistration || (await navigator.serviceWorker?.ready);
  const worker = reg?.active || navigator.serviceWorker?.controller;
  if (!worker) return { scheduled: 0, supported: false };

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      resolve({
        scheduled: e.data?.scheduled ?? 0,
        supported: true,
      });
    };
    worker.postMessage({ type: "SCHEDULE_REMINDERS", tasks, userId }, [channel.port2]);
    setTimeout(() => resolve({ scheduled: 0, supported: true }), 3000);
  });
}

export async function cancelBackgroundAlarms() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return;
    const notifications = await reg.getNotifications();
    for (const n of notifications) {
      if (n.tag?.startsWith("taskmgr-")) n.close();
    }
  } catch {
    /* ignore */
  }
}

export function backgroundAlarmsSupported() {
  return "serviceWorker" in navigator && "Notification" in window;
}
