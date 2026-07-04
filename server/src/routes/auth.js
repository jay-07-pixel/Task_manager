import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/otpRateLimit.js";
import { sendOtpEmail, sendPasswordResetEmail } from "../lib/mail.js";
import { getTurnstileSiteKey, verifyTurnstileToken } from "../lib/turnstile.js";
import { friendlyDbError } from "../lib/dbErrorMessage.js";
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
import { adminUserWhere, userHasAdminAccess } from "../lib/adminUsers.js";
import { getCompanyTrialStatus, TRIAL_EXPIRED_MESSAGE } from "../lib/companyTrial.js";
import { getCompanyAttendanceSettings } from "../services/companyAttendanceSettings.js";

const router = Router();

function serializeSessionUser(user, activeRole, company = null) {
  const isAdmin = userHasAdminAccess(user);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    isAdmin,
    isOwner: Boolean(user.isOwner),
    role: activeRole,
    liveLocationRequired: company?.liveLocationRequired !== false,
    attendanceEnabled: company?.attendanceEnabled !== false,
  };
}

async function sessionUserPayload(user, activeRole) {
  const company = await getCompanyAttendanceSettings();
  return serializeSessionUser(user, activeRole, company);
}

function resolveActiveRole(user, viewAs) {
  const isAdmin = userHasAdminAccess(user);
  if (!isAdmin) return "employee";
  if (viewAs === "employee" || viewAs === "owner") return viewAs;
  return "owner";
}

const sendOtpLimiter = createRateLimiter({ max: 15, windowMs: 15 * 60 * 1000, keyPrefix: "send-otp" });
const verifyOtpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000, keyPrefix: "verify-otp" });
const forgotPasswordSendLimiter = createRateLimiter({
  max: 15,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "forgot-pwd-send",
});
const forgotPasswordResetLimiter = createRateLimiter({
  max: 20,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "forgot-pwd-reset",
});

function friendlyAuthError(err) {
  const msg = err?.message || String(err);
  if (/Email service is not configured|Failed to send (verification|reset) email/i.test(msg)) {
    return msg;
  }
  if (err?.code === "P2021" && /password_reset/i.test(msg)) {
    return "Password reset is not set up on the database yet. Run: cd server && npx prisma migrate deploy && npm run db:generate && pm2 restart ss2n";
  }
  return friendlyDbError(err);
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

async function rejectIfTrialExpired(res) {
  const status = await getCompanyTrialStatus();
  if (status.isExpired) {
    res.status(403).json({ error: TRIAL_EXPIRED_MESSAGE });
    return true;
  }
  return false;
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
    const hasAdmin = await prisma.user.findFirst({ where: adminUserWhere });
    if (hasAdmin) {
      return res.status(403).json({ error: "An admin already exists; register as a user or ask an admin for access." });
    }
  }

  if (await rejectIfTrialExpired(res)) return;

  const passwordHash = await bcrypt.hash(password, 10);
  const bootstrapAdmin = role === "owner";
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      displayName,
      phone: phone.trim(),
      role: "employee",
      isAdmin: bootstrapAdmin,
      isOwner: bootstrapAdmin,
    },
    select: { id: true, email: true, displayName: true, phone: true, role: true, isAdmin: true, isOwner: true },
  });

  await prisma.emailVerification.deleteMany({ where: { email: normalizedEmail } }).catch(() => {});
  delete req.session.otpVerifiedEmail;

  const activeRole = resolveActiveRole(user, bootstrapAdmin ? "owner" : "employee");
  req.session.userId = user.id;
  req.session.role = activeRole;
  res.status(201).json({ user: await sessionUserPayload(user, activeRole) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  viewAs: z.enum(["owner", "employee"]).optional(),
});

router.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid credentials" });
    }
    const { email, password, viewAs } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (await rejectIfTrialExpired(res)) return;
    const activeRole = resolveActiveRole(user, viewAs);
    req.session.userId = user.id;
    req.session.role = activeRole;
    res.json({ user: await sessionUserPayload(user, activeRole) });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

const resetPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

router.post("/forgot-password/send-otp", forgotPasswordSendLimiter, async (req, res) => {
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
    const user = await prisma.user.findUnique({ where: { email } });

    const genericOk = () =>
      res.json({
        ok: true,
        expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
        message: "If an account exists for this email, a reset code has been sent.",
      });

    if (!user) {
      return genericOk();
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
          error: "Too many reset requests. You can request up to 5 codes per hour for this email.",
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

    delete req.session.passwordResetVerifiedEmail;

    await sendPasswordResetEmail(email, otp);

    res.json({
      ok: true,
      expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
      message: "If an account exists for this email, a reset code has been sent.",
    });
  } catch (err) {
    console.error("[auth/forgot-password/send-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/forgot-password/verify-otp", verifyOtpLimiter, async (req, res) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid email or OTP format" });
    }

    const email = normalizeEmail(parsed.data.email);
    const otp = parsed.data.otp;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: "Invalid code or email." });
    }

    const record = await prisma.passwordReset.findUnique({ where: { email } });
    if (!record || !record.otpHash) {
      return res.status(400).json({ error: "No reset code found. Send a new code first." });
    }

    if (record.verified && record.verifiedAt) {
      const age = Date.now() - new Date(record.verifiedAt).getTime();
      if (age <= PASSWORD_RESET_WINDOW_MS) {
        req.session.passwordResetVerifiedEmail = email;
        return res.json({ ok: true, verified: true, message: "Code verified. Choose a new password." });
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
      message: "Code verified. Choose a new password.",
    });
  } catch (err) {
    console.error("[auth/forgot-password/verify-otp]", err);
    res.status(500).json({ error: friendlyAuthError(err) });
  }
});

router.post("/forgot-password/reset", forgotPasswordResetLimiter, async (req, res) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const firstField = Object.values(flat.fieldErrors).flat()[0];
      return res.status(400).json({
        error: firstField || "Invalid reset data",
      });
    }

    const email = normalizeEmail(parsed.data.email);
    const { password } = parsed.data;

    if (req.session.passwordResetVerifiedEmail !== email) {
      return res.status(400).json({
        error: "Verify the reset code sent to your email before setting a new password.",
      });
    }

    const record = await prisma.passwordReset.findUnique({ where: { email } });
    if (!record?.verified || !record.verifiedAt) {
      return res.status(400).json({ error: "Verify the reset code before setting a new password." });
    }

    const age = Date.now() - new Date(record.verifiedAt).getTime();
    if (age > PASSWORD_RESET_WINDOW_MS) {
      return res.status(400).json({ error: "Reset session expired. Send a new code." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: "Account not found." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
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

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("taskmgr.sid", { path: "/" });
    res.json({ ok: true });
  });
});

const switchRoleSchema = z.object({
  role: z.enum(["owner", "employee"]),
});

router.post("/switch-role", requireAuth, async (req, res) => {
  const parsed = switchRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid role. Use owner or employee." });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, displayName: true, phone: true, role: true, isAdmin: true, isOwner: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Not found" });
  }

  const nextRole = parsed.data.role;
  if (nextRole === "owner" && !userHasAdminAccess(user)) {
    return res.status(403).json({ error: "You do not have admin access." });
  }

  req.session.role = nextRole;
  res.json({ user: await sessionUserPayload(user, nextRole) });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, displayName: true, phone: true, role: true, isAdmin: true, isOwner: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Not found" });
  }
  const activeRole = req.session.role === "owner" && userHasAdminAccess(user) ? "owner" : "employee";
  if (req.session.role !== activeRole) {
    req.session.role = activeRole;
  }
  res.json({ user: await sessionUserPayload(user, activeRole) });
});

export default router;
