import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendAdminPromotionEmail, sendAdminRevocationEmail } from "../lib/mail.js";
import {
  adminUserWhere,
  companyOwnerWhere,
  MAX_COMPANY_OWNERS,
  userHasAdminAccess,
  userIsCompanyOwner,
} from "../lib/adminUsers.js";
import { requireAuth, requireOwner, requireCompanyOwner } from "../middleware/auth.js";
import { buildEmployeeMonthlyBudgetRows } from "../services/employeeMonthlyMinutesService.js";

const router = Router();

const rolePatchSchema = z.object({
  role: z.enum(["owner", "employee"]),
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone must be exactly 10 digits (numbers only)");

const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  phone: z.union([phoneSchema, z.literal(""), z.null()]).optional(),
  salary: z.number().int().min(0).max(999_999_999).optional(),
});

const profileSelect = {
  id: true,
  email: true,
  displayName: true,
  phone: true,
  salary: true,
  role: true,
  isAdmin: true,
  isOwner: true,
  createdAt: true,
};

function serializeProfileUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    salary: user.salary,
    createdAt: user.createdAt,
    isAdmin: userHasAdminAccess(user),
    isOwner: userIsCompanyOwner(user),
  };
}

function serializeTeamUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isAdmin: userHasAdminAccess(user),
    isOwner: userIsCompanyOwner(user),
    salary: user.salary,
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

  const excludeTaskId = typeof req.query.excludeTaskId === "string" ? req.query.excludeTaskId.trim() : "";
  const previewDurationRaw = typeof req.query.previewDurationMinutes === "string"
    ? req.query.previewDurationMinutes.trim()
    : "";
  const previewDurationMinutes = previewDurationRaw ? Number.parseInt(previewDurationRaw, 10) : null;
  const previewRecurrence =
    typeof req.query.previewRecurrence === "string" && req.query.previewRecurrence.trim()
      ? req.query.previewRecurrence.trim()
      : "none";
  let previewRecurrenceRule = null;
  if (typeof req.query.previewRecurrenceRule === "string" && req.query.previewRecurrenceRule.trim()) {
    try {
      previewRecurrenceRule = JSON.parse(req.query.previewRecurrenceRule);
    } catch {
      previewRecurrenceRule = null;
    }
  }
  const previewDueAt =
    typeof req.query.previewDueAt === "string" && req.query.previewDueAt.trim()
      ? req.query.previewDueAt.trim()
      : null;

  const preview =
    previewDurationMinutes != null &&
    Number.isFinite(previewDurationMinutes) &&
    previewDurationMinutes > 0
      ? {
          durationMinutes: previewDurationMinutes,
          recurrence: previewRecurrence,
          recurrenceRule: previewRecurrenceRule,
          dueAt: previewDueAt,
        }
      : null;

  const budgetRows = await buildEmployeeMonthlyBudgetRows(
    users.map((u) => u.id),
    {
      excludeTaskId: excludeTaskId || null,
      preview,
    }
  );
  const budgetByUser = new Map(budgetRows.map((row) => [row.userId, row]));

  res.json({
    users: users.map((u) => {
      const budget = budgetByUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        monthlyBudgetMinutes: budget?.monthlyBudgetMinutes ?? null,
        usedMinutes: budget?.usedMinutes ?? 0,
        remainingMinutes: budget?.remainingMinutes ?? null,
        previewAssignmentMinutes: budget?.previewAssignmentMinutes ?? 0,
        remainingAfterPreview: budget?.remainingAfterPreview ?? null,
      };
    }),
    monthlyBudgetMinutes: budgetRows[0]?.monthlyBudgetMinutes ?? null,
    budgetYear: budgetRows[0]?.budgetYear ?? null,
    budgetMonth: budgetRows[0]?.budgetMonth ?? null,
  });
});

router.get("/team", requireOwner, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true, salary: true },
    orderBy: [{ isOwner: "desc" }, { isAdmin: "desc" }, { displayName: "asc" }],
  });
  const ownerCount = await prisma.user.count({ where: companyOwnerWhere });
  res.json({
    users: users.map(serializeTeamUser),
    ownerCount,
    maxOwners: MAX_COMPANY_OWNERS,
  });
});

router.get("/profile", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: profileSelect,
  });
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ profile: serializeProfileUser(user) });
});

router.patch("/profile", requireAuth, async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors).flat()[0];
    return res.status(400).json({ error: firstField || "Invalid profile data." });
  }

  const actor = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: profileSelect,
  });
  if (!actor) return res.status(404).json({ error: "User not found." });

  const data = {};
  if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
  if (parsed.data.phone !== undefined) {
    data.phone = parsed.data.phone ? parsed.data.phone : null;
  }
  if (parsed.data.salary !== undefined) {
    if (!userHasAdminAccess(actor) || req.session.role !== "owner") {
      return res.status(403).json({ error: "Only admins can change salary." });
    }
    data.salary = parsed.data.salary;
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "No changes to save." });
  }

  const user = await prisma.user.update({
    where: { id: actor.id },
    data,
    select: profileSelect,
  });
  res.json({ profile: serializeProfileUser(user) });
});

router.get("/:id/profile", requireOwner, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: profileSelect,
  });
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ profile: serializeProfileUser(user) });
});

router.patch("/:id/profile", requireOwner, async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors).flat()[0];
    return res.status(400).json({ error: firstField || "Invalid profile data." });
  }

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found." });

  const data = {};
  if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
  if (parsed.data.phone !== undefined) {
    data.phone = parsed.data.phone ? parsed.data.phone : null;
  }
  if (parsed.data.salary !== undefined) data.salary = parsed.data.salary;

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "No changes to save." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data,
    select: profileSelect,
  });
  res.json({ profile: serializeProfileUser(user) });
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
      data: { isAdmin: true, role: "employee", isOwner: false },
      select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true },
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
    data: { isAdmin: false, role: "employee", isOwner: false },
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true },
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

const companyOwnerPatchSchema = z.object({
  isOwner: z.boolean(),
});

/** Promote/revoke company owner (Owner dashboard). Only existing owners; max 2. */
router.patch("/:id/company-owner", requireCompanyOwner, async (req, res) => {
  const parsed = companyOwnerPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body. Use { isOwner: true|false }." });
  }

  const wantOwner = parsed.data.isOwner;
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true },
  });
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }

  if (wantOwner) {
    if (!userHasAdminAccess(target)) {
      return res.status(400).json({ error: "Only admins can be made company owners. Promote them to admin first." });
    }
    if (target.isOwner) {
      return res.status(400).json({ error: "User is already a company owner." });
    }
    const ownerCount = await prisma.user.count({ where: companyOwnerWhere });
    if (ownerCount >= MAX_COMPANY_OWNERS) {
      return res.status(400).json({
        error: `Maximum ${MAX_COMPANY_OWNERS} company owners allowed. Revoke another owner first.`,
      });
    }
    const user = await prisma.user.update({
      where: { id: target.id },
      data: { isOwner: true, isAdmin: true },
      select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true, salary: true },
    });
    return res.json({ user: serializeTeamUser(user) });
  }

  if (!target.isOwner) {
    return res.status(400).json({ error: "User is not a company owner." });
  }
  if (target.id === req.session.userId) {
    return res.status(400).json({ error: "You cannot revoke your own owner access." });
  }
  const ownerCount = await prisma.user.count({ where: companyOwnerWhere });
  if (ownerCount <= 1) {
    return res.status(400).json({ error: "Cannot revoke the last company owner. Promote another owner first." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { isOwner: false },
    select: { id: true, email: true, displayName: true, role: true, isAdmin: true, isOwner: true, salary: true },
  });
  res.json({ user: serializeTeamUser(user) });
});

export default router;
