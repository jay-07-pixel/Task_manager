import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOwner } from "../middleware/auth.js";
import {
  disableTracking,
  enableTrackingWithConsent,
  getEmployeeOffHistory,
  getEmployeeStatus,
  getLiveEmployeesForAdmin,
  getRecentPings,
  recordPing,
} from "../services/attendanceService.js";
import {
  notifyAdminsLocationTrackingOff,
  notifyAdminsLocationTrackingOn,
} from "../services/attendanceNotificationService.js";
import { prisma } from "../lib/prisma.js";
import {
  getGoogleMapsBrowserKey,
  isGoogleMapsConfigured,
  reverseGeocodeDetails,
} from "../services/reverseGeocodeService.js";
import {
  getCompanyAttendanceSettings,
  setCompanyLiveLocationRequired,
} from "../services/companyAttendanceSettings.js";

const router = Router();

const pingSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional().nullable(),
});

const trackingSchema = z.object({
  enabled: z.boolean(),
});

const companySettingsSchema = z.object({
  liveLocationRequired: z.boolean(),
});

router.get("/status", requireAuth, async (req, res) => {
  const status = await getEmployeeStatus(req.session.userId);
  res.json(status);
});

router.get("/company-settings", requireAuth, async (_req, res) => {
  const settings = await getCompanyAttendanceSettings();
  res.json(settings);
});

router.patch("/company-settings", requireOwner, async (req, res) => {
  const parsed = companySettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const settings = await setCompanyLiveLocationRequired(parsed.data.liveLocationRequired);
  res.json({ ok: true, ...settings });
});

router.post("/consent", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const userId = req.session.userId;
  const resume = await enableTrackingWithConsent(userId);
  if (resume.resumedTracking) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    void notifyAdminsLocationTrackingOn({
      employeeId: userId,
      employeeName: user?.displayName || "Employee",
      resumedAt: resume.resumedAt,
    }).catch((err) => console.error("[attendance]", err));
  }
  const status = await getEmployeeStatus(userId);
  res.json({ ok: true, ...status });
});

router.post("/ping", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const parsed = pingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const ping = await recordPing(req.session.userId, parsed.data);
    res.json({
      ok: true,
      recordedAt: ping.recordedAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not record location" });
  }
});

router.patch("/tracking", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const parsed = trackingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId;
  if (parsed.data.enabled) {
    const resume = await enableTrackingWithConsent(userId);
    if (resume.resumedTracking) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });
      void notifyAdminsLocationTrackingOn({
        employeeId: userId,
        employeeName: user?.displayName || "Employee",
        resumedAt: resume.resumedAt,
      }).catch((err) => console.error("[attendance]", err));
    }
  } else {
    await disableTracking(userId, "user_disabled");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    void notifyAdminsLocationTrackingOff({
      employeeId: userId,
      employeeName: user?.displayName || "Employee",
      reason: "user_disabled",
    }).catch((err) => console.error("[attendance]", err));
  }
  const status = await getEmployeeStatus(userId);
  res.json({ ok: true, ...status });
});

router.get("/live", requireOwner, async (_req, res) => {
  const employees = await getLiveEmployeesForAdmin();
  res.json({ employees });
});

router.get("/employees/:userId/history", requireOwner, async (req, res) => {
  const userId = req.params.userId;
  const employee = await prisma.user.findFirst({
    where: { id: userId, role: "employee" },
    select: { id: true, displayName: true },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  const offPeriods = await getEmployeeOffHistory(userId);
  const recentPings = await getRecentPings(userId, { limit: 50 });

  const geocodeJobs = [];
  for (const period of offPeriods) {
    if (period.offLocation) {
      geocodeJobs.push({
        id: `${period.id}:off`,
        latitude: period.offLocation.latitude,
        longitude: period.offLocation.longitude,
      });
    }
    if (period.onLocation) {
      geocodeJobs.push({
        id: `${period.id}:on`,
        latitude: period.onLocation.latitude,
        longitude: period.onLocation.longitude,
      });
    }
  }

  const detailsById = new Map();
  const pending = new Map();
  for (const job of geocodeJobs) {
    const key = `${Number(job.latitude).toFixed(5)},${Number(job.longitude).toFixed(5)}`;
    if (pending.has(key)) {
      pending.get(key).push(job.id);
    } else {
      pending.set(key, [job.id]);
    }
  }
  const delayMs = isGoogleMapsConfigured() ? 50 : 250;
  for (const [key, ids] of pending) {
    const [lat, lng] = key.split(",").map(Number);
    const details = await reverseGeocodeDetails(lat, lng);
    for (const id of ids) {
      detailsById.set(id, details);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  for (const period of offPeriods) {
    if (period.offLocation) {
      const d = detailsById.get(`${period.id}:off`);
      period.offLocation.placeName = d?.placeName ?? null;
      period.offLocation.area = d?.area ?? null;
      period.offLocation.city = d?.city ?? null;
    }
    if (period.onLocation) {
      const d = detailsById.get(`${period.id}:on`);
      period.onLocation.placeName = d?.placeName ?? null;
      period.onLocation.area = d?.area ?? null;
      period.onLocation.city = d?.city ?? null;
    }
  }

  res.json({ employee, offPeriods, recentPings });
});

router.get("/geocode", requireOwner, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng required" });
  }
  const details = await reverseGeocodeDetails(lat, lng);
  res.json({
    placeName: details?.placeName ?? null,
    area: details?.area ?? null,
    city: details?.city ?? null,
  });
});

router.get("/maps-config", requireOwner, async (_req, res) => {
  const apiKey = getGoogleMapsBrowserKey();
  res.json({
    provider: apiKey ? "google" : "leaflet",
    apiKey: apiKey || null,
  });
});

export default router;
