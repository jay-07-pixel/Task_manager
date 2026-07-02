import { prisma } from "./prisma.js";

export const TRIAL_DURATION_DAYS = 30;

export const TRIAL_EXPIRED_MESSAGE =
  "Your 30-day free trial has expired. Please contact Kalpanik to continue using the service.";

const COMPANY_SETTINGS_ID = "default";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function appTimeZone() {
  return process.env.APP_TIMEZONE || "Asia/Kolkata";
}

function istOffsetSuffix() {
  return appTimeZone() === "Asia/Kolkata" ? "+05:30" : "Z";
}

/**
 * @param {string} ymd YYYY-MM-DD
 * @param {"start" | "end"} boundary
 */
function parseTrialBoundary(ymd, boundary) {
  if (!DATE_YMD_RE.test(ymd)) return null;
  const suffix = istOffsetSuffix();
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  const date = new Date(`${ymd}T${time}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Read per-company trial window from server/.env (one VPS folder = one database).
 * @returns {{ trialStartDate: Date, trialEndDate: Date } | null}
 */
export function readTrialDatesFromEnv() {
  const startRaw = process.env.COMPANY_TRIAL_START?.trim();
  const endRaw = process.env.COMPANY_TRIAL_END?.trim();
  if (!startRaw || !endRaw) return null;

  const trialStartDate = parseTrialBoundary(startRaw, "start");
  const trialEndDate = parseTrialBoundary(endRaw, "end");
  if (!trialStartDate || !trialEndDate) {
    console.warn(
      "[company-trial] Invalid COMPANY_TRIAL_START or COMPANY_TRIAL_END — use YYYY-MM-DD (e.g. 2026-06-15)"
    );
    return null;
  }
  if (trialEndDate.getTime() <= trialStartDate.getTime()) {
    console.warn("[company-trial] COMPANY_TRIAL_END must be after COMPANY_TRIAL_START");
    return null;
  }

  return { trialStartDate, trialEndDate };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function datesEqual(a, b) {
  return a.getTime() === b.getTime();
}

function formatTrialYmd(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function logTrialWindow(row, source) {
  console.log(
    `[company-trial] ${formatTrialYmd(row.trialStartDate)} → ${formatTrialYmd(row.trialEndDate)} (${source})`
  );
}

/**
 * Creates or updates the singleton CompanySettings row for this database.
 * When COMPANY_TRIAL_START and COMPANY_TRIAL_END are set in .env, those dates win.
 * @returns {Promise<import("@prisma/client").CompanySettings>}
 */
export async function syncCompanyTrialSettings() {
  const configured = readTrialDatesFromEnv();
  const existing = await prisma.companySettings.findUnique({
    where: { id: COMPANY_SETTINGS_ID },
  });

  if (configured) {
    const { trialStartDate, trialEndDate } = configured;
    if (existing) {
      if (datesEqual(existing.trialStartDate, trialStartDate) && datesEqual(existing.trialEndDate, trialEndDate)) {
        logTrialWindow(existing, "env");
        return existing;
      }
      const updated = await prisma.companySettings.update({
        where: { id: COMPANY_SETTINGS_ID },
        data: { trialStartDate, trialEndDate },
      });
      logTrialWindow(updated, "env-updated");
      return updated;
    }
    const created = await prisma.companySettings.create({
      data: {
        id: COMPANY_SETTINGS_ID,
        trialStartDate,
        trialEndDate,
      },
    });
    logTrialWindow(created, "env-created");
    return created;
  }

  if (existing) {
    logTrialWindow(existing, "database");
    return existing;
  }

  const now = new Date();
  const created = await prisma.companySettings.create({
    data: {
      id: COMPANY_SETTINGS_ID,
      trialStartDate: now,
      trialEndDate: addDays(now, TRIAL_DURATION_DAYS),
    },
  });
  logTrialWindow(created, "auto-30d");
  return created;
}

/** @deprecated Use syncCompanyTrialSettings */
export const ensureCompanySettings = syncCompanyTrialSettings;

/**
 * @param {{ trialStartDate: Date, trialEndDate: Date }} settings
 */
export function computeTrialStatus(settings) {
  const now = new Date();
  const trialStartDate = settings.trialStartDate;
  const trialEndDate = settings.trialEndDate;
  const remainingMs = trialEndDate.getTime() - now.getTime();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const isExpired = now.getTime() > trialEndDate.getTime();
  const hasStarted = now.getTime() >= trialStartDate.getTime();

  return {
    trialStartDate,
    trialEndDate,
    remainingDays,
    isExpired,
    hasStarted,
  };
}

export async function getCompanyTrialStatus() {
  const settings = await syncCompanyTrialSettings();
  return computeTrialStatus(settings);
}

/**
 * @returns {Promise<boolean>} true when login may proceed
 */
export async function isCompanyTrialActive() {
  const status = await getCompanyTrialStatus();
  return !status.isExpired;
}
