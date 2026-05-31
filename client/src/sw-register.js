/** @typedef {{ id: string, title: string, dueAt: string | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ScheduleTask */

let swRegistration = null;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

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
 * Register this phone/browser for **server push** so reminders work in other apps.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function subscribeToPush(apiFetch) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  const perm = await requestNotificationPermissionForAlarms();
  if (perm !== "granted") {
    return { ok: false, reason: "denied" };
  }

  const reg = await registerServiceWorker();
  if (!reg?.pushManager) {
    return { ok: false, reason: "no-push-manager" };
  }

  let keyRes;
  try {
    keyRes = await apiFetch("/api/push/vapid-public-key");
  } catch {
    return { ok: false, reason: "no-vapid" };
  }

  const publicKey = keyRes?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: "no-vapid" };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON();
  await apiFetch("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });

  return { ok: true };
}

/** @deprecated Client-only scheduling; server push is preferred */
export async function syncBackgroundAlarms(_tasks, _userId) {
  return { scheduled: 0, supported: false };
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
  return "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;
}
