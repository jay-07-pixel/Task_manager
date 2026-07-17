import { applyPwaBranding } from "./pwaBranding.js";
import { initPwaSplash, notifyAppReady } from "./pwaSplash.js";
import "./scss/styles.scss";
import * as bootstrap from "bootstrap";
import Sortable from "sortablejs";
import { startEmployeeReminders, stopEmployeeReminders, clearReminderForTask } from "./reminders.js";
import {
  initManageEmployees,
  openOwnerManageEmployeesView,
  employeeProfileModalHtml,
  openEmployeeProfileModal,
  wireEmployeeProfileModal,
} from "./adminManageEmployees.js";
import {
  initManageLocations,
  openOwnerManageLocationsView,
  manageLocationModalHtml,
  wireManageLocationModal,
} from "./adminManageLocations.js";
import { initCompanyProfile, openOwnerCompanyProfileView } from "./companyProfile.js";
import {
  profileDocumentsSectionHtml,
  syncProfileDocumentsSectionVisibility,
  fillProfileDocumentsUi,
  wireProfileDocumentsUpload,
} from "./userProfileDocs.js";
import {
  isPushSupported,
  isPushInfrastructureReady,
  preparePushInfrastructure,
  linkPushSubscriptionToServer,
  runPushRegistrationDuringGesture,
  subscribeToPush,
} from "./sw-register.js";
import {
  teamChatOffcanvasHtml,
  teamChatSidebarNavItemHtml,
  initTeamChat,
  stopPolling as stopChatPolling,
  refreshUnreadBadges,
  openChatFromDeepLink,
  refreshChatForLanguageChange,
  rerenderChatTranslatedContent,
} from "./chat.js";
import { adminNotificationsBellHtml, adminNotifOffcanvasHtml, wireAdminNotifications, maybePromptLegalAnnouncement } from "./adminAnnouncements.js";
import { legalModalHtml, wireLegalModal } from "./legal/legalModal.js";
import {
  initAdminReports,
  ownerReportsNavItemHtml,
  openOwnerReportsView,
  openOwnerDashboardView,
  refreshAdminReports,
  refreshOwnerDashboard,
  destroyAdminReportsCharts,
  clearAdminReportsCache,
  onReportsThemeChange,
} from "./adminReports.js";
import {
  initAdminSettings,
  openOwnerSettingsView,
  openEmployeeSettingsView,
  onSettingsThemeChange,
  refreshCompanyProfileSettingsBadge,
  refreshMyProfileSettingsBadge,
} from "./adminSettings.js";
import {
  initAttendance,
  ensureEmployeeLocationAccess,
  stopAttendanceTracking,
} from "./attendance.js";
import {
  initAttendanceCheckIn,
  attendanceCheckInCardHtml,
  attendanceCheckInSidebarHtml,
  wireAttendanceCheckInCard,
  refreshAttendanceCheckInCard,
  performAttendanceCheck,
} from "./attendanceCheckIn.js";
import {
  attendanceCheckInReminderModalHtml,
  initAttendanceCheckInReminder,
  startAttendanceCheckInReminder,
  stopAttendanceCheckInReminder,
  wireAttendanceCheckInReminder,
} from "./attendanceCheckInReminder.js";
import {
  initAdminAttendance,
  ownerAttendanceNavItemHtml,
  openOwnerAttendanceView,
  destroyAdminAttendance,
  stopAttendancePoll,
  ownerAttendanceChromeHeaderHtml,
  handleAttendanceLiveEvent,
  ensureOwnerAttendanceLiveTab,
  syncOwnerAttendanceTabAfterSettingsChange,
} from "./adminAttendance.js";
import {
  initAdminDeadlineExtensions,
  ownerDeadlineExtensionsNavItemHtml,
  openOwnerDeadlineExtensionsView,
  destroyAdminDeadlineExtensions,
  ownerDeadlineExtensionsChromeHeaderHtml,
  fetchPendingDeadlineExtensionCount,
} from "./adminDeadlineExtensions.js";
import {
  compareTasksByRecurrenceThenCreated,
  sortTasksByRecurrenceThenCreated,
  compareHighPriorityFirst,
  compareCompletedTasksRecentFirst,
} from "./taskRecurrenceSort.js";
import { initI18n, tr, dateLocale, formatTime24, formatDateTime24, formatShortDateTime24, setLanguageChangeHandler } from "./i18n/index.js";
import { dt, ensureStateContentTranslations, initContentTranslate, onContentTranslationsUpdated } from "./i18n/contentTranslate.js";
import { languageSelectorHtml, wireLanguageSelector } from "./i18n/languageSelector.js";

const app = document.getElementById("app");
const toastHost = document.getElementById("toastHost");
const ACCOUNT_VIEW_PREF_KEY = "taskmgr-account-view";

/** @type {any} */
let state = {
  user: null,
  lists: [],
  activeListId: null,
  tasks: [],
  assignees: [],
  empTasks: [],
  empAssignedByMeTasks: [],
  empFilter: "active",
  ownerTaskFilter: "active",
  overdueColorFilter: "all",
  allTasksEmployeeFilter: "all",
  allTasksListFilter: "all",
  allTasksDeadlineFilter: "all",
  ownerView: "dashboard",
  empView: "dashboard",
  companyTrial: null,
  deadlineExtensionPendingCount: 0,
};

/** @type {any[]} */
let listSortables = [];
let taskRootSortable = null;

/** @type {Record<string, any> | null} */
let pendingCustomRecurrence = null;

/** @type {((value: string | null) => void) | null} */
let listNameResolve = null;

const OWNER_SYNC_INTERVAL_MS = 12_000;
/** Virtual sidebar id — aggregates tasks from every list. */
const OWNER_ALL_TASKS_LIST_ID = "__owner_all_tasks__";
/** @type {number | null} */
let ownerSyncTimer = null;
let ownerTasksFingerprint = "";
/** @type {Map<string, object[]>} */
const ownerTasksCache = new Map();
let ownerMainLoading = false;
let ownerNavBusyUntil = 0;
/** @type {number | null} */
let ownerListRefreshTimer = null;
let ownerListRefreshTarget = null;
let taskSortableListId = null;
const OWNER_TRIAL_POPUP_KEY = "taskmgr-owner-trial-popup-shown";
const EMP_CRITICAL_OVERDUE_MIN_DAYS = 6;
const POSTPONE_GRACE_MS = 24 * 60 * 60 * 1000;
const POSTPONE_GRACE_STORAGE_KEY = "taskmgr-postpone-grace-v1";

/** @type {number | null} */
let empPostponeGraceTimer = null;

function readPostponeGraceMap() {
  try {
    const raw = localStorage.getItem(POSTPONE_GRACE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePostponeGraceMap(map) {
  localStorage.setItem(POSTPONE_GRACE_STORAGE_KEY, JSON.stringify(map));
}

function pruneExpiredPostponeGrace(map = readPostponeGraceMap()) {
  const now = Date.now();
  let changed = false;
  for (const [taskId, requestedAt] of Object.entries(map)) {
    const ms = new Date(requestedAt).getTime();
    if (Number.isNaN(ms) || now >= ms + POSTPONE_GRACE_MS) {
      delete map[taskId];
      changed = true;
    }
  }
  if (changed) writePostponeGraceMap(map);
  return map;
}

function savePostponeGraceForTask(taskId, requestedAt) {
  if (!taskId || !requestedAt) return;
  const map = pruneExpiredPostponeGrace();
  map[taskId] = requestedAt;
  writePostponeGraceMap(map);
}

function clearPostponeGraceForTask(taskId) {
  if (!taskId) return;
  const map = readPostponeGraceMap();
  if (!map[taskId]) return;
  delete map[taskId];
  writePostponeGraceMap(map);
}

function getLocalPostponeGraceRequestedAt(taskId) {
  if (!taskId) return null;
  const map = pruneExpiredPostponeGrace();
  return map[taskId] ?? null;
}

function buildPendingExtensionFromRequestedAt(requestedAt, id = null) {
  const requestedMs = new Date(requestedAt).getTime();
  if (Number.isNaN(requestedMs)) return null;
  return {
    ...(id ? { id } : {}),
    requestedAt: new Date(requestedMs).toISOString(),
    status: "pending",
    expiresAt: new Date(requestedMs + POSTPONE_GRACE_MS).toISOString(),
  };
}

function postponeGraceStillActive(requestedAt, expiresAt = null) {
  if (expiresAt) {
    const expiresMs = new Date(expiresAt).getTime();
    if (!Number.isNaN(expiresMs)) return Date.now() < expiresMs;
  }
  if (!requestedAt) return false;
  const requestedMs = new Date(requestedAt).getTime();
  if (Number.isNaN(requestedMs)) return false;
  return Date.now() < requestedMs + POSTPONE_GRACE_MS;
}

function mergePostponeGraceOntoEmployeeTasks() {
  const map = pruneExpiredPostponeGrace();
  for (const task of state.empTasks) {
    const serverExt = task.pendingDeadlineExtension;
    if (serverExt?.status === "pending" && postponeGraceStillActive(serverExt.requestedAt, serverExt.expiresAt)) {
      savePostponeGraceForTask(task.id, serverExt.requestedAt);
      continue;
    }
    const localRequestedAt = map[task.id];
    if (localRequestedAt && postponeGraceStillActive(localRequestedAt)) {
      task.pendingDeadlineExtension = buildPendingExtensionFromRequestedAt(
        localRequestedAt,
        serverExt?.id ?? null
      );
    }
  }
}

/** When taskOverdueDayCount first reaches MIN_DAYS (ceil day count). */
function criticalOverdueActionThresholdMs(dueAt) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return Infinity;
  return due.getTime() + (EMP_CRITICAL_OVERDUE_MIN_DAYS - 1) * 86_400_000;
}

/** Task ids the employee has updated or submitted this session (immediate gate dismiss). */
/** @type {Set<string>} */
const empCriticalOverdueSatisfiedIds = new Set();

function employeeHasActivePostponeGrace(task) {
  if (!task?.id) return false;
  const ext = task.pendingDeadlineExtension;
  if (ext?.status === "pending" && postponeGraceStillActive(ext.requestedAt, ext.expiresAt)) {
    return true;
  }
  const localRequestedAt = getLocalPostponeGraceRequestedAt(task.id);
  return postponeGraceStillActive(localRequestedAt);
}

function employeeHasActedOnCriticalOverdue(task, me = employeeMyAssignee(task)) {
  if (!task?.dueAt || !me) return false;
  if (empCriticalOverdueSatisfiedIds.has(task.id)) return true;
  if (employeeAssigneeShowsAsSubmitted(task, me)) return true;
  if (employeeHasActivePostponeGrace(task)) return true;

  const threshold = criticalOverdueActionThresholdMs(task.dueAt);

  if (me.lastSubmittedAt) {
    const submittedMs = new Date(me.lastSubmittedAt).getTime();
    if (!Number.isNaN(submittedMs) && submittedMs >= threshold) return true;
  }

  return false;
}

const THEME_STORAGE_KEY = "task-manager-theme";
const THEME_TRANSITION_MS = 450;

function getStoredTheme() {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "dark") return "dark";
  return "light";
}

function effectiveTheme() {
  return getStoredTheme();
}

function applyTheme({ animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
  }
  root.setAttribute("data-bs-theme", effectiveTheme());
  if (animate) {
    window.setTimeout(() => root.classList.remove("theme-switching"), THEME_TRANSITION_MS);
  }
}

function setThemePreference(mode) {
  if (mode !== "light" && mode !== "dark") return;
  if (mode === getStoredTheme()) return;
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme({ animate: true });
  syncThemeIconButtons();
  syncAdminThemeToggleIcons();
  onReportsThemeChange();
}

function syncAdminThemeToggleIcons() {
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  document.querySelectorAll(".js-admin-theme-toggle .material-symbols-outlined").forEach((icon) => {
    icon.textContent = isDark ? "light_mode" : "dark_mode";
  });
}

function initTheme() {
  applyTheme();
}

function syncThemeIconButtons() {
  const t = document.documentElement.getAttribute("data-bs-theme") || "light";
  document.querySelectorAll(".js-theme-light").forEach((btn) => {
    const on = t === "light";
    btn.classList.toggle("btn-primary", on);
    btn.classList.toggle("btn-outline-secondary", !on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll(".js-theme-dark").forEach((btn) => {
    const on = t === "dark";
    btn.classList.toggle("btn-primary", on);
    btn.classList.toggle("btn-outline-secondary", !on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function wireThemeIconToggles() {
  document.querySelectorAll(".js-theme-light").forEach((btn) => {
    btn.addEventListener("click", () => setThemePreference("light"));
  });
  document.querySelectorAll(".js-theme-dark").forEach((btn) => {
    btn.addEventListener("click", () => setThemePreference("dark"));
  });
  syncThemeIconButtons();
}

function wireAuthPasswordToggles(root = document) {
  const scope = root instanceof Element ? root : document;
  scope.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    if (btn.dataset.wiredPasswordToggle === "1") return;
    btn.dataset.wiredPasswordToggle = "1";
    btn.addEventListener("click", () => {
      const group = btn.closest(".auth-password-group");
      const input = group?.querySelector("input");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      const icon = btn.querySelector("i");
      if (icon) {
        icon.classList.toggle("bi-eye", !show);
        icon.classList.toggle("bi-eye-slash", show);
      }
      btn.setAttribute("aria-label", show ? tr("common.hidePassword") : tr("common.showPassword"));
      btn.setAttribute("aria-pressed", String(show));
    });
  });
}

function themeIconToggleMarkup() {
  return `<div class="theme-icon-toggles d-inline-flex gap-1 justify-content-center" role="group" aria-label="${tr("common.theme")}">
      <button type="button" class="btn btn-sm theme-icon-btn btn-outline-secondary js-theme-light" title="${tr("common.lightMode")}" aria-label="${tr("common.lightMode")}"><i class="bi bi-sun-fill" aria-hidden="true"></i></button>
      <button type="button" class="btn btn-sm theme-icon-btn btn-outline-secondary js-theme-dark" title="${tr("common.darkMode")}" aria-label="${tr("common.darkMode")}"><i class="bi bi-moon-stars-fill" aria-hidden="true"></i></button>
    </div>`;
}

function friendlyApiError(msg) {
  const s = String(msg || "Request failed");
  if (s === "Server error") {
    return "Server error. On the VPS run: cd server && npx prisma migrate deploy && npm run db:generate && pm2 restart ss2n";
  }
  return s;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    throw new Error(
      "Network error: could not reach the server. Confirm the API is running (npm run dev) on port 3000."
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && !isPublicAuthPath(path)) {
      const wasLoggedIn = !!state.user;
      state.user = null;
      renderAuthForm();
      if (wasLoggedIn) {
        showToast(tr("toast.sessionExpired"), "warning");
      }
    }
    let msg = data?.error ?? res.statusText;
    if (typeof msg === "object") msg = JSON.stringify(msg);
    const s = String(msg || "Request failed");
    if (
      (res.status === 500 || res.status === 502 || res.status === 504) &&
      (s === "Internal Server Error" || s.includes("ECONNREFUSED") || s.toLowerCase().includes("proxy error"))
    ) {
      throw new Error(
        "The API is not responding (it may have crashed — check the dev terminal and restart if needed)."
      );
    }
    throw new Error(friendlyApiError(s));
  }
  return data;
}

function showToast(message, variant = "secondary") {
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  toastHost.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** @type {Set<string>} */
const proofBlobUrls = new Set();

const EMP_SUBMISSION_TEXT_MAX = 2000;
const EMP_SUBMISSION_PDF_MAX_BYTES = 5 * 1024 * 1024;
const EMP_SUBMISSION_PDF_MAX_MB = 5;
const EMP_SUBMISSION_MAX_IMAGES = 10;
const PROGRESS_UPDATE_TEXT_MAX = 2000;
const MAX_ASSIGNMENT_ATTACHMENTS = 30;
/** @type {{ id: string, file: File, kind: string, previewUrl?: string }[]} */
let modalPendingAssignmentAttachments = [];
/** @type {string[]} */
let modalRemovedAssignmentAttachmentIds = [];
/** @type {{ id: string, kind: string, url: string, originalName?: string | null }[]} */
let modalExistingAssignmentAttachments = [];
/** @type {MediaRecorder | null} */
let taskModalVoiceRecorder = null;
/** @type {MediaStream | null} */
let taskModalVoiceStream = null;
/** @type {BlobPart[]} */
let taskModalVoiceChunks = [];
/** @type {number | null} */
let taskModalVoiceTimer = null;
/** @type {number} */
let taskModalVoiceStartedAt = 0;
/** @type {{ btnId: string, statusId: string, onSave: (file: File) => void } | null} */
let activeVoiceRecordTarget = null;
const ASSIGNMENT_VOICE_TARGET = {
  btnId: "modal-assignment-voice-btn",
  statusId: "modal-assignment-voice-status",
  onSave: (file) => addModalPendingAssignmentFiles([file]),
};
function empSubmissionRequiredMsg() {
  return tr("validation.submissionRequired");
}
function getProgressUpdateTypes() {
  return [
    {
      id: "started",
      label: tr("employee.progressType.started"),
      badge: tr("employee.progressType.startedBadge"),
      badgeClass: "text-bg-primary",
      icon: "play-circle",
      defaultMsg: tr("employee.progressType.startedDefault"),
    },
    {
      id: "in_progress",
      label: tr("employee.progressType.inProgress"),
      badge: tr("employee.progressType.inProgressBadge"),
      badgeClass: "text-bg-info",
      icon: "arrow-repeat",
      defaultMsg: tr("employee.progressType.inProgressDefault"),
    },
    {
      id: "blocked",
      label: tr("employee.progressType.blocked"),
      badge: tr("employee.progressType.blockedBadge"),
      badgeClass: "text-bg-warning",
      icon: "pause-circle",
      defaultMsg: tr("employee.progressType.blockedDefault"),
    },
    {
      id: "update",
      label: tr("employee.progressType.update"),
      badge: tr("employee.progressType.updateBadge"),
      badgeClass: "text-bg-secondary",
      icon: "chat-left-text",
      defaultMsg: "",
    },
  ];
}

function submissionUploadErrorMessage(res, rawText) {
  if (res.status === 413) {
    return tr("validation.uploadTooLargeNginx");
  }
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    if (rawText && /413|entity too large/i.test(rawText)) {
      return tr("validation.uploadTooLargeNginx");
    }
    return tr("validation.submissionFailed");
  }
  const msg = data?.error || "Submission failed";
  if (msg === "Server error") {
    return "Server error. On the VPS run: cd server && npx prisma migrate deploy && npm run db:generate && pm2 restart ss2n";
  }
  return msg;
}

function isEmpSubmissionPdfFile(file) {
  return /^application\/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || "");
}

function isEmpSubmissionAudioFile(file) {
  if (/^video\//i.test(file.type)) return false;
  if (/^audio\//i.test(file.type)) return true;
  return /\.(m4a|mp3|ogg|wav|aac)$/i.test(file.name || "");
}

function isEmpSubmissionVideoFile(file) {
  if (/^audio\//i.test(file.type)) return false;
  return /^video\//i.test(file.type) || /\.(mp4|m4v|webm|mov|mkv|avi|3gp|3g2|ogv|mpeg|mpg)$/i.test(file.name || "");
}

function isEmpSubmissionImageFile(file) {
  return /^image\/(jpeg|png|gif|webp)$/i.test(file.type);
}

function validateEmpSubmissionFile(file) {
  if (!file) return null;
  const isImage = isEmpSubmissionImageFile(file);
  const isPdf = isEmpSubmissionPdfFile(file);
  const isVideo = isEmpSubmissionVideoFile(file);
  const isAudio = isEmpSubmissionAudioFile(file);
  if (!isImage && !isPdf && !isVideo && !isAudio) {
    return tr("validation.fileTypesAllowed");
  }
  if (isPdf && file.size > EMP_SUBMISSION_PDF_MAX_BYTES) {
    return tr("validation.fileMaxSize", { max: EMP_SUBMISSION_PDF_MAX_MB });
  }
  return null;
}

function validateEmpSubmissionFileSet(files) {
  if (!files?.length) return null;
  const pdfs = files.filter(isEmpSubmissionPdfFile);
  if (pdfs.length > 0) {
    if (files.length > 1) return tr("validation.pdfAloneOrMedia");
    return validateEmpSubmissionFile(pdfs[0]);
  }
  if (files.length > EMP_SUBMISSION_MAX_IMAGES) {
    return tr("toast.maxAttachments", { max: EMP_SUBMISSION_MAX_IMAGES });
  }
  for (const file of files) {
    const err = validateEmpSubmissionFile(file);
    if (err) return err;
  }
  return null;
}

function proofResourceKind(mime, proofUrl) {
  if (mime === "application/pdf" || /\.pdf(?:\?|$)/i.test(proofUrl)) return "pdf";
  if (mime.startsWith("audio/") || /\.(webm|m4a|mp3|ogg|wav|aac)(?:\?|$)/i.test(proofUrl)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|m4v|webm|mov|mkv|avi|3gp|3g2|ogv|mpeg|mpg)(?:\?|$)/i.test(proofUrl)) {
    return "video";
  }
  if (mime.startsWith("image/")) return "image";
  return null;
}

function assignmentAttachmentKindFromFile(file) {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("audio/")) return "voice";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) return "image";
  return null;
}

function resetModalAssignmentAttachments() {
  for (const item of modalPendingAssignmentAttachments) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
  modalPendingAssignmentAttachments = [];
  modalRemovedAssignmentAttachmentIds = [];
  modalExistingAssignmentAttachments = [];
  stopTaskModalVoiceRecording(false);
  const input = document.getElementById("modal-assignment-file-input");
  if (input) input.value = "";
  renderModalAssignmentAttachmentList();
}

function setModalExistingAssignmentAttachments(task) {
  resetModalAssignmentAttachments();
  modalExistingAssignmentAttachments = (task?.assignmentAttachments ?? []).map((a) => ({ ...a }));
  renderModalAssignmentAttachmentList();
}

/** Playback louder than browser default (HTML volume max is 1; gain boosts further). */
const VOICE_NOTE_PLAYBACK_GAIN = 3.5;

/** @type {AudioContext | null} */
let voiceNoteAudioCtx = null;

function getVoiceNoteAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!voiceNoteAudioCtx || voiceNoteAudioCtx.state === "closed") {
    voiceNoteAudioCtx = new AC();
  }
  return voiceNoteAudioCtx;
}

function prepareAssignmentAudioEl(audio) {
  if (!(audio instanceof HTMLAudioElement)) return;
  audio.muted = false;
  audio.volume = 1;
  audio.setAttribute("playsinline", "");
  audio.setAttribute("controlslist", "nodownload");

  const unlock = () => {
    audio.muted = false;
    audio.volume = 1;
    const ctx = getVoiceNoteAudioContext();
    if (ctx?.state === "suspended") void ctx.resume();
  };

  if (!audio.dataset.voiceBoostWired) {
    audio.dataset.voiceBoostWired = "1";
    audio.addEventListener("play", unlock);
    audio.addEventListener("loadeddata", unlock);
  }

  if (audio.dataset.voiceBoostConnected === "1") return;
  try {
    const ctx = getVoiceNoteAudioContext();
    if (!ctx) return;
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = VOICE_NOTE_PLAYBACK_GAIN;
    source.connect(gain);
    gain.connect(ctx.destination);
    audio.dataset.voiceBoostConnected = "1";
  } catch (err) {
    console.warn("[voice] playback boost unavailable", err);
  }
}

async function resolveAssignmentVoicePlayUrl(item) {
  if (item.playUrl?.startsWith("blob:")) return item.playUrl;
  if (!item.fetchUrl) return item.playUrl || null;
  try {
    const res = await fetch(item.fetchUrl, { credentials: "include" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const mime =
      (item.mimeType || res.headers.get("content-type") || "").split(";")[0].trim() || "audio/webm";
    const blob = new Blob([buf], { type: mime.startsWith("audio/") ? mime : "audio/webm" });
    const blobUrl = URL.createObjectURL(blob);
    proofBlobUrls.add(blobUrl);
    return blobUrl;
  } catch {
    return null;
  }
}

function renderModalAssignmentAttachmentList() {
  const host = document.getElementById("modal-assignment-list");
  if (!host) return;
  const items = [
    ...modalExistingAssignmentAttachments
      .filter((a) => !modalRemovedAssignmentAttachmentIds.includes(a.id))
      .map((a) => ({
        key: `existing-${a.id}`,
        label: a.originalName || attachmentKindLabel(a.kind),
        kind: a.kind,
        mimeType: a.mimeType || null,
        playUrl: null,
        fetchUrl: a.kind === "voice" || a.kind === "audio" ? a.url : null,
        remove: () => {
          modalRemovedAssignmentAttachmentIds.push(a.id);
          renderModalAssignmentAttachmentList();
        },
      })),
    ...modalPendingAssignmentAttachments.map((a) => ({
      key: `pending-${a.id}`,
      label: a.kind === "voice" ? tr("tasks.voiceNote") : a.file.name,
      kind: a.kind,
      mimeType: a.file?.type || null,
      playUrl: a.kind === "voice" ? a.previewUrl : null,
      fetchUrl: null,
      remove: () => {
        const idx = modalPendingAssignmentAttachments.findIndex((x) => x.id === a.id);
        if (idx >= 0) {
          const [removed] = modalPendingAssignmentAttachments.splice(idx, 1);
          if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        }
        renderModalAssignmentAttachmentList();
      },
    })),
  ];
  if (!items.length) {
    host.innerHTML = `<p class="admin-task-modal-attach-empty small text-muted mb-0">${tr("tasks.noAssignmentAttachments")}</p>`;
    return;
  }
  host.innerHTML = items
    .map((item) => {
      const needsPlayer = item.kind === "voice" || item.kind === "audio";
      const player = needsPlayer
        ? `<audio class="admin-task-modal-attach-audio js-assignment-voice-audio" controls preload="auto" data-attach-key="${escapeHtml(item.key)}"></audio>`
        : "";
      return `<div class="admin-task-modal-attach-item${needsPlayer ? " admin-task-modal-attach-item--voice" : ""}" data-attach-key="${escapeHtml(item.key)}">
        <div class="admin-task-modal-attach-item-top">
          <span class="admin-task-modal-attach-icon">${attachmentKindIconHtml(item.kind)}</span>
          <span class="admin-task-modal-attach-name text-truncate">${escapeHtml(item.label)}</span>
          <button type="button" class="admin-task-modal-attach-remove js-modal-attach-remove" data-attach-key="${escapeHtml(item.key)}" aria-label="${tr("common.remove")}">${adminMsIcon("close")}</button>
        </div>
        ${player}
      </div>`;
    })
    .join("");
  host.querySelectorAll(".js-modal-attach-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-attach-key");
      const item = items.find((x) => x.key === key);
      item?.remove();
    });
  });
  host.querySelectorAll(".js-assignment-voice-audio").forEach((audio) => {
    prepareAssignmentAudioEl(audio);
    const key = audio.getAttribute("data-attach-key");
    const item = items.find((x) => x.key === key);
    if (!item) return;
    void resolveAssignmentVoicePlayUrl(item).then((url) => {
      if (!url || !audio.isConnected) return;
      audio.src = url;
      prepareAssignmentAudioEl(audio);
      audio.load();
    });
  });
}

function attachmentKindLabel(kind) {
  if (kind === "voice") return tr("tasks.voiceNote");
  if (kind === "pdf") return "PDF";
  if (kind === "video") return tr("tasks.videoAttachment");
  return tr("tasks.imageAttachment");
}

function attachmentKindIconHtml(kind) {
  if (kind === "voice") return adminMsIcon("mic");
  if (kind === "pdf") return adminMsIcon("picture_as_pdf");
  if (kind === "video") return adminMsIcon("videocam");
  return adminMsIcon("image");
}

function addModalPendingAssignmentFiles(fileList) {
  const files = [...(fileList ?? [])];
  const currentTotal =
    modalExistingAssignmentAttachments.filter((a) => !modalRemovedAssignmentAttachmentIds.includes(a.id)).length +
    modalPendingAssignmentAttachments.length;
  if (currentTotal + files.length > MAX_ASSIGNMENT_ATTACHMENTS) {
    showToast(tr("tasks.maxAssignmentAttachments", { max: MAX_ASSIGNMENT_ATTACHMENTS }), "warning");
    return;
  }
  for (const file of files) {
    const kind = assignmentAttachmentKindFromFile(file);
    if (!kind) {
      showToast(tr("tasks.unsupportedAssignmentFile"), "warning");
      continue;
    }
    const previewUrl =
      kind === "image" || kind === "voice" ? URL.createObjectURL(file) : undefined;
    modalPendingAssignmentAttachments.push({
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      kind,
      previewUrl,
    });
  }
  renderModalAssignmentAttachmentList();
}

async function uploadModalAssignmentAttachments(taskId) {
  for (const id of modalRemovedAssignmentAttachmentIds) {
    await api(`/api/tasks/${taskId}/assignment-attachments/${id}`, { method: "DELETE" });
  }
  for (const item of modalPendingAssignmentAttachments) {
    const fd = new FormData();
    fd.append("file", item.file, item.file.name);
    const res = await fetch(`/api/tasks/${taskId}/assignment-attachments`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text)?.error ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg || tr("tasks.assignmentUploadFailed"));
    }
  }
}

function formatVoiceRecordingElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateVoiceButtonUi(recording, target = activeVoiceRecordTarget || ASSIGNMENT_VOICE_TARGET) {
  const btn = document.getElementById(target.btnId);
  const status = document.getElementById(target.statusId);
  const label = btn?.querySelector("span:last-child");
  if (!btn) return;
  if (recording) {
    const elapsed = formatVoiceRecordingElapsed(Date.now() - taskModalVoiceStartedAt);
    btn.classList.add("admin-task-modal-voice-btn--recording");
    btn.setAttribute("aria-pressed", "true");
    if (label) label.textContent = tr("tasks.stopRecording", { time: elapsed });
    if (status) {
      status.classList.remove("d-none");
      status.textContent = tr("tasks.recordingInProgress", { time: elapsed });
    }
  } else {
    btn.classList.remove("admin-task-modal-voice-btn--recording");
    btn.setAttribute("aria-pressed", "false");
    if (label) label.textContent = tr("tasks.recordVoiceNote");
    if (status) {
      status.classList.add("d-none");
      status.textContent = "";
    }
  }
}

function updateTaskModalVoiceButtonUi(recording) {
  updateVoiceButtonUi(recording, ASSIGNMENT_VOICE_TARGET);
}

function clearTaskModalVoiceTimer() {
  if (taskModalVoiceTimer != null) {
    window.clearInterval(taskModalVoiceTimer);
    taskModalVoiceTimer = null;
  }
}

function voiceRecordingMimeType() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
  return "";
}

function voiceRecordingFileMeta(recorderMime) {
  const mime = (recorderMime || "audio/webm").split(";")[0].trim() || "audio/webm";
  const ext = mime.includes("mp4") ? ".m4a" : mime.includes("ogg") ? ".ogg" : ".webm";
  return { mime, ext };
}

function stopVoiceRecording(process = true) {
  clearTaskModalVoiceTimer();
  const target = activeVoiceRecordTarget || ASSIGNMENT_VOICE_TARGET;
  if (taskModalVoiceRecorder && taskModalVoiceRecorder.state !== "inactive") {
    const recorder = taskModalVoiceRecorder;
    recorder.onstop = () => {
      let saved = false;
      if (process && taskModalVoiceChunks.length) {
        const { mime, ext } = voiceRecordingFileMeta(recorder.mimeType);
        const blob = new Blob(taskModalVoiceChunks, { type: mime });
        if (blob.size > 0) {
          const file = new File([blob], `voice-note${ext}`, { type: mime });
          target.onSave?.(file);
          saved = true;
        }
      }
      taskModalVoiceChunks = [];
      taskModalVoiceRecorder = null;
      taskModalVoiceStream?.getTracks().forEach((t) => t.stop());
      taskModalVoiceStream = null;
      updateVoiceButtonUi(false, target);
      activeVoiceRecordTarget = null;
      if (process) {
        showToast(
          saved ? tr("tasks.recordingStopped") : tr("tasks.recordingTooShort"),
          saved ? "success" : "warning"
        );
      }
    };
    try {
      if (recorder.state === "recording") recorder.requestData();
    } catch {
      /* ignore */
    }
    recorder.stop();
    return;
  }
  taskModalVoiceStream?.getTracks().forEach((t) => t.stop());
  taskModalVoiceStream = null;
  taskModalVoiceRecorder = null;
  taskModalVoiceChunks = [];
  updateVoiceButtonUi(false, target);
  activeVoiceRecordTarget = null;
}

function stopTaskModalVoiceRecording(process = true) {
  stopVoiceRecording(process);
}

async function toggleVoiceRecording(target) {
  if (!target?.btnId) return;
  if (taskModalVoiceRecorder && taskModalVoiceRecorder.state === "recording") {
    if (activeVoiceRecordTarget?.btnId === target.btnId) {
      stopVoiceRecording(true);
      return;
    }
    stopVoiceRecording(false);
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showToast(tr("tasks.voiceNotSupported"), "warning");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    activeVoiceRecordTarget = target;
    taskModalVoiceStream = stream;
    taskModalVoiceChunks = [];
    const mime = voiceRecordingMimeType();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data?.size) taskModalVoiceChunks.push(e.data);
    };
    recorder.start(200);
    taskModalVoiceRecorder = recorder;
    taskModalVoiceStartedAt = Date.now();
    updateVoiceButtonUi(true, target);
    clearTaskModalVoiceTimer();
    taskModalVoiceTimer = window.setInterval(() => {
      if (taskModalVoiceRecorder?.state === "recording") {
        updateVoiceButtonUi(true, target);
      }
    }, 500);
    showToast(tr("tasks.recordingStarted"), "info");
  } catch {
    showToast(tr("tasks.voicePermissionDenied"), "warning");
    updateVoiceButtonUi(false, target);
    activeVoiceRecordTarget = null;
  }
}

async function toggleTaskModalVoiceRecording() {
  await toggleVoiceRecording(ASSIGNMENT_VOICE_TARGET);
}

function wireModalAssignmentAttachments() {
  document.getElementById("modal-assignment-file-input")?.addEventListener("change", (e) => {
    addModalPendingAssignmentFiles(e.target.files);
    e.target.value = "";
  });
  document.getElementById("modal-assignment-pick-btn")?.addEventListener("click", () => {
    document.getElementById("modal-assignment-file-input")?.click();
  });
  document.getElementById("modal-assignment-voice-btn")?.addEventListener("click", () => {
    void toggleTaskModalVoiceRecording();
  });
}

function taskAssignmentAttachmentsBadgeHtml(task) {
  const items = task.assignmentAttachments ?? [];
  if (!items.length) return "";
  const hasVoice = items.some((a) => a.kind === "voice");
  const voiceIcon = hasVoice
    ? `<span class="task-assignment-attach-voice" title="${tr("tasks.voiceNote")}">${adminMsIcon("mic")}</span>`
    : "";
  return `<button type="button" class="task-assignment-attach-btn js-view-assignment-attachments" data-task-id="${escapeHtml(task.id)}" title="${tr("tasks.viewAttachments")}">
    ${adminMsIcon("attach_file")}
    <span>${tr("tasks.attachments")}</span>
    ${voiceIcon}
  </button>`;
}

function bindAssignmentAttachmentViewers(root, findTask) {
  root.querySelectorAll(".js-view-assignment-attachments").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-task-id");
      const task = findTask(taskId);
      if (task) void openTaskAssignmentAttachmentsModal(task);
    });
  });
}

async function openTaskAssignmentAttachmentsModal(task) {
  const items = task.assignmentAttachments ?? [];
  if (!items.length) return;
  await openSubmissionDetailModal({
    title: dt(task.title),
    submissionText: null,
    attachmentItems: items,
  });
}

async function loadAttachmentResource(item) {
  const url = item.url;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) throw new Error(tr("validation.signInForFiles"));
    if (res.status === 403) throw new Error(tr("validation.noPermissionSubmission"));
    if (res.status === 410) {
      const err = new Error(tr("owner.submissionMediaUnavailable"));
      err.code = "MEDIA_MISSING";
      throw err;
    }
    if (res.status === 404) throw new Error(tr("validation.submissionNotFound"));
    throw new Error(`Could not load file (${res.status}).`);
  }
  const buf = await res.arrayBuffer();
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const itemMime = (item.mimeType || "").split(";")[0].trim().toLowerCase();
  let mime = headerMime || itemMime || "";
  let kind = item.kind === "voice" ? "audio" : item.kind;
  if (!kind || kind === "null") kind = proofResourceKind(mime, url);
  if (kind === "audio" && !mime.startsWith("audio/")) {
    mime = itemMime.startsWith("audio/") ? itemMime : "audio/webm";
  }
  if (!kind) throw new Error(tr("validation.unsupportedSubmissionFile"));
  const blob = new Blob([buf], { type: mime || "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);
  proofBlobUrls.add(blobUrl);
  return { url: blobUrl, kind, mime };
}

async function fetchProofResource(proofUrl) {
  const res = await fetch(proofUrl, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) throw new Error(tr("validation.signInForFiles"));
    if (res.status === 403) throw new Error(tr("validation.noPermissionSubmission"));
    if (res.status === 410) {
      const err = new Error(tr("owner.submissionMediaUnavailable"));
      err.code = "MEDIA_MISSING";
      throw err;
    }
    if (res.status === 404) throw new Error(tr("validation.submissionNotFound"));
    throw new Error(`Could not load submission file (${res.status}).`);
  }
  const blob = await res.blob();
  const mime = (blob.type || "").toLowerCase();
  const kind = proofResourceKind(mime, proofUrl);
  if (!kind) {
    throw new Error(tr("validation.unsupportedSubmissionFile"));
  }
  const blobUrl = URL.createObjectURL(blob);
  proofBlobUrls.add(blobUrl);
  return { url: blobUrl, kind, mime };
}

async function refreshMe() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    return true;
  } catch {
    state.user = null;
    state.companyTrial = null;
    return false;
  }
}

async function refreshCompanyTrial() {
  if (state.user?.role !== "owner") {
    state.companyTrial = null;
    return;
  }
  try {
    state.companyTrial = await api("/api/company/trial");
  } catch {
    state.companyTrial = null;
  }
}

async function switchAccountView(role) {
  const { user } = await api("/api/auth/switch-role", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  state.user = user;
  localStorage.setItem(ACCOUNT_VIEW_PREF_KEY, role);
  stopOwnerAutoSync();
  stopEmployeeReminders();
  stopChatPolling();
  await render();
}

function accountViewPickerModalHtml() {
  return `
    <div class="modal fade" id="accountViewPickerModal" tabindex="-1" aria-labelledby="accountViewPickerTitle" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h2 class="modal-title h5" id="accountViewPickerTitle">${tr("modals.accountViewPickerTitle")}</h2>
          </div>
          <div class="modal-body pt-2">
            <p class="small text-muted mb-4">${tr("modals.accountViewPickerIntro")}</p>
            <div class="d-grid gap-2">
              <button type="button" class="btn btn-primary js-account-view-pick" data-view-role="owner">
                ${adminMsIcon("admin_panel_settings")}
                <span class="ms-1">${tr("modals.openAsAdmin")}</span>
              </button>
              <button type="button" class="btn btn-outline-primary js-account-view-pick" data-view-role="employee">
                ${adminMsIcon("task_alt")}
                <span class="ms-1">${tr("modals.openAsUser")}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function ensureAccountViewPickerModal() {
  if (document.getElementById("accountViewPickerModal")) return;
  document.body.insertAdjacentHTML("beforeend", accountViewPickerModalHtml());
  document.querySelectorAll("#accountViewPickerModal .js-account-view-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-view-role");
      if (role !== "owner" && role !== "employee") return;
      localStorage.setItem(ACCOUNT_VIEW_PREF_KEY, role);
      const modalEl = document.getElementById("accountViewPickerModal");
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      void switchAccountView(role);
    });
  });
}

function showAccountViewPickerModal() {
  ensureAccountViewPickerModal();
  const modalEl = document.getElementById("accountViewPickerModal");
  if (!modalEl) return;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function applyAccountViewAfterAuth() {
  if (!state.user?.isAdmin) return true;
  ensureAccountViewPickerModal();
  const pref = localStorage.getItem(ACCOUNT_VIEW_PREF_KEY);
  if (!pref) {
    showAccountViewPickerModal();
    return false;
  }
  if (pref !== state.user.role) {
    const { user } = await api("/api/auth/switch-role", {
      method: "POST",
      body: JSON.stringify({ role: pref }),
    });
    state.user = user;
  }
  return true;
}

const PUBLIC_AUTH_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
  "/api/auth/forgot-password/send-otp",
  "/api/auth/forgot-password/verify-otp",
  "/api/auth/forgot-password/reset",
];

function isPublicAuthPath(path) {
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}?`));
}

let registerOtpCountdownTimer = null;

const registerGate = { otpVerified: false, turnstileToken: null };
const forgotGate = { otpVerified: false, turnstileToken: null };
let turnstileScriptPromise = null;
let turnstileWidgetId = null;
let forgotTurnstileWidgetId = null;
let forgotOtpCountdownTimer = null;

function updateRegisterSubmitButton() {
  const submitBtn = document.getElementById("btn-register-submit");
  if (submitBtn) submitBtn.disabled = !registerGate.otpVerified;
}

function updateSendOtpButton() {
  const sendBtn = document.getElementById("btn-send-otp");
  if (sendBtn) sendBtn.disabled = !registerGate.turnstileToken;
}

function clearTurnstileToken() {
  registerGate.turnstileToken = null;
  updateSendOtpButton();
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(tr("errors.couldNotLoadCaptcha")));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

function resetTurnstileWidget() {
  if (window.turnstile && turnstileWidgetId != null) {
    try {
      window.turnstile.remove(turnstileWidgetId);
    } catch {
      /* ignore */
    }
    turnstileWidgetId = null;
  }
  clearTurnstileToken();
}

async function wireRegisterTurnstile() {
  resetTurnstileWidget();
  const container = document.getElementById("reg-turnstile");
  if (!container) return;

  let siteKey;
  try {
    const data = await api("/api/auth/turnstile-site-key");
    siteKey = data.siteKey;
  } catch {
    container.innerHTML =
      `<p class="form-text text-danger mb-0">${tr("auth.securityUnavailable")}</p>`;
    return;
  }

  try {
    await loadTurnstileScript();
  } catch {
    container.innerHTML =
      `<p class="form-text text-danger mb-0">${tr("auth.captchaLoadFailed")}</p>`;
    return;
  }

  container.innerHTML = "";
  const turnstileSize = window.matchMedia("(max-width: 575.98px)").matches ? "compact" : "flexible";
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    size: turnstileSize,
    callback(token) {
      registerGate.turnstileToken = token;
      updateSendOtpButton();
      const hint = document.getElementById("reg-turnstile-hint");
      if (hint) hint.classList.add("d-none");
    },
    "expired-callback"() {
      clearTurnstileToken();
      showToast(tr("toast.captchaExpired"), "warning");
    },
    "error-callback"() {
      clearTurnstileToken();
      showToast(tr("toast.captchaError"), "warning");
    },
  });
  updateSendOtpButton();
}

function clearRegisterOtpTimer() {
  if (registerOtpCountdownTimer) {
    clearInterval(registerOtpCountdownTimer);
    registerOtpCountdownTimer = null;
  }
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function wireRegisterOtp() {
  clearRegisterOtpTimer();

  const emailEl = document.getElementById("reg-email");
  const otpSection = document.getElementById("reg-otp-section");
  const otpEl = document.getElementById("reg-otp");
  const sendBtn = document.getElementById("btn-send-otp");
  const verifyBtn = document.getElementById("btn-verify-otp");
  const resendBtn = document.getElementById("btn-resend-otp");
  const countdownEl = document.getElementById("reg-otp-countdown");
  const statusEl = document.getElementById("reg-otp-status");
  const submitBtn = document.getElementById("btn-register-submit");
  if (!emailEl || !otpSection || !sendBtn) return;

  let otpExpiresAt = 0;

  const setVerified = (verified) => {
    registerGate.otpVerified = verified;
    updateRegisterSubmitButton();
    if (statusEl) {
      statusEl.textContent = verified ? tr("auth.emailVerifiedStatus") : "";
      statusEl.classList.toggle("text-success", verified);
      statusEl.classList.toggle("d-none", !verified);
    }
    if (verified && otpEl) otpEl.disabled = true;
    if (verified && verifyBtn) verifyBtn.disabled = true;
  };

  const updateCountdown = () => {
    if (!countdownEl) return;
    const left = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
    if (left <= 0) {
      countdownEl.textContent = tr("auth.codeExpired");
      if (resendBtn) resendBtn.disabled = false;
      clearRegisterOtpTimer();
      return;
    }
    countdownEl.textContent = tr("auth.codeExpiresIn", { time: formatCountdown(left) });
    if (resendBtn) resendBtn.disabled = left > 0 && !registerGate.otpVerified;
  };

  const startCountdown = (expiresInSeconds) => {
    otpExpiresAt = Date.now() + expiresInSeconds * 1000;
    if (otpEl) otpEl.disabled = false;
    if (verifyBtn) verifyBtn.disabled = false;
    if (resendBtn) resendBtn.disabled = true;
    updateCountdown();
    clearRegisterOtpTimer();
    registerOtpCountdownTimer = setInterval(updateCountdown, 1000);
    if (resendBtn) resendBtn.disabled = true;
    setTimeout(() => {
      if (resendBtn && !registerGate.otpVerified) resendBtn.disabled = false;
    }, 60_000);
  };

  const getEmail = () => String(emailEl.value || "").trim().toLowerCase();

  const sendOtp = async (isResend) => {
    const email = getEmail();
    if (!email || !emailEl.checkValidity()) {
      emailEl.reportValidity();
      showToast(tr("toast.enterValidEmail"), "warning");
      return;
    }
    if (!registerGate.turnstileToken) {
      showToast(tr("toast.captchaBeforeOtp"), "warning");
      const hint = document.getElementById("reg-turnstile-hint");
      if (hint) hint.classList.remove("d-none");
      return;
    }
    const turnstileToken = registerGate.turnstileToken;
    sendBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    try {
      const data = await api("/api/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ email, turnstileToken }),
      });
      setVerified(false);
      if (otpEl) {
        otpEl.value = "";
        otpEl.disabled = false;
      }
      if (verifyBtn) verifyBtn.disabled = false;
      startCountdown(data.expiresInSeconds ?? 600);
      showToast(isResend ? tr("toast.newCodeSent") : tr("toast.verificationCodeSent"), "success");
      resetTurnstileWidget();
      void wireRegisterTurnstile();
    } catch (err) {
      showToast(err.message, "danger");
      resetTurnstileWidget();
      void wireRegisterTurnstile();
    } finally {
      updateSendOtpButton();
    }
  };

  sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    void sendOtp(false);
  });

  if (resendBtn) {
    resendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void sendOtp(true);
    });
  }

  if (verifyBtn) {
    verifyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void (async () => {
        const email = getEmail();
        const otp = String(otpEl?.value || "").replace(/\D/g, "").slice(0, 6);
        if (!email || !emailEl.checkValidity()) {
          emailEl.reportValidity();
          return;
        }
        if (otp.length !== 6) {
          showToast(tr("toast.enterSixDigitCode"), "warning");
          return;
        }
        verifyBtn.disabled = true;
        try {
          await api("/api/auth/verify-otp", {
            method: "POST",
            body: JSON.stringify({ email, otp }),
          });
          setVerified(true);
          clearRegisterOtpTimer();
          if (countdownEl) countdownEl.textContent = tr("auth.emailVerifiedShort");
          showToast(tr("toast.emailVerifiedCreate"), "success");
        } catch (err) {
          showToast(err.message, "danger");
          verifyBtn.disabled = false;
        }
      })();
    });
  }

  if (otpEl) {
    otpEl.addEventListener("input", () => {
      otpEl.value = otpEl.value.replace(/\D/g, "").slice(0, 6);
    });
  }

  emailEl.addEventListener("change", () => {
    registerGate.otpVerified = false;
    updateRegisterSubmitButton();
    clearRegisterOtpTimer();
    resetTurnstileWidget();
    void wireRegisterTurnstile();
    if (statusEl) statusEl.classList.add("d-none");
    const captchaHint = document.getElementById("reg-turnstile-hint");
    if (captchaHint) captchaHint.classList.add("d-none");
    if (otpEl) {
      otpEl.value = "";
      otpEl.disabled = true;
    }
    if (verifyBtn) verifyBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    if (countdownEl) countdownEl.textContent = tr("auth.captchaThenOtp");
  });

  setVerified(false);
}

function clearForgotOtpTimer() {
  if (forgotOtpCountdownTimer) {
    clearInterval(forgotOtpCountdownTimer);
    forgotOtpCountdownTimer = null;
  }
}

function resetForgotTurnstileWidget() {
  if (window.turnstile && forgotTurnstileWidgetId != null) {
    try {
      window.turnstile.remove(forgotTurnstileWidgetId);
    } catch {
      /* ignore */
    }
    forgotTurnstileWidgetId = null;
  }
  forgotGate.turnstileToken = null;
  const sendBtn = document.getElementById("fp-btn-send-otp");
  if (sendBtn) sendBtn.disabled = true;
}

async function wireForgotTurnstile() {
  resetForgotTurnstileWidget();
  const container = document.getElementById("fp-turnstile");
  if (!container) return;

  let siteKey;
  try {
    const data = await api("/api/auth/turnstile-site-key");
    siteKey = data.siteKey;
  } catch {
    container.innerHTML =
      `<p class="form-text text-danger mb-0">${tr("auth.securityUnavailable")}</p>`;
    return;
  }

  try {
    await loadTurnstileScript();
  } catch {
    container.innerHTML =
      `<p class="form-text text-danger mb-0">${tr("auth.captchaLoadFailed")}</p>`;
    return;
  }

  container.innerHTML = "";
  const turnstileSize = window.matchMedia("(max-width: 575.98px)").matches ? "compact" : "flexible";
  forgotTurnstileWidgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    size: turnstileSize,
    callback(token) {
      forgotGate.turnstileToken = token;
      const sendBtn = document.getElementById("fp-btn-send-otp");
      if (sendBtn) sendBtn.disabled = false;
      const hint = document.getElementById("fp-turnstile-hint");
      if (hint) hint.classList.add("d-none");
    },
    "expired-callback"() {
      forgotGate.turnstileToken = null;
      const sendBtn = document.getElementById("fp-btn-send-otp");
      if (sendBtn) sendBtn.disabled = true;
      showToast(tr("toast.captchaExpired"), "warning");
    },
    "error-callback"() {
      forgotGate.turnstileToken = null;
      const sendBtn = document.getElementById("fp-btn-send-otp");
      if (sendBtn) sendBtn.disabled = true;
      showToast(tr("toast.captchaError"), "warning");
    },
  });
}

function forgotPasswordModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="forgotPasswordModal" tabindex="-1" aria-labelledby="forgotPasswordModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered admin-emp-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          <div class="modal-header admin-emp-modal-header border-0 pb-0">
            <h2 class="admin-emp-modal-title" id="forgotPasswordModalTitle">${tr("auth.resetPassword")}</h2>
            <button type="button" class="admin-emp-modal-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
          </div>
          <div class="modal-body admin-emp-modal-body pt-2">
            <p class="text-muted small mb-3">${tr("auth.resetPasswordIntro")}</p>
            <div id="fp-step-verify">
              <div class="mb-3">
                <label class="auth-field-label" for="fp-email">${tr("common.email")}</label>
                <div class="input-group auth-input-group">
                  <span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>
                  <input class="form-control" id="fp-email" type="email" autocomplete="username" placeholder="${tr("auth.emailPlaceholder")}" required />
                </div>
              </div>
              <div class="auth-reg-verify-card mb-3">
                <div class="auth-reg-captcha-row">
                  <div class="reg-turnstile-wrap">
                    <span class="auth-reg-mini-label">${tr("auth.securityCheck")}</span>
                    <div class="reg-turnstile-viewport">
                      <div id="fp-turnstile" class="reg-turnstile"></div>
                    </div>
                    <p class="form-text text-danger d-none mb-0" id="fp-turnstile-hint" role="alert">${tr("auth.captchaBeforeCode")}</p>
                  </div>
                  <button type="button" class="btn btn-outline-primary auth-reg-action-btn auth-admin-outline" id="fp-btn-send-otp" disabled>${tr("auth.sendCode")}</button>
                </div>
                <div class="auth-reg-divider" aria-hidden="true"></div>
                <div class="auth-reg-otp-row">
                  <div class="auth-reg-otp-field">
                    <label class="auth-reg-mini-label" for="fp-otp">${tr("auth.resetCode")}</label>
                    <div class="input-group input-group-sm auth-input-group">
                      <span class="input-group-text"><i class="bi bi-shield-check" aria-hidden="true"></i></span>
                      <input class="form-control font-monospace text-center" id="fp-otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" disabled />
                    </div>
                  </div>
                  <button type="button" class="btn btn-primary auth-reg-action-btn auth-admin-submit" id="fp-btn-verify-otp" disabled>${tr("common.verify")}</button>
                </div>
                <div class="auth-reg-otp-meta">
                  <small class="text-muted" id="fp-otp-countdown">${tr("auth.captchaThenCode")}</small>
                  <button type="button" class="btn btn-sm btn-outline-secondary auth-reg-resend" id="fp-btn-resend-otp" disabled>${tr("auth.resendCode")}</button>
                </div>
                <div class="form-text text-success d-none mb-0" id="fp-otp-status" role="status"></div>
              </div>
            </div>
            <div id="fp-step-password" class="d-none">
              <div class="mb-3">
                <label class="auth-field-label" for="fp-new-password">${tr("auth.newPassword")}</label>
                <div class="input-group auth-input-group auth-password-group">
                  <span class="input-group-text"><i class="bi bi-shield-lock" aria-hidden="true"></i></span>
                  <input class="form-control" id="fp-new-password" type="password" minlength="6" autocomplete="new-password" placeholder="${tr("auth.minPassword")}" required />
                  <button type="button" class="input-group-text auth-password-toggle" data-password-toggle aria-label="${tr("common.showPassword")}" aria-pressed="false" title="${tr("common.showPassword")}">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
              <div class="mb-0">
                <label class="auth-field-label" for="fp-confirm-password">${tr("auth.confirmPassword")}</label>
                <div class="input-group auth-input-group auth-password-group">
                  <span class="input-group-text"><i class="bi bi-shield-lock" aria-hidden="true"></i></span>
                  <input class="form-control" id="fp-confirm-password" type="password" minlength="6" autocomplete="new-password" placeholder="${tr("auth.repeatPassword")}" required />
                  <button type="button" class="input-group-text auth-password-toggle" data-password-toggle aria-label="${tr("common.showPassword")}" aria-pressed="false" title="${tr("common.showPassword")}">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
              <p class="form-text text-danger d-none mb-0 mt-2" id="fp-reset-error" role="alert"></p>
            </div>
          </div>
          <div class="modal-footer admin-emp-modal-footer border-0">
            <button type="button" class="btn admin-task-modal-btn-secondary" data-bs-dismiss="modal">${tr("common.cancel")}</button>
            <button type="button" class="btn admin-task-modal-btn-save d-none" id="fp-btn-reset-password">${tr("auth.updatePassword")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function resetForgotPasswordModal() {
  forgotGate.otpVerified = false;
  forgotGate.turnstileToken = null;
  clearForgotOtpTimer();
  resetForgotTurnstileWidget();
  const emailEl = document.getElementById("fp-email");
  const otpEl = document.getElementById("fp-otp");
  const newPw = document.getElementById("fp-new-password");
  const confirmPw = document.getElementById("fp-confirm-password");
  const statusEl = document.getElementById("fp-otp-status");
  const countdownEl = document.getElementById("fp-otp-countdown");
  const errEl = document.getElementById("fp-reset-error");
  if (emailEl) emailEl.disabled = false;
  if (otpEl) {
    otpEl.value = "";
    otpEl.disabled = true;
  }
  if (newPw) newPw.value = "";
  if (confirmPw) confirmPw.value = "";
  if (statusEl) statusEl.classList.add("d-none");
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("d-none");
  }
  if (countdownEl) countdownEl.textContent = tr("auth.captchaThenCode");
  document.getElementById("fp-step-verify")?.classList.remove("d-none");
  document.getElementById("fp-step-password")?.classList.add("d-none");
  document.getElementById("fp-btn-reset-password")?.classList.add("d-none");
  document.getElementById("fp-btn-verify-otp")?.setAttribute("disabled", "");
  document.getElementById("fp-btn-resend-otp")?.setAttribute("disabled", "");
}

function wireForgotPasswordModal() {
  const modalEl = document.getElementById("forgotPasswordModal");
  if (!modalEl || modalEl.dataset.wiredForgot === "1") return;
  modalEl.dataset.wiredForgot = "1";
  wireAuthPasswordToggles(modalEl);

  const emailEl = document.getElementById("fp-email");
  const otpEl = document.getElementById("fp-otp");
  const sendBtn = document.getElementById("fp-btn-send-otp");
  const verifyBtn = document.getElementById("fp-btn-verify-otp");
  const resendBtn = document.getElementById("fp-btn-resend-otp");
  const countdownEl = document.getElementById("fp-otp-countdown");
  const statusEl = document.getElementById("fp-otp-status");
  const resetBtn = document.getElementById("fp-btn-reset-password");
  const newPw = document.getElementById("fp-new-password");
  const confirmPw = document.getElementById("fp-confirm-password");
  const errEl = document.getElementById("fp-reset-error");
  if (!emailEl || !sendBtn || !verifyBtn || !resetBtn) return;

  let otpExpiresAt = 0;

  const getEmail = () => String(emailEl.value || "").trim().toLowerCase();

  const showPasswordStep = () => {
    forgotGate.otpVerified = true;
    document.getElementById("fp-step-verify")?.classList.add("d-none");
    document.getElementById("fp-step-password")?.classList.remove("d-none");
    resetBtn.classList.remove("d-none");
    if (statusEl) {
      statusEl.textContent = tr("toast.codeVerifiedNewPassword");
      statusEl.classList.remove("d-none");
    }
    emailEl.disabled = true;
    window.setTimeout(() => newPw?.focus(), 200);
  };

  const updateCountdown = () => {
    if (!countdownEl) return;
    const left = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
    if (left <= 0) {
      countdownEl.textContent = tr("auth.codeExpired");
      if (resendBtn) resendBtn.disabled = false;
      clearForgotOtpTimer();
      return;
    }
    countdownEl.textContent = tr("auth.codeExpiresIn", { time: formatCountdown(left) });
    if (resendBtn) resendBtn.disabled = left > 0 && !forgotGate.otpVerified;
  };

  const startCountdown = (expiresInSeconds) => {
    otpExpiresAt = Date.now() + expiresInSeconds * 1000;
    if (otpEl) otpEl.disabled = false;
    verifyBtn.disabled = false;
    if (resendBtn) resendBtn.disabled = true;
    updateCountdown();
    clearForgotOtpTimer();
    forgotOtpCountdownTimer = setInterval(updateCountdown, 1000);
    window.setTimeout(() => {
      if (resendBtn && !forgotGate.otpVerified) resendBtn.disabled = false;
    }, 60_000);
  };

  const sendOtp = async (isResend) => {
    const email = getEmail();
    if (!email || !emailEl.checkValidity()) {
      emailEl.reportValidity();
      showToast(tr("toast.enterValidEmail"), "warning");
      return;
    }
    if (!forgotGate.turnstileToken) {
      showToast(tr("toast.captchaBeforeCode"), "warning");
      document.getElementById("fp-turnstile-hint")?.classList.remove("d-none");
      return;
    }
    sendBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    try {
      const data = await api("/api/auth/forgot-password/send-otp", {
        method: "POST",
        body: JSON.stringify({ email, turnstileToken: forgotGate.turnstileToken }),
      });
      forgotGate.otpVerified = false;
      document.getElementById("fp-step-password")?.classList.add("d-none");
      document.getElementById("fp-step-verify")?.classList.remove("d-none");
      resetBtn.classList.add("d-none");
      if (otpEl) {
        otpEl.value = "";
        otpEl.disabled = false;
      }
      verifyBtn.disabled = false;
      startCountdown(data.expiresInSeconds ?? 600);
      showToast(isResend ? tr("toast.newCodeSent") : data.message || tr("toast.resetCodeSent"), "success");
      resetForgotTurnstileWidget();
      void wireForgotTurnstile();
    } catch (err) {
      showToast(err.message, "danger");
      resetForgotTurnstileWidget();
      void wireForgotTurnstile();
    } finally {
      sendBtn.disabled = !forgotGate.turnstileToken;
    }
  };

  sendBtn.addEventListener("click", () => void sendOtp(false));
  resendBtn?.addEventListener("click", () => void sendOtp(true));

  verifyBtn.addEventListener("click", () => {
    void (async () => {
      const email = getEmail();
      const otp = String(otpEl?.value || "").replace(/\D/g, "").slice(0, 6);
      if (!email || !emailEl.checkValidity()) {
        emailEl.reportValidity();
        return;
      }
      if (otp.length !== 6) {
        showToast(tr("toast.enterSixDigitCode"), "warning");
        return;
      }
      verifyBtn.disabled = true;
      try {
        await api("/api/auth/forgot-password/verify-otp", {
          method: "POST",
          body: JSON.stringify({ email, otp }),
        });
        clearForgotOtpTimer();
        if (countdownEl) countdownEl.textContent = tr("auth.emailVerifiedShort");
        showPasswordStep();
        showToast(tr("toast.codeVerifiedNewPassword"), "success");
      } catch (err) {
        showToast(err.message, "danger");
        verifyBtn.disabled = false;
      }
    })();
  });

  otpEl?.addEventListener("input", () => {
    if (otpEl) otpEl.value = otpEl.value.replace(/\D/g, "").slice(0, 6);
  });

  resetBtn.addEventListener("click", () => {
    void (async () => {
      if (!forgotGate.otpVerified) {
        showToast(tr("toast.verifyEmailCodeFirst"), "warning");
        return;
      }
      const email = getEmail();
      const password = String(newPw?.value || "");
      const confirm = String(confirmPw?.value || "");
      if (password.length < 6) {
        if (errEl) {
          errEl.textContent = tr("validation.passwordMin");
          errEl.classList.remove("d-none");
        }
        return;
      }
      if (password !== confirm) {
        if (errEl) {
          errEl.textContent = tr("validation.passwordsMismatch");
          errEl.classList.remove("d-none");
        }
        return;
      }
      if (errEl) errEl.classList.add("d-none");
      resetBtn.disabled = true;
      try {
        await api("/api/auth/forgot-password/reset", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        bootstrap.Modal.getInstance(modalEl)?.hide();
        const loginEmail = document.getElementById("login-email");
        if (loginEmail) loginEmail.value = email;
        showToast(tr("toast.passwordUpdated"), "success");
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || tr("validation.resetFailed");
          errEl.classList.remove("d-none");
        } else {
          showToast(err.message, "danger");
        }
        resetBtn.disabled = false;
      }
    })();
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    resetForgotPasswordModal();
  });
}

function openForgotPasswordModal() {
  let modalEl = document.getElementById("forgotPasswordModal");
  if (!modalEl) {
    document.body.insertAdjacentHTML("beforeend", forgotPasswordModalHtml());
    modalEl = document.getElementById("forgotPasswordModal");
    wireForgotPasswordModal();
  }
  resetForgotPasswordModal();
  const loginEmail = document.getElementById("login-email");
  const fpEmail = document.getElementById("fp-email");
  if (loginEmail?.value && fpEmail) fpEmail.value = loginEmail.value.trim();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  void wireForgotTurnstile();
}

function wireRegisterPhoneDigits() {
  const el = document.getElementById("reg-phone");
  if (!el) return;
  const strip = () => {
    const digits = el.value.replace(/\D/g, "").slice(0, 10);
    if (el.value !== digits) el.value = digits;
  };
  el.addEventListener("input", strip);
  el.addEventListener("paste", () => queueMicrotask(strip));
  el.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const allowNav = [
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "Enter",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ];
    if (allowNav.includes(e.key)) return;
    if (e.key.length === 1 && /\d/.test(e.key)) {
      const s = el.selectionStart ?? 0;
      const ed = el.selectionEnd ?? 0;
      if (s === ed && el.value.length >= 10) {
        e.preventDefault();
      }
      return;
    }
    if (e.key.length === 1 && !/\d/.test(e.key)) {
      e.preventDefault();
    }
  });
}

function renderAuthForm() {
  app.innerHTML = `
    <div class="auth-page auth-shell admin-mockup-ui">
      <div class="container px-3">
        <div class="auth-wrap">
          <div class="card auth-card">
            <div class="auth-card-head sea-blue-gradient">
              <div class="auth-brand-row">
                <img class="auth-brand-logo" src="/icons/kalpanik-logo.png" alt="${tr("common.kalpanik")}" width="112" height="112" />
                <div>
                  <div class="auth-brand-title">${tr("app.title")}</div>
                  <p class="auth-brand-sub">${tr("app.brandSubtitle")}</p>
                </div>
              </div>
            </div>
            <div class="auth-card-body">
              <ul class="nav nav-pills auth-tabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active w-100" id="tab-login-btn" data-bs-toggle="pill" data-bs-target="#tab-login" type="button" role="tab" aria-controls="tab-login" aria-selected="true">${tr("auth.signIn")}</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link w-100" id="tab-register-btn" data-bs-toggle="pill" data-bs-target="#tab-register" type="button" role="tab" aria-controls="tab-register" aria-selected="false">${tr("auth.register")}</button>
                </li>
              </ul>
              <div class="tab-content">
                <div class="tab-pane fade show active" id="tab-login" role="tabpanel" aria-labelledby="tab-login-btn" tabindex="0">
                  <div class="auth-form-login">
                  <form id="form-login" novalidate>
                    <div class="mb-3">
                      <label class="auth-field-label" for="login-email">${tr("common.email")}</label>
                    <div class="input-group auth-input-group">
                      <span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>
                      <input class="form-control" id="login-email" name="email" type="email" autocomplete="username" placeholder="${tr("auth.emailPlaceholder")}" required />
                    </div>
                    </div>
                    <div class="mb-3">
                      <label class="auth-field-label" for="login-password">${tr("common.password")}</label>
                    <div class="input-group auth-input-group auth-password-group">
                      <span class="input-group-text"><i class="bi bi-key" aria-hidden="true"></i></span>
                      <input class="form-control" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
                      <button type="button" class="input-group-text auth-password-toggle" data-password-toggle aria-label="${tr("common.showPassword")}" aria-pressed="false" title="${tr("common.showPassword")}">
                        <i class="bi bi-eye" aria-hidden="true"></i>
                      </button>
                    </div>
                    </div>
                    <div class="text-end mb-3">
                      <button type="button" class="btn btn-link btn-sm p-0 auth-forgot-link" id="btn-forgot-password">${tr("auth.forgotPassword")}</button>
                    </div>
                    <button class="btn btn-primary w-100 auth-submit auth-admin-submit" type="submit">${tr("auth.signIn")}</button>
                  </form>
                  </div>
                </div>
                <div class="tab-pane fade" id="tab-register" role="tabpanel" aria-labelledby="tab-register-btn" tabindex="0">
                  <form id="form-register" class="auth-form-register">
                    <p class="auth-reg-section-title">${tr("auth.accountDetails")}</p>
                    <div class="auth-reg-grid auth-reg-grid-fields">
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-name">${tr("auth.displayName")}</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-person" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-name" name="displayName" autocomplete="name" placeholder="${tr("auth.yourName")}" required />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-email">${tr("common.email")}</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-email" name="email" type="email" autocomplete="email" placeholder="${tr("auth.emailPlaceholder")}" required />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-phone">${tr("common.phone")}</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-telephone" aria-hidden="true"></i></span>
                          <input
                            class="form-control"
                            id="reg-phone"
                            name="phone"
                            type="text"
                            inputmode="numeric"
                            autocomplete="tel"
                            maxlength="10"
                            minlength="10"
                            pattern="[0-9]{10}"
                            placeholder="${tr("auth.phonePlaceholder")}"
                            title="${tr("auth.phoneTitle")}"
                            required
                          />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-password">${tr("common.password")}</label>
                        <div class="input-group input-group-sm auth-input-group auth-password-group">
                          <span class="input-group-text"><i class="bi bi-shield-lock" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-password" name="password" type="password" minlength="6" autocomplete="new-password" placeholder="${tr("auth.minPassword")}" required />
                          <button type="button" class="input-group-text auth-password-toggle" data-password-toggle aria-label="${tr("common.showPassword")}" aria-pressed="false" title="${tr("common.showPassword")}">
                            <i class="bi bi-eye" aria-hidden="true"></i>
                          </button>
                        </div>
                      </div>
                    </div>

                    <p class="auth-reg-section-title mt-3">${tr("auth.emailVerification")}</p>
                    <div class="auth-reg-verify-card">
                      <div class="auth-reg-captcha-row">
                        <div class="reg-turnstile-wrap" id="reg-turnstile-wrap">
                          <span class="auth-reg-mini-label">${tr("auth.securityCheck")}</span>
                          <div class="reg-turnstile-viewport">
                            <div id="reg-turnstile" class="reg-turnstile"></div>
                          </div>
                          <p class="form-text text-danger d-none mb-0" id="reg-turnstile-hint" role="alert">
                            ${tr("auth.captchaBeforeOtp")}
                          </p>
                        </div>
                        <button class="btn btn-outline-primary auth-reg-action-btn auth-admin-outline" type="button" id="btn-send-otp" disabled>
                          ${tr("auth.sendOtp")}
                        </button>
                      </div>
                      <div class="auth-reg-divider" aria-hidden="true"></div>
                      <div class="auth-reg-otp-row" id="reg-otp-section">
                        <div class="auth-reg-otp-field">
                          <label class="auth-reg-mini-label" for="reg-otp">${tr("auth.verificationCode")}</label>
                          <div class="input-group input-group-sm auth-input-group">
                            <span class="input-group-text"><i class="bi bi-shield-check" aria-hidden="true"></i></span>
                            <input
                              class="form-control font-monospace text-center"
                              id="reg-otp"
                              name="otp"
                              type="text"
                              inputmode="numeric"
                              autocomplete="one-time-code"
                              maxlength="6"
                              pattern="[0-9]{6}"
                              placeholder="000000"
                              title="${tr("auth.otpTitle")}"
                              disabled
                            />
                          </div>
                        </div>
                        <button class="btn btn-primary auth-reg-action-btn auth-admin-submit" type="button" id="btn-verify-otp" disabled>
                          Verify
                        </button>
                      </div>
                      <div class="auth-reg-otp-meta">
                        <small class="text-muted" id="reg-otp-countdown">${tr("auth.captchaThenOtp")}</small>
                        <button class="btn btn-sm btn-outline-secondary auth-reg-resend" type="button" id="btn-resend-otp" disabled>
                          ${tr("auth.resendOtp")}
                        </button>
                      </div>
                      <div class="form-text text-success d-none mb-0" id="reg-otp-status" role="status"></div>
                    </div>

                    <div class="auth-reg-submit-wrap">
                      <button class="btn btn-primary auth-submit auth-reg-create-btn auth-admin-submit" type="submit" id="btn-register-submit" disabled>
                        ${tr("auth.createAccount")}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
              <div class="auth-theme-row text-center d-flex flex-column align-items-center gap-2">
                ${languageSelectorHtml({ compact: false })}
                ${themeIconToggleMarkup()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById("btn-forgot-password")?.addEventListener("click", () => {
    openForgotPasswordModal();
  });

  document.getElementById("form-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    void (async () => {
      try {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
        });
        await refreshMe();
        if (!(await applyAccountViewAfterAuth())) return;
        await render();
      } catch (err) {
        showToast(err.message, "danger");
      }
    })();
  });

  document.getElementById("form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("btn-register-submit");

    if (!registerGate.otpVerified) {
      showToast(tr("toast.verifyOtpFirst"), "warning");
      return;
    }
    if (submitBtn?.disabled) return;

    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          displayName: fd.get("displayName"),
          phone: fd.get("phone"),
          role: "employee",
        }),
      });
      sessionStorage.setItem("taskmgr-app-welcome", "1");
      await refreshMe();
      render();
    } catch (err) {
      showToast(err.message, "danger");
    }
  });

  registerGate.otpVerified = false;
  registerGate.turnstileToken = null;
  wireRegisterPhoneDigits();
  wireRegisterOtp();
  void wireRegisterTurnstile();
  wireThemeIconToggles();
  wireAuthPasswordToggles(app);
  wireLanguageSelector(app);
}

async function logout() {
  stopOwnerAutoSync();
  stopEmployeeReminders();
  stopAttendanceCheckInReminder();
  stopChatPolling();
  stopAttendanceTracking();
  stopAttendancePoll();
  destroyAdminAttendance();
  destroyAdminDeadlineExtensions();
  sessionStorage.removeItem(OWNER_TRIAL_POPUP_KEY);
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  state.user = null;
  renderAuthForm();
}

function getOpenChatParam() {
  return new URLSearchParams(window.location.search).get("openChat");
}

function handleOpenChatDeepLink() {
  const conversationId = getOpenChatParam();
  if (!conversationId || !state.user) return;
  window.history.replaceState({}, "", window.location.pathname);
  void openChatFromDeepLink(conversationId);
}

function chatInitDeps() {
  return {
    api,
    escapeHtml,
    showToast,
    bootstrap,
    getUser: () => state.user,
    isPushSupported,
    preparePushInfrastructure: () => preparePushInfrastructure(api),
    subscribeToPush: () => subscribeToPush(api),
  };
}

function wireChatNotifyHandlers() {
  if (document.documentElement.dataset.taskmgrChatNotifyWired === "1") return;
  document.documentElement.dataset.taskmgrChatNotifyWired = "1";

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "taskmgr-attendance-changed" && state.user?.role === "owner") {
        const detail = event.data.detail || {};
        const name = detail.employeeName || "Employee";
        if (detail.type === "location_tracking_off") {
          showToast(tr("attendance.adminNotifyOff", { name }), "warning");
        } else if (detail.type === "location_tracking_on") {
          showToast(tr("attendance.adminNotifyOn", { name }), "success");
        }
        if (state.ownerView === "attendance") {
          handleAttendanceLiveEvent(detail);
        }
        return;
      }
      if (event.data?.type === "taskmgr-deadline-extension-request" && state.user?.role === "owner") {
        const detail = event.data.detail || {};
        const name = detail.employeeName || "Employee";
        const taskTitle = detail.taskTitle || tr("common.task");
        showToast(tr("deadlineExtensions.adminNotifyBody", { name, task: taskTitle }), "warning");
        void refreshDeadlineExtensionNavBadge();
        if (state.ownerView === "deadline-extensions") {
          document.dispatchEvent(new CustomEvent("taskmgr:deadline-extensions-changed"));
        }
        return;
      }
      if (event.data?.type === "taskmgr-open-task" && state.user?.role === "owner") {
        const detail = event.data.detail || {};
        void focusOwnerTaskFromNotify({
          taskId: detail.taskId || "",
          listId: detail.listId || "",
          employeeId: detail.employeeId || "",
          allAssigneesDone: detail.allAssigneesDone === true || detail.allAssigneesDone === "1",
          openProgress:
            detail.openProgress === true ||
            detail.openProgress === "1" ||
            detail.type === "task_progress_update",
        });
        return;
      }
      if (event.data?.type === "taskmgr-navigate" && state.user) {
        const url = event.data.url || "";
        const chatMatch = url.match(/openChat=([^&]+)/);
        if (chatMatch?.[1]) {
          void openChatFromDeepLink(decodeURIComponent(chatMatch[1]));
          return;
        }
        if (url.includes("openAttendance=1") && state.user.role === "owner") {
          window.history.replaceState({}, "", window.location.pathname);
          navigateOwnerView("attendance");
          return;
        }
        if (url.includes("openDeadlineExtensions=1") && state.user.role === "owner") {
          window.history.replaceState({}, "", window.location.pathname);
          navigateOwnerView("deadline-extensions");
          return;
        }
        const taskMatch = url.match(/openTask=([^&]+)/);
        if (taskMatch?.[1] && state.user.role === "owner") {
          const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
          const params = new URLSearchParams(query);
          void focusOwnerTaskFromNotify({
            taskId: decodeURIComponent(taskMatch[1]),
            listId: params.get("listId") || "",
            employeeId: params.get("employeeId") || "",
            allAssigneesDone: params.get("allAssigneesDone") === "1",
            openProgress: params.get("openProgress") === "1",
          });
          return;
        }
      }
    });
  }
}

function getEmployeeNotifyParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "notify") return null;
  const taskId = params.get("taskId");
  if (!taskId) return null;
  return {
    taskId,
    title: params.get("title") || "",
    slot: params.get("slot") || "before30",
    dueAt: params.get("dueAt"),
    reopened: params.get("reopened") === "1",
  };
}

async function focusEmployeeTaskFromNotify(notify) {
  if (!notify?.taskId) return;

  if (window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }

  if (!state.empTasks.some((t) => t.id === notify.taskId)) {
    try {
      await loadEmployeeTasks();
    } catch {
      /* keep going */
    }
  }

  const task = state.empTasks.find((t) => t.id === notify.taskId);
  if (notify.reopened) {
    state.empFilter = "active";
  } else if (task && employeeAssigneeShowsAsSubmitted(task) && !employeeAwaitingFreshOccurrence(task)) {
    state.empFilter = "submitted";
  } else if (!task) {
    state.empFilter = "all";
  } else {
    state.empFilter = "active";
  }

  renderEmpListContentOnly();
  renderEmployeeMain();

  const title = notify.title || task?.title || "Your task";
  const slotLabel = notify.reopened
    ? tr("employee.taskReopenedNotify")
    : notify.slot?.startsWith("followup")
      ? tr("employee.reminderOverdue")
      : notify.slot?.startsWith("before")
        ? tr("employee.reminderDueSoonCustom", {
            count: parseInt(String(notify.slot).replace(/^before/, ""), 10) || 30,
          })
        : tr("employee.reminderDueSoon");

  requestAnimationFrame(() => {
    const row = document.querySelector(
      `tr.owner-task-row[data-task-id="${CSS.escape(notify.taskId)}"]`
    );
    if (row) {
      row.classList.add("owner-task-row--notify-highlight");
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row.classList.remove("owner-task-row--notify-highlight"), 12000);
    }
  });

  showToast(
    notify.reopened ? tr("employee.taskReopenedToast", { title }) : `${slotLabel}: ${title}`,
    notify.reopened ? "warning" : "warning"
  );
}

async function handleEmployeeNotifyDeepLink() {
  const notify = getEmployeeNotifyParams();
  if (notify) await focusEmployeeTaskFromNotify(notify);
}

function getOwnerNotifyParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "notify") return null;
  const taskId = params.get("openTask");
  if (!taskId) return null;
  return {
    taskId,
    listId: params.get("listId") || "",
    employeeId: params.get("employeeId") || "",
    allAssigneesDone: params.get("allAssigneesDone") === "1",
    openProgress: params.get("openProgress") === "1",
  };
}

async function focusOwnerTaskFromNotify(notify) {
  if (!notify?.taskId || state.user?.role !== "owner") return;

  if (window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }

  state.ownerView = "dashboard";

  if (!state.lists.length) {
    try {
      await loadLists();
    } catch {
      /* keep going */
    }
  }

  let task = null;

  const tryLoadList = async (listId) => {
    if (!listId) return null;
    state.activeListId = listId;
    try {
      await loadTasks(listId);
    } catch {
      return null;
    }
    return state.tasks.find((t) => t.id === notify.taskId) ?? null;
  };

  if (notify.listId) {
    task = await tryLoadList(notify.listId);
  }

  if (!task) {
    for (const list of state.lists) {
      task = await tryLoadList(list.id);
      if (task) break;
    }
  }

  if (!task && notify.listId) {
    task = await tryLoadList(notify.listId);
  }

  if (task?.completed) {
    state.ownerTaskFilter = "completed";
  } else if (task && taskIsSubmittedAwaitingOwner(task)) {
    state.ownerTaskFilter = "submitted";
  } else if (task && taskIsInProgress(task)) {
    state.ownerTaskFilter = "in_progress";
  } else {
    state.ownerTaskFilter = "active";
  }

  updateOwnerSidebarActiveState();
  renderOwnerMain();

  const title = task?.title ? dt(task.title) : tr("common.task");
  showToast(
    notify.openProgress
      ? tr("toast.taskProgressUpdateNotify", { title })
      : tr("toast.taskSubmittedNotify", { title }),
    "success"
  );

  const taskId = notify.taskId;
  const cssTaskId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(taskId)
      : String(taskId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  requestAnimationFrame(() => {
    const detailId = `owner-task-detail-${taskId}`;
    const detailEl = document.getElementById(detailId);
    const expandBtn = document.querySelector(`[data-bs-target="#${detailId}"].owner-task-expand-btn`);
    if (detailEl && expandBtn && !detailEl.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(detailEl).show();
      expandBtn.setAttribute("aria-expanded", "true");
      syncAdminTaskExpandIcon(expandBtn);
    }

    const row = document.querySelector(`tr.owner-task-row[data-task-id="${cssTaskId}"]`);
    if (row) {
      row.classList.add("owner-task-row--notify-highlight");
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row.classList.remove("owner-task-row--notify-highlight"), 12000);
    }
  });

  if (notify.openProgress && notify.employeeId) {
    try {
      const assignee =
        task?.assignees?.find((a) => a.id === notify.employeeId) ||
        ({ displayName: tr("common.employee") });
      await openProgressUpdatesForAssignee(
        notify.taskId,
        notify.employeeId,
        assignee.displayName || tr("common.employee")
      );
    } catch (err) {
      showToast(err?.message || tr("toast.couldNotLoadActivity"), "warning");
    }
  } else if (notify.employeeId) {
    try {
      await openSubmissionDetailForAssignee(notify.taskId, notify.employeeId);
    } catch (err) {
      showToast(err?.message || tr("toast.couldNotLoadSubmission"), "warning");
    }
  } else if (!task) {
    showToast(tr("toast.couldNotLoadSubmission"), "warning");
  }
}

async function handleOwnerNotifyDeepLink() {
  const notify = getOwnerNotifyParams();
  if (notify) await focusOwnerTaskFromNotify(notify);
}

function ownerAttendanceNavVisible() {
  return state.user?.liveLocationRequired !== false || state.user?.attendanceEnabled === true;
}

function handleOpenAttendanceDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("openAttendance") !== "1" || state.user?.role !== "owner") return;
  window.history.replaceState({}, "", window.location.pathname);
  if (!ownerAttendanceNavVisible()) {
    showToast(tr("attendance.attendanceNavOff"), "warning");
    return;
  }
  navigateOwnerView("attendance");
}

function handleOpenDeadlineExtensionsDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("openDeadlineExtensions") !== "1" || state.user?.role !== "owner") return;
  window.history.replaceState({}, "", window.location.pathname);
  navigateOwnerView("deadline-extensions");
}

async function refreshDeadlineExtensionNavBadge() {
  if (state.user?.role !== "owner") return;
  state.deadlineExtensionPendingCount = await fetchPendingDeadlineExtensionCount();
  document.querySelectorAll(".js-owner-deadline-extensions-nav").forEach((btn) => {
    const left = btn.querySelector(".admin-nav-item-left");
    if (!left) return;
    let badge = btn.querySelector(".admin-nav-badge");
    if (state.deadlineExtensionPendingCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "admin-nav-badge";
        btn.appendChild(badge);
      }
      badge.textContent = String(state.deadlineExtensionPendingCount);
      badge.setAttribute(
        "aria-label",
        tr("deadlineExtensions.pendingCount", { count: state.deadlineExtensionPendingCount })
      );
    } else {
      badge?.remove();
    }
  });
}

function handleCompanyAttendanceChanged(enabled) {
  if (state.user) state.user.attendanceEnabled = enabled;
  stopAttendanceCheckInReminder();
  if (!enabled && state.empView === "attendance") {
    state.empView = "dashboard";
  }
  if (!enabled && state.ownerView === "attendance") {
    if (state.user?.liveLocationRequired !== false) {
      ensureOwnerAttendanceLiveTab();
    } else {
      state.ownerView = "dashboard";
      destroyAdminAttendance();
    }
  } else {
    syncOwnerAttendanceTabAfterSettingsChange();
  }
  if (state.user?.role === "owner") {
    renderListContentOnly();
    if (state.ownerView === "dashboard") renderOwnerMain();
    else if (state.ownerView === "settings") openOwnerSettingsView();
    else if (state.ownerView === "company-profile") openOwnerCompanyProfileView();
    else if (state.ownerView === "manage-employees") openOwnerManageEmployeesView();
    else if (state.ownerView === "manage-locations") openOwnerManageLocationsView();
    else if (state.ownerView === "attendance") openOwnerAttendanceView();
    else if (state.ownerView === "deadline-extensions") openOwnerDeadlineExtensionsView();
  } else if (state.user?.role === "employee") {
    renderEmpListContentOnly();
    renderEmployeeChrome();
    renderEmployeeMain();
    if (enabled) startAttendanceCheckInReminder();
    syncEmployeeOverdueGate();
  }
}

function wireEmployeeNotifyHandlers() {
  if (document.documentElement.dataset.taskmgrNotifyWired === "1") return;
  document.documentElement.dataset.taskmgrNotifyWired = "1";

  document.addEventListener("taskmgr-focus-task", (event) => {
    if (state.user?.role !== "employee") return;
    void focusEmployeeTaskFromNotify(event.detail || {});
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "taskmgr-open-task" && state.user?.role === "employee") {
        const payload = event.data.detail || event.data.payload || {};
        void focusEmployeeTaskFromNotify({
          taskId: payload.taskId,
          title: payload.title,
          slot: payload.slot,
          dueAt: payload.dueAt,
          reopened: payload.type === "task_reopened" || payload.reopened === true,
        });
      }
    });
  }
}

function startEmployeeReminderSystem() {
  if (state.user?.role !== "employee") return;
  wireEmployeeNotifyHandlers();
  startEmployeeReminders(
    loadEmployeeTasks,
    () => state.empTasks,
    employeeMyAssignee,
    showToast,
    () => state.user?.id,
    api
  );
}

function empPushButtonLabel() {
  return tr("employee.enableChromeReminders");
}

function empRemindersButtonHtml() {
  if (!isPushSupported()) return "";
  const perm = Notification.permission;
  if (perm === "denied") {
    return `<p class="small text-warning mb-2 px-1">${tr("employee.notificationsBlocked")}</p>`;
  }
  return `<button type="button" class="btn btn-outline-warning w-100 mb-2 js-emp-enable-push">
    <i class="bi bi-bell me-1" aria-hidden="true"></i><span class="js-emp-push-btn-label">${empPushButtonLabel()}</span>
  </button>`;
}

function refreshEmpPushButtonLabels() {
  document.querySelectorAll(".js-emp-push-btn-label").forEach((el) => {
    el.textContent = empPushButtonLabel();
  });
  document.querySelectorAll(".js-emp-enable-push").forEach((btn) => {
    btn.disabled = false;
  });
}

async function prepareEmployeePushOnLogin() {
  if (!isPushSupported()) return;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ready = await preparePushInfrastructure(api, { force: attempt > 0 });
    refreshEmpPushButtonLabels();
    if (ready) {
      if (Notification.permission === "granted") {
        const link = await linkPushSubscriptionToServer(api);
        if (link.ok) {
          showToast(tr("toast.chromeRemindersConnected"), "success");
          document.dispatchEvent(new CustomEvent("taskmgr-push-subscribed"));
        }
      }
      return;
    }
    await new Promise((r) => window.setTimeout(r, 1500));
  }
}

const EMP_PUSH_PRIMED_KEY = "taskmgr-push-primed";

function wireEmpEnablePush(root = document) {
  root.querySelectorAll(".js-emp-enable-push").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      if (!isPushSupported()) {
        showToast(tr("toast.browserNoReminders"), "warning");
        return;
      }
      if (Notification.permission === "denied") {
        showToast(tr("toast.notificationsBlockedChrome"), "warning");
        return;
      }

      const label = btn.querySelector(".js-emp-push-btn-label");
      const finish = (result) => {
        refreshEmpPushButtonLabels();
        if (result.ok) {
          sessionStorage.removeItem(EMP_PUSH_PRIMED_KEY);
          showToast(tr("toast.chromeRemindersActive"), "success");
        } else if (result.reason === "not-ready") {
          showToast(result.message || tr("toast.pullRefreshEnable"), "warning");
        } else if (result.reason === "no-vapid") {
          showToast(tr("toast.pushNotConfigured"), "danger");
        } else if (result.reason === "denied") {
          showToast(tr("toast.allowNotifications"), "warning");
        } else {
          showToast(result.message || tr("toast.tapEnableAgain"), "warning");
        }
      };

      const primed =
        sessionStorage.getItem(EMP_PUSH_PRIMED_KEY) === "1" && isPushInfrastructureReady();

      if (primed) {
        sessionStorage.removeItem(EMP_PUSH_PRIMED_KEY);
        btn.disabled = true;
        runPushRegistrationDuringGesture(api, (result) => {
          btn.disabled = false;
          finish(result);
        });
        return;
      }

      btn.disabled = true;
      if (label) label.textContent = tr("common.settingUp");

      const runSetup = async () => {
        try {
          if (Notification.permission !== "granted") {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") {
              finish({ ok: false, reason: "denied" });
              return;
            }
          }

          const ready = await preparePushInfrastructure(api, { force: true });
          if (!ready) {
            finish({
              ok: false,
              reason: "not-ready",
              message: tr("toast.pushSetupFailed"),
            });
            return;
          }

          const link = await linkPushSubscriptionToServer(api);
          if (link.ok) {
            finish({ ok: true });
            return;
          }

          sessionStorage.setItem(EMP_PUSH_PRIMED_KEY, "1");
          showToast(tr("toast.almostDoneEnable"), "primary");
        } finally {
          btn.disabled = false;
          refreshEmpPushButtonLabels();
        }
      };

      void runSetup();
    });
  });
}

function taskHasUnreadProgressUpdates(task) {
  return (task.assignees ?? []).some((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
}

/** In progress = employee posted a progress update and has not submitted yet. */
function taskIsInProgress(task) {
  return (task.assignees ?? []).some(
    (a) => (a.progressUpdateCount ?? 0) > 0 && !a.assigneeDone
  );
}

/** @deprecated use taskIsInProgress */
function taskIsInReview(task) {
  return taskIsInProgress(task);
}

/** Employee finished from their side; waiting for owner to review / close. */
function taskIsSubmittedAwaitingOwner(task) {
  if (task?.completed) return false;
  const assignees = task?.assignees ?? [];
  if (!assignees.length) return false;
  return assignees.every((a) => a.assigneeDone);
}

/** Task where an employee assigned work to another employee. */
function taskHasEmployeeAssignment(task) {
  if ((task.delegations ?? []).length > 0) return true;
  return (task.assignees ?? []).some((a) => a.assignedBy?.displayName);
}

function ownerDashboardMetrics() {
  const tasks = state.tasks;
  const submitted = tasks.filter(taskIsSubmittedAwaitingOwner).length;
  const inProgress = tasks.filter(
    (t) => !t.completed && !taskIsSubmittedAwaitingOwner(t) && taskIsInProgress(t)
  ).length;
  const done = tasks.filter((t) => t.completed).length;
  const active = tasks.filter(
    (t) => !t.completed && !taskIsSubmittedAwaitingOwner(t) && !taskIsInProgress(t)
  ).length;
  return { total: tasks.length, active, inProgress, submitted, done };
}

function ownerProfileInitials() {
  return assigneeInitials(state.user?.displayName);
}

function adminMsIcon(name, extraClass = "") {
  return `<span class="material-symbols-outlined ${extraClass}" aria-hidden="true">${escapeHtml(name)}</span>`;
}

function adminMobileNavToggleHtml() {
  return `<button
    type="button"
    class="admin-nav-toggle d-lg-none"
    data-bs-toggle="offcanvas"
    data-bs-target="#leftNavOffcanvas"
    aria-controls="leftNavOffcanvas"
    aria-label="${tr("common.openNavMenu")}"
  >
    ${adminMsIcon("menu")}
  </button>`;
}

function dismissAdminMobileNav() {
  const el = document.getElementById("leftNavOffcanvas");
  if (!el) return;
  bootstrap.Offcanvas.getInstance(el)?.hide();
}

function ownerSidebarLogoHtml() {
  return `<img class="admin-sidebar-logo" src="/icons/kalpanik-logo.png" alt="${tr("common.kalpanik")}" width="128" height="128" />`;
}

function ownerUserAvatarHtml(sizeClass = "") {
  const initials = ownerProfileInitials();
  return `<div class="admin-user-avatar ${sizeClass}" aria-hidden="true">${escapeHtml(initials)}</div>`;
}

const KALPANIK_WEBSITE_URL = "https://kalpanik.in/";

function adminHeaderVisitUsItemHtml() {
  return `<a class="admin-header-profile-item" role="menuitem" href="${KALPANIK_WEBSITE_URL}" target="_blank" rel="noopener noreferrer">
      ${adminMsIcon("language")}
      <span>${tr("common.visitUs")}</span>
    </a>`;
}

function adminHeaderMyProfileItemHtml() {
  return `<button type="button" class="admin-header-profile-item js-open-my-profile" role="menuitem">
      ${adminMsIcon("account_circle")}
      <span>${tr("profile.myProfile")}</span>
    </button>`;
}

function adminHeaderSettingsItemHtml() {
  return `<button type="button" class="admin-header-profile-item js-open-settings" role="menuitem">
      ${adminMsIcon("settings")}
      <span>${tr("settings.menuLabel")}</span>
    </button>`;
}

function adminHeaderContactUsItemHtml() {
  return `<button type="button" class="admin-header-profile-item js-open-contact-us" role="menuitem">
      ${adminMsIcon("mail")}
      <span>${tr("contact.menuLabel")}</span>
    </button>`;
}

function ownerAdminHeaderProfileHtml() {
  const name = state.user?.displayName ? escapeHtml(dt(state.user.displayName)) : tr("common.admin");
  const ownerDashItem = state.user?.isOwner
    ? `<button type="button" class="admin-header-profile-item js-owner-dashboard-open" role="menuitem">
        ${adminMsIcon("dashboard")}
        <span>${tr("owner.ownerDashboard")}</span>
      </button>`
    : "";
  return `<div class="admin-header-profile-dropdown">
    <button
      type="button"
      class="admin-header-profile-trigger"
      title="${name}"
      aria-label="${tr("common.accountMenuFor", { name })}"
      aria-haspopup="menu"
      aria-expanded="false"
    >
      <img class="admin-header-profile-photo" src="/icons/admin-profile-avatar.png" alt="" width="48" height="48" />
    </button>
    <div class="admin-header-profile-menu" role="menu">
      ${ownerDashItem}
      ${adminHeaderContactUsItemHtml()}
      ${adminHeaderSettingsItemHtml()}
      <div class="admin-header-profile-divider" role="separator"></div>
      <button type="button" class="admin-header-profile-item admin-header-profile-item--danger js-logout" role="menuitem">
        ${adminMsIcon("logout")}
        <span>${tr("common.signOut")}</span>
      </button>
    </div>
  </div>`;
}

function closeAdminHeaderProfileMenus() {
  document.querySelectorAll(".admin-header-profile-dropdown.is-open").forEach((dropdown) => {
    dropdown.classList.remove("is-open");
    dropdown.querySelector(".admin-header-profile-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function wireAdminHeaderProfileMenu(root) {
  root.querySelectorAll(".admin-header-profile-dropdown").forEach((dropdown) => {
    const trigger = dropdown.querySelector(".admin-header-profile-trigger");
    if (!trigger || trigger.dataset.wired === "1") return;
    trigger.dataset.wired = "1";

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !dropdown.classList.contains("is-open");
      closeAdminHeaderProfileMenus();
      if (willOpen) {
        dropdown.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });

    dropdown.querySelectorAll(".admin-header-profile-item").forEach((item) => {
      item.addEventListener("click", () => closeAdminHeaderProfileMenus());
    });
  });

  root.querySelectorAll(".js-admin-theme-toggle").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      toggleAdminTheme();
    });
  });

  root.querySelectorAll(".js-logout").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", logout);
  });

  root.querySelectorAll(".js-switch-account-view").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-view-role");
      if (role === "owner" || role === "employee") void switchAccountView(role);
    });
  });

  root.querySelectorAll(".js-open-my-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      void openMyProfileModal();
    });
  });

  root.querySelectorAll(".js-open-company-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      if (!state.user?.isOwner) {
        showToast(tr("owner.ownerDashboardOwnersOnly"), "warning");
        return;
      }
      navigateOwnerView("company-profile");
    });
  });

  root.querySelectorAll(".js-open-contact-us").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      openContactUsModal();
    });
  });

  wireSettingsOpen(root);
}

function wireSettingsOpen(root = document) {
  root.querySelectorAll(".js-open-settings").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      if (state.user?.role === "owner") {
        navigateOwnerView("settings");
      } else {
        dismissEmpMobileNav();
        state.empView = "settings";
        renderEmployeeMain();
      }
    });
  });
}

function ensureAdminHeaderProfileMenuDocListener() {
  if (state.adminProfileMenuDocClickWired) return;
  state.adminProfileMenuDocClickWired = true;
  document.addEventListener("click", closeAdminHeaderProfileMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAdminHeaderProfileMenus();
  });
}

function ownerRecurrenceShortLabel(task) {
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "none") return tr("owner.recurrenceNoRepeat");
  if (recurrence === "daily") return tr("owner.recurrenceDaily");
  if (recurrence === "weekly") return tr("owner.recurrenceWeekly");
  if (recurrence === "monthly") return tr("owner.recurrenceMonthly");
  if (recurrence === "yearly") return tr("owner.recurrenceYearly");
  if (recurrence === "custom" && task.recurrenceRule && typeof task.recurrenceRule === "object") {
    const rule = task.recurrenceRule;
    const every = Math.max(1, Number(rule.every) || 1);
    const unit = rule.unit || "day";
    if (unit === "month" && every === 3) return tr("owner.recurrenceQuarterly");
    if (unit === "week" && every === 1) return tr("owner.recurrenceWeekly");
    if (unit === "day" && every === 1) return tr("owner.recurrenceDaily");
    return formatCustomRecurrenceFrequency(rule);
  }
  const pattern = formatEmpRecurrencePattern(task);
  return pattern || tr("owner.recurrenceCustom");
}

function ownerRecurrenceCellHtml(task) {
  const label = ownerRecurrenceShortLabel(task);
  const isNone = (task.recurrence ?? "none") === "none";
  const cls = isNone ? "admin-recurrence-pill--none" : "admin-recurrence-pill--repeat";
  const repeatIcon = isNone ? "" : adminMsIcon("repeat", "admin-recurrence-icon");
  return `<span class="admin-recurrence-pill ${cls}">${repeatIcon}${escapeHtml(label)}</span>`;
}

function formatTaskDuration(minutes) {
  if (minutes == null || minutes <= 0) return "";
  if (minutes % (24 * 60) === 0 && minutes >= 24 * 60) {
    const days = minutes / (24 * 60);
    const key = days === 1 ? "common.durationDisplayDays_one" : "common.durationDisplayDays_other";
    return tr(key, { count: days });
  }
  if (minutes % 60 === 0 && minutes >= 60) {
    return tr("common.durationDisplayHours", { count: minutes / 60 });
  }
  return tr("common.durationDisplayMinutes", { count: minutes });
}

function parseDurationMinutesFromModal() {
  const valueEl = document.getElementById("modal-duration-value");
  const unitEl = document.getElementById("modal-duration-unit");
  const raw = String(valueEl?.value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = unitEl?.value || "hours";
  if (unit === "minutes") return Math.min(525600, Math.round(n));
  if (unit === "days") return Math.min(525600, Math.round(n * 24 * 60));
  return Math.min(525600, Math.round(n * 60));
}

function fillModalDurationFields(task) {
  const valueEl = document.getElementById("modal-duration-value");
  const unitEl = document.getElementById("modal-duration-unit");
  if (!valueEl || !unitEl) return;
  const minutes = task?.durationMinutes;
  if (minutes == null || minutes <= 0) {
    valueEl.value = "";
    unitEl.value = "hours";
    return;
  }
  if (minutes % (24 * 60) === 0 && minutes >= 24 * 60) {
    unitEl.value = "days";
    valueEl.value = String(minutes / (24 * 60));
    return;
  }
  if (minutes % 60 === 0 && minutes >= 60) {
    unitEl.value = "hours";
    valueEl.value = String(minutes / 60);
    return;
  }
  unitEl.value = "minutes";
  valueEl.value = String(minutes);
}

const REMINDER_BEFORE_OPTIONS = [30, 60, 180, 360, 1440, 2880, 4320];

function normalizeReminderBeforeMinutes(value) {
  const n = Number(value);
  if (REMINDER_BEFORE_OPTIONS.includes(n)) return n;
  return 30;
}

function parseReminderBeforeMinutesFromModal() {
  if (!document.getElementById("modal-due")?.value?.trim()) return null;
  const raw = document.getElementById("modal-reminder-before")?.value ?? "30";
  return normalizeReminderBeforeMinutes(parseInt(raw, 10));
}

function fillModalReminderFields(task) {
  const sel = document.getElementById("modal-reminder-before");
  if (!sel) return;
  sel.value = String(normalizeReminderBeforeMinutes(task?.reminderBeforeMinutes));
  syncModalReminderRowVisibility();
}

function syncModalReminderRowVisibility() {
  const row = document.getElementById("modal-reminder-wrap");
  const hasDue = !!(document.getElementById("modal-due")?.value?.trim());
  row?.classList.toggle("d-none", !hasDue);
}

function taskDurationMetaHtml(minutes) {
  const label = formatTaskDuration(minutes);
  if (!label) return "";
  return `<div class="admin-task-duration-meta small text-muted mt-1">
    <i class="bi bi-hourglass-split me-1" aria-hidden="true"></i>${escapeHtml(label)}
  </div>`;
}

function formatOwnerDeadlineTimeHtml(due, allDay) {
  if (allDay) {
    return `<span class="admin-deadline-time">${escapeHtml(tr("common.allDay"))}</span>`;
  }
  const timeStr = formatTime24(due);
  const dtAttr = escapeHtml(due.toISOString().slice(0, 19));
  return `<time class="admin-deadline-time tabular-nums" datetime="${dtAttr}">${escapeHtml(timeStr)}</time>`;
}

function wrapOwnerDeadlineHtml(primaryHtml, due, allDay) {
  return `<div class="admin-deadline-wrap">${primaryHtml}${formatOwnerDeadlineTimeHtml(due, allDay)}</div>`;
}

function formatOwnerTaskDeadlineMock(task) {
  if (!task.dueAt) return `<span class="admin-deadline admin-deadline--none">—</span>`;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return `<span class="admin-deadline admin-deadline--none">—</span>`;

  const allDay = task.allDay === true;
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "weekly") {
    const weekday = due.toLocaleDateString(dateLocale(), { weekday: "long" });
    return wrapOwnerDeadlineHtml(
      `<span class="admin-deadline">${escapeHtml(tr("owner.deadlineEvery", { weekday }))}</span>`,
      due,
      allDay
    );
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfTomorrow = new Date(startOfTomorrow);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

  const diffMs = due.getTime() - now.getTime();
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(due, startOfTomorrow) || (diffMs > 0 && diffMs <= 36 * 60 * 60 * 1000 && !isSameDay(due, startOfToday))) {
    return wrapOwnerDeadlineHtml(
      `<span class="admin-deadline admin-deadline--urgent">${escapeHtml(tr("owner.deadlineTomorrowShort"))}</span>`,
      due,
      allDay
    );
  }
  if (isSameDay(due, startOfToday) && diffMs >= 0) {
    return wrapOwnerDeadlineHtml(
      `<span class="admin-deadline admin-deadline--urgent">${escapeHtml(tr("owner.deadlineTodayShort"))}</span>`,
      due,
      allDay
    );
  }

  const dateStr = due.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" });
  const isUrgent = diffMs >= 0 && diffMs <= 48 * 60 * 60 * 1000;
  const cls = isUrgent ? " admin-deadline--urgent" : "";
  return wrapOwnerDeadlineHtml(`<span class="admin-deadline${cls}">${escapeHtml(dateStr)}</span>`, due, allDay);
}

function formatTrialDate(date) {
  return date.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" });
}

function ownerTrialTopBannerHtml() {
  const info = ownerTrialStatusInfo();
  if (info.isExpired) {
    const endStr = info.end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<div class="admin-trial-banner admin-trial-banner--expired">${tr("owner.trialEnded", { date: endStr })}</div>`;
  }
  if (!info.hasStarted) return "";
  const endStr = info.end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `<div class="admin-trial-banner">${tr("owner.trialEnds", { days: info.daysRemaining, dayLabel: info.daysRemaining === 1 ? tr("owner.day") : tr("owner.days"), date: endStr })}</div>`;
}

function empMobileNavToggleHtml() {
  return `<button
    type="button"
    class="admin-nav-toggle d-lg-none"
    data-bs-toggle="offcanvas"
    data-bs-target="#empNavOffcanvas"
    aria-controls="empNavOffcanvas"
    aria-label="${tr("common.openNavMenu")}"
  >
    ${adminMsIcon("menu")}
  </button>`;
}

function dismissEmpMobileNav() {
  const el = document.getElementById("empNavOffcanvas");
  if (!el) return;
  bootstrap.Offcanvas.getInstance(el)?.hide();
}

function employeeAdminHeaderProfileHtml() {
  const name = state.user?.displayName ? escapeHtml(dt(state.user.displayName)) : tr("common.employee");
  const apkUrl = employeeApkDownloadUrl();
  const playStore = kalpanikPlayStoreUrl();
  const apkItem = `<a class="admin-header-profile-item" role="menuitem" href="${escapeHtml(apkUrl)}" download="kalpanik-reminder.apk">
      ${adminMsIcon("android")}
      <span>${tr("employee.downloadApk")}</span>
    </a>`;
  const playItem = playStore
    ? `<a class="admin-header-profile-item" role="menuitem" href="${escapeHtml(playStore)}" target="_blank" rel="noopener noreferrer">
        ${adminMsIcon("shop")}
        <span>${tr("employee.getPlayStore")}</span>
      </a>`
    : "";
  return `<div class="admin-header-profile-dropdown">
    <button
      type="button"
      class="admin-header-profile-trigger"
      title="${name}"
      aria-label="${tr("common.accountMenuFor", { name })}"
      aria-haspopup="menu"
      aria-expanded="false"
    >
      <img class="admin-header-profile-photo" src="/icons/admin-profile-avatar.png" alt="" width="48" height="48" />
    </button>
    <div class="admin-header-profile-menu" role="menu">
      ${apkItem}
      ${playItem}
      ${adminHeaderContactUsItemHtml()}
      ${adminHeaderSettingsItemHtml()}
      <div class="admin-header-profile-divider" role="separator"></div>
      <button type="button" class="admin-header-profile-item admin-header-profile-item--danger js-logout" role="menuitem">
        ${adminMsIcon("logout")}
        <span>${tr("common.signOut")}</span>
      </button>
    </div>
  </div>`;
}

function employeeKpiCardHtml(filterKey, label, msIcon, count, total, activeClass = "") {
  const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : count > 0 ? 100 : 8;
  const pressed = state.empFilter === filterKey;
  return `<button type="button" class="admin-kpi-card admin-kpi-card--filter${activeClass}" data-emp-filter-kpi="${filterKey}" aria-pressed="${pressed}">
    <div class="admin-kpi-card-body">
      <div class="admin-kpi-card-icon">${adminMsIcon(msIcon)}</div>
      <div class="admin-kpi-card-num tabular-nums">${count}</div>
    </div>
    <div class="admin-kpi-card-label">${escapeHtml(label)}</div>
    <div class="admin-kpi-bar" aria-hidden="true"><div class="admin-kpi-bar-fill" style="width: ${pct}%"></div></div>
  </button>`;
}

function ownerKpiCardHtml(filterKey, label, msIcon, count, total, activeClass = "") {
  const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : count > 0 ? 100 : 8;
  const pressed = state.ownerTaskFilter === filterKey;
  return `<button type="button" class="admin-kpi-card admin-kpi-card--filter${activeClass}" data-owner-filter="${filterKey}" aria-pressed="${pressed}">
    <div class="admin-kpi-card-body">
      <div class="admin-kpi-card-icon">${adminMsIcon(msIcon)}</div>
      <div class="admin-kpi-card-num tabular-nums">${count}</div>
    </div>
    <div class="admin-kpi-card-label">${escapeHtml(label)}</div>
    <div class="admin-kpi-bar" aria-hidden="true"><div class="admin-kpi-bar-fill" style="width: ${pct}%"></div></div>
  </button>`;
}

function ownerFilteredTasks() {
  // Normalize removed / renamed filters left in memory from older sessions
  if (state.ownerTaskFilter === "employee_assigned") state.ownerTaskFilter = "active";
  if (state.ownerTaskFilter === "in_review") state.ownerTaskFilter = "in_progress";

  const tasks = state.tasks;
  if (isAllTasksList(state.activeListId) && state.ownerTaskFilter === "active") {
    return tasks.filter(
      (t) => !t.completed && !taskIsSubmittedAwaitingOwner(t) && !taskIsInProgress(t)
    );
  }
  if (state.ownerTaskFilter === "completed") {
    return tasks.filter((t) => t.completed);
  }
  if (state.ownerTaskFilter === "submitted") {
    return tasks.filter(taskIsSubmittedAwaitingOwner);
  }
  if (state.ownerTaskFilter === "in_progress") {
    return tasks.filter(
      (t) => !t.completed && !taskIsSubmittedAwaitingOwner(t) && taskIsInProgress(t)
    );
  }
  return tasks.filter(
    (t) => !t.completed && !taskIsSubmittedAwaitingOwner(t) && !taskIsInProgress(t)
  );
}

function sortOwnerTasksForDisplay(tasks) {
  if (state.ownerTaskFilter === "completed") {
    return [...tasks].sort(compareCompletedTasksRecentFirst);
  }
  if (isAllTasksList(state.activeListId)) {
    return sortTasksByDeadlineClosest(tasks);
  }
  return sortTasksByRecurrenceThenCreated(tasks);
}

function ownerTaskRowPriorityClass(task) {
  return task.highPriority ? " owner-task-row--high-priority" : "";
}

function setOwnerTaskFilter(filter) {
  if (
    filter !== "active" &&
    filter !== "completed" &&
    filter !== "in_progress" &&
    filter !== "submitted" &&
    filter !== "in_review" && // legacy
    filter !== "employee_assigned" // legacy (removed KPI)
  ) {
    return;
  }
  if (filter === "in_review") filter = "in_progress";
  if (filter === "employee_assigned") filter = "active";
  state.ownerTaskFilter = filter;
  markOwnerNavBusy(350);
  requestAnimationFrame(() => renderOwnerMain());
}

function ownerEmployeesCellHtml(task) {
  const assignees = task.assignees ?? [];
  const empChains = assignees
    .filter((a) => a.assignedBy?.displayName)
    .map((a) => ({ from: a.assignedBy.displayName, to: a.displayName }));
  if (empChains.length) {
    return `<div class="owner-emp-assign-chains d-flex flex-column align-items-stretch gap-1">${empChains
      .map((c) => {
        const label = `${c.from} → ${c.to}`;
        return `<span class="owner-emp-chain-line small" title="${escapeHtml(label)}">${escapeHtml(c.from)} <span class="owner-emp-chain-arrow text-muted" aria-hidden="true">→</span> ${escapeHtml(c.to)}</span>`;
      })
      .join("")}</div>`;
  }
  const nAssigned = assignees.length;
  const nDone = assignees.filter((a) => assigneeShowsSubmittedForOwner(a)).length;
  if (nAssigned === 0) {
    return `<span class="owner-task-unassigned fw-bold text-danger">${tr("common.unassigned")}</span>`;
  }
  return `<span class="text-muted me-1"><i class="bi bi-people" aria-hidden="true"></i></span><span class="tabular-nums">${nDone}\u00a0/\u00a0${nAssigned}</span>`;
}

function taskDescriptionPreviewWords(text, maxWords = 2) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function empTaskDescriptionBoxHtml(notesRaw, taskId, taskTitle) {
  if (!notesRaw) {
    return `<div class="owner-task-desc-box emp-task-desc-box emp-task-desc-box--empty small text-muted fst-italic mb-0">${tr("common.noDescription")}</div>`;
  }
  const displayNotes = dt(notesRaw);
  const displayTitle = dt(taskTitle || "");
  const wordCount = displayNotes.split(/\s+/).filter(Boolean).length;
  const preview = taskDescriptionPreviewWords(displayNotes, 2);
  if (wordCount <= 2) {
    return `<div class="owner-task-desc-box emp-task-desc-box owner-task-desc-box--static small text-body-secondary mb-0">${escapeHtml(displayNotes)}</div>`;
  }
  return `<button type="button" class="owner-task-desc-box emp-task-desc-box owner-task-desc-box--clickable js-emp-desc-popup small text-body-secondary mb-0" data-full="${escapeHtml(notesRaw)}" data-task-title="${escapeHtml(taskTitle || "")}" data-task-id="${escapeHtml(taskId)}" aria-label="${tr("common.readFullDescription")}">
    <span class="owner-task-desc-preview emp-task-desc-preview">${escapeHtml(preview)}</span>
    <i class="bi bi-arrows-fullscreen emp-task-desc-popup-icon" aria-hidden="true"></i>
  </button>`;
}

function bindEmpDescriptionPopups(root) {
  root.querySelectorAll(".js-emp-desc-popup").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const full = btn.getAttribute("data-full") || "";
      const taskTitle = btn.getAttribute("data-task-title") || "";
      if (full) openTaskDescriptionModal(dt(full), dt(taskTitle));
    });
  });
}

function ownerTaskDescriptionDetailHtml(notes) {
  const full = (notes || "").trim().replace(/\s+/g, " ");
  if (!full) {
    return `<p class="owner-task-desc-detail small text-muted fst-italic mb-0">${tr("common.noDescriptionDot")}</p>`;
  }
  return `<p class="owner-task-desc-detail small text-body-secondary mb-0 text-break">${escapeHtml(full)}</p>`;
}

function taskDescriptionModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="taskDescriptionModal" tabindex="-1" aria-labelledby="taskDescriptionModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg admin-emp-modal-dialog admin-desc-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          ${adminEmpModalHeaderHtml("taskDescriptionModalTitle", tr("common.description"))}
          <div class="admin-emp-modal-body admin-desc-modal-body">
            <p class="admin-emp-desc-modal-text mb-0" id="taskDescriptionModalBody"></p>
          </div>
          <div class="admin-emp-modal-footer">
            <div class="admin-emp-modal-footer-actions">
              <button type="button" class="admin-task-modal-btn-save" data-bs-dismiss="modal">${tr("common.close")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function openTaskDescriptionModal(fullText, taskTitle = "") {
  const modalEl = document.getElementById("taskDescriptionModal");
  const bodyEl = document.getElementById("taskDescriptionModalBody");
  const titleEl = document.getElementById("taskDescriptionModalTitle");
  if (!modalEl || !bodyEl) return;
  bodyEl.textContent = fullText;
  if (titleEl) {
    titleEl.textContent = taskTitle ? tr("common.descriptionDash", { title: taskTitle }) : tr("common.description");
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function bindOwnerDescriptionPopups(root) {
  root.querySelectorAll(".js-owner-desc-popup").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const full = btn.getAttribute("data-full") || "";
      const taskTitle = btn.getAttribute("data-task-title") || "";
      if (full) openTaskDescriptionModal(dt(full), dt(taskTitle));
    });
  });
}

function leftNavInner() {
  return `
    <div class="owner-sidebar admin-sidebar d-flex flex-column h-100">
      <div class="admin-sidebar-profile">
        ${ownerSidebarLogoHtml()}
        <div class="admin-sidebar-brand-title">${tr("app.title")}</div>
      </div>
      <button type="button" class="admin-create-task-btn js-owner-create-task">
        ${adminMsIcon("add")}
        ${tr("nav.createTask")}
      </button>
      <nav class="admin-sidebar-nav" aria-label="${tr("nav.dashboardSections")}">
        <div class="js-emp-assign-list-host owner-emp-assign-nav"></div>
        ${teamChatSidebarNavItemHtml()}
        ${ownerReportsNavItemHtml(state.ownerView === "reports")}
        ${ownerAttendanceNavVisible() ? ownerAttendanceNavItemHtml(state.ownerView === "attendance") : ""}
        ${ownerDeadlineExtensionsNavItemHtml(state.ownerView === "deadline-extensions", state.deadlineExtensionPendingCount)}
      </nav>
      <div class="admin-your-lists-section">
        <div class="admin-your-lists-head">
          <span>${tr("nav.yourLists")}</span>
          <button type="button" class="admin-your-lists-add js-new-list" aria-label="${tr("nav.newList")}" title="${tr("nav.newList")}">
            ${adminMsIcon("add")}
          </button>
        </div>
        <div class="list-group list-group-flush owner-list-nav js-list-host"></div>
        <div class="admin-your-lists-footer js-all-tasks-host"></div>
      </div>
    </div>`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localDateParts(d) {
  return {
    y: d.getFullYear(),
    m: pad2(d.getMonth() + 1),
    day: pad2(d.getDate()),
    hh: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
  };
}

/** Date used for repeat labels: task due date in the modal, or today if no date set. */
function dateFromModalDueInput() {
  const dateStr = document.getElementById("modal-due")?.value?.trim();
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }
  return new Date();
}

function ordinalDayOfMonth(day) {
  const n = Number(day);
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"];
  return `${n}${suffix[n % 10] || "th"}`;
}

function formatIsoDateShort(isoStr) {
  if (!isoStr) return "";
  const s = String(isoStr).slice(0, 10);
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatCustomRecurrenceFrequency(rule) {
  if (!rule) return tr("owner.recurrenceCustom");
  const every = Math.max(1, Number(rule.every) || 1);
  const unit = rule.unit || "day";
  const unitWord = { day: tr("common.day"), week: tr("common.week"), month: tr("common.month"), year: tr("common.year") }[unit] || unit;
  return every === 1 ? tr("owner.everyUnit", { unit: unitWord }) : tr("owner.everyNUnits", { count: every, unit: unitWord });
}

function formatCustomRecurrenceRuleLabel(rule, dueAtIso) {
  if (!rule) return tr("owner.recurrenceCustom");
  const startIso = rule.startDate || (dueAtIso ? String(dueAtIso).slice(0, 10) : "");
  let label = formatCustomRecurrenceFrequency(rule);
  if (rule.endType === "on" && rule.endOn) {
    const from = formatIsoDateShort(startIso);
    const to = formatIsoDateShort(rule.endOn);
    label = from && to ? `${label} · ${from} → ${to}` : `${label} · until ${formatIsoDateShort(rule.endOn)}`;
  } else if (rule.endType === "after" && rule.endAfterOccurrences) {
    label += ` · ${rule.endAfterOccurrences} times`;
    if (startIso) label += ` from ${formatIsoDateShort(startIso)}`;
  } else if (startIso) {
    label += ` · from ${formatIsoDateShort(startIso)}`;
  }
  return label;
}

function syncModalCustomRepeatUi() {
  const card = document.getElementById("modal-custom-repeat-card");
  const repeatEl = document.getElementById("modal-repeat");
  const dueLabel = document.querySelector('label[for="modal-due"]');
  const dueWrap = document.getElementById("modal-due-wrap");
  const endWrap = document.getElementById("modal-custom-end-wrap");
  const endDisplay = document.getElementById("modal-custom-end-display");
  if (!card || !repeatEl) return;

  const isCustom = repeatEl.value === "custom" && pendingCustomRecurrence;
  if (!isCustom) {
    card.classList.add("d-none");
    if (dueLabel) dueLabel.textContent = tr("common.date");
    if (dueWrap) {
      dueWrap.classList.remove("col-12");
      dueWrap.classList.add("col-sm-6");
    }
    if (endWrap) endWrap.classList.add("d-none");
    return;
  }

  const rule = pendingCustomRecurrence;
  const dueIso = document.getElementById("modal-due")?.value || rule.startDate || "";
  const freqEl = document.getElementById("modal-custom-repeat-freq");
  const fromEl = document.getElementById("modal-custom-repeat-from");
  const toEl = document.getElementById("modal-custom-repeat-to");
  const metaEl = document.getElementById("modal-custom-repeat-meta");
  const rangeEl = document.getElementById("modal-custom-repeat-range");

  if (freqEl) freqEl.textContent = formatCustomRecurrenceFrequency(rule);
  if (fromEl) fromEl.textContent = formatIsoDateShort(dueIso) || "—";

  let toText = tr("common.noEnd");
  if (rule.endType === "on" && rule.endOn) {
    toText = formatIsoDateShort(rule.endOn);
    if (dueLabel) dueLabel.textContent = tr("common.from");
    if (dueWrap) {
      dueWrap.classList.remove("col-12");
      dueWrap.classList.add("col-sm-6");
    }
    if (endWrap) endWrap.classList.remove("d-none");
    if (endDisplay) endDisplay.value = String(rule.endOn).slice(0, 10);
  } else {
    if (dueLabel) dueLabel.textContent = tr("common.starts");
    if (dueWrap) {
      dueWrap.classList.remove("col-sm-6");
      dueWrap.classList.add("col-12");
    }
    if (endWrap) endWrap.classList.add("d-none");
    if (rule.endType === "after" && rule.endAfterOccurrences) {
      toText = tr("owner.afterNTimes", { count: rule.endAfterOccurrences });
    }
  }

  if (toEl) toEl.textContent = toText;
  if (rangeEl) {
    rangeEl.classList.toggle(
      "modal-custom-repeat-card__range--open",
      rule.endType === "never" && !rule.endAfterOccurrences
    );
  }

  const time = document.getElementById("modal-due-time")?.value || rule.startTime || "";
  const allDay = document.getElementById("modal-all-day")?.checked;
  const metaParts = [];
  if (!allDay && time) metaParts.push(tr("owner.atTime", { time }));
  if (metaEl) {
    metaEl.textContent = metaParts.join(" · ");
    metaEl.classList.toggle("d-none", metaParts.length === 0);
  }

  card.classList.remove("d-none");
}

function refreshModalRepeatLabels() {
  const sel = document.getElementById("modal-repeat");
  if (!sel) return;
  const current = sel.value;
  const d = dateFromModalDueInput();
  const weekday = d.toLocaleDateString(dateLocale(), { weekday: "long" });
  const monthLong = d.toLocaleDateString(dateLocale(), { month: "long" });
  const ord = ordinalDayOfMonth(d.getDate());
  const dueIso = document.getElementById("modal-due")?.value || "";

  const labels = {
    none: tr("owner.repeatDoesNot"),
    daily: tr("owner.recurrenceDaily"),
    weekly: tr("owner.repeatWeeklyOn", { weekday }),
    monthly: tr("owner.repeatMonthlyOn", { ordinal: ord }),
    yearly: tr("owner.repeatYearlyOn", { month: monthLong, ordinal: ord }),
    custom:
      current === "custom" && pendingCustomRecurrence
        ? formatCustomRecurrenceFrequency(pendingCustomRecurrence)
        : tr("owner.repeatCustomEllipsis"),
  };

  for (const opt of sel.options) {
    if (labels[opt.value]) opt.textContent = labels[opt.value];
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  syncModalCustomRepeatUi();
}

function formatOwnerTaskDeadline(task) {
  if (!task.dueAt) return `<span class="text-muted">—</span>`;
  const startIso = task.dueAt.slice(0, 10);
  const rule = task.recurrence === "custom" && task.recurrenceRule ? task.recurrenceRule : null;
  if (rule?.endType === "on" && rule.endOn) {
    const endIso = String(rule.endOn).slice(0, 10);
    const from = formatIsoDateShort(rule.startDate || startIso);
    const to = formatIsoDateShort(endIso);
    return `<span class="text-body tabular-nums" title="${tr("owner.customRepeatTitle", { from, to })}">${escapeHtml(from)} → ${escapeHtml(to)}</span>`;
  }
  return `<span class="text-body tabular-nums">${escapeHtml(startIso)}</span>`;
}

function getBrowserDueTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function buildDueAtFromModal() {
  const dateStr = document.getElementById("modal-due").value;
  if (!dateStr) return null;
  const allDay = document.getElementById("modal-all-day").checked;
  if (allDay) {
    return `${dateStr}T12:00:00.000Z`;
  }
  const timeStr = document.getElementById("modal-due-time").value || "12:00";
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0).toISOString();
}

function formatBudgetMinutes(n) {
  const value = Math.max(0, Math.round(Number(n) || 0));
  return value.toLocaleString();
}

function draftTaskPreviewFromModal() {
  const durationMinutes = parseDurationMinutesFromModal();
  const recurrence = document.getElementById("modal-repeat")?.value || "none";
  let recurrenceRule = null;
  if (recurrence === "custom" && pendingCustomRecurrence) {
    const dueDate = document.getElementById("modal-due")?.value || "";
    recurrenceRule = {
      ...pendingCustomRecurrence,
      ...(dueDate ? { startDate: dueDate } : {}),
    };
  }
  const dueAt = buildDueAtFromModal();
  return {
    durationMinutes,
    recurrence,
    recurrenceRule,
    dueAt,
  };
}

function assigneeBudgetQueryParams() {
  const modalEl = document.getElementById("taskModal");
  const excludeTaskId = (document.getElementById("modal-task-id")?.value || "").trim();
  const draft = draftTaskPreviewFromModal();
  const params = new URLSearchParams();
  if (excludeTaskId) params.set("excludeTaskId", excludeTaskId);
  if (draft.durationMinutes && draft.durationMinutes > 0) {
    params.set("previewDurationMinutes", String(draft.durationMinutes));
    params.set("previewRecurrence", draft.recurrence || "none");
    if (draft.dueAt) params.set("previewDueAt", draft.dueAt);
    if (draft.recurrenceRule) {
      params.set("previewRecurrenceRule", JSON.stringify(draft.recurrenceRule));
    }
  }
  return params.toString();
}

function assigneeBudgetLabel(user, { afterPreview = true } = {}) {
  const remaining = afterPreview
    ? (user.remainingAfterPreview ?? user.remainingMinutes)
    : user.remainingMinutes;
  if (remaining == null) return "";
  const formatted = formatBudgetMinutes(remaining);
  const budget = user.monthlyBudgetMinutes ?? state.monthlyBudgetMinutes ?? 12480;
  const used = user.usedMinutes ?? 0;
  const preview = user.previewAssignmentMinutes ?? 0;
  const rawAfter = (user.remainingMinutes ?? budget - used) - preview;
  const exhausted = rawAfter < 0;
  const low = !exhausted && remaining < budget * 0.1;
  const cls = exhausted
    ? "admin-task-modal-employee-budget--exhausted"
    : low
      ? "admin-task-modal-employee-budget--low"
      : "";
  if (exhausted) {
    return `<span class="admin-task-modal-employee-budget ${cls}">${tr("owner.minutesOverBudget", { minutes: formatBudgetMinutes(Math.abs(rawAfter)) })}</span>`;
  }
  return `<span class="admin-task-modal-employee-budget ${cls}">${tr("owner.minutesRemainingThisMonth", { minutes: formatted })}</span>`;
}

let assigneeBudgetRefreshTimer = null;

function scheduleAssigneeBudgetRefresh() {
  if (assigneeBudgetRefreshTimer != null) window.clearTimeout(assigneeBudgetRefreshTimer);
  assigneeBudgetRefreshTimer = window.setTimeout(() => {
    assigneeBudgetRefreshTimer = null;
    void refreshAssigneeBudget();
  }, 250);
}

async function refreshAssigneeBudget() {
  if (!document.getElementById("taskModal")?.classList.contains("show")) return;
  try {
    const qs = assigneeBudgetQueryParams();
    const data = await api(`/api/users/assignees${qs ? `?${qs}` : ""}`);
    state.assignees = data.users ?? [];
    state.monthlyBudgetMinutes = data.monthlyBudgetMinutes ?? state.monthlyBudgetMinutes;
    const selected = getSelectedAssigneeIdsFromModal();
    fillModalAssigneeCheckboxes(selected);
    updateAssigneeBudgetPreviewBanner();
  } catch {
    /* keep prior assignee list */
  }
}

function updateAssigneeBudgetPreviewBanner() {
  const banner = document.getElementById("modal-assignee-budget-banner");
  const hint = document.getElementById("modal-assignee-budget-hint");
  const budget = state.monthlyBudgetMinutes ?? 12480;
  if (hint) {
    hint.textContent = tr("owner.monthlyMinuteBudget", { budget: formatBudgetMinutes(budget) });
  }
  if (!banner) return;
  const draft = draftTaskPreviewFromModal();
  if (!draft.durationMinutes || draft.durationMinutes <= 0) {
    banner.classList.add("d-none");
    banner.textContent = "";
    return;
  }
  const previewMinutes = state.assignees[0]?.previewAssignmentMinutes ?? 0;
  if (!previewMinutes) {
    banner.classList.add("d-none");
    return;
  }
  banner.classList.remove("d-none");
  banner.textContent = tr("owner.taskMonthlyMinuteCost", {
    minutes: formatBudgetMinutes(previewMinutes),
    budget: formatBudgetMinutes(state.monthlyBudgetMinutes ?? 12480),
  });
}

function fillModalAssigneeCheckboxes(selectedIds) {
  const host = document.getElementById("modal-assignee-options");
  if (!host) return;
  const set = new Set(selectedIds);
  if (!state.assignees.length) {
    host.innerHTML = `<p class="small text-muted mb-0 py-2 px-1">${tr("owner.noEmployeesYet")}</p>`;
    refreshModalAssigneeChipsAndLabel();
    return;
  }
  host.innerHTML = state.assignees
    .map(
      (u) => `
    <label class="admin-task-modal-employee-row modal-assignee-option" for="modal-assignee-${u.id}">
      <input class="modal-assignee-cb admin-task-modal-employee-cb" type="checkbox" value="${u.id}" id="modal-assignee-${u.id}" ${
        set.has(u.id) ? "checked" : ""
      }>
      <span class="admin-task-modal-employee-avatar" aria-hidden="true">${escapeHtml(assigneeInitials(u.displayName))}</span>
      <span class="admin-task-modal-employee-main min-w-0">
        <span class="admin-task-modal-employee-name text-truncate">${escapeHtml(dt(u.displayName))}</span>
        ${assigneeBudgetLabel(u)}
      </span>
    </label>`
    )
    .join("");
  refreshModalAssigneeChipsAndLabel();
  filterModalAssigneeOptions();
}

function filterModalAssigneeOptions() {
  const q = (document.getElementById("modal-assignee-search")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#modal-assignee-options .modal-assignee-option").forEach((row) => {
    const text = (row.textContent || "").toLowerCase();
    row.classList.toggle("d-none", q.length > 0 && !text.includes(q));
  });
}

function refreshModalAssigneeChipsAndLabel() {
  const chipsHost = document.getElementById("modal-assignee-chips");
  const labelEl = document.getElementById("modal-assignee-toggle-label");
  if (!chipsHost || !labelEl) return;

  const selected = [...document.querySelectorAll("#modal-assignee-options .modal-assignee-cb:checked")];
  const usersById = new Map(state.assignees.map((u) => [u.id, u]));

  chipsHost.replaceChildren();
  for (const cb of selected) {
    const u = usersById.get(cb.value);
    if (!u) continue;
    const chip = document.createElement("span");
    chip.className = "admin-task-modal-chip modal-assignee-chip";
    const safeName = escapeHtml(dt(u.displayName));
    chip.innerHTML = `<span class="modal-assignee-chip-text">${safeName}</span><button type="button" class="admin-task-modal-chip-remove modal-assignee-chip-remove" data-user-id="${escapeHtml(
      u.id
    )}" aria-label="${tr("common.removeAssignee", { name: safeName })}">${adminMsIcon("close", "admin-task-modal-chip-close")}</button>`;
    chip.querySelector(".modal-assignee-chip-remove")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const box = document.getElementById(`modal-assignee-${u.id}`);
      if (box) {
        box.checked = false;
        refreshModalAssigneeChipsAndLabel();
      }
    });
    chipsHost.appendChild(chip);
  }

  if (selected.length === 0) {
    labelEl.textContent = tr("common.assignTo");
  } else if (selected.length === 1) {
    const u = usersById.get(selected[0].value);
    labelEl.textContent = u?.displayName ?? tr("common.oneSelected");
  } else {
    labelEl.textContent = tr("common.employeesSelected", { count: selected.length });
  }
}

function getSelectedAssigneeIdsFromModal() {
  return [...document.querySelectorAll("#modal-assignee-options .modal-assignee-cb:checked")].map((cb) => cb.value);
}

function wireModalAssigneePicker() {
  const modal = document.getElementById("taskModal");
  if (!modal || modal.dataset.assigneePickerWired === "1") return;
  modal.dataset.assigneePickerWired = "1";

  const budgetFieldIds = new Set([
    "modal-duration-value",
    "modal-duration-unit",
    "modal-repeat",
    "modal-due",
    "modal-all-day",
    "modal-due-time",
  ]);

  modal.addEventListener("change", (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target?.classList?.contains("modal-assignee-cb")) {
      refreshModalAssigneeChipsAndLabel();
      return;
    }
    if (budgetFieldIds.has(target?.id)) {
      scheduleAssigneeBudgetRefresh();
    }
  });

  modal.addEventListener("input", (e) => {
    if (/** @type {HTMLElement} */ (e.target).id === "modal-duration-value") {
      scheduleAssigneeBudgetRefresh();
    }
  });

  modal.addEventListener("shown.bs.modal", () => {
    void refreshAssigneeBudget();
  });

  document.getElementById("modal-assignee-search")?.addEventListener("input", filterModalAssigneeOptions);

  document.getElementById("modal-assignee-panel")?.addEventListener("shown.bs.collapse", () => {
    document.getElementById("modal-assignee-search")?.focus();
    document.querySelector("#modal-assignee-toggle .modal-assignee-chevron")?.classList.add("is-open");
  });
  document.getElementById("modal-assignee-panel")?.addEventListener("hidden.bs.collapse", () => {
    document.querySelector("#modal-assignee-toggle .modal-assignee-chevron")?.classList.remove("is-open");
  });

  modal.addEventListener("hidden.bs.modal", () => {
    const search = document.getElementById("modal-assignee-search");
    if (search) search.value = "";
    filterModalAssigneeOptions();
    const panel = document.getElementById("modal-assignee-panel");
    if (panel?.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(panel).hide();
    }
  });
}

function fillModalDueFields(task) {
  const dueEl = document.getElementById("modal-due");
  const timeEl = document.getElementById("modal-due-time");
  const allDayEl = document.getElementById("modal-all-day");
  if (!dueEl || !timeEl || !allDayEl) return;
  allDayEl.checked = task.allDay === true;
  document.getElementById("modal-repeat").value = task.recurrence || "none";
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    const p = localDateParts(d);
    dueEl.value = `${p.y}-${p.m}-${p.day}`;
    if (task.allDay === true) {
      timeEl.value = "12:00";
    } else {
      timeEl.value = `${p.hh}:${p.mm}`;
    }
  } else {
    dueEl.value = "";
    timeEl.value = "12:00";
  }
  toggleModalTimeRow();
  refreshModalRepeatLabels();
  syncModalReminderRowVisibility();
}

function toggleModalTimeRow() {
  const wrap = document.getElementById("modal-time-wrap");
  const allDay = document.getElementById("modal-all-day")?.checked;
  if (wrap) wrap.classList.toggle("d-none", !!allDay);
}

function defaultCustomRecurrenceFromMainModal() {
  const due = document.getElementById("modal-due")?.value || "";
  const time = document.getElementById("modal-due-time")?.value || "12:00";
  return {
    every: 1,
    unit: "day",
    startTime: time,
    startDate: due || new Date().toISOString().slice(0, 10),
    endType: "never",
    endOn: null,
    endAfterOccurrences: null,
  };
}

function fillCustomRecurrenceForm(rule) {
  document.getElementById("cr-every").value = String(rule.every ?? 1);
  document.getElementById("cr-unit").value = rule.unit || "day";
  document.getElementById("cr-time").value = rule.startTime || "12:00";
  document.getElementById("cr-start").value = rule.startDate || "";
  const end = rule.endType || "never";
  const endEl = document.querySelector(`input[name="cr-end"][value="${end}"]`);
  if (endEl) endEl.checked = true;
  else document.getElementById("cr-end-never").checked = true;
  document.getElementById("cr-end-on").value = rule.endOn || "";
  document.getElementById("cr-after").value = String(rule.endAfterOccurrences ?? 30);
  toggleCustomEndFields();
}

function toggleCustomEndFields() {
  const end = document.querySelector('input[name="cr-end"]:checked')?.value || "never";
  document.getElementById("cr-end-on").disabled = end !== "on";
  document.getElementById("cr-after").disabled = end !== "after";
}

function readCustomRecurrenceForm() {
  const every = Math.min(999, Math.max(1, parseInt(document.getElementById("cr-every").value, 10) || 1));
  const unit = document.getElementById("cr-unit").value;
  const startTime = document.getElementById("cr-time").value || "12:00";
  const startRaw = (document.getElementById("cr-start").value || "").trim();
  const startDate = startRaw.length > 0 ? startRaw : undefined;
  const endType = document.querySelector('input[name="cr-end"]:checked')?.value || "never";
  let endOn = null;
  let endAfterOccurrences = null;
  if (endType === "on") {
    const onRaw = (document.getElementById("cr-end-on").value || "").trim();
    endOn = onRaw.length > 0 ? onRaw : null;
  }
  if (endType === "after") {
    endAfterOccurrences = Math.min(9999, Math.max(1, parseInt(document.getElementById("cr-after").value, 10) || 1));
  }
  const rule = {
    every,
    unit,
    startTime,
    endType,
    endOn,
    endAfterOccurrences,
  };
  if (startDate !== undefined) rule.startDate = startDate;
  return rule;
}

function openCustomRecurrenceEditor() {
  const rule = pendingCustomRecurrence || defaultCustomRecurrenceFromMainModal();
  fillCustomRecurrenceForm(rule);
  bootstrap.Modal.getOrCreateInstance(document.getElementById("customRecurrenceModal")).show();
}

function customRecurrenceModalHtml() {
  return `
    <div class="modal fade" id="customRecurrenceModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content custom-recurrence-sheet border-0 shadow">
          <div class="modal-header border-0 pb-0 pt-3 px-3">
            <button type="button" class="btn-close ms-auto" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body pt-2 px-3 pb-3">
            <label class="form-label small mb-1 cr-label" for="cr-every">${tr("modals.repeatsEvery")}</label>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
              <input type="number" class="form-control form-control-sm cr-field" id="cr-every" min="1" max="999" value="1" style="width:4.5rem" />
              <select class="form-select form-select-sm flex-grow-1 cr-field" id="cr-unit" style="min-width:8rem">
                <option value="day">${tr("common.day")}</option>
                <option value="week">${tr("common.week")}</option>
                <option value="month">${tr("common.month")}</option>
                <option value="year">${tr("common.year")}</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label small mb-1 cr-label visually-hidden" for="cr-time">Time</label>
              <input type="time" class="form-control cr-field" id="cr-time" value="12:00" />
            </div>
            <div class="mb-3">
              <label class="form-label small mb-1 cr-label" for="cr-start">${tr("common.starts")}</label>
              <input type="date" class="form-control cr-field" id="cr-start" />
            </div>
            <label class="form-label small mb-1 cr-label">${tr("common.ends")}</label>
            <div class="form-check">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-never" value="never" checked />
              <label class="form-check-label" for="cr-end-never">${tr("common.never")}</label>
            </div>
            <div class="form-check d-flex flex-wrap align-items-center gap-2 mt-2">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-on-radio" value="on" />
              <label class="form-check-label mb-0" for="cr-end-on-radio">${tr("common.on")}</label>
              <input type="date" class="form-control form-control-sm cr-field" id="cr-end-on" disabled style="max-width:11rem" />
            </div>
            <div class="form-check d-flex flex-wrap align-items-center gap-2 mt-2">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-after-radio" value="after" />
              <label class="form-check-label mb-0" for="cr-end-after-radio">${tr("common.after")}</label>
              <input type="number" class="form-control form-control-sm cr-field" id="cr-after" min="1" max="9999" value="30" disabled style="width:4.5rem" />
              <span class="small cr-muted">${tr("common.occurrences")}</span>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0 pb-3 px-3 gap-2">
            <button type="button" class="btn btn-link text-decoration-none cr-cancel-link" data-bs-dismiss="modal" id="cr-cancel">${tr("common.cancel")}</button>
            <button type="button" class="btn cr-done-pill ms-auto" id="cr-done">${tr("common.done")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireCustomRecurrenceModal() {
  document.querySelectorAll('input[name="cr-end"]').forEach((r) => {
    r.addEventListener("change", toggleCustomEndFields);
  });
  document.getElementById("cr-done").addEventListener("click", () => {
    const draft = readCustomRecurrenceForm();
    if (draft.endType === "on" && !draft.endOn) {
      showToast(tr("toast.chooseEndDate"), "warning");
      return;
    }
    const startIso = draft.startDate || document.getElementById("cr-start").value || "";
    if (draft.endType === "on" && draft.endOn && startIso && draft.endOn < startIso) {
      showToast(tr("toast.endDateAfterStart"), "warning");
      return;
    }
    pendingCustomRecurrence = draft;
    document.getElementById("modal-repeat").value = "custom";
    const mainDue = document.getElementById("cr-start").value;
    if (mainDue) {
      document.getElementById("modal-due").value = mainDue;
      pendingCustomRecurrence.startDate = mainDue;
    }
    const t = pendingCustomRecurrence.startTime;
    if (t) document.getElementById("modal-due-time").value = t;
    refreshModalRepeatLabels();
    scheduleAssigneeBudgetRefresh();
    bootstrap.Modal.getInstance(document.getElementById("customRecurrenceModal")).hide();
  });
  document.getElementById("cr-cancel").addEventListener("click", () => {
    if (!pendingCustomRecurrence) {
      document.getElementById("modal-repeat").value = "none";
    }
  });
}

function listNameModalHtml() {
  return `
    <div class="modal fade" id="listNameModal" tabindex="-1" aria-labelledby="listNameModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="listNameModalTitle">${tr("modals.listName")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body">
            <label class="form-label mb-1" for="listNameInput" id="listNameModalLabel">${tr("common.name")}</label>
            <input type="text" class="form-control" id="listNameInput" maxlength="200" autocomplete="off" />
          </div>
          <div class="modal-footer border-top-0 pt-0">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${tr("common.cancel")}</button>
            <button type="button" class="btn btn-primary" id="listNameModalSave">${tr("common.save")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireListNameModal() {
  const modalEl = document.getElementById("listNameModal");
  const inputEl = document.getElementById("listNameInput");
  const saveBtn = document.getElementById("listNameModalSave");
  if (!modalEl || !inputEl || !saveBtn) return;

  inputEl.replaceWith(inputEl.cloneNode(true));
  saveBtn.replaceWith(saveBtn.cloneNode(true));
  const input = document.getElementById("listNameInput");
  const save = document.getElementById("listNameModalSave");

  const updateSaveEnabled = () => {
    save.disabled = !input.value.trim();
  };

  input.addEventListener("input", updateSaveEnabled);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!save.disabled) save.click();
    }
  });
  save.addEventListener("click", () => {
    const value = input.value.trim();
    if (!value) return;
    const resolve = listNameResolve;
    listNameResolve = null;
    bootstrap.Modal.getInstance(modalEl)?.hide();
    if (resolve) resolve(value);
  });
  modalEl.addEventListener("hidden.bs.modal", () => {
    if (listNameResolve) {
      listNameResolve(null);
      listNameResolve = null;
    }
  });
}

/**
 * @param {{ heading: string; fieldLabel?: string; initialValue?: string }} opts
 * @returns {Promise<string | null>} trimmed name, or null if cancelled
 */
function openListNameModal(opts) {
  const { heading, fieldLabel = tr("modals.listName"), initialValue = "" } = opts;
  return new Promise((resolve) => {
    listNameResolve = resolve;
    const titleEl = document.getElementById("listNameModalTitle");
    const labelEl = document.getElementById("listNameModalLabel");
    const input = document.getElementById("listNameInput");
    const save = document.getElementById("listNameModalSave");
    const modalEl = document.getElementById("listNameModal");
    if (!titleEl || !labelEl || !input || !save || !modalEl) {
      resolve(null);
      listNameResolve = null;
      return;
    }
    titleEl.textContent = heading;
    labelEl.textContent = fieldLabel;
    input.value = initialValue;
    save.disabled = !initialValue.trim();
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  });
}

function updateModalSaveEnabled() {
  const btn = document.getElementById("modal-save");
  if (!btn) return;
  const title = document.getElementById("modal-title")?.value?.trim();
  btn.disabled = !title;
}

function taskModalHtml() {
  return `
    <div class="modal fade admin-task-modal" id="taskModal" tabindex="-1" aria-labelledby="taskModalLabel">
      <div class="modal-dialog modal-dialog-centered admin-task-modal-dialog">
        <div class="modal-content admin-task-modal-card border-0">
          <div class="admin-task-modal-header">
            <label class="visually-hidden" for="modal-title" id="taskModalLabel">${tr("modals.taskTitle")}</label>
            <input type="text" class="admin-task-modal-title-input" id="modal-title" placeholder="${tr("modals.taskTitlePlaceholder")}" autocomplete="off" />
            <button type="button" class="admin-task-modal-close" data-bs-dismiss="modal" aria-label="Close">
              ${adminMsIcon("close", "admin-task-modal-close-icon")}
            </button>
          </div>
          <div class="admin-task-modal-body">
            <input type="hidden" id="modal-task-id" />
            <div id="modal-schedule-wrap" class="admin-task-modal-section">
              <div class="admin-task-modal-row">
                <span class="admin-task-modal-row-icon">${adminMsIcon("schedule")}</span>
                <div class="admin-task-modal-row-content">
                  <div class="admin-task-modal-datetime-row">
                    <div class="row g-2 flex-grow-1" id="modal-schedule-dates-row">
                      <div class="col-sm-6" id="modal-due-wrap">
                        <input class="admin-task-modal-input" type="date" id="modal-due" aria-label="${tr("common.dueDate")}" />
                      </div>
                      <div class="col-sm-6 d-none" id="modal-custom-end-wrap">
                        <input class="admin-task-modal-input" type="date" id="modal-custom-end-display" disabled tabindex="-1" aria-readonly="true" aria-label="${tr("common.repeatEndDate")}" />
                      </div>
                    </div>
                    <div class="admin-task-modal-datetime-row mt-2" id="modal-time-wrap">
                      <input class="admin-task-modal-input" type="time" id="modal-due-time" value="12:00" aria-label="${tr("common.dueTime")}" />
                    </div>
                  </div>
                  <label class="admin-task-modal-check">
                    <input type="checkbox" id="modal-all-day" />
                    <span>${tr("common.allDay")}</span>
                  </label>
                  <label class="admin-task-modal-check admin-task-modal-check--priority" title="${tr("modals.highPriorityHint")}">
                    <input type="checkbox" id="modal-high-priority" />
                    <span>${tr("modals.highPriority")}</span>
                  </label>
                </div>
              </div>
              <div class="admin-task-modal-row admin-task-modal-row--duration">
                <span class="admin-task-modal-row-icon">${adminMsIcon("hourglass_top")}</span>
                <div class="admin-task-modal-row-content">
                  <label class="admin-task-modal-field-label" for="modal-duration-value">
                    ${tr("modals.taskDuration")} <span class="text-muted fw-normal">${tr("common.optional")}</span>
                  </label>
                  <p class="admin-task-modal-field-hint small text-muted mb-2">${tr("modals.taskDurationHint")}</p>
                  <div class="admin-task-modal-duration-row">
                    <input
                      type="number"
                      class="admin-task-modal-input"
                      id="modal-duration-value"
                      min="1"
                      step="1"
                      inputmode="numeric"
                      placeholder="2"
                      aria-label="${tr("modals.taskDuration")}"
                    />
                    <div class="admin-task-modal-select-wrap admin-task-modal-duration-unit-wrap">
                      <select class="admin-task-modal-select" id="modal-duration-unit" aria-label="${tr("modals.taskDuration")}">
                        <option value="minutes">${tr("common.durationMinutesUnit")}</option>
                        <option value="hours" selected>${tr("common.durationHoursUnit")}</option>
                        <option value="days">${tr("common.durationDaysUnit")}</option>
                      </select>
                      <span class="admin-task-modal-select-chevron">${adminMsIcon("expand_more")}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="admin-task-modal-row admin-task-modal-row--reminder d-none" id="modal-reminder-wrap">
                <span class="admin-task-modal-row-icon">${adminMsIcon("notifications_active")}</span>
                <div class="admin-task-modal-row-content">
                  <label class="admin-task-modal-field-label" for="modal-reminder-before">
                    ${tr("modals.reminderBefore")} <span class="text-muted fw-normal">${tr("common.optional")}</span>
                  </label>
                  <p class="admin-task-modal-field-hint small text-muted mb-2">${tr("modals.reminderBeforeHint")}</p>
                  <div class="admin-task-modal-select-wrap">
                    <select class="admin-task-modal-select" id="modal-reminder-before" aria-label="${tr("modals.reminderBefore")}">
                      <option value="30" selected>${tr("modals.reminderMinutesBefore", { count: 30 })}</option>
                      <option value="60">${tr("modals.reminderHoursBefore", { count: 1 })}</option>
                      <option value="180">${tr("modals.reminderHoursBefore", { count: 3 })}</option>
                      <option value="360">${tr("modals.reminderHoursBefore", { count: 6 })}</option>
                      <option value="1440">${tr("modals.reminderDaysBefore", { count: 1 })}</option>
                      <option value="2880">${tr("modals.reminderDaysBefore", { count: 2 })}</option>
                      <option value="4320">${tr("modals.reminderDaysBefore", { count: 3 })}</option>
                    </select>
                    <span class="admin-task-modal-select-chevron">${adminMsIcon("expand_more")}</span>
                  </div>
                </div>
              </div>
              <div class="admin-task-modal-row admin-task-modal-row--recurrence">
                <span class="admin-task-modal-row-icon">${adminMsIcon("repeat")}</span>
                <div class="admin-task-modal-select-wrap flex-grow-1">
                  <select class="admin-task-modal-select" id="modal-repeat" aria-label="${tr("common.repeat")}">
                    <option value="none">${tr("owner.repeatDoesNot")}</option>
                    <option value="daily">${tr("owner.recurrenceDaily")}</option>
                    <option value="weekly">${tr("owner.recurrenceWeekly")}</option>
                    <option value="monthly">${tr("owner.recurrenceMonthly")}</option>
                    <option value="yearly">${tr("owner.recurrenceYearly")}</option>
                    <option value="custom">${tr("owner.repeatCustomEllipsis")}</option>
                  </select>
                  <span class="admin-task-modal-select-chevron">${adminMsIcon("expand_more")}</span>
                </div>
              </div>
              <div id="modal-custom-repeat-card" class="admin-task-modal-custom-repeat d-none" aria-live="polite">
                <div class="admin-task-modal-custom-repeat-head">
                  <span class="admin-task-modal-custom-repeat-badge" id="modal-custom-repeat-freq">${tr("modals.everyDay")}</span>
                  <button type="button" class="admin-task-modal-custom-repeat-edit" id="modal-custom-repeat-edit">
                    ${adminMsIcon("edit")} ${tr("modals.customRepeatEdit")}
                  </button>
                </div>
                <div class="admin-task-modal-custom-repeat-range" id="modal-custom-repeat-range">
                  <span id="modal-custom-repeat-from">—</span>
                  <span aria-hidden="true">→</span>
                  <span id="modal-custom-repeat-to">—</span>
                </div>
                <p class="admin-task-modal-custom-repeat-meta" id="modal-custom-repeat-meta"></p>
              </div>
            </div>
            <div class="admin-task-modal-row admin-task-modal-row--top">
              <span class="admin-task-modal-row-icon">${adminMsIcon("notes")}</span>
              <textarea class="admin-task-modal-textarea" id="modal-notes" rows="3" placeholder="${tr("modals.addDescription")}" aria-label="${tr("common.description")}"></textarea>
            </div>
            <div class="admin-task-modal-section" id="modal-assignment-attachments-wrap">
              <div class="admin-task-modal-row admin-task-modal-row--top">
                <span class="admin-task-modal-row-icon">${adminMsIcon("attach_file")}</span>
                <div class="admin-task-modal-attach-panel flex-grow-1">
                  <p class="admin-task-modal-attach-label mb-2">${tr("tasks.assignmentAttachments")}</p>
                  <div class="admin-task-modal-attach-actions mb-2">
                    <input type="file" class="d-none" id="modal-assignment-file-input" accept="image/jpeg,image/png,image/gif,image/webp,video/*,application/pdf,audio/*" multiple />
                    <button type="button" class="btn btn-sm btn-outline-primary" id="modal-assignment-pick-btn">${adminMsIcon("upload_file")}<span>${tr("tasks.addFiles")}</span></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary admin-task-modal-voice-btn" id="modal-assignment-voice-btn" aria-pressed="false">${adminMsIcon("mic")}<span>${tr("tasks.recordVoiceNote")}</span></button>
                  </div>
                  <p class="admin-task-modal-voice-status small d-none mb-2" id="modal-assignment-voice-status" role="status" aria-live="polite"></p>
                  <div id="modal-assignment-list" class="admin-task-modal-attach-list"></div>
                </div>
              </div>
            </div>
            <div class="admin-task-modal-row" id="modal-list-wrap">
              <span class="admin-task-modal-row-icon">${adminMsIcon("assignment")}</span>
              <div class="admin-task-modal-select-wrap flex-grow-1">
                <select class="admin-task-modal-select" id="modal-move-list" aria-label="${tr("common.list")}"></select>
                <span class="admin-task-modal-select-chevron">${adminMsIcon("expand_more")}</span>
              </div>
            </div>
            <div class="admin-task-modal-section" id="modal-assignee-wrap">
              <div class="admin-task-modal-row">
                <span class="admin-task-modal-row-icon">${adminMsIcon("group")}</span>
                <button
                  type="button"
                  class="admin-task-modal-assign-toggle"
                  data-bs-toggle="collapse"
                  data-bs-target="#modal-assignee-panel"
                  aria-expanded="false"
                  aria-controls="modal-assignee-panel"
                  id="modal-assignee-toggle"
                >
                  <span id="modal-assignee-toggle-label" class="text-truncate">${tr("common.assignTo")}</span>
                  <span class="admin-task-modal-assign-chevron modal-assignee-chevron">${adminMsIcon("expand_more")}</span>
                </button>
              </div>
              <div class="collapse admin-task-modal-assign-panel" id="modal-assignee-panel">
                <p id="modal-assignee-budget-hint" class="admin-task-modal-assign-budget-hint small text-muted mb-2 px-1"></p>
                <div class="admin-task-modal-assign-search-wrap">
                  ${adminMsIcon("search", "admin-task-modal-search-icon")}
                  <input type="search" class="admin-task-modal-assign-search" id="modal-assignee-search" placeholder="${tr("common.searchEmployees")}..." autocomplete="off" aria-label="${tr("common.searchEmployees")}" />
                </div>
                <div id="modal-assignee-chips" class="admin-task-modal-chips" role="list" aria-label="${tr("common.selectedAssignees")}"></div>
                <p id="modal-assignee-budget-banner" class="admin-task-modal-budget-banner small text-muted mb-2 d-none" aria-live="polite"></p>
                <div id="modal-assignee-options" class="admin-task-modal-employee-list"></div>
              </div>
            </div>
          </div>
          <div class="admin-task-modal-footer">
            <button type="button" class="admin-task-modal-delete" id="modal-delete">
              ${adminMsIcon("delete")} ${tr("modals.deleteTask")}
            </button>
            <div class="admin-task-modal-footer-actions">
              <button type="button" class="admin-task-modal-btn-secondary" data-bs-dismiss="modal">${tr("common.close")}</button>
              <button type="button" class="admin-task-modal-btn-save" id="modal-save">${tr("common.save")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function submissionDetailModalHtml() {
  return `
    <div class="modal fade" id="submissionDetailModal" tabindex="-1" aria-labelledby="submissionDetailTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="submissionDetailTitle">${tr("modals.submission")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body">
            <div id="submission-detail-text-wrap" class="submission-detail-text-wrap mb-3 d-none">
              <p class="small text-uppercase text-secondary fw-semibold mb-2">${tr("common.submissionNotes")}</p>
              <div id="submission-detail-text" class="submission-detail-text border rounded p-3 bg-body-secondary small mb-0"></div>
            </div>
            <div id="submission-detail-file-wrap" class="submission-detail-file-wrap d-none">
              <p id="submission-detail-file-label" class="small text-uppercase text-secondary fw-semibold mb-2">${tr("common.attachments")}</p>
              <div id="submission-detail-media-missing" class="submission-detail-media-missing alert alert-warning py-2 px-3 small d-none mb-2" role="status"></div>
              <div id="submission-detail-gallery" class="submission-detail-gallery d-none"></div>
              <button type="button" id="submission-detail-image-frame" class="submission-detail-image-frame submission-detail-media-open js-submission-media-open d-none" data-media-index="0" aria-label="${tr("chat.viewImageFullScreen")}">
                <img id="submission-detail-img" src="" class="w-100 submission-detail-img-preview" alt="${tr("common.submissionImage")}" />
                <span class="submission-detail-media-open-badge" aria-hidden="true">${adminMsIcon("fullscreen")}</span>
              </button>
              <button type="button" id="submission-detail-video-wrap" class="submission-detail-video-wrap submission-detail-media-open js-submission-media-open d-none" data-media-index="0" aria-label="${tr("chat.viewVideoFullScreen")}">
                <video id="submission-detail-video" class="submission-detail-video w-100" playsinline preload="metadata"></video>
                <span class="submission-detail-media-open-badge" aria-hidden="true">${adminMsIcon("fullscreen")}</span>
              </button>
              <audio id="submission-detail-audio" class="submission-detail-audio w-100 d-none" controls></audio>
              <button type="button" id="submission-detail-pdf-wrap" class="submission-detail-pdf-wrap submission-detail-media-open js-submission-media-open d-none" data-media-index="0" aria-label="${tr("chat.fullScreen")}">
                <iframe id="submission-detail-pdf" class="submission-detail-pdf-embed w-100" title="${tr("common.submissionPdf")}"></iframe>
                <span class="submission-detail-media-open-badge" aria-hidden="true">${adminMsIcon("fullscreen")}</span>
              </button>
            </div>
            <p id="submission-detail-empty" class="text-muted small mb-0 d-none">${tr("modals.noSubmissionContent")}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${tr("common.close")}</button>
          </div>
        </div>
      </div>
    </div>
    <div id="submission-media-lightbox" class="submission-media-lightbox d-none" role="dialog" aria-modal="true" aria-label="${tr("chat.fullScreenMedia")}">
      <button type="button" class="submission-media-lightbox-backdrop js-submission-media-lightbox-close" aria-label="${tr("common.close")}"></button>
      <button type="button" class="submission-media-lightbox-close js-submission-media-lightbox-close" aria-label="${tr("common.close")}">${adminMsIcon("close")}</button>
      <button type="button" class="submission-media-lightbox-nav submission-media-lightbox-nav--prev js-submission-media-lightbox-prev d-none" aria-label="${tr("chat.fullScreen")}">${adminMsIcon("chevron_left")}</button>
      <button type="button" class="submission-media-lightbox-nav submission-media-lightbox-nav--next js-submission-media-lightbox-next d-none" aria-label="${tr("chat.fullScreen")}">${adminMsIcon("chevron_right")}</button>
      <p id="submission-media-lightbox-counter" class="submission-media-lightbox-counter d-none"></p>
      <div id="submission-media-lightbox-inner" class="submission-media-lightbox-inner"></div>
    </div>`;
}

function adminEmpModalHeaderHtml(titleId, title) {
  return `<div class="admin-emp-modal-header">
    <h2 class="admin-emp-modal-title" id="${titleId}">${escapeHtml(title)}</h2>
    <button type="button" class="admin-emp-modal-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}">${adminMsIcon("close")}</button>
  </div>`;
}

function adminEmpModalTaskBlockHtml(titleId) {
  return `<p class="admin-emp-modal-field-label">${tr("common.task")}</p>
    <p id="${titleId}" class="admin-emp-modal-task-title"></p>`;
}

function adminEmpModalFooterHtml(cancelLabel, submitId, submitLabel, submitIcon = "send") {
  return `<div class="admin-emp-modal-footer">
    <div class="admin-emp-modal-footer-actions">
      <button type="button" class="admin-task-modal-btn-secondary" data-bs-dismiss="modal">${escapeHtml(cancelLabel)}</button>
      <button type="button" class="admin-task-modal-btn-save" id="${submitId}">
        ${adminMsIcon(submitIcon)} ${escapeHtml(submitLabel)}
      </button>
    </div>
  </div>`;
}

function progressUpdateModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="progressUpdateModal" tabindex="-1" aria-labelledby="progressUpdateModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down admin-emp-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          ${adminEmpModalHeaderHtml("progressUpdateModalTitle", tr("modals.taskUpdate"))}
          <div class="admin-emp-modal-body">
            <input type="hidden" id="progress-update-task-id" value="" />
            <input type="hidden" id="progress-update-user-id" value="" />
            <input type="hidden" id="progress-update-readonly" value="0" />
            ${adminEmpModalTaskBlockHtml("progress-update-task-title")}
            <p id="progress-update-assignee-label" class="admin-emp-modal-hint mb-3 d-none"></p>
            <div id="progress-update-compose-wrap">
              <p class="admin-emp-modal-field-label mb-2">${tr("modals.updateType")}</p>
              <div id="progress-update-type-chips" class="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="${tr("modals.updateType")}"></div>
              <label class="admin-emp-modal-label" for="progress-update-message">${tr("modals.yourUpdate")}</label>
              <textarea
                class="admin-emp-modal-textarea"
                id="progress-update-message"
                rows="4"
                maxlength="${PROGRESS_UPDATE_TEXT_MAX}"
                placeholder="${tr("modals.updatePlaceholder")}"
              ></textarea>
              <div class="d-flex justify-content-end mt-1">
                <span id="progress-update-count" class="admin-emp-modal-counter tabular-nums">0 / ${PROGRESS_UPDATE_TEXT_MAX}</span>
              </div>
              <hr class="admin-emp-modal-divider" />
              <label class="admin-emp-modal-label" for="progress-update-file-input">${tr("modals.updateAttachments")} <span class="admin-emp-modal-label-optional">${tr("employee.progressFilesOptional", { max: EMP_SUBMISSION_MAX_IMAGES })}</span></label>
              <div class="d-flex flex-wrap gap-2 mb-2">
                <input
                  type="file"
                  class="d-none"
                  id="progress-update-file-input"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/*,application/pdf,audio/*,.pdf,.mp4,.webm,.mov,.m4a,.mp3,.ogg,.wav"
                  multiple
                />
                <button type="button" class="btn btn-sm btn-outline-primary" id="progress-update-pick-btn">${adminMsIcon("upload_file")}<span>${tr("tasks.addFiles")}</span></button>
                <button type="button" class="btn btn-sm btn-outline-secondary admin-task-modal-voice-btn" id="progress-update-voice-btn" aria-pressed="false">${adminMsIcon("mic")}<span>${tr("tasks.recordVoiceNote")}</span></button>
              </div>
              <p class="admin-emp-modal-hint small mb-2" id="progress-update-voice-status" role="status" aria-live="polite"></p>
              <div id="progress-update-preview-wrap" class="emp-submission-preview-grid mt-2 d-none"></div>
              <p id="progress-update-error" class="admin-emp-modal-error d-none" role="alert"></p>
            </div>
            <div id="progress-update-history-wrap" class="mt-3">
              <p class="admin-emp-modal-field-label mb-2">${tr("modals.updateHistory")}</p>
              <div id="progress-update-history" class="progress-update-timeline"></div>
              <p id="progress-update-history-empty" class="admin-emp-modal-hint mb-0 d-none">${tr("modals.noUpdatesYet")}</p>
            </div>
          </div>
          ${adminEmpModalFooterHtml(tr("common.close"), "progress-update-submit", tr("modals.postUpdate"))}
        </div>
      </div>
    </div>`;
}

function empCreateTaskModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="empCreateTaskModal" tabindex="-1" aria-labelledby="empCreateTaskModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable admin-emp-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          ${adminEmpModalHeaderHtml("empCreateTaskModalTitle", tr("modals.createAssignTask"))}
          <div class="admin-emp-modal-body">
            <label class="admin-emp-modal-label" for="emp-create-title">${tr("modals.taskTitle")}</label>
            <input type="text" class="admin-emp-modal-input mb-3" id="emp-create-title" maxlength="500" placeholder="${tr("modals.whatNeedsDone")}" autocomplete="off" />
            <label class="admin-emp-modal-label" for="emp-create-notes">${tr("common.description")} <span class="admin-emp-modal-label-optional">${tr("common.optional")}</span></label>
            <textarea class="admin-emp-modal-textarea mb-3" id="emp-create-notes" rows="3" placeholder="${tr("modals.addDetails")}"></textarea>
            <label class="admin-emp-modal-label" for="emp-create-due">${tr("common.deadline")} <span class="admin-emp-modal-label-optional">${tr("common.optional")}</span></label>
            <input type="datetime-local" class="admin-emp-modal-input mb-3" id="emp-create-due" />
            <label class="admin-emp-modal-label" for="emp-create-assignee">${tr("common.assignedTo")}</label>
            <select class="admin-emp-modal-select mb-3" id="emp-create-assignee">
              <option value="">${tr("employee.chooseEmployee")}</option>
            </select>
            <p class="admin-emp-modal-hint mb-0">${tr("employee.createAssignHint")}</p>
            <p id="emp-create-error" class="admin-emp-modal-error d-none" role="alert"></p>
          </div>
          ${adminEmpModalFooterHtml(tr("common.cancel"), "emp-create-submit", tr("modals.createTask"), "add")}
        </div>
      </div>
    </div>`;
}

function empDelegateModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="empDelegateModal" tabindex="-1" aria-labelledby="empDelegateModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered admin-emp-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          ${adminEmpModalHeaderHtml("empDelegateModalTitle", tr("modals.assignToColleague"))}
          <div class="admin-emp-modal-body">
            <input type="hidden" id="emp-delegate-task-id" value="" />
            ${adminEmpModalTaskBlockHtml("emp-delegate-task-title")}
            <p class="admin-emp-modal-hint mb-3">${tr("employee.delegateHint")}</p>
            <label class="admin-emp-modal-label" for="emp-delegate-employee">${tr("common.assignedTo")}</label>
            <select class="admin-emp-modal-select" id="emp-delegate-employee">
              <option value="">${tr("employee.chooseEmployee")}</option>
            </select>
            <p id="emp-delegate-error" class="admin-emp-modal-error d-none" role="alert"></p>
          </div>
          ${adminEmpModalFooterHtml(tr("common.cancel"), "emp-delegate-submit", tr("modals.assignTask"), "person_add")}
        </div>
      </div>
    </div>`;
}

function empSubmissionModalHtml() {
  return `
    <div class="modal fade admin-emp-modal" id="empSubmissionModal" tabindex="-1" aria-labelledby="empSubmissionModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down admin-emp-modal-dialog">
        <div class="modal-content admin-emp-modal-card">
          ${adminEmpModalHeaderHtml("empSubmissionModalTitle", tr("modals.submitTask"))}
          <div class="admin-emp-modal-body">
            <input type="hidden" id="emp-submission-task-id" value="" />
            ${adminEmpModalTaskBlockHtml("emp-submission-task-title")}
            <label class="admin-emp-modal-label" for="emp-submission-text">${tr("common.submissionNotes")}</label>
            <textarea
              class="admin-emp-modal-textarea"
              id="emp-submission-text"
              rows="5"
              maxlength="${EMP_SUBMISSION_TEXT_MAX}"
              placeholder="${tr("modals.submissionNotesPlaceholder")}"
            ></textarea>
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-2">
              <button type="button" class="admin-emp-modal-paste-btn" id="emp-submission-paste">
                ${adminMsIcon("content_paste")} ${tr("employee.pasteFromClipboard")}
              </button>
              <span id="emp-submission-count" class="admin-emp-modal-counter tabular-nums">0 / ${EMP_SUBMISSION_TEXT_MAX}</span>
            </div>
            <p id="emp-submission-error" class="admin-emp-modal-error d-none" role="alert"></p>
            <hr class="admin-emp-modal-divider" />
            <label class="admin-emp-modal-label" for="emp-submission-image">${tr("modals.submissionFiles")} <span class="admin-emp-modal-label-optional">${tr("employee.submissionFilesOptional", { max: EMP_SUBMISSION_MAX_IMAGES })}</span></label>
            <div class="d-flex flex-wrap gap-2 mb-2">
              <input
                type="file"
                class="d-none"
                id="emp-submission-image"
                accept="image/jpeg,image/png,image/gif,image/webp,video/*,application/pdf,audio/*,.pdf,.mp4,.webm,.mov,.m4a,.mp3,.ogg,.wav"
                multiple
              />
              <button type="button" class="btn btn-sm btn-outline-primary" id="emp-submission-pick-btn">${adminMsIcon("upload_file")}<span>${tr("tasks.addFiles")}</span></button>
              <button type="button" class="btn btn-sm btn-outline-secondary admin-task-modal-voice-btn" id="emp-submission-voice-btn" aria-pressed="false">${adminMsIcon("mic")}<span>${tr("tasks.recordVoiceNote")}</span></button>
            </div>
            <p class="admin-emp-modal-hint small mb-2 d-none" id="emp-submission-voice-status" role="status" aria-live="polite"></p>
            <div id="emp-submission-preview-wrap" class="emp-submission-preview-grid mt-2 d-none"></div>
          </div>
          ${adminEmpModalFooterHtml(tr("common.cancel"), "emp-submission-submit", tr("common.submit"))}
        </div>
      </div>
    </div>`;
}

function ownerMarkDoneModalHtml() {
  return `
    <div class="modal fade" id="ownerMarkDoneModal" tabindex="-1" aria-labelledby="ownerMarkDoneModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="ownerMarkDoneModalTitle">${tr("owner.markDoneTitle")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="owner-mark-done-task-id" value="" />
            <p class="fw-medium text-body-secondary mb-1 small text-uppercase text-secondary">${tr("common.task")}</p>
            <p class="mb-3" id="owner-mark-done-task-title"></p>
            <label class="form-label small text-muted mb-1" for="owner-mark-done-search">${tr("owner.searchEmployees")}</label>
            <div class="input-group input-group-sm mb-3">
              <span class="input-group-text bg-body border-end-0"><i class="bi bi-search" aria-hidden="true"></i></span>
              <input
                type="search"
                class="form-control border-start-0"
                id="owner-mark-done-search"
                placeholder="${tr("owner.typeAName")}"
                autocomplete="off"
              />
            </div>
            <p class="small text-muted mb-2" id="owner-mark-done-hint">${tr("owner.markDoneHint")}</p>
            <div id="owner-mark-done-list" class="border rounded px-3 py-2 bg-body-secondary bg-opacity-25" style="max-height: 280px; overflow-y: auto"></div>
            <p class="small text-muted mb-0 mt-3 d-none" id="owner-mark-done-empty">
              No one is assigned yet. Use <strong>Edit</strong> on the task to add employees.
            </p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${tr("common.close")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function ownerTrialMessageModalHtml() {
  return `
    <div class="modal fade" id="ownerTrialMessageModal" tabindex="-1" aria-labelledby="ownerTrialMessageModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow">
          <div class="modal-header border-0 pb-0">
            <h2 class="modal-title h5 mb-0" id="ownerTrialMessageModalTitle">${tr("owner.trialNoticeTitle")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body pt-2">
            <p class="mb-2">${ownerTrialNoticeBodyHtml()}</p>
            <p class="mb-0">${tr("owner.trialNoticeBody2")}</p>
          </div>
          <div class="modal-footer border-0 pt-2">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">${tr("common.gotIt")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function maybeShowOwnerTrialMessageModal() {
  if (state.user?.role !== "owner") return;
  if (sessionStorage.getItem(OWNER_TRIAL_POPUP_KEY) === "1") return;
  const modalEl = document.getElementById("ownerTrialMessageModal");
  if (!modalEl) return;
  sessionStorage.setItem(OWNER_TRIAL_POPUP_KEY, "1");
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function ownerTrialNoticeBodyHtml() {
  const info = ownerTrialStatusInfo();
  if (!info.start || !info.end) return escapeHtml(tr("owner.trialNoticeBody1Fallback"));
  return tr("owner.trialNoticeBody1", {
    start: formatTrialDate(info.start),
    end: formatTrialDate(info.end),
  });
}

function ownerTrialStatusInfo() {
  const trial = state.companyTrial;
  if (!trial?.trialStartDate || !trial?.trialEndDate) {
    return {
      start: null,
      end: null,
      daysRemaining: 0,
      hasStarted: false,
      isExpired: false,
    };
  }
  const start = new Date(trial.trialStartDate);
  const end = new Date(trial.trialEndDate);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  // Always derive from end date so the banner stays current between API refreshes.
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / dayMs));
  const hasStarted = now.getTime() >= start.getTime();
  const isExpired = now.getTime() > end.getTime();
  return { start, end, daysRemaining, hasStarted, isExpired };
}

function ownerTrialStatusChipHtml() {
  const info = ownerTrialStatusInfo();
  const startStr = info.start.toLocaleDateString(undefined, { dateStyle: "medium" });
  const endStr = info.end.toLocaleDateString(undefined, { dateStyle: "medium" });

  if (!info.hasStarted) {
    return `<div class="owner-trial-chip owner-trial-chip--pending small">
      <i class="bi bi-hourglass-split" aria-hidden="true"></i>
      <span>${tr("owner.trialStartsOn", { start: startStr, end: endStr })}</span>
    </div>`;
  }
  if (info.isExpired) {
    return `<div class="owner-trial-chip owner-trial-chip--expired small">
      <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
      <span>${tr("owner.trialEndedOn", { end: endStr })}</span>
    </div>`;
  }
  return `<div class="owner-trial-chip owner-trial-chip--active small">
    <i class="bi bi-clock-history" aria-hidden="true"></i>
    <span>${tr("owner.trialDaysRemaining", { days: info.daysRemaining, dayLabel: info.daysRemaining === 1 ? tr("owner.day") : tr("owner.days"), end: endStr })}</span>
  </div>`;
}

function myProfileModalHtml() {
  return `
    <div class="modal fade profile-modal" id="myProfileModal" tabindex="-1" aria-labelledby="myProfileModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered profile-modal-dialog">
        <div class="modal-content profile-modal-card">
          <form id="my-profile-form" class="profile-modal-form">
            <div class="modal-header profile-modal-header">
              <h2 class="modal-title h5 mb-0" id="myProfileModalTitle">${tr("profile.myProfile")}</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
            </div>
            <div class="modal-body profile-modal-body">
              <p class="small text-muted mb-3" id="my-profile-intro">${tr("profile.personalDetailsIntro")}</p>
              <div class="mb-3">
                <label class="form-label" for="my-profile-display-name">${tr("profile.fullName")}</label>
                <input type="text" class="form-control" id="my-profile-display-name" maxlength="120" required autocomplete="name" />
              </div>
              <div class="mb-3">
                <label class="form-label" for="my-profile-email">${tr("common.email")}</label>
                <input type="email" class="form-control" id="my-profile-email" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label" for="my-profile-phone">${tr("common.phone")}</label>
                <input type="tel" class="form-control" id="my-profile-phone" inputmode="numeric" pattern="\\d{10}" maxlength="10" autocomplete="tel" placeholder="${tr("auth.phonePlaceholder")}" />
              </div>
              <div class="mb-2">
                <label class="form-label" for="my-profile-salary">${tr("profile.salary")}</label>
                <div class="input-group">
                  <span class="input-group-text">₹</span>
                  <input type="number" class="form-control" id="my-profile-salary" min="0" step="1" />
                </div>
              </div>
              <p class="small text-muted mb-0 d-none" id="my-profile-salary-hint">${tr("profile.salaryReadOnlyHint")}</p>
              ${profileDocumentsSectionHtml()}
              <p class="small text-muted mt-3 mb-0" id="my-profile-member-since"></p>
            </div>
            <div class="modal-footer profile-modal-footer">
              <button type="button" class="profile-modal-btn-cancel" data-bs-dismiss="modal">${tr("common.cancel")}</button>
              <button type="submit" class="profile-modal-btn-save" id="my-profile-save">${tr("common.save")}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

/** @type {string | null} */
let profileEditUserId = null;

function canEditSalaryInProfileModal() {
  if (!(state.user?.isAdmin && state.user?.role === "owner")) return false;
  return true;
}

function formatProfileMemberSince(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

async function loadMyProfileForm(userId = null) {
  const endpoint = userId ? `/api/users/${userId}/profile` : "/api/users/profile";
  const { profile } = await api(endpoint);
  profileEditUserId = userId || null;

  const titleEl = document.getElementById("myProfileModalTitle");
  const introEl = document.getElementById("my-profile-intro");
  const nameEl = document.getElementById("my-profile-display-name");
  const emailEl = document.getElementById("my-profile-email");
  const phoneEl = document.getElementById("my-profile-phone");
  const salaryEl = document.getElementById("my-profile-salary");
  const salaryHint = document.getElementById("my-profile-salary-hint");
  const memberSinceEl = document.getElementById("my-profile-member-since");

  if (titleEl) {
    titleEl.textContent =
      userId && userId !== state.user?.id
        ? tr("profile.editUserProfile", { name: profile.displayName })
        : tr("profile.myProfile");
  }
  if (introEl) {
    introEl.textContent =
      userId && userId !== state.user?.id
        ? tr("profile.adminEditIntro")
        : tr("profile.personalDetailsIntro");
  }
  if (nameEl) nameEl.value = profile.displayName || "";
  if (emailEl) emailEl.value = profile.email || "";
  if (phoneEl) phoneEl.value = profile.phone || "";
  if (salaryEl) salaryEl.value = String(profile.salary ?? 15000);

  const salaryEditable = canEditSalaryInProfileModal();
  if (salaryEl) {
    salaryEl.readOnly = !salaryEditable;
    salaryEl.classList.toggle("bg-body-secondary", !salaryEditable);
  }
  salaryHint?.classList.toggle("d-none", salaryEditable);

  const since = formatProfileMemberSince(profile.createdAt);
  if (memberSinceEl) {
    memberSinceEl.textContent = since ? tr("profile.memberSince", { date: since }) : "";
  }

  const isOwnProfile = !profileEditUserId || profileEditUserId === state.user?.id;
  syncProfileDocumentsSectionVisibility(isOwnProfile);
  if (isOwnProfile) {
    fillProfileDocumentsUi(profile);
  }

  return profile;
}

async function openMyProfileModal(userId = null) {
  const modalEl = document.getElementById("myProfileModal");
  if (!modalEl) return;
  try {
    await loadMyProfileForm(userId);
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  } catch (err) {
    showToast(err.message || tr("profile.couldNotLoad"), "danger");
  }
}

async function saveMyProfile(e) {
  e.preventDefault();
  const saveBtn = document.getElementById("my-profile-save");
  const nameEl = document.getElementById("my-profile-display-name");
  const phoneEl = document.getElementById("my-profile-phone");
  const salaryEl = document.getElementById("my-profile-salary");
  if (!nameEl) return;

  const displayName = nameEl.value.trim();
  if (!displayName) {
    nameEl.reportValidity();
    return;
  }

  const phoneRaw = (phoneEl?.value || "").trim();
  if (phoneRaw && !/^\d{10}$/.test(phoneRaw)) {
    showToast(tr("profile.phoneInvalid"), "warning");
    phoneEl?.focus();
    return;
  }

  const body = {
    displayName,
    phone: phoneRaw || null,
  };

  if (canEditSalaryInProfileModal() && salaryEl) {
    const salary = Number.parseInt(salaryEl.value, 10);
    if (!Number.isFinite(salary) || salary < 0) {
      showToast(tr("profile.salaryInvalid"), "warning");
      salaryEl.focus();
      return;
    }
    body.salary = salary;
  }

  const endpoint =
    profileEditUserId && profileEditUserId !== state.user?.id
      ? `/api/users/${profileEditUserId}/profile`
      : "/api/users/profile";

  if (saveBtn) saveBtn.disabled = true;
  try {
    const { profile } = await api(endpoint, { method: "PATCH", body: JSON.stringify(body) });
    if (!profileEditUserId || profileEditUserId === state.user?.id) {
      state.user = {
        ...state.user,
        displayName: profile.displayName,
        phone: profile.phone,
        profileDocumentsComplete: profile.profileDocumentsComplete,
      };
      fillProfileDocumentsUi(profile);
      refreshMyProfileSettingsBadge(!profile.profileDocumentsComplete);
    }
    bootstrap.Modal.getInstance(document.getElementById("myProfileModal"))?.hide();
    showToast(tr("profile.saved"), "success");
    if (document.getElementById("team-admin-list")) {
      void refreshTeamAdminList();
    }
  } catch (err) {
    showToast(err.message || tr("profile.couldNotSave"), "danger");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function wireMyProfileModal() {
  const form = document.getElementById("my-profile-form");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";
  form.addEventListener("submit", (e) => {
    void saveMyProfile(e);
  });
  wireProfileDocumentsUpload({
    api,
    showToast,
    onUpdated: (profile) => {
      if (state.user) {
        state.user.profileDocumentsComplete = profile.profileDocumentsComplete;
      }
      refreshMyProfileSettingsBadge(!profile.profileDocumentsComplete);
    },
  });
  document.getElementById("myProfileModal")?.addEventListener("hidden.bs.modal", () => {
    profileEditUserId = null;
  });
}

function contactUsModalHtml() {
  return `
    <div class="modal fade" id="contactUsModal" tabindex="-1" aria-labelledby="contactUsModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <form id="contact-us-form">
            <div class="modal-header">
              <h2 class="modal-title h5 mb-0" id="contactUsModalTitle">${tr("contact.title")}</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
            </div>
            <div class="modal-body">
              <div class="contact-us-intro mb-3">
                <p class="mb-0">${tr("contact.intro")}</p>
              </div>
              <div class="mb-3">
                <label class="form-label" for="contact-us-email">${tr("common.email")}</label>
                <input type="email" class="form-control" id="contact-us-email" readonly disabled />
              </div>
              <div class="mb-3">
                <label class="form-label" for="contact-us-subject">${tr("contact.subject")}</label>
                <input type="text" class="form-control" id="contact-us-subject" maxlength="200" required autocomplete="off" placeholder="${tr("contact.subjectPlaceholder")}" />
              </div>
              <div class="mb-2">
                <label class="form-label" for="contact-us-message">${tr("contact.message")}</label>
                <textarea class="form-control" id="contact-us-message" rows="6" maxlength="8000" required placeholder="${tr("contact.messagePlaceholder")}"></textarea>
              </div>
              <p class="small text-muted mb-0" id="contact-us-reply-note"></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${tr("common.cancel")}</button>
              <button type="submit" class="btn btn-primary" id="contact-us-send">${tr("contact.send")}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function openContactUsModal() {
  const modalEl = document.getElementById("contactUsModal");
  if (!modalEl) return;
  closeAdminHeaderProfileMenus();
  const emailEl = document.getElementById("contact-us-email");
  const subjectEl = document.getElementById("contact-us-subject");
  const messageEl = document.getElementById("contact-us-message");
  const replyNote = document.getElementById("contact-us-reply-note");
  if (emailEl) emailEl.value = state.user?.email || "";
  if (subjectEl) subjectEl.value = "";
  if (messageEl) messageEl.value = "";
  if (replyNote) {
    const email = state.user?.email || "";
    replyNote.textContent = email ? tr("contact.replyNote", { email }) : tr("contact.replyNoteGeneric");
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  queueMicrotask(() => subjectEl?.focus());
}

async function submitContactUs(e) {
  e.preventDefault();
  const subjectEl = document.getElementById("contact-us-subject");
  const messageEl = document.getElementById("contact-us-message");
  const sendBtn = document.getElementById("contact-us-send");
  if (!subjectEl || !messageEl) return;

  const subject = subjectEl.value.trim();
  const message = messageEl.value.trim();
  if (!subject) {
    showToast(tr("contact.subjectRequired"), "warning");
    subjectEl.focus();
    return;
  }
  if (!message) {
    showToast(tr("contact.messageRequired"), "warning");
    messageEl.focus();
    return;
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = tr("contact.sending");
  }
  try {
    await api("/api/support/contact", {
      method: "POST",
      body: JSON.stringify({
        subject,
        message,
        appVersion: "web",
        appVersionCode: "web",
      }),
    });
    bootstrap.Modal.getInstance(document.getElementById("contactUsModal"))?.hide();
    showToast(tr("contact.sent"), "success");
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("not configured")) {
      showToast(tr("contact.notConfigured"), "warning");
    } else {
      showToast(err.message || tr("contact.couldNotSend"), "danger");
    }
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = tr("contact.send");
    }
  }
}

function wireContactUsModal() {
  const form = document.getElementById("contact-us-form");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";
  form.addEventListener("submit", (e) => {
    void submitContactUs(e);
  });
}

function teamAdminModalHtml() {
  return `
    <div class="modal fade" id="teamAdminModal" tabindex="-1" aria-labelledby="teamAdminModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-scrollable modal-dialog-centered team-admin-modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="teamAdminModalTitle">${tr("modals.teamAdminTitle")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body team-admin-modal-body">
            <p class="small text-muted mb-3">${tr("modals.teamAdminIntro")}</p>
            <div id="team-admin-list"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${tr("common.close")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function refreshTeamAdminList() {
  const host = document.getElementById("team-admin-list");
  if (!host) return;
  host.innerHTML = `<p class="small text-muted mb-0">${tr("common.loading")}</p>`;
  try {
    const { users, ownerCount = 0, maxOwners = 2 } = await api("/api/users/team");
    if (!users.length) {
      host.innerHTML = `<p class="small text-muted mb-0">${tr("modals.noTeamMembers")}</p>`;
      return;
    }
    const selfId = state.user?.id || "";
    const selfIsOwner = Boolean(state.user?.isOwner);
    host.innerHTML = `<div class="list-group list-group-flush border rounded team-admin-list">
      ${users
        .map((u) => {
          const isAdmin = Boolean(u.isAdmin);
          const isOwner = Boolean(u.isOwner);
          const isSelf = u.id === selfId;
          const badges = [];
          if (isOwner) {
            badges.push(
              `<span class="badge rounded-pill owner-role-badge team-admin-badge">${
                isSelf ? tr("owner.ownerYou") : tr("owner.ownerBadge")
              }</span>`
            );
          } else if (isAdmin && isSelf) {
            badges.push(
              `<span class="badge rounded-pill owner-role-badge team-admin-badge">${tr("owner.adminYou")}</span>`
            );
          }
          const actions = [];
          actions.push(
            `<button type="button" class="btn btn-sm btn-outline-secondary team-profile-btn" data-user-id="${u.id}">${tr("profile.viewProfile")}</button>`
          );
          if (isAdmin) {
            if (!isSelf) {
              actions.push(
                `<button type="button" class="btn btn-sm btn-outline-danger team-revoke-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
                  u.displayName
                )}">${tr("owner.revokeAdmin")}</button>`
              );
            }
            if (selfIsOwner && !isOwner && ownerCount < maxOwners) {
              actions.push(
                `<button type="button" class="btn btn-sm btn-outline-primary team-make-owner-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
                  u.displayName
                )}">${tr("owner.makeOwner")}</button>`
              );
            }
            if (selfIsOwner && isOwner && !isSelf) {
              actions.push(
                `<button type="button" class="btn btn-sm btn-outline-warning team-revoke-owner-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
                  u.displayName
                )}">${tr("owner.revokeOwner")}</button>`
              );
            }
          } else {
            actions.push(
              `<button type="button" class="btn btn-sm btn-primary team-promote-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
                u.displayName
              )}">${tr("owner.makeAdmin")}</button>`
            );
          }
          return `<div class="list-group-item team-admin-row">
            <div class="team-admin-row-inner">
              <div class="team-admin-user min-w-0">
                <div class="fw-medium team-admin-name">${escapeHtml(dt(u.displayName))}${
                  badges.length ? ` ${badges.join(" ")}` : ""
                }</div>
                <div class="small text-muted team-admin-email">${escapeHtml(u.email)}</div>
                <div class="small text-muted">${tr("profile.salary")}: ₹${Number(u.salary ?? 15000).toLocaleString()}</div>
              </div>
              <div class="team-admin-actions">
                ${actions.join("")}
              </div>
            </div>
          </div>`;
        })
        .join("")}
    </div>
    <p class="small text-muted mt-2 mb-0">${tr("owner.ownerLimitHint", { max: maxOwners, count: ownerCount })}</p>`;

    async function patchTeamRole(id, role, name, successMsg, warnMsg) {
      const result = await api(`/api/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      if (result.emailSent) {
        showToast(`${successMsg}${tr("owner.emailSentSuffix")}`, "success");
      } else {
        showToast(`${warnMsg}${tr("owner.emailNotSentSuffix")}`, "warning");
      }
      await refreshTeamAdminList();
      await loadAssignees();
    }

    async function patchCompanyOwner(id, isOwner, name) {
      await api(`/api/users/${id}/company-owner`, {
        method: "PATCH",
        body: JSON.stringify({ isOwner }),
      });
      showToast(
        isOwner ? tr("owner.madeOwnerSuccess", { name }) : tr("owner.revokedOwnerSuccess", { name }),
        "success"
      );
      await refreshTeamAdminList();
    }

    host.querySelectorAll(".team-promote-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (!id || !window.confirm(tr("owner.promoteConfirm", { name }))) return;
        btn.disabled = true;
        try {
          await patchTeamRole(id, "owner", name, tr("owner.promotedSuccess", { name }), tr("owner.promotedWarn", { name }));
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });

    host.querySelectorAll(".team-revoke-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (!id || !window.confirm(tr("owner.revokeConfirm", { name }))) return;
        btn.disabled = true;
        try {
          await patchTeamRole(
            id,
            "employee",
            name,
            tr("owner.revokedSuccess", { name }),
            tr("owner.revokedWarn", { name })
          );
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });

    host.querySelectorAll(".team-make-owner-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (!id || !window.confirm(tr("owner.makeOwnerConfirm", { name }))) return;
        btn.disabled = true;
        try {
          await patchCompanyOwner(id, true, name);
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });

    host.querySelectorAll(".team-revoke-owner-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (!id || !window.confirm(tr("owner.revokeOwnerConfirm", { name }))) return;
        btn.disabled = true;
        try {
          await patchCompanyOwner(id, false, name);
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });

    host.querySelectorAll(".team-profile-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-id");
        if (id) void openEmployeeProfileModal(id);
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="small text-danger mb-0">${escapeHtml(err.message)}</p>`;
  }
}

function wireTeamAdminModal() {
  const el = document.getElementById("teamAdminModal");
  if (!el) return;
  el.addEventListener("show.bs.modal", () => {
    refreshTeamAdminList();
  });
}

function filterOwnerMarkDoneModalList() {
  const q = (document.getElementById("owner-mark-done-search")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#owner-mark-done-list .owner-mark-done-row").forEach((row) => {
    const label = row.querySelector("label");
    const text = (label?.textContent || "").toLowerCase();
    row.classList.toggle("d-none", q.length > 0 && !text.includes(q));
  });
}

function fillOwnerMarkDoneModalList(taskId) {
  const task = findTaskById(taskId);
  const host = document.getElementById("owner-mark-done-list");
  const emptyEl = document.getElementById("owner-mark-done-empty");
  const hintEl = document.getElementById("owner-mark-done-hint");
  if (!host) return;
  if (!task) {
    host.innerHTML = "";
    emptyEl?.classList.remove("d-none");
    hintEl?.classList.add("d-none");
    return;
  }
  const assignees = task.assignees ?? [];
  if (assignees.length === 0) {
    host.innerHTML = "";
    emptyEl?.classList.remove("d-none");
    hintEl?.classList.add("d-none");
    return;
  }
  emptyEl?.classList.add("d-none");
  hintEl?.classList.remove("d-none");
  host.innerHTML = assignees
    .map((a) => {
      const cbId = `owner-md-mod-${taskId}-${a.id}`;
      return `<div class="owner-mark-done-row py-1">
        <div class="form-check mb-0">
          <input class="form-check-input owner-mark-done-modal-cb" type="checkbox" data-task-id="${taskId}" data-user-id="${
        a.id
      }" id="${cbId}" ${assigneeShowsSubmittedForOwner(a) ? "checked" : ""} />
          <label class="form-check-label" for="${cbId}">${escapeHtml(dt(a.displayName))}</label>
        </div>
      </div>`;
    })
    .join("");
}

function openOwnerMarkDoneModal(taskId) {
  const modalEl = document.getElementById("ownerMarkDoneModal");
  if (!modalEl) return;
  document.getElementById("owner-mark-done-task-id").value = taskId;
  const task = findTaskById(taskId);
  const titleLine = document.getElementById("owner-mark-done-task-title");
  if (titleLine) titleLine.textContent = task?.title ?? "—";
  const search = document.getElementById("owner-mark-done-search");
  if (search) search.value = "";
  fillOwnerMarkDoneModalList(taskId);
  filterOwnerMarkDoneModalList();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function wireOwnerMarkDoneModal() {
  const modal = document.getElementById("ownerMarkDoneModal");
  if (!modal || modal.dataset.markDoneWired === "1") return;
  modal.dataset.markDoneWired = "1";

  modal.addEventListener("change", async (e) => {
    const cb = e.target;
    if (!cb.classList?.contains("owner-mark-done-modal-cb")) return;
    const taskId = cb.getAttribute("data-task-id");
    const userId = cb.getAttribute("data-user-id");
    const listId = state.activeListId;
    if (!taskId || !userId || !listId) return;
    const prev = !cb.checked;
    try {
      await api(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ assigneeSetDone: { userId, assigneeDone: cb.checked } }),
      });
      await loadTasks(listId);
      fillOwnerMarkDoneModalList(taskId);
      filterOwnerMarkDoneModalList();
      renderOwnerMain();
    } catch (err) {
      showToast(err.message, "danger");
      cb.checked = prev;
    }
  });

  document.getElementById("owner-mark-done-search")?.addEventListener("input", filterOwnerMarkDoneModalList);

  modal.addEventListener("shown.bs.modal", () => {
    document.getElementById("owner-mark-done-search")?.focus();
  });

  modal.addEventListener("hidden.bs.modal", () => {
    const s = document.getElementById("owner-mark-done-search");
    if (s) s.value = "";
    filterOwnerMarkDoneModalList();
  });
}

function submissionPreviewText(text, max = 72) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function assigneeHasSubmission(a) {
  if (!a) return false;
  return !!(
    a.submissionText?.trim() ||
    assigneeProofUrls(a).length ||
    a.lastSubmissionText?.trim() ||
    assigneeProofUrls(a, { archived: true }).length
  );
}

function assigneeProofUrls(assignee, { archived = false } = {}) {
  if (!assignee) return [];
  const listKey = archived ? "lastCompletionProofUrls" : "completionProofUrls";
  const urls = assignee[listKey];
  if (Array.isArray(urls) && urls.length) return urls;
  const single = archived ? assignee.lastCompletionProofUrl : assignee.completionProofUrl;
  return single ? [single] : [];
}

/** Current occurrence only — excludes archived fields after a recurring roll. */
function employeeHasCurrentSubmission(a) {
  if (!a) return false;
  return !!(a.submissionText?.trim() || assigneeProofUrls(a).length);
}

function employeeHasArchivedSubmission(a) {
  if (!a) return false;
  return !!(a.lastSubmissionText?.trim() || assigneeProofUrls(a, { archived: true }).length);
}

/** Recurring task rolled forward; employee has not submitted the new occurrence yet. */
function employeeAwaitingFreshOccurrence(task, assigneeRow = employeeMyAssignee(task)) {
  if (!assigneeRow || assigneeRow.assigneeDone) return false;
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "none") return false;
  return !!assigneeRow.lastSubmittedAt && !employeeHasCurrentSubmission(assigneeRow);
}

function empTaskRowDisplayMode(task, me) {
  if (state.empFilter === "submitted") return "submitted";
  if (employeeAwaitingFreshOccurrence(task, me)) return "active";
  if (employeeAssigneeShowsAsSubmitted(task, me) && me?.assigneeDone) return "submitted";
  return "active";
}

/** Admin progress: submitted now or archived after a recurring roll. */
function assigneeShowsSubmittedForOwner(assignee) {
  if (!assignee) return false;
  if (assignee.assigneeDone) return true;
  return !!assignee.lastSubmittedAt && assigneeHasSubmission(assignee);
}

function assigneeRolledRecurringSubmission(assignee) {
  return assigneeShowsSubmittedForOwner(assignee) && !assignee.assigneeDone;
}

function resolveAssigneeSubmissionForView(assignee) {
  if (!assignee) {
    return { submissionText: "", proofUrl: null, proofUrls: [], archived: false, submittedAt: null };
  }
  const currentText = assignee.submissionText?.trim() || "";
  const currentProofUrls = assigneeProofUrls(assignee);
  if (currentText || currentProofUrls.length) {
    return {
      submissionText: currentText,
      proofUrl: currentProofUrls[0] ?? null,
      proofUrls: currentProofUrls,
      archived: false,
      submittedAt: assignee.lastSubmittedAt ?? null,
    };
  }
  const archivedProofUrls = assigneeProofUrls(assignee, { archived: true });
  return {
    submissionText: assignee.lastSubmissionText?.trim() || "",
    proofUrl: archivedProofUrls[0] ?? null,
    proofUrls: archivedProofUrls,
    archived: !!(assignee.lastSubmissionText?.trim() || archivedProofUrls.length),
    submittedAt: assignee.lastSubmittedAt ?? null,
  };
}

function lookupAssigneeSubmission(taskId, userId) {
  const task =
    state.empTasks.find((t) => t.id === taskId) ?? state.tasks.find((t) => t.id === taskId) ?? null;
  if (!task) return null;
  const assignee = (task.assignees ?? []).find((a) => a.id === userId) ?? null;
  if (!assignee) return null;
  const view = resolveAssigneeSubmissionForView(assignee);
  return {
    taskTitle: task.title,
    submissionText: view.submissionText,
    proofUrl: view.proofUrl,
    proofUrls: view.proofUrls,
    archived: view.archived,
    submittedAt: view.submittedAt,
  };
}

/** @type {{ url: string, kind: string, mime?: string }[]} */
let submissionDetailMediaItems = [];
let submissionLightboxIndex = 0;

function submissionLightboxVisualItems() {
  return submissionDetailMediaItems.filter((item) => item.kind === "image" || item.kind === "video" || item.kind === "pdf");
}

function renderSubmissionLightboxContent(item) {
  const inner = document.getElementById("submission-media-lightbox-inner");
  if (!inner || !item) return;
  inner.querySelectorAll("video").forEach((v) => {
    v.pause();
    v.removeAttribute("src");
    v.load();
  });
  inner.innerHTML = "";
  if (item.kind === "video") {
    const mime = item.mime && item.mime.startsWith("video/") ? item.mime : "video/mp4";
    inner.innerHTML = `<video class="submission-media-lightbox-video" controls autoplay playsinline src="${escapeHtml(item.url)}" type="${escapeHtml(mime)}"></video>`;
    return;
  }
  if (item.kind === "pdf") {
    inner.innerHTML = `<iframe class="submission-media-lightbox-pdf" src="${escapeHtml(item.url)}" title="${escapeHtml(tr("common.submissionPdf"))}"></iframe>`;
    return;
  }
  inner.innerHTML = `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(tr("common.submissionImage"))}" class="submission-media-lightbox-image" />`;
}

function syncSubmissionLightboxNav() {
  const visual = submissionLightboxVisualItems();
  const box = document.getElementById("submission-media-lightbox");
  const prev = box?.querySelector(".js-submission-media-lightbox-prev");
  const next = box?.querySelector(".js-submission-media-lightbox-next");
  const counter = document.getElementById("submission-media-lightbox-counter");
  const showNav = visual.length > 1;
  prev?.classList.toggle("d-none", !showNav);
  next?.classList.toggle("d-none", !showNav);
  counter?.classList.toggle("d-none", !showNav);
  if (showNav && counter) {
    counter.textContent = `${submissionLightboxIndex + 1} / ${visual.length}`;
  }
}

function openSubmissionMediaLightbox(index = 0) {
  const visual = submissionLightboxVisualItems();
  if (!visual.length) return;
  submissionLightboxIndex = Math.max(0, Math.min(index, visual.length - 1));
  const box = document.getElementById("submission-media-lightbox");
  if (!box) return;
  renderSubmissionLightboxContent(visual[submissionLightboxIndex]);
  syncSubmissionLightboxNav();
  box.classList.remove("d-none");
  document.body.classList.add("submission-media-lightbox-open");
}

function closeSubmissionMediaLightbox() {
  const box = document.getElementById("submission-media-lightbox");
  const inner = document.getElementById("submission-media-lightbox-inner");
  if (inner) {
    inner.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    inner.innerHTML = "";
  }
  box?.classList.add("d-none");
  document.body.classList.remove("submission-media-lightbox-open");
}

function stepSubmissionMediaLightbox(delta) {
  const visual = submissionLightboxVisualItems();
  if (visual.length <= 1) return;
  submissionLightboxIndex = (submissionLightboxIndex + delta + visual.length) % visual.length;
  renderSubmissionLightboxContent(visual[submissionLightboxIndex]);
  syncSubmissionLightboxNav();
}

function pushSubmissionDetailMediaItem(resource) {
  if (resource.kind === "audio") return -1;
  submissionDetailMediaItems.push({
    url: resource.url,
    kind: resource.kind || "image",
    mime: resource.mime,
  });
  return submissionDetailMediaItems.length - 1;
}

function clearSubmissionDetailMedia() {
  submissionDetailMediaItems = [];
  submissionLightboxIndex = 0;
  closeSubmissionMediaLightbox();
  const missingEl = document.getElementById("submission-detail-media-missing");
  if (missingEl) {
    missingEl.classList.add("d-none");
    missingEl.textContent = "";
  }
  const img = document.getElementById("submission-detail-img");
  const video = document.getElementById("submission-detail-video");
  const pdf = document.getElementById("submission-detail-pdf");
  const videoWrap = document.getElementById("submission-detail-video-wrap");
  const pdfWrap = document.getElementById("submission-detail-pdf-wrap");
  const gallery = document.getElementById("submission-detail-gallery");
  const imageFrame = document.getElementById("submission-detail-image-frame");
  if (img?.src?.startsWith("blob:")) {
    URL.revokeObjectURL(img.src);
    proofBlobUrls.delete(img.src);
  }
  if (img) {
    img.removeAttribute("src");
  }
  if (video) {
    if (video.src?.startsWith("blob:")) {
      URL.revokeObjectURL(video.src);
      proofBlobUrls.delete(video.src);
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  videoWrap?.classList.add("d-none");
  if (pdf?.src?.startsWith("blob:")) {
    URL.revokeObjectURL(pdf.src);
    proofBlobUrls.delete(pdf.src);
  }
  if (pdf) {
    pdf.removeAttribute("src");
  }
  pdfWrap?.classList.add("d-none");
  const audio = document.getElementById("submission-detail-audio");
  if (audio) {
    if (audio.src?.startsWith("blob:")) {
      URL.revokeObjectURL(audio.src);
      proofBlobUrls.delete(audio.src);
    }
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.classList.add("d-none");
  }
  if (gallery) {
    gallery.querySelectorAll("img, video, audio").forEach((node) => {
      if (node.src?.startsWith("blob:")) {
        URL.revokeObjectURL(node.src);
        proofBlobUrls.delete(node.src);
      }
      if (node.tagName === "VIDEO") {
        node.pause();
      }
    });
    gallery.innerHTML = "";
    gallery.classList.add("d-none");
  }
  imageFrame?.classList.add("d-none");
}

function appendSubmissionDetailGalleryItem(gallery, resource, mediaIndex) {
  const label =
    resource.kind === "video" ? tr("chat.viewVideoFullScreen") : tr("chat.viewImageFullScreen");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "submission-detail-gallery-open js-submission-media-open";
  btn.dataset.mediaIndex = String(mediaIndex);
  btn.setAttribute("aria-label", label);

  if (resource.kind === "video") {
    const node = document.createElement("video");
    node.src = resource.url;
    node.playsInline = true;
    node.preload = "metadata";
    node.muted = true;
    node.className = "submission-detail-gallery-video";
    btn.appendChild(node);
  } else {
    const node = document.createElement("img");
    node.src = resource.url;
    node.alt = tr("common.submissionImage");
    node.className = "submission-detail-gallery-img";
    btn.appendChild(node);
  }

  const badge = document.createElement("span");
  badge.className = "submission-detail-media-open-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.innerHTML = adminMsIcon("fullscreen");
  btn.appendChild(badge);
  gallery.appendChild(btn);
}

function appendSubmissionDetailGalleryAudio(gallery, resource) {
  const wrap = document.createElement("div");
  wrap.className = "submission-detail-gallery-audio-wrap";
  const label = document.createElement("p");
  label.className = "submission-detail-gallery-audio-label small mb-1";
  label.textContent = tr("tasks.voiceNote");
  const node = document.createElement("audio");
  node.src = resource.url;
  node.controls = true;
  node.preload = "auto";
  node.className = "submission-detail-gallery-audio w-100";
  prepareAssignmentAudioEl(node);
  wrap.appendChild(label);
  wrap.appendChild(node);
  gallery.appendChild(wrap);
}

async function openSubmissionDetailModal({
  title,
  submissionText,
  proofUrl,
  proofUrls,
  attachmentItems,
  submittedAt = null,
  mediaMissing = false,
}) {
  const modalEl = document.getElementById("submissionDetailModal");
  const titleEl = document.getElementById("submissionDetailTitle");
  const textWrap = document.getElementById("submission-detail-text-wrap");
  const textEl = document.getElementById("submission-detail-text");
  const fileWrap = document.getElementById("submission-detail-file-wrap");
  const fileLabel = document.getElementById("submission-detail-file-label");
  const missingEl = document.getElementById("submission-detail-media-missing");
  const imageFrame = document.getElementById("submission-detail-image-frame");
  const videoWrap = document.getElementById("submission-detail-video-wrap");
  const pdfWrap = document.getElementById("submission-detail-pdf-wrap");
  const gallery = document.getElementById("submission-detail-gallery");
  const img = document.getElementById("submission-detail-img");
  const video = document.getElementById("submission-detail-video");
  const pdf = document.getElementById("submission-detail-pdf");
  const audio = document.getElementById("submission-detail-audio");
  const emptyEl = document.getElementById("submission-detail-empty");
  if (!modalEl || !titleEl || !textWrap || !textEl || !fileWrap || !fileLabel || !imageFrame || !videoWrap || !pdfWrap || !gallery || !img || !video || !pdf || !audio || !emptyEl) return;

  const text = (submissionText || "").trim();
  const hasText = text.length > 0;
  const when = submittedAt ? formatProgressUpdateTime(submittedAt) : "";
  const items = attachmentItems?.length
    ? attachmentItems
    : (proofUrls?.length ? proofUrls : proofUrl ? [proofUrl] : []).map((url) => ({ url, kind: null }));
  const hasFile = items.length > 0;

  titleEl.textContent = title || tr("modals.submission");
  clearSubmissionDetailMedia();
  if (missingEl) {
    missingEl.classList.add("d-none");
    missingEl.textContent = "";
  }

  if (hasText) {
    textWrap.classList.remove("d-none");
    textEl.textContent = text;
  } else {
    textWrap.classList.add("d-none");
    textEl.textContent = "";
  }

  const showMissingNotice = (missingCount = items.length) => {
    if (!missingEl) return;
    const base = when
      ? tr("owner.submissionMediaUnavailableWithDate", { date: when })
      : tr("owner.submissionMediaUnavailable");
    missingEl.textContent =
      missingCount > 1
        ? `${base} (${tr("owner.submissionMediaMissingCount", { count: missingCount })})`
        : base;
    missingEl.classList.remove("d-none");
    fileWrap.classList.remove("d-none");
    fileLabel.textContent = tr("common.attachments");
  };

  if (hasFile) {
    fileWrap.classList.remove("d-none");
  } else {
    fileWrap.classList.add("d-none");
  }

  if (mediaMissing && hasFile) {
    showMissingNotice(items.length);
    emptyEl.classList.add("d-none");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    return;
  }

  emptyEl.classList.toggle("d-none", hasText || hasFile || Boolean(when));
  if (!hasText && !hasFile && when && emptyEl) {
    emptyEl.textContent = tr("owner.submissionRecordedOn", { date: when });
    emptyEl.classList.remove("d-none");
  } else if (emptyEl && (hasText || hasFile)) {
    emptyEl.textContent = tr("modals.noSubmissionContent");
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  if (!hasFile) return;

  try {
    if (items.length === 1) {
      const resource = attachmentItems?.length
        ? await loadAttachmentResource(items[0])
        : await fetchProofResource(items[0].url || items[0]);
      const mediaIndex = pushSubmissionDetailMediaItem(resource);
      if (resource.kind === "pdf") {
        fileLabel.textContent = "PDF";
        pdf.src = resource.url;
        pdfWrap.dataset.mediaIndex = String(mediaIndex);
        pdfWrap.classList.remove("d-none");
      } else if (resource.kind === "video") {
        fileLabel.textContent = tr("tasks.videoAttachment");
        video.src = resource.url;
        videoWrap.dataset.mediaIndex = String(mediaIndex);
        videoWrap.classList.remove("d-none");
      } else if (resource.kind === "audio") {
        fileLabel.textContent = tr("tasks.voiceNote");
        audio.src = resource.url;
        audio.controls = true;
        prepareAssignmentAudioEl(audio);
        audio.classList.remove("d-none");
        audio.load();
      } else {
        fileLabel.textContent = tr("tasks.imageAttachment");
        imageFrame.dataset.mediaIndex = String(mediaIndex);
        imageFrame.classList.remove("d-none");
        img.src = resource.url;
      }
      return;
    }

    fileLabel.textContent = tr("tasks.attachmentCount", { count: items.length });
    gallery.classList.remove("d-none");
    let missingCount = 0;
    for (const item of items) {
      try {
        const resource = attachmentItems?.length
          ? await loadAttachmentResource(item)
          : await fetchProofResource(item.url || item);
        if (resource.kind === "pdf") {
          const mediaIndex = pushSubmissionDetailMediaItem(resource);
          pdf.src = resource.url;
          pdfWrap.dataset.mediaIndex = String(mediaIndex);
          pdfWrap.classList.remove("d-none");
          continue;
        }
        if (resource.kind === "audio") {
          appendSubmissionDetailGalleryAudio(gallery, resource);
          continue;
        }
        const mediaIndex = pushSubmissionDetailMediaItem(resource);
        appendSubmissionDetailGalleryItem(gallery, resource, mediaIndex);
      } catch (err) {
        if (err?.code === "MEDIA_MISSING" || /media file not available/i.test(err?.message || "")) {
          missingCount += 1;
          continue;
        }
        throw err;
      }
    }
    if (missingCount > 0) showMissingNotice(missingCount);
    if (missingCount === items.length) {
      gallery.classList.add("d-none");
    }
  } catch (err) {
    if (err?.code === "MEDIA_MISSING" || /media file not available/i.test(err?.message || "")) {
      showMissingNotice();
      return;
    }
    modal.hide();
    showToast(err.message || tr("toast.couldNotLoadSubmissionFile"), "danger");
  }
}

async function openProofImageModal(proofUrl, altLabel) {
  await openSubmissionDetailModal({ title: altLabel, submissionText: null, proofUrl });
}

async function openSubmissionDetailForAssignee(taskId, userId, { archived = false } = {}) {
  const q =
    state.user?.role === "employee"
      ? archived
        ? "?archived=1"
        : ""
      : `?assigneeUserId=${encodeURIComponent(userId)}${archived ? "&archived=1" : ""}`;
  const data = await api(`/api/tasks/${taskId}/submission${q}`);
  const when = data.submittedAt ? formatProgressUpdateTime(data.submittedAt) : "";
  const title = when
    ? tr("owner.submissionTitleWithDate", { title: data.taskTitle || tr("modals.submission"), date: when })
    : data.taskTitle || tr("modals.submission");
  const proofUrls =
    data.completionProofUrls?.length > 0
      ? data.completionProofUrls
      : data.completionProofUrl
        ? [data.completionProofUrl]
        : [];
  await openSubmissionDetailModal({
    title,
    submissionText: data.submissionText,
    proofUrls,
    submittedAt: data.submittedAt || null,
    mediaMissing: Boolean(data.mediaMissing),
  });
}

function wireSubmissionDetailModal() {
  const modalEl = document.getElementById("submissionDetailModal");
  if (!modalEl || modalEl.dataset.wiredSubmissionDetail === "1") return;
  modalEl.dataset.wiredSubmissionDetail = "1";
  modalEl.addEventListener("hidden.bs.modal", () => {
    clearSubmissionDetailMedia();
  });
  modalEl.addEventListener("click", (e) => {
    const open = e.target.closest(".js-submission-media-open");
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    const mediaIndex = Number.parseInt(open.getAttribute("data-media-index") ?? "", 10);
    if (Number.isNaN(mediaIndex)) return;
    const visual = submissionLightboxVisualItems();
    const item = submissionDetailMediaItems[mediaIndex];
    if (!item) return;
    const visualIndex = visual.findIndex((v) => v.url === item.url && v.kind === item.kind);
    openSubmissionMediaLightbox(visualIndex >= 0 ? visualIndex : 0);
  });

  const lightbox = document.getElementById("submission-media-lightbox");
  lightbox?.addEventListener("click", (e) => {
    if (e.target.closest(".js-submission-media-lightbox-close") || e.target.classList.contains("submission-media-lightbox-backdrop")) {
      closeSubmissionMediaLightbox();
      return;
    }
    if (e.target.closest(".js-submission-media-lightbox-prev")) {
      e.preventDefault();
      stepSubmissionMediaLightbox(-1);
      return;
    }
    if (e.target.closest(".js-submission-media-lightbox-next")) {
      e.preventDefault();
      stepSubmissionMediaLightbox(1);
    }
  });

  if (!document.documentElement.dataset.wiredSubmissionLightboxKeys) {
    document.documentElement.dataset.wiredSubmissionLightboxKeys = "1";
    document.addEventListener("keydown", (e) => {
      const box = document.getElementById("submission-media-lightbox");
      if (!box || box.classList.contains("d-none")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeSubmissionMediaLightbox();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepSubmissionMediaLightbox(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepSubmissionMediaLightbox(1);
      }
    });
  }
}

function syncEmpSubmissionCharCount() {
  const ta = document.getElementById("emp-submission-text");
  const counter = document.getElementById("emp-submission-count");
  if (!ta || !counter) return;
  const len = ta.value.length;
  counter.textContent = `${len} / ${EMP_SUBMISSION_TEXT_MAX}`;
  counter.classList.toggle("text-danger", len >= EMP_SUBMISSION_TEXT_MAX);
}

/** @type {Map<File, string>} */
const empSubmissionPreviewUrls = new Map();

function resetEmpSubmissionPreview() {
  const input = document.getElementById("emp-submission-image");
  const wrap = document.getElementById("emp-submission-preview-wrap");
  if (input) input.value = "";
  for (const url of empSubmissionPreviewUrls.values()) {
    URL.revokeObjectURL(url);
  }
  empSubmissionPreviewUrls.clear();
  if (wrap) {
    wrap.innerHTML = "";
    wrap.classList.add("d-none");
  }
}

function openEmpSubmissionModal(task) {
  const modalEl = document.getElementById("empSubmissionModal");
  if (!modalEl || !task) return;
  const idInput = document.getElementById("emp-submission-task-id");
  const titleEl = document.getElementById("emp-submission-task-title");
  const ta = document.getElementById("emp-submission-text");
  const errEl = document.getElementById("emp-submission-error");
  if (!idInput || !titleEl || !ta || !errEl) return;

  const me = employeeMyAssignee(task);
  const freshOccurrence = employeeAwaitingFreshOccurrence(task, me);
  const resubmitAfterDone =
    !!me?.assigneeDone && (employeeHasCurrentSubmission(me) || employeeHasArchivedSubmission(me));
  const currentText =
    freshOccurrence || resubmitAfterDone ? "" : me?.submissionText?.trim() || "";

  idInput.value = task.id;
  titleEl.textContent = dt(task.title);
  ta.value = currentText;
  errEl.textContent = "";
  errEl.classList.add("d-none");
  resetEmpSubmissionPreview();
  syncEmpSubmissionCharCount();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  window.setTimeout(() => ta.focus(), 300);
}

async function submitEmployeeSubmission(taskId, submissionText, files) {
  const fd = new FormData();
  fd.append("submissionText", submissionText);
  for (const file of files ?? []) {
    fd.append("proof", file);
  }
  let res;
  try {
    res = await fetch(`/api/tasks/${taskId}/completion-proof`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
  } catch {
    throw new Error(tr("errors.networkSubmit"));
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      state.user = null;
      renderAuthForm();
      throw new Error(tr("toast.sessionExpired"));
    }
    throw new Error(submissionUploadErrorMessage(res, text));
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return data;
}

function wireEmpSubmissionModal() {
  const modalEl = document.getElementById("empSubmissionModal");
  if (!modalEl || modalEl.dataset.wiredEmpSubmission === "1") return;
  modalEl.dataset.wiredEmpSubmission = "1";

  const ta = document.getElementById("emp-submission-text");
  const pasteBtn = document.getElementById("emp-submission-paste");
  const fileInput = document.getElementById("emp-submission-image");
  const pickBtn = document.getElementById("emp-submission-pick-btn");
  const voiceBtn = document.getElementById("emp-submission-voice-btn");
  const submitBtn = document.getElementById("emp-submission-submit");
  const previewWrap = document.getElementById("emp-submission-preview-wrap");

  ta?.addEventListener("input", syncEmpSubmissionCharCount);

  let selectedProofFiles = [];
  const submissionVoiceTarget = {
    btnId: "emp-submission-voice-btn",
    statusId: "emp-submission-voice-status",
    onSave: (file) => addEmpSubmissionFiles([file]),
  };

  function syncEmpSubmissionFileInput() {
    if (!fileInput) return;
    try {
      const dt = new DataTransfer();
      for (const file of selectedProofFiles) {
        dt.items.add(file);
      }
      fileInput.files = dt.files;
    } catch {
      /* ignore: submit uses selectedProofFiles directly */
    }
  }

  function renderEmpSubmissionPreview() {
    if (!previewWrap) return;
    for (const url of empSubmissionPreviewUrls.values()) {
      URL.revokeObjectURL(url);
    }
    empSubmissionPreviewUrls.clear();
    previewWrap.innerHTML = "";
    if (!selectedProofFiles.length) {
      previewWrap.classList.add("d-none");
      return;
    }
    previewWrap.classList.remove("d-none");

    if (selectedProofFiles.length === 1 && isEmpSubmissionPdfFile(selectedProofFiles[0])) {
      const file = selectedProofFiles[0];
      previewWrap.innerHTML = `<div class="admin-emp-modal-preview-pdf d-flex align-items-center gap-2 w-100">
        <i class="bi bi-file-earmark-pdf text-danger fs-4" aria-hidden="true"></i>
        <span class="small text-break">${escapeHtml(file.name || "document.pdf")}</span>
        <button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-remove-proof-index="0" aria-label="${tr("common.remove")}">${tr("common.remove")}</button>
      </div>`;
    } else {
      selectedProofFiles.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        empSubmissionPreviewUrls.set(file, url);
        const tile = document.createElement("div");
        tile.className = "emp-submission-preview-item";
        if (isEmpSubmissionAudioFile(file)) {
          tile.innerHTML = `<div class="d-flex flex-column gap-1 p-2 w-100">
            <span class="small text-break">${escapeHtml(file.name || tr("tasks.voiceNote"))}</span>
            <audio src="${url}" controls preload="metadata" class="w-100"></audio>
            <button type="button" class="btn btn-sm btn-outline-danger align-self-end" data-remove-proof-index="${index}">${tr("common.remove")}</button>
          </div>`;
        } else {
          const media = isEmpSubmissionVideoFile(file)
            ? `<video src="${url}" class="emp-submission-preview-thumb" muted playsinline preload="metadata"></video>`
            : `<img src="${url}" alt="" class="emp-submission-preview-thumb" />`;
          tile.innerHTML = `${media}
            <button type="button" class="emp-submission-preview-remove" data-remove-proof-index="${index}" aria-label="${tr("common.removeFile")}">&times;</button>`;
        }
        previewWrap.appendChild(tile);
      });
    }

    previewWrap.querySelectorAll("[data-remove-proof-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove-proof-index"));
        if (Number.isNaN(idx)) return;
        selectedProofFiles.splice(idx, 1);
        syncEmpSubmissionFileInput();
        renderEmpSubmissionPreview();
      });
    });
  }

  function addEmpSubmissionFiles(incoming) {
    const next = [...selectedProofFiles];
    for (const file of incoming) {
      if (!file) continue;
      const candidate = isEmpSubmissionPdfFile(file) ? [file] : [...next.filter((f) => !isEmpSubmissionPdfFile(f)), file];
      const err = validateEmpSubmissionFileSet(candidate);
      if (err) {
        showToast(err, "warning");
        continue;
      }
      if (isEmpSubmissionPdfFile(file)) {
        next.length = 0;
        next.push(file);
        break;
      }
      if (next.some(isEmpSubmissionPdfFile)) continue;
      if (next.length >= EMP_SUBMISSION_MAX_IMAGES) {
        showToast(tr("toast.maxAttachments", { max: EMP_SUBMISSION_MAX_IMAGES }), "warning");
        break;
      }
      next.push(file);
    }
    selectedProofFiles = next;
    syncEmpSubmissionFileInput();
    renderEmpSubmissionPreview();
  }

  function insertTextAtCaret(text) {
    if (!ta) return;
    const value = ta.value ?? "";
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const room = EMP_SUBMISSION_TEXT_MAX - value.length + (end - start);
    if (room <= 0) return;
    const clipped = (text || "").slice(0, room);
    ta.value = value.slice(0, start) + clipped + value.slice(end);
    const nextPos = start + clipped.length;
    try {
      ta.setSelectionRange(nextPos, nextPos);
    } catch {
      /* ignore */
    }
    syncEmpSubmissionCharCount();
  }

  ta?.addEventListener("paste", (e) => {
    const cd = e?.clipboardData;
    if (!cd || !fileInput) return;

    const items = cd.items;
    if (!items || !items.length) return;

    const pastedFiles = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile?.();
      if (!f) continue;
      if (/^image\/|^video\/|application\/pdf/i.test(f.type) || /\.(pdf|mp4|webm|mov|m4v)$/i.test(f.name || "")) {
        pastedFiles.push(f);
      }
    }

    if (!pastedFiles.length) return;

    e.preventDefault();
    const clipText = (cd.getData("text/plain") || "").trim();
    addEmpSubmissionFiles(pastedFiles);
    if (clipText) insertTextAtCaret(clipText);
    syncEmpSubmissionCharCount();
    if (pastedFiles.length) showToast(tr("toast.pastedFile"), "success");
  });

  pasteBtn?.addEventListener("click", async () => {
    if (!ta) return;
    if (!navigator.clipboard?.readText) {
      showToast(tr("toast.clipboardNotSupported"), "warning");
      return;
    }
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        showToast(tr("toast.clipboardEmpty"), "warning");
        return;
      }
      const room = EMP_SUBMISSION_TEXT_MAX - ta.value.length;
      if (room <= 0) {
        showToast(tr("toast.notesLimit", { max: EMP_SUBMISSION_TEXT_MAX }), "warning");
        return;
      }
      ta.value = (ta.value + clip).slice(0, EMP_SUBMISSION_TEXT_MAX);
      syncEmpSubmissionCharCount();
      showToast(tr("toast.pastedClipboard"), "success");
    } catch {
      showToast(tr("toast.clipboardReadFailed"), "warning");
    }
  });

  pickBtn?.addEventListener("click", () => fileInput?.click());
  voiceBtn?.addEventListener("click", () => {
    void toggleVoiceRecording(submissionVoiceTarget);
  });

  fileInput?.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) return;
    addEmpSubmissionFiles(files);
    fileInput.value = "";
  });

  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("emp-submission-task-id");
    const errEl = document.getElementById("emp-submission-error");
    const taskId = idInput?.value?.trim();
    if (!taskId || !ta || !errEl) return;

    const text = ta.value.trim();
    const files = selectedProofFiles.length ? [...selectedProofFiles] : [...(fileInput?.files ?? [])];
    errEl.classList.add("d-none");
    errEl.textContent = "";

    if (!text && !files.length) {
      errEl.textContent = empSubmissionRequiredMsg();
      errEl.classList.remove("d-none");
      return;
    }
    if (text.length > EMP_SUBMISSION_TEXT_MAX) {
      errEl.textContent = `Submission notes must be ${EMP_SUBMISSION_TEXT_MAX} characters or fewer.`;
      errEl.classList.remove("d-none");
      return;
    }
    const fileErr = validateEmpSubmissionFileSet(files);
    if (fileErr) {
      errEl.textContent = fileErr;
      errEl.classList.remove("d-none");
      return;
    }

    submitBtn.disabled = true;
    try {
      const task = state.empTasks.find((t) => t.id === taskId);
      const result = await submitEmployeeSubmission(taskId, ta.value, files);
      if (task?.dueAt) clearReminderForTask(taskId, task.dueAt);
      bootstrap.Modal.getInstance(modalEl)?.hide();
      if (result?.task) {
        const idx = state.empTasks.findIndex((t) => t.id === taskId);
        if (idx >= 0) state.empTasks[idx] = result.task;
        else state.empTasks.push(result.task);
      }
      empCriticalOverdueSatisfiedIds.add(taskId);
      clearPostponeGraceForTask(taskId);
      removeEmployeeOverdueGate();
      syncEmployeeOverdueGate();
      showToast(tr("toast.taskSubmitted"), "success");
      state.empFilter = "submitted";
      await loadEmployeeTasks();
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmpTopbarTitle();
      syncEmployeeOverdueGate();
    } catch (err) {
      errEl.textContent = err.message || "Submission failed";
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    stopVoiceRecording(false);
    selectedProofFiles = [];
    resetEmpSubmissionPreview();
    if (ta) ta.value = "";
    syncEmpSubmissionCharCount();
    const errEl = document.getElementById("emp-submission-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("d-none");
    }
  });

  modalEl.addEventListener("shown.bs.modal", () => {
    selectedProofFiles = [];
  });
}

function progressUpdateTypeMeta(type) {
  return getProgressUpdateTypes().find((t) => t.id === type) ?? getProgressUpdateTypes()[3];
}

function formatProgressUpdateTime(iso) {
  if (!iso) return "";
  try {
    return formatShortDateTime24(iso);
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function assigneeInitials(displayName) {
  const parts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function ownerUpdateTotalCountBadgeHtml(count) {
  const total = count ?? 0;
  if (total < 1) return "";
  return `<span class="owner-update-total-badge tabular-nums" aria-label="${total} update${
    total === 1 ? "" : "s"
  } posted">${total}</span>`;
}

function ownerProgressUpdateBadgeHtml(assignee) {
  const total = assignee.progressUpdateCount ?? 0;
  const unread = assignee.unreadProgressUpdateCount ?? 0;
  if (total === 0 || unread === 0) return "";
  return `<span class="owner-update-unread-badge tabular-nums" aria-label="${unread} unread update${
    unread === 1 ? "" : "s"
  }">${unread}</span>`;
}

function ownerLatestUpdateSnippet(message, max = 96) {
  const text = dt((message || "").trim().replace(/\s+/g, " "));
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ownerAssigneeUpdatesHtml(taskId, assignee) {
  const latest = assignee.latestProgressUpdate;
  const total = assignee.progressUpdateCount ?? 0;
  const attachCount =
    assignee.progressAttachmentCount ?? latest?.attachmentCount ?? 0;
  if (!total) {
    return `<span class="owner-assignee-empty-hint text-muted small">${tr("modals.noUpdatesYet")}</span>`;
  }
  const rawMsg = (latest?.message || "").trim();
  const snippet =
    !rawMsg || rawMsg === "(Attachment)"
      ? attachCount
        ? tr("owner.updateHasAttachment")
        : tr("modals.noUpdatesYet")
      : ownerLatestUpdateSnippet(rawMsg);
  const badge = ownerProgressUpdateBadgeHtml(assignee);
  const attachIcon =
    attachCount > 0
      ? `<span class="owner-assignee-attach-icon" aria-hidden="true">${adminMsIcon("attach_file")}</span>`
      : "";
  return `<button
      type="button"
      class="owner-assignee-update-preview owner-view-progress-btn"
      data-view-progress-task-id="${taskId}"
      data-view-progress-user-id="${escapeHtml(assignee.id)}"
      data-view-progress-user-name="${escapeHtml(dt(assignee.displayName))}"
      title="${escapeHtml(tr("owner.viewAllUpdatesFor", { name: dt(assignee.displayName) }))}"
      aria-label="${tr("owner.viewAllUpdatesFor", { name: escapeHtml(dt(assignee.displayName)) })}"
    >
      ${badge}
      ${attachIcon}
      <span class="owner-assignee-update-text">${escapeHtml(snippet)}</span>
    </button>`;
}

function ownerDelegationHistoryHtml(task) {
  const rows = task.delegations ?? [];
  if (!rows.length) return "";
  const items = rows
    .map((d) => {
      const when = formatProgressUpdateTime(d.createdAt);
      return `<li class="owner-delegation-item"><i class="bi bi-arrow-right-short text-primary" aria-hidden="true"></i> ${escapeHtml(
        tr("owner.delegationAssigned", { from: d.fromUserName, to: d.toUserName })
      )} <span class="text-muted tabular-nums">· ${escapeHtml(when)}</span></li>`;
    })
    .join("");
  return `<div class="owner-delegation-history mt-3 px-1">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <p class="owner-task-detail-heading small text-secondary mb-0">${tr("owner.assignmentHistory")}</p>
        <button type="button" class="btn btn-sm btn-link p-0 owner-view-all-activity" data-task-id="${escapeHtml(task.id)}">${tr("owner.viewAllUpdates")}</button>
      </div>
      <ul class="list-unstyled small mb-0">${items}</ul>
    </div>`;
}

function ownerMockAssigneeUpdatesHtml(taskId, assignee) {
  const total = assignee.progressUpdateCount ?? 0;
  const latest = assignee.latestProgressUpdate;
  const attachCount =
    assignee.progressAttachmentCount ?? latest?.attachmentCount ?? 0;
  const badge =
    total > 0
      ? `<span class="admin-expand-count-badge tabular-nums" aria-label="${total} update${total === 1 ? "" : "s"}">${total}</span>`
      : "";
  if (!total) {
    return `<div class="admin-expand-col-block">
      <div class="admin-expand-col-head"><span class="admin-expand-col-label">${tr("owner.updatesCol")}</span></div>
      <p class="admin-expand-empty">${tr("owner.noUpdates")}</p>
    </div>`;
  }
  const rawMsg = (latest?.message || "").trim();
  const snippet =
    !rawMsg || rawMsg === "(Attachment)"
      ? attachCount
        ? tr("owner.updateHasAttachment")
        : tr("owner.noUpdates")
      : ownerLatestUpdateSnippet(rawMsg, 72);
  const attachHint =
    attachCount > 0
      ? `<span class="admin-expand-attach-hint">${adminMsIcon("attach_file")} ${escapeHtml(
          attachCount === 1 ? tr("owner.hasAttachment") : tr("owner.hasAttachments", { count: attachCount })
        )}</span>`
      : "";
  return `<div class="admin-expand-col-block">
    <div class="admin-expand-col-head">
      <span class="admin-expand-col-label">${tr("owner.updatesCol")}</span>
      ${badge}
    </div>
    <button type="button" class="admin-expand-snippet-btn owner-view-progress-btn" data-view-progress-task-id="${taskId}" data-view-progress-user-id="${escapeHtml(assignee.id)}" data-view-progress-user-name="${escapeHtml(dt(assignee.displayName))}" title="${escapeHtml(tr("owner.viewAllUpdatesFor", { name: dt(assignee.displayName) }))}">
      <span class="admin-expand-snippet">"${escapeHtml(snippet)}"</span>
      ${attachHint}
      <span class="admin-expand-open-hint">${escapeHtml(tr("owner.tapToViewUpdates"))}</span>
    </button>
  </div>`;
}

function assigneeOwnerCurrentSubmitted(assignee) {
  if (!assignee) return false;
  return !!(assignee.submissionText?.trim() || assigneeProofUrls(assignee).length);
}

function assigneeOwnerArchivedSubmitted(assignee) {
  if (!assignee) return false;
  return !!(assignee.lastSubmissionText?.trim() || assigneeProofUrls(assignee, { archived: true }).length);
}

async function reopenAssigneeForTask(taskId, userId, employeeName) {
  if (!taskId || !userId) return;
  if (!window.confirm(tr("owner.reassignConfirm", { name: employeeName || tr("common.employee") }))) return;
  try {
    const { task } = await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ reopenAssignee: { userId } }),
    });
    const idx = state.tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) state.tasks[idx] = task;
    if (
      (state.ownerTaskFilter === "completed" || state.ownerTaskFilter === "submitted") &&
      !task.completed
    ) {
      if (taskIsSubmittedAwaitingOwner(task)) state.ownerTaskFilter = "submitted";
      else if (taskIsInProgress(task)) state.ownerTaskFilter = "in_progress";
      else state.ownerTaskFilter = "active";
    }
    renderOwnerMain();
    showToast(tr("toast.taskReassigned"), "success");
  } catch (err) {
    showToast(err.message, "danger");
  }
}

async function markTaskReviewedByOwner(taskId) {
  if (!taskId) return;
  const task = findTaskById(taskId);
  if (!task || !taskIsSubmittedAwaitingOwner(task)) {
    showToast(tr("toast.taskNotAwaitingReview"), "warning");
    return;
  }
  try {
    const { task: updated } = await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: true }),
    });
    const idx = state.tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) state.tasks[idx] = updated;
    else if (updated) state.tasks.push(updated);
    // Refresh list so recurring spawn (if any) appears
    if (state.activeListId) {
      try {
        await loadTasks(state.activeListId);
      } catch {
        /* keep local update */
      }
    }
    state.ownerTaskFilter = "completed";
    renderOwnerMain();
    showToast(tr("toast.taskMarkedReviewed"), "success");
  } catch (err) {
    showToast(err.message, "danger");
  }
}

function ownerMockAssigneeSubmissionHtml(taskId, assignee) {
  const hasCurrent = assignee.assigneeDone && assigneeOwnerCurrentSubmitted(assignee);
  const hasArchived = assigneeOwnerArchivedSubmitted(assignee);
  if (!hasCurrent && !hasArchived) {
    if (assignee.assigneeDone) {
      return `<div class="admin-expand-col-block admin-expand-col-block--submission">
        <span class="admin-expand-col-label">${tr("modals.submission")}</span>
        <p class="admin-expand-empty">${tr("owner.noSubmissionYet")}</p>
        <button type="button" class="btn btn-sm btn-outline-warning owner-reassign-assignee-btn mt-2" data-reassign-task-id="${taskId}" data-reassign-user-id="${escapeHtml(assignee.id)}" data-reassign-user-name="${escapeHtml(dt(assignee.displayName))}">${adminMsIcon("assignment_return")} ${tr("owner.reassignTask")}</button>
      </div>`;
    }
    return `<div class="admin-expand-col-block admin-expand-col-block--submission">
      <span class="admin-expand-col-label">${tr("modals.submission")}</span>
      <p class="admin-expand-empty">${tr("owner.noSubmissionYet")}</p>
    </div>`;
  }
  const view = resolveAssigneeSubmissionForView(assignee);
  const when = view.submittedAt ? formatProgressUpdateTime(view.submittedAt) : "";
  const currentBtn = hasCurrent
    ? `<button type="button" class="admin-expand-view-submission owner-view-submission-btn" data-view-submission-task-id="${taskId}" data-view-submission-user-id="${escapeHtml(assignee.id)}" aria-label="${tr("owner.viewSubmissionFor", { name: escapeHtml(dt(assignee.displayName)) })}">${tr("owner.viewSubmission")}</button>`
    : "";
  const archivedBtn = hasArchived
    ? `<button type="button" class="admin-expand-view-submission owner-view-submission-btn" data-view-submission-task-id="${taskId}" data-view-submission-user-id="${escapeHtml(assignee.id)}" data-view-submission-archived="1" aria-label="${tr("owner.viewPreviousSubmissionFor", { name: escapeHtml(dt(assignee.displayName)) })}">${tr("owner.viewPreviousSubmission")}</button>`
    : "";
  const reassignBtn =
    assignee.assigneeDone
      ? `<button type="button" class="btn btn-sm btn-outline-warning owner-reassign-assignee-btn mt-2" data-reassign-task-id="${taskId}" data-reassign-user-id="${escapeHtml(assignee.id)}" data-reassign-user-name="${escapeHtml(dt(assignee.displayName))}">${adminMsIcon("assignment_return")} ${tr("owner.reassignTask")}</button>`
      : "";
  return `<div class="admin-expand-col-block admin-expand-col-block--submission">
    <span class="admin-expand-col-label">${tr("modals.submission")}</span>
    ${when ? `<p class="admin-expand-submission-meta tabular-nums mb-1">${escapeHtml(tr("owner.submittedOn", { date: when }))}</p>` : ""}
    <div class="d-flex flex-wrap gap-2 align-items-center">${currentBtn}${archivedBtn}</div>
    ${reassignBtn}
  </div>`;
}

function ownerMockAssigneeCardHtml(task, assignee, { isEmpAssignList = false } = {}) {
  const rolledSubmission = assigneeRolledRecurringSubmission(assignee);
  const isDone = assigneeShowsSubmittedForOwner(assignee);
  const statusLabel = assignee.assigneeDone
    ? tr("owner.statusSubmitted")
    : rolledSubmission
      ? tr("owner.statusResubmitRequired")
      : tr("owner.statusPending");
  const statusClass = isDone ? "admin-expand-status--submitted" : "admin-expand-status--pending";
  const avatarClass = isDone ? "admin-expand-card-avatar--done" : "admin-expand-card-avatar--pending";
  let chainLine = "";
  if (isEmpAssignList && assignee.assignedBy?.displayName) {
    chainLine = `${escapeHtml(dt(assignee.assignedBy.displayName))} → ${escapeHtml(dt(assignee.displayName))}`;
  } else if (!isEmpAssignList && assignee.assignedBy?.displayName) {
    chainLine = `${escapeHtml(dt(assignee.assignedBy.displayName))} → ${escapeHtml(dt(assignee.displayName))}`;
  } else {
    chainLine = `<span class="admin-expand-chain-direct">${tr("owner.directAssignment")}</span>`;
  }
  return `<article class="admin-expand-card">
    <div class="admin-expand-card-head">
      <div class="admin-expand-card-avatar ${avatarClass}" aria-hidden="true">${escapeHtml(assigneeInitials(assignee.displayName))}</div>
      <div class="admin-expand-card-ident min-w-0">
        <div class="admin-expand-card-name-row">
          <span class="admin-expand-card-name">${escapeHtml(dt(assignee.displayName))}</span>
          <span class="admin-expand-status ${statusClass}">${statusLabel}</span>
        </div>
        <p class="admin-expand-card-chain">${chainLine}</p>
      </div>
    </div>
    <div class="admin-expand-card-grid">
      ${ownerMockAssigneeUpdatesHtml(task.id, assignee)}
      ${ownerMockAssigneeSubmissionHtml(task.id, assignee)}
    </div>
  </article>`;
}

function syncAdminTaskExpandIcon(btn) {
  if (!btn) return;
  const icon = btn.querySelector(".admin-task-expand-icon .material-symbols-outlined");
  if (!icon) return;
  const expanded = btn.getAttribute("aria-expanded") === "true";
  icon.textContent = expanded ? "expand_less" : "expand_more";
  btn.closest(".owner-task-row")?.classList.toggle("admin-task-row--expanded", expanded);
}

function wireAdminTaskExpandPanel(root) {
  root.querySelectorAll(".owner-task-expand-btn").forEach((btn) => {
    syncAdminTaskExpandIcon(btn);
  });
  root.querySelectorAll(".owner-task-detail-collapse").forEach((el) => {
    const targetId = el.id;
    const btn = root.querySelector(`[data-bs-target="#${targetId}"]`);
    el.addEventListener("show.bs.collapse", () => syncAdminTaskExpandIcon(btn));
    el.addEventListener("hide.bs.collapse", () => syncAdminTaskExpandIcon(btn));
  });
}

function ownerAssigneeSubmissionHtml(taskId, assignee) {
  if (!assigneeHasSubmission(assignee)) {
    return `<span class="owner-assignee-empty-hint text-muted small">${tr("owner.noSubmissionYet")}</span>`;
  }
  const view = resolveAssigneeSubmissionForView(assignee);
  const when = view.submittedAt ? formatProgressUpdateTime(view.submittedAt) : "";
  const meta =
    view.archived && when
      ? `<span class="d-block small text-muted mt-1">${escapeHtml(tr("owner.lastSubmittedWhen", { when }))}</span>`
      : "";
  return `<div class="owner-assignee-submission-wrap">
      <button
        type="button"
        class="btn btn-sm btn-outline-primary owner-view-submission-btn owner-assignee-submission-btn"
        data-view-submission-task-id="${taskId}"
        data-view-submission-user-id="${escapeHtml(assignee.id)}"
        title="${tr("owner.viewSubmission")}"
        aria-label="${tr("owner.viewSubmissionFor", { name: escapeHtml(dt(assignee.displayName)) })}"
      >
        <i class="bi bi-eye me-1" aria-hidden="true"></i>${tr("owner.viewSubmission")}
      </button>
      ${meta}
    </div>`;
}

async function markProgressUpdatesRead(taskId, assigneeUserId) {
  await api(`/api/tasks/${taskId}/progress-updates/mark-read`, {
    method: "POST",
    body: JSON.stringify({ assigneeUserId }),
  });
}

async function markTaskProgressUpdatesRead(taskId) {
  const task = findTaskById(taskId);
  if (!task) return;
  const unreadAssignees = (task.assignees ?? []).filter((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
  for (const a of unreadAssignees) {
    await markProgressUpdatesRead(taskId, a.id);
  }
}

function progressUpdateAttachmentsHtml(attachments) {
  if (!attachments?.length) return "";
  const chips = attachments
    .map((a) => {
      const kind = a.kind === "voice" ? "audio" : a.kind || "image";
      const label =
        kind === "audio"
          ? tr("tasks.voiceNote")
          : kind === "pdf"
            ? a.originalName || "PDF"
            : kind === "video"
              ? a.originalName || "Video"
              : a.originalName || "Image";
      const icon =
        kind === "audio" ? "mic" : kind === "pdf" ? "picture_as_pdf" : kind === "video" ? "videocam" : "image";
      return `<button
        type="button"
        class="btn btn-sm btn-outline-secondary progress-update-attach-chip js-progress-update-attachment"
        data-attachment-url="${escapeHtml(a.url)}"
        data-attachment-kind="${escapeHtml(kind)}"
        data-attachment-mime="${escapeHtml(a.mimeType || "")}"
        data-attachment-name="${escapeHtml(a.originalName || label)}"
      >${adminMsIcon(icon)} <span>${escapeHtml(label)}</span></button>`;
    })
    .join("");
  return `<div class="progress-update-attachments">
    <div class="d-flex flex-wrap gap-2">${chips}</div>
    <div class="progress-update-attach-inline mt-2 d-none" aria-live="polite"></div>
  </div>`;
}

async function hydrateProgressUpdateAttachments(root) {
  if (!root) return;
  for (const wrap of root.querySelectorAll(".progress-update-attachments")) {
    const chips = [...wrap.querySelectorAll(".js-progress-update-attachment")];
    if (!chips.length) continue;
    const inlineHost = wrap.querySelector(".progress-update-attach-inline");
    if (!inlineHost) continue;
    inlineHost.innerHTML = "";
    inlineHost.classList.add("d-none");
    for (const chip of chips) {
      const item = {
        url: chip.getAttribute("data-attachment-url") || "",
        kind: chip.getAttribute("data-attachment-kind") || "image",
        mimeType: chip.getAttribute("data-attachment-mime") || "",
        originalName: chip.getAttribute("data-attachment-name") || "",
      };
      if (!item.url) continue;
      try {
        const resource = await loadAttachmentResource(item);
        const block = document.createElement("div");
        block.className = "progress-update-attach-inline-item";
        if (resource.kind === "audio") {
          const label = document.createElement("p");
          label.className = "small fw-semibold mb-1";
          label.textContent = item.originalName || tr("tasks.voiceNote");
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.className = "w-100";
          audio.src = resource.url;
          prepareAssignmentAudioEl(audio);
          block.appendChild(label);
          block.appendChild(audio);
        } else if (resource.kind === "image") {
          const img = document.createElement("img");
          img.src = resource.url;
          img.alt = item.originalName || tr("tasks.imageAttachment");
          img.className = "progress-update-attach-inline-image";
          img.loading = "lazy";
          block.appendChild(img);
        } else if (resource.kind === "video") {
          const video = document.createElement("video");
          video.src = resource.url;
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.className = "progress-update-attach-inline-video";
          block.appendChild(video);
        } else if (resource.kind === "pdf") {
          const frame = document.createElement("iframe");
          frame.src = resource.url;
          frame.title = item.originalName || "PDF";
          frame.className = "progress-update-attach-inline-pdf";
          block.appendChild(frame);
        } else {
          continue;
        }
        inlineHost.appendChild(block);
        inlineHost.classList.remove("d-none");
      } catch (err) {
        const fail = document.createElement("p");
        fail.className = "small text-danger mb-1";
        fail.textContent = err?.message || tr("toast.couldNotLoadSubmissionFile");
        inlineHost.appendChild(fail);
        inlineHost.classList.remove("d-none");
      }
    }
  }
}

async function openProgressUpdateAttachmentViewer(item) {
  const progressEl = document.getElementById("progressUpdateModal");
  const detailEl = document.getElementById("submissionDetailModal");
  if (!detailEl) return;

  const restoreProgress = Boolean(progressEl?.classList.contains("show"));
  const progressWasReadonly = document.getElementById("progress-update-readonly")?.value === "1";
  const progressTaskId = document.getElementById("progress-update-task-id")?.value || "";
  const progressUserId = document.getElementById("progress-update-user-id")?.value || "";
  const progressAssigneeLabel = document.getElementById("progress-update-assignee-label")?.textContent || "";

  // Bootstrap does not support nested modals — close progress review first, then open the viewer.
  if (restoreProgress && progressEl) {
    progressEl.dataset.keepHistoryOnHide = "1";
    await new Promise((resolve) => {
      const onHidden = () => {
        progressEl.removeEventListener("hidden.bs.modal", onHidden);
        resolve();
      };
      progressEl.addEventListener("hidden.bs.modal", onHidden);
      bootstrap.Modal.getInstance(progressEl)?.hide();
    });
  }

  try {
    await openSubmissionDetailModal({
      title: item.originalName || tr("tasks.attachments"),
      submissionText: null,
      attachmentItems: [item],
    });
  } catch (err) {
    showToast(err?.message || tr("toast.couldNotLoadSubmissionFile"), "danger");
    if (restoreProgress && progressEl) {
      delete progressEl.dataset.keepHistoryOnHide;
      bootstrap.Modal.getOrCreateInstance(progressEl).show();
      setProgressUpdateModalReadOnly(progressWasReadonly);
    }
    return;
  }

  const onDetailHidden = () => {
    detailEl.removeEventListener("hidden.bs.modal", onDetailHidden);
    if (!restoreProgress || !progressEl) return;
    delete progressEl.dataset.keepHistoryOnHide;
    bootstrap.Modal.getOrCreateInstance(progressEl).show();
    setProgressUpdateModalReadOnly(progressWasReadonly);
    if (progressWasReadonly && progressTaskId && progressUserId) {
      void loadProgressUpdateHistory(progressTaskId, progressUserId).catch(() => {});
    } else if (progressWasReadonly && progressTaskId && !progressUserId) {
      void loadProgressUpdateHistory(progressTaskId, "", { all: true }).catch(() => {});
    }
    const assigneeLabel = document.getElementById("progress-update-assignee-label");
    if (assigneeLabel && progressAssigneeLabel) {
      assigneeLabel.textContent = progressAssigneeLabel;
      assigneeLabel.classList.remove("d-none");
    }
  };
  detailEl.addEventListener("hidden.bs.modal", onDetailHidden);
}

function renderProgressUpdateTimeline(updates, { showAuthor = false } = {}) {
  if (!updates?.length) return "";
  return updates
    .map((u) => {
      const meta = progressUpdateTypeMeta(u.updateType);
      const author =
        showAuthor && u.displayName
          ? `<span class="small fw-semibold text-body-secondary">${escapeHtml(dt(u.displayName))}</span>`
          : "";
      const msg = (u.message || "").trim();
      const hidePlaceholder = msg === "(Attachment)" && (u.attachments?.length ?? 0) > 0;
      return `<article class="progress-update-item">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          ${author}
          <span class="badge rounded-pill ${meta.badgeClass}">${escapeHtml(meta.badge)}</span>
          <time class="small text-muted tabular-nums" datetime="${escapeHtml(u.createdAt)}">${escapeHtml(
        formatProgressUpdateTime(u.createdAt)
      )}</time>
        </div>
        ${hidePlaceholder ? "" : `<p class="progress-update-item-message small mb-0">${escapeHtml(dt(msg))}</p>`}
        ${progressUpdateAttachmentsHtml(u.attachments)}
      </article>`;
    })
    .join("");
}

function syncProgressUpdateCharCount() {
  const ta = document.getElementById("progress-update-message");
  const counter = document.getElementById("progress-update-count");
  if (!ta || !counter) return;
  counter.textContent = `${ta.value.length} / ${PROGRESS_UPDATE_TEXT_MAX}`;
}

function renderProgressUpdateTypeChips(selectedType = "started") {
  const host = document.getElementById("progress-update-type-chips");
  if (!host) return;
  host.innerHTML = getProgressUpdateTypes().map((typeItem) => {
    const active = typeItem.id === selectedType;
    return `<button
      type="button"
      class="btn btn-sm ${active ? "btn-primary" : "btn-outline-primary"} progress-update-type-chip"
      data-progress-type="${typeItem.id}"
      aria-pressed="${active}"
    >
      <i class="bi bi-${typeItem.icon} me-1" aria-hidden="true"></i>${typeItem.label}
    </button>`;
  }).join("");
}

function setProgressUpdateModalReadOnly(readOnly) {
  const compose = document.getElementById("progress-update-compose-wrap");
  const submitBtn = document.getElementById("progress-update-submit");
  const readonlyInput = document.getElementById("progress-update-readonly");
  if (readonlyInput) readonlyInput.value = readOnly ? "1" : "0";
  compose?.classList.toggle("d-none", readOnly);
  submitBtn?.classList.toggle("d-none", readOnly);
}

function renderDelegationTimeline(delegations) {
  if (!delegations?.length) return "";
  const items = delegations
    .map((d) => {
      const when = formatProgressUpdateTime(d.createdAt);
      return `<div class="progress-update-timeline-item owner-delegation-timeline-item small text-muted mb-2">
        <i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>
        ${escapeHtml(d.fromUserName)} assigned to ${escapeHtml(d.toUserName)}
        <span class="tabular-nums">· ${escapeHtml(when)}</span>
      </div>`;
    })
    .join("");
  return `<div class="owner-delegation-timeline mb-3 pb-2 border-bottom">${items}</div>`;
}

async function loadProgressUpdateHistory(taskId, userId, { all = false } = {}) {
  const historyEl = document.getElementById("progress-update-history");
  const emptyEl = document.getElementById("progress-update-history-empty");
  if (!historyEl || !emptyEl) return;
  const q = all
    ? "?all=1"
    : state.user?.role === "owner"
      ? `?assigneeUserId=${encodeURIComponent(userId)}`
      : "";
  const data = await api(`/api/tasks/${taskId}/progress-updates${q}`);
  const updates = data.updates ?? [];
  const delegationBlock = all ? renderDelegationTimeline(data.delegations ?? []) : "";
  historyEl.innerHTML = `${delegationBlock}${renderProgressUpdateTimeline(updates, { showAuthor: all })}`;
  const hasContent = updates.length > 0 || (all && (data.delegations ?? []).length > 0);
  emptyEl.classList.toggle("d-none", hasContent);
  historyEl.classList.toggle("d-none", !hasContent);
  await hydrateProgressUpdateAttachments(historyEl);
  return data;
}

async function openEmpProgressUpdateModal(task) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !task || !state.user?.id) return;
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  const ta = document.getElementById("progress-update-message");
  const errEl = document.getElementById("progress-update-error");
  if (!idInput || !userInput || !titleEl || !ta || !errEl) return;

  idInput.value = task.id;
  userInput.value = state.user.id;
  titleEl.textContent = dt(task.title);
  assigneeLabel?.classList.add("d-none");
  if (modalTitle) modalTitle.textContent = tr("modals.postTaskUpdate");
  ta.value = "";
  errEl.textContent = "";
  errEl.classList.add("d-none");
  setProgressUpdateModalReadOnly(false);
  renderProgressUpdateTypeChips("started");
  const startedMeta = progressUpdateTypeMeta("started");
  ta.value = startedMeta.defaultMsg;
  syncProgressUpdateCharCount();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(task.id, state.user.id);
  } catch (err) {
    showToast(err.message || tr("toast.couldNotLoadHistory"), "danger");
  }
  window.setTimeout(() => ta.focus(), 300);
}

async function openProgressUpdatesForAssignee(taskId, userId, assigneeName) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !taskId || !userId) return;
  const task = state.tasks.find((t) => t.id === taskId) ?? state.empTasks.find((t) => t.id === taskId);
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  if (!idInput || !userInput || !titleEl) return;

  idInput.value = taskId;
  userInput.value = userId;
  titleEl.textContent = task?.title ?? "Task";
  if (assigneeLabel) {
    assigneeLabel.textContent = `Employee: ${assigneeName || "Assignee"}`;
    assigneeLabel.classList.remove("d-none");
  }
  if (modalTitle) modalTitle.textContent = tr("modals.reviewUpdates");
  setProgressUpdateModalReadOnly(true);
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(taskId, userId);
  } catch (err) {
    showToast(err.message || tr("toast.couldNotLoadUpdates"), "danger");
  }
}

async function openProgressUpdatesAll(taskId) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !taskId) return;
  const task = state.tasks.find((t) => t.id === taskId);
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  if (!idInput || !userInput || !titleEl) return;

  idInput.value = taskId;
  userInput.value = "";
  titleEl.textContent = task?.title ?? "Task";
  if (assigneeLabel) {
    assigneeLabel.textContent = tr("modals.allEmployeesActivity");
    assigneeLabel.classList.remove("d-none");
  }
  if (modalTitle) modalTitle.textContent = tr("modals.fullActivity");
  setProgressUpdateModalReadOnly(true);
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(taskId, null, { all: true });
  } catch (err) {
    showToast(err.message || tr("toast.couldNotLoadActivity"), "danger");
  }
}

function wireProgressUpdateModal() {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || modalEl.dataset.wiredProgressUpdate === "1") return;
  modalEl.dataset.wiredProgressUpdate = "1";

  const chipsHost = document.getElementById("progress-update-type-chips");
  const ta = document.getElementById("progress-update-message");
  const submitBtn = document.getElementById("progress-update-submit");
  const fileInput = document.getElementById("progress-update-file-input");
  const pickBtn = document.getElementById("progress-update-pick-btn");
  const voiceBtn = document.getElementById("progress-update-voice-btn");
  const previewWrap = document.getElementById("progress-update-preview-wrap");

  /** @type {File[]} */
  let selectedProgressFiles = [];
  /** @type {Map<File, string>} */
  const progressPreviewUrls = new Map();

  const progressVoiceTarget = {
    btnId: "progress-update-voice-btn",
    statusId: "progress-update-voice-status",
    onSave: (file) => addProgressUpdateFiles([file]),
  };

  function clearProgressPreviewUrls() {
    for (const url of progressPreviewUrls.values()) URL.revokeObjectURL(url);
    progressPreviewUrls.clear();
  }

  function resetProgressUpdateFiles() {
    stopVoiceRecording(false);
    selectedProgressFiles = [];
    clearProgressPreviewUrls();
    if (fileInput) fileInput.value = "";
    renderProgressUpdatePreview();
  }

  function renderProgressUpdatePreview() {
    if (!previewWrap) return;
    clearProgressPreviewUrls();
    previewWrap.innerHTML = "";
    if (!selectedProgressFiles.length) {
      previewWrap.classList.add("d-none");
      return;
    }
    previewWrap.classList.remove("d-none");
    selectedProgressFiles.forEach((file, index) => {
      const tile = document.createElement("div");
      tile.className = "emp-submission-preview-item";
      if (isEmpSubmissionPdfFile(file)) {
        tile.innerHTML = `<div class="admin-emp-modal-preview-pdf d-flex align-items-center gap-2 w-100 p-2">
          <i class="bi bi-file-earmark-pdf text-danger fs-4" aria-hidden="true"></i>
          <span class="small text-break">${escapeHtml(file.name || "document.pdf")}</span>
          <button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-remove-progress-file="${index}" aria-label="${tr("common.remove")}">${tr("common.remove")}</button>
        </div>`;
      } else if (isEmpSubmissionAudioFile(file)) {
        const url = URL.createObjectURL(file);
        progressPreviewUrls.set(file, url);
        tile.innerHTML = `<div class="d-flex flex-column gap-1 p-2 w-100">
          <span class="small text-break">${escapeHtml(file.name || tr("tasks.voiceNote"))}</span>
          <audio src="${url}" controls preload="metadata" class="w-100"></audio>
          <button type="button" class="btn btn-sm btn-outline-danger align-self-end" data-remove-progress-file="${index}">${tr("common.remove")}</button>
        </div>`;
      } else {
        const url = URL.createObjectURL(file);
        progressPreviewUrls.set(file, url);
        const media = isEmpSubmissionVideoFile(file)
          ? `<video src="${url}" class="emp-submission-preview-thumb" muted playsinline preload="metadata"></video>`
          : `<img src="${url}" alt="" class="emp-submission-preview-thumb" />`;
        tile.innerHTML = `${media}
          <button type="button" class="emp-submission-preview-remove" data-remove-progress-file="${index}" aria-label="${tr("common.removeFile")}">&times;</button>`;
      }
      previewWrap.appendChild(tile);
    });
    previewWrap.querySelectorAll("[data-remove-progress-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove-progress-file"));
        if (Number.isNaN(idx)) return;
        selectedProgressFiles.splice(idx, 1);
        renderProgressUpdatePreview();
      });
    });
  }

  function addProgressUpdateFiles(incoming) {
    const next = [...selectedProgressFiles];
    for (const file of incoming ?? []) {
      if (!file) continue;
      const candidate = isEmpSubmissionPdfFile(file) ? [file] : [...next.filter((f) => !isEmpSubmissionPdfFile(f)), file];
      const err = validateEmpSubmissionFileSet(candidate);
      if (err) {
        showToast(err, "warning");
        continue;
      }
      if (isEmpSubmissionPdfFile(file)) {
        next.length = 0;
        next.push(file);
        break;
      }
      if (next.some(isEmpSubmissionPdfFile)) continue;
      if (next.length >= EMP_SUBMISSION_MAX_IMAGES) {
        showToast(tr("toast.maxAttachments", { max: EMP_SUBMISSION_MAX_IMAGES }), "warning");
        break;
      }
      next.push(file);
    }
    selectedProgressFiles = next;
    renderProgressUpdatePreview();
  }

  ta?.addEventListener("input", syncProgressUpdateCharCount);

  chipsHost?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-progress-type]");
    if (!btn || !ta) return;
    const type = btn.getAttribute("data-progress-type") || "update";
    renderProgressUpdateTypeChips(type);
    const meta = progressUpdateTypeMeta(type);
    const current = ta.value.trim();
    const defaults = getProgressUpdateTypes().map((t) => t.defaultMsg).filter(Boolean);
    if (!current || defaults.includes(current)) {
      ta.value = meta.defaultMsg;
      syncProgressUpdateCharCount();
    }
  });

  pickBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    addProgressUpdateFiles(e.target.files);
    e.target.value = "";
  });
  voiceBtn?.addEventListener("click", () => {
    void toggleVoiceRecording(progressVoiceTarget);
  });

  modalEl.addEventListener("click", (e) => {
    const chip = e.target.closest?.(".js-progress-update-attachment");
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    const url = chip.getAttribute("data-attachment-url");
    if (!url) return;
    void openProgressUpdateAttachmentViewer({
      id: url,
      url,
      kind: chip.getAttribute("data-attachment-kind") || "image",
      mimeType: chip.getAttribute("data-attachment-mime") || "",
      originalName: chip.getAttribute("data-attachment-name") || null,
    });
  });

  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("progress-update-task-id");
    const errEl = document.getElementById("progress-update-error");
    const taskId = idInput?.value?.trim();
    if (!taskId || !ta || !errEl) return;

    const activeChip = chipsHost?.querySelector(".progress-update-type-chip.btn-primary");
    const updateType = activeChip?.getAttribute("data-progress-type") || "update";
    const message = ta.value.trim();
    errEl.classList.add("d-none");
    errEl.textContent = "";

    if (!message && !selectedProgressFiles.length) {
      errEl.textContent = tr("validation.enterUpdateOrAttachment");
      errEl.classList.remove("d-none");
      return;
    }
    if (message.length > PROGRESS_UPDATE_TEXT_MAX) {
      errEl.textContent = `Updates must be ${PROGRESS_UPDATE_TEXT_MAX} characters or fewer.`;
      errEl.classList.remove("d-none");
      return;
    }

    submitBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("updateType", updateType);
      fd.append("message", message);
      for (const file of selectedProgressFiles) {
        fd.append("files", file, file.name);
      }
      const res = await fetch(`/api/tasks/${taskId}/progress-updates`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401) {
          state.user = null;
          renderAuthForm();
          throw new Error(tr("toast.sessionExpired"));
        }
        let msg = text;
        try {
          msg = JSON.parse(text)?.error ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(typeof msg === "string" ? msg : tr("validation.postUpdateFailed"));
      }
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToast(tr("toast.updatePosted"), "success");
      ta.value = "";
      resetProgressUpdateFiles();
      syncProgressUpdateCharCount();
      const userId = state.user?.id;
      if (userId) await loadProgressUpdateHistory(taskId, userId);
      await loadEmployeeTasks();
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmployeeOverdueGate();
    } catch (err) {
      errEl.textContent = err.message || tr("validation.postUpdateFailed");
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    // Temporarily closing so an attachment viewer can open — keep review state.
    if (modalEl.dataset.keepHistoryOnHide === "1") return;
    if (ta) ta.value = "";
    syncProgressUpdateCharCount();
    resetProgressUpdateFiles();
    const errEl = document.getElementById("progress-update-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("d-none");
    }
    setProgressUpdateModalReadOnly(false);
  });
}

async function loadLists() {
  const { lists } = await api("/api/lists");
  state.lists = lists;
  if (!state.activeListId && lists.length) {
    const empList = lists.find((l) => isEmployeeAssignmentsList(l));
    state.activeListId = empList?.id ?? lists[0].id;
  }
}

function markOwnerNavBusy(ms = 450) {
  ownerNavBusyUntil = Date.now() + ms;
}

function isOwnerNavBusy() {
  return Date.now() < ownerNavBusyUntil;
}

function scheduleOwnerListBackgroundRefresh(listId) {
  ownerListRefreshTarget = listId;
  if (ownerListRefreshTimer != null) {
    window.clearTimeout(ownerListRefreshTimer);
  }
  ownerListRefreshTimer = window.setTimeout(() => {
    ownerListRefreshTimer = null;
    const target = ownerListRefreshTarget;
    ownerListRefreshTarget = null;
    if (target) void refreshOwnerListTasksInBackground(target);
  }, 900);
}

function ownerTasksFingerprintFrom(tasks) {
  if (!tasks?.length) return "0";
  const parts = [];
  for (const t of tasks) {
    let assigneeSig = "";
    for (const a of t.assignees ?? []) {
      assigneeSig += `${a.id}:${a.assigneeDone ? 1 : 0}:${a.unreadProgressUpdateCount ?? 0};`;
    }
    parts.push(
      `${t.id}:${t.completed ? 1 : 0}:${t.highPriority ? 1 : 0}:${t.sortOrder ?? 0}:${t.dueAt ?? ""}:${assigneeSig}`
    );
  }
  return `${tasks.length}|${parts.join(",")}`;
}

function captureOwnerExpandedTaskIds() {
  const ids = [];
  document.querySelectorAll(".owner-task-detail-collapse.show").forEach((el) => {
    const match = /^owner-task-detail-(.+)$/.exec(el.id || "");
    if (match) ids.push(match[1]);
  });
  return ids;
}

function restoreOwnerExpandedTaskIds(ids) {
  for (const id of ids) {
    const el = document.getElementById(`owner-task-detail-${id}`);
    if (el && !el.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(el).show();
    }
  }
}

function captureOwnerUiState() {
  const main = document.getElementById("main-column");
  return {
    expandedTaskIds: captureOwnerExpandedTaskIds(),
    scrollTop: main?.scrollTop ?? 0,
  };
}

function restoreOwnerUiState(ui) {
  if (!ui) return;
  const main = document.getElementById("main-column");
  if (main && ui.scrollTop > 0) main.scrollTop = ui.scrollTop;
  restoreOwnerExpandedTaskIds(ui.expandedTaskIds);
  document.querySelectorAll(".owner-task-expand-btn").forEach((btn) => syncAdminTaskExpandIcon(btn));
}

async function ownerCreateTaskFromSidebar() {
  openOwnerCreateTaskModal();
}

function ownerTaskModalLists() {
  return state.lists.filter((l) => !isEmployeeAssignmentsList(l));
}

function populateTaskModalListOptions(selectedListId) {
  const select = document.getElementById("modal-move-list");
  if (!select) return;
  const lists = ownerTaskModalLists();
  select.innerHTML = lists
    .map(
      (l) =>
        `<option value="${l.id}" ${l.id === selectedListId ? "selected" : ""}>${escapeHtml(dt(l.title))}</option>`
    )
    .join("");
  select.disabled = lists.length === 0;
}

function openOwnerCreateTaskModal() {
  const lists = ownerTaskModalLists();
  if (!lists.length) {
    showToast(tr("toast.createListFirst"), "warning");
    return;
  }
  let listId = state.activeListId;
  const activeList = state.lists.find((l) => l.id === listId);
  if (!listId || isEmployeeAssignmentsList(activeList) || isAllTasksList(listId)) {
    listId = lists[0].id;
  }

  const modalEl = document.getElementById("taskModal");
  if (!modalEl) return;
  modalEl.dataset.mode = "create";
  document.getElementById("modal-task-id").value = "";
  document.getElementById("modal-title").value = "";
  document.getElementById("modal-notes").value = "";
  const highPriEl = document.getElementById("modal-high-priority");
  if (highPriEl) highPriEl.checked = false;
  pendingCustomRecurrence = null;
  fillModalDueFields({ allDay: false, recurrence: "none", dueAt: null });
  fillModalDurationFields(null);
  fillModalReminderFields({ reminderBeforeMinutes: null });
  syncModalCustomRepeatUi();
  document.getElementById("modal-schedule-wrap")?.classList.remove("d-none");
  document.getElementById("modal-list-wrap")?.classList.remove("d-none");
  document.getElementById("modal-assignee-wrap")?.classList.remove("d-none");
  populateTaskModalListOptions(listId);
  fillModalAssigneeCheckboxes([]);
  document.getElementById("modal-delete")?.classList.add("d-none");

  const panel = document.getElementById("modal-assignee-panel");
  if (panel?.classList.contains("show")) {
    bootstrap.Collapse.getOrCreateInstance(panel).hide();
  }
  resetModalAssignmentAttachments();

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  queueMicrotask(() => {
    document.getElementById("modal-title")?.focus();
  });
  updateModalSaveEnabled();
}

function isOwnerInteractiveBusy() {
  for (const id of [
    "taskModal",
    "ownerMarkDoneModal",
    "submissionDetailModal",
    "listNameModal",
    "customRecurrenceModal",
    "teamAdminModal",
    "myProfileModal",
    "contactUsModal",
    "progressUpdateModal",
  ]) {
    const el = document.getElementById(id);
    if (el?.classList.contains("show")) return true;
  }
  return false;
}

function isOwnerSortableActive() {
  return !!document.querySelector(".sortable-ghost, .sortable-drag, .sortable-chosen");
}

function updateOwnerTasksFingerprint() {
  ownerTasksFingerprint = ownerTasksFingerprintFrom(state.tasks);
}

async function syncOwnerDashboard({ forceRender = false } = {}) {
  if (state.user?.role !== "owner") return;
  if (!document.getElementById("main-column")) return;
  if (state.ownerView === "reports" || state.ownerView === "owner-dashboard") {
    if (forceRender) {
      if (state.ownerView === "owner-dashboard") void refreshOwnerDashboard({ force: true });
      else void refreshAdminReports({ force: true });
    }
    return;
  }
  if (!state.activeListId) return;
  if (!forceRender && document.hidden) return;
  if (!forceRender && (isOwnerInteractiveBusy() || isOwnerSortableActive() || isOwnerNavBusy())) return;

  const ui = forceRender ? null : captureOwnerUiState();
  try {
    if (isAllTasksList(state.activeListId)) {
      const before = ownerTasksFingerprint;
      await loadAllOwnerTasks();
      if (!forceRender && ownerTasksFingerprint === before) return;
      renderOwnerMain();
      restoreOwnerUiState(ui);
      return;
    }
    const { tasks } = await api(`/api/tasks/lists/${state.activeListId}`);
    const fp = ownerTasksFingerprintFrom(tasks);
    if (!forceRender && fp === ownerTasksFingerprint) return;
    ownerTasksFingerprint = fp;
    state.tasks = tasks;
    ownerTasksCache.set(state.activeListId, tasks);
    renderOwnerMain();
    restoreOwnerUiState(ui);
  } catch {
    /* background sync — ignore transient errors */
  }
}

function onOwnerVisibilitySync() {
  if (!document.hidden) void syncOwnerDashboard();
}

function onOwnerFocusSync() {
  void syncOwnerDashboard();
}

function stopOwnerAutoSync() {
  if (ownerSyncTimer != null) {
    window.clearInterval(ownerSyncTimer);
    ownerSyncTimer = null;
  }
  document.removeEventListener("visibilitychange", onOwnerVisibilitySync);
  window.removeEventListener("focus", onOwnerFocusSync);
  ownerTasksFingerprint = "";
}

function startOwnerAutoSync() {
  stopOwnerAutoSync();
  if (state.user?.role !== "owner") return;
  updateOwnerTasksFingerprint();
  ownerSyncTimer = window.setInterval(() => {
    void syncOwnerDashboard();
  }, OWNER_SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", onOwnerVisibilitySync);
  window.addEventListener("focus", onOwnerFocusSync);
}

async function loadAllOwnerTasks({ awaitTranslation = false } = {}) {
  if (!state.lists.length) {
    state.tasks = [];
    updateOwnerTasksFingerprint();
    ownerTasksCache.set(OWNER_ALL_TASKS_LIST_ID, []);
    return;
  }
  try {
    const { tasks } = await api("/api/tasks/owner-all");
    state.tasks = (tasks ?? []).map((task) => ({
      ...task,
      ownerAllTasksListId: task.listId ?? task.list?.id ?? null,
      ownerAllTasksListTitle: task.list?.title ?? "",
    }));
  } catch {
    const batches = await Promise.all(
      state.lists.map(async (list) => {
        try {
          const { tasks } = await api(`/api/tasks/lists/${list.id}`);
          return (tasks ?? []).map((task) => ({
            ...task,
            ownerAllTasksListId: list.id,
            ownerAllTasksListTitle: list.title,
          }));
        } catch {
          return [];
        }
      })
    );
    state.tasks = batches.flat();
  }
  updateOwnerTasksFingerprint();
  ownerTasksCache.set(OWNER_ALL_TASKS_LIST_ID, state.tasks);
  const runTranslation = async () => {
    const updated = await ensureStateContentTranslations(state);
    if (
      updated &&
      state.user?.role === "owner" &&
      state.ownerView === "dashboard" &&
      isAllTasksList(state.activeListId) &&
      !isOwnerNavBusy()
    ) {
      renderOwnerMain();
      initListSortable();
    }
  };
  if (awaitTranslation) await runTranslation();
  else void runTranslation();
}

async function loadTasks(listId, { awaitTranslation = false } = {}) {
  if (!listId) {
    state.tasks = [];
    updateOwnerTasksFingerprint();
    return;
  }
  if (isAllTasksList(listId)) {
    await loadAllOwnerTasks({ awaitTranslation });
    return;
  }
  const { tasks } = await api(`/api/tasks/lists/${listId}`);
  state.tasks = tasks;
  ownerTasksCache.set(listId, tasks);
  updateOwnerTasksFingerprint();
  const runTranslation = async () => {
    const updated = await ensureStateContentTranslations(state);
    if (
      updated &&
      state.user?.role === "owner" &&
      state.ownerView === "dashboard" &&
      state.activeListId === listId &&
      !isOwnerNavBusy()
    ) {
      renderOwnerMain();
      initListSortable();
    }
  };
  if (awaitTranslation) await runTranslation();
  else void runTranslation();
}

async function loadAssignees() {
  try {
    const { users, monthlyBudgetMinutes } = await api("/api/users/assignees");
    state.assignees = users;
    if (monthlyBudgetMinutes != null) state.monthlyBudgetMinutes = monthlyBudgetMinutes;
  } catch {
    state.assignees = [];
  }
}

function updateOwnerSidebarActiveState() {
  const onDashboard = state.ownerView === "dashboard";
  document.querySelectorAll("[data-list-id]").forEach((btn) => {
    const listId = btn.getAttribute("data-list-id");
    const active = onDashboard && listId === state.activeListId;
    btn.classList.toggle("active", active);
    if (btn.dataset.systemPinned === "1") {
      const actions = btn.querySelector(".owner-list-item-actions");
      if (!actions) return;
      const chevron = actions.querySelector(".admin-nav-chevron");
      if (active && !chevron) {
        actions.insertAdjacentHTML("afterbegin", adminMsIcon("chevron_right", "admin-nav-chevron"));
      } else if (!active && chevron) {
        chevron.remove();
      }
    }
  });
  document.querySelectorAll(".js-owner-reports-nav").forEach((btn) => {
    btn.classList.toggle("admin-sidebar-nav-item--active", state.ownerView === "reports");
  });
  document.querySelectorAll(".js-owner-attendance-nav").forEach((btn) => {
    btn.classList.toggle("admin-sidebar-nav-item--active", state.ownerView === "attendance");
  });
  document.querySelectorAll(".js-owner-deadline-extensions-nav").forEach((btn) => {
    btn.classList.toggle("admin-sidebar-nav-item--active", state.ownerView === "deadline-extensions");
  });
}

function navigateOwnerView(view) {
  dismissAdminMobileNav();
  if (state.ownerView === view) {
    updateOwnerSidebarActiveState();
    return;
  }
  markOwnerNavBusy(500);
  state.ownerView = view;
  ownerMainLoading = false;
  updateOwnerSidebarActiveState();
  renderOwnerMain();
}

async function selectOwnerList(listId) {
  if (!listId) return;
  dismissAdminMobileNav();
  if (listId === state.activeListId && state.ownerView === "dashboard" && !ownerMainLoading) {
    updateOwnerSidebarActiveState();
    return;
  }
  markOwnerNavBusy(500);
  state.ownerView = "dashboard";
  clearAdminReportsCache();
  if (!isAllTasksList(listId)) {
    state.allTasksEmployeeFilter = "all";
    state.allTasksListFilter = "all";
    state.allTasksDeadlineFilter = "all";
  }
  state.activeListId = listId;
  state.ownerTaskFilter = "active";
  updateOwnerSidebarActiveState();

  const cached = ownerTasksCache.get(listId);
  if (cached) {
    ownerMainLoading = false;
    state.tasks = cached;
    updateOwnerTasksFingerprint();
    renderOwnerMain();
    initListSortable();
    scheduleOwnerListBackgroundRefresh(listId);
    return;
  }

  ownerMainLoading = true;
  state.tasks = [];
  updateOwnerTasksFingerprint();
  renderOwnerMain();

  try {
    await loadTasks(listId);
    if (state.activeListId === listId && state.ownerView === "dashboard") {
      ownerMainLoading = false;
      renderOwnerMain();
      initListSortable();
    }
  } catch (err) {
    ownerMainLoading = false;
    if (state.activeListId === listId && state.ownerView === "dashboard") {
      renderOwnerMain();
    }
    showToast(err.message, "danger");
  }
}

async function refreshOwnerListTasksInBackground(listId) {
  try {
    const before = ownerTasksFingerprint;
    await loadTasks(listId);
    if (
      state.activeListId === listId &&
      state.ownerView === "dashboard" &&
      ownerTasksFingerprint !== before
    ) {
      renderOwnerMain();
      initListSortable();
    }
  } catch {
    /* background refresh */
  }
}

function bindListNavHandlers() {
  document.querySelectorAll(".js-list-host, .js-emp-assign-list-host, .js-all-tasks-host").forEach((host) => {
    host.querySelectorAll("[data-list-id]").forEach((btn) => {
      btn.querySelectorAll(".js-list-delete").forEach((delBtn) => {
        delBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const listId = btn.getAttribute("data-list-id");
          if (listId) void deleteTaskList(listId);
        });
        delBtn.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          const listId = btn.getAttribute("data-list-id");
          if (listId) void deleteTaskList(listId);
        });
      });
      btn.addEventListener("click", (e) => {
        if (e.target.closest(".grip-handle, .js-list-delete")) return;
        const listId = btn.getAttribute("data-list-id");
        if (listId) void selectOwnerList(listId);
      });
      btn.querySelector(".list-title-edit")?.addEventListener("dblclick", async (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute("data-list-id");
        const list = state.lists.find((x) => x.id === id);
        if (isEmployeeAssignmentsList(list)) return;
        const name = await openListNameModal({
          heading: tr("owner.renameList"),
          fieldLabel: tr("modals.listName"),
          initialValue: list?.title || "",
        });
        if (name == null || !name.trim()) return;
        try {
          await api(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ title: name.trim() }) });
          await loadLists();
          renderOwnerChrome();
        } catch (err) {
          showToast(err.message, "danger");
        }
      });
      if (host.classList.contains("js-list-host")) {
        wireListPinHold(btn);
      }
    });
  });
}

function isEmployeeAssignmentsList(list) {
  return list?.kind === "employee_assignments" || list?.title === tr("nav.employeeAssignments");
}

function isAllTasksList(listOrId) {
  const id = typeof listOrId === "string" ? listOrId : listOrId?.id;
  return id === OWNER_ALL_TASKS_LIST_ID;
}

function ownerAllTasksNavButtonHtml() {
  const active = state.ownerView === "dashboard" && isAllTasksList(state.activeListId);
  return `<button type="button" class="admin-sidebar-nav-item owner-list-item owner-list-item--pinned${active ? " active" : ""}" data-list-id="${OWNER_ALL_TASKS_LIST_ID}" data-system-pinned="1">
    <span class="admin-nav-item-left min-w-0">
      ${adminMsIcon("format_list_bulleted")}
      <span class="owner-emp-assign-title" title="${tr("nav.allTasksHint")}">${escapeHtml(tr("nav.allTasks"))}</span>
    </span>
    <span class="owner-list-item-actions">
      ${active ? adminMsIcon("chevron_right", "admin-nav-chevron") : ""}
    </span>
  </button>`;
}

function ownerTaskListBadgeHtml(task) {
  if (!isAllTasksList(state.activeListId)) return "";
  const badges = [];
  const listTitle =
    task.ownerAllTasksListTitle ||
    state.lists.find((l) => l.id === task.ownerAllTasksListId)?.title ||
    "";
  if (listTitle) {
    badges.push(`<span class="owner-task-list-badge">${escapeHtml(dt(listTitle))}</span>`);
  }
  const assigneeNames = (task.assignees ?? [])
    .map((assignee) => dt(assignee.displayName || assignee.email || tr("common.employee")))
    .filter(Boolean);
  if (assigneeNames.length) {
    badges.push(`<span class="owner-task-assignee-badge">${escapeHtml(assigneeNames.join(", "))}</span>`);
  } else {
    badges.push(
      `<span class="owner-task-assignee-badge owner-task-assignee-badge--unassigned">${escapeHtml(tr("common.unassigned"))}</span>`
    );
  }
  if (!badges.length) return "";
  return `<span class="owner-task-all-tasks-badges">${badges.join("")}</span>`;
}

function sortTasksByDeadlineClosest(tasks) {
  return [...tasks].sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aCreated - bCreated;
  });
}

const LIST_PIN_HOLD_MS = 550;

function compareListTitles(a, b) {
  return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" });
}

function sortUserLists(lists) {
  const pinned = lists
    .filter((l) => l.pinned)
    .sort((a, b) => {
      const ta = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const tb = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return compareListTitles(a, b);
    });
  const unpinned = lists.filter((l) => !l.pinned).sort(compareListTitles);
  return [...pinned, ...unpinned];
}

async function toggleListPin(listId) {
  const list = state.lists.find((x) => x.id === listId);
  if (!list || isEmployeeAssignmentsList(list)) return;
  const nextPinned = !list.pinned;
  try {
    await api(`/api/lists/${listId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: nextPinned }),
    });
    showToast(
      nextPinned ? `"${list.title}" pinned to top.` : `"${list.title}" unpinned.`,
      "success"
    );
    await loadLists();
    renderListContentOnly();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

async function deleteTaskList(listId) {
  const list = state.lists.find((x) => x.id === listId);
  if (!list || isEmployeeAssignmentsList(list)) return;
  const ok = window.confirm(
    tr("owner.deleteListConfirm", { title: list.title })
  );
  if (!ok) return;
  try {
    await api(`/api/lists/${listId}`, { method: "DELETE" });
    ownerTasksCache.delete(listId);
    const wasActive = state.activeListId === listId;
    await loadLists();
    if (wasActive) {
      const userLists = state.lists.filter((l) => !isEmployeeAssignmentsList(l));
      const empList = state.lists.find((l) => isEmployeeAssignmentsList(l));
      state.activeListId = userLists[0]?.id ?? empList?.id ?? null;
      if (state.activeListId) await loadTasks(state.activeListId);
      else state.tasks = [];
    }
    renderOwnerChrome();
    showToast(tr("owner.listDeleted", { title: list.title }), "success");
  } catch (err) {
    showToast(err.message, "danger");
  }
}

function wireListPinHold(btn) {
  if (btn.dataset.systemPinned === "1" || btn.dataset.wiredListPinHold === "1") return;
  btn.dataset.wiredListPinHold = "1";
  let timer = null;
  let holdFired = false;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".grip-handle, .js-list-delete")) return;
    holdFired = false;
    clearTimer();
    timer = window.setTimeout(() => {
      holdFired = true;
      void toggleListPin(btn.getAttribute("data-list-id"));
    }, LIST_PIN_HOLD_MS);
  });

  btn.addEventListener("pointerup", (e) => {
    clearTimer();
    if (holdFired) {
      e.preventDefault();
      e.stopPropagation();
      holdFired = false;
    }
  });

  btn.addEventListener("pointerleave", clearTimer);
  btn.addEventListener("pointercancel", clearTimer);
}

function ownerListNavButtonHtml(list, { systemPinned = false } = {}) {
  const active = state.ownerView === "dashboard" && list.id === state.activeListId;
  const userPinned = !systemPinned && !!list.pinned;
  const icon = systemPinned ? "assignment_ind" : "folder";
  const grip = systemPinned
    ? active
      ? adminMsIcon("chevron_right", "admin-nav-chevron")
      : ""
    : userPinned
      ? `<span class="list-pin-badge" title="${tr("lists.holdToUnpin")}">${adminMsIcon("push_pin")}</span>`
      : `<span class="list-pin-hint" title="${tr("lists.holdToPin")}">${adminMsIcon("push_pin")}</span>`;
  const holdHint = systemPinned
    ? tr("lists.empAssignmentsHint")
    : userPinned
      ? tr("lists.holdToUnpinTop")
      : tr("lists.listItemHint");
  const deleteBtn = systemPinned
    ? ""
    : `<span class="list-delete-btn js-list-delete" role="button" tabindex="0" title="${tr("lists.deleteList")}" aria-label="${tr("lists.deleteListNamed", { title: escapeHtml(dt(list.title)) })}">${adminMsIcon("delete")}</span>`;
  const titleHtml = systemPinned
    ? `<span class="owner-emp-assign-title" title="${holdHint}">${escapeHtml(tr("nav.employeeAssignments"))}</span>`
    : `<span class="text-truncate list-title-edit" title="${holdHint}">${escapeHtml(dt(list.title))}</span>`;
  const itemClass = systemPinned
    ? "admin-sidebar-nav-item owner-list-item owner-list-item--pinned"
    : `list-group-item list-group-item-action owner-list-item d-flex justify-content-between align-items-center gap-2${userPinned ? " owner-list-item--user-pinned" : ""}`;
  return `
    <button type="button" class="${itemClass} ${active ? "active" : ""}" data-list-id="${list.id}"${systemPinned ? ' data-system-pinned="1"' : ""}${userPinned ? ' data-user-pinned="1"' : ""}>
      <span class="admin-nav-item-left min-w-0">
        ${adminMsIcon(icon)}
        ${titleHtml}
      </span>
      <span class="owner-list-item-actions">
        ${grip}
        ${deleteBtn}
      </span>
    </button>`;
}

function renderListContentOnly() {
  const pinnedLists = state.lists.filter((l) => isEmployeeAssignmentsList(l));
  const userLists = sortUserLists(state.lists.filter((l) => !isEmployeeAssignmentsList(l)));
  const pinnedHtml = pinnedLists.map((l) => ownerListNavButtonHtml(l, { systemPinned: true })).join("");
  const userHtml = userLists.map((l) => ownerListNavButtonHtml(l)).join("");
  const allTasksHtml = ownerAllTasksNavButtonHtml();
  document.querySelectorAll(".js-emp-assign-list-host").forEach((host) => {
    host.innerHTML =
      pinnedHtml ||
      `<div class="list-group-item small text-muted border-0 py-2 px-3">Loading…</div>`;
  });
  document.querySelectorAll(".js-list-host").forEach((host) => {
    host.innerHTML = userHtml;
  });
  document.querySelectorAll(".js-all-tasks-host").forEach((host) => {
    host.innerHTML = allTasksHtml;
  });
  updateOwnerSidebarActiveState();
  bindListNavHandlers();
  wireOwnerReportsNav();
  wireOwnerAttendanceNav();
  wireOwnerDeadlineExtensionsNav();
}

function renderListGroup() {
  renderListContentOnly();
  destroyListSortable();
}

function destroyListSortable() {
  listSortables.forEach((s) => s.destroy());
  listSortables = [];
}

function initListSortable() {
  destroyListSortable();
}

function destroyTaskSortables() {
  if (taskRootSortable) {
    taskRootSortable.destroy();
    taskRootSortable = null;
  }
  taskSortableListId = null;
}

function initIncompleteSortables(listId) {
  if (taskSortableListId === listId && taskRootSortable) return;
  destroyTaskSortables();
  const table = document.getElementById("owner-task-table-sort");
  if (!table || !table.querySelector("tbody.owner-task-group")) return;

  taskSortableListId = listId;
  taskRootSortable = Sortable.create(table, {
    handle: ".task-grip",
    animation: 150,
    draggable: "tbody.owner-task-group",
    onEnd: async () => {
      const orderedIds = [...table.querySelectorAll("tbody.owner-task-group")].map((el) => el.getAttribute("data-task-id"));
      try {
        await api("/api/tasks/reorder/bulk", {
          method: "PATCH",
          body: JSON.stringify({ listId, orderedIds }),
        });
        await loadTasks(listId);
        renderOwnerMain();
      } catch (err) {
        showToast(err.message, "danger");
      }
    },
  });
}

function openTaskModal(task) {
  const modalEl = document.getElementById("taskModal");
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modalEl.dataset.mode = "edit";
  document.getElementById("modal-task-id").value = task.id;
  document.getElementById("modal-title").value = task.title;
  document.getElementById("modal-notes").value = task.notes || "";
  const highPriEl = document.getElementById("modal-high-priority");
  if (highPriEl) highPriEl.checked = !!task.highPriority;
  pendingCustomRecurrence =
    task.recurrence === "custom" && task.recurrenceRule && typeof task.recurrenceRule === "object"
      ? { ...task.recurrenceRule }
      : null;
  fillModalDueFields(task);
  fillModalDurationFields(task);
  fillModalReminderFields(task);
  syncModalCustomRepeatUi();
  document.getElementById("modal-schedule-wrap").classList.remove("d-none");
  document.getElementById("modal-list-wrap").classList.remove("d-none");
  document.getElementById("modal-assignee-wrap").classList.remove("d-none");
  document.getElementById("modal-move-list").disabled = false;
  document.getElementById("modal-delete").classList.remove("d-none");

  fillModalAssigneeCheckboxes((task.assignees ?? []).map((a) => a.id));
  populateTaskModalListOptions(task.listId);
  setModalExistingAssignmentAttachments(task);

  modal.show();
  updateModalSaveEnabled();
}

function wireTaskModal() {
  const modalEl = document.getElementById("taskModal");
  wireModalAssigneePicker();
  if (modalEl?.dataset.assignmentAttachWired !== "1") {
    modalEl.dataset.assignmentAttachWired = "1";
    wireModalAssignmentAttachments();
    modalEl.addEventListener("hidden.bs.modal", () => {
      stopTaskModalVoiceRecording(false);
    });
  }
  const saveHandler = async () => {
    const id = (document.getElementById("modal-task-id").value || "").trim();
    const listId = document.getElementById("modal-move-list").value;
    const title = document.getElementById("modal-title").value?.trim();
    if (!title) {
      showToast(tr("toast.enterTaskTitle"), "warning");
      return;
    }
    if (!listId) {
      showToast(tr("toast.selectList"), "warning");
      return;
    }
    const rec = document.getElementById("modal-repeat").value;
    let recurrenceRule = null;
    if (rec === "custom") {
      if (!pendingCustomRecurrence) {
        showToast(tr("toast.openCustomRecurrence"));
        return;
      }
      if (pendingCustomRecurrence.endType === "on" && !pendingCustomRecurrence.endOn) {
        showToast(tr("toast.customRepeatEndDate"), "warning");
        return;
      }
      const dueDate = document.getElementById("modal-due")?.value || "";
      recurrenceRule = {
        ...pendingCustomRecurrence,
        ...(dueDate ? { startDate: dueDate } : {}),
      };
      pendingCustomRecurrence = recurrenceRule;
    }
    const dueAt = buildDueAtFromModal();
    const body = {
      title,
      notes: document.getElementById("modal-notes").value,
      dueAt,
      dueTimeZone: dueAt ? getBrowserDueTimeZone() : null,
      allDay: document.getElementById("modal-all-day").checked,
      recurrence: rec,
      recurrenceRule,
      assigneeIds: getSelectedAssigneeIdsFromModal(),
      highPriority: document.getElementById("modal-high-priority")?.checked ?? false,
      durationMinutes: parseDurationMinutesFromModal(),
      reminderBeforeMinutes: dueAt ? parseReminderBeforeMinutesFromModal() : null,
    };
    try {
      let taskId = id;
      if (!id) {
        const created = await api(`/api/tasks/lists/${listId}`, { method: "POST", body: JSON.stringify(body) });
        taskId = created?.task?.id ?? "";
        state.activeListId = listId;
      } else {
        await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
        const task = findTaskById(id);
        if (task && listId && listId !== task.listId) {
          await api(`/api/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ listId }) });
          state.activeListId = listId;
          await loadLists();
        }
      }
      if (
        taskId &&
        (modalPendingAssignmentAttachments.length > 0 || modalRemovedAssignmentAttachmentIds.length > 0)
      ) {
        await uploadModalAssignmentAttachments(taskId);
      }
      await loadTasks(state.activeListId);
      bootstrap.Modal.getInstance(modalEl).hide();
      resetModalAssignmentAttachments();
      renderOwnerChrome();
      showToast(id ? tr("toast.taskSaved") : tr("toast.taskCreated"), "success");
    } catch (err) {
      showToast(err.message, "danger");
    }
  };

  document.getElementById("modal-save").replaceWith(document.getElementById("modal-save").cloneNode(true));
  document.getElementById("modal-save").addEventListener("click", saveHandler);

  document.getElementById("modal-delete").replaceWith(document.getElementById("modal-delete").cloneNode(true));
  document.getElementById("modal-delete").addEventListener("click", async () => {
    const id = document.getElementById("modal-task-id").value;
    if (!window.confirm(tr("owner.deleteTaskConfirm", { title: "" }).replace("\n\n", ""))) return;
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      bootstrap.Modal.getInstance(modalEl).hide();
      resetModalAssignmentAttachments();
      await loadTasks(state.activeListId);
      renderOwnerChrome();
    } catch (err) {
      showToast(err.message, "danger");
    }
  });

  document.getElementById("modal-title").addEventListener("input", updateModalSaveEnabled);
  document.getElementById("modal-due")?.addEventListener("change", () => {
    refreshModalRepeatLabels();
    syncModalReminderRowVisibility();
  });
  document.getElementById("modal-all-day").addEventListener("change", () => {
    toggleModalTimeRow();
    refreshModalRepeatLabels();
  });
  const repeatEl = document.getElementById("modal-repeat");
  repeatEl.replaceWith(repeatEl.cloneNode(true));
  document.getElementById("modal-repeat").addEventListener("change", (e) => {
    if (e.target.value === "custom") {
      openCustomRecurrenceEditor();
    } else {
      pendingCustomRecurrence = null;
      syncModalCustomRepeatUi();
    }
    refreshModalRepeatLabels();
    scheduleAssigneeBudgetRefresh();
  });
  document.getElementById("modal-custom-repeat-edit")?.addEventListener("click", () => {
    openCustomRecurrenceEditor();
  });
  document.getElementById("modal-due-time")?.addEventListener("change", syncModalCustomRepeatUi);

  updateModalSaveEnabled();
}

function ownerTaskGroupTbody(task) {
  const rowList = isAllTasksList(state.activeListId)
    ? state.lists.find((l) => l.id === task.ownerAllTasksListId)
    : state.lists.find((l) => l.id === state.activeListId);
  const isEmpAssignList = isEmployeeAssignmentsList(rowList);
  const assignees = task.assignees ?? [];
  const nAssigned = assignees.length;
  const nDone = assignees.filter((a) => assigneeShowsSubmittedForOwner(a)).length;
  const detailId = `owner-task-detail-${task.id}`;

  const deadlineCell = `${formatOwnerTaskDeadlineMock(task)}${taskDurationMetaHtml(task.durationMinutes)}`;
  const recurrenceCell = ownerRecurrenceCellHtml(task);

  const descriptionFull = (task.notes || "").trim();
  const descriptionPanel = descriptionFull
    ? `<p class="admin-expand-desc-text">${escapeHtml(dt(descriptionFull))}</p>`
    : `<p class="admin-expand-desc-text admin-expand-desc-text--empty">${tr("common.noDescriptionDot")}</p>`;

  const assigneeCards =
    assignees.length === 0
      ? `<p class="admin-expand-empty admin-expand-empty--warn">${tr("owner.noAssigneesYet")}</p>`
      : assignees.map((a) => ownerMockAssigneeCardHtml(task, a, { isEmpAssignList })).join("");

  const hasUnreadUpdates = assignees.some((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
  const awaitingOwnerReview = taskIsSubmittedAwaitingOwner(task);
  const showExpandAttention = hasUnreadUpdates || awaitingOwnerReview;
  const expandUnreadClass = showExpandAttention ? " owner-task-expand-btn--unread" : "";

  const assigneeMarkDoneControl = `<button type="button" class="admin-expand-mark-done owner-mark-done-open" data-task-id="${task.id}" aria-haspopup="dialog" aria-controls="ownerMarkDoneModal">${tr("owner.markAssigneesDone")}</button>`;
  const markReviewedBtn = awaitingOwnerReview
    ? `<button type="button" class="admin-expand-mark-reviewed" data-mark-reviewed-id="${task.id}">${tr("owner.markReviewed")}</button>`
    : "";

  const progressBadge =
    nAssigned === 0
      ? `<span class="admin-expand-team-pill admin-expand-team-pill--unassigned">${tr("common.unassigned")}</span>`
      : `<span class="admin-expand-team-pill tabular-nums">${nDone} / ${nAssigned}</span>`;

  const groupDone = task.completed ? "owner-task-group--completed" : "";
  const priorityClass = ownerTaskRowPriorityClass(task);
  const overdueClass = task.completed ? "" : taskOverdueTierClass(task.dueAt);

  return `<tbody class="owner-task-group ${groupDone}${task.highPriority ? " owner-task-group--high-priority" : ""}" data-task-id="${task.id}">
    <tr class="task-sort-row owner-task-row${priorityClass}${overdueClass} ${task.completed ? "owner-task-row--completed" : ""}" data-task-id="${task.id}">
      <td class="owner-task-cell owner-task-cell--icon text-center align-middle">
        ${adminMsIcon("assignment", "admin-task-type-icon")}
        <span class="task-grip grip-handle" title="${tr("common.dragToReorder")}">${adminMsIcon("drag_indicator")}</span>
      </td>
      <td class="owner-task-cell owner-task-col--task align-middle">
        <div class="owner-task-title-wrap">
          <button type="button" class="btn btn-link text-start text-decoration-none p-0 owner-task-open-details" data-open-id="${
          task.id
        }" aria-label="${tr("common.openTaskDetails")}">${escapeHtml(dt(task.title))}</button>
          ${ownerTaskListBadgeHtml(task)}
          ${taskCreatedMetaHtml(task.createdAt)}
          ${taskAssignmentAttachmentsBadgeHtml(task)}
        </div>
      </td>
      <td class="owner-task-cell owner-task-col--deadline align-middle text-nowrap tabular-nums">${deadlineCell}</td>
      <td class="owner-task-cell owner-task-col--recurrence align-middle">${recurrenceCell}</td>
      <td class="owner-task-cell owner-task-col--trail align-middle text-end">
        <button
          type="button"
          class="btn btn-sm owner-task-expand-btn${expandUnreadClass}"
          data-bs-toggle="collapse"
          data-bs-target="#${detailId}"
          aria-expanded="false"
          aria-controls="${detailId}"
          aria-label="${
            awaitingOwnerReview
              ? tr("owner.taskDetailsAwaitingReview")
              : hasUnreadUpdates
                ? tr("common.taskDetailsUnread")
                : tr("common.taskDetails")
          }"
        >
          ${showExpandAttention ? `<span class="owner-task-expand-unread-dot" aria-hidden="true"></span>` : ""}
          <span class="admin-task-expand-icon">${adminMsIcon("expand_more")}</span>
        </button>
      </td>
    </tr>
    <tr class="owner-task-detail-row admin-task-detail-row">
      <td colspan="5" class="p-0">
        <div class="collapse owner-task-detail-collapse admin-task-detail-collapse" id="${detailId}">
          <div class="admin-task-expand-panel">
            <div class="admin-expand-section admin-expand-section--desc">
              <h4 class="admin-expand-section-label">${tr("common.description")}</h4>
              ${task.durationMinutes ? `<p class="small text-muted mb-2"><strong>${tr("common.durationLabel")}:</strong> ${escapeHtml(formatTaskDuration(task.durationMinutes))}</p>` : ""}
              ${descriptionPanel}
              ${(task.assignmentAttachments ?? []).length ? `<div class="admin-expand-attachments-row">${taskAssignmentAttachmentsBadgeHtml(task)}</div>` : ""}
            </div>
            <div class="admin-expand-section">
              <div class="admin-expand-section-head">
                <h4 class="admin-expand-section-label mb-0">${tr("owner.teamProgress")}</h4>
                ${progressBadge}
              </div>
              <div class="admin-expand-cards">${assigneeCards}</div>
              ${isEmpAssignList ? "" : ownerDelegationHistoryHtml(task)}
            </div>
            <div class="admin-expand-actions">
              ${assigneeMarkDoneControl}
              <div class="admin-expand-icon-actions">
                ${markReviewedBtn}
                <button type="button" class="admin-expand-icon-btn" data-open-id="${task.id}" title="${tr("common.editTask")}" aria-label="${tr("common.editTask")}">${adminMsIcon("edit")}</button>
                <button type="button" class="admin-expand-icon-btn admin-expand-icon-btn--danger" data-delete-id="${task.id}" title="${tr("common.deleteTask")}" aria-label="${tr("common.deleteTask")}">${adminMsIcon("delete")}</button>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  </tbody>`;
}

function findTaskById(id) {
  return state.tasks.find((t) => t.id === id) ?? null;
}

function renderOwnerMain() {
  const main = document.getElementById("main-column");
  if (!main) return;
  if (state.ownerView !== "attendance") {
    destroyAdminAttendance();
  }
  if (state.ownerView !== "deadline-extensions") {
    destroyAdminDeadlineExtensions();
  }
  if (state.ownerView === "owner-dashboard") {
    if (!state.user?.isOwner) {
      state.ownerView = "dashboard";
      updateOwnerSidebarActiveState();
    } else {
      destroyTaskSortables();
      openOwnerDashboardView();
      return;
    }
  }
  if (state.ownerView === "reports") {
    destroyTaskSortables();
    openOwnerReportsView();
    return;
  }
  if (state.ownerView === "settings") {
    destroyTaskSortables();
    openOwnerSettingsView();
    return;
  }
  if (state.ownerView === "company-profile") {
    if (!state.user?.isOwner) {
      state.ownerView = "dashboard";
      updateOwnerSidebarActiveState();
    } else {
      destroyTaskSortables();
      openOwnerCompanyProfileView();
      return;
    }
  }
  if (state.ownerView === "manage-employees") {
    destroyTaskSortables();
    openOwnerManageEmployeesView();
    return;
  }
  if (state.ownerView === "manage-locations") {
    destroyTaskSortables();
    openOwnerManageLocationsView();
    return;
  }
  if (state.ownerView === "attendance") {
    if (!ownerAttendanceNavVisible()) {
      state.ownerView = "dashboard";
      updateOwnerSidebarActiveState();
    } else {
      destroyTaskSortables();
      openOwnerAttendanceView();
      return;
    }
  }
  if (state.ownerView === "deadline-extensions") {
    destroyTaskSortables();
    openOwnerDeadlineExtensionsView();
    return;
  }
  const allTasksView = isAllTasksList(state.activeListId);
  const list = allTasksView
    ? { id: OWNER_ALL_TASKS_LIST_ID, title: tr("nav.allTasks") }
    : state.lists.find((l) => l.id === state.activeListId);
  const listId = state.activeListId;
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  const dashSubtitle = allTasksView
    ? tr("owner.allTasksSubtitle")
    : tr("common.welcome", { name: adminWelcomeName });

  const filteredTasks = ownerFilteredTasks();
  const showOverdueLegend = shouldShowTaskOverdueColorLegend({
    ownerFilter: state.ownerTaskFilter,
    allTasksView,
  });
  let visibleTasks = sortOwnerTasksForDisplay(filteredTasks);
  if (allTasksView && state.allTasksListFilter !== "all") {
    visibleTasks = filterTasksByAllTasksList(visibleTasks, state.allTasksListFilter);
  }
  if (allTasksView && state.allTasksEmployeeFilter !== "all") {
    visibleTasks = filterTasksByAllTasksEmployee(visibleTasks, state.allTasksEmployeeFilter);
  }
  if (allTasksView && state.allTasksDeadlineFilter !== "all") {
    visibleTasks = filterTasksByAllTasksDeadline(visibleTasks, state.allTasksDeadlineFilter);
  }
  if (showOverdueLegend) {
    visibleTasks = filterTasksByOverdueColor(visibleTasks, state.overdueColorFilter, ownerTaskOverdueTier);
  }
  const allTasksFiltersActive =
    allTasksView &&
    (state.allTasksListFilter !== "all" ||
      state.allTasksEmployeeFilter !== "all" ||
      state.overdueColorFilter !== "all" ||
      state.allTasksDeadlineFilter !== "all");

  const tbodyInner = visibleTasks.map((task) => ownerTaskGroupTbody(task)).join("");

  const isEmpAssignList = allTasksView ? false : isEmployeeAssignmentsList(list);
  const useEmpAssignColumns = isEmpAssignList;

  const metrics = ownerDashboardMetrics();
  const activeKpiClass = state.ownerTaskFilter === "active" ? " admin-kpi-card--active" : "";
  const inProgressKpiClass = state.ownerTaskFilter === "in_progress" ? " admin-kpi-card--active" : "";
  const submittedKpiClass = state.ownerTaskFilter === "submitted" ? " admin-kpi-card--active" : "";
  const completedKpiClass = state.ownerTaskFilter === "completed" ? " admin-kpi-card--active" : "";
  const kpiTotal = Math.max(metrics.total, 1);
  const kpiRow = list
    ? `<div class="admin-kpi-grid">
          ${ownerKpiCardHtml("active", tr("owner.kpiActive"), "bolt", metrics.active, kpiTotal, activeKpiClass)}
          ${ownerKpiCardHtml("in_progress", tr("owner.kpiInProgress"), "pending", metrics.inProgress, kpiTotal, inProgressKpiClass)}
          ${ownerKpiCardHtml("submitted", tr("owner.kpiSubmitted"), "upload_file", metrics.submitted, kpiTotal, submittedKpiClass)}
          ${ownerKpiCardHtml("completed", tr("owner.kpiReviewed"), "fact_check", metrics.done, kpiTotal, completedKpiClass)}
        </div>`
    : "";

  const emptyMessage = !list
    ? `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-folder2-open owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">${tr("empty.selectList")}</p>
        <p class="owner-empty-desc text-muted small mb-0">${tr("empty.selectListDesc")}</p>
      </div>`
    : metrics.total === 0
      ? isEmployeeAssignmentsList(list)
        ? `<div class="owner-empty-state py-5 px-3">
            <i class="bi bi-person-lines-fill owner-empty-icon text-info" aria-hidden="true"></i>
            <p class="owner-empty-title mb-1">${tr("empty.noEmployeeAssignments")}</p>
            <p class="owner-empty-desc text-muted small mb-0">When employees use <strong>Create & assign task</strong> or assign a task to a colleague, it appears here. Click <strong>Refresh</strong> or re-open this list if you expect tasks to show.</p>
          </div>`
        : allTasksView
          ? `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-calendar-event owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">${tr("empty.noAllTasks")}</p>
        <p class="owner-empty-desc text-muted small mb-0">${tr("empty.noAllTasksDesc")}</p>
          </div>`
        : `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-clipboard2-plus owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">${tr("empty.noTasks")}</p>
        <p class="owner-empty-desc text-muted small mb-0">Click <strong>Create Task</strong> in the sidebar to add the first task.</p>
          </div>`
      : state.ownerTaskFilter === "completed"
        ? `<div class="owner-empty-state py-5 px-3">
            <i class="bi bi-check2-square owner-empty-icon text-success" aria-hidden="true"></i>
            <p class="owner-empty-title mb-1">${tr("empty.noReviewed")}</p>
            <p class="owner-empty-desc text-muted small mb-0">${tr("empty.noReviewedDesc")}</p>
          </div>`
        : state.ownerTaskFilter === "submitted"
          ? `<div class="owner-empty-state py-5 px-3">
              <i class="bi bi-upload owner-empty-icon text-primary" aria-hidden="true"></i>
              <p class="owner-empty-title mb-1">${tr("empty.noSubmitted")}</p>
              <p class="owner-empty-desc text-muted small mb-0">${tr("empty.noSubmittedDesc")}</p>
            </div>`
          : state.ownerTaskFilter === "in_progress"
            ? `<div class="owner-empty-state py-5 px-3">
              <i class="bi bi-hourglass-split owner-empty-icon text-warning" aria-hidden="true"></i>
              <p class="owner-empty-title mb-1">${tr("empty.nothingInProgress")}</p>
              <p class="owner-empty-desc text-muted small mb-0">${tr("empty.nothingInProgressDesc")}</p>
            </div>`
            : `<div class="owner-empty-state py-5 px-3">
              <i class="bi bi-check2-all owner-empty-icon text-success" aria-hidden="true"></i>
              <p class="owner-empty-title mb-1">${tr("empty.noActiveTasks")}</p>
              <p class="owner-empty-desc text-muted small mb-0">${tr("empty.noActiveTasksDesc")}</p>
      </div>`;

  const tableBlock =
    !list
      ? emptyMessage
      : ownerMainLoading && list
        ? `<div class="owner-dashboard-loading py-5 text-center text-muted">
          ${adminMsIcon("hourglass_top")}
          <p class="mb-0 mt-2">${tr("common.loading")}</p>
        </div>`
      : filteredTasks.length > 0 && visibleTasks.length === 0 && allTasksFiltersActive
        ? allTasksFiltersEmptyMessageHtml()
      : filteredTasks.length > 0 && visibleTasks.length === 0 && showOverdueLegend && state.overdueColorFilter !== "all"
        ? overdueFilterEmptyMessageHtml()
        : visibleTasks.length === 0
          ? emptyMessage
          : `<div class="table-responsive owner-task-table-wrap">
          <table class="table table-hover align-middle mb-0 owner-task-table admin-task-table${useEmpAssignColumns ? " owner-task-table--emp-assign" : ""}" id="owner-task-table-sort">
            <thead>
              <tr>
                <th scope="col" class="owner-task-cell owner-task-cell--icon"><span class="visually-hidden">${tr("common.type")}</span></th>
                <th scope="col" class="owner-task-head owner-task-col--task">${tr("owner.tableTaskTitle")}</th>
                <th scope="col" class="owner-task-head owner-task-col--deadline text-nowrap">${tr("owner.tableDeadline")}</th>
                <th scope="col" class="owner-task-head owner-task-col--recurrence text-nowrap">${tr("owner.tableRecurrence")}</th>
                <th scope="col" class="owner-task-head owner-task-col--trail text-end">${tr("owner.tableActions")}</th>
              </tr>
            </thead>
            ${tbodyInner}
          </table>
        </div>`;

  main.innerHTML = `
    <div class="admin-main-scroll d-flex flex-column">
    <header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("owner.dashboardTitle")}</h1>
        <p class="admin-dash-subtitle">${escapeHtml(dashSubtitle)}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        <button type="button" class="admin-icon-btn js-owner-refresh-tasks" aria-label="${tr("owner.refreshTasks")}" ${!list ? "disabled" : ""}>
          ${adminMsIcon("refresh")}
        </button>
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>
    ${kpiRow}
    <section class="owner-task-panel" aria-label="${tr("owner.tasksPanel")}">
      ${showOverdueLegend ? (allTasksView ? allTasksFilterBarHtml() : taskOverdueColorLegendHtml()) : ""}
      ${tableBlock}
    </section>
    </div>
  `;

  wireAdminNotifications(state.user?.id, main, state.user);
  ensureAdminHeaderProfileMenuDocListener();
  wireAdminHeaderProfileMenu(main);
  wireOwnerDashboardOpen(main);

  main.querySelectorAll(".js-owner-refresh-tasks").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!listId) return;
      btn.disabled = true;
      try {
        await loadTasks(listId);
        renderOwnerMain();
        showToast(tr("toast.tasksRefreshed"), "success");
      } catch (err) {
        showToast(err.message, "danger");
      } finally {
        btn.disabled = false;
      }
    });
  });

  main.querySelectorAll("[data-owner-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-owner-filter");
      if (filter) setOwnerTaskFilter(filter);
    });
  });

  bindOwnerDescriptionPopups(main);
  wireOverdueColorFilter(main);
  wireAllTasksListFilter(main);
  wireAllTasksEmployeeFilter(main);
  wireAllTasksDeadlineFilter(main);
  bindAssignmentAttachmentViewers(main, (taskId) => findTaskById(taskId));

  main.querySelectorAll(".owner-mark-done-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      if (id) openOwnerMarkDoneModal(id);
    });
  });

  main.querySelectorAll("[data-mark-reviewed-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-mark-reviewed-id");
      if (id) void markTaskReviewedByOwner(id);
    });
  });

  main.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open-id");
      const t = findTaskById(id);
      if (t) openTaskModal(t);
    });
  });

  main.querySelectorAll(".owner-view-submission-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-view-submission-task-id");
      const userId = btn.getAttribute("data-view-submission-user-id");
      const archived = btn.getAttribute("data-view-submission-archived") === "1";
      if (!taskId || !userId) return;
      void openSubmissionDetailForAssignee(taskId, userId, { archived }).catch((err) => {
        showToast(err.message || tr("toast.couldNotLoadSubmission"), "danger");
      });
    });
  });

  main.querySelectorAll(".owner-reassign-assignee-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-reassign-task-id");
      const userId = btn.getAttribute("data-reassign-user-id");
      const name = btn.getAttribute("data-reassign-user-name") || "";
      if (!taskId || !userId) return;
      void reopenAssigneeForTask(taskId, userId, name);
    });
  });

  main.querySelectorAll(".owner-view-progress-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-view-progress-task-id");
      const userId = btn.getAttribute("data-view-progress-user-id");
      const userName = btn.getAttribute("data-view-progress-user-name") || "";
      if (!taskId || !userId) return;
      void openProgressUpdatesForAssignee(taskId, userId, userName).catch((err) => {
        showToast(err.message || tr("toast.couldNotLoadUpdates"), "danger");
      });
    });
  });

  main.querySelectorAll(".owner-view-all-activity").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-task-id");
      if (!taskId) return;
      void openProgressUpdatesAll(taskId).catch((err) => {
        showToast(err.message || tr("toast.couldNotLoadActivity"), "danger");
      });
    });
  });

  main.querySelectorAll(".owner-task-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-expanded") === "true") return;
      const target = btn.getAttribute("data-bs-target") || "";
      const match = /^#owner-task-detail-(.+)$/.exec(target);
      if (!match) return;
      const taskId = match[1];
      const task = findTaskById(taskId);
      if (!task?.assignees?.some((a) => (a.unreadProgressUpdateCount ?? 0) > 0)) return;
      const ui = captureOwnerUiState();
      if (!ui.expandedTaskIds.includes(taskId)) ui.expandedTaskIds.push(taskId);
      void (async () => {
        try {
          await markTaskProgressUpdatesRead(taskId);
          if (state.activeListId) {
            await loadTasks(state.activeListId);
            renderOwnerMain();
            restoreOwnerUiState(ui);
          }
        } catch {
          /* ignore */
        }
      })();
    });
  });

  main.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-id");
      const t = findTaskById(id);
      if (!t || !listId) return;
      if (!window.confirm(tr("owner.deleteTaskConfirm", { title: t.title }))) return;
      try {
        await api(`/api/tasks/${id}`, { method: "DELETE" });
        await loadTasks(listId);
        renderOwnerMain();
      } catch (err) {
        showToast(err.message, "danger");
      }
    });
  });

  if (state.ownerTaskFilter === "active" && visibleTasks.length > 0 && !allTasksView) {
  initIncompleteSortables(listId);
  } else {
    destroyTaskSortables();
  }

  wireAdminTaskExpandPanel(main);
  wireLanguageSelector(main);
}

function ownerReportsChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("owner.reportsTitle")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function ownerDashboardChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("owner.ownerDashboardTitle")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function toggleAdminTheme() {
  const cur = document.documentElement.getAttribute("data-bs-theme") || "light";
  setThemePreference(cur === "dark" ? "light" : "dark");
  syncAdminThemeToggleIcons();
  if (state.ownerView === "reports") void refreshAdminReports({ force: true });
  else if (state.ownerView === "owner-dashboard") void refreshOwnerDashboard({ force: true });
  onReportsThemeChange();
  onSettingsThemeChange();
}

function ownerCompanyProfileChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("profile.myCompanyDetails")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function ownerManageEmployeesChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("owner.manageEmployees")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function ownerManageLocationsChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("attendance.manageLocations")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function ownerSettingsChromeHeaderHtml() {
  const adminWelcomeName = state.user?.displayName
    ? escapeHtml(dt(state.user.displayName))
    : tr("common.admin");
  return `<header class="admin-dash-header">
      ${adminMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("settings.title")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: adminWelcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${ownerTrialTopBannerHtml()}
        ${adminNotificationsBellHtml(state.user?.id, state.user)}
        ${ownerAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function employeeSettingsChromeHeaderHtml() {
  const welcomeName = state.user?.displayName ? escapeHtml(dt(state.user.displayName)) : tr("common.employee");
  return `<header class="admin-dash-header">
      ${empMobileNavToggleHtml()}
      <div class="admin-dash-heading">
        <h1 class="admin-dash-title">${tr("settings.title")}</h1>
        <p class="admin-dash-subtitle">${tr("common.welcome", { name: welcomeName })}</p>
      </div>
      <div class="admin-dash-utilities">
        ${languageSelectorHtml({ compact: true })}
        ${employeeAdminHeaderProfileHtml()}
      </div>
    </header>`;
}

function ownerReportsChromeHeaderDynamic() {
  if (state.ownerView === "owner-dashboard") return ownerDashboardChromeHeaderHtml();
  if (state.ownerView === "settings") return ownerSettingsChromeHeaderHtml();
  if (state.ownerView === "company-profile") return ownerCompanyProfileChromeHeaderHtml();
  if (state.ownerView === "manage-employees") return ownerManageEmployeesChromeHeaderHtml();
  if (state.ownerView === "manage-locations") return ownerManageLocationsChromeHeaderHtml();
  if (state.ownerView === "attendance") return ownerAttendanceChromeHeaderHtml();
  if (state.ownerView === "deadline-extensions") return ownerDeadlineExtensionsChromeHeaderHtml();
  return ownerReportsChromeHeaderHtml();
}

function wireEmployeeSettingsChromeHeader(main) {
  ensureAdminHeaderProfileMenuDocListener();
  wireAdminHeaderProfileMenu(main);
  wireLanguageSelector(main);
  wireEmpEnablePush(main);
}

function wireOwnerReportsChromeHeader(main) {
  wireAdminNotifications(state.user?.id, main, state.user);
  ensureAdminHeaderProfileMenuDocListener();
  wireAdminHeaderProfileMenu(main);
  wireLanguageSelector(main);
  wireOwnerDashboardOpen(main);
}

function wireOwnerDashboardOpen(root = document) {
  root.querySelectorAll(".js-owner-dashboard-open").forEach((btn) => {
    if (btn.dataset.ownerDashWired === "1") return;
    btn.dataset.ownerDashWired = "1";
    btn.addEventListener("click", () => {
      if (!state.user?.isOwner) {
        showToast(tr("owner.ownerDashboardOwnersOnly"), "warning");
        return;
      }
      navigateOwnerView("owner-dashboard");
    });
  });
}

function wireOwnerDeadlineExtensionsNav() {
  document.querySelectorAll(".js-owner-deadline-extensions-nav").forEach((btn) => {
    if (btn.dataset.deadlineExtWired === "1") return;
    btn.dataset.deadlineExtWired = "1";
    btn.addEventListener("click", () => {
      navigateOwnerView("deadline-extensions");
    });
  });
}

function wireOwnerAttendanceNav() {
  document.querySelectorAll(".js-owner-attendance-nav").forEach((btn) => {
    if (btn.dataset.attendanceWired === "1") return;
    btn.dataset.attendanceWired = "1";
    btn.addEventListener("click", () => {
      navigateOwnerView("attendance");
    });
  });
}

function wireOwnerReportsNav() {
  document.querySelectorAll(".js-owner-reports-nav").forEach((btn) => {
    if (btn.dataset.reportsWired === "1") return;
    btn.dataset.reportsWired = "1";
    btn.addEventListener("click", () => {
      navigateOwnerView("reports");
    });
  });
}

function wireChromeNav() {
  document.querySelectorAll(".js-logout").forEach((b) => b.addEventListener("click", logout));
  document.getElementById("leftNavOffcanvas")?.addEventListener("click", (e) => {
    const actionable = e.target.closest(
      "[data-list-id], .js-owner-create-task, .admin-sidebar-nav-item, .team-chat-sidebar-nav-item, .js-owner-reports-nav, .js-owner-attendance-nav, .js-owner-deadline-extensions-nav"
    );
    if (!actionable || e.target.closest(".grip-handle, .js-new-list, .js-list-delete")) return;
    dismissAdminMobileNav();
  });
  document.querySelectorAll(".js-new-list").forEach((b) =>
    b.addEventListener("click", async () => {
      const title = await openListNameModal({
        heading: tr("modals.newList"),
        fieldLabel: tr("modals.listName"),
        initialValue: "",
      });
      if (title == null || !title.trim()) return;
      try {
        await api("/api/lists", { method: "POST", body: JSON.stringify({ title: title.trim() }) });
        await loadLists();
        state.activeListId = state.lists[state.lists.length - 1]?.id || state.activeListId;
        await loadTasks(state.activeListId);
        renderOwnerChrome();
      } catch (err) {
        showToast(err.message, "danger");
      }
    })
  );
  document.querySelectorAll(".js-owner-create-task").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (
        state.ownerView === "reports" ||
        state.ownerView === "owner-dashboard" ||
        state.ownerView === "settings" ||
        state.ownerView === "company-profile" ||
        state.ownerView === "manage-employees" ||
        state.ownerView === "manage-locations" ||
        state.ownerView === "attendance" ||
        state.ownerView === "deadline-extensions"
      ) {
        state.ownerView = "dashboard";
        updateOwnerSidebarActiveState();
      }
      openOwnerCreateTaskModal();
    });
  });
  document.querySelectorAll(".js-admin-theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleAdminTheme();
    });
  });
  wireOwnerReportsNav();
  wireOwnerAttendanceNav();
  wireOwnerDeadlineExtensionsNav();
}

function wireOwnerDashboardAnnouncementListener() {
  if (window.__ownerDashAnnWired) return;
  window.__ownerDashAnnWired = true;
  window.addEventListener("taskmgr:open-owner-dashboard", () => {
    if (state.user?.role !== "owner") return;
    if (!state.user?.isOwner) {
      showToast(tr("owner.ownerDashboardOwnersOnly"), "warning");
      return;
    }
    navigateOwnerView("owner-dashboard");
  });
  window.addEventListener("taskmgr:open-attendance", () => {
    if (state.user?.role !== "owner") return;
    if (!ownerAttendanceNavVisible()) {
      showToast(tr("attendance.attendanceNavOff"), "warning");
      return;
    }
    navigateOwnerView("attendance");
  });
  window.addEventListener("taskmgr:open-deadline-extensions", () => {
    if (state.user?.role !== "owner") return;
    navigateOwnerView("deadline-extensions");
  });
}

function renderOwnerChrome() {
  app.innerHTML = `
    <div class="owner-shell admin-mockup-ui min-h-main">
        <aside class="admin-fixed-sidebar d-none d-lg-flex">
          ${leftNavInner()}
        </aside>
        <div class="offcanvas offcanvas-start admin-mobile-nav" tabindex="-1" id="leftNavOffcanvas" aria-labelledby="leftNavLabel">
          <div class="offcanvas-header admin-mobile-nav-header border-0">
            <h2 class="offcanvas-title h6 mb-0" id="leftNavLabel">${tr("common.menu")}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="offcanvas-body admin-mobile-nav-body pt-0">${leftNavInner()}</div>
        </div>
        <div class="admin-main-host">
          <div id="main-column" class="owner-main-panel owner-main-fill d-flex flex-column w-100"></div>
        </div>
      ${taskModalHtml()}
      ${customRecurrenceModalHtml()}
      ${listNameModalHtml()}
      ${taskDescriptionModalHtml()}
      ${submissionDetailModalHtml()}
      ${progressUpdateModalHtml()}
      ${ownerMarkDoneModalHtml()}
      ${ownerTrialMessageModalHtml()}
      ${teamAdminModalHtml()}
      ${myProfileModalHtml()}
      ${employeeProfileModalHtml()}
      ${manageLocationModalHtml()}
      ${contactUsModalHtml()}
      ${adminNotifOffcanvasHtml(state.user?.id, state.user)}
      ${legalModalHtml()}
      ${teamChatOffcanvasHtml()}
    </div>`;

  wireChromeNav();
  initAdminReports({
    api,
    escapeHtml,
    adminMsIcon,
    reportsChromeHeader: ownerReportsChromeHeaderDynamic,
    wireReportsChromeHeader: wireOwnerReportsChromeHeader,
  });
  initAdminSettings({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerSettingsChromeHeaderHtml,
    employeeChromeHeader: employeeSettingsChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    wireEmployeeChromeHeader: wireEmployeeSettingsChromeHeader,
    onOpenMyProfile: () => {
      void openMyProfileModal();
    },
    onOpenCompanyProfile: () => {
      if (!state.user?.isOwner) {
        showToast(tr("owner.ownerDashboardOwnersOnly"), "warning");
        return;
      }
      navigateOwnerView("company-profile");
    },
    onOpenManageEmployees: () => {
      navigateOwnerView("manage-employees");
    },
    onOpenManageLocations: () => {
      navigateOwnerView("manage-locations");
    },
    onToggleTheme: toggleAdminTheme,
    getUser: () => state.user,
    showToast,
    kalpanikWebsiteUrl: KALPANIK_WEBSITE_URL,
    onCompanyLiveLocationChanged: (enabled) => {
      if (state.user) state.user.liveLocationRequired = enabled;
      if (!enabled && state.ownerView === "attendance") {
        if (state.user?.attendanceEnabled === true) {
          syncOwnerAttendanceTabAfterSettingsChange();
        } else {
          state.ownerView = "dashboard";
          destroyAdminAttendance();
        }
      }
      renderListContentOnly();
      if (state.ownerView === "dashboard") renderOwnerMain();
      else if (state.ownerView === "settings") openOwnerSettingsView();
      else if (state.ownerView === "company-profile") openOwnerCompanyProfileView();
      else if (state.ownerView === "manage-employees") openOwnerManageEmployeesView();
      else if (state.ownerView === "manage-locations") openOwnerManageLocationsView();
      else if (state.ownerView === "attendance") openOwnerAttendanceView();
      else if (state.ownerView === "deadline-extensions") openOwnerDeadlineExtensionsView();
    },
    onCompanyAttendanceChanged: handleCompanyAttendanceChanged,
  });
  initCompanyProfile({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerCompanyProfileChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    showToast,
    onCompanyProfileChanged: (profile) => {
      if (state.user?.isOwner) {
        state.user.companyProfileComplete = profile.companyProfileComplete;
      }
      refreshCompanyProfileSettingsBadge(!profile.companyProfileComplete);
    },
  });
  initManageEmployees({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerManageEmployeesChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    showToast,
  });
  initManageLocations({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerManageLocationsChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    showToast,
    onCompanyAttendanceChanged: handleCompanyAttendanceChanged,
  });
  initAdminAttendance({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerAttendanceChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    getLiveLocationRequired: () => state.user?.liveLocationRequired !== false,
    getDailyAttendanceEnabled: () => state.user?.attendanceEnabled === true,
  });
  initAdminDeadlineExtensions({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerDeadlineExtensionsChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    showToast,
  });
  renderListGroup();
  renderOwnerMain();
  void refreshDeadlineExtensionNavBadge();
  if (!window.__deadlineExtBadgeListener) {
    window.__deadlineExtBadgeListener = true;
    document.addEventListener("taskmgr:deadline-extensions-changed", () => {
      void refreshDeadlineExtensionNavBadge();
    });
  }
  wireAdminNotifications(state.user?.id, document, state.user);
  wireTaskModal();
  wireCustomRecurrenceModal();
  wireListNameModal();
  wireSubmissionDetailModal();
  wireProgressUpdateModal();
  wireOwnerMarkDoneModal();
  wireTeamAdminModal();
  wireMyProfileModal();
  wireEmployeeProfileModal();
  wireManageLocationModal();
  wireContactUsModal();
  wireLegalModal();
  wireThemeIconToggles();
  initTeamChat(chatInitDeps());
  startOwnerAutoSync();
  wireChatNotifyHandlers();
  handleOpenChatDeepLink();
}

/** Optional Play Store link — set VITE_PLAY_STORE_URL at build time when published. */
function kalpanikPlayStoreUrl() {
  const url = (import.meta.env.VITE_PLAY_STORE_URL || "").trim();
  return url;
}

/** APK served from client/public/downloads/ after build — override with VITE_APK_DOWNLOAD_URL. */
function employeeApkDownloadUrl() {
  const custom = (import.meta.env.VITE_APK_DOWNLOAD_URL || "").trim();
  return custom || "/downloads/sugandh-reminder.apk";
}

function empMobileAppButtonsHtml({ block = true, size = "" } = {}) {
  const apkUrl = employeeApkDownloadUrl();
  const playStore = kalpanikPlayStoreUrl();
  const btnClass = `${block ? "w-100 " : ""}btn ${size} btn-outline-success${block ? " mb-2" : ""}`;
  const apkBtn = `<a class="${btnClass}" href="${escapeHtml(apkUrl)}" download="kalpanik-reminder.apk">
        <i class="bi bi-android2 me-1" aria-hidden="true"></i>Download app (APK)
      </a>`;
  const playBtn = playStore
    ? `<a class="${block ? "w-100 " : ""}btn ${size} btn-outline-primary${block ? " mb-2" : ""}" href="${escapeHtml(playStore)}" target="_blank" rel="noopener noreferrer">
        <i class="bi bi-google-play me-1" aria-hidden="true"></i>Get on Play Store
      </a>`
    : "";
  return `${apkBtn}${playBtn}`;
}

function employeeMyAssignee(task) {
  const uid = state.user?.id;
  if (!uid) return null;
  return (task.assignees ?? []).find((a) => a.id === uid) ?? null;
}

/** Submitted tab: this occurrence is done (each recurring day is its own task card). */
function employeeAssigneeShowsAsSubmitted(task, assigneeRow = employeeMyAssignee(task)) {
  if (!assigneeRow) return false;
  if (assigneeRow.assigneeDone) return true;
  // Legacy: same task id was rolled in-place before spawn-per-occurrence.
  const recurrence = task.recurrence ?? "none";
  return recurrence !== "none" && !!assigneeRow.lastSubmittedAt && !employeeHasCurrentSubmission(assigneeRow);
}

function formatEmpDue(iso) {
  if (!iso) return "—";
  const formatted = formatDateTime24(iso);
  return formatted || "—";
}

function taskOverdueDayCount(dueAt) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const now = Date.now();
  if (now <= due.getTime()) return 0;
  return Math.max(1, Math.ceil((now - due.getTime()) / 86_400_000));
}

function taskOverdueTierClass(dueAt) {
  const days = taskOverdueDayCount(dueAt);
  if (days <= 0) return "";
  if (days <= 2) return " owner-task-row--overdue-1-2";
  if (days <= 5) return " owner-task-row--overdue-3-5";
  return " owner-task-row--overdue-6plus";
}

function taskOverdueTierFromDueAt(dueAt) {
  const days = taskOverdueDayCount(dueAt);
  if (days <= 0) return "";
  if (days <= 2) return "1-2";
  if (days <= 5) return "3-5";
  return "6plus";
}

function ownerTaskOverdueTier(task) {
  if (task?.completed || !task?.dueAt) return "";
  return taskOverdueTierFromDueAt(task.dueAt);
}

function empTaskOverdueTier(task) {
  if (!task?.dueAt) return "";
  const me = employeeMyAssignee(task);
  if (!me || employeeAssigneeShowsAsSubmitted(task, me)) return "";
  if (empTaskRowDisplayMode(task, me) !== "active") return "";
  return taskOverdueTierFromDueAt(task.dueAt);
}

function filterTasksByOverdueColor(tasks, filter, getTier) {
  if (!filter || filter === "all") return tasks;
  return tasks.filter((task) => getTier(task) === filter);
}

function allTasksListFilterOptions() {
  const listIds = new Set();
  for (const task of state.tasks ?? []) {
    if (task.ownerAllTasksListId) listIds.add(task.ownerAllTasksListId);
  }
  return sortUserLists(state.lists.filter((l) => listIds.has(l.id) && !isEmployeeAssignmentsList(l)));
}

function filterTasksByAllTasksList(tasks, listId) {
  if (!listId || listId === "all") return tasks;
  return tasks.filter((task) => task.ownerAllTasksListId === listId);
}

function allTasksEmployeeFilterOptions() {
  const byId = new Map();
  for (const task of state.tasks ?? []) {
    for (const assignee of task.assignees ?? []) {
      if (!assignee?.id || byId.has(assignee.id)) continue;
      byId.set(assignee.id, {
        id: assignee.id,
        displayName: assignee.displayName || assignee.email || tr("common.employee"),
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, { sensitivity: "base" })
  );
}

function filterTasksByAllTasksEmployee(tasks, userId) {
  if (!userId || userId === "all") return tasks;
  return tasks.filter((task) => (task.assignees ?? []).some((assignee) => assignee.id === userId));
}

function localCalendarDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function taskDueOnCalendarDay(task, dayKey) {
  if (!task?.dueAt || !dayKey) return false;
  if (task.allDay) {
    return String(task.dueAt).slice(0, 10) === dayKey;
  }
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return localCalendarDayKey(due) === dayKey;
}

function filterTasksByAllTasksDeadline(tasks, filter) {
  if (!filter || filter === "all") return tasks;
  const dayKey = filter === "today" ? localCalendarDayKey() : filter;
  return tasks.filter((task) => taskDueOnCalendarDay(task, dayKey));
}

function overdueLegendItemsHtml(activeFilter) {
  const tiers = [
    { id: "1-2", swatch: "1-2", labelKey: "common.overdueColor1to2" },
    { id: "3-5", swatch: "3-5", labelKey: "common.overdueColor3to5" },
    { id: "6plus", swatch: "6plus", labelKey: "common.overdueColor6plus" },
  ];
  return tiers
    .map((tier) => {
      const active = activeFilter === tier.id;
      return `<li>
        <button
          type="button"
          class="task-overdue-legend-pick${active ? " task-overdue-legend-pick--active" : ""}"
          data-overdue-tier="${tier.id}"
          aria-pressed="${active ? "true" : "false"}"
        >
          <span class="task-overdue-legend-swatch task-overdue-legend-swatch--${tier.swatch}" aria-hidden="true"></span>
          ${escapeHtml(tr(tier.labelKey))}
        </button>
      </li>`;
    })
    .join("");
}

function allTasksDeadlineInputValue() {
  const filter = state.allTasksDeadlineFilter || "all";
  if (filter === "all") return "";
  if (filter === "today") return localCalendarDayKey();
  return filter;
}

function allTasksDeadlineFilterHtml() {
  const pickedDate = allTasksDeadlineInputValue();
  return `<div class="all-tasks-filter-field">
      <label class="all-tasks-filter-label" for="all-tasks-deadline-date">${escapeHtml(tr("owner.allTasksDeadlineFilterLabel"))}</label>
      <input
        type="date"
        id="all-tasks-deadline-date"
        class="form-control form-control-sm all-tasks-filter-control all-tasks-deadline-date"
        value="${escapeHtml(pickedDate)}"
        aria-label="${escapeHtml(tr("owner.allTasksDeadlinePickDate"))}"
      />
    </div>`;
}

function overdueColorFilterSelectHtml(selectId, filter) {
  const value = filter || "all";
  return `<div class="all-tasks-filter-field">
      <label class="all-tasks-filter-label" for="${selectId}">${escapeHtml(tr("common.overdueColorFilterLabel"))}</label>
      <select id="${selectId}" class="form-select form-select-sm all-tasks-filter-control task-overdue-legend-select" aria-label="${escapeHtml(tr("common.overdueColorFilterLabel"))}">
        <option value="all"${value === "all" ? " selected" : ""}>${escapeHtml(tr("common.overdueColorFilterAll"))}</option>
        <option value="1-2"${value === "1-2" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor1to2"))}</option>
        <option value="3-5"${value === "3-5" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor3to5"))}</option>
        <option value="6plus"${value === "6plus" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor6plus"))}</option>
      </select>
    </div>`;
}

function allTasksFilterBarHtml() {
  const lists = allTasksListFilterOptions();
  let listFilter = state.allTasksListFilter || "all";
  if (listFilter !== "all" && !lists.some((list) => list.id === listFilter)) {
    listFilter = "all";
    state.allTasksListFilter = "all";
  }
  const employees = allTasksEmployeeFilterOptions();
  let employeeFilter = state.allTasksEmployeeFilter || "all";
  if (employeeFilter !== "all" && !employees.some((employee) => employee.id === employeeFilter)) {
    employeeFilter = "all";
    state.allTasksEmployeeFilter = "all";
  }
  const overdueFilter = state.overdueColorFilter || "all";
  const listOptions = lists
    .map(
      (list) =>
        `<option value="${escapeHtml(list.id)}"${listFilter === list.id ? " selected" : ""}>${escapeHtml(dt(list.title))}</option>`
    )
    .join("");
  const employeeOptions = employees
    .map(
      (employee) =>
        `<option value="${escapeHtml(employee.id)}"${employeeFilter === employee.id ? " selected" : ""}>${escapeHtml(dt(employee.displayName))}</option>`
    )
    .join("");
  return `<div class="all-tasks-filter-bar" aria-label="${escapeHtml(tr("owner.allTasksFiltersAria"))}">
      <div class="all-tasks-filter-field">
        <label class="all-tasks-filter-label" for="all-tasks-list-filter">${escapeHtml(tr("owner.allTasksListFilterLabel"))}</label>
        <select id="all-tasks-list-filter" class="form-select form-select-sm all-tasks-filter-control" aria-label="${escapeHtml(tr("owner.allTasksListFilterLabel"))}">
          <option value="all"${listFilter === "all" ? " selected" : ""}>${escapeHtml(tr("owner.allTasksListFilterAll"))}</option>
          ${listOptions}
        </select>
      </div>
      <div class="all-tasks-filter-field">
        <label class="all-tasks-filter-label" for="all-tasks-employee-filter">${escapeHtml(tr("owner.allTasksEmployeeFilterLabel"))}</label>
        <select id="all-tasks-employee-filter" class="form-select form-select-sm all-tasks-filter-control" aria-label="${escapeHtml(tr("owner.allTasksEmployeeFilterLabel"))}">
          <option value="all"${employeeFilter === "all" ? " selected" : ""}>${escapeHtml(tr("owner.allTasksEmployeeFilterAll"))}</option>
          ${employeeOptions}
        </select>
      </div>
      ${allTasksDeadlineFilterHtml()}
      ${overdueColorFilterSelectHtml("task-overdue-color-filter", overdueFilter)}
    </div>`;
}

function taskOverdueColorLegendHtml() {
  const filter = state.overdueColorFilter || "all";
  return `<div class="task-overdue-legend" role="note" aria-label="${escapeHtml(tr("common.overdueColorLegendTitle"))}">
    <div class="task-overdue-legend-main">
      <p class="task-overdue-legend-intro mb-0">${escapeHtml(tr("common.overdueColorLegendIntro"))}</p>
      <ul class="task-overdue-legend-list mb-0">
        ${overdueLegendItemsHtml(filter)}
      </ul>
    </div>
    <div class="task-overdue-legend-filter">
      <label class="task-overdue-legend-filter-label" for="task-overdue-color-filter">${escapeHtml(tr("common.overdueColorFilterLabel"))}</label>
      <select id="task-overdue-color-filter" class="task-overdue-legend-select form-select form-select-sm" aria-label="${escapeHtml(tr("common.overdueColorFilterLabel"))}">
        <option value="all"${filter === "all" ? " selected" : ""}>${escapeHtml(tr("common.overdueColorFilterAll"))}</option>
        <option value="1-2"${filter === "1-2" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor1to2"))}</option>
        <option value="3-5"${filter === "3-5" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor3to5"))}</option>
        <option value="6plus"${filter === "6plus" ? " selected" : ""}>${escapeHtml(tr("common.overdueColor6plus"))}</option>
      </select>
    </div>
  </div>`;
}

function applyOverdueColorFilter(value, root) {
  if (value !== "all" && value !== "1-2" && value !== "3-5" && value !== "6plus") return;
  state.overdueColorFilter = value;
  const select = root?.querySelector("#task-overdue-color-filter");
  if (select && select.value !== value) select.value = value;
  markOwnerNavBusy(350);
  if (state.user?.role === "employee") requestAnimationFrame(() => renderEmployeeMain());
  else requestAnimationFrame(() => renderOwnerMain());
}

function wireAllTasksDeadlineFilter(root) {
  const dateInput = root?.querySelector("#all-tasks-deadline-date");
  if (!dateInput) return;
  dateInput.addEventListener("change", () => {
    const value = dateInput.value?.trim();
    state.allTasksDeadlineFilter = value || "all";
    markOwnerNavBusy(350);
    requestAnimationFrame(() => renderOwnerMain());
  });
}

function wireOverdueLegendPicks(root) {
  root?.querySelectorAll("[data-overdue-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = btn.getAttribute("data-overdue-tier");
      if (!tier) return;
      const next = state.overdueColorFilter === tier ? "all" : tier;
      applyOverdueColorFilter(next, root);
    });
  });
}

function wireAllTasksListFilter(root) {
  const select = root?.querySelector("#all-tasks-list-filter");
  if (!select) return;
  select.addEventListener("change", () => {
    state.allTasksListFilter = select.value || "all";
    markOwnerNavBusy(350);
    requestAnimationFrame(() => renderOwnerMain());
  });
}

function wireAllTasksEmployeeFilter(root) {
  const select = root?.querySelector("#all-tasks-employee-filter");
  if (!select) return;
  select.addEventListener("change", () => {
    state.allTasksEmployeeFilter = select.value || "all";
    markOwnerNavBusy(350);
    requestAnimationFrame(() => renderOwnerMain());
  });
}

function wireOverdueColorFilter(root) {
  wireOverdueLegendPicks(root);
  const select = root?.querySelector("#task-overdue-color-filter");
  if (!select) return;
  select.addEventListener("change", () => {
    applyOverdueColorFilter(select.value, root);
  });
}

function allTasksFiltersEmptyMessageHtml() {
  return `<div class="owner-empty-state py-5 px-3">
    <i class="bi bi-funnel owner-empty-icon text-primary" aria-hidden="true"></i>
    <p class="owner-empty-title mb-1">${escapeHtml(tr("owner.allTasksFilterNone"))}</p>
    <p class="owner-empty-desc text-muted small mb-0">${escapeHtml(tr("owner.allTasksFilterNoneHint"))}</p>
  </div>`;
}

function overdueFilterEmptyMessageHtml() {
  return `<div class="owner-empty-state py-5 px-3">
    <i class="bi bi-funnel owner-empty-icon text-primary" aria-hidden="true"></i>
    <p class="owner-empty-title mb-1">${escapeHtml(tr("common.overdueColorFilterNone"))}</p>
    <p class="owner-empty-desc text-muted small mb-0">${escapeHtml(tr("common.overdueColorFilterNoneHint"))}</p>
  </div>`;
}

function shouldShowTaskOverdueColorLegend({ ownerFilter, empFilter, allTasksView } = {}) {
  if (allTasksView) return ownerFilter === "active" || ownerFilter === "in_progress";
  if (ownerFilter != null) return ownerFilter === "active" || ownerFilter === "in_progress";
  if (empFilter != null) return empFilter === "active";
  return false;
}

function isEmployeeCriticalOverdueTask(task) {
  if (!task?.dueAt) return false;
  const me = employeeMyAssignee(task);
  if (!me || employeeAssigneeShowsAsSubmitted(task, me)) return false;
  if (employeeAwaitingFreshOccurrence(task, me)) return false;
  return taskOverdueDayCount(task.dueAt) >= EMP_CRITICAL_OVERDUE_MIN_DAYS;
}

function getEmployeeCriticalOverdueTask() {
  const tasks = state.empTasks.filter((task) => {
    if (!isEmployeeCriticalOverdueTask(task)) return false;
    return !employeeHasActedOnCriticalOverdue(task);
  });
  if (!tasks.length) return null;
  tasks.sort((a, b) => taskOverdueDayCount(b.dueAt) - taskOverdueDayCount(a.dueAt));
  return tasks[0];
}

function isEmployeeOverdueGateActive() {
  return document.body.classList.contains("emp-overdue-gate-open");
}

function empCriticalOverdueGateHtml(task) {
  const days = taskOverdueDayCount(task.dueAt);
  const overdueLabel = tr("employee.overdueByDays", { count: days });
  const notesRaw = (task.notes || "").trim().replace(/\s+/g, " ");
  const descriptionBlock = notesRaw
    ? `<p class="emp-critical-overdue-gate__desc">${escapeHtml(dt(notesRaw.length > 240 ? `${notesRaw.slice(0, 237)}…` : notesRaw))}</p>`
    : "";
  return `<div id="emp-critical-overdue-gate" class="emp-critical-overdue-gate" role="alertdialog" aria-modal="true" aria-labelledby="emp-critical-overdue-gate-title" data-task-id="${escapeHtml(task.id)}">
    <div class="emp-critical-overdue-gate__panel admin-emp-modal-card">
      <div class="emp-critical-overdue-gate__badge">${escapeHtml(tr("common.overdueColor6plus"))}</div>
      <h2 class="emp-critical-overdue-gate__title" id="emp-critical-overdue-gate-title">${escapeHtml(tr("employee.criticalOverdueGateTitle"))}</h2>
      <p class="emp-critical-overdue-gate__intro">${escapeHtml(tr("employee.criticalOverdueGateIntro"))}</p>
      <div class="emp-critical-overdue-gate__task">
        <p class="admin-emp-modal-field-label mb-1">${tr("common.task")}</p>
        <p class="emp-critical-overdue-gate__task-title fw-semibold mb-2">${escapeHtml(dt(task.title))}</p>
        <p class="emp-critical-overdue-gate__deadline text-danger fw-semibold mb-0 tabular-nums">${escapeHtml(overdueLabel)}</p>
        <p class="emp-critical-overdue-gate__deadline-was small text-muted mb-0 tabular-nums">${escapeHtml(formatEmpDue(task.dueAt))}</p>
        ${descriptionBlock}
      </div>
      <div class="emp-critical-overdue-gate__actions">
        <button type="button" class="admin-task-modal-btn-secondary emp-gate-postpone-task" data-task-id="${escapeHtml(task.id)}">
          ${adminMsIcon("schedule")} ${escapeHtml(tr("employee.criticalOverdueGatePostpone"))}
        </button>
        <button type="button" class="admin-task-modal-btn-save emp-gate-submit-task" data-task-id="${escapeHtml(task.id)}">
          ${adminMsIcon("send")} ${escapeHtml(tr("employee.criticalOverdueGateSubmit"))}
        </button>
      </div>
      <p class="emp-critical-overdue-gate__must-act mb-0">${escapeHtml(tr("employee.criticalOverdueGateMustAct"))}</p>
    </div>
  </div>`;
}

function dismissCriticalOverdueGateForTask(taskId) {
  if (!taskId) return;
  empCriticalOverdueSatisfiedIds.add(taskId);
  removeEmployeeOverdueGate();
}

function removeEmployeeOverdueGate() {
  const wasOpen = document.body.classList.contains("emp-overdue-gate-open");
  document.querySelectorAll(".emp-critical-overdue-gate").forEach((el) => el.remove());
  document.body.classList.remove("emp-overdue-gate-open");
  if (
    wasOpen &&
    state.user?.role === "employee" &&
    state.user?.attendanceEnabled === true &&
    !getEmployeeCriticalOverdueTask()
  ) {
    startAttendanceCheckInReminder();
  }
}

function wireEmployeeOverdueGate(gateEl) {
  if (!gateEl || gateEl.dataset.wiredOverdueGate === "1") return;
  gateEl.dataset.wiredOverdueGate = "1";

  gateEl.querySelector(".emp-gate-postpone-task")?.addEventListener("click", () => {
    const taskId = gateEl.getAttribute("data-task-id");
    if (!taskId) return;
    const task = state.empTasks.find((t) => t.id === taskId);
    const optimisticAt = new Date().toISOString();
    if (task) {
      task.pendingDeadlineExtension = buildPendingExtensionFromRequestedAt(optimisticAt);
    }
    savePostponeGraceForTask(taskId, optimisticAt);
    dismissCriticalOverdueGateForTask(taskId);
    syncEmployeeOverdueGate();

    void (async () => {
      try {
        const { request } = await api("/api/deadline-extensions", {
          method: "POST",
          body: JSON.stringify({ taskId }),
        });
        const liveTask = state.empTasks.find((t) => t.id === taskId);
        if (liveTask && request) {
          liveTask.pendingDeadlineExtension = {
            id: request.id,
            requestedAt: request.requestedAt,
            status: request.status,
            expiresAt: request.expiresAt,
          };
        }
        if (request?.requestedAt) savePostponeGraceForTask(taskId, request.requestedAt);
        showToast(tr("employee.criticalOverdueGatePostponeSent"), "success");
        schedulePostponeGraceRecheck();
      } catch (err) {
        clearPostponeGraceForTask(taskId);
        empCriticalOverdueSatisfiedIds.delete(taskId);
        const liveTask = state.empTasks.find((t) => t.id === taskId);
        if (liveTask) liveTask.pendingDeadlineExtension = null;
        syncEmployeeOverdueGate();
        showToast(err.message || tr("employee.criticalOverdueGatePostponeFailed"), "warning");
      }
    })();
  });

  gateEl.querySelector(".emp-gate-submit-task")?.addEventListener("click", () => {
    const taskId = gateEl.getAttribute("data-task-id");
    const task = state.empTasks.find((t) => t.id === taskId);
    if (!task) return;
    dismissCriticalOverdueGateForTask(taskId);
    openEmpSubmissionModal(task);
  });
}

function schedulePostponeGraceRecheck() {
  if (empPostponeGraceTimer != null) {
    window.clearTimeout(empPostponeGraceTimer);
    empPostponeGraceTimer = null;
  }
  let minRemaining = null;
  for (const task of state.empTasks) {
    if (!employeeHasActivePostponeGrace(task)) continue;
    const ext = task.pendingDeadlineExtension;
    const localAt = getLocalPostponeGraceRequestedAt(task.id);
    const requestedAt = ext?.requestedAt ?? localAt;
    if (!requestedAt) continue;
    const expiresAt = ext?.expiresAt
      ? new Date(ext.expiresAt).getTime()
      : new Date(requestedAt).getTime() + POSTPONE_GRACE_MS;
    const remaining = expiresAt - Date.now();
    if (remaining > 0 && (minRemaining === null || remaining < minRemaining)) {
      minRemaining = remaining;
    }
  }
  if (minRemaining == null) return;
  empPostponeGraceTimer = window.setTimeout(() => {
    empPostponeGraceTimer = null;
    syncEmployeeOverdueGate();
    schedulePostponeGraceRecheck();
  }, minRemaining + 500);
}

function syncEmployeeOverdueGate() {
  if (state.user?.role !== "employee") {
    removeEmployeeOverdueGate();
    return;
  }

  const task = getEmployeeCriticalOverdueTask();
  if (!task) {
    removeEmployeeOverdueGate();
    return;
  }

  const existing = document.getElementById("emp-critical-overdue-gate");
  const existingTaskId = existing?.getAttribute("data-task-id");
  if (existingTaskId === task.id) {
    document.body.classList.add("emp-overdue-gate-open");
    return;
  }

  existing?.remove();
  document.body.classList.add("emp-overdue-gate-open");
  document.body.insertAdjacentHTML("beforeend", empCriticalOverdueGateHtml(task));
  wireEmployeeOverdueGate(document.getElementById("emp-critical-overdue-gate"));
}

function formatEmpDeadlineDisplay(task, { submitted = false } = {}) {
  if (!task?.dueAt) return `<span class="text-muted">—</span>`;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return `<span class="text-muted">—</span>`;

  if (!submitted && Date.now() > due.getTime()) {
    const days = taskOverdueDayCount(task.dueAt);
    const overdueLabel = tr("employee.overdueByDays", { count: days });
    return `<span class="emp-deadline-overdue text-danger fw-semibold tabular-nums">${escapeHtml(overdueLabel)}</span>
      <span class="d-block small text-muted emp-deadline-was tabular-nums mt-1">${escapeHtml(formatEmpDue(task.dueAt))}</span>`;
  }

  return `<span class="tabular-nums">${escapeHtml(formatEmpDue(task.dueAt))}</span>`;
}

function formatTaskCreatedDate(iso, { short = false } = {}) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (short) {
    return d.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" });
  }
  return formatDateTime24(iso);
}

function taskCreatedMetaHtml(createdAt) {
  const full = formatTaskCreatedDate(createdAt);
  const short = formatTaskCreatedDate(createdAt, { short: true });
  if (!full || !short) return "";
  const dtAttr = escapeHtml(String(createdAt).slice(0, 19));
  return `<div class="emp-task-date-row task-created-row">
    <span class="emp-task-date-label">${tr("common.createdLabel")}</span>
    <time class="task-created-meta-date tabular-nums" datetime="${dtAttr}">
      <span class="task-created-meta-full d-none d-md-inline">${escapeHtml(full)}</span>
      <span class="task-created-meta-short d-md-none">${escapeHtml(short)}</span>
    </time>
  </div>`;
}

function empTaskDatesCellHtml(t, submitted, submittedWhen) {
  const created = taskCreatedMetaHtml(t.createdAt);
  if (submitted && submittedWhen) {
    return `<div class="emp-task-dates-stack">
      ${created}
      <div class="emp-task-date-row">
        <span class="emp-task-date-label">${tr("common.submittedLabel")}</span>
        <span class="text-success tabular-nums">${escapeHtml(formatEmpDue(submittedWhen))}</span>
      </div>
    </div>`;
  }
  const deadlineValue = formatEmpDeadlineDisplay(t, { submitted });
  const durationLine =
    t.durationMinutes > 0
      ? `<div class="emp-task-date-row">
      <span class="emp-task-date-label">${tr("common.durationLabel")}</span>
      <span class="tabular-nums">${escapeHtml(formatTaskDuration(t.durationMinutes))}</span>
    </div>`
      : "";
  return `<div class="emp-task-dates-stack">
    ${created}
    <div class="emp-task-date-row">
      <span class="emp-task-date-label">${tr("common.deadlineLabel")}</span>
      ${deadlineValue}
    </div>
    ${durationLine}
  </div>`;
}

function formatEmpRecurrencePattern(task) {
  const recurrence = task.recurrence ?? "none";
  if (recurrence === "none") return "";
  const due = task.dueAt ? new Date(task.dueAt) : null;
  if (recurrence === "daily") return tr("owner.recurrenceDaily");
  if (recurrence === "weekly") {
    const weekday = due && !Number.isNaN(due.getTime()) ? due.toLocaleDateString(dateLocale(), { weekday: "long" }) : "";
    return weekday ? tr("owner.repeatWeeklyOn", { weekday }) : tr("owner.recurrenceWeekly");
  }
  if (recurrence === "monthly") {
    return due && !Number.isNaN(due.getTime())
      ? tr("owner.repeatMonthlyOn", { ordinal: ordinalDayOfMonth(due.getDate()) })
      : tr("owner.recurrenceMonthly");
  }
  if (recurrence === "yearly") {
    if (due && !Number.isNaN(due.getTime())) {
      const monthLong = due.toLocaleDateString(dateLocale(), { month: "long" });
      return tr("owner.repeatYearlyOn", { month: monthLong, ordinal: ordinalDayOfMonth(due.getDate()) });
    }
    return tr("owner.recurrenceYearly");
  }
  if (recurrence === "custom" && task.recurrenceRule && typeof task.recurrenceRule === "object") {
    return formatCustomRecurrenceRuleLabel(task.recurrenceRule, task.dueAt);
  }
  return ownerRecurrenceShortLabel(task);
}

function ownerTaskRecurrenceBadgeHtml(task) {
  const pattern = formatEmpRecurrencePattern(task);
  if (!pattern) return "";
  return `<span class="owner-task-recurrence-badge" title="${escapeHtml(pattern)}"><i class="bi bi-arrow-repeat" aria-hidden="true"></i><span class="owner-task-recurrence-badge-text">${escapeHtml(pattern)}</span></span>`;
}

function empActiveRecurrenceLinesHtml(task) {
  const pattern = formatEmpRecurrencePattern(task);
  if (!pattern) return "";
  return `<div class="emp-recurrence-lines small text-muted mt-1"><div class="emp-recurrence-pattern">${escapeHtml(pattern)}</div></div>`;
}

function reconcileCriticalOverdueGateFromServer() {
  for (const task of state.empTasks) {
    const me = employeeMyAssignee(task);
    if (!task?.dueAt || !me) continue;
    if (employeeAssigneeShowsAsSubmitted(task, me)) {
      empCriticalOverdueSatisfiedIds.add(task.id);
      continue;
    }
    if (employeeHasActivePostponeGrace(task)) {
      empCriticalOverdueSatisfiedIds.add(task.id);
      continue;
    }
    const threshold = criticalOverdueActionThresholdMs(task.dueAt);
    if (me.lastSubmittedAt) {
      const submittedMs = new Date(me.lastSubmittedAt).getTime();
      if (!Number.isNaN(submittedMs) && submittedMs >= threshold) {
        empCriticalOverdueSatisfiedIds.add(task.id);
      }
    }
  }
  schedulePostponeGraceRecheck();
}

async function loadEmployeeTasks() {
  const { tasks } = await api("/api/tasks/assigned");
  state.empTasks = tasks;
  mergePostponeGraceOntoEmployeeTasks();
  reconcileCriticalOverdueGateFromServer();
}

async function loadEmployeeAssignedByMeTasks() {
  const { tasks } = await api("/api/tasks/assigned-by-me");
  state.empAssignedByMeTasks = tasks ?? [];
}

async function loadEmployeeDashboard() {
  await Promise.all([loadEmployeeTasks(), loadEmployeeAssignedByMeTasks()]);
  await ensureStateContentTranslations(state);
}

async function empRefreshDashboard(btn) {
  if (btn) btn.disabled = true;
  try {
    await loadEmployeeDashboard();
    renderEmpListContentOnly();
    renderEmployeeMain();
    syncEmpTopbarTitle();
    showToast(tr("toast.tasksRefreshed"), "success");
  } catch (err) {
    showToast(err.message, "danger");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteEmpAssignedTask(btn) {
  const taskId = btn.getAttribute("data-task-id");
  const title = btn.getAttribute("data-task-title") || "this task";
  if (!taskId) return;
  if (!window.confirm(`Delete "${title}"?\n\nThis removes the task for your colleague too.`)) return;
  btn.disabled = true;
  try {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    await loadEmployeeAssignedByMeTasks();
    renderEmpListContentOnly();
    renderEmployeeMain();
    syncEmpTopbarTitle();
    showToast(tr("toast.taskDeleted"), "success");
  } catch (err) {
    showToast(err.message, "danger");
    btn.disabled = false;
  }
}

async function loadEmpPeers() {
  const { users } = await api("/api/users/peers");
  state.empPeers = users ?? [];
  return state.empPeers;
}

async function openEmpCreateTaskModal() {
  const modalEl = document.getElementById("empCreateTaskModal");
  if (!modalEl) return;
  const titleInput = document.getElementById("emp-create-title");
  const notesInput = document.getElementById("emp-create-notes");
  const dueInput = document.getElementById("emp-create-due");
  const select = document.getElementById("emp-create-assignee");
  const errEl = document.getElementById("emp-create-error");
  if (!titleInput || !notesInput || !dueInput || !select || !errEl) return;

  titleInput.value = "";
  notesInput.value = "";
  dueInput.value = "";
  errEl.classList.add("d-none");
  errEl.textContent = "";
  select.innerHTML = `<option value="">${tr("employee.chooseEmployee")}</option>`;

  try {
    const peers = state.empPeers?.length ? state.empPeers : await loadEmpPeers();
    peers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.displayName;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message || tr("toast.couldNotLoadEmployees"), "danger");
    return;
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  window.setTimeout(() => titleInput.focus(), 300);
}

function wireEmpCreateTaskModal() {
  const modalEl = document.getElementById("empCreateTaskModal");
  if (!modalEl || modalEl.dataset.wiredEmpCreate === "1") return;
  modalEl.dataset.wiredEmpCreate = "1";

  const submitBtn = document.getElementById("emp-create-submit");
  submitBtn?.addEventListener("click", async () => {
    const titleInput = document.getElementById("emp-create-title");
    const notesInput = document.getElementById("emp-create-notes");
    const dueInput = document.getElementById("emp-create-due");
    const select = document.getElementById("emp-create-assignee");
    const errEl = document.getElementById("emp-create-error");
    if (!titleInput || !notesInput || !dueInput || !select || !errEl) return;

    const title = titleInput.value.trim();
    const notes = notesInput.value.trim();
    const dueRaw = dueInput.value.trim();
    const assigneeId = select.value.trim();

    errEl.classList.add("d-none");
    errEl.textContent = "";
    if (!title) {
      errEl.textContent = tr("validation.enterTaskTitle");
      errEl.classList.remove("d-none");
      return;
    }
    if (!assigneeId) {
      errEl.textContent = tr("validation.chooseEmployeeAssign");
      errEl.classList.remove("d-none");
      return;
    }

    const body = { title, notes, assigneeId };
    if (dueRaw) {
      body.dueAt = new Date(dueRaw).toISOString();
      body.allDay = false;
    }

    submitBtn.disabled = true;
    try {
      await api("/api/tasks/employee-create", {
        method: "POST",
        body: JSON.stringify(body),
      });
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToast(tr("toast.taskCreatedAssigned"), "success");
      await loadEmployeeAssignedByMeTasks();
      state.empFilter = "assigned-by-me";
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmpTopbarTitle();
    } catch (err) {
      errEl.textContent = err.message || tr("validation.createTaskFailed");
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function openEmpDelegateModal(task) {
  const modalEl = document.getElementById("empDelegateModal");
  if (!modalEl || !task) return;
  const idInput = document.getElementById("emp-delegate-task-id");
  const titleEl = document.getElementById("emp-delegate-task-title");
  const select = document.getElementById("emp-delegate-employee");
  const errEl = document.getElementById("emp-delegate-error");
  if (!idInput || !titleEl || !select || !errEl) return;

  idInput.value = task.id;
  titleEl.textContent = dt(task.title);
  errEl.classList.add("d-none");
  errEl.textContent = "";
  select.innerHTML = `<option value="">${tr("employee.chooseEmployee")}</option>`;

  try {
    const peers = state.empPeers?.length ? state.empPeers : await loadEmpPeers();
    peers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.displayName;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message || tr("toast.couldNotLoadEmployees"), "danger");
    return;
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function wireEmpDelegateModal() {
  const modalEl = document.getElementById("empDelegateModal");
  if (!modalEl || modalEl.dataset.wiredEmpDelegate === "1") return;
  modalEl.dataset.wiredEmpDelegate = "1";

  const submitBtn = document.getElementById("emp-delegate-submit");
  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("emp-delegate-task-id");
    const select = document.getElementById("emp-delegate-employee");
    const errEl = document.getElementById("emp-delegate-error");
    const taskId = idInput?.value?.trim();
    const employeeId = select?.value?.trim();
    if (!taskId || !select || !errEl) return;

    errEl.classList.add("d-none");
    errEl.textContent = "";
    if (!employeeId) {
      errEl.textContent = tr("validation.chooseEmployee");
      errEl.classList.remove("d-none");
      return;
    }

    submitBtn.disabled = true;
    try {
      await api(`/api/tasks/${taskId}/delegate`, {
        method: "POST",
        body: JSON.stringify({ employeeId }),
      });
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToast(tr("toast.taskAssignedColleague"), "success");
      await loadEmployeeDashboard();
      state.empFilter = "assigned-by-me";
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmpTopbarTitle();
    } catch (err) {
      errEl.textContent = err.message || tr("validation.assignTaskFailed");
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function employeeDashboardMetrics() {
  const tasks = state.empTasks;
  const active = tasks.filter((t) => !employeeMyAssignee(t)?.assigneeDone).length;
  const done = tasks.filter((t) => employeeAssigneeShowsAsSubmitted(t)).length;
  const now = Date.now();
  const dueSoon = tasks.filter((t) => {
    if (!t.dueAt || employeeMyAssignee(t)?.assigneeDone) return false;
    const due = new Date(t.dueAt).getTime();
    return Number.isFinite(due) && due > now && due - now < 24 * 60 * 60 * 1000;
  }).length;
  return { total: tasks.length, active, done, dueSoon };
}

function employeeAssignedByMeMetrics() {
  const tasks = state.empAssignedByMeTasks;
  const pending = tasks.filter((t) => (t.assignedTo ?? []).some((a) => !a.assigneeDone)).length;
  const done = tasks.filter((t) => (t.assignedTo ?? []).every((a) => a.assigneeDone)).length;
  return { total: tasks.length, pending, done };
}

function empFilterLabel(filter) {
  if (filter === "assigned-by-me") return tr("nav.assignedByMe");
  if (filter === "submitted") return tr("employee.submittedTasks");
  if (filter === "all") return tr("employee.allAssignedTasks");
  return tr("nav.activeTasks");
}

function empFilterSubtitle(filter) {
  if (filter === "assigned-by-me") {
    return tr("employee.assignedByMeHint");
  }
  return tr("employee.activeTasksHint");
}

function empNavFilterButtonHtml(f, active) {
  const msIconName =
    f.id === "submitted"
      ? "check_circle"
      : f.id === "all"
        ? "inventory_2"
        : f.id === "assigned-by-me"
          ? "group_add"
          : "task_alt";
  return `<button type="button" class="admin-sidebar-nav-item${active ? " active" : ""}" data-emp-filter="${f.id}">
    <span class="admin-nav-item-left">
      ${adminMsIcon(msIconName)}
      <span>${escapeHtml(f.label)}</span>
    </span>
    <span class="admin-nav-count tabular-nums">${f.count}</span>
  </button>`;
}

function empNavAttendanceButtonHtml(active) {
  return `<button type="button" class="admin-sidebar-nav-item${active ? " active" : ""}" data-emp-view="attendance">
    <span class="admin-nav-item-left">
      ${adminMsIcon("how_to_reg")}
      <span>${escapeHtml(tr("attendance.myAttendance"))}</span>
    </span>
  </button>`;
}

function empTaskSubmittedTimestamp(task) {
  const me = employeeMyAssignee(task);
  if (!me?.lastSubmittedAt) return 0;
  const ms = new Date(me.lastSubmittedAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function sortEmpTasksForDisplay(tasks) {
  const list = [...tasks];
  if (state.empFilter === "submitted") {
    return list.sort((a, b) => {
      const prio = compareHighPriorityFirst(a, b);
      if (prio !== 0) return prio;
      const bySubmitted = empTaskSubmittedTimestamp(b) - empTaskSubmittedTimestamp(a);
      if (bySubmitted !== 0) return bySubmitted;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }
  if (state.empFilter === "all") {
    return list.sort((a, b) => {
      const aDone = employeeAssigneeShowsAsSubmitted(a);
      const bDone = employeeAssigneeShowsAsSubmitted(b);
      if (aDone !== bDone) return aDone ? 1 : -1;
      const prio = compareHighPriorityFirst(a, b);
      if (prio !== 0) return prio;
      if (aDone) {
        const bySubmitted = empTaskSubmittedTimestamp(b) - empTaskSubmittedTimestamp(a);
        if (bySubmitted !== 0) return bySubmitted;
        return String(a.title || "").localeCompare(String(b.title || ""));
      }
      return compareTasksByRecurrenceThenCreated(a, b);
    });
  }
  return sortTasksByRecurrenceThenCreated(list);
}

function empFilteredTasks() {
  let tasks;
  if (state.empFilter === "submitted") {
    tasks = state.empTasks.filter((t) => employeeAssigneeShowsAsSubmitted(t));
  } else if (state.empFilter === "all") {
    tasks = state.empTasks;
  } else {
    tasks = state.empTasks.filter((t) => !employeeMyAssignee(t)?.assigneeDone);
  }
  return sortEmpTasksForDisplay(tasks);
}

function empTaskTableRows(tasks) {
  const emptyCopy =
    state.empFilter === "submitted"
      ? { icon: "check-circle", title: tr("empty.nothingSubmitted"), desc: tr("empty.nothingSubmittedDesc") }
      : state.empFilter === "all"
        ? { icon: "folder2-open", title: tr("empty.noAssignedTasks"), desc: tr("empty.noAssignedTasksDesc") }
        : { icon: "clipboard2-plus", title: tr("empty.empNoActive"), desc: tr("empty.empNoActiveDesc") };

  if (!tasks.length) {
    return `<tbody class="owner-task-empty"><tr><td colspan="4">
      <div class="owner-empty-state py-5 px-3">
        <i class="bi bi-${emptyCopy.icon} owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">${emptyCopy.title}</p>
        <p class="owner-empty-desc text-muted small mb-0">${emptyCopy.desc}</p>
      </div>
    </td></tr></tbody>`;
  }

  return `<tbody>${tasks
    .map((task) => {
      const me = employeeMyAssignee(task);
      const displayMode = empTaskRowDisplayMode(task, me);
      const submitted = displayMode === "submitted";
      const notesRaw = (task.notes || "").trim().replace(/\s+/g, " ");
      const descriptionBox = empTaskDescriptionBoxHtml(notesRaw, task.id, task.title);
      const updateCount = employeeAwaitingFreshOccurrence(task, me) ? 0 : (me?.progressUpdateCount ?? 0);
      const updateBadge =
        updateCount > 0
          ? `<span class="emp-update-count tabular-nums">${updateCount}</span>`
          : "";
      const archivedNotesRaw = (me?.lastSubmissionText || "").trim().replace(/\s+/g, " ");
      const archivedNotesPreview =
        submitted && archivedNotesRaw
          ? archivedNotesRaw.length > 80
            ? `${archivedNotesRaw.slice(0, 77)}…`
            : archivedNotesRaw
          : "";
      const archivedNotesLine = archivedNotesPreview
        ? `<div class="small text-muted emp-submitted-notes-preview mt-1" title="${escapeHtml(archivedNotesRaw)}">${escapeHtml(archivedNotesPreview)}</div>`
        : "";
      const needsResubmit = !submitted && employeeHasArchivedSubmission(me);
      const previousSubmissionBtn = needsResubmit
        ? `<button type="button" class="btn btn-sm btn-outline-secondary emp-view-submission emp-action-btn" data-task-id="${task.id}" data-user-id="${escapeHtml(state.user?.id || "")}" data-archived="1"><i class="bi bi-clock-history me-1" aria-hidden="true"></i>${tr("employee.viewPreviousSubmission")}</button>`
        : "";
      const resubmitHint = needsResubmit
        ? `<div class="small text-warning emp-resubmit-hint mt-1">${escapeHtml(tr("employee.resubmitRequiredHint"))}</div>`
        : "";
      const viewCurrentBtn =
        submitted && employeeHasCurrentSubmission(me)
          ? `<button type="button" class="btn btn-sm btn-outline-primary emp-view-submission emp-action-btn" data-task-id="${task.id}" data-user-id="${escapeHtml(state.user?.id || "")}"><i class="bi bi-eye me-1" aria-hidden="true"></i>${tr("common.view")}</button>`
          : "";
      const viewPreviousBtnSubmitted =
        submitted && employeeHasArchivedSubmission(me)
          ? `<button type="button" class="btn btn-sm btn-outline-secondary emp-view-submission emp-action-btn" data-task-id="${task.id}" data-user-id="${escapeHtml(state.user?.id || "")}" data-archived="1"><i class="bi bi-clock-history me-1" aria-hidden="true"></i>${tr("employee.viewPreviousSubmission")}</button>`
          : "";
      const updateSubmissionBtn = submitted
        ? `<button type="button" class="btn btn-sm btn-primary emp-open-submit emp-action-btn" data-task-id="${task.id}"><i class="bi bi-pencil-square me-1" aria-hidden="true"></i>${tr("employee.updateSubmission")}</button>`
        : "";
      const submissionBtn = submitted
        ? `${viewCurrentBtn}${viewPreviousBtnSubmitted}${updateSubmissionBtn}`
        : `<button type="button" class="btn btn-sm btn-primary emp-open-submit emp-action-btn" data-task-id="${task.id}"><i class="bi bi-send me-1" aria-hidden="true"></i>${tr("common.submit")}</button>`;
      const assignedByLine = me?.assignedBy?.displayName
        ? `<div class="small text-muted emp-assigned-by-line mt-1">From ${escapeHtml(dt(me.assignedBy.displayName))}</div>`
        : "";
      const showRecurrenceOnActive = displayMode === "active" && (task.recurrence ?? "none") !== "none";
      const recurrenceLines = showRecurrenceOnActive ? empActiveRecurrenceLinesHtml(task) : "";
      const submissionCell = `<div class="d-flex flex-column align-items-end gap-1 emp-task-actions">
          <button type="button" class="btn btn-sm emp-open-progress-update emp-update-btn emp-action-btn" data-task-id="${task.id}">
            <i class="bi bi-chat-left-dots" aria-hidden="true"></i><span>${tr("common.update")}</span>${updateBadge}
          </button>
          ${previousSubmissionBtn}
          ${submissionBtn}
          ${resubmitHint}
        </div>`;
      const rowDone = submitted ? "owner-task-row--completed" : "";
      const priorityClass = ownerTaskRowPriorityClass(task);
      const overdueClass = submitted ? "" : taskOverdueTierClass(task.dueAt);
      const submittedWhen = me?.lastSubmittedAt || me?.assigneeDoneAt || null;
      const datesCell = empTaskDatesCellHtml(task, submitted, submittedWhen);
      return `<tr class="owner-task-row emp-task-row${priorityClass}${overdueClass} ${rowDone}" data-task-id="${task.id}">
        <td class="owner-task-cell owner-task-col--task emp-col-task align-middle">
          <span class="fw-semibold emp-task-title ${submitted ? "text-muted text-decoration-line-through" : ""}">${escapeHtml(dt(task.title))}</span>
          ${taskAssignmentAttachmentsBadgeHtml(task)}
          ${assignedByLine}
          ${recurrenceLines}
          ${archivedNotesLine}
        </td>
        <td class="owner-task-cell owner-task-col--deadline emp-col-deadline align-middle small">${datesCell}</td>
        <td class="owner-task-cell emp-col-desc align-middle">${descriptionBox}</td>
        <td class="owner-task-cell emp-col-proof text-end align-middle">${submissionCell}</td>
      </tr>`;
    })
    .join("")}</tbody>`;
}

function empAssignedByMeCardsHtml(tasks) {
  if (!tasks.length) {
    return `<div class="owner-empty-state py-5 px-3">
      <i class="bi bi-person-plus owner-empty-icon text-primary" aria-hidden="true"></i>
      <p class="owner-empty-title mb-1">${tr("empty.nothingAssignedYet")}</p>
      <p class="owner-empty-desc text-muted small mb-0">Use <strong>Create & assign task</strong> to assign work to a colleague.</p>
      </div>`;
  }

  return `<div class="emp-assigned-by-me-cards d-flex flex-column gap-3">${tasks
    .map((task) => {
      const assignees = task.assignedTo ?? [];
      const assigneeNames = assignees.map((a) => escapeHtml(dt(a.displayName))).join(", ") || "—";
      const notesRaw = (task.notes || "").trim().replace(/\s+/g, " ");
      const displayNotes = dt(notesRaw);
      const descriptionText =
        notesRaw.length > 0
          ? escapeHtml(displayNotes.length > 200 ? `${displayNotes.slice(0, 197)}…` : displayNotes)
          : `<span class="text-muted fst-italic">${tr("common.noDescription")}</span>`;
      const assignedWhen = assignees[0]?.delegatedAt
        ? escapeHtml(formatProgressUpdateTime(assignees[0].delegatedAt))
        : "";
      const deadlineDisplay = task.dueAt
        ? formatEmpDeadlineDisplay(task, { submitted: false })
        : `<span class="text-muted">—</span>`;
      const deleteBtn = task.canDelete
        ? `<button type="button" class="btn btn-sm btn-outline-danger js-emp-delete-assigned" data-task-id="${task.id}" data-task-title="${escapeHtml(dt(task.title))}" aria-label="${tr("common.deleteTask")}">
            <i class="bi bi-trash" aria-hidden="true"></i>
            <span class="d-none d-sm-inline ms-1">${tr("common.delete")}</span>
          </button>`
        : "";
      return `<article class="emp-assigned-out-card" data-task-id="${task.id}">
        <div class="emp-assigned-out-card-head">
          <h3 class="emp-assigned-out-card-title h6 mb-0">${escapeHtml(dt(task.title))}</h3>
          ${taskCreatedMetaHtml(task.createdAt)}
          <div class="emp-assigned-out-card-meta d-flex flex-wrap align-items-center gap-2">
            ${assignedWhen ? `<time class="emp-assigned-out-card-when small text-muted tabular-nums">Assigned ${assignedWhen}</time>` : ""}
            ${deleteBtn}
                </div>
              </div>
        <div class="emp-assigned-out-card-grid">
          <div class="emp-assigned-out-card-field">
            <span class="emp-assigned-out-card-label">${tr("common.assignedTo")}</span>
            <span class="emp-assigned-out-card-value fw-semibold">${assigneeNames}</span>
            </div>
          <div class="emp-assigned-out-card-field">
            <span class="emp-assigned-out-card-label">${tr("common.deadline")}</span>
            <span class="emp-assigned-out-card-value tabular-nums">${deadlineDisplay}</span>
                </div>
          <div class="emp-assigned-out-card-field emp-assigned-out-card-field--full">
            <span class="emp-assigned-out-card-label">${tr("common.description")}</span>
            <span class="emp-assigned-out-card-value small">${descriptionText}</span>
              </div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function empLeftNavInner() {
  return `
    <div class="owner-sidebar admin-sidebar d-flex flex-column h-100">
      <div class="admin-sidebar-profile">
        ${ownerSidebarLogoHtml()}
        <div class="admin-sidebar-brand-title">${tr("app.title")}</div>
      </div>
      <button type="button" class="admin-create-task-btn js-emp-create-task">
        ${adminMsIcon("add")}
        ${tr("nav.createAndAssign")}
      </button>
      <nav class="admin-sidebar-nav" aria-label="${tr("nav.myWork")}">
        <div class="js-emp-nav-host"></div>
        ${teamChatSidebarNavItemHtml()}
      </nav>
    </div>`;
}

function syncEmpTopbarTitle() {
  /* Legacy hook — employee dashboard title is fixed in admin header */
}

function renderEmpMobileFilters() {
  /* Mobile filters use admin KPI cards in renderEmployeeMain */
}

function updateEmpNavActiveState() {
  const onDashboard = state.empView !== "attendance";
  document.querySelectorAll(".js-emp-nav-host [data-emp-filter]").forEach((btn) => {
    const filter = btn.getAttribute("data-emp-filter");
    btn.classList.toggle("active", onDashboard && state.empFilter === filter);
  });
  document.querySelectorAll(".js-emp-nav-host [data-emp-view='attendance']").forEach((btn) => {
    btn.classList.toggle("active", state.empView === "attendance");
  });
}

function renderEmpListContentOnly() {
  const metrics = employeeDashboardMetrics();
  const assignedMetrics = employeeAssignedByMeMetrics();
  const onDashboard = state.empView !== "attendance";
  const myWorkFilters = [
    { id: "active", label: tr("nav.activeTasks"), icon: "list-task", count: metrics.active },
    { id: "submitted", label: tr("nav.submitted"), icon: "check-circle", count: metrics.done },
    { id: "all", label: tr("nav.allAssigned"), icon: "collection", count: metrics.total },
  ];
  const myWorkHtml = myWorkFilters
    .map((f) => empNavFilterButtonHtml(f, onDashboard && state.empFilter === f.id))
    .join("");
  const assignedHtml = empNavFilterButtonHtml(
    { id: "assigned-by-me", label: tr("nav.assignedByMe"), icon: "person-plus", count: assignedMetrics.total },
    onDashboard && state.empFilter === "assigned-by-me"
  );
  const attendanceHtml =
    state.user?.attendanceEnabled === true
      ? empNavAttendanceButtonHtml(state.empView === "attendance")
      : "";
  const html = myWorkHtml + assignedHtml + attendanceHtml;
  document.querySelectorAll(".js-emp-nav-host").forEach((host) => {
    host.innerHTML = html;
  });
  updateEmpNavActiveState();
  bindEmpNavHandlers();
}

function bindEmpNavHandlers() {
  document.querySelectorAll(".js-emp-nav-host [data-emp-filter]").forEach((btn) => {
    if (btn.dataset.empNavWired === "1") return;
    btn.dataset.empNavWired = "1";
    btn.addEventListener("click", () => {
      dismissEmpMobileNav();
      state.empFilter = btn.getAttribute("data-emp-filter") || "active";
      state.empView = "dashboard";
      updateEmpNavActiveState();
      renderEmployeeMain();
    });
  });
  document.querySelectorAll(".js-emp-nav-host [data-emp-view]").forEach((btn) => {
    if (btn.dataset.empNavWired === "1") return;
    btn.dataset.empNavWired = "1";
    btn.addEventListener("click", () => {
      dismissEmpMobileNav();
      state.empView = btn.getAttribute("data-emp-view") || "dashboard";
      updateEmpNavActiveState();
      renderEmployeeMain();
    });
  });
}

function wireEmpChromeNav() {
  document.getElementById("empNavOffcanvas")?.addEventListener("click", (e) => {
    const actionable = e.target.closest(
      "[data-emp-filter], [data-emp-view], .js-emp-create-task, .js-open-team-chat"
    );
    if (actionable) dismissEmpMobileNav();
  });
  wireEmpEnablePush();
  document.querySelectorAll(".js-emp-create-task").forEach((b) =>
    b.addEventListener("click", () => void openEmpCreateTaskModal())
  );
  document.querySelectorAll(".js-emp-refresh").forEach((b) =>
    b.addEventListener("click", () => void empRefreshDashboard(b))
  );
  ensureAdminHeaderProfileMenuDocListener();
}

function renderEmployeeAttendanceMain() {
  const main = document.getElementById("emp-main-column");
  if (!main) return;

  main.innerHTML = `
    <div class="admin-main-scroll d-flex flex-column">
      <header class="admin-dash-header">
        ${empMobileNavToggleHtml()}
        <div class="admin-dash-heading">
          <h1 class="admin-dash-title">${escapeHtml(tr("attendance.myAttendance"))}</h1>
          <p class="admin-dash-subtitle">${escapeHtml(tr("attendance.myAttendanceIntro"))}</p>
        </div>
        <div class="admin-dash-utilities">
          ${languageSelectorHtml({ compact: true })}
          ${adminNotificationsBellHtml(state.user?.id, state.user)}
          ${employeeAdminHeaderProfileHtml()}
        </div>
      </header>
      <div class="emp-attendance-page-host">
        ${attendanceCheckInSidebarHtml()}
      </div>
    </div>
  `;

  ensureAdminHeaderProfileMenuDocListener();
  wireAdminHeaderProfileMenu(main);
  wireEmpEnablePush(main);
  wireLanguageSelector(main);
  void refreshAttendanceCheckInCard();
}

function renderEmployeeMain() {
  const main = document.getElementById("emp-main-column");
  if (!main) return;

  if (state.empView === "settings") {
    openEmployeeSettingsView();
    return;
  }

  if (state.empView === "attendance") {
    if (state.user?.attendanceEnabled !== true) {
      state.empView = "dashboard";
      renderEmployeeMain();
      return;
    }
    renderEmployeeAttendanceMain();
    return;
  }

  const isAssignedByMe = state.empFilter === "assigned-by-me";
  const welcomeName = state.user?.displayName ? escapeHtml(dt(state.user.displayName)) : tr("common.employee");

  let kpiRow = "";
  let tableSection = "";

  if (isAssignedByMe) {
    const assignedList = state.empAssignedByMeTasks;
    tableSection = `<section class="owner-task-panel emp-assigned-by-me-panel" aria-label="${tr("employee.tasksAssignedByMe")}">
      ${empAssignedByMeCardsHtml(assignedList)}
    </section>`;
    const assignedMetrics = employeeAssignedByMeMetrics();
    const assignedTotal = Math.max(assignedMetrics.total, 1);
    kpiRow = `<div class="admin-kpi-grid">
      ${employeeKpiCardHtml("active", tr("employee.kpiActive"), "task_alt", employeeDashboardMetrics().active, Math.max(employeeDashboardMetrics().total, 1), state.empFilter === "active" ? " admin-kpi-card--active" : "")}
      ${employeeKpiCardHtml("submitted", tr("employee.kpiSubmitted"), "check_circle", employeeDashboardMetrics().done, Math.max(employeeDashboardMetrics().total, 1), state.empFilter === "submitted" ? " admin-kpi-card--active" : "")}
      ${employeeKpiCardHtml("all", tr("employee.kpiAllAssigned"), "inventory_2", employeeDashboardMetrics().total, Math.max(employeeDashboardMetrics().total, 1), state.empFilter === "all" ? " admin-kpi-card--active" : "")}
      ${employeeKpiCardHtml("assigned-by-me", tr("employee.kpiIAssigned"), "group_add", assignedMetrics.total, assignedTotal, " admin-kpi-card--active")}
    </div>`;
  } else {
    const metrics = employeeDashboardMetrics();
    const assignedMetrics = employeeAssignedByMeMetrics();
    const showOverdueLegend = shouldShowTaskOverdueColorLegend({ empFilter: state.empFilter });
    const baseFiltered = empFilteredTasks();
    let visibleTasks = baseFiltered;
    if (showOverdueLegend) {
      visibleTasks = filterTasksByOverdueColor(baseFiltered, state.overdueColorFilter, empTaskOverdueTier);
    }
    const overdueFilterEmpty =
      showOverdueLegend && state.overdueColorFilter !== "all" && baseFiltered.length > 0 && visibleTasks.length === 0;
    const tableBody = empTaskTableRows(visibleTasks);
    const kpiTotal = Math.max(metrics.total, 1);
    const assignedTotal = Math.max(assignedMetrics.total, 1);
    const activeKpiClass = state.empFilter === "active" ? " admin-kpi-card--active" : "";
    const submittedKpiClass = state.empFilter === "submitted" ? " admin-kpi-card--active" : "";
    const allKpiClass = state.empFilter === "all" ? " admin-kpi-card--active" : "";
    const assignedKpiClass = state.empFilter === "assigned-by-me" ? " admin-kpi-card--active" : "";
    kpiRow = `<div class="admin-kpi-grid">
      ${employeeKpiCardHtml("active", tr("employee.kpiActive"), "task_alt", metrics.active, kpiTotal, activeKpiClass)}
      ${employeeKpiCardHtml("submitted", tr("employee.kpiSubmitted"), "check_circle", metrics.done, kpiTotal, submittedKpiClass)}
      ${employeeKpiCardHtml("all", tr("employee.kpiAllAssigned"), "inventory_2", metrics.total, kpiTotal, allKpiClass)}
      ${employeeKpiCardHtml("assigned-by-me", tr("employee.kpiIAssigned"), "group_add", assignedMetrics.total, assignedTotal, assignedKpiClass)}
    </div>`;
    tableSection = `<section class="owner-task-panel" aria-label="${tr("employee.assignedTasks")}">
      ${showOverdueLegend ? taskOverdueColorLegendHtml() : ""}
      ${
        overdueFilterEmpty
          ? overdueFilterEmptyMessageHtml()
          : `<div class="table-responsive owner-task-table-wrap">
        <table class="table table-hover align-middle mb-0 owner-task-table admin-task-table emp-owner-task-table">
          <thead>
            <tr>
              <th scope="col" class="owner-task-head owner-task-col--task">${tr("common.task")}</th>
              <th scope="col" class="owner-task-head owner-task-col--deadline text-nowrap text-center">${tr("common.dates")}</th>
              <th scope="col" class="owner-task-head">${tr("common.description")}</th>
              <th scope="col" class="owner-task-head text-end" style="width:9rem;">${tr("common.actions")}</th>
            </tr>
          </thead>
          ${tableBody}
        </table>
      </div>`
      }
    </section>`;
  }

  main.innerHTML = `
    <div class="admin-main-scroll d-flex flex-column">
      <header class="admin-dash-header">
        ${empMobileNavToggleHtml()}
        <div class="admin-dash-heading">
          <h1 class="admin-dash-title">${tr("employee.dashboardTitle")}</h1>
          <p class="admin-dash-subtitle">${tr("common.welcome", { name: welcomeName })}</p>
        </div>
        <div class="admin-dash-utilities">
          ${languageSelectorHtml({ compact: true })}
          ${adminNotificationsBellHtml(state.user?.id, state.user)}
          <button type="button" class="admin-icon-btn js-emp-refresh" aria-label="${tr("owner.refreshTasks")}">
            ${adminMsIcon("refresh")}
          </button>
          ${employeeAdminHeaderProfileHtml()}
        </div>
      </header>
      ${kpiRow}
      ${tableSection}
    </div>
  `;

  ensureAdminHeaderProfileMenuDocListener();
  wireAdminHeaderProfileMenu(main);
  wireEmpEnablePush(main);
  wireLanguageSelector(main);

  main.querySelectorAll("[data-emp-filter-kpi]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-emp-filter-kpi");
      if (!filter) return;
      state.empFilter = filter;
      state.empView = "dashboard";
      renderEmpListContentOnly();
      renderEmployeeMain();
    });
  });

  if (isAssignedByMe) {
    main.querySelectorAll(".js-emp-refresh").forEach((btn) => {
      btn.addEventListener("click", () => void empRefreshDashboard(btn));
    });
    main.querySelectorAll(".js-emp-create-task").forEach((btn) => {
      btn.addEventListener("click", () => void openEmpCreateTaskModal());
    });
    main.querySelectorAll(".js-emp-delete-assigned").forEach((btn) => {
      btn.addEventListener("click", () => void deleteEmpAssignedTask(btn));
    });
    return;
  }

  main.querySelectorAll(".js-emp-refresh").forEach((btn) => {
    btn.addEventListener("click", () => void empRefreshDashboard(btn));
  });

  main.querySelectorAll(".js-emp-create-task").forEach((btn) => {
    btn.addEventListener("click", () => void openEmpCreateTaskModal());
  });

  main.querySelectorAll(".emp-open-submit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      const task = state.empTasks.find((t) => t.id === id);
      if (task) openEmpSubmissionModal(task);
    });
  });

  main.querySelectorAll(".emp-open-progress-update").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      const task = state.empTasks.find((t) => t.id === id);
      if (task) void openEmpProgressUpdateModal(task);
    });
  });

  bindEmpDescriptionPopups(main);

  main.querySelectorAll(".emp-view-submission").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-task-id");
      const userId = btn.getAttribute("data-user-id") || state.user?.id;
      if (!taskId || !userId) return;
      const task = state.empTasks.find((t) => t.id === taskId);
      const me = employeeMyAssignee(task);
      const archived =
        btn.getAttribute("data-archived") === "1" ||
        (employeeHasArchivedSubmission(me) && !employeeHasCurrentSubmission(me));
      void openSubmissionDetailForAssignee(taskId, userId, { archived }).catch((err) => {
        showToast(err.message || tr("toast.couldNotLoadSubmission"), "danger");
      });
    });
  });

  bindAssignmentAttachmentViewers(main, (taskId) => state.empTasks.find((t) => t.id === taskId));
  wireOverdueColorFilter(main);
  syncEmployeeOverdueGate();
}

function renderEmployeeChrome() {
  app.innerHTML = `
    <div class="owner-shell admin-mockup-ui emp-shell min-h-main">
      <aside class="admin-fixed-sidebar d-none d-lg-flex">
        ${empLeftNavInner()}
      </aside>
      <div class="offcanvas offcanvas-start admin-mobile-nav" tabindex="-1" id="empNavOffcanvas" aria-labelledby="empNavLabel">
        <div class="offcanvas-header admin-mobile-nav-header border-0">
          <h2 class="offcanvas-title h6 mb-0" id="empNavLabel">Menu</h2>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="${tr("common.close")}"></button>
        </div>
        <div class="offcanvas-body admin-mobile-nav-body pt-0">${empLeftNavInner()}</div>
      </div>
      <div class="admin-main-host">
        <div id="emp-main-column" class="owner-main-panel owner-main-fill d-flex flex-column w-100"></div>
      </div>
      ${submissionDetailModalHtml()}
      ${empSubmissionModalHtml()}
      ${progressUpdateModalHtml()}
      ${empDelegateModalHtml()}
      ${empCreateTaskModalHtml()}
      ${taskDescriptionModalHtml()}
      ${myProfileModalHtml()}
      ${contactUsModalHtml()}
      ${attendanceCheckInReminderModalHtml()}
      ${adminNotifOffcanvasHtml(state.user?.id, state.user)}
      ${legalModalHtml()}
      ${teamChatOffcanvasHtml()}
    </div>`;

  wireEmpChromeNav();
  initAdminSettings({
    api,
    escapeHtml,
    adminMsIcon,
    ownerChromeHeader: ownerSettingsChromeHeaderHtml,
    employeeChromeHeader: employeeSettingsChromeHeaderHtml,
    wireOwnerChromeHeader: wireOwnerReportsChromeHeader,
    wireEmployeeChromeHeader: wireEmployeeSettingsChromeHeader,
    onOpenMyProfile: () => {
      void openMyProfileModal();
    },
    onToggleTheme: toggleAdminTheme,
    getUser: () => state.user,
    showToast,
    kalpanikWebsiteUrl: KALPANIK_WEBSITE_URL,
  });
  initAttendance({
    api,
    showToast,
    onAccessGranted: () => {
      void loadEmployeeDashboard().then(() => renderEmployeeMain());
    },
  });
  initAttendanceCheckIn({ api, showToast });
  initAttendanceCheckInReminder({ api, showToast, performCheck: performAttendanceCheck });
  wireAttendanceCheckInReminder();
  renderEmpListContentOnly();
  wireSubmissionDetailModal();
  wireEmpSubmissionModal();
  wireProgressUpdateModal();
  wireEmpDelegateModal();
  wireEmpCreateTaskModal();
  wireMyProfileModal();
  wireEmployeeProfileModal();
  wireContactUsModal();
  wireLegalModal();
  void wireAttendanceCheckInCard();
  initTeamChat(chatInitDeps());
  renderEmployeeMain();
  syncEmployeeOverdueGate();
  wireAdminNotifications(state.user?.id, document, state.user);
  wireChatNotifyHandlers();
  handleOpenChatDeepLink();
}

async function render() {
  const ok = await refreshMe();
  if (!ok || !state.user) {
    const notify = getEmployeeNotifyParams();
    if (notify) {
      sessionStorage.setItem("taskmgr-pending-notify", JSON.stringify(notify));
      window.history.replaceState({}, "", window.location.pathname);
    }
    const ownerNotify = getOwnerNotifyParams();
    if (ownerNotify) {
      sessionStorage.setItem("taskmgr-pending-owner-notify", JSON.stringify(ownerNotify));
      window.history.replaceState({}, "", window.location.pathname);
    }
    renderAuthForm();
    return;
  }
  if (state.user.role === "employee") {
    const welcome = sessionStorage.getItem("taskmgr-app-welcome");
    if (welcome) {
      sessionStorage.removeItem("taskmgr-app-welcome");
      showToast(tr("toast.welcomeTasksBelow"), "success");
    }
    await loadEmployeeDashboard();
    renderEmployeeChrome();
    const locationOk = await ensureEmployeeLocationAccess(state.user.role);
    if (locationOk) {
      renderEmployeeMain();
      startEmployeeReminderSystem();
      syncEmployeeOverdueGate();
      if (state.user?.attendanceEnabled === true && !isEmployeeOverdueGateActive()) {
        startAttendanceCheckInReminder();
      }
      void prepareEmployeePushOnLogin();
      await handleEmployeeNotifyDeepLink();
    } else {
      const empMain = document.getElementById("emp-main-column");
      if (empMain) {
        empMain.innerHTML = `<div class="admin-main-scroll d-flex flex-column"><p class="text-muted p-4 mb-0">${escapeHtml(tr("attendance.waitingForLocation"))}</p></div>`;
      }
    }
    const pendingNotify = sessionStorage.getItem("taskmgr-pending-notify");
    if (pendingNotify) {
      sessionStorage.removeItem("taskmgr-pending-notify");
      try {
        await focusEmployeeTaskFromNotify(JSON.parse(pendingNotify));
      } catch {
        /* ignore */
      }
    }
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.update();
      });
    }
    maybePromptLegalAnnouncement(state.user);
    return;
  }
  await refreshCompanyTrial();
  await loadLists();
  await loadAssignees();
  // Don't block first paint on translating every task title (can hang on large lists).
  await loadTasks(state.activeListId, { awaitTranslation: false });
  renderOwnerChrome();
  void ensureStateContentTranslations(state);
  maybeShowOwnerTrialMessageModal();
  maybePromptLegalAnnouncement(state.user);
  wireChatNotifyHandlers();
  handleOpenAttendanceDeepLink();
  handleOpenDeadlineExtensionsDeepLink();
  await handleOwnerNotifyDeepLink();
  const pendingOwnerNotify = sessionStorage.getItem("taskmgr-pending-owner-notify");
  if (pendingOwnerNotify) {
    sessionStorage.removeItem("taskmgr-pending-owner-notify");
    try {
      await focusOwnerTaskFromNotify(JSON.parse(pendingOwnerNotify));
    } catch {
      /* ignore */
    }
  }
}

initTheme();
applyPwaBranding();
initPwaSplash();

async function startup() {
  await initI18n();
  wireOwnerDashboardAnnouncementListener();
  initContentTranslate(api);
  onContentTranslationsUpdated(() => {
    rerenderChatTranslatedContent();
    if (!state.user || isOwnerNavBusy()) return;
    if (state.user.role === "owner") {
      updateOwnerSidebarActiveState();
      renderOwnerMain();
    } else if (state.user.role === "employee") {
      updateEmpNavActiveState();
      renderEmployeeMain();
    }
  });
  setLanguageChangeHandler(async () => {
    await ensureStateContentTranslations(state);
    await refreshChatForLanguageChange();
    await render();
    await ensureStateContentTranslations(state);
    if (state.user?.role === "owner") renderOwnerChrome();
    else if (state.user?.role === "employee") {
      renderEmpListContentOnly();
      renderEmployeeMain();
    }
  });
  await render();
  await ensureStateContentTranslations(state);
  notifyAppReady();
}

startup().catch((e) => {
  console.error(e);
  notifyAppReady();
  showToast(String(e.message || e), "danger");
});
