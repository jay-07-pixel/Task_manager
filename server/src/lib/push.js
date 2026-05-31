import webpush from "web-push";

let pushReady = false;
/** First 12 chars of public key — correlate with client /api/push/vapid-public-key */
let vapidPublicKeyHint = null;

const DEBUG = process.env.DEBUG_PUSH === "1" || process.env.DEBUG_PUSH === "true";

function dbg(...args) {
  if (DEBUG) console.log("[push:debug]", ...args);
}

function trimEnv(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-endpoint";
  }
}

function parsePushError(err) {
  const statusCode = err?.statusCode ?? err?.status ?? 0;
  let body = "";
  if (typeof err?.body === "string") body = err.body;
  else if (Buffer.isBuffer(err?.body)) body = err.body.toString("utf8");
  else if (err?.body != null) body = String(err.body);

  let message = err?.message ?? "unknown push error";
  try {
    const parsed = JSON.parse(body);
    if (parsed?.reason) message = parsed.reason;
    else if (parsed?.message) message = parsed.message;
  } catch {
    if (body && body.length < 500) message = body;
  }

  const gone = statusCode === 404 || statusCode === 410;
  const vapidMismatch = statusCode === 401 || statusCode === 403;

  let hint = null;
  if (vapidMismatch) {
    hint =
      "VAPID key mismatch — subscription was created with a different public key. " +
      "Employee must log in again and re-allow notifications (or tap to re-register push). " +
      `Server key hint: ${vapidPublicKeyHint ?? "unknown"}`;
  } else if (gone) {
    hint = "Subscription expired or unsubscribed — row will be removed.";
  } else if (statusCode === 413) {
    hint = "Payload too large for push service.";
  } else if (statusCode === 429) {
    hint = "Push rate limited — retry on next scheduler tick.";
  }

  return { statusCode, body, message, gone: gone || vapidMismatch, vapidMismatch, hint };
}

export function initPush() {
  const publicKey = trimEnv(process.env.VAPID_PUBLIC_KEY);
  const privateKey = trimEnv(process.env.VAPID_PRIVATE_KEY);
  let subject = trimEnv(process.env.VAPID_SUBJECT) || "mailto:admin@local.test";

  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — phone push reminders disabled");
    pushReady = false;
    vapidPublicKeyHint = null;
    return false;
  }

  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    subject = `mailto:${subject.replace(/^mailto:/, "")}`;
    console.warn(`[push] VAPID_SUBJECT normalized to ${subject}`);
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.error("[push] setVapidDetails failed — check key format:", err?.message ?? err);
    pushReady = false;
    vapidPublicKeyHint = null;
    return false;
  }

  pushReady = true;
  vapidPublicKeyHint = `${publicKey.slice(0, 12)}… (len ${publicKey.length})`;
  console.log(`[push] VAPID ready subject=${subject} publicKey=${vapidPublicKeyHint}`);
  return true;
}

export function isPushConfigured() {
  return pushReady;
}

export function getVapidPublicKey() {
  return trimEnv(process.env.VAPID_PUBLIC_KEY) || null;
}

export function getPushDiagnostics() {
  return {
    configured: pushReady,
    publicKeyHint: vapidPublicKeyHint,
    subject: trimEnv(process.env.VAPID_SUBJECT) || "mailto:admin@local.test",
  };
}

/**
 * @param {{ endpoint: string, p256dh: string, auth: string, id?: string }} sub
 * @param {object} payload
 */
export async function sendPushToSubscription(sub, payload) {
  if (!pushReady) {
    return {
      ok: false,
      statusCode: 0,
      message: "push not configured",
      hint: "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in server/.env",
    };
  }

  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) {
    return {
      ok: false,
      statusCode: 0,
      message: "invalid subscription row",
      hint: "push_subscription missing endpoint or keys",
      endpointHost: endpointHost(sub?.endpoint ?? ""),
    };
  }

  const endpoint = sub.endpoint;
  const host = endpointHost(endpoint);
  const payloadJson = JSON.stringify(payload);

  dbg("send", {
    subId: sub.id,
    host,
    payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
    vapidHint: vapidPublicKeyHint,
  });

  try {
    await webpush.sendNotification(
      {
        endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payloadJson,
      { TTL: 86400, urgency: "high" }
    );

    dbg("send ok", { subId: sub.id, host, statusCode: 201 });
    return { ok: true, statusCode: 201, endpointHost: host };
  } catch (err) {
    const parsed = parsePushError(err);

    console.error("[push] sendNotification failed", {
      subId: sub.id,
      statusCode: parsed.statusCode,
      message: parsed.message,
      body: parsed.body?.slice(0, 500) || undefined,
      endpointHost: host,
      vapidMismatch: parsed.vapidMismatch,
      vapidPublicKeyHint: vapidPublicKeyHint,
      hint: parsed.hint,
    });

    return {
      ok: false,
      ...parsed,
      endpointHost: host,
    };
  }
}
