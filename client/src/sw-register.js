/** @typedef {{ id: string, title: string, dueAt: string | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ScheduleTask */

let swRegistration = null;
let cachedVapidPublicKey = null;
let warmupPromise = null;
let gestureWireInstalled = false;
const VAPID_STORAGE_KEY = "taskmgr-vapid-public-key";

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

/**
 * Register SW + cache VAPID key early so subscribe can run quickly during a user gesture.
 * @param {(path: string, options?: RequestInit) => Promise<any>} [apiFetch]
 */
export function warmupPushInfrastructure(apiFetch) {
  if (!isPushSupported() || !apiFetch) return Promise.resolve(false);
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    await registerServiceWorker();
    if (cachedVapidPublicKey) return true;
    try {
      const keyRes = await apiFetch("/api/push/vapid-public-key");
      cachedVapidPublicKey = keyRes?.publicKey || null;
    } catch (err) {
      console.warn("[push] could not prefetch VAPID key:", err);
    }
    return !!cachedVapidPublicKey;
  })();
  return warmupPromise;
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
 * Browser binds push subscriptions to the VAPID key used at subscribe() time.
 * If server keys rotate, old subscriptions return 401/403 until re-subscribed.
 * @param {ServiceWorkerRegistration} reg
 * @param {string} publicKey
 */
async function subscribePushManager(reg, publicKey) {
  const existing = await reg.pushManager.getSubscription();
  const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);

  if (existing && storedKey && storedKey !== publicKey) {
    console.warn("[push] VAPID key changed — re-subscribing push endpoint");
    try {
      await existing.unsubscribe();
    } catch {
      /* ignore */
    }
  } else if (existing && (!storedKey || storedKey === publicKey)) {
    localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
    return existing;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
  return sub;
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
 * Start pushManager.subscribe during an active user gesture.
 * Must be called synchronously from click/submit/pointerdown — do not await before calling.
 * @param {string | null | undefined} [vapidPublicKey]
 * @param {(path: string, options?: RequestInit) => Promise<any>} [apiFetch]
 * @returns {Promise<PushSubscription | null>}
 */
export function beginLocalPushSubscribeDuringGesture(vapidPublicKey, apiFetch) {
  if (!isPushSupported() || Notification.permission !== "granted") {
    return Promise.resolve(null);
  }

  const keyPromise =
    vapidPublicKey || cachedVapidPublicKey
      ? Promise.resolve(vapidPublicKey || cachedVapidPublicKey)
      : apiFetch
        ? warmupPushInfrastructure(apiFetch).then(() => cachedVapidPublicKey)
        : Promise.resolve(null);

  return keyPromise
    .then((key) => {
      if (!key) return null;
      return navigator.serviceWorker.ready.then((reg) => {
        if (!reg.pushManager) return null;
        return subscribePushManager(reg, key);
      });
    })
    .catch((err) => {
      console.warn("[push] beginLocalPushSubscribeDuringGesture failed:", err);
      return null;
    });
}

/**
 * Complete registration: local subscribe (during gesture) + POST after auth.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {Promise<PushSubscription | null>} localSubPromise
 */
export async function finishPushRegistrationAfterAuth(apiFetch, localSubPromise) {
  const sub = await localSubPromise;
  if (!sub) {
    return { ok: false, reason: "no-local-subscription" };
  }
  try {
    await postSubscriptionToServer(apiFetch, sub);
    return { ok: true };
  } catch (err) {
    console.warn("[push] POST /api/push/subscribe failed:", err);
    return {
      ok: false,
      reason: "server-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Full push registration during user gesture (local subscribe + server POST).
 * Uses .then() chains started synchronously — safe inside click/pointer handlers.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {(result: { ok: boolean, reason?: string, message?: string }) => void} [onResult]
 */
export function runPushRegistrationDuringGesture(apiFetch, onResult) {
  if (!isPushSupported()) {
    onResult?.({ ok: false, reason: "unsupported" });
    return;
  }
  if (Notification.permission !== "granted") {
    onResult?.({ ok: false, reason: "denied" });
    return;
  }

  /** Start subscribe in the same click tick — Chrome requires an active user gesture. */
  void registerServiceWorker();
  const subscribePromise = beginLocalPushSubscribeDuringGesture(undefined, apiFetch);

  subscribePromise
    .then(async (sub) => {
      if (!sub) {
        const existing = await getLocalPushSubscription();
        if (existing) {
          const key = cachedVapidPublicKey;
          if (key) {
            const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);
            if (!storedKey || storedKey === key) {
              if (!storedKey) localStorage.setItem(VAPID_STORAGE_KEY, key);
              await postSubscriptionToServer(apiFetch, existing);
              return;
            }
          }
        }
        if (!cachedVapidPublicKey) {
          const err = new Error("Push not configured on server");
          err.code = "no-vapid";
          throw err;
        }
        throw new Error("Could not register push — close all Chrome tabs for this site and try again");
      }
      await postSubscriptionToServer(apiFetch, sub);
    })
    .then(() => {
      onResult?.({ ok: true });
      document.dispatchEvent(new CustomEvent("taskmgr-push-subscribed"));
    })
    .catch((err) => {
      console.warn("[push] gesture registration failed:", err);
      const code = err?.code === "no-vapid" ? "no-vapid" : "subscribe-failed";
      onResult?.({
        ok: false,
        reason: code,
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Register this phone/browser for server push (async — only works with existing subscription or fresh permission prompt).
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

  await warmupPushInfrastructure(apiFetch);
  const reg = await registerServiceWorker();
  if (!reg?.pushManager) {
    return { ok: false, reason: "no-push-manager" };
  }

  if (!cachedVapidPublicKey) {
    return { ok: false, reason: "no-vapid" };
  }

  let sub = await reg.pushManager.getSubscription();
  const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);
  if (!sub || storedKey !== cachedVapidPublicKey) {
    sub = await subscribePushManager(reg, cachedVapidPublicKey);
    if (!sub) {
      sub = await beginLocalPushSubscribeDuringGesture(cachedVapidPublicKey, apiFetch);
    }
    if (!sub) {
      return { ok: false, reason: "subscribe-failed" };
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
 * Sync an existing browser subscription to the server (no user gesture needed).
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function syncPushSubscriptionToServer(apiFetch) {
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "denied" };
  }
  await warmupPushInfrastructure(apiFetch);
  if (!cachedVapidPublicKey) {
    return { ok: false, reason: "no-vapid" };
  }
  const reg = await navigator.serviceWorker.ready;
  if (!reg?.pushManager) {
    return { ok: false, reason: "no-push-manager" };
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    return { ok: false, reason: "needs-gesture-resubscribe" };
  }
  const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);
  if (storedKey && storedKey !== cachedVapidPublicKey) {
    return { ok: false, reason: "needs-gesture-resubscribe" };
  }
  if (!storedKey) {
    localStorage.setItem(VAPID_STORAGE_KEY, cachedVapidPublicKey);
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
 * Wire tap/key to register push. Handler is synchronous so user activation reaches subscribe().
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {(result: { ok: boolean, reason?: string }) => void} [onResult]
 */
export function wirePushSubscribeOnGesture(apiFetch, onResult) {
  if (gestureWireInstalled) return;
  gestureWireInstalled = true;
  warmupPushInfrastructure(apiFetch);

  const handler = () => {
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("click", handler, true);
    document.removeEventListener("keydown", handler, true);
    gestureWireInstalled = false;
    runPushRegistrationDuringGesture(apiFetch, onResult);
  };

  document.addEventListener("pointerdown", handler, { capture: true });
  document.addEventListener("click", handler, { capture: true });
  document.addEventListener("keydown", handler, { capture: true });
}

/**
 * Employee push setup after login / page load.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {(title: string, variant?: string) => void} [showToast]
 */
export async function setupEmployeePushRegistration(apiFetch, showToast) {
  if (!apiFetch || !isPushSupported()) return { ok: false, reason: "unsupported" };

  await warmupPushInfrastructure(apiFetch);

  const perm = Notification.permission;
  if (perm === "granted") {
    const localSub = await getLocalPushSubscription();
    if (localSub) {
      return syncPushSubscriptionToServer(apiFetch);
    }
    wirePushSubscribeOnGesture(apiFetch, (result) => {
      if (result.ok) {
        showToast?.("Phone reminders enabled — alerts work even in other apps.", "primary");
      }
    });
    if (!sessionStorage.getItem("taskmgr-push-tap-hint")) {
      sessionStorage.setItem("taskmgr-push-tap-hint", "1");
      showToast?.("Tap anywhere once to enable phone reminders.", "primary");
    }
    return { ok: false, reason: "needs-gesture" };
  }

  if (perm === "default") {
    const requested = await requestNotificationPermissionForAlarms();
    if (requested === "granted") {
      return new Promise((resolve) => {
        runPushRegistrationDuringGesture(apiFetch, (result) => {
          if (result.ok) {
            showToast?.("Phone reminders enabled — alerts work even in other apps.", "primary");
          }
          resolve(result);
        });
      });
    }
  }

  return { ok: false, reason: perm === "denied" ? "denied" : "skipped" };
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
