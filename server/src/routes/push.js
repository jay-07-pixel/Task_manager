import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getVapidPublicKey } from "../lib/push.js";
import { requireAuth } from "../middleware/auth.js";

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
