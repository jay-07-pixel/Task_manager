import fs from "fs";
import path from "path";
import admin from "firebase-admin";

let fcmReady = false;

function trimEnv(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

function loadServiceAccount() {
  const jsonInline = trimEnv(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (jsonInline) {
    try {
      return JSON.parse(jsonInline);
    } catch (err) {
      console.error("[fcm] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON", err?.message);
      return null;
    }
  }

  const credPath =
    trimEnv(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) ||
    trimEnv(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credPath) return null;

  const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(resolved)) {
    console.error(`[fcm] Service account file not found: ${resolved}`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    console.error("[fcm] Failed to read service account file", err?.message);
    return null;
  }
}

export function initFcm() {
  if (fcmReady) return true;
  if (admin.apps.length > 0) {
    fcmReady = true;
    return true;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn(
      "[fcm] Not configured — set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON"
    );
    return false;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    fcmReady = true;
    const projectId = serviceAccount.project_id ?? admin.app().options.projectId;
    console.log(`[fcm] Firebase Admin ready (project: ${projectId ?? "unknown"})`);
    return true;
  } catch (err) {
    console.error("[fcm] Firebase Admin init failed", err?.message ?? err);
    return false;
  }
}

export function isFcmConfigured() {
  return fcmReady || admin.apps.length > 0;
}

/**
 * @param {{ token: string, title: string, body: string, data?: Record<string, string> }} params
 */
export async function sendFcmNotification({ token, title, body, data = {} }) {
  if (!initFcm()) {
    return {
      ok: false,
      error: "FCM is not configured on this server.",
      code: "fcm/not-configured",
    };
  }

  try {
    const messageId = await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: "high",
        notification: {
          channelId: "task_reminders",
          sound: "default",
        },
      },
    });

    return { ok: true, messageId };
  } catch (err) {
    const code = err?.code ?? err?.errorInfo?.code ?? "fcm/send-failed";
    const message = err?.message ?? err?.errorInfo?.message ?? "FCM send failed";
    console.error("[fcm] send failed", code, message);
    return { ok: false, error: message, code };
  }
}
