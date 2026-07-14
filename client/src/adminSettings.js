import { tr } from "./i18n/index.js";
import * as bootstrap from "bootstrap";
import {
  attendanceSettingsToggleHtml,
  wireAttendanceSettingsToggle,
  companyLiveLocationSettingsToggleHtml,
  wireCompanyLiveLocationToggle,
  companyAttendanceEnabledToggleHtml,
  wireCompanyAttendanceEnabledToggle,
} from "./attendance.js";
import { openLegalModal } from "./legal/legalModal.js";
import {
  isPushSupported,
  isPushSubscribed,
  preparePushInfrastructure,
  requestNotificationPermissionForAlarms,
  runPushRegistrationDuringGesture,
  unsubscribeFromPush,
} from "./sw-register.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((s: string) => string) | null} */
let escapeHtmlFn = null;

/** @type {((name: string, extraClass?: string) => string) | null} */
let adminMsIconFn = null;

/** @type {(() => string) | null} */
let ownerChromeHeaderFn = null;

/** @type {(() => string) | null} */
let employeeChromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireOwnerChromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireEmployeeChromeHeaderFn = null;

/** @type {(() => void) | null} */
let onOpenMyProfileFn = null;

/** @type {(() => void) | null} */
let onToggleThemeFn = null;

/** @type {(() => any) | null} */
let getUserFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {((enabled: boolean) => void) | null} */
let onCompanyLiveLocationChangedFn = null;

/** @type {((enabled: boolean) => void) | null} */
let onCompanyAttendanceChangedFn = null;

let visitUrl = "https://kalpanik.in/";

/** @type {(() => void) | null} */
let onOpenCompanyProfileFn = null;

/** @type {(() => void) | null} */
let onOpenManageEmployeesFn = null;

/** @type {(() => void) | null} */
let onOpenManageLocationsFn = null;

export function initAdminSettings({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  employeeChromeHeader,
  wireOwnerChromeHeader,
  wireEmployeeChromeHeader,
  onOpenMyProfile,
  onOpenCompanyProfile,
  onOpenManageEmployees,
  onOpenManageLocations,
  onToggleTheme,
  getUser,
  showToast,
  kalpanikWebsiteUrl,
  onCompanyLiveLocationChanged,
  onCompanyAttendanceChanged,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  employeeChromeHeaderFn = employeeChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
  wireEmployeeChromeHeaderFn = wireEmployeeChromeHeader ?? null;
  onOpenMyProfileFn = onOpenMyProfile ?? null;
  onOpenCompanyProfileFn = onOpenCompanyProfile ?? null;
  onOpenManageEmployeesFn = onOpenManageEmployees ?? null;
  onOpenManageLocationsFn = onOpenManageLocations ?? null;
  onToggleThemeFn = onToggleTheme ?? null;
  getUserFn = getUser ?? null;
  showToastFn = showToast ?? null;
  onCompanyLiveLocationChangedFn = onCompanyLiveLocationChanged ?? null;
  onCompanyAttendanceChangedFn = onCompanyAttendanceChanged ?? null;
  if (kalpanikWebsiteUrl) visitUrl = kalpanikWebsiteUrl;
}

function settingsRowHtml({ icon, label, extraClass = "", attrs = "", tag = "button" }) {
  const inner = `${adminMsIconFn?.(icon) ?? ""}<span class="admin-settings-row-label">${escapeHtmlFn?.(label) ?? label}</span>${extraClass.includes("admin-settings-row--link") ? adminMsIconFn?.("open_in_new", "admin-settings-row-chevron") ?? "" : adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}`;
  if (tag === "a") {
    return `<a class="admin-settings-row ${extraClass}" ${attrs}>${inner}</a>`;
  }
  return `<button type="button" class="admin-settings-row ${extraClass}" ${attrs}>${inner}</button>`;
}

/** @param {number} bytes */
export function formatStorageBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const kb = 1024;
  if (n >= gb) return `${(n / gb).toFixed(n >= 10 * gb ? 1 : 2)} GB`;
  if (n >= mb) return `${(n / mb).toFixed(n >= 10 * mb ? 1 : 2)} MB`;
  if (n >= kb) return `${(n / kb).toFixed(n >= 10 * kb ? 0 : 1)} KB`;
  return `${Math.round(n)} B`;
}

/** @param {any} storage */
function storageBreakdownHtml(storage) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const cats = storage?.byCategory || {};
  const taskBytes = (cats.taskProofs || 0) + (cats.progressUpdates || 0);
  const rows = [
    { category: "tasks", label: tr("settings.storageCategoryTasks"), bytes: taskBytes },
    { category: "chat", label: tr("settings.storageCategoryChat"), bytes: cats.chat || 0 },
    { category: "profile", label: tr("settings.storageCategoryProfile"), bytes: cats.profile || 0 },
    {
      category: "assignment",
      label: tr("settings.storageCategoryAssignment"),
      bytes: cats.assignmentAttachments || 0,
    },
  ].filter((r) => r.bytes > 0);

  if (!rows.length) return "";
  return `<ul class="admin-settings-storage-breakdown">
    ${rows
      .map(
        (r) => `<li>
          <button type="button" class="admin-settings-storage-cat-btn js-open-storage-category" data-storage-category="${esc(
            r.category
          )}">
            <span class="admin-settings-storage-cat-label">${esc(r.label)}</span>
            <span class="admin-settings-storage-cat-meta">
              <span class="tabular-nums">${esc(formatStorageBytes(r.bytes))}</span>
              ${adminMsIconFn?.("chevron_right", "admin-settings-storage-cat-chevron") ?? ""}
            </span>
          </button>
        </li>`
      )
      .join("")}
  </ul>`;
}

/** @type {string[]} */
const storageBlobUrls = [];

/** @type {{ url: string, kind: string, name: string, blobUrl?: string }[]} */
let storageLightboxItems = [];
let storageLightboxIndex = 0;
let storageLightboxKeyWired = false;

function revokeStorageBlobs() {
  while (storageBlobUrls.length) {
    try {
      URL.revokeObjectURL(storageBlobUrls.pop());
    } catch {
      /* ignore */
    }
  }
}

function storageCategoryTitle(category) {
  switch (category) {
    case "tasks":
      return tr("settings.storageCategoryTasks");
    case "chat":
      return tr("settings.storageCategoryChat");
    case "profile":
      return tr("settings.storageCategoryProfile");
    case "assignment":
      return tr("settings.storageCategoryAssignment");
    default:
      return tr("settings.storageTitle");
  }
}

function ensureStorageLightbox() {
  let box = document.getElementById("storage-media-lightbox");
  if (box) return box;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div id="storage-media-lightbox" class="submission-media-lightbox d-none" role="dialog" aria-modal="true" aria-label="${tr(
      "chat.fullScreenMedia"
    )}">
      <button type="button" class="submission-media-lightbox-backdrop js-storage-media-lightbox-close" aria-label="${tr(
        "common.close"
      )}"></button>
      <button type="button" class="submission-media-lightbox-close js-storage-media-lightbox-close" aria-label="${tr(
        "common.close"
      )}">${adminMsIconFn?.("close") ?? "×"}</button>
      <button type="button" class="submission-media-lightbox-nav submission-media-lightbox-nav--prev js-storage-media-lightbox-prev d-none" aria-label="Previous">${adminMsIconFn?.("chevron_left") ?? "‹"}</button>
      <button type="button" class="submission-media-lightbox-nav submission-media-lightbox-nav--next js-storage-media-lightbox-next d-none" aria-label="Next">${adminMsIconFn?.("chevron_right") ?? "›"}</button>
      <p id="storage-media-lightbox-counter" class="submission-media-lightbox-counter d-none"></p>
      <div id="storage-media-lightbox-inner" class="submission-media-lightbox-inner"></div>
    </div>`;
  box = wrap.firstElementChild;
  document.body.appendChild(box);

  box.addEventListener("click", (e) => {
    if (
      e.target.closest(".js-storage-media-lightbox-close") ||
      e.target.classList.contains("submission-media-lightbox-backdrop")
    ) {
      closeStorageMediaLightbox();
      return;
    }
    if (e.target.closest(".js-storage-media-lightbox-prev")) {
      void showStorageLightboxAt(storageLightboxIndex - 1);
      return;
    }
    if (e.target.closest(".js-storage-media-lightbox-next")) {
      void showStorageLightboxAt(storageLightboxIndex + 1);
    }
  });

  if (!storageLightboxKeyWired) {
    storageLightboxKeyWired = true;
    document.addEventListener("keydown", (e) => {
      const lb = document.getElementById("storage-media-lightbox");
      if (!lb || lb.classList.contains("d-none")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeStorageMediaLightbox();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void showStorageLightboxAt(storageLightboxIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void showStorageLightboxAt(storageLightboxIndex + 1);
      }
    });
  }

  return box;
}

function updateStorageLightboxNav() {
  const box = document.getElementById("storage-media-lightbox");
  const prev = box?.querySelector(".js-storage-media-lightbox-prev");
  const next = box?.querySelector(".js-storage-media-lightbox-next");
  const counter = document.getElementById("storage-media-lightbox-counter");
  const multi = storageLightboxItems.length > 1;
  prev?.classList.toggle("d-none", !multi);
  next?.classList.toggle("d-none", !multi);
  if (counter) {
    if (multi) {
      counter.textContent = `${storageLightboxIndex + 1} / ${storageLightboxItems.length}`;
      counter.classList.remove("d-none");
    } else {
      counter.classList.add("d-none");
    }
  }
}

function closeStorageMediaLightbox() {
  const box = document.getElementById("storage-media-lightbox");
  const inner = document.getElementById("storage-media-lightbox-inner");
  if (inner) inner.innerHTML = "";
  box?.classList.add("d-none");
  document.body.classList.remove("submission-media-lightbox-open");
}

/**
 * @param {string} blobUrl
 * @param {string} kind
 * @param {string} name
 * @param {string} mime
 */
function renderStorageLightboxMedia(blobUrl, kind, name, mime) {
  const inner = document.getElementById("storage-media-lightbox-inner");
  if (!inner) return;
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (kind === "image" || mime.startsWith("image/")) {
    inner.innerHTML = `<img src="${esc(blobUrl)}" alt="${esc(name)}" class="submission-media-lightbox-image" />`;
  } else if (kind === "video" || mime.startsWith("video/")) {
    inner.innerHTML = `<video class="submission-media-lightbox-video" controls autoplay playsinline src="${esc(
      blobUrl
    )}"></video>`;
  } else if (kind === "audio" || mime.startsWith("audio/")) {
    inner.innerHTML = `<div class="storage-media-lightbox-audio">
      <p class="storage-media-lightbox-audio-title">${esc(name)}</p>
      <audio src="${esc(blobUrl)}" controls autoplay class="w-100"></audio>
    </div>`;
  } else if (kind === "pdf" || mime === "application/pdf") {
    inner.innerHTML = `<iframe class="submission-media-lightbox-pdf" src="${esc(blobUrl)}" title="${esc(name)}"></iframe>`;
  } else {
    inner.innerHTML = `<div class="storage-media-lightbox-audio">
      <p class="storage-media-lightbox-audio-title mb-3">${esc(name)}</p>
      <a class="btn btn-light btn-sm" href="${esc(blobUrl)}" download="${esc(name)}">${esc(tr("settings.storageDownload"))}</a>
    </div>`;
  }
}

async function ensureStorageItemBlob(item) {
  if (item.blobUrl) return item;
  const res = await fetch(item.url, { credentials: "include" });
  if (!res.ok) throw new Error(tr("settings.storagePreviewFailed"));
  const buf = await res.arrayBuffer();
  const mime = (res.headers.get("content-type") || "").split(";")[0].trim() || "application/octet-stream";
  const blob = new Blob([buf], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  storageBlobUrls.push(blobUrl);
  item.blobUrl = blobUrl;
  item.mime = mime;
  return item;
}

async function showStorageLightboxAt(index) {
  if (!storageLightboxItems.length) return;
  const len = storageLightboxItems.length;
  const nextIndex = ((index % len) + len) % len;
  storageLightboxIndex = nextIndex;
  const box = ensureStorageLightbox();
  const inner = document.getElementById("storage-media-lightbox-inner");
  if (inner) {
    inner.innerHTML = `<p class="text-white small mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? "…"}</p>`;
  }
  box.classList.remove("d-none");
  document.body.classList.add("submission-media-lightbox-open");
  updateStorageLightboxNav();
  try {
    const item = await ensureStorageItemBlob(storageLightboxItems[nextIndex]);
    renderStorageLightboxMedia(item.blobUrl, item.kind, item.name, item.mime || "");
  } catch (err) {
    if (inner) {
      inner.innerHTML = `<p class="text-danger small mb-0">${escapeHtmlFn?.(
        err?.message || tr("settings.storagePreviewFailed")
      )}</p>`;
    }
  }
}

function ensureStorageFilesModal() {
  let modalEl = document.getElementById("storageFilesModal");
  if (modalEl) return modalEl;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="storageFilesModal" tabindex="-1" aria-labelledby="storageFilesModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="storageFilesModalTitle">${tr("settings.storageFilesTitle")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted" id="storage-files-hint">${tr("settings.storageFilesHint")}</p>
            <div id="storage-files-list" class="storage-files-list"></div>
            <p id="storage-files-empty" class="text-muted small mb-0 d-none">${tr("settings.storageFilesEmpty")}</p>
            <p id="storage-files-error" class="text-danger small mb-0 d-none"></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${tr("common.close")}</button>
          </div>
        </div>
      </div>
    </div>`;
  modalEl = wrap.firstElementChild;
  document.body.appendChild(modalEl);
  modalEl.addEventListener("hidden.bs.modal", () => {
    closeStorageMediaLightbox();
    revokeStorageBlobs();
    storageLightboxItems = [];
  });
  ensureStorageLightbox();
  return modalEl;
}

/**
 * @param {any} file
 */
function storageFileKindIcon(kind) {
  if (kind === "audio") return "mic";
  if (kind === "pdf") return "picture_as_pdf";
  if (kind === "video") return "videocam";
  if (kind === "image") return "image";
  return "attach_file";
}

/**
 * @param {any[]} files
 * @param {string} category
 */
function renderStorageFilesList(files, category) {
  const list = document.getElementById("storage-files-list");
  const empty = document.getElementById("storage-files-empty");
  const err = document.getElementById("storage-files-error");
  if (!list || !empty) return;
  if (err) {
    err.classList.add("d-none");
    err.textContent = "";
  }
  closeStorageMediaLightbox();
  revokeStorageBlobs();
  storageLightboxItems = files.map((f) => ({
    url: f.url,
    kind: f.kind || "file",
    name: f.name || "File",
  }));

  if (!files.length) {
    list.innerHTML = "";
    empty.classList.remove("d-none");
    return;
  }
  empty.classList.add("d-none");
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  list.innerHTML = files
    .map((f, index) => {
      const when = f.createdAt
        ? new Date(f.createdAt).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      return `<article class="storage-file-row" data-file-id="${esc(f.id)}">
        <button type="button" class="storage-file-open js-storage-file-open" data-file-index="${index}" aria-label="${esc(
          tr("settings.storageViewFullScreen")
        )}">
          ${adminMsIconFn?.(storageFileKindIcon(f.kind)) ?? ""}
          <span class="storage-file-meta">
            <span class="storage-file-name">${esc(f.name)}</span>
            <span class="storage-file-sub text-muted">${esc(
              [f.subtitle, when, formatStorageBytes(f.sizeBytes)].filter(Boolean).join(" · ")
            )}</span>
            <span class="storage-file-fullscreen-hint">${esc(tr("settings.storageTapFullScreen"))}</span>
          </span>
          ${adminMsIconFn?.("fullscreen", "storage-file-fullscreen-icon") ?? ""}
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger js-storage-file-delete" data-file-id="${esc(
          f.id
        )}" data-storage-category="${esc(category)}" aria-label="${esc(tr("settings.storageDeleteFile"))}">${esc(
          tr("common.delete")
        )}</button>
      </article>`;
    })
    .join("");
}

async function openStorageCategoryBrowser(category, root) {
  const modalEl = ensureStorageFilesModal();
  const titleEl = document.getElementById("storageFilesModalTitle");
  const list = document.getElementById("storage-files-list");
  const empty = document.getElementById("storage-files-empty");
  const err = document.getElementById("storage-files-error");
  if (titleEl) titleEl.textContent = storageCategoryTitle(category);
  if (list) list.innerHTML = `<p class="small text-muted mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>`;
  empty?.classList.add("d-none");
  if (err) {
    err.classList.add("d-none");
    err.textContent = "";
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  try {
    const data = await apiFn(`/api/users/storage/files?category=${encodeURIComponent(category)}`);
    const files = data.files || [];
    renderStorageFilesList(files, category);

    list?.querySelectorAll(".js-storage-file-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-file-index") || "0");
        void showStorageLightboxAt(Number.isFinite(index) ? index : 0);
      });
    });

    list?.querySelectorAll(".js-storage-file-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fileId = btn.getAttribute("data-file-id");
        const cat = btn.getAttribute("data-storage-category") || category;
        if (!fileId) return;
        if (!window.confirm(tr("settings.storageDeleteConfirm"))) return;
        void (async () => {
          btn.disabled = true;
          try {
            closeStorageMediaLightbox();
            await apiFn(`/api/users/storage/files/${encodeURIComponent(fileId)}`, {
              method: "DELETE",
            });
            showToastFn?.(tr("settings.storageDeleted"), "success");
            await openStorageCategoryBrowser(cat, root);
            void loadAndRenderStorageCard(root || document);
          } catch (e) {
            showToastFn?.(e?.message || tr("settings.storageDeleteFailed"), "danger");
            btn.disabled = false;
          }
        })();
      });
    });
  } catch (e) {
    if (list) list.innerHTML = "";
    if (err) {
      err.textContent = e?.message || tr("settings.storageLoadFailed");
      err.classList.remove("d-none");
    }
  }
}

function wireStorageCardActions(root) {
  root.querySelectorAll(".js-open-storage-category").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const category = btn.getAttribute("data-storage-category");
      if (!category) return;
      void openStorageCategoryBrowser(category, root);
    });
  });
}

/** @param {any} storage */
export function storageUsageCardHtml(storage, { loading = false } = {}) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (loading) {
    return `<div class="admin-settings-storage-card" data-storage-card>
      <p class="admin-settings-storage-loading mb-0">${esc(tr("common.loading"))}</p>
    </div>`;
  }
  if (!storage || typeof storage.usedBytes !== "number") {
    return `<div class="admin-settings-storage-card" data-storage-card>
      <p class="admin-settings-storage-loading text-danger mb-0">${esc(tr("settings.storageLoadFailed"))}</p>
    </div>`;
  }
  const used = formatStorageBytes(storage.usedBytes);
  const quota = formatStorageBytes(storage.quotaBytes || 1024 * 1024 * 1024);
  const pct = Math.min(100, Math.max(0, Number(storage.percentUsed) || 0));
  const over = Boolean(storage.overQuota);
  return `<div class="admin-settings-storage-card${over ? " admin-settings-storage-card--over" : ""}" data-storage-card>
    <div class="admin-settings-storage-head">
      ${adminMsIconFn?.("hard_drive") ?? ""}
      <div class="admin-settings-storage-titles">
        <p class="admin-settings-storage-title mb-0">${esc(tr("settings.storageTitle"))}</p>
        <p class="admin-settings-storage-quota mb-0 tabular-nums">${esc(
          tr("settings.storageQuotaLabel", { used, quota })
        )}</p>
      </div>
    </div>
    <div class="admin-settings-storage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(
      tr("settings.storageTitle")
    )}">
      <span class="admin-settings-storage-bar-fill" style="width:${pct}%"></span>
    </div>
    <p class="admin-settings-storage-hint mb-0">${esc(tr("settings.storageHint"))}</p>
    ${storageBreakdownHtml(storage)}
  </div>`;
}

function replaceStorageCard(root, html) {
  const page = root?.querySelector?.(".admin-settings-page") || root;
  const card = page?.querySelector?.("[data-storage-card]") || document.querySelector(".admin-settings-page [data-storage-card]");
  if (!card) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const next = wrap.firstElementChild;
  if (next) card.replaceWith(next);
}

async function loadAndRenderStorageCard(root) {
  if (!apiFn) {
    replaceStorageCard(root, storageUsageCardHtml(null));
    return;
  }
  try {
    const data = await apiFn("/api/users/storage");
    const storage = data?.storage;
    if (!storage || typeof storage.usedBytes !== "number") {
      throw new Error(tr("settings.storageLoadFailed"));
    }
    replaceStorageCard(root, storageUsageCardHtml(storage));
    wireStorageCardActions(root?.querySelector?.(".admin-settings-page") || root || document);
  } catch {
    replaceStorageCard(root, storageUsageCardHtml(null));
  }
}

function myProfileSettingsRowHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<button type="button" class="admin-settings-row js-open-my-profile" data-my-profile-row="1">
    ${adminMsIconFn?.("account_circle") ?? ""}
    <span class="admin-settings-row-label">${esc(tr("profile.myProfile"))}</span>
    <span class="admin-settings-row-status admin-settings-row-status--incomplete d-none" data-my-profile-status>${esc(tr("profile.sectionIncompleteTitle"))}</span>
    ${adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}
  </button>`;
}

function companyProfileSettingsRowHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<button type="button" class="admin-settings-row js-open-company-profile" data-company-profile-row="1">
    ${adminMsIconFn?.("business") ?? ""}
    <span class="admin-settings-row-label">${esc(tr("profile.myCompanyDetails"))}</span>
    <span class="admin-settings-row-status admin-settings-row-status--incomplete d-none" data-company-profile-status>${esc(tr("profile.sectionIncompleteTitle"))}</span>
    ${adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}
  </button>`;
}

function ownerSettingsRowsHtml() {
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const rows = [myProfileSettingsRowHtml()];

  if (getUserFn?.()?.isOwner) {
    rows.push(companyProfileSettingsRowHtml());
  }

  rows.push(
    settingsRowHtml({
      icon: isDark ? "light_mode" : "dark_mode",
      label: tr("owner.themeToggle"),
      extraClass: "js-admin-theme-toggle",
    }),
    settingsRowHtml({
      icon: "language",
      label: tr("common.visitUs"),
      extraClass: "admin-settings-row--link",
      tag: "a",
      attrs: `href="${escapeHtmlFn?.(visitUrl) ?? visitUrl}" target="_blank" rel="noopener noreferrer"`,
    }),
    settingsRowHtml({
      icon: "policy",
      label: tr("legal.settingsRow"),
      extraClass: "js-open-legal",
    }),
    settingsRowHtml({
      icon: "admin_panel_settings",
      label: tr("owner.manageAdmin"),
      extraClass: "js-admin-manage-admin",
      attrs: 'data-bs-toggle="modal" data-bs-target="#teamAdminModal"',
    }),
    settingsRowHtml({
      icon: "groups",
      label: tr("owner.manageEmployees"),
      extraClass: "js-open-manage-employees",
    }),
    settingsRowHtml({
      icon: "pin_drop",
      label: tr("attendance.manageLocations"),
      extraClass: "js-open-manage-locations",
    }),
    companyAttendanceEnabledToggleHtml(),
    settingsRowHtml({
      icon: "person",
      label: tr("owner.switchToUserView"),
      extraClass: "js-switch-account-view",
      attrs: 'data-view-role="employee"',
    })
  );

  rows.push(companyLiveLocationSettingsToggleHtml());

  if (isPushSupported()) {
    rows.push(`<div class="admin-settings-row admin-settings-row--toggle">
      <span class="admin-settings-row-left">
        ${adminMsIconFn?.("notifications") ?? ""}
        <span class="admin-settings-row-label">${escapeHtmlFn?.(tr("settings.manageNotifications")) ?? ""}</span>
      </span>
      <label class="admin-settings-switch">
        <input type="checkbox" class="admin-settings-switch-input js-admin-notifications-toggle" aria-label="${escapeHtmlFn?.(tr("settings.manageNotifications")) ?? ""}" />
        <span class="admin-settings-switch-track" aria-hidden="true"></span>
      </label>
    </div>`);
  }

  return rows.join("");
}

function employeeSettingsRowsHtml() {
  const user = getUserFn?.();
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const rows = [
    myProfileSettingsRowHtml(),
    settingsRowHtml({
      icon: isDark ? "light_mode" : "dark_mode",
      label: tr("owner.themeToggle"),
      extraClass: "js-admin-theme-toggle",
    }),
    settingsRowHtml({
      icon: "language",
      label: tr("common.visitUs"),
      extraClass: "admin-settings-row--link",
      tag: "a",
      attrs: `href="${escapeHtmlFn?.(visitUrl) ?? visitUrl}" target="_blank" rel="noopener noreferrer"`,
    }),
    settingsRowHtml({
      icon: "policy",
      label: tr("legal.settingsRow"),
      extraClass: "js-open-legal",
    }),
  ];

  if (user?.isAdmin) {
    rows.push(
      settingsRowHtml({
        icon: "admin_panel_settings",
        label: tr("owner.switchToAdminView"),
        extraClass: "js-switch-account-view",
        attrs: 'data-view-role="owner"',
      })
    );
  }

  if (isPushSupported()) {
    rows.push(
      settingsRowHtml({
        icon: "notifications",
        label: tr("employee.enableChromeReminders"),
        extraClass: "js-emp-enable-push",
      })
    );
  }

  if (user?.role === "employee" && user?.liveLocationRequired !== false) {
    rows.push(attendanceSettingsToggleHtml());
  }

  return rows.join("");
}

function settingsPageHtml(role) {
  const rows = role === "owner" ? ownerSettingsRowsHtml() : employeeSettingsRowsHtml();
  const chromeHeader = role === "owner" ? ownerChromeHeaderFn?.() ?? "" : employeeChromeHeaderFn?.() ?? "";
  return `<div class="admin-main-scroll d-flex flex-column">
    ${chromeHeader}
    <div class="admin-settings-page">
      <p class="admin-settings-intro">${escapeHtmlFn?.(tr("settings.intro")) ?? ""}</p>
      ${storageUsageCardHtml(null, { loading: true })}
      <nav class="admin-settings-list" aria-label="${escapeHtmlFn?.(tr("settings.title")) ?? "Settings"}">
        ${rows}
      </nav>
    </div>
  </div>`;
}

async function syncNotificationsToggle(root) {
  const toggle = root.querySelector(".js-admin-notifications-toggle");
  if (!toggle) return;
  toggle.disabled = true;
  try {
    toggle.checked = await isPushSubscribed();
  } finally {
    toggle.disabled = false;
  }
}

function wireNotificationsToggle(root) {
  const toggle = root.querySelector(".js-admin-notifications-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";

  void syncNotificationsToggle(root);

  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    if (!apiFn) return;

    if (!wantOn) {
      toggle.disabled = true;
      void unsubscribeFromPush(apiFn).then(() => {
        showToastFn?.(tr("settings.notificationsTurnedOff"), "success");
        toggle.disabled = false;
      });
      return;
    }

    if (!isPushSupported()) {
      toggle.checked = false;
      showToastFn?.(tr("toast.browserNoReminders"), "warning");
      return;
    }

    if (Notification.permission === "denied") {
      toggle.checked = false;
      showToastFn?.(tr("toast.notificationsBlockedChrome"), "warning");
      return;
    }

    toggle.disabled = true;

    const finishEnable = (result) => {
      toggle.disabled = false;
      if (result.ok) {
        toggle.checked = true;
        showToastFn?.(tr("settings.notificationsTurnedOn"), "success");
        return;
      }
      toggle.checked = false;
      if (result.reason === "denied") {
        showToastFn?.(tr("toast.allowNotifications"), "warning");
      } else if (result.reason === "not-ready") {
        showToastFn?.(result.message || tr("toast.pullRefreshEnable"), "warning");
      } else if (result.reason === "no-vapid") {
        showToastFn?.(tr("toast.pushNotConfigured"), "danger");
      } else {
        showToastFn?.(result.message || tr("toast.tapEnableAgain"), "warning");
      }
    };

    const runSubscribe = () => {
      void preparePushInfrastructure(apiFn).then((ready) => {
        if (!ready) {
          finishEnable({ ok: false, reason: "not-ready" });
          return;
        }
        runPushRegistrationDuringGesture(apiFn, finishEnable);
      });
    };

    if (Notification.permission === "granted") {
      runSubscribe();
      return;
    }

    void requestNotificationPermissionForAlarms().then((perm) => {
      if (perm !== "granted") {
        finishEnable({ ok: false, reason: "denied" });
        return;
      }
      runSubscribe();
    });
  });
}

function wireSettingsPage(main, role) {
  main.querySelectorAll(".js-admin-theme-toggle").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      onToggleThemeFn?.();
      openSettingsView(role);
    });
  });

  main.querySelectorAll(".js-open-my-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenMyProfileFn?.());
  });

  main.querySelectorAll(".js-open-company-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenCompanyProfileFn?.());
  });

  main.querySelectorAll(".js-open-manage-employees").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenManageEmployeesFn?.());
  });

  main.querySelectorAll(".js-open-manage-locations").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenManageLocationsFn?.());
  });

  main.querySelectorAll(".js-open-legal").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => openLegalModal());
  });

  wireNotificationsToggle(main);
  if (role === "owner") {
    wireCompanyLiveLocationToggle(main, {
      api: apiFn,
      showToast: showToastFn,
      onChanged: (enabled) => onCompanyLiveLocationChangedFn?.(enabled),
    });
    wireCompanyAttendanceEnabledToggle(main, {
      api: apiFn,
      showToast: showToastFn,
      onChanged: (enabled) => onCompanyAttendanceChangedFn?.(enabled),
    });
  }
  if (role === "employee") {
    wireAttendanceSettingsToggle(main);
  }
  void loadAndRenderStorageCard(main);
  void refreshMyProfileSettingsBadge();
  if (role === "owner") {
    void refreshCompanyProfileSettingsBadge();
  }
}

export function refreshMyProfileSettingsBadge(incomplete = null) {
  const row = document.querySelector("[data-my-profile-row]");
  const badge = row?.querySelector("[data-my-profile-status]");
  if (!row || !badge) return;

  const apply = (isIncomplete) => {
    badge.classList.toggle("d-none", !isIncomplete);
    row.classList.toggle("admin-settings-row--incomplete", isIncomplete);
  };

  if (incomplete === null) {
    const cached = getUserFn?.()?.profileDocumentsComplete;
    if (typeof cached === "boolean") {
      apply(!cached);
    }
    if (!apiFn) return;
    void apiFn("/api/users/profile")
      .then(({ profile }) => {
        apply(!profile.profileDocumentsComplete);
        const user = getUserFn?.();
        if (user) user.profileDocumentsComplete = profile.profileDocumentsComplete;
      })
      .catch(() => {});
    return;
  }

  apply(incomplete);
}

export function refreshCompanyProfileSettingsBadge(incomplete = null) {
  const row = document.querySelector("[data-company-profile-row]");
  const badge = row?.querySelector("[data-company-profile-status]");
  if (!row || !badge) return;

  const apply = (isIncomplete) => {
    badge.classList.toggle("d-none", !isIncomplete);
    row.classList.toggle("admin-settings-row--incomplete", isIncomplete);
  };

  if (incomplete === null) {
    if (!getUserFn?.()?.isOwner || !apiFn) return;
    void apiFn("/api/company/profile")
      .then(({ profile }) => apply(!profile.companyProfileComplete))
      .catch(() => {});
    return;
  }

  apply(incomplete);
}

function openSettingsView(role) {
  const mainId = role === "owner" ? "main-column" : "emp-main-column";
  const main = document.getElementById(mainId);
  if (!main) return;

  main.innerHTML = settingsPageHtml(role);

  if (role === "owner") {
    wireOwnerChromeHeaderFn?.(main);
  } else {
    wireEmployeeChromeHeaderFn?.(main);
  }

  wireSettingsPage(main, role);
}

export function openOwnerSettingsView() {
  openSettingsView("owner");
}

export function openEmployeeSettingsView() {
  openSettingsView("employee");
}

export function onSettingsThemeChange() {
  if (!document.querySelector(".admin-settings-page")) return;
  const ownerMain = document.getElementById("main-column")?.querySelector(".admin-settings-page");
  const empMain = document.getElementById("emp-main-column")?.querySelector(".admin-settings-page");
  if (ownerMain) openSettingsView("owner");
  else if (empMain) openSettingsView("employee");
}
