import { Router } from "express";
import { requireOwner } from "../middleware/auth.js";
import { getCompanyTrialStatus } from "../lib/companyTrial.js";

const router = Router();

router.get("/trial", requireOwner, async (_req, res) => {
  const status = await getCompanyTrialStatus();
  res.json({
    trialStartDate: status.trialStartDate.toISOString(),
    trialEndDate: status.trialEndDate.toISOString(),
    remainingDays: status.remainingDays,
    isExpired: status.isExpired,
    hasStarted: status.hasStarted,
  });
});

export default router;
