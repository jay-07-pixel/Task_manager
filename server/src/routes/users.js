import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendAdminPromotionEmail, sendAdminRevocationEmail } from "../lib/mail.js";
import { adminUserWhere, userHasAdminAccess } from "../lib/adminUsers.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";

const router = Router();

const rolePatchSchema = z.object({
  role: z.enum(["owner", "employee"]),
});

function serializeTeamUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isAdmin: userHasAdminAccess(user),
  };
}

router.get("/peers", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const users = await prisma.user.findMany({
    where: { id: { not: req.session.userId } },
    select: { id: true, email: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  res.json({ users });
});

router.get("/assignees", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  res.json({ users });
});

router.get("/team", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true },
    orderBy: [{ isAdmin: "desc" }, { displayName: "asc" }],
  });
  res.json({ users: users.map(serializeTeamUser) });
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

  const currentlyAdmin = userHasAdminAccess(target);
  if (nextRole === "owner" && currentlyAdmin) {
    return res.status(400).json({ error: "User already has admin access." });
  }
  if (nextRole === "employee" && !currentlyAdmin) {
    return res.status(400).json({ error: "User does not have admin access." });
  }

  if (nextRole === "owner") {
    const user = await prisma.user.update({
      where: { id: target.id },
      data: { isAdmin: true, role: "employee" },
      select: { id: true, email: true, displayName: true, role: true, isAdmin: true },
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

    return res.json({ user: serializeTeamUser(user), emailSent });
  }

  if (target.id === req.session.userId) {
    return res.status(400).json({ error: "You cannot revoke your own admin access." });
  }

  const adminCount = await prisma.user.count({ where: adminUserWhere });
  if (adminCount <= 1) {
    return res.status(400).json({ error: "Cannot revoke the last admin. Promote another admin first." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { isAdmin: false, role: "employee" },
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true },
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

  res.json({ user: serializeTeamUser(user), emailSent });
});

export default router;
