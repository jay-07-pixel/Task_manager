import webpush from "web-push";

let pushReady = false;

export function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@local.test";
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — phone push reminders disabled");
    pushReady = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushReady = true;
  return true;
}

export function isPushConfigured() {
  return pushReady;
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub
 * @param {object} payload
 */
export async function sendPushToSubscription(sub, payload) {
  if (!pushReady) return { ok: false, statusCode: 0 };
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 86400, urgency: "high" }
    );
    return { ok: true, statusCode: 201 };
  } catch (err) {
    const statusCode = err?.statusCode ?? 0;
    return { ok: false, statusCode, gone: statusCode === 404 || statusCode === 410 };
  }
}
