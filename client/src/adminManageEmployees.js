import * as bootstrap from "bootstrap";
import { tr, dateLocale } from "./i18n/index.js";
import { dt } from "./i18n/contentTranslate.js";
import { formatStorageBytes } from "./adminSettings.js";

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

/** @type {(() => { id?: string, isOwner?: boolean, isAdmin?: boolean } | null) | null} */
let getCurrentUserFn = null;

/** @type {string | null} */
let viewingEmployeeId = null;

/** @type {string | null} */
let transferringFromId = null;

export function initManageEmployees({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  wireOwnerChromeHeader,
  showToast,
  getCurrentUser,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
  showToastFn = showToast ?? null;
  getCurrentUserFn = getCurrentUser ?? null;
}

function formatMemberSince(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "—";
  }
}

function employeeRoleLabel(profile) {
  if (profile?.isOwner) return tr("owner.ownerBadge");
  if (profile?.isAdmin) return tr("common.admin");
  return tr("common.employee");
}

function docViewRow(label, file, emptyText) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (file?.url) {
    return `<div class="profile-doc-row">
      <span class="profile-doc-row-label">${esc(label)}</span>
      <a class="profile-doc-view-link" href="${esc(file.url)}" target="_blank" rel="noopener noreferrer">${esc(file.originalName || tr("profile.viewDocument"))}</a>
    </div>`;
  }
  return `<div class="profile-doc-row">
    <span class="profile-doc-row-label">${esc(label)}</span>
    <span class="profile-doc-row-empty">${esc(emptyText)}</span>
  </div>`;
}

export function employeeProfileModalHtml() {
  return `
    <div class="modal fade profile-modal" id="employeeProfileModal" tabindex="-1" aria-labelledby="employeeProfileModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered profile-modal-dialog">
        <div class="modal-content profile-modal-card">
          <form id="employee-profile-form" class="profile-modal-form">
            <div class="modal-header profile-modal-header">
              <h2 class="modal-title h5 mb-0" id="employeeProfileModalTitle">${tr("profile.employeeProfile")}</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
            </div>
            <div class="modal-body profile-modal-body">
              <p class="small text-muted mb-3" id="employee-profile-intro">${tr("profile.adminViewEmployeeIntro")}</p>
              <div class="mb-3">
                <label class="form-label">${tr("profile.fullName")}</label>
                <input type="text" class="form-control" id="employee-profile-name" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label">${tr("common.email")}</label>
                <input type="email" class="form-control" id="employee-profile-email" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label">${tr("common.phone")}</label>
                <input type="tel" class="form-control" id="employee-profile-phone" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label">${tr("profile.roleLabel")}</label>
                <input type="text" class="form-control" id="employee-profile-role" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label" for="employee-profile-salary">${tr("profile.salary")}</label>
                <div class="input-group">
                  <span class="input-group-text">₹</span>
                  <input type="number" class="form-control" id="employee-profile-salary" min="0" step="1" required />
                </div>
              </div>
              <div class="profile-documents-card mb-3" id="employee-profile-documents-card">
                <div class="profile-documents-card-head">
                  <h3 class="profile-documents-title h6 mb-0">${tr("profile.profileDocuments")}</h3>
                  <span class="profile-documents-status profile-documents-status--incomplete" id="employee-profile-documents-status">${tr("profile.sectionIncompleteTitle")}</span>
                </div>
                <p class="small text-muted mb-2">${tr("profile.profileDocumentsIntro")}</p>
                <div id="employee-profile-doc-rows"></div>
              </div>
              <div id="employee-profile-storage" class="mb-3"></div>
              <p class="small text-muted mb-0" id="employee-profile-member-since"></p>
            </div>
            <div class="modal-footer profile-modal-footer">
              <button type="button" class="profile-modal-btn-cancel" data-bs-dismiss="modal">${tr("common.cancel")}</button>
              <button type="submit" class="profile-modal-btn-save" id="employee-profile-save">${tr("common.save")}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    ${transferWorkModalHtml()}`;
}

function fillEmployeeProfileModal(profile) {
  document.getElementById("employeeProfileModalTitle").textContent = tr("profile.employeeProfileFor", {
    name: profile.displayName,
  });
  document.getElementById("employee-profile-name").value = profile.displayName || "";
  document.getElementById("employee-profile-email").value = profile.email || "";
  document.getElementById("employee-profile-phone").value = profile.phone || "—";
  document.getElementById("employee-profile-role").value = employeeRoleLabel(profile);
  document.getElementById("employee-profile-salary").value = String(profile.salary ?? 15000);

  const docRows = document.getElementById("employee-profile-doc-rows");
  if (docRows) {
    docRows.innerHTML = [
      docViewRow(tr("profile.profilePhoto"), profile.profilePhoto, tr("profile.noProfilePhoto")),
      docViewRow(tr("profile.idProof"), profile.idProof, tr("profile.noIdProof")),
    ].join("");
  }

  const statusEl = document.getElementById("employee-profile-documents-status");
  const cardEl = document.getElementById("employee-profile-documents-card");
  if (statusEl) {
    const complete = Boolean(profile.profileDocumentsComplete);
    statusEl.textContent = complete ? tr("profile.documentsComplete") : tr("profile.sectionIncompleteTitle");
    statusEl.classList.toggle("profile-documents-status--complete", complete);
    statusEl.classList.toggle("profile-documents-status--incomplete", !complete);
    cardEl?.classList.toggle("profile-documents-card--incomplete", !complete);
  }

  const since = formatMemberSince(profile.createdAt);
  document.getElementById("employee-profile-member-since").textContent = since
    ? tr("profile.memberSince", { date: since })
    : "";

  const storageHost = document.getElementById("employee-profile-storage");
  if (storageHost) {
    storageHost.innerHTML = `<p class="small text-muted mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>`;
  }
}

export async function openEmployeeProfileModal(userId) {
  const modalEl = document.getElementById("employeeProfileModal");
  if (!modalEl || !apiFn) return;
  viewingEmployeeId = userId;
  try {
    const [{ profile }, storageRes] = await Promise.all([
      apiFn(`/api/users/${userId}/profile`),
      apiFn(`/api/users/${userId}/storage`).catch(() => null),
    ]);
    fillEmployeeProfileModal(profile);
    const storageHost = document.getElementById("employee-profile-storage");
    if (storageHost && storageRes?.storage) {
      const s = storageRes.storage;
      const used = formatStorageBytes(s.usedBytes);
      const quota = formatStorageBytes(s.quotaBytes || 1024 * 1024 * 1024);
      storageHost.innerHTML = `<p class="small mb-0${s.overQuota ? " text-danger fw-semibold" : " text-muted"}">${escapeHtmlFn?.(
        `${tr("settings.storageTitle")}: ${tr("settings.storageUsedShort", { used, quota })}`
      )}</p>`;
    } else if (storageHost) {
      storageHost.innerHTML = "";
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  } catch (err) {
    showToastFn?.(err.message || tr("profile.couldNotLoad"), "danger");
  }
}

async function saveEmployeeProfile(e) {
  e.preventDefault();
  if (!viewingEmployeeId || !apiFn) return;
  const saveBtn = document.getElementById("employee-profile-save");
  const salaryEl = document.getElementById("employee-profile-salary");
  const salary = Number.parseInt(salaryEl?.value ?? "", 10);
  if (!Number.isFinite(salary) || salary < 0) {
    showToastFn?.(tr("profile.salaryInvalid"), "warning");
    salaryEl?.focus();
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    const { profile } = await apiFn(`/api/users/${viewingEmployeeId}/profile`, {
      method: "PATCH",
      body: JSON.stringify({ salary }),
    });
    fillEmployeeProfileModal(profile);
    bootstrap.Modal.getInstance(document.getElementById("employeeProfileModal"))?.hide();
    showToastFn?.(tr("profile.saved"), "success");
    if (document.querySelector(".manage-employees-page")) {
      void renderManageEmployeesList();
    }
  } catch (err) {
    showToastFn?.(err.message || tr("profile.couldNotSave"), "danger");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function wireEmployeeProfileModal() {
  const form = document.getElementById("employee-profile-form");
  if (form && form.dataset.wired !== "1") {
    form.dataset.wired = "1";
    form.addEventListener("submit", (e) => {
      void saveEmployeeProfile(e);
    });
    document.getElementById("employeeProfileModal")?.addEventListener("hidden.bs.modal", () => {
      viewingEmployeeId = null;
    });
  }
  wireTransferWorkModal();
}

function wireTransferWorkModal() {
  const modalEl = document.getElementById("transferWorkModal");
  const submitBtn = document.getElementById("transfer-work-submit");
  if (!modalEl || !submitBtn || submitBtn.dataset.wired === "1") return;
  submitBtn.dataset.wired = "1";
  submitBtn.addEventListener("click", () => {
    void submitTransferWork();
  });
  modalEl.addEventListener("hidden.bs.modal", () => {
    transferringFromId = null;
  });
}

async function openTransferWorkModal(userId) {
  const modalEl = document.getElementById("transferWorkModal");
  if (!modalEl || !apiFn || !userId) return;
  transferringFromId = userId;
  const intro = document.getElementById("transfer-work-intro");
  const summary = document.getElementById("transfer-work-summary");
  const submittedNote = document.getElementById("transfer-work-submitted-note");
  const select = document.getElementById("transfer-work-to");
  const wrap = document.getElementById("transfer-work-to-wrap");
  const submitBtn = document.getElementById("transfer-work-submit");
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));

  if (intro) intro.textContent = tr("common.loading");
  if (summary) summary.textContent = "";
  if (submittedNote) submittedNote.textContent = "";
  if (select) select.innerHTML = "";
  if (submitBtn) submitBtn.disabled = true;

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    const preview = await apiFn(`/api/users/${userId}/transfer-preview`);
    const fromName = preview?.from?.displayName || preview?.from?.email || tr("common.employee");
    if (intro) intro.textContent = tr("owner.transferWorkIntro", { name: fromName });
    const openCount = Number(preview?.openCount) || 0;
    if (summary) {
      summary.textContent =
        openCount > 0
          ? tr("owner.transferWorkSummary", { count: openCount })
          : tr("owner.transferWorkSummaryNone");
    }
    const submittedCount = Number(preview?.submittedCount) || 0;
    if (submittedNote) {
      submittedNote.textContent =
        submittedCount > 0
          ? tr("owner.transferWorkSubmittedNote", { count: submittedCount, name: fromName })
          : "";
    }
    const users = preview?.users ?? [];
    if (!users.length) {
      if (wrap) wrap.classList.add("d-none");
      if (summary) summary.textContent = tr("owner.transferWorkNoTeammates");
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    if (wrap) wrap.classList.remove("d-none");
    if (select) {
      select.innerHTML = [
        `<option value="">${esc(tr("owner.transferWorkChoose"))}</option>`,
        ...users.map(
          (u) =>
            `<option value="${esc(u.id)}">${esc(u.displayName || u.email)} — ${esc(u.email)}</option>`
        ),
      ].join("");
    }
    if (submitBtn) submitBtn.disabled = openCount === 0;
  } catch (err) {
    if (intro) intro.textContent = err.message || tr("owner.transferWorkFailed");
    if (submitBtn) submitBtn.disabled = true;
  }
}

async function submitTransferWork() {
  if (!apiFn || !transferringFromId) return;
  const select = document.getElementById("transfer-work-to");
  const toUserId = select?.value || "";
  const submitBtn = document.getElementById("transfer-work-submit");
  if (!toUserId) {
    showToastFn?.(tr("owner.transferWorkChoose"), "warning");
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await apiFn(`/api/users/${transferringFromId}/transfer-work`, {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    });
    const fromName = result?.from?.displayName || result?.from?.email || tr("common.employee");
    const toName = result?.to?.displayName || result?.to?.email || tr("common.employee");
    const count = Number(result?.transferred) || 0;
    showToastFn?.(
      count > 0
        ? tr("owner.transferWorkSuccess", { count, from: fromName, to: toName })
        : tr("owner.transferWorkSuccessNone", { from: fromName }),
      "success"
    );
    bootstrap.Modal.getInstance(document.getElementById("transferWorkModal"))?.hide();
    transferringFromId = null;
  } catch (err) {
    showToastFn?.(err.message || tr("owner.transferWorkFailed"), "danger");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function transferWorkModalHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `
    <div class="modal fade profile-modal" id="transferWorkModal" tabindex="-1" aria-labelledby="transferWorkModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered profile-modal-dialog">
        <div class="modal-content profile-modal-card">
          <div class="modal-header profile-modal-header">
            <h2 class="modal-title h5 mb-0" id="transferWorkModalTitle">${esc(tr("owner.transferWorkTitle"))}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${esc(tr("common.close"))}"></button>
          </div>
          <div class="modal-body profile-modal-body">
            <p class="small text-muted mb-3" id="transfer-work-intro"></p>
            <p class="small mb-2" id="transfer-work-summary"></p>
            <p class="small text-muted mb-3" id="transfer-work-submitted-note"></p>
            <div class="mb-0" id="transfer-work-to-wrap">
              <label class="form-label" for="transfer-work-to">${esc(tr("owner.transferWorkTo"))}</label>
              <select class="form-select" id="transfer-work-to"></select>
            </div>
          </div>
          <div class="modal-footer profile-modal-footer">
            <button type="button" class="profile-modal-btn-cancel" data-bs-dismiss="modal">${esc(tr("common.cancel"))}</button>
            <button type="button" class="profile-modal-btn-save" id="transfer-work-submit">${esc(tr("owner.transferWorkConfirm"))}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function canTransferWork(user) {
  const me = getCurrentUserFn?.();
  if (!me?.id || !user?.id) return false;
  if (user.id === me.id) return false;
  return true;
}

function canDeleteEmployee(user) {
  const me = getCurrentUserFn?.();
  if (!me?.id || !user?.id) return false;
  if (user.id === me.id) return false;
  if (user.isOwner) return false;
  if (user.isAdmin && !me.isOwner) return false;
  return true;
}

function employeeRowHtml(user, storage = null) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const badges = [];
  if (user.isOwner) badges.push(`<span class="manage-employee-badge manage-employee-badge--owner">${esc(tr("owner.ownerBadge"))}</span>`);
  else if (user.isAdmin) badges.push(`<span class="manage-employee-badge manage-employee-badge--admin">${esc(tr("common.admin"))}</span>`);

  let storageHtml = "";
  if (storage) {
    const used = formatStorageBytes(storage.usedBytes);
    const quota = formatStorageBytes(storage.quotaBytes || 1024 * 1024 * 1024);
    const overClass = storage.overQuota ? " manage-employee-storage--over" : "";
    storageHtml = `<span class="manage-employee-storage${overClass}">${esc(
      tr("settings.storageUsedShort", { used, quota })
    )}</span>`;
  }

  const transferBtn = canTransferWork(user)
    ? `<button type="button" class="btn btn-sm btn-outline-primary manage-employee-transfer-btn" data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || user.email)}">${esc(tr("owner.transferWork"))}</button>`
    : "";
  const deleteBtn = canDeleteEmployee(user)
    ? `<button type="button" class="btn btn-sm btn-outline-danger manage-employee-delete-btn" data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || user.email)}">${esc(tr("owner.deleteEmployee"))}</button>`
    : "";

  return `<div class="admin-settings-row manage-employee-row">
    <span class="manage-employee-row-left">
      ${adminMsIconFn?.("person") ?? ""}
      <span class="admin-settings-row-label">
        <span class="manage-employee-name">${esc(dt(user.displayName))}</span>
        <span class="manage-employee-email">${esc(user.email)}</span>
        ${storageHtml}
        ${badges.join("")}
      </span>
    </span>
    <span class="manage-employee-actions">
      <button type="button" class="btn btn-sm btn-outline-primary manage-employee-view-btn" data-user-id="${esc(user.id)}">${esc(tr("profile.viewProfile"))}</button>
      ${transferBtn}
      ${deleteBtn}
    </span>
  </div>`;
}

async function deleteEmployee(userId, displayName) {
  if (!apiFn || !userId) return;
  const name = displayName || tr("common.employee");
  if (!window.confirm(tr("owner.deleteEmployeeConfirm", { name }))) return;
  try {
    await apiFn(`/api/users/${userId}`, { method: "DELETE" });
    showToastFn?.(tr("owner.deleteEmployeeSuccess", { name }), "success");
    if (viewingEmployeeId === userId) {
      bootstrap.Modal.getInstance(document.getElementById("employeeProfileModal"))?.hide();
      viewingEmployeeId = null;
    }
    void renderManageEmployeesList();
  } catch (err) {
    showToastFn?.(err.message || tr("owner.deleteEmployeeFailed"), "danger");
  }
}

async function renderManageEmployeesList() {
  const host = document.querySelector(".manage-employees-list");
  if (!host || !apiFn) return;
  host.innerHTML = `<p class="admin-settings-intro mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? tr("common.loading")}</p>`;
  try {
    const [{ users }, storagePayload] = await Promise.all([
      apiFn("/api/users/team"),
      apiFn("/api/users/storage/team").catch(() => null),
    ]);
    if (!users.length) {
      host.innerHTML = `<p class="admin-settings-intro mb-0">${escapeHtmlFn?.(tr("modals.noTeamMembers")) ?? ""}</p>`;
      return;
    }
    const byUserId = storagePayload?.byUserId || {};
    host.innerHTML = users.map((u) => employeeRowHtml(u, byUserId[u.id] || null)).join("");
    host.querySelectorAll(".manage-employee-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-id");
        if (id) void openEmployeeProfileModal(id);
      });
    });
    host.querySelectorAll(".manage-employee-transfer-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-id");
        if (id) void openTransferWorkModal(id);
      });
    });
    host.querySelectorAll(".manage-employee-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name") || "";
        if (id) void deleteEmployee(id, name);
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="admin-settings-intro text-danger mb-0">${escapeHtmlFn?.(err.message) ?? err.message}</p>`;
  }
}

function manageEmployeesPageHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const chromeHeader = ownerChromeHeaderFn?.() ?? "";
  return `<div class="admin-main-scroll d-flex flex-column">
    ${chromeHeader}
    <div class="admin-settings-page manage-employees-page">
      <p class="admin-settings-intro">${esc(tr("owner.manageEmployeesIntro"))}</p>
      <div class="admin-settings-list manage-employees-list"></div>
    </div>
  </div>`;
}

export function openOwnerManageEmployeesView() {
  const main = document.getElementById("main-column");
  if (!main) return;
  main.innerHTML = manageEmployeesPageHtml();
  wireOwnerChromeHeaderFn?.(main);
  void renderManageEmployeesList();
}
