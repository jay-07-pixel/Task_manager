import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireOwner } from "../middleware/auth.js";

const router = Router();

router.get("/assignees", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { role: "employee" },
    select: { id: true, email: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  res.json({ users });
});

export default router;
