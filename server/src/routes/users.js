import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
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

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }
  if (target.role === "owner") {
    return res.status(400).json({ error: "User is already an admin." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { role: "owner" },
    select: { id: true, email: true, displayName: true, role: true },
  });

  res.json({ user });
});

export default router;
