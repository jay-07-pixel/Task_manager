import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/otpRateLimit.js";
import { sendOtpEmail, sendPasswordResetOtpEmail } from "../lib/mail.js";
import { getTurnstileSiteKey, verifyTurnstileToken } from "../lib/turnstile.js";
import {
  generateOtpCode,
  hashOtp,
  verifyOtp,
  normalizeEmail,
  OTP_EXPIRY_MS,
  MAX_VERIFY_ATTEMPTS,
  MAX_RESEND_PER_HOUR,
  REGISTRATION_WINDOW_MS,
  PASSWORD_RESET_WINDOW_MS,
  OTP_LENGTH,
} from "../lib/otp.js";

const router = Router();

const sendOtpLimiter = createRateLimiter({ max: 15, windowMs: 15 * 60 * 1000, keyPrefix: "send-otp" });
const verifyOtpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000, keyPrefix: "verify-otp" });
const forgotSendOtpLimiter = createRateLimiter({
  max: 15,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "forgot-send-otp",
});
const forgotVerifyOtpLimiter = createRateLimiter({
  max: 30,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "forgot-verify-otp",
});

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

const emailSchema = z.string().email("Invalid email address");

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

router.get("/turnstile-site-key", (_req, res) => {
  const siteKey = getTurnstileSiteKey();
  if (!siteKey) {
    return res.status(503).json({ error: "CAPTCHA is not configured on this server." });
  }
  res.json({ siteKey });
});

const sendOtpSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().min(1, "Please complete CAPTCHA"),
});

const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, `OTP must be ${OTP_LENGTH} digits`),
});

router.post("/send-otp", sendOtpLimiter, async (req, res) => {
  try {
    const parsed = sendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const firstField = Object.values(flat.fieldErrors).flat()[0];
      return res.status(400).json({
        error: firstField || "Invalid email address",
      });
    }

    const captcha = await verifyTurnstileToken(
      parsed.data.turnstileToken,
      req.ip || req.socket?.remoteAddress
    );
    if (!captcha.ok) {
      return res.status(400).json({ error: captcha.error || "CAPTCHA verification failed." });
    }

    const email = normalizeEmail(parsed.data.email);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const now = new Date();
    let record = await prisma.emailVerification.findUnique({ where: { email } });

    if (record) {
      const windowAge = now.getTime() - new Date(record.resendWindowStart).getTime();
      const oneHour = 60 * 60 * 1000;
      if (windowAge >= oneHour) {
        record = await prisma.emailVerification.update({
          where: { email },
          data: { resendCount: 0, resendWindowStart: now },
        });
      } else if (record.resendCount >= MAX_RESEND_PER_HOUR) {
        return res.status(429).json({
          error: "Too many OTP requests. You can request up to 5 codes per hour for this email.",
        });
      }
    }

    const otp = generateOtpCode();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await prisma.emailVerification.upsert({
      where: { email },
      create: {
        email,
        otpHash,
        expiresAt,
        attempts: 0,
        resendCount: 1,
        resendWindowStart: now,
        verified: false,
        verifiedAt: null,
      },
      update: {
        otpHash,
        expiresAt,
        attempts: 0,
        verified: false,
        verifiedAt: null,
        resendCount: record ? record.resendCount + 1 : 1,
        resendWindowStart: record?.resendWindowStart ?? now,
      },
    });

    await sendOtpEmail(email, otp);

    res.json({
      ok: true,
      expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
      message: "Verification code sent to your email.",
    });
  } catch (err) {
    console.error("[auth/send-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/verify-otp", verifyOtpLimiter, async (req, res) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid email or OTP format" });
    }

    const email = normalizeEmail(parsed.data.email);
    const otp = parsed.data.otp;

    const record = await prisma.emailVerification.findUnique({ where: { email } });
    if (!record || !record.otpHash) {
      return res.status(400).json({ error: "No verification code found. Send a new code first." });
    }

    if (record.verified && record.verifiedAt) {
      const age = Date.now() - new Date(record.verifiedAt).getTime();
      if (age <= REGISTRATION_WINDOW_MS) {
        req.session.otpVerifiedEmail = email;
        return res.json({ ok: true, verified: true, message: "Email already verified." });
      }
      return res.status(400).json({ error: "Verification expired. Send a new code." });
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Verification code expired. Send a new code." });
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(429).json({
        error: "Too many failed attempts. Send a new verification code.",
      });
    }

    const valid = await verifyOtp(otp, record.otpHash);
    if (!valid) {
      await prisma.emailVerification.update({
        where: { email },
        data: { attempts: record.attempts + 1 },
      });
      const remaining = MAX_VERIFY_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        error:
          remaining > 0
            ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Invalid code. No attempts remaining — send a new code.",
      });
    }

    const verifiedAt = new Date();
    await prisma.emailVerification.update({
      where: { email },
      data: {
        verified: true,
        verifiedAt,
        otpHash: null,
        attempts: 0,
      },
    });

    req.session.otpVerifiedEmail = email;

    res.json({
      ok: true,
      verified: true,
      registrationExpiresInSeconds: Math.floor(REGISTRATION_WINDOW_MS / 1000),
      message: "Email verified. You can create your account.",
    });
  } catch (err) {
    console.error("[auth/verify-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

async function isEmailVerifiedForRegistration(email) {
  const normalized = normalizeEmail(email);
  const record = await prisma.emailVerification.findUnique({ where: { email: normalized } });
  if (!record?.verified || !record.verifiedAt) return false;
  const age = Date.now() - new Date(record.verifiedAt).getTime();
  return age <= REGISTRATION_WINDOW_MS;
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors).flat()[0];
    return res.status(400).json({
      error: firstField || "Invalid registration data",
    });
  }
  const { email, password, displayName, phone, role } = parsed.data;
  const normalizedEmail = normalizeEmail(email);

  const verified = await isEmailVerifiedForRegistration(normalizedEmail);
  if (!verified) {
    return res.status(400).json({
      error: "Verify your email with the OTP code before creating an account.",
    });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
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
      email: normalizedEmail,
      passwordHash,
      displayName,
      phone: phone.trim(),
      role: role ?? "employee",
    },
    select: { id: true, email: true, displayName: true, phone: true, role: true },
  });

  await prisma.emailVerification.deleteMany({ where: { email: normalizedEmail } }).catch(() => {});
  delete req.session.otpVerifiedEmail;

  req.session.userId = user.id;
  req.session.role = user.role;
  res.status(201).json({ user });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const forgotPasswordEmailSchema = z.object({
  email: emailSchema,
});

const forgotPasswordVerifySchema = z.object({
  email: emailSchema,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, `OTP must be ${OTP_LENGTH} digits`),
});

const forgotPasswordResetSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

async function isPasswordResetVerified(email) {
  const normalized = normalizeEmail(email);
  const record = await prisma.passwordReset.findUnique({ where: { email: normalized } });
  if (!record?.verified || !record.verifiedAt) return false;
  const age = Date.now() - new Date(record.verifiedAt).getTime();
  return age <= PASSWORD_RESET_WINDOW_MS;
}

router.post("/forgot-password/send-otp", forgotSendOtpLimiter, async (req, res) => {
  try {
    const parsed = forgotPasswordEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const firstField = Object.values(flat.fieldErrors).flat()[0];
      return res.status(400).json({
        error: firstField || "Invalid email address",
      });
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "No account found with this email." });
    }
    if (user.role !== "employee") {
      return res.status(403).json({
        error: "Password reset for admin accounts must be done on the website.",
      });
    }

    const now = new Date();
    let record = await prisma.passwordReset.findUnique({ where: { email } });

    if (record) {
      const windowAge = now.getTime() - new Date(record.resendWindowStart).getTime();
      const oneHour = 60 * 60 * 1000;
      if (windowAge >= oneHour) {
        record = await prisma.passwordReset.update({
          where: { email },
          data: { resendCount: 0, resendWindowStart: now },
        });
      } else if (record.resendCount >= MAX_RESEND_PER_HOUR) {
        return res.status(429).json({
          error: "Too many reset code requests. You can request up to 5 codes per hour for this email.",
        });
      }
    }

    const otp = generateOtpCode();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await prisma.passwordReset.upsert({
      where: { email },
      create: {
        email,
        otpHash,
        expiresAt,
        attempts: 0,
        resendCount: 1,
        resendWindowStart: now,
        verified: false,
        verifiedAt: null,
      },
      update: {
        otpHash,
        expiresAt,
        attempts: 0,
        verified: false,
        verifiedAt: null,
        resendCount: record ? record.resendCount + 1 : 1,
        resendWindowStart: record?.resendWindowStart ?? now,
      },
    });

    await sendPasswordResetOtpEmail(email, otp);

    res.json({
      ok: true,
      expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
      message: "Password reset code sent to your email.",
    });
  } catch (err) {
    console.error("[auth/forgot-password/send-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/forgot-password/verify-otp", forgotVerifyOtpLimiter, async (req, res) => {
  try {
    const parsed = forgotPasswordVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid email or OTP format" });
    }

    const email = normalizeEmail(parsed.data.email);
    const otp = parsed.data.otp;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== "employee") {
      return res.status(404).json({ error: "No employee account found with this email." });
    }

    const record = await prisma.passwordReset.findUnique({ where: { email } });
    if (!record || !record.otpHash) {
      return res.status(400).json({ error: "No reset code found. Send a new code first." });
    }

    if (record.verified && record.verifiedAt) {
      const age = Date.now() - new Date(record.verifiedAt).getTime();
      if (age <= PASSWORD_RESET_WINDOW_MS) {
        req.session.passwordResetVerifiedEmail = email;
        return res.json({
          ok: true,
          verified: true,
          resetExpiresInSeconds: Math.floor(PASSWORD_RESET_WINDOW_MS / 1000),
          message: "Code verified. Set your new password.",
        });
      }
      return res.status(400).json({ error: "Verification expired. Send a new code." });
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Reset code expired. Send a new code." });
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(429).json({
        error: "Too many failed attempts. Send a new reset code.",
      });
    }

    const valid = await verifyOtp(otp, record.otpHash);
    if (!valid) {
      await prisma.passwordReset.update({
        where: { email },
        data: { attempts: record.attempts + 1 },
      });
      const remaining = MAX_VERIFY_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        error:
          remaining > 0
            ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Invalid code. No attempts remaining — send a new code.",
      });
    }

    const verifiedAt = new Date();
    await prisma.passwordReset.update({
      where: { email },
      data: {
        verified: true,
        verifiedAt,
        otpHash: null,
        attempts: 0,
      },
    });

    req.session.passwordResetVerifiedEmail = email;

    res.json({
      ok: true,
      verified: true,
      resetExpiresInSeconds: Math.floor(PASSWORD_RESET_WINDOW_MS / 1000),
      message: "Code verified. Set your new password.",
    });
  } catch (err) {
    console.error("[auth/forgot-password/verify-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/forgot-password/reset", async (req, res) => {
  try {
    const parsed = forgotPasswordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const firstField = Object.values(flat.fieldErrors).flat()[0];
      return res.status(400).json({
        error: firstField || "Invalid password reset data",
      });
    }

    const email = normalizeEmail(parsed.data.email);
    const sessionEmail = req.session.passwordResetVerifiedEmail;
    if (!sessionEmail || sessionEmail !== email) {
      return res.status(400).json({
        error: "Verify the reset code before setting a new password.",
      });
    }

    const verified = await isPasswordResetVerified(email);
    if (!verified) {
      delete req.session.passwordResetVerifiedEmail;
      return res.status(400).json({ error: "Verification expired. Send a new code." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== "employee") {
      return res.status(404).json({ error: "No employee account found with this email." });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await prisma.passwordReset.deleteMany({ where: { email } }).catch(() => {});
    delete req.session.passwordResetVerifiedEmail;

    res.json({
      ok: true,
      message: "Password updated. You can sign in with your new password.",
    });
  } catch (err) {
    console.error("[auth/forgot-password/reset]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid credentials" });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
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
