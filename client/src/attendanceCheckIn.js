import { tr, dateLocale } from "./i18n/index.js";
import { notifyAttendanceCheckCompleted } from "./attendanceCheckInReminder.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {any} */
let checkStatus = null;

/** @type {any[] | null} */
let historyRows = null;

let actionsWired = false;

export function initAttendanceCheckIn({ api, showToast }) {
  apiFn = api;
  showToastFn = showToast;
}

async function getPosition() {
  if (!navigator.geolocation) throw new Error(tr("attendance.notSupported"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 25_000,
    });
  });
}

async function refreshCheckStatus(latitude, longitude) {
  if (!apiFn) return null;
  const qs =
    latitude != null && longitude != null
      ? `?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
      : "";
  checkStatus = await apiFn(`/api/attendance/check-status${qs}`);
  return checkStatus;
}

async function refreshHistory() {
  if (!apiFn) return [];
  try {
    const data = await apiFn("/api/attendance/my-history?days=14");
    historyRows = data.history ?? [];
  } catch {
    historyRows = [];
  }
  return historyRows;
}

function timingLabel(status) {
  if (status === "late") return tr("attendance.timingLate");
  if (status === "early") return tr("attendance.timingEarly");
  if (status === "on_time") return tr("attendance.timingOnTime");
  return "";
}

function timingClass(status) {
  if (status === "late") return "text-danger fw-semibold";
  if (status === "early") return "text-warning fw-semibold";
  if (status === "on_time") return "text-success";
  return "";
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function formatHistoryDate(dateStr) {
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(dateLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function historyItemHtml(row) {
  if (!row.present) {
    return `<li class="attendance-history-item attendance-history-item--absent">
      <span class="attendance-history-date">${formatHistoryDate(row.date)}</span>
      <span class="attendance-history-absent">${tr("attendance.absentBadge")}</span>
    </li>`;
  }
  const inTiming = row.checkIn?.timingStatus;
  const outTiming = row.checkOut?.timingStatus;
  const checkInLine = row.checkIn
    ? `${formatTime(row.checkIn.recordedAt)}${inTiming && inTiming !== "on_time" ? ` · ${timingLabel(inTiming)}` : ""}`
    : "—";
  const checkOutLine = row.checkOut
    ? `${formatTime(row.checkOut.recordedAt)}${outTiming && outTiming !== "on_time" ? ` · ${timingLabel(outTiming)}` : ""}`
    : "—";
  return `<li class="attendance-history-item">
    <span class="attendance-history-date">${formatHistoryDate(row.date)}</span>
    <span class="attendance-history-line"><span>${tr("attendance.checkIn")}</span> ${checkInLine}</span>
    <span class="attendance-history-line"><span>${tr("attendance.checkOut")}</span> ${checkOutLine}</span>
  </li>`;
}

function renderHistoryLists() {
  const html =
    historyRows?.length
      ? `<ul class="attendance-history-list">${historyRows.map((row) => historyItemHtml(row)).join("")}</ul>`
      : `<p class="attendance-history-empty small text-muted mb-0">${tr("attendance.historyEmpty")}</p>`;
  document.querySelectorAll(".attendance-history-host").forEach((host) => {
    host.innerHTML = html;
  });
}

export function attendanceCheckInSidebarHtml() {
  return `<section class="attendance-checkin-sidebar" aria-label="${tr("attendance.dailyCheckInTitle")}">
    <div class="attendance-checkin-sidebar-today">
      <div class="attendance-checkin-card-head">
        <h2 class="attendance-checkin-card-title">${tr("attendance.todayStatusTitle")}</h2>
        <span class="attendance-checkin-status-badge d-none js-attendance-status-badge"></span>
      </div>
      <p class="attendance-checkin-message small text-muted mb-2 js-attendance-message">${tr("attendance.checkInLoading")}</p>
      <p class="attendance-checkin-proximity small mb-2 d-none js-attendance-proximity"></p>
      <div class="attendance-checkin-times small mb-2 d-none js-attendance-times"></div>
      <div class="attendance-checkin-actions">
        <button type="button" class="profile-modal-btn-save js-attendance-checkin-btn">${tr("attendance.checkIn")}</button>
        <button type="button" class="profile-modal-btn-cancel d-none js-attendance-checkout-btn">${tr("attendance.checkOut")}</button>
      </div>
    </div>
    <div class="attendance-checkin-sidebar-history">
      <h3 class="attendance-history-title">${tr("attendance.historyTitle")}</h3>
      <div class="attendance-history-host">
        <p class="attendance-history-empty small text-muted mb-0">${tr("common.loading")}</p>
      </div>
    </div>
  </section>`;
}

/** @deprecated Use attendanceCheckInSidebarHtml — kept for imports during transition */
export const attendanceCheckInCardHtml = attendanceCheckInSidebarHtml;

function renderCheckInPanel(panel) {
  if (!panel || !checkStatus) return;

  const messageEl = panel.querySelector(".js-attendance-message");
  const proximityEl = panel.querySelector(".js-attendance-proximity");
  const timesEl = panel.querySelector(".js-attendance-times");
  const badgeEl = panel.querySelector(".js-attendance-status-badge");
  const checkInBtn = panel.querySelector(".js-attendance-checkin-btn");
  const checkOutBtn = panel.querySelector(".js-attendance-checkout-btn");
  if (!messageEl) return;

  if (!checkStatus.locationsCount) {
    messageEl.textContent = tr("attendance.noLocationsEmployee");
    proximityEl?.classList.add("d-none");
    timesEl?.classList.add("d-none");
    checkInBtn?.classList.add("d-none");
    checkOutBtn?.classList.add("d-none");
    badgeEl?.classList.add("d-none");
    return;
  }

  checkInBtn?.classList.toggle("d-none", !checkStatus.canCheckIn);
  checkOutBtn?.classList.toggle("d-none", !checkStatus.canCheckOut);
  badgeEl?.classList.remove("d-none");

  if (checkStatus.dayComplete) {
    badgeEl.textContent = tr("attendance.presentBadge");
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--in js-attendance-status-badge";
    messageEl.textContent = tr("attendance.dayCompleteMessage");
  } else if (checkStatus.isCheckedIn) {
    badgeEl.textContent = tr("attendance.checkedInBadge");
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--in js-attendance-status-badge";
    messageEl.textContent = tr("attendance.checkedInMessage");
  } else {
    badgeEl.textContent = tr("attendance.notCheckedInBadge");
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--out js-attendance-status-badge";
    messageEl.textContent = tr("attendance.notCheckedInMessage");
  }

  const showProximity = checkStatus.canCheckIn || checkStatus.canCheckOut;
  const prox = checkStatus.proximity?.nearest;
  if (showProximity && prox && proximityEl) {
    proximityEl.classList.remove("d-none");
    if (prox.withinRadius) {
      proximityEl.textContent = tr("attendance.withinRadius", {
        name: prox.locationName,
        meters: prox.distanceMeters,
      });
      proximityEl.className = "attendance-checkin-proximity small mb-2 text-success js-attendance-proximity";
    } else {
      proximityEl.textContent = tr("attendance.outsideRadius", {
        name: prox.locationName,
        meters: prox.distanceMeters,
      });
      proximityEl.className = "attendance-checkin-proximity small mb-2 text-danger js-attendance-proximity";
    }
  } else {
    proximityEl?.classList.add("d-none");
  }

  if (timesEl && (checkStatus.lastCheckIn || checkStatus.lastCheckOut)) {
    timesEl.classList.remove("d-none");
    const checkInTiming = checkStatus.lastCheckIn?.timingStatus;
    const checkOutTiming = checkStatus.lastCheckOut?.timingStatus;
    timesEl.innerHTML = [
      checkStatus.lastCheckIn
        ? `<div>${tr("attendance.todayCheckIn")}: <strong>${formatTime(checkStatus.lastCheckIn.recordedAt)}</strong>${checkInTiming && checkInTiming !== "on_time" ? ` · <span class="${timingClass(checkInTiming)}">${timingLabel(checkInTiming)}</span>` : ""}</div>`
        : "",
      checkStatus.lastCheckOut
        ? `<div>${tr("attendance.todayCheckOut")}: <strong>${formatTime(checkStatus.lastCheckOut.recordedAt)}</strong>${checkOutTiming && checkOutTiming !== "on_time" ? ` · <span class="${timingClass(checkOutTiming)}">${timingLabel(checkOutTiming)}</span>` : ""}</div>`
        : "",
    ]
      .filter(Boolean)
      .join("");
  } else {
    timesEl?.classList.add("d-none");
  }
}

function renderCheckInCard() {
  document.querySelectorAll(".attendance-checkin-sidebar").forEach((panel) => {
    renderCheckInPanel(panel);
  });
  renderHistoryLists();
}

function setActionButtonsDisabled(disabled) {
  document.querySelectorAll(".js-attendance-checkin-btn, .js-attendance-checkout-btn").forEach((btn) => {
    btn.disabled = disabled;
  });
}

/** @param {"check_in" | "check_out"} type @returns {Promise<boolean>} */
export async function performAttendanceCheck(type) {
  if (!apiFn) return false;
  setActionButtonsDisabled(true);
  try {
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    const endpoint = type === "check_in" ? "/api/attendance/check-in" : "/api/attendance/check-out";
    const result = await apiFn(endpoint, {
      method: "POST",
      body: JSON.stringify({ latitude, longitude }),
    });
    checkStatus = result.status;
    await refreshHistory();
    renderCheckInCard();
    notifyAttendanceCheckCompleted(type);
    const timing = result.check?.timingStatus;
    let toastMsg =
      type === "check_in" ? tr("attendance.checkInSuccess") : tr("attendance.checkOutSuccess");
    if (timing === "late") toastMsg = tr("attendance.checkInLateToast");
    else if (timing === "early") toastMsg = tr("attendance.checkOutEarlyToast");
    showToastFn?.(toastMsg, timing === "late" ? "warning" : timing === "early" ? "warning" : "success");
    return true;
  } catch (err) {
    showToastFn?.(err.message || tr("errors.requestFailed"), "danger");
    try {
      const pos = await getPosition();
      await refreshCheckStatus(pos.coords.latitude, pos.coords.longitude);
      renderCheckInCard();
    } catch {
      await refreshCheckStatus();
      renderCheckInCard();
    }
    return false;
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function loadAttendanceSidebarData() {
  try {
    const pos = await getPosition();
    await refreshCheckStatus(pos.coords.latitude, pos.coords.longitude);
  } catch {
    await refreshCheckStatus();
  }
  await refreshHistory();
  renderCheckInCard();
}

export async function wireAttendanceCheckInCard() {
  if (!actionsWired) {
    actionsWired = true;
    document.addEventListener("click", (e) => {
      if (e.target.closest(".js-attendance-checkin-btn")) {
        void performAttendanceCheck("check_in");
      } else if (e.target.closest(".js-attendance-checkout-btn")) {
        void performAttendanceCheck("check_out");
      }
    });
  }
  if (!document.querySelector(".attendance-checkin-sidebar")) return;
  await loadAttendanceSidebarData();
}

export async function refreshAttendanceCheckInCard() {
  if (!document.querySelector(".attendance-checkin-sidebar")) return;
  await loadAttendanceSidebarData();
}
