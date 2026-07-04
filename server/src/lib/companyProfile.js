import { prisma } from "./prisma.js";
import { syncCompanyTrialSettings } from "./companyTrial.js";

/** @param {import("@prisma/client").CompanySettings} row */
export function serializeCompanyProfile(row) {
  const hasCertificate = Boolean(row.gstCertificatePath);
  return {
    companyName: row.companyName ?? "",
    companyAddress: row.companyAddress ?? "",
    companyState: row.companyState ?? "",
    gstNumber: row.gstNumber ?? "",
    gstCertificate: hasCertificate
      ? {
          url: "/api/company/gst-certificate",
          originalName: row.gstCertificateName ?? "gst-certificate",
          mimeType: row.gstCertificateMime ?? "application/pdf",
        }
      : null,
    directorName: row.directorName ?? "",
    directorEmail: row.directorEmail ?? "",
    directorPhone: row.directorPhone ?? "",
    directorDetails: row.directorDetails ?? "",
    contactPerson2Name: row.contactPerson2Name ?? "",
    contactPerson2Email: row.contactPerson2Email ?? "",
    contactPerson2Phone: row.contactPerson2Phone ?? "",
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  };
}

export async function getCompanyProfileRow() {
  return syncCompanyTrialSettings();
}

export async function getCompanyProfile() {
  const row = await getCompanyProfileRow();
  return serializeCompanyProfile(row);
}

/**
 * @param {Partial<{
 *   companyName: string | null;
 *   companyAddress: string | null;
 *   companyState: string | null;
 *   gstNumber: string | null;
 *   directorName: string | null;
 *   directorEmail: string | null;
 *   directorPhone: string | null;
 *   directorDetails: string | null;
 *   contactPerson2Name: string | null;
 *   contactPerson2Email: string | null;
 *   contactPerson2Phone: string | null;
 * }>} data
 */
export async function updateCompanyProfile(data) {
  await syncCompanyTrialSettings();
  const row = await prisma.companySettings.update({
    where: { id: "default" },
    data,
  });
  return serializeCompanyProfile(row);
}

export async function setCompanyGstCertificate({ storedName, mimeType, originalName }) {
  await syncCompanyTrialSettings();
  const row = await prisma.companySettings.update({
    where: { id: "default" },
    data: {
      gstCertificatePath: storedName,
      gstCertificateMime: mimeType,
      gstCertificateName: originalName,
    },
  });
  return serializeCompanyProfile(row);
}

export async function clearCompanyGstCertificate() {
  await syncCompanyTrialSettings();
  const row = await prisma.companySettings.update({
    where: { id: "default" },
    data: {
      gstCertificatePath: null,
      gstCertificateMime: null,
      gstCertificateName: null,
    },
  });
  return serializeCompanyProfile(row);
}
