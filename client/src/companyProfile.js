import { tr } from "./i18n/index.js";

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((s: string) => string) | null} */
let escapeHtmlFn = null;

/** @type {((name: string, extraClass?: string) => string) | null} */
let adminMsIconFn = null;

/** @type {(() => string) | null} */
let ownerChromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireOwnerChromeHeaderFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

export function initCompanyProfile({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  wireOwnerChromeHeader,
  showToast,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
  showToastFn = showToast ?? null;
}

function stateOptionsHtml(selected = "") {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const sel = String(selected || "");
  const opts = [`<option value="">${esc(tr("profile.companySelectState"))}</option>`];
  for (const st of INDIAN_STATES) {
    opts.push(
      `<option value="${esc(st)}"${st === sel ? " selected" : ""}>${esc(st)}</option>`
    );
  }
  if (sel && !INDIAN_STATES.includes(sel)) {
    opts.push(`<option value="${esc(sel)}" selected>${esc(sel)}</option>`);
  }
  return opts.join("");
}

function companyProfilePageHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const chromeHeader = ownerChromeHeaderFn?.() ?? "";
  return `<div class="admin-main-scroll d-flex flex-column">
    ${chromeHeader}
    <div class="admin-company-profile-page">
      <p class="admin-company-profile-intro">${esc(tr("profile.myCompanyDetailsIntro"))}</p>
      <form id="company-profile-form" class="admin-company-profile-form" novalidate>
        <section class="admin-company-profile-card" aria-labelledby="company-info-heading">
          <h2 class="admin-company-profile-card-title" id="company-info-heading">${esc(tr("profile.companyInformation"))}</h2>
          <div class="admin-company-profile-grid">
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label" for="company-name">${esc(tr("profile.companyName"))}</label>
              <input type="text" class="admin-task-modal-input" id="company-name" maxlength="200" autocomplete="organization" />
            </div>
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label" for="company-address">${esc(tr("profile.companyAddress"))}</label>
              <textarea class="admin-task-modal-textarea" id="company-address" rows="3" maxlength="5000" autocomplete="street-address"></textarea>
            </div>
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="company-state">${esc(tr("profile.companyState"))}</label>
              <div class="admin-task-modal-select-wrap">
                <select class="admin-task-modal-select" id="company-state" aria-label="${esc(tr("profile.companyState"))}">
                  ${stateOptionsHtml()}
                </select>
                ${adminMsIconFn?.("expand_more", "admin-task-modal-select-chevron") ?? ""}
              </div>
            </div>
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="company-gst">${esc(tr("profile.gstNumber"))}</label>
              <input type="text" class="admin-task-modal-input text-uppercase" id="company-gst" maxlength="32" placeholder="${esc(tr("profile.gstPlaceholder"))}" />
            </div>
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label">${esc(tr("profile.gstCertificate"))}</label>
              <p class="admin-task-modal-field-hint mb-2">${esc(tr("profile.gstCertificateHint"))}</p>
              <input type="file" class="d-none" id="company-gst-file" accept="application/pdf,image/jpeg,image/png,image/webp" />
              <div class="admin-company-profile-gst-actions">
                <button type="button" class="admin-task-modal-btn-secondary" id="company-gst-pick">${esc(tr("profile.uploadGstCertificate"))}</button>
                <button type="button" class="admin-task-modal-btn-secondary admin-company-profile-gst-remove d-none" id="company-gst-remove">${esc(tr("profile.removeGstCertificate"))}</button>
              </div>
              <p class="admin-company-profile-gst-label mb-0 mt-2" id="company-gst-file-label" aria-live="polite"></p>
              <a class="admin-company-profile-gst-view d-none mt-1" id="company-gst-view" href="#" target="_blank" rel="noopener noreferrer">${esc(tr("profile.viewGstCertificate"))}</a>
            </div>
          </div>
        </section>
        <section class="admin-company-profile-card" aria-labelledby="director-heading">
          <h2 class="admin-company-profile-card-title" id="director-heading">${esc(tr("profile.directorDetails"))}</h2>
          <div class="admin-company-profile-grid">
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="director-name">${esc(tr("profile.directorName"))}</label>
              <input type="text" class="admin-task-modal-input" id="director-name" maxlength="120" autocomplete="name" />
            </div>
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="director-phone">${esc(tr("common.phone"))}</label>
              <input type="tel" class="admin-task-modal-input" id="director-phone" inputmode="numeric" maxlength="10" pattern="\\d{10}" autocomplete="tel" />
            </div>
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label" for="director-email">${esc(tr("common.email"))}</label>
              <input type="email" class="admin-task-modal-input" id="director-email" maxlength="191" autocomplete="email" />
            </div>
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label" for="director-details">${esc(tr("profile.directorExtraDetails"))}</label>
              <textarea class="admin-task-modal-textarea" id="director-details" rows="2" maxlength="5000" placeholder="${esc(tr("profile.directorExtraDetailsPlaceholder"))}"></textarea>
            </div>
          </div>
        </section>
        <section class="admin-company-profile-card" aria-labelledby="contact2-heading">
          <h2 class="admin-company-profile-card-title" id="contact2-heading">${esc(tr("profile.contactPerson2"))}</h2>
          <div class="admin-company-profile-grid">
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="contact2-name">${esc(tr("profile.contactName"))}</label>
              <input type="text" class="admin-task-modal-input" id="contact2-name" maxlength="120" autocomplete="name" />
            </div>
            <div class="admin-company-profile-field">
              <label class="admin-task-modal-field-label" for="contact2-phone">${esc(tr("common.phone"))}</label>
              <input type="tel" class="admin-task-modal-input" id="contact2-phone" inputmode="numeric" maxlength="10" pattern="\\d{10}" autocomplete="tel" />
            </div>
            <div class="admin-company-profile-field admin-company-profile-field--full">
              <label class="admin-task-modal-field-label" for="contact2-email">${esc(tr("common.email"))}</label>
              <input type="email" class="admin-task-modal-input" id="contact2-email" maxlength="191" autocomplete="email" />
            </div>
          </div>
        </section>
        <div class="admin-company-profile-actions">
          <button type="submit" class="admin-task-modal-btn-save" id="company-profile-save">${esc(tr("common.save"))}</button>
        </div>
      </form>
    </div>
  </div>`;
}

export function fillCompanyProfileForm(profile) {
  const p = profile || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };
  set("company-name", p.companyName);
  set("company-address", p.companyAddress);
  const stateEl = document.getElementById("company-state");
  if (stateEl) {
    stateEl.innerHTML = stateOptionsHtml(p.companyState || "");
  }
  set("company-gst", p.gstNumber);
  set("director-name", p.directorName);
  set("director-email", p.directorEmail);
  set("director-phone", p.directorPhone);
  set("director-details", p.directorDetails);
  set("contact2-name", p.contactPerson2Name);
  set("contact2-email", p.contactPerson2Email);
  set("contact2-phone", p.contactPerson2Phone);
  updateGstCertificateUi(p.gstCertificate);
}

function updateGstCertificateUi(cert) {
  const label = document.getElementById("company-gst-file-label");
  const view = document.getElementById("company-gst-view");
  const removeBtn = document.getElementById("company-gst-remove");
  if (cert?.url) {
    if (label) label.textContent = cert.originalName || tr("profile.gstCertificateOnFile");
    if (view) {
      view.href = cert.url;
      view.classList.remove("d-none");
    }
    removeBtn?.classList.remove("d-none");
  } else {
    if (label) label.textContent = tr("profile.noGstCertificate");
    view?.classList.add("d-none");
    removeBtn?.classList.add("d-none");
  }
}

export function readCompanyProfileFormBody() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? "";
  return {
    companyName: val("company-name") || null,
    companyAddress: val("company-address") || null,
    companyState: val("company-state") || null,
    gstNumber: val("company-gst").toUpperCase() || null,
    directorName: val("director-name") || null,
    directorEmail: val("director-email") || null,
    directorPhone: val("director-phone") || null,
    directorDetails: val("director-details") || null,
    contactPerson2Name: val("contact2-name") || null,
    contactPerson2Email: val("contact2-email") || null,
    contactPerson2Phone: val("contact2-phone") || null,
  };
}

function validateCompanyProfileBody(body) {
  const phoneFields = [
    ["directorPhone", tr("profile.directorName")],
    ["contactPerson2Phone", tr("profile.contactPerson2")],
  ];
  for (const [key, label] of phoneFields) {
    const v = body[key];
    if (v && !/^\d{10}$/.test(v)) {
      return tr("profile.phoneInvalidFor", { label });
    }
  }
  return null;
}

export async function saveCompanyProfileFromForm() {
  if (!apiFn) throw new Error(tr("profile.couldNotSave"));
  const body = readCompanyProfileFormBody();
  const err = validateCompanyProfileBody(body);
  if (err) {
    showToastFn?.(err, "warning");
    throw new Error(err);
  }
  const { profile } = await apiFn("/api/company/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  fillCompanyProfileForm(profile);
  return profile;
}

function wireCompanyProfileGstUpload(root) {
  const pickBtn = root.querySelector("#company-gst-pick");
  const fileInput = root.querySelector("#company-gst-file");
  const removeBtn = root.querySelector("#company-gst-remove");
  if (!pickBtn || !fileInput) return;

  pickBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    pickBtn.disabled = true;
    try {
      let res;
      try {
        res = await fetch("/api/company/gst-certificate", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } catch {
        throw new Error(tr("profile.gstUploadFailed"));
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || tr("profile.gstUploadFailed"));
      fillCompanyProfileForm(data.profile);
      showToastFn?.(tr("profile.gstCertificateUploaded"), "success");
    } catch (err) {
      showToastFn?.(err.message || tr("profile.gstUploadFailed"), "danger");
    } finally {
      pickBtn.disabled = false;
    }
  });

  removeBtn?.addEventListener("click", async () => {
    if (!window.confirm(tr("profile.removeGstCertificateConfirm"))) return;
    removeBtn.disabled = true;
    try {
      const { profile } = await apiFn("/api/company/gst-certificate", { method: "DELETE" });
      fillCompanyProfileForm(profile);
      showToastFn?.(tr("profile.gstCertificateRemoved"), "success");
    } catch (err) {
      showToastFn?.(err.message || tr("profile.gstRemoveFailed"), "danger");
    } finally {
      removeBtn.disabled = false;
    }
  });
}

function wireCompanyProfilePage(main) {
  const form = main.querySelector("#company-profile-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const saveBtn = main.querySelector("#company-profile-save");
    if (saveBtn) saveBtn.disabled = true;
    void saveCompanyProfileFromForm()
      .then(() => {
        showToastFn?.(tr("profile.companyProfileSaved"), "success");
      })
      .catch((err) => {
        const validationErr = validateCompanyProfileBody(readCompanyProfileFormBody());
        if (validationErr) return;
        showToastFn?.(err.message || tr("profile.couldNotSave"), "danger");
      })
      .finally(() => {
        if (saveBtn) saveBtn.disabled = false;
      });
  });

  wireCompanyProfileGstUpload(main);
}

async function loadCompanyProfilePage() {
  if (!apiFn) return;
  try {
    const { profile } = await apiFn("/api/company/profile");
    fillCompanyProfileForm(profile);
    return profile;
  } catch {
    fillCompanyProfileForm({});
    return null;
  }
}

export function openOwnerCompanyProfileView() {
  const main = document.getElementById("main-column");
  if (!main) return;

  main.innerHTML = companyProfilePageHtml();
  wireCompanyProfilePage(main);
  wireOwnerChromeHeaderFn?.(main);
  void loadCompanyProfilePage();
}
