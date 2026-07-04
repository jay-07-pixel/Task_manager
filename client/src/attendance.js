import { tr } from "./i18n/index.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {(() => void) | null} */
let onAccessGrantedFn = null;

let watchId = null;
let pingTimer = null;
let gateEl = null;
/** @type {any} */
let status = null;
let gateMode = "initial";

const PING_INTERVAL_MS = 45_000;
/** Reject Android "Approximate" / coarse location (often 500m–5km+). */
const MAX_ACCEPTABLE_ACCURACY_M = 150;

const PRECISE_GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30_000,
};

const PRECISE_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 25_000,
};

function isPreciseLocation(coords) {
  const acc = coords?.accuracy;
  if (typeof acc !== "number" || Number.isNaN(acc)) return false;
  return acc <= MAX_ACCEPTABLE_ACCURACY_M;
}

function escapeHtml(s) {
  const el = document.createElement("div");
  el.textContent = s;
  return el.innerHTML;
}

export function initAttendance({ api, showToast, onAccessGranted }) {
  apiFn = api;
  showToastFn = showToast;
  onAccessGrantedFn = onAccessGranted ?? null;
  ensureGateElement();
}

function ensureGateElement() {
  if (gateEl) return gateEl;
  gateEl = document.createElement("div");
  gateEl.id = "attendance-location-gate";
  gateEl.className = "attendance-gate d-none";
  gateEl.setAttribute("role", "dialog");
  gateEl.setAttribute("aria-modal", "true");
  gateEl.innerHTML = `<div class="attendance-gate-card">
    <div class="attendance-gate-icon" aria-hidden="true"><span class="material-symbols-outlined">location_on</span></div>
    <h2 class="attendance-gate-title" id="attendance-gate-title"></h2>
    <p class="attendance-gate-message" id="attendance-gate-message"></p>
    <button type="button" class="btn btn-primary attendance-gate-btn" id="attendance-gate-action"></button>
    <p class="attendance-gate-hint" id="attendance-gate-hint"></p>
  </div>`;
  document.body.appendChild(gateEl);
  document.getElementById("attendance-gate-action")?.addEventListener("click", () => {
    void requestLocationAccess();
  });
  return gateEl;
}

function updateGateCopy() {
  const title = document.getElementById("attendance-gate-title");
  const message = document.getElementById("attendance-gate-message");
  const btn = document.getElementById("attendance-gate-action");
  const hint = document.getElementById("attendance-gate-hint");
  if (!title || !message || !btn || !hint) return;
  if (gateMode === "disabled") {
    title.textContent = tr("attendance.gateDisabledTitle");
    message.textContent = tr("attendance.gateDisabledMessage");
    btn.textContent = tr("attendance.turnTrackingOn");
    hint.textContent = tr("attendance.gateDisabledHint");
  } else {
    title.textContent = tr("attendance.gateTitle");
    message.textContent = tr("attendance.gateMessage");
    btn.textContent = tr("attendance.shareLocation");
    hint.textContent = tr("attendance.gateHint");
  }
}

function showGate(mode = "initial") {
  gateMode = mode;
  ensureGateElement();
  updateGateCopy();
  gateEl.classList.remove("d-none");
  document.body.classList.add("attendance-gate-open");
}

function hideGate() {
  gateEl?.classList.add("d-none");
  document.body.classList.remove("attendance-gate-open");
}

export function isAttendanceGateActive() {
  return gateEl && !gateEl.classList.contains("d-none");
}

export async function fetchAttendanceStatus() {
  if (!apiFn) return null;
  status = await apiFn("/api/attendance/status");
  return status;
}

async function sendPing(latitude, longitude, accuracy) {
  if (!apiFn) return;
  await apiFn("/api/attendance/ping", {
    method: "POST",
    body: JSON.stringify({ latitude, longitude, accuracy }),
  });
}

function onPosition(pos) {
  if (!isPreciseLocation(pos.coords)) {
    stopWatching();
    showGate(gateMode === "disabled" ? "disabled" : "initial");
    showToastFn?.(tr("attendance.preciseLocationRequired"), "warning");
    return;
  }
  const { latitude, longitude, accuracy } = pos.coords;
  void sendPing(latitude, longitude, accuracy).catch(() => {});
}

function onPositionError(err) {
  console.warn("[attendance] geolocation error", err);
  if (err.code === 1) {
    void disableTrackingRemote("permission_denied");
    showGate("disabled");
    showToastFn?.(tr("attendance.permissionDenied"), "danger");
  }
}

function startWatching() {
  if (!navigator.geolocation) return;
  stopWatching();
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, PRECISE_WATCH_OPTIONS);
  pingTimer = window.setInterval(() => {
    navigator.geolocation.getCurrentPosition(onPosition, () => {}, PRECISE_WATCH_OPTIONS);
  }, PING_INTERVAL_MS);
}

export function stopAttendanceTracking() {
  stopWatching();
}

function stopWatching() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (pingTimer != null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
}

async function disableTrackingRemote(reason) {
  if (!apiFn) return;
  try {
    await apiFn("/api/attendance/tracking", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
  } catch {
    /* ignore */
  }
  status = { ...(status || {}), trackingEnabled: false, canAccessApp: false };
}

async function requestLocationAccess() {
  if (!navigator.geolocation) {
    showToastFn?.(tr("attendance.notSupported"), "danger");
    return;
  }
  const btn = document.getElementById("attendance-gate-action");
  if (btn) btn.disabled = true;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, PRECISE_GEO_OPTIONS);
    });
    if (!isPreciseLocation(pos.coords)) {
      showToastFn?.(tr("attendance.preciseLocationRequired"), "warning");
      showGate(gateMode);
      return;
    }
    await apiFn("/api/attendance/consent", { method: "POST" });
    await sendPing(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    status = await fetchAttendanceStatus();
    if (status?.canAccessApp) {
      hideGate();
      startWatching();
      onAccessGrantedFn?.();
      showToastFn?.(tr("attendance.trackingStarted"), "success");
    }
  } catch (err) {
    showToastFn?.(tr("attendance.permissionDenied"), "danger");
    showGate(gateMode);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function ensureEmployeeLocationAccess(role) {
  if (role !== "employee") return true;
  await fetchAttendanceStatus();
  // Company-level switch: when admin turns attendance off, location is not mandatory
  if (status?.companyLiveLocationRequired === false) {
    hideGate();
    stopWatching();
    return true;
  }
  if (status?.canAccessApp) {
    hideGate();
    startWatching();
    return true;
  }
  showGate(status?.trackingEnabled === false && status?.consentAt ? "disabled" : "initial");
  stopWatching();
  return false;
}

export function isCompanyLiveLocationRequired() {
  return status?.companyLiveLocationRequired !== false;
}

export async function setLocationTrackingEnabled(enabled) {
  if (!apiFn) return status;
  if (!enabled) {
    const ok = window.confirm(`${tr("attendance.disableConfirmTitle")}\n\n${tr("attendance.disableConfirmMessage")}`);
    if (!ok) return status;
  }
  status = await apiFn("/api/attendance/tracking", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (enabled) {
    if (status?.canAccessApp) {
      hideGate();
      startWatching();
      onAccessGrantedFn?.();
    } else {
      showGate("initial");
      void requestLocationAccess();
    }
  } else {
    stopWatching();
    showGate("disabled");
  }
  return status;
}

export function getAttendanceTrackingEnabled() {
  return !!status?.trackingEnabled && !!status?.canAccessApp;
}

export async function refreshAttendanceSettingsToggle(root) {
  const toggle = root?.querySelector(".js-attendance-tracking-toggle");
  if (!toggle) return;
  await fetchAttendanceStatus();
  if (status?.companyLiveLocationRequired === false) {
    const row = toggle.closest(".admin-settings-row") || toggle.parentElement;
    const hint = root?.querySelector(".js-attendance-employee-hint");
    row?.classList.add("d-none");
    hint?.classList.add("d-none");
    return;
  }
  toggle.checked = !!status?.trackingEnabled;
}

export function attendanceSettingsToggleHtml() {
  return `<div class="admin-settings-row admin-settings-row--toggle">
    <span class="admin-settings-row-left">
      <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
      <span class="admin-settings-row-label">${escapeHtml(tr("attendance.liveLocationTracking"))}</span>
    </span>
    <label class="admin-settings-switch">
      <input type="checkbox" class="admin-settings-switch-input js-attendance-tracking-toggle" aria-label="${escapeHtml(tr("attendance.liveLocationTracking"))}" />
      <span class="admin-settings-switch-track" aria-hidden="true"></span>
    </label>
  </div>
  <p class="admin-settings-hint js-attendance-employee-hint">${escapeHtml(tr("attendance.settingsHint"))}</p>`;
}

export function companyLiveLocationSettingsToggleHtml() {
  return `<div class="admin-settings-row admin-settings-row--toggle">
    <span class="admin-settings-row-left">
      <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
      <span class="admin-settings-row-label">${escapeHtml(tr("attendance.manageLiveLocation"))}</span>
    </span>
    <label class="admin-settings-switch">
      <input type="checkbox" class="admin-settings-switch-input js-company-live-location-toggle" aria-label="${escapeHtml(tr("attendance.manageLiveLocation"))}" />
      <span class="admin-settings-switch-track" aria-hidden="true"></span>
    </label>
  </div>
  <p class="admin-settings-hint">${escapeHtml(tr("attendance.manageLiveLocationHint"))}</p>`;
}

export async function refreshCompanyLiveLocationToggle(root) {
  const toggle = root?.querySelector(".js-company-live-location-toggle");
  if (!toggle || !apiFn) return;
  try {
    const settings = await apiFn("/api/attendance/company-settings");
    toggle.checked = settings?.liveLocationRequired !== false;
  } catch {
    toggle.checked = true;
  }
}

export function wireCompanyLiveLocationToggle(root, { onChanged } = {}) {
  const toggle = root?.querySelector(".js-company-live-location-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  void refreshCompanyLiveLocationToggle(root);
  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    if (!wantOn) {
      const ok = window.confirm(
        `${tr("attendance.companyDisableConfirmTitle")}\n\n${tr("attendance.companyDisableConfirmMessage")}`
      );
      if (!ok) {
        toggle.checked = true;
        return;
      }
    }
    toggle.disabled = true;
    void apiFn("/api/attendance/company-settings", {
      method: "PATCH",
      body: JSON.stringify({ liveLocationRequired: wantOn }),
    })
      .then((settings) => {
        toggle.checked = settings?.liveLocationRequired !== false;
        showToastFn?.(
          wantOn ? tr("attendance.companyEnabledToast") : tr("attendance.companyDisabledToast"),
          "success"
        );
        onChanged?.(toggle.checked);
      })
      .catch((err) => {
        toggle.checked = !wantOn;
        showToastFn?.(err?.message || tr("errors.requestFailed"), "danger");
      })
      .finally(() => {
        toggle.disabled = false;
      });
  });
}

export function wireAttendanceSettingsToggle(root) {
  const toggle = root?.querySelector(".js-attendance-tracking-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  void refreshAttendanceSettingsToggle(root);
  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    void setLocationTrackingEnabled(wantOn).then((next) => {
      toggle.checked = !!next?.trackingEnabled;
    });
  });
}
