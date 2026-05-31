/** @typedef {{ id: string, title: string, dueAt: string | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ScheduleTask */

let swRegistration = null;
let gestureWireInstalled = false;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "pushManager" in ServiceWorkerRegistration.prototype
  );
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return swRegistration;
  } catch (err) {
    console.warn("[push] service worker registration failed:", err);
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

/** @returns {Promise<PushSubscription | null>} */
export async function getLocalPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager?.getSubscription() ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {PushSubscription} sub
 */
async function postSubscriptionToServer(apiFetch, sub) {
  const json = sub.toJSON();
  await apiFetch("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
}

/**
 * Register this phone/browser for **server push** so reminders work in other apps.
 * pushManager.subscribe() requires a user gesture — call after login, Allow click, or tap handler.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function subscribeToPush(apiFetch) {
  if (!isPushSupported()) {
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
  } catch (err) {
    console.warn("[push] could not load VAPID public key:", err);
    return { ok: false, reason: "no-vapid" };
  }

  const publicKey = keyRes?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: "no-vapid" };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch (err) {
      console.warn("[push] pushManager.subscribe failed (needs user tap?):", err);
      return {
        ok: false,
        reason: "subscribe-failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    await postSubscriptionToServer(apiFetch, sub);
  } catch (err) {
    console.warn("[push] POST /api/push/subscribe failed:", err);
    return {
      ok: false,
      reason: "server-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true };
}

/**
 * Sync an existing browser subscription to the server (safe without user gesture).
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function syncPushSubscriptionToServer(apiFetch) {
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "denied" };
  }
  const sub = await getLocalPushSubscription();
  if (!sub) {
    return { ok: false, reason: "no-local-subscription" };
  }
  try {
    await postSubscriptionToServer(apiFetch, sub);
    return { ok: true };
  } catch (err) {
    console.warn("[push] sync to server failed:", err);
    return {
      ok: false,
      reason: "server-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Chrome requires user activation for pushManager.subscribe().
 * Wire a one-time tap/key handler when permission is already granted but no subscription exists.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {(result: { ok: boolean, reason?: string }) => void} [onResult]
 */
export function wirePushSubscribeOnGesture(apiFetch, onResult) {
  if (gestureWireInstalled) return;
  gestureWireInstalled = true;

  const handler = async () => {
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("keydown", handler, true);
    gestureWireInstalled = false;

    const result = await subscribeToPush(apiFetch);
    onResult?.(result);
    if (result.ok) {
      document.dispatchEvent(new CustomEvent("taskmgr-push-subscribed"));
    } else if (result.reason === "subscribe-failed" || result.reason === "no-local-subscription") {
      wirePushSubscribeOnGesture(apiFetch, onResult);
    }
  };

  document.addEventListener("pointerdown", handler, { capture: true });
  document.addEventListener("keydown", handler, { capture: true });
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
  return isPushSupported();
}
