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
/** Phones: reject Approximate / very coarse GPS. */
const MAX_MOBILE_ACCURACY_M = 150;
/**
 * Laptops/desktops usually only get Wi‑Fi/IP location (often 500m–several km).
 * Allow that so employees can open tasks on PC after granting permission.
 */
const MAX_DESKTOP_ACCURACY_M = 25_000;

const PRECISE_GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30_000,
};

const NETWORK_GEO_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 20_000,
};

const PRECISE_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 15_000,
  timeout: 25_000,
};

/** @type {PermissionStatus | null} */
let geoPermissionStatus = null;

function isLikelyMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  try {
    if (navigator.maxTouchPoints > 1 && window.matchMedia?.("(pointer: coarse)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function maxAcceptableAccuracyM() {
  return isLikelyMobileDevice() ? MAX_MOBILE_ACCURACY_M : MAX_DESKTOP_ACCURACY_M;
}

function isAcceptableLocation(coords) {
  const acc = coords?.accuracy;
  // Some desktop browsers omit accuracy — still accept a valid fix
  if (typeof acc !== "number" || Number.isNaN(acc)) {
    return typeof coords?.latitude === "number" && typeof coords?.longitude === "number";
  }
  return acc <= maxAcceptableAccuracyM();
}

function getCurrentPositionAsync(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getBestPosition() {
  try {
    const pos = await getCurrentPositionAsync(PRECISE_GEO_OPTIONS);
    if (isAcceptableLocation(pos.coords)) return pos;
    // High-accuracy fix too coarse (common on laptop) — try network location
    if (!isLikelyMobileDevice()) {
      const networkPos = await getCurrentPositionAsync(NETWORK_GEO_OPTIONS);
      if (isAcceptableLocation(networkPos.coords)) return networkPos;
      // Prefer the more accurate of the two even if both are coarse
      const a = pos.coords.accuracy ?? Infinity;
      const b = networkPos.coords.accuracy ?? Infinity;
      return a <= b ? pos : networkPos;
    }
    return pos;
  } catch (err) {
    // Permission granted but GPS timed out — fall back to network on desktop
    if (!isLikelyMobileDevice()) {
      return getCurrentPositionAsync(NETWORK_GEO_OPTIONS);
    }
    throw err;
  }
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
  // Skip coarse pings on mobile; on desktop accept Wi‑Fi fixes and keep watching
  if (!isAcceptableLocation(pos.coords)) {
    if (isLikelyMobileDevice()) {
      console.warn("[attendance] skipping coarse mobile fix", pos.coords.accuracy);
    }
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
    const pos = await getBestPosition();
    if (!isAcceptableLocation(pos.coords)) {
      showToastFn?.(
        isLikelyMobileDevice()
          ? tr("attendance.preciseLocationRequired")
          : tr("attendance.desktopLocationWeak"),
        "warning"
      );
      showGate(gateMode);
      return;
    }
    await apiFn("/api/attendance/consent", { method: "POST" });
    await sendPing(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
    status = await fetchAttendanceStatus();
    if (status?.canAccessApp) {
      hideGate();
      startWatching();
      onAccessGrantedFn?.();
      showToastFn?.(tr("attendance.trackingStarted"), "success");
    } else {
      // Consent saved but status incomplete — still try watching
      hideGate();
      startWatching();
      onAccessGrantedFn?.();
      showToastFn?.(tr("attendance.trackingStarted"), "success");
    }
  } catch (err) {
    const denied = err?.code === 1 || /denied/i.test(String(err?.message || ""));
    showToastFn?.(
      denied ? tr("attendance.permissionDeniedLaptop") : tr("attendance.locationUnavailable"),
      "danger"
    );
    showGate(gateMode);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireGeolocationPermissionAutoRetry() {
  if (!navigator.permissions?.query || geoPermissionStatus) return;
  void navigator.permissions
    .query({ name: "geolocation" })
    .then((perm) => {
      geoPermissionStatus = perm;
      perm.addEventListener("change", () => {
        if (perm.state !== "granted") return;
        if (!isAttendanceGateActive()) return;
        void requestLocationAccess();
      });
    })
    .catch(() => {
      /* Permissions API not available for geolocation in some browsers */
    });
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
  wireGeolocationPermissionAutoRetry();

  // Permission already granted (e.g. laptop Allow) but tracking off in DB — auto resume
  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: "geolocation" });
      if (perm.state === "granted") {
        await requestLocationAccess();
        if (status?.canAccessApp || !isAttendanceGateActive()) return true;
      }
    }
  } catch {
    /* ignore */
  }
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
      <input type="checkbox" class="admin-settings-switch-input js-company-live-location-toggle" checked aria-label="${escapeHtml(tr("attendance.manageLiveLocation"))}" />
      <span class="admin-settings-switch-track" aria-hidden="true"></span>
    </label>
  </div>
  <p class="admin-settings-hint">${escapeHtml(tr("attendance.manageLiveLocationHint"))}</p>`;
}

export function companyAttendanceEnabledToggleHtml() {
  return `<div class="admin-settings-row admin-settings-row--toggle">
    <span class="admin-settings-row-left">
      <span class="material-symbols-outlined" aria-hidden="true">how_to_reg</span>
      <span class="admin-settings-row-label">${escapeHtml(tr("attendance.manageAttendance"))}</span>
    </span>
    <label class="admin-settings-switch">
      <input type="checkbox" class="admin-settings-switch-input js-company-attendance-toggle" checked aria-label="${escapeHtml(tr("attendance.manageAttendance"))}" />
      <span class="admin-settings-switch-track" aria-hidden="true"></span>
    </label>
  </div>
  <p class="admin-settings-hint js-company-attendance-hint">${escapeHtml(tr("attendance.manageAttendanceHint"))}</p>`;
}

export async function refreshCompanyLiveLocationToggle(root, api = apiFn) {
  const toggle = root?.querySelector(".js-company-live-location-toggle");
  if (!toggle) return;
  // Default ON until server says otherwise
  toggle.checked = true;
  if (!api) return;
  try {
    const settings = await api("/api/attendance/company-settings");
    toggle.checked = settings?.liveLocationRequired !== false;
  } catch {
    toggle.checked = true;
  }
}

export async function refreshCompanyAttendanceEnabledToggle(root, api = apiFn) {
  const toggle = root?.querySelector(".js-company-attendance-toggle");
  if (!toggle) return;
  toggle.checked = true;
  if (!api) return;
  try {
    const settings = await api("/api/attendance/company-settings");
    toggle.checked = settings?.attendanceEnabled !== false;
  } catch {
    toggle.checked = true;
  }
}

export function wireCompanyLiveLocationToggle(root, { onChanged, api, showToast } = {}) {
  const request = api || apiFn;
  const toast = showToast || showToastFn;
  const toggle = root?.querySelector(".js-company-live-location-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  void refreshCompanyLiveLocationToggle(root, request);
  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    if (!request) {
      toggle.checked = !wantOn;
      toast?.(tr("errors.requestFailed"), "danger");
      return;
    }
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
    void request("/api/attendance/company-settings", {
      method: "PATCH",
      body: JSON.stringify({ liveLocationRequired: wantOn }),
    })
      .then((settings) => {
        toggle.checked = settings?.liveLocationRequired !== false;
        toast?.(
          wantOn ? tr("attendance.companyEnabledToast") : tr("attendance.companyDisabledToast"),
          "success"
        );
        onChanged?.(toggle.checked);
      })
      .catch((err) => {
        toggle.checked = !wantOn;
        toast?.(err?.message || tr("errors.requestFailed"), "danger");
      })
      .finally(() => {
        toggle.disabled = false;
      });
  });
}

export function wireCompanyAttendanceEnabledToggle(root, { onChanged, api, showToast } = {}) {
  const request = api || apiFn;
  const toast = showToast || showToastFn;
  const toggle = root?.querySelector(".js-company-attendance-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  void refreshCompanyAttendanceEnabledToggle(root, request);
  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    if (!request) {
      toggle.checked = !wantOn;
      toast?.(tr("errors.requestFailed"), "danger");
      return;
    }
    if (!wantOn) {
      const ok = window.confirm(
        `${tr("attendance.attendanceDisableConfirmTitle")}\n\n${tr("attendance.attendanceDisableConfirmMessage")}`
      );
      if (!ok) {
        toggle.checked = true;
        return;
      }
    }
    toggle.disabled = true;
    void request("/api/attendance/company-settings", {
      method: "PATCH",
      body: JSON.stringify({ attendanceEnabled: wantOn }),
    })
      .then((settings) => {
        toggle.checked = settings?.attendanceEnabled !== false;
        toast?.(
          wantOn ? tr("attendance.attendanceEnabledToast") : tr("attendance.attendanceDisabledToast"),
          "success"
        );
        onChanged?.(toggle.checked);
      })
      .catch((err) => {
        toggle.checked = !wantOn;
        toast?.(err?.message || tr("errors.requestFailed"), "danger");
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
