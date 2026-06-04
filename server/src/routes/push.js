import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getVapidPublicKey } from "../lib/push.js";
import { requireAuth } from "../middleware/auth.js";
import { registerEmployeeDevice } from "../services/employeeDeviceService.js";
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
