import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendAdminPromotionEmail } from "../lib/mail.js";
import { requireOwner } from "../middleware/auth.js";

const router = Router();

const promoteRoleSchema = z.object({
  role: z.literal("owner"),
});

router.get("/assignees", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { role: "employee" },
    select: { id: true, email: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  res.json({ users });
});

router.get("/team", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, role: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  res.json({ users });
});

router.patch("/:id/role", requireOwner, async (req, res) => {
  const parsed = promoteRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Only promotion to admin (owner) is supported." });
  }

  const [target, promoter] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.params.id } }),
    prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { email: true, displayName: true },
    }),
  ]);

  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }
  if (target.role === "owner") {
    return res.status(400).json({ error: "User is already an admin." });
  }
  if (!promoter?.email) {
    return res.status(500).json({ error: "Could not identify the promoting admin." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { role: "owner" },
    select: { id: true, email: true, displayName: true, role: true },
  });

  let emailSent = false;
  try {
    const mailResult = await sendAdminPromotionEmail({
      to: user.email,
      recipientName: user.displayName,
      admin: promoter,
    });
    emailSent = !mailResult.devMode;
  } catch (err) {
    console.error("[users] admin promotion email failed", err);
  }

  res.json({ user, emailSent });
});

export default router;
