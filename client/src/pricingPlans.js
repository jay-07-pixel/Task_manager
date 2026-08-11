/** Canonical Kalpanik plans — keep in sync with pricing.png and kalpanik.in */

export const KALPANIK_SITE_URL = "https://kalpanik.in";
export const KALPANIK_RENEW_URL = "https://kalpanik.in/renew";

export const PRICING_PLANS = [
  {
    id: "task_management",
    nameKey: "pricing.planTaskName",
    priceInr: 299,
    priceUnitKey: "pricing.perUserMonth",
    storageKey: "pricing.storagePerUser",
    blurbKey: "pricing.planTaskBlurb",
    featuresKey: "pricing.planTaskFeatures",
    accent: "task",
  },
  {
    id: "task_attendance",
    nameKey: "pricing.planAttendanceName",
    priceInr: 349,
    priceUnitKey: "pricing.perUserMonth",
    storageKey: "pricing.storagePerUser",
    blurbKey: "pricing.planAttendanceBlurb",
    featuresKey: "pricing.planAttendanceFeatures",
    accent: "attendance",
  },
];

export const PRICING_STORAGE = {
  includedGbPerUser: 1,
  extraGbPriceInr: 100,
  examples: [5, 10, 25, 50, 100],
};

/**
 * Build renew URL for kalpanik.in with tenant context (both apps stay in sync).
 * @param {Record<string, string | number | null | undefined>} ctx
 */
export function buildKalpanikRenewUrl(ctx = {}) {
  const url = new URL(KALPANIK_RENEW_URL);
  const entries = {
    instance: ctx.instance,
    site: ctx.site,
    company: ctx.company,
    email: ctx.email,
    phone: ctx.phone,
    users: ctx.users,
    trialEnd: ctx.trialEnd,
    plan: ctx.plan,
    extraGb: ctx.extraGb,
    months: ctx.months ?? 1,
    source: "task_manager",
  };
  for (const [key, value] of Object.entries(entries)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
