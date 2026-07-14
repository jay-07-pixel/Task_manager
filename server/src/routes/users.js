import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { randomUUID } from "crypto";
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
import {
  appendProfileDocuments,
  clearUserIdProof,
  clearUserProfilePhoto,
  profileDocumentSelect,
  setUserIdProof,
  setUserProfilePhoto,
  USER_PROFILE_DOC_MAX_BYTES,
} from "../lib/userProfileDocs.js";
import {
  deleteUserStorageFile,
  getStorageUsageForUsers,
  getUserStorageUsage,
  listUserStorageFiles,
  STORAGE_FILE_CATEGORIES,
  USER_STORAGE_QUOTA_BYTES,
} from "../services/userStorageService.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profilePhotoUploadsRoot = path.join(__dirname, "..", "..", "uploads", "profile-photos");
const idProofUploadsRoot = path.join(__dirname, "..", "..", "uploads", "id-proofs");
fs.mkdirSync(profilePhotoUploadsRoot, { recursive: true });
fs.mkdirSync(idProofUploadsRoot, { recursive: true });

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
  ...profileDocumentSelect,
};

function deleteStoredFile(root, storedName) {
  if (!storedName || /[\\/]/.test(storedName)) return;
  fs.unlink(path.join(root, path.basename(storedName)), () => {});
}

function createProfileDocUpload(root, { imageOnly = false } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, root),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase() || (imageOnly ? ".jpg" : ".pdf");
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: USER_PROFILE_DOC_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || "").toLowerCase();
      const ok = imageOnly
        ? mime === "image/jpeg" || mime === "image/png" || mime === "image/webp"
        : mime === "application/pdf" ||
          mime === "image/jpeg" ||
          mime === "image/png" ||
          mime === "image/webp";
      cb(
        ok
          ? null
          : new Error(
              imageOnly
                ? "Profile photo must be JPEG, PNG, or WebP."
                : "ID proof must be PDF or image (JPEG, PNG, WebP)."
            ),
        ok
      );
    },
  });
}

const profilePhotoUpload = createProfileDocUpload(profilePhotoUploadsRoot, { imageOnly: true });
const idProofUpload = createProfileDocUpload(idProofUploadsRoot);

function serializeProfileUser(user, { docUserId = null } = {}) {
  return appendProfileDocuments(
    {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      phone: user.phone,
      salary: user.salary,
      createdAt: user.createdAt,
      isAdmin: userHasAdminAccess(user),
      isOwner: userIsCompanyOwner(user),
    },
    user,
    docUserId
  );
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

router.get("/storage", requireAuth, async (req, res) => {
  try {
    const storage = await getUserStorageUsage(req.session.userId);
    res.json({ storage });
  } catch (err) {
    console.error("[user-storage]", err);
    res.status(500).json({ error: "Could not calculate storage usage." });
  }
});

router.get("/storage/files", requireAuth, async (req, res) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (!STORAGE_FILE_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `category must be one of: ${STORAGE_FILE_CATEGORIES.join(", ")}`,
      });
    }
    const files = await listUserStorageFiles(req.session.userId, category);
    res.json({ category, files });
  } catch (err) {
    console.error("[user-storage-files]", err);
    res.status(500).json({ error: "Could not list storage files." });
  }
});

router.delete("/storage/files/:fileId", requireAuth, async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.fileId || "");
    await deleteUserStorageFile(req.session.userId, fileId);
    const storage = await getUserStorageUsage(req.session.userId);
    res.json({ ok: true, storage });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error("[user-storage-delete]", err);
    res.status(status).json({ error: err?.message || "Could not delete file." });
  }
});

router.get("/storage/team", requireOwner, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { displayName: "asc" },
    });
    const rows = await getStorageUsageForUsers(users.map((u) => u.id));
    const byUserId = Object.fromEntries(rows.map((row) => [row.userId, row]));
    res.json({
      quotaBytes: USER_STORAGE_QUOTA_BYTES,
      byUserId,
    });
  } catch (err) {
    console.error("[user-storage-team]", err);
    res.status(500).json({ error: "Could not calculate team storage usage." });
  }
});

router.get("/:id/storage", requireOwner, async (req, res) => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: "User not found." });
    const storage = await getUserStorageUsage(target.id);
    res.json({ storage });
  } catch (err) {
    console.error("[user-storage-id]", err);
    res.status(500).json({ error: "Could not calculate storage usage." });
  }
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

router.post("/profile-photo", requireAuth, (req, res, next) => {
  profilePhotoUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Profile photo must be 10 MB or smaller." });
      }
      return res.status(400).json({ error: err.message || "Upload failed." });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const existing = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { profilePhotoPath: true },
  });
  if (existing?.profilePhotoPath) {
    deleteStoredFile(profilePhotoUploadsRoot, existing.profilePhotoPath);
  }

  const user = await setUserProfilePhoto(req.session.userId, {
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    originalName: req.file.originalname || req.file.filename,
  });
  res.json({ profile: serializeProfileUser(user) });
});

router.get("/profile-photo", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { profilePhotoPath: true, profilePhotoMime: true, profilePhotoName: true },
  });
  if (!user?.profilePhotoPath) {
    return res.status(404).json({ error: "No profile photo on file." });
  }
  const full = path.join(profilePhotoUploadsRoot, path.basename(user.profilePhotoPath));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Profile photo file not found." });
  }
  res.setHeader("Content-Type", user.profilePhotoMime || "image/jpeg");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${(user.profilePhotoName || "profile-photo").replace(/"/g, "")}"`
  );
  res.sendFile(full);
});

router.delete("/profile-photo", requireAuth, async (req, res) => {
  const { row, user } = await clearUserProfilePhoto(req.session.userId);
  if (row?.profilePhotoPath) {
    deleteStoredFile(profilePhotoUploadsRoot, row.profilePhotoPath);
  }
  res.json({ profile: serializeProfileUser(user) });
});

router.post("/id-proof", requireAuth, (req, res, next) => {
  idProofUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "ID proof must be 10 MB or smaller." });
      }
      return res.status(400).json({ error: err.message || "Upload failed." });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const existing = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { idProofPath: true },
  });
  if (existing?.idProofPath) {
    deleteStoredFile(idProofUploadsRoot, existing.idProofPath);
  }

  const user = await setUserIdProof(req.session.userId, {
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    originalName: req.file.originalname || req.file.filename,
  });
  res.json({ profile: serializeProfileUser(user) });
});

router.get("/id-proof", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { idProofPath: true, idProofMime: true, idProofName: true },
  });
  if (!user?.idProofPath) {
    return res.status(404).json({ error: "No ID proof on file." });
  }
  const full = path.join(idProofUploadsRoot, path.basename(user.idProofPath));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "ID proof file not found." });
  }
  res.setHeader("Content-Type", user.idProofMime || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${(user.idProofName || "id-proof").replace(/"/g, "")}"`
  );
  res.sendFile(full);
});

router.delete("/id-proof", requireAuth, async (req, res) => {
  const { row, user } = await clearUserIdProof(req.session.userId);
  if (row?.idProofPath) {
    deleteStoredFile(idProofUploadsRoot, row.idProofPath);
  }
  res.json({ profile: serializeProfileUser(user) });
});

router.get("/:id/profile-photo", requireOwner, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { profilePhotoPath: true, profilePhotoMime: true, profilePhotoName: true },
  });
  if (!user?.profilePhotoPath) {
    return res.status(404).json({ error: "No profile photo on file." });
  }
  const full = path.join(profilePhotoUploadsRoot, path.basename(user.profilePhotoPath));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Profile photo file not found." });
  }
  res.setHeader("Content-Type", user.profilePhotoMime || "image/jpeg");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${(user.profilePhotoName || "profile-photo").replace(/"/g, "")}"`
  );
  res.sendFile(full);
});

router.get("/:id/id-proof", requireOwner, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { idProofPath: true, idProofMime: true, idProofName: true },
  });
  if (!user?.idProofPath) {
    return res.status(404).json({ error: "No ID proof on file." });
  }
  const full = path.join(idProofUploadsRoot, path.basename(user.idProofPath));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "ID proof file not found." });
  }
  res.setHeader("Content-Type", user.idProofMime || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${(user.idProofName || "id-proof").replace(/"/g, "")}"`
  );
  res.sendFile(full);
});

router.get("/:id/profile", requireOwner, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: profileSelect,
  });
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ profile: serializeProfileUser(user, { docUserId: user.id }) });
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
  const editingOther = target.id !== req.session.userId;
  if (editingOther) {
    if (parsed.data.displayName !== undefined || parsed.data.phone !== undefined) {
      return res.status(403).json({ error: "Only salary can be updated for other users." });
    }
    if (parsed.data.salary === undefined) {
      return res.status(400).json({ error: "No changes to save." });
    }
    data.salary = parsed.data.salary;
  } else {
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.phone !== undefined) {
      data.phone = parsed.data.phone ? parsed.data.phone : null;
    }
    if (parsed.data.salary !== undefined) data.salary = parsed.data.salary;
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "No changes to save." });
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data,
    select: profileSelect,
  });
  res.json({ profile: serializeProfileUser(user, { docUserId: user.id }) });
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
