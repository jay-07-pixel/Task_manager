import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendAdminPromotionEmail, sendAdminRevocationEmail } from "../lib/mail.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";

const router = Router();

const rolePatchSchema = z.object({
  role: z.enum(["owner", "employee"]),
});

router.get("/peers", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const users = await prisma.user.findMany({
    where: { role: "employee", id: { not: req.session.userId } },
    select: { id: true, email: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  res.json({ users });
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
  const parsed = rolePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid role. Use owner or employee." });
  }

  const nextRole = parsed.data.role;

  const [target, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.params.id } }),
    prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { email: true, displayName: true },
    }),
  ]);

  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }
  if (!actor?.email) {
    return res.status(500).json({ error: "Could not identify the acting admin." });
  }
  if (target.role === nextRole) {
    return res.status(400).json({
      error: nextRole === "owner" ? "User is already an admin." : "User is already an employee.",
    });
  }

  if (nextRole === "owner") {
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
        admin: actor,
      });
      emailSent = !mailResult.devMode;
    } catch (err) {
      console.error("[users] admin promotion email failed", err);
    }

    return res.json({ user, emailSent });
  }

  if (target.id === req.session.userId) {
    return res.status(400).json({ error: "You cannot revoke your own admin access." });
  }

  const ownerCount = await prisma.user.count({ where: { role: "owner" } });
  if (ownerCount <= 1) {
    return res.status(400).json({ error: "Cannot revoke the last admin. Promote another admin first." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { role: "employee" },
    select: { id: true, email: true, displayName: true, role: true },
  });

  let emailSent = false;
  try {
    const mailResult = await sendAdminRevocationEmail({
      to: user.email,
      recipientName: user.displayName,
      admin: actor,
    });
    emailSent = !mailResult.devMode;
  } catch (err) {
    console.error("[users] admin revocation email failed", err);
  }

  res.json({ user, emailSent });
});

export default router;
