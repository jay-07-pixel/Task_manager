import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function friendlyAuthError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("Can't reach database server") || /ECONNREFUSED|connect ECONNREFUSED/i.test(msg)) {
    return "Cannot connect to MySQL. Start MySQL, check DATABASE_URL in server/.env, then run npm run db:migrate and npm run db:seed.";
  }
  if (process.env.NODE_ENV === "production") {
    return "Server error";
  }
  return msg;
}

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone must be exactly 10 digits (numbers only)");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1).max(120),
  phone: phoneSchema,
  role: z.enum(["owner", "employee"]).optional(),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, displayName, phone, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  if (role === "owner") {
    const hasOwner = await prisma.user.findFirst({ where: { role: "owner" } });
    if (hasOwner) {
      return res.status(403).json({ error: "Owner already exists; register as employee or ask an owner." });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName,
      phone: phone.trim(),
      role: role ?? "employee",
    },
    select: { id: true, email: true, displayName: true, phone: true, role: true },
  });
  req.session.userId = user.id;
  req.session.role = user.role;
  res.status(201).json({ user });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid credentials" });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("taskmgr.sid", { path: "/" });
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, displayName: true, phone: true, role: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Not found" });
  }
  res.json({ user });
});

export default router;
