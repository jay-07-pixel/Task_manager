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
  getDailyAttendanceSchedule,
  setCompanyAttendanceEnabled,
  setCompanyLiveLocationRequired,
  setDailyAttendanceSchedule,
} from "../services/companyAttendanceSettings.js";
import {
  createWorkLocation,
  deleteWorkLocation,
  listWorkLocations,
  updateWorkLocation,
} from "../services/workLocationService.js";
import {
  getCheckStatus,
  getDailyAttendanceReport,
  getMonthlyAttendanceReport,
  getMyAttendanceHistory,
  performCheck,
} from "../services/attendanceCheckService.js";

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
  liveLocationRequired: z.boolean().optional(),
  attendanceEnabled: z.boolean().optional(),
});

const workLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(5000).default(100),
  isActive: z.boolean().optional(),
});

const workLocationPatchSchema = workLocationSchema.partial();

const checkCoordsSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const dailyScheduleSchema = z.object({
  checkInTime: z.string().nullable().optional(),
  checkOutTime: z.string().nullable().optional(),
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
  if (
    parsed.data.liveLocationRequired === undefined &&
    parsed.data.attendanceEnabled === undefined
  ) {
    return res.status(400).json({ error: "No settings to update." });
  }
  let settings = await getCompanyAttendanceSettings();
  if (parsed.data.liveLocationRequired !== undefined) {
    settings = {
      ...settings,
      ...(await setCompanyLiveLocationRequired(parsed.data.liveLocationRequired)),
    };
  }
  if (parsed.data.attendanceEnabled !== undefined) {
    settings = {
      ...settings,
      ...(await setCompanyAttendanceEnabled(parsed.data.attendanceEnabled)),
    };
  }
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

router.get("/work-locations", requireAuth, async (req, res) => {
  const activeOnly = req.session.role === "employee";
  const locations = await listWorkLocations({ activeOnly });
  res.json({ locations });
});

router.post("/work-locations", requireOwner, async (req, res) => {
  const parsed = workLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors).flat()[0];
    return res.status(400).json({ error: firstField || "Invalid location data." });
  }
  const location = await createWorkLocation(parsed.data);
  res.status(201).json({ location });
});

router.patch("/work-locations/:id", requireOwner, async (req, res) => {
  const parsed = workLocationPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors).flat()[0];
    return res.status(400).json({ error: firstField || "Invalid location data." });
  }
  const location = await updateWorkLocation(req.params.id, parsed.data);
  if (!location) return res.status(404).json({ error: "Location not found." });
  res.json({ location });
});

router.delete("/work-locations/:id", requireOwner, async (req, res) => {
  const ok = await deleteWorkLocation(req.params.id);
  if (!ok) return res.status(404).json({ error: "Location not found." });
  res.json({ ok: true });
});

router.get("/daily-schedule", requireAuth, async (_req, res) => {
  const schedule = await getDailyAttendanceSchedule();
  res.json(schedule);
});

router.patch("/daily-schedule", requireOwner, async (req, res) => {
  const parsed = dailyScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule data." });
  }
  try {
    const schedule = await setDailyAttendanceSchedule(parsed.data);
    res.json({ ok: true, ...schedule });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save schedule." });
  }
});

router.get("/check-status", requireAuth, async (req, res) => {
  const lat = req.query.latitude != null ? Number(req.query.latitude) : null;
  const lng = req.query.longitude != null ? Number(req.query.longitude) : null;
  const status = await getCheckStatus(req.session.userId, {
    latitude: Number.isFinite(lat) ? lat : undefined,
    longitude: Number.isFinite(lng) ? lng : undefined,
  });
  res.json(status);
});

router.get("/my-history", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const days = Number.parseInt(String(req.query.days ?? ""), 10);
  const history = await getMyAttendanceHistory(req.session.userId, {
    days: Number.isFinite(days) ? days : 14,
  });
  res.json(history);
});

router.post("/check-in", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const parsed = checkCoordsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "latitude and longitude required." });
  }
  try {
    const result = await performCheck(
      req.session.userId,
      "check_in",
      parsed.data.latitude,
      parsed.data.longitude
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || "Check-in failed." });
  }
});

router.post("/check-out", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const parsed = checkCoordsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "latitude and longitude required." });
  }
  try {
    const result = await performCheck(
      req.session.userId,
      "check_out",
      parsed.data.latitude,
      parsed.data.longitude
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || "Check-out failed." });
  }
});

router.get("/daily-report", requireOwner, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  try {
    const report = await getDailyAttendanceReport(date || undefined);
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid date." });
  }
});

router.get("/monthly-report", requireOwner, async (req, res) => {
  const now = new Date();
  const year = Number.parseInt(String(req.query.year ?? now.getFullYear()), 10);
  const month = Number.parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  try {
    const report = await getMonthlyAttendanceReport(year, month);
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid month." });
  }
});

export default router;
