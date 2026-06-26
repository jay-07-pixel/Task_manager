import { prisma } from "../lib/prisma.js";
import { userHasAdminAccess } from "../lib/adminUsers.js";

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export async function requireOwner(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (req.session.role !== "owner") {
    return res.status(403).json({ error: "Owner access required" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { isAdmin: true, role: true },
    });
    if (!user || !userHasAdminAccess(user)) {
      return res.status(403).json({ error: "Owner access required" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
