import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { isSupportMailConfigured, sendSupportContactEmail } from "../lib/supportMail.js";

const router = Router();

const contactSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(8000),
  appVersion: z.string().max(32).optional(),
  appVersionCode: z.union([z.number(), z.string()]).optional(),
});

router.post("/contact", requireAuth, async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, message: "Subject and message are required" });
  }

  if (!isSupportMailConfigured()) {
    return res.status(501).json({ ok: false, message: "Support email is not configured on the server" });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { email: true, displayName: true },
  });
  if (!user) {
    return res.status(401).json({ ok: false, message: "Not signed in" });
  }

  const { subject, message, appVersion, appVersionCode } = parsed.data;

  try {
    await sendSupportContactEmail({
      subject,
      message,
      appVersion: appVersion || "unknown",
      appVersionCode: String(appVersionCode ?? ""),
      user,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[support/contact]", err);
    return res.status(500).json({ ok: false, message: "Could not send support email" });
  }
});

export default router;
