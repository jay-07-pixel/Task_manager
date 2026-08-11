import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireCompanyOwner } from "../middleware/auth.js";
import { getCompanyTrialStatus } from "../lib/companyTrial.js";
import { resolvePwaInstanceName } from "../lib/pwaInstance.js";
import {
  clearCompanyGstCertificate,
  getCompanyProfile,
  getCompanyProfileRow,
  setCompanyGstCertificate,
  updateCompanyProfile,
} from "../lib/companyProfile.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gstUploadsRoot = path.join(__dirname, "..", "..", "uploads", "company-gst");
fs.mkdirSync(gstUploadsRoot, { recursive: true });

const optionalText = (max) =>
  z
    .union([z.string().max(max), z.literal(""), z.null()])
    .optional()
    .transform((v) => {
      if (v == null || v === "") return null;
      return String(v).trim() || null;
    });

const optionalEmail = z
  .union([z.string().email().max(191), z.literal(""), z.null()])
  .optional()
  .transform((v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    return s || null;
  });

const optionalPhone = z
  .union([z.string().regex(/^\d{10}$/), z.literal(""), z.null()])
  .optional()
  .transform((v) => {
    if (v == null || v === "") return null;
    return String(v).trim() || null;
  });

const companyProfilePatchSchema = z.object({
  companyName: optionalText(200),
  companyAddress: optionalText(5000),
  companyState: optionalText(64),
  gstNumber: optionalText(32),
  directorName: optionalText(120),
  directorEmail: optionalEmail,
  directorPhone: optionalPhone,
  directorDetails: optionalText(5000),
  contactPerson2Name: optionalText(120),
  contactPerson2Email: optionalEmail,
  contactPerson2Phone: optionalPhone,
});

const GST_CERTIFICATE_MAX_BYTES = 10 * 1024 * 1024;

const gstUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, gstUploadsRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".pdf";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: GST_CERTIFICATE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    const ok =
      mime === "application/pdf" ||
      mime === "image/jpeg" ||
      mime === "image/png" ||
      mime === "image/webp";
    cb(ok ? null : new Error("GST certificate must be PDF or image (JPEG, PNG, WebP)."), ok);
  },
});

function deleteGstFile(storedName) {
  if (!storedName || /[\\/]/.test(storedName)) return;
  const full = path.join(gstUploadsRoot, path.basename(storedName));
  fs.unlink(full, () => {});
}

router.get("/trial", requireCompanyOwner, async (_req, res) => {
  const status = await getCompanyTrialStatus();
  res.json({
    trialStartDate: status.trialStartDate.toISOString(),
    trialEndDate: status.trialEndDate.toISOString(),
    remainingDays: status.remainingDays,
    isExpired: status.isExpired,
    hasStarted: status.hasStarted,
  });
});

/** Context passed to kalpanik.in/renew so billing + activation stay in sync. */
router.get("/renewal-context", requireCompanyOwner, async (req, res) => {
  const [status, profile, userCount, owner] = await Promise.all([
    getCompanyTrialStatus(),
    getCompanyProfile(),
    prisma.user.count(),
    prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { email: true, displayName: true, phone: true },
    }),
  ]);

  const host = String(req.headers.host || "").split(":")[0];
  const instance = resolvePwaInstanceName(host);
  const site =
    process.env.APP_PUBLIC_URL?.trim() ||
    `${req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host || host}`;

  const trialEndYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(status.trialEndDate);

  res.json({
    instance,
    site,
    companyName: profile?.companyName || null,
    email: profile?.directorEmail || owner?.email || null,
    phone: profile?.directorPhone || owner?.phone || null,
    ownerName: profile?.directorName || owner?.displayName || null,
    userCount,
    trialStartDate: status.trialStartDate.toISOString(),
    trialEndDate: status.trialEndDate.toISOString(),
    trialEndYmd,
    remainingDays: status.remainingDays,
    isExpired: status.isExpired,
    renewBaseUrl: "https://kalpanik.in/renew",
    plans: [
      { id: "task_management", priceInr: 299, label: "Task Management" },
      { id: "task_attendance", priceInr: 349, label: "Task + Attendance" },
    ],
    storage: { includedGbPerUser: 1, extraGbPriceInr: 100 },
  });
});

router.get("/profile", requireCompanyOwner, async (_req, res) => {
  const profile = await getCompanyProfile();
  res.json({ profile });
});

router.patch("/profile", requireCompanyOwner, async (req, res) => {
  const parsed = companyProfilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const profile = await updateCompanyProfile(parsed.data);
  res.json({ profile });
});

router.post("/gst-certificate", requireCompanyOwner, (req, res, next) => {
  gstUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "GST certificate must be 10 MB or smaller." });
      }
      return res.status(400).json({ error: err.message || "Upload failed." });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const existing = await getCompanyProfileRow();
  if (existing.gstCertificatePath) {
    deleteGstFile(existing.gstCertificatePath);
  }

  const profile = await setCompanyGstCertificate({
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    originalName: req.file.originalname || req.file.filename,
  });
  res.json({ profile });
});

router.get("/gst-certificate", requireCompanyOwner, async (_req, res) => {
  const row = await getCompanyProfileRow();
  if (!row.gstCertificatePath) {
    return res.status(404).json({ error: "No GST certificate on file." });
  }
  const full = path.join(gstUploadsRoot, path.basename(row.gstCertificatePath));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Certificate file not found." });
  }
  const mime = row.gstCertificateMime || "application/octet-stream";
  const name = row.gstCertificateName || "gst-certificate";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${name.replace(/"/g, "")}"`);
  res.sendFile(full);
});

router.delete("/gst-certificate", requireCompanyOwner, async (_req, res) => {
  const row = await getCompanyProfileRow();
  if (row.gstCertificatePath) {
    deleteGstFile(row.gstCertificatePath);
  }
  const profile = await clearCompanyGstCertificate();
  res.json({ profile });
});

export default router;
