import { tr } from "./i18n/index.js";
import { notifyAttendanceCheckCompleted } from "./attendanceCheckInReminder.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {any} */
let checkStatus = null;

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

export function attendanceCheckInCardHtml() {
  return `<section class="attendance-checkin-card" id="attendance-checkin-card" aria-label="${tr("attendance.dailyCheckInTitle")}">
    <div class="attendance-checkin-card-head">
      <h2 class="attendance-checkin-card-title">${tr("attendance.dailyCheckInTitle")}</h2>
      <span class="attendance-checkin-status-badge d-none" id="attendance-checkin-status-badge"></span>
    </div>
    <p class="attendance-checkin-message small text-muted mb-2" id="attendance-checkin-message">${tr("attendance.checkInLoading")}</p>
    <p class="attendance-checkin-proximity small mb-3 d-none" id="attendance-checkin-proximity"></p>
    <div class="attendance-checkin-times small mb-3 d-none" id="attendance-checkin-times"></div>
    <div class="attendance-checkin-actions">
      <button type="button" class="profile-modal-btn-save" id="attendance-checkin-btn">${tr("attendance.checkIn")}</button>
      <button type="button" class="profile-modal-btn-cancel d-none" id="attendance-checkout-btn">${tr("attendance.checkOut")}</button>
    </div>
  </section>`;
}

function renderCheckInCard() {
  const messageEl = document.getElementById("attendance-checkin-message");
  const proximityEl = document.getElementById("attendance-checkin-proximity");
  const timesEl = document.getElementById("attendance-checkin-times");
  const badgeEl = document.getElementById("attendance-checkin-status-badge");
  const checkInBtn = document.getElementById("attendance-checkin-btn");
  const checkOutBtn = document.getElementById("attendance-checkout-btn");
  if (!messageEl || !checkStatus) return;

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
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--in";
    messageEl.textContent = tr("attendance.dayCompleteMessage");
  } else if (checkStatus.isCheckedIn) {
    badgeEl.textContent = tr("attendance.checkedInBadge");
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--in";
    messageEl.textContent = tr("attendance.checkedInMessage");
  } else {
    badgeEl.textContent = tr("attendance.notCheckedInBadge");
    badgeEl.className = "attendance-checkin-status-badge attendance-checkin-status-badge--out";
    messageEl.textContent = tr("attendance.notCheckedInMessage");
  }

  const showProximity = checkStatus.canCheckIn || checkStatus.canCheckOut;
  const prox = checkStatus.proximity?.nearest;
  if (showProximity && prox) {
    proximityEl.classList.remove("d-none");
    if (prox.withinRadius) {
      proximityEl.textContent = tr("attendance.withinRadius", {
        name: prox.locationName,
        meters: prox.distanceMeters,
      });
      proximityEl.className = "attendance-checkin-proximity small mb-3 text-success";
    } else {
      proximityEl.textContent = tr("attendance.outsideRadius", {
        name: prox.locationName,
        meters: prox.distanceMeters,
      });
      proximityEl.className = "attendance-checkin-proximity small mb-3 text-danger";
    }
  } else {
    proximityEl?.classList.add("d-none");
  }

  if (checkStatus.lastCheckIn || checkStatus.lastCheckOut) {
    timesEl.classList.remove("d-none");
    const checkInTiming = checkStatus.lastCheckIn?.timingStatus;
    const checkOutTiming = checkStatus.lastCheckOut?.timingStatus;
    timesEl.innerHTML = [
      checkStatus.lastCheckIn
        ? `<div>${tr("attendance.todayCheckIn")}: <strong>${formatTime(checkStatus.lastCheckIn.recordedAt)}</strong> · ${checkStatus.lastCheckIn.locationName ?? ""}${checkInTiming && checkInTiming !== "on_time" ? ` · <span class="${timingClass(checkInTiming)}">${timingLabel(checkInTiming)}</span>` : ""}</div>`
        : "",
      checkStatus.lastCheckOut
        ? `<div>${tr("attendance.todayCheckOut")}: <strong>${formatTime(checkStatus.lastCheckOut.recordedAt)}</strong> · ${checkStatus.lastCheckOut.locationName ?? ""}${checkOutTiming && checkOutTiming !== "on_time" ? ` · <span class="${timingClass(checkOutTiming)}">${timingLabel(checkOutTiming)}</span>` : ""}</div>`
        : "",
    ]
      .filter(Boolean)
      .join("");
  } else {
    timesEl?.classList.add("d-none");
  }
}

/** @param {"check_in" | "check_out"} type @returns {Promise<boolean>} */
export async function performAttendanceCheck(type) {
  if (!apiFn) return false;
  const btn = document.getElementById(type === "check_in" ? "attendance-checkin-btn" : "attendance-checkout-btn");
  if (btn) btn.disabled = true;
  try {
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    const endpoint = type === "check_in" ? "/api/attendance/check-in" : "/api/attendance/check-out";
    const result = await apiFn(endpoint, {
      method: "POST",
      body: JSON.stringify({ latitude, longitude }),
    });
    checkStatus = result.status;
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
    if (btn) btn.disabled = false;
  }
}

async function performCheck(type) {
  await performAttendanceCheck(type);
}

export async function wireAttendanceCheckInCard() {
  const card = document.getElementById("attendance-checkin-card");
  if (!card || card.dataset.wired === "1") return;
  card.dataset.wired = "1";

  document.getElementById("attendance-checkin-btn")?.addEventListener("click", () => {
    void performCheck("check_in");
  });
  document.getElementById("attendance-checkout-btn")?.addEventListener("click", () => {
    void performCheck("check_out");
  });

  try {
    const pos = await getPosition();
    await refreshCheckStatus(pos.coords.latitude, pos.coords.longitude);
  } catch {
    await refreshCheckStatus();
  }
  renderCheckInCard();
}

export async function refreshAttendanceCheckInCard() {
  if (!document.getElementById("attendance-checkin-card")) return;
  try {
    const pos = await getPosition();
    await refreshCheckStatus(pos.coords.latitude, pos.coords.longitude);
  } catch {
    await refreshCheckStatus();
  }
  renderCheckInCard();
}
