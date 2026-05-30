export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export function requireOwner(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (req.session.role !== "owner") {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}
