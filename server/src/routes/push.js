import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getVapidPublicKey, isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { requireAuth } from "../middleware/auth.js";
import { registerEmployeeDevice, unregisterEmployeeDevice } from "../services/employeeDeviceService.js";
import { sendTestPushToUser } from "../services/fcmPushService.js";
import { isFcmConfigured } from "../lib/fcm.js";

const router = Router();

router.get("/vapid-public-key", (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: "Push notifications are not configured on this server." });
  }
  res.json({ publicKey });
});

const subscribeSchema = z.object({
  endpoint: z.string().url().max(768),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

router.post("/subscribe", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }
  const { endpoint, keys } = parsed.data;
  const userId = req.session.userId;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  });

  res.json({ ok: true });
});

const registerDeviceSchema = z.object({
  deviceId: z.string().min(1).max(64),
  fcmToken: z.string().min(1).max(512),
  appVersion: z.string().min(1).max(32),
  platform: z.enum(["android", "ios"]).default("android"),
});

router.post("/devices/register", requireAuth, async (req, res) => {
  const parsed = registerDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid device registration" });
  }
  const { deviceId, fcmToken, appVersion, platform } = parsed.data;
  const userId = req.session.userId;

  try {
    const result = await registerEmployeeDevice({
      userId,
      deviceId,
      fcmToken,
      appVersion,
      platform,
    });
    res.json({ ok: true, created: result.created, deviceId: result.deviceId });
  } catch (err) {
    console.error("[employee-device] register failed", err?.message ?? err);
    res.status(500).json({ error: "Device registration failed" });
  }
});

const unregisterDeviceSchema = z.object({
  deviceId: z.string().min(1).max(64),
});

router.delete("/devices/register", requireAuth, async (req, res) => {
  const parsed = unregisterDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid device unregister request" });
  }
  const { deviceId } = parsed.data;
  const userId = req.session.userId;

  try {
    const result = await unregisterEmployeeDevice({ userId, deviceId });
    res.json({ ok: true, removed: result.removed, deviceId });
  } catch (err) {
    console.error("[employee-device] unregister failed", err?.message ?? err);
    res.status(500).json({ error: "Device unregister failed" });
  }
});

/** Send test Web Push to this browser's push_subscription rows (Chrome background check). */
router.post("/test-web", requireAuth, async (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "Web push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in server/.env.",
      code: "web-push/not-configured",
    });
  }

  const userId = req.session.userId;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) {
    return res.status(404).json({
      ok: false,
      error: "No browser subscription — log in on Chrome, tap Enable Chrome reminders, and allow notifications.",
      code: "web-push/no-subscription",
    });
  }

  const payload = {
    title: "Test — Task due soon",
    body: "If you see this while Chrome is closed, background reminders are working.",
    tag: "taskmgr-test-web",
    payload: {
      taskId: "test",
      title: "Test task",
      dueAt: new Date().toISOString(),
      slot: "before10",
      url: "/?from=notify&taskId=test&title=Test%20task&slot=before10",
    },
  };

  let sent = 0;
  let lastError = null;
  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, payload);
    if (result.ok) sent += 1;
    else lastError = result.message ?? result.hint ?? "send failed";
  }

  if (!sent) {
    return res.status(502).json({
      ok: false,
      error: lastError || "Web push delivery failed",
      code: "web-push/send-failed",
      subscriptions: subs.length,
    });
  }

  res.json({ ok: true, sent, subscriptions: subs.length });
});

/** Phase 8.3 — send test FCM to the authenticated user's latest employee_device */
router.post("/test", requireAuth, async (req, res) => {
  if (!isFcmConfigured()) {
    return res.status(503).json({
      ok: false,
      error:
        "FCM is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in server/.env.",
      code: "fcm/not-configured",
    });
  }

  const result = await sendTestPushToUser(req.session.userId);
  const status = result.ok ? 200 : result.code === "device/not-found" ? 404 : 502;
  res.status(status).json(result);
});

router.delete("/subscribe", requireAuth, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) {
    return res.status(400).json({ error: "endpoint required" });
  }
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: req.session.userId },
  });
  res.json({ ok: true });
});

export default router;
