import * as bootstrap from "bootstrap";
import { tr } from "./i18n/index.js";
import {
  PRICING_PLANS,
  PRICING_STORAGE,
  buildKalpanikRenewUrl,
  KALPANIK_SITE_URL,
} from "./pricingPlans.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;
/** @type {((s: string) => string) | null} */
let escapeHtmlFn = null;
/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {Record<string, any> | null} */
let cachedRenewalContext = null;

export function initOwnerPricing({ api, escapeHtml, showToast }) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  showToastFn = showToast ?? null;
}

function esc(s) {
  return (escapeHtmlFn ?? ((x) => String(x ?? "")))(s);
}

function featureListHtml(featuresKey) {
  const raw = tr(featuresKey);
  const items = Array.isArray(raw) ? raw : String(raw || "").split("|").map((s) => s.trim()).filter(Boolean);
  return `<ul class="owner-pricing-features">${items.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
}

function planCardHtml(plan) {
  return `<article class="owner-pricing-plan owner-pricing-plan--${esc(plan.accent)}" data-plan-id="${esc(plan.id)}">
    <h3 class="owner-pricing-plan-name">${esc(tr(plan.nameKey))}</h3>
    <p class="owner-pricing-plan-price">
      <span class="owner-pricing-plan-amount">₹ ${esc(String(plan.priceInr))}</span>
      <span class="owner-pricing-plan-unit">${esc(tr(plan.priceUnitKey))}</span>
    </p>
    <p class="owner-pricing-plan-storage">${esc(tr(plan.storageKey))}</p>
    <p class="owner-pricing-plan-blurb">${esc(tr(plan.blurbKey))}</p>
    ${featureListHtml(plan.featuresKey)}
    <button type="button" class="btn owner-pricing-renew-btn" data-renew-plan="${esc(plan.id)}">
      ${esc(tr("pricing.renewThisPlan"))}
    </button>
  </article>`;
}

function storageAsideHtml() {
  const examples = PRICING_STORAGE.examples
    .map(
      (n) =>
        `<li>${esc(tr("pricing.storageExample", { users: n, gb: n * PRICING_STORAGE.includedGbPerUser }))}</li>`
    )
    .join("");
  return `<aside class="owner-pricing-storage">
    <h3 class="owner-pricing-aside-title">${esc(tr("pricing.storageTitle"))}</h3>
    <p class="owner-pricing-aside-body">${esc(tr("pricing.storageRule"))}</p>
    <ul class="owner-pricing-storage-examples">${examples}</ul>
    <p class="owner-pricing-aside-extra">${esc(
      tr("pricing.extraStorage", { price: PRICING_STORAGE.extraGbPriceInr })
    )}</p>
    <h3 class="owner-pricing-aside-title mt-3">${esc(tr("pricing.howStorageTitle"))}</h3>
    <p class="owner-pricing-aside-body">${esc(tr("pricing.howStorageBody"))}</p>
  </aside>`;
}

export function ownerPricingModalHtml() {
  return `
    <div class="modal fade" id="ownerPricingModal" tabindex="-1" aria-labelledby="ownerPricingModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl modal-dialog-scrollable">
        <div class="modal-content owner-pricing-modal-content border-0 shadow">
          <div class="modal-header owner-pricing-modal-header border-0 pb-0">
            <div>
              <p class="owner-pricing-brand mb-1">${esc(tr("pricing.brand"))}</p>
              <h2 class="modal-title h5 mb-0" id="ownerPricingModalTitle">${esc(tr("pricing.title"))}</h2>
              <p class="small text-muted mb-0 mt-1">${esc(tr("pricing.subtitle"))}</p>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${esc(tr("common.close"))}"></button>
          </div>
          <div class="modal-body owner-pricing-modal-body pt-3">
            <p class="owner-pricing-trial-badge mb-3">${esc(tr("pricing.trialBadge"))}</p>
            <div class="owner-pricing-grid">
              ${PRICING_PLANS.map(planCardHtml).join("")}
              ${storageAsideHtml()}
            </div>
            <p class="small text-muted mt-3 mb-0">${esc(tr("pricing.renewRedirectHint", { site: "kalpanik.in" }))}</p>
          </div>
          <div class="modal-footer border-0 pt-0">
            <a class="btn btn-outline-secondary" href="${esc(KALPANIK_SITE_URL)}" target="_blank" rel="noopener noreferrer">${esc(tr("pricing.visitWebsite"))}</a>
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">${esc(tr("common.close"))}</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function loadRenewalContext() {
  if (!apiFn) return null;
  if (cachedRenewalContext) return cachedRenewalContext;
  try {
    cachedRenewalContext = await apiFn("/api/company/renewal-context");
    return cachedRenewalContext;
  } catch (err) {
    showToastFn?.(err.message || tr("pricing.couldNotLoad"), "danger");
    return null;
  }
}

export function invalidateRenewalContextCache() {
  cachedRenewalContext = null;
}

/**
 * @param {{ planId?: string, months?: number, extraGb?: number }} [opts]
 */
export async function openKalpanikRenew(opts = {}) {
  const ctx = await loadRenewalContext();
  if (!ctx) return;
  const url = buildKalpanikRenewUrl({
    instance: ctx.instance,
    site: ctx.site,
    company: ctx.companyName,
    email: ctx.email,
    phone: ctx.phone,
    users: ctx.userCount,
    trialEnd: ctx.trialEndDate?.slice?.(0, 10) || ctx.trialEndYmd,
    plan: opts.planId || "",
    months: opts.months ?? 1,
    extraGb: opts.extraGb ?? 0,
  });
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openOwnerPricingModal() {
  const modalEl = document.getElementById("ownerPricingModal");
  if (!modalEl) return;
  void loadRenewalContext();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

export function wireOwnerPricingModal() {
  const modalEl = document.getElementById("ownerPricingModal");
  if (!modalEl || modalEl.dataset.wired === "1") return;
  modalEl.dataset.wired = "1";
  modalEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-renew-plan]");
    if (!btn) return;
    const planId = btn.getAttribute("data-renew-plan") || "";
    void openKalpanikRenew({ planId });
  });
}

/** Compact CTA used in banners / trial cards */
export function ownerPricingCtaHtml({ renewOnly = false, variant = "banner" } = {}) {
  const outline = variant === "card" ? "btn-outline-primary" : "btn-outline-light";
  const solid = variant === "card" ? "btn-primary" : "btn-light";
  if (renewOnly) {
    return `<button type="button" class="btn btn-sm ${solid} owner-pricing-cta-btn js-open-kalpanik-renew">${esc(tr("pricing.renewNow"))}</button>`;
  }
  return `<span class="owner-pricing-cta-group">
    <button type="button" class="btn btn-sm ${outline} owner-pricing-cta-btn js-open-owner-pricing">${esc(tr("pricing.viewPlans"))}</button>
    <button type="button" class="btn btn-sm ${solid} owner-pricing-cta-btn js-open-kalpanik-renew">${esc(tr("pricing.renewNow"))}</button>
  </span>`;
}

export function wireOwnerPricingCtas(root = document) {
  root.querySelectorAll(".js-open-owner-pricing").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      void openOwnerPricingModal();
    });
  });
  root.querySelectorAll(".js-open-kalpanik-renew").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      void openKalpanikRenew();
    });
  });
}
