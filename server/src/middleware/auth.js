import { prisma } from "../lib/prisma.js";
import { userHasAdminAccess, userIsCompanyOwner } from "../lib/adminUsers.js";

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/** Admin dashboard access (any admin). Session role must be "owner" (admin UI mode). */
export async function requireOwner(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (req.session.role !== "owner") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { isAdmin: true, role: true, isOwner: true },
    });
    if (!user || !userHasAdminAccess(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Company owner only (Owner dashboard). Max 2 owners per company. */
export async function requireCompanyOwner(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (req.session.role !== "owner") {
    return res.status(403).json({ error: "Company owner access required" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { isAdmin: true, role: true, isOwner: true },
    });
    if (!user || !userHasAdminAccess(user) || !userIsCompanyOwner(user)) {
      return res.status(403).json({ error: "Company owner access required" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
