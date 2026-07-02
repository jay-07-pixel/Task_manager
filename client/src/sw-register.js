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

function waitForServiceWorkerState(worker, targetState, timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (!worker) {
      resolve(false);
      return;
    }
    if (worker.state === targetState) {
      resolve(true);
      return;
    }
    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    worker.addEventListener("statechange", () => {
      if (worker.state === targetState) {
        window.clearTimeout(timer);
        resolve(true);
      }
    });
  });
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const installing = swRegistration.installing || swRegistration.waiting;
    if (installing) {
      await waitForServiceWorkerState(installing, "activated");
    }
    await navigator.serviceWorker.ready;
    swRegistration = (await navigator.serviceWorker.getRegistration("/")) || swRegistration;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, 5000);
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }
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
export function warmupPushInfrastructure(apiFetch, { force = false } = {}) {
  if (!isPushSupported() || !apiFetch) return Promise.resolve(false);
  if (force) warmupPromise = null;
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      const reg = await registerServiceWorker();
      if (!reg?.pushManager) {
        warmupPromise = null;
        return false;
      }
      if (!cachedVapidPublicKey) {
        const keyRes = await apiFetch("/api/push/vapid-public-key");
        cachedVapidPublicKey = keyRes?.publicKey || null;
      }
      const ok = !!cachedVapidPublicKey && !!swRegistration?.pushManager;
      if (!ok) warmupPromise = null;
      return ok;
    } catch (err) {
      console.warn("[push] warmup failed:", err);
      warmupPromise = null;
      return false;
    }
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

  const subscribeOnce = () =>
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

  try {
    const sub = await subscribeOnce();
    localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
    return sub;
  } catch (err) {
    console.warn("[push] pushManager.subscribe failed:", err?.name, err?.message);
    const leftover = await reg.pushManager.getSubscription();
    if (leftover) {
      localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
      return leftover;
    }
    if (err?.name === "AbortError") {
      await registerServiceWorker();
      const activeReg = swRegistration || (await navigator.serviceWorker.ready);
      if (activeReg?.pushManager) {
        await new Promise((r) => window.setTimeout(r, 800));
        try {
          const retrySub = await activeReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
          return retrySub;
        } catch (retryErr) {
          console.warn("[push] subscribe retry failed:", retryErr?.name, retryErr?.message);
        }
      }
    }
    throw err;
  }
}

export function isPushInfrastructureReady() {
  return !!(cachedVapidPublicKey && swRegistration);
}

/** Fully load service worker + VAPID before any subscribe attempt (required on mobile). */
export function preparePushInfrastructure(apiFetch, options) {
  return warmupPushInfrastructure(apiFetch, options);
}

/**
 * Link an existing browser subscription to the server (no user gesture needed).
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function linkPushSubscriptionToServer(apiFetch) {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "denied" };

  const ready = await preparePushInfrastructure(apiFetch);
  if (!ready || !cachedVapidPublicKey || !swRegistration?.pushManager) {
    return {
      ok: false,
      reason: "not-ready",
      message: "Push setup still loading. Wait a few seconds and try again.",
    };
  }

  const sub = await swRegistration.pushManager.getSubscription();
  if (!sub) {
    return { ok: false, reason: "needs-gesture" };
  }

  const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);
  if (storedKey && storedKey !== cachedVapidPublicKey) {
    return { ok: false, reason: "needs-gesture", message: "Tap Enable once more to refresh push on this phone." };
  }
  if (!storedKey) {
    localStorage.setItem(VAPID_STORAGE_KEY, cachedVapidPublicKey);
  }

  try {
    await postSubscriptionToServer(apiFetch, sub);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "server-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function friendlyPushError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError") {
    return "Chrome blocked push. Android Settings → Apps → Chrome → Notifications → Allow.";
  }
  if (name === "AbortError") {
    return "Setup was interrupted. Tap Enable once (wait for “Almost done”), then tap Enable again.";
  }
  return err instanceof Error ? err.message : "Could not register push on this device.";
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

  if (!isPushInfrastructureReady()) {
    onResult?.({
      ok: false,
      reason: "not-ready",
      message: "Still loading. Wait a few seconds for the page to finish, then tap again.",
    });
    void preparePushInfrastructure(apiFetch);
    return;
  }

  const reg = swRegistration;
  const publicKey = cachedVapidPublicKey;
  if (!reg?.pushManager || !publicKey) {
    onResult?.({ ok: false, reason: "no-vapid", message: "Push not configured on server." });
    return;
  }

  /** Promise chain started in the click tick — required on mobile Chrome. */
  reg.pushManager
    .getSubscription()
    .then((existing) => {
      if (existing) {
        const storedKey = localStorage.getItem(VAPID_STORAGE_KEY);
        if (!storedKey || storedKey === publicKey) {
          if (!storedKey) localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
          return postSubscriptionToServer(apiFetch, existing);
        }
      }
      return subscribePushManager(reg, publicKey).then((sub) => {
        if (!sub) throw new Error("Subscribe returned empty");
        return postSubscriptionToServer(apiFetch, sub);
      });
    })
    .then(() => {
      onResult?.({ ok: true });
      document.dispatchEvent(new CustomEvent("taskmgr-push-subscribed"));
    })
    .catch((err) => {
      console.warn("[push] gesture registration failed:", err);
      onResult?.({
        ok: false,
        reason: "subscribe-failed",
        message: friendlyPushError(err),
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

/** @returns {Promise<boolean>} */
export async function isPushSubscribed() {
  if (!isPushSupported()) return false;
  if (Notification.permission !== "granted") return false;
  const sub = await getLocalPushSubscription();
  return !!sub;
}

/**
 * Unsubscribe this browser from push and remove the server row.
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 */
export async function unsubscribeFromPush(apiFetch) {
  if (!isPushSupported()) return { ok: true };
  const sub = await getLocalPushSubscription();
  if (!sub) return { ok: true };

  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch (err) {
    console.warn("[push] local unsubscribe failed:", err);
  }

  if (apiFetch && endpoint) {
    try {
      await apiFetch("/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      });
    } catch (err) {
      console.warn("[push] DELETE /api/push/subscribe failed:", err);
    }
  }

  document.dispatchEvent(new CustomEvent("taskmgr-push-unsubscribed"));
  return { ok: true };
}
