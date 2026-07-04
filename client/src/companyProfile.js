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

export function shouldShowCompanyProfileSection(user, profileEditUserId) {
  return Boolean(user?.isOwner && !profileEditUserId);
}

function stateOptionsHtml(selected = "") {
  const sel = String(selected || "");
  const opts = [`<option value="">${tr("profile.companySelectState")}</option>`];
  for (const st of INDIAN_STATES) {
    opts.push(
      `<option value="${escapeAttr(st)}"${st === sel ? " selected" : ""}>${escapeHtml(st)}</option>`
    );
  }
  if (sel && !INDIAN_STATES.includes(sel)) {
    opts.push(`<option value="${escapeAttr(sel)}" selected>${escapeHtml(sel)}</option>`);
  }
  return opts.join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export function companyProfileSectionHtml() {
  return `
    <div id="my-company-profile-section" class="d-none border-top pt-4 mt-2">
      <h3 class="h6 fw-semibold mb-1">${tr("profile.myCompanyDetails")}</h3>
      <p class="small text-muted mb-3">${tr("profile.myCompanyDetailsIntro")}</p>
      <div class="mb-3">
        <label class="form-label" for="company-name">${tr("profile.companyName")}</label>
        <input type="text" class="form-control" id="company-name" maxlength="200" autocomplete="organization" />
      </div>
      <div class="mb-3">
        <label class="form-label" for="company-address">${tr("profile.companyAddress")}</label>
        <textarea class="form-control" id="company-address" rows="3" maxlength="5000" autocomplete="street-address"></textarea>
      </div>
      <div class="mb-3">
        <label class="form-label" for="company-state">${tr("profile.companyState")}</label>
        <select class="form-select" id="company-state" aria-label="${tr("profile.companyState")}">
          ${stateOptionsHtml()}
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label" for="company-gst">${tr("profile.gstNumber")}</label>
        <input type="text" class="form-control text-uppercase" id="company-gst" maxlength="32" placeholder="${tr("profile.gstPlaceholder")}" />
      </div>
      <div class="mb-3">
        <label class="form-label">${tr("profile.gstCertificate")}</label>
        <p class="small text-muted mb-2">${tr("profile.gstCertificateHint")}</p>
        <input type="file" class="d-none" id="company-gst-file" accept="application/pdf,image/jpeg,image/png,image/webp" />
        <div class="d-flex flex-wrap align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-primary" id="company-gst-pick">${tr("profile.uploadGstCertificate")}</button>
          <button type="button" class="btn btn-sm btn-outline-danger d-none" id="company-gst-remove">${tr("profile.removeGstCertificate")}</button>
        </div>
        <p class="small mb-0 mt-2" id="company-gst-file-label" aria-live="polite"></p>
        <a class="small d-none mt-1" id="company-gst-view" href="#" target="_blank" rel="noopener noreferrer">${tr("profile.viewGstCertificate")}</a>
      </div>
      <h4 class="h6 fw-semibold mt-4 mb-2">${tr("profile.directorDetails")}</h4>
      <div class="row g-2 mb-3">
        <div class="col-md-6">
          <label class="form-label" for="director-name">${tr("profile.directorName")}</label>
          <input type="text" class="form-control" id="director-name" maxlength="120" autocomplete="name" />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="director-phone">${tr("common.phone")}</label>
          <input type="tel" class="form-control" id="director-phone" inputmode="numeric" maxlength="10" pattern="\\d{10}" autocomplete="tel" />
        </div>
        <div class="col-12">
          <label class="form-label" for="director-email">${tr("common.email")}</label>
          <input type="email" class="form-control" id="director-email" maxlength="191" autocomplete="email" />
        </div>
        <div class="col-12">
          <label class="form-label" for="director-details">${tr("profile.directorExtraDetails")}</label>
          <textarea class="form-control" id="director-details" rows="2" maxlength="5000" placeholder="${tr("profile.directorExtraDetailsPlaceholder")}"></textarea>
        </div>
      </div>
      <h4 class="h6 fw-semibold mt-4 mb-2">${tr("profile.contactPerson2")}</h4>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label" for="contact2-name">${tr("profile.contactName")}</label>
          <input type="text" class="form-control" id="contact2-name" maxlength="120" autocomplete="name" />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="contact2-phone">${tr("common.phone")}</label>
          <input type="tel" class="form-control" id="contact2-phone" inputmode="numeric" maxlength="10" pattern="\\d{10}" autocomplete="tel" />
        </div>
        <div class="col-12">
          <label class="form-label" for="contact2-email">${tr("common.email")}</label>
          <input type="email" class="form-control" id="contact2-email" maxlength="191" autocomplete="email" />
        </div>
      </div>
    </div>`;
}

export function syncCompanyProfileSectionVisibility(user, profileEditUserId) {
  const section = document.getElementById("my-company-profile-section");
  if (!section) return;
  section.classList.toggle("d-none", !shouldShowCompanyProfileSection(user, profileEditUserId));
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

export async function saveCompanyProfileFromForm(api, showToast) {
  const body = readCompanyProfileFormBody();
  const err = validateCompanyProfileBody(body);
  if (err) {
    showToast(err, "warning");
    throw new Error(err);
  }
  const { profile } = await api("/api/company/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  fillCompanyProfileForm(profile);
  return profile;
}

export function wireCompanyProfileGstUpload({ api, showToast }) {
  const pickBtn = document.getElementById("company-gst-pick");
  const fileInput = document.getElementById("company-gst-file");
  const removeBtn = document.getElementById("company-gst-remove");
  if (!pickBtn || !fileInput || pickBtn.dataset.wired === "1") return;
  pickBtn.dataset.wired = "1";

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
      showToast(tr("profile.gstCertificateUploaded"), "success");
    } catch (err) {
      showToast(err.message || tr("profile.gstUploadFailed"), "danger");
    } finally {
      pickBtn.disabled = false;
    }
  });

  removeBtn?.addEventListener("click", async () => {
    if (!window.confirm(tr("profile.removeGstCertificateConfirm"))) return;
    removeBtn.disabled = true;
    try {
      const { profile } = await api("/api/company/gst-certificate", { method: "DELETE" });
      fillCompanyProfileForm(profile);
      showToast(tr("profile.gstCertificateRemoved"), "success");
    } catch (err) {
      showToast(err.message || tr("profile.gstRemoveFailed"), "danger");
    } finally {
      removeBtn.disabled = false;
    }
  });
}

export async function loadCompanyProfileForModal(api) {
  const { profile } = await api("/api/company/profile");
  fillCompanyProfileForm(profile);
  return profile;
}
