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
import { notifyAdminsLocationTrackingOff } from "../services/attendanceNotificationService.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const pingSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional().nullable(),
});

const trackingSchema = z.object({
  enabled: z.boolean(),
});

router.get("/status", requireAuth, async (req, res) => {
  const status = await getEmployeeStatus(req.session.userId);
  res.json(status);
});

router.post("/consent", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  await enableTrackingWithConsent(req.session.userId);
  const status = await getEmployeeStatus(req.session.userId);
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
    await enableTrackingWithConsent(userId);
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
  res.json({ employee, offPeriods, recentPings });
});

export default router;
