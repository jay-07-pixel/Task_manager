import * as bootstrap from "bootstrap";
import { tr, formatDateTime24 } from "./i18n/index.js";
import { dt } from "./i18n/contentTranslate.js";

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

/** @type {any[]} */
let pendingRequests = [];

/** @type {number | null} */
let pollTimer = null;

const POLL_MS = 30_000;

export function initAdminDeadlineExtensions({
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

export function ownerDeadlineExtensionsNavItemHtml(active = false, pendingCount = 0) {
  const activeClass = active ? " admin-sidebar-nav-item--active" : "";
  const label = tr("deadlineExtensions.navLabel");
  const badge =
    pendingCount > 0
      ? `<span class="admin-nav-badge" aria-label="${escapeHtmlFn?.(tr("deadlineExtensions.pendingCount", { count: pendingCount })) ?? pendingCount}">${pendingCount}</span>`
      : "";
  return `<button type="button" class="admin-sidebar-nav-item js-owner-deadline-extensions-nav${activeClass}">
    <span class="admin-nav-item-left">
      <span class="material-symbols-outlined" aria-hidden="true">event_upcoming</span>
      <span>${escapeHtmlFn?.(label) ?? label}</span>
    </span>
    ${badge}
  </button>`;
}

export async function fetchPendingDeadlineExtensionCount() {
  if (!apiFn) return 0;
  try {
    const data = await apiFn("/api/deadline-extensions");
    return Array.isArray(data?.requests) ? data.requests.length : 0;
  } catch {
    return 0;
  }
}

function taskOverdueDayCount(dueAt) {
  if (!dueAt) return 0;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const diffMs = Date.now() - due.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86_400_000);
}

function formatDue(iso) {
  if (!iso) return "—";
  const formatted = formatDateTime24(iso);
  return formatted || "—";
}

function approveModalHtml() {
  return `
    <div class="modal fade profile-modal" id="deadlineExtensionApproveModal" tabindex="-1" aria-labelledby="deadlineExtensionApproveTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content profile-modal-card">
          <form id="deadline-extension-approve-form" class="profile-modal-form">
            <input type="hidden" id="deadline-extension-approve-id" value="" />
            <div class="modal-header profile-modal-header">
              <h2 class="modal-title h5 mb-0" id="deadlineExtensionApproveTitle">${escapeHtmlFn?.(tr("deadlineExtensions.approveTitle")) ?? "Approve extension"}</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtmlFn?.(tr("common.close")) ?? "Close"}"></button>
            </div>
            <div class="modal-body profile-modal-body">
              <p class="small text-muted mb-3" id="deadline-extension-approve-intro"></p>
              <div class="mb-3">
                <label class="form-label" for="deadline-extension-new-due">${escapeHtmlFn?.(tr("deadlineExtensions.newDeadlineLabel")) ?? "New deadline"} <span class="text-danger">*</span></label>
                <input type="date" class="form-control" id="deadline-extension-new-due" required />
                <div class="form-text">${escapeHtmlFn?.(tr("deadlineExtensions.newDeadlineHint")) ?? ""}</div>
              </div>
              <p class="small text-danger d-none mb-0" id="deadline-extension-approve-error"></p>
            </div>
            <div class="modal-footer profile-modal-footer">
              <button type="button" class="profile-modal-btn-cancel" data-bs-dismiss="modal">${escapeHtmlFn?.(tr("common.cancel")) ?? "Cancel"}</button>
              <button type="submit" class="profile-modal-btn-save" id="deadline-extension-approve-submit">${escapeHtmlFn?.(tr("deadlineExtensions.approveAndUpdate")) ?? "Approve & update deadline"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function requestCardHtml(req) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const employeeName = esc(dt(req.employee?.displayName || tr("common.employee")));
  const taskTitle = esc(dt(req.task?.title || tr("common.task")));
  const overdueDays = taskOverdueDayCount(req.task?.dueAt);
  const overdueLabel = tr("employee.overdueByDays", { count: overdueDays });
  const requested = formatDue(req.requestedAt);
  const currentDue = formatDue(req.task?.dueAt);
  const expires = formatDue(req.expiresAt);

  return `<article class="deadline-ext-card" data-request-id="${esc(req.id)}">
    <div class="deadline-ext-card-head">
      <div class="deadline-ext-card-icon" aria-hidden="true">${adminMsIconFn?.("schedule") ?? ""}</div>
      <div class="min-w-0">
        <h3 class="deadline-ext-card-title h6 mb-1">${esc(tr("deadlineExtensions.requestFrom", { name: employeeName }))}</h3>
        <p class="deadline-ext-card-task mb-0"><strong>${esc(tr("common.task"))}:</strong> ${taskTitle}</p>
      </div>
    </div>
    <dl class="deadline-ext-card-meta">
      <div><dt>${esc(tr("common.deadlineLabel"))}</dt><dd class="tabular-nums">${esc(currentDue)}</dd></div>
      <div><dt>${esc(tr("deadlineExtensions.overdueLabel"))}</dt><dd class="text-danger fw-semibold">${esc(overdueLabel)}</dd></div>
      <div><dt>${esc(tr("deadlineExtensions.requestedAt"))}</dt><dd class="tabular-nums">${esc(requested)}</dd></div>
      <div><dt>${esc(tr("deadlineExtensions.expiresAt"))}</dt><dd class="tabular-nums">${esc(expires)}</dd></div>
    </dl>
    <p class="deadline-ext-card-body small text-muted mb-3">${esc(tr("deadlineExtensions.requestBody", { name: employeeName, task: taskTitle }))}</p>
    <button type="button" class="admin-task-modal-btn-save js-deadline-ext-approve" data-request-id="${esc(req.id)}" data-employee-name="${employeeName}" data-task-title="${taskTitle}" data-current-due="${esc(req.task?.dueAt || "")}">
      ${adminMsIconFn?.("check_circle") ?? ""} ${esc(tr("deadlineExtensions.reviewApprove"))}
    </button>
  </article>`;
}

function pageHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const cards = pendingRequests.length
    ? `<div class="deadline-ext-list">${pendingRequests.map(requestCardHtml).join("")}</div>`
    : `<div class="owner-empty-state py-5 px-3">
        <span class="material-symbols-outlined owner-empty-icon text-primary" aria-hidden="true">event_available</span>
        <p class="owner-empty-title mb-1">${esc(tr("deadlineExtensions.emptyTitle"))}</p>
        <p class="owner-empty-desc text-muted small mb-0">${esc(tr("deadlineExtensions.emptyDesc"))}</p>
      </div>`;

  return `<div class="admin-deadline-ext-page">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="admin-deadline-ext-body">
      <p class="admin-deadline-ext-intro">${esc(tr("deadlineExtensions.intro"))}</p>
      ${cards}
    </div>
    ${approveModalHtml()}
  </div>`;
}

function wireApproveModal() {
  const form = document.getElementById("deadline-extension-approve-form");
  const modalEl = document.getElementById("deadlineExtensionApproveModal");
  if (!form || !modalEl || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const idInput = document.getElementById("deadline-extension-approve-id");
    const dateInput = document.getElementById("deadline-extension-new-due");
    const errEl = document.getElementById("deadline-extension-approve-error");
    const submitBtn = document.getElementById("deadline-extension-approve-submit");
    const requestId = idInput?.value?.trim();
    const dateVal = dateInput?.value?.trim();
    if (!requestId || !dateInput || !errEl || !submitBtn) return;

    errEl.classList.add("d-none");
    errEl.textContent = "";
    if (!dateVal) {
      errEl.textContent = tr("deadlineExtensions.newDeadlineRequired");
      errEl.classList.remove("d-none");
      return;
    }

    const newDueAt = new Date(`${dateVal}T12:00:00`).toISOString();
    submitBtn.disabled = true;
    try {
      await apiFn?.(`/api/deadline-extensions/${requestId}/approve`, {
        method: "POST",
        body: JSON.stringify({ newDueAt }),
      });
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToastFn?.(tr("deadlineExtensions.approvedToast"), "success");
      await refreshDeadlineExtensionsPage();
      document.dispatchEvent(new CustomEvent("taskmgr:deadline-extensions-changed"));
    } catch (err) {
      errEl.textContent = err?.message || tr("deadlineExtensions.approveFailed");
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function wirePage(root) {
  wireOwnerChromeHeaderFn?.(root);
  wireApproveModal();

  root.querySelectorAll(".js-deadline-ext-approve").forEach((btn) => {
    btn.addEventListener("click", () => {
      const requestId = btn.getAttribute("data-request-id");
      const employeeName = btn.getAttribute("data-employee-name") || "";
      const taskTitle = btn.getAttribute("data-task-title") || "";
      const currentDue = btn.getAttribute("data-current-due") || "";
      const idInput = document.getElementById("deadline-extension-approve-id");
      const intro = document.getElementById("deadline-extension-approve-intro");
      const dateInput = document.getElementById("deadline-extension-new-due");
      const errEl = document.getElementById("deadline-extension-approve-error");
      if (!requestId || !idInput || !intro || !dateInput) return;

      idInput.value = requestId;
      intro.textContent = tr("deadlineExtensions.approveIntro", {
        name: employeeName,
        task: taskTitle,
        currentDue: formatDue(currentDue),
      });
      if (currentDue) {
        const d = new Date(currentDue);
        if (!Number.isNaN(d.getTime())) {
          dateInput.value = d.toISOString().slice(0, 10);
        }
      } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.value = tomorrow.toISOString().slice(0, 10);
      }
      if (errEl) {
        errEl.textContent = "";
        errEl.classList.add("d-none");
      }
      bootstrap.Modal.getOrCreateInstance(document.getElementById("deadlineExtensionApproveModal")).show();
    });
  });
}

async function loadPendingRequests() {
  const data = await apiFn?.("/api/deadline-extensions");
  pendingRequests = Array.isArray(data?.requests) ? data.requests : [];
}

export async function refreshDeadlineExtensionsPage() {
  const main = document.getElementById("main-column");
  if (!main) return;
  await loadPendingRequests();
  main.innerHTML = pageHtml();
  wirePage(main);
}

export function openOwnerDeadlineExtensionsView() {
  void refreshDeadlineExtensionsPage().then(() => startDeadlineExtensionsPoll());
}

function stopDeadlineExtensionsPoll() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startDeadlineExtensionsPoll() {
  stopDeadlineExtensionsPoll();
  pollTimer = window.setInterval(() => {
    if (!document.querySelector(".admin-deadline-ext-page")) {
      stopDeadlineExtensionsPoll();
      return;
    }
    void loadPendingRequests().then(() => {
      const list = document.querySelector(".deadline-ext-list");
      const main = document.getElementById("main-column");
      if (!main || !list) return;
      list.innerHTML = pendingRequests.map(requestCardHtml).join("");
      wirePage(main);
    });
  }, POLL_MS);
}

export function destroyAdminDeadlineExtensions() {
  stopDeadlineExtensionsPoll();
}

export function ownerDeadlineExtensionsChromeHeaderHtml() {
  return `<header class="admin-dash-header">
    <div>
      <p class="admin-dash-eyebrow">${tr("nav.adminDashboard")}</p>
      <h1 class="admin-dash-title">${tr("deadlineExtensions.title")}</h1>
    </div>
    <div class="admin-dash-utilities">
      <button type="button" class="admin-icon-btn js-deadline-ext-refresh" aria-label="${tr("common.refresh")}" title="${tr("common.refresh")}">
        ${adminMsIconFn?.("refresh") ?? ""}
      </button>
    </div>
  </header>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest?.(".js-deadline-ext-refresh");
  if (!btn) return;
  void refreshDeadlineExtensionsPage();
});
