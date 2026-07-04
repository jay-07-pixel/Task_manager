import { prisma } from "../lib/prisma.js";
import { syncCompanyTrialSettings } from "../lib/companyTrial.js";

const COMPANY_SETTINGS_ID = "default";

/**
 * Whether this company requires employee live location (attendance).
 * Defaults to true when the setting row is missing or the column is unset.
 */
export async function isCompanyLiveLocationRequired() {
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: COMPANY_SETTINGS_ID },
      select: { liveLocationRequired: true },
    });
    if (!row) return true;
    return row.liveLocationRequired !== false;
  } catch {
    return true;
  }
}

export async function getCompanyAttendanceSettings() {
  const liveLocationRequired = await isCompanyLiveLocationRequired();
  return { liveLocationRequired };
}

/**
 * @param {boolean} liveLocationRequired
 */
export async function setCompanyLiveLocationRequired(liveLocationRequired) {
  await syncCompanyTrialSettings();
  const updated = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { liveLocationRequired: !!liveLocationRequired },
    select: { liveLocationRequired: true, updatedAt: true },
  });
  return {
    liveLocationRequired: updated.liveLocationRequired,
    updatedAt: updated.updatedAt.toISOString(),
  };
}
