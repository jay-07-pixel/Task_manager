import * as bootstrap from "bootstrap";
import { tr } from "./i18n/index.js";
import {
  companyAttendanceEnabledToggleHtml,
  wireCompanyAttendanceEnabledToggle,
} from "./attendance.js";

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

/** @type {((enabled: boolean) => void) | null} */
let onCompanyAttendanceChangedFn = null;

/** @type {string | null} */
let editingLocationId = null;

export function initManageLocations({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  wireOwnerChromeHeader,
  showToast,
  onCompanyAttendanceChanged,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
  showToastFn = showToast ?? null;
  onCompanyAttendanceChangedFn = onCompanyAttendanceChanged ?? null;
}

export function manageLocationModalHtml() {
  return `
    <div class="modal fade profile-modal" id="manageLocationModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered profile-modal-dialog">
        <div class="modal-content profile-modal-card">
          <form id="manage-location-form" class="profile-modal-form">
            <div class="modal-header profile-modal-header">
              <h2 class="modal-title h5 mb-0" id="manageLocationModalTitle">${tr("attendance.addLocation")}</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr("common.close")}"></button>
            </div>
            <div class="modal-body profile-modal-body">
              <div class="mb-3">
                <label class="form-label" for="work-location-name">${tr("attendance.locationName")}</label>
                <input type="text" class="form-control" id="work-location-name" maxlength="120" required />
              </div>
              <div class="mb-3">
                <label class="form-label" for="work-location-latitude">${tr("attendance.latitude")}</label>
                <input type="number" class="form-control" id="work-location-latitude" step="any" min="-90" max="90" required />
              </div>
              <div class="mb-3">
                <label class="form-label" for="work-location-longitude">${tr("attendance.longitude")}</label>
                <input type="number" class="form-control" id="work-location-longitude" step="any" min="-180" max="180" required />
              </div>
              <div class="mb-3">
                <label class="form-label" for="work-location-coordinates">${tr("attendance.coordinates")}</label>
                <input type="text" class="form-control bg-body-secondary" id="work-location-coordinates" readonly disabled />
                <p class="small text-muted mb-0 mt-1">${tr("attendance.coordinatesHint")}</p>
              </div>
              <div class="mb-0">
                <label class="form-label" for="work-location-radius">${tr("attendance.radiusMeters")}</label>
                <input type="number" class="form-control" id="work-location-radius" min="10" max="5000" step="1" value="100" required />
              </div>
            </div>
            <div class="modal-footer profile-modal-footer">
              <button type="button" class="profile-modal-btn-cancel" data-bs-dismiss="modal">${tr("common.cancel")}</button>
              <button type="submit" class="profile-modal-btn-save">${tr("common.save")}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function syncCoordinatesField() {
  const lat = document.getElementById("work-location-latitude")?.value;
  const lng = document.getElementById("work-location-longitude")?.value;
  const coords = document.getElementById("work-location-coordinates");
  if (!coords) return;
  if (lat && lng) coords.value = `${lat}, ${lng}`;
  else coords.value = "";
}

function openLocationModal(location = null) {
  editingLocationId = location?.id ?? null;
  document.getElementById("manageLocationModalTitle").textContent = location
    ? tr("attendance.editLocation")
    : tr("attendance.addLocation");
  document.getElementById("work-location-name").value = location?.name ?? "";
  document.getElementById("work-location-latitude").value = location?.latitude ?? "";
  document.getElementById("work-location-longitude").value = location?.longitude ?? "";
  document.getElementById("work-location-radius").value = String(location?.radiusMeters ?? 100);
  syncCoordinatesField();
  const modalEl = document.getElementById("manageLocationModal");
  if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function locationRowHtml(loc) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const inactive = loc.isActive === false;
  return `<article class="manage-location-row${inactive ? " is-inactive" : ""}">
    <span class="manage-location-pin">${adminMsIconFn?.("location_on") ?? ""}</span>
    <span class="manage-location-copy">
      <span class="manage-location-name">${esc(loc.name)}</span>
      ${inactive ? `<span class="manage-location-off">${esc(tr("attendance.attendanceToggleOff"))}</span>` : ""}
      <span class="manage-location-meta">${esc(loc.coordinates)}</span>
      <span class="manage-location-radius">${esc(tr("attendance.radiusShort", { meters: loc.radiusMeters }))}</span>
    </span>
    <span class="manage-location-ring" aria-hidden="true"><span>${esc(String(loc.radiusMeters))}m</span></span>
    <span class="manage-location-actions">
      <button type="button" class="manage-location-edit-btn" data-location-id="${esc(loc.id)}">${adminMsIconFn?.("edit") ?? ""}${esc(tr("common.edit"))}</button>
      <button type="button" class="manage-location-delete-btn" data-location-id="${esc(loc.id)}">${adminMsIconFn?.("delete") ?? ""}${esc(tr("common.delete"))}</button>
    </span>
  </article>`;
}

function setLocationsCount(count) {
  const el = document.querySelector("[data-locations-count]");
  if (!el || count == null) return;
  el.textContent = tr("attendance.locationsCount", { count: String(count) });
}

async function renderLocationsList() {
  const host = document.querySelector(".manage-locations-list");
  if (!host || !apiFn) return;
  host.innerHTML = `<p class="manage-locations-empty mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>`;
  try {
    const { locations } = await apiFn("/api/attendance/work-locations");
    setLocationsCount(locations.length);
    if (!locations.length) {
      host.innerHTML = `<p class="manage-locations-empty mb-0">${escapeHtmlFn?.(tr("attendance.noLocations")) ?? ""}</p>`;
      return;
    }
    host.innerHTML = locations.map((loc) => locationRowHtml(loc)).join("");
    host.querySelectorAll(".manage-location-edit-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-location-id");
        const loc = locations.find((l) => l.id === id);
        if (loc) openLocationModal(loc);
      });
    });
    host.querySelectorAll(".manage-location-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-location-id");
        if (id) void deleteLocation(id);
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="manage-locations-empty text-danger mb-0">${escapeHtmlFn?.(err.message) ?? err.message}</p>`;
  }
}

async function deleteLocation(id) {
  if (!apiFn || !window.confirm(tr("attendance.deleteLocationConfirm"))) return;
  try {
    await apiFn(`/api/attendance/work-locations/${id}`, { method: "DELETE" });
    showToastFn?.(tr("attendance.locationDeleted"), "success");
    void renderLocationsList();
  } catch (err) {
    showToastFn?.(err.message || tr("errors.requestFailed"), "danger");
  }
}

async function saveLocation(e) {
  e.preventDefault();
  if (!apiFn) return;
  const name = document.getElementById("work-location-name")?.value?.trim();
  const latitude = Number.parseFloat(document.getElementById("work-location-latitude")?.value ?? "");
  const longitude = Number.parseFloat(document.getElementById("work-location-longitude")?.value ?? "");
  const radiusMeters = Number.parseInt(document.getElementById("work-location-radius")?.value ?? "", 10);
  if (!name) return;

  const body = { name, latitude, longitude, radiusMeters, isActive: true };
  try {
    if (editingLocationId) {
      await apiFn(`/api/attendance/work-locations/${editingLocationId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await apiFn("/api/attendance/work-locations", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    bootstrap.Modal.getInstance(document.getElementById("manageLocationModal"))?.hide();
    showToastFn?.(tr("attendance.locationSaved"), "success");
    void renderLocationsList();
  } catch (err) {
    showToastFn?.(err.message || tr("errors.requestFailed"), "danger");
  }
}

function manageLocationsPageHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<div class="admin-main-scroll d-flex flex-column">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="manage-locations-page">
      <header class="manage-loc-head">
        <span class="manage-loc-icon">${adminMsIconFn?.("location_on") ?? ""}</span>
        <div class="manage-loc-head-copy">
          <h2 class="manage-loc-title">${esc(tr("attendance.manageLocations"))}</h2>
          <p class="manage-loc-sub">${esc(tr("attendance.manageLocationsIntro"))}</p>
        </div>
        <button type="button" class="manage-loc-add" id="manage-locations-add-btn">${adminMsIconFn?.("add") ?? ""}${esc(tr("attendance.addLocation"))}</button>
      </header>
      <section class="manage-loc-card manage-locations-attendance-card">
        <nav class="manage-locations-attendance-toggle" aria-label="${esc(tr("attendance.manageAttendance"))}">
          ${companyAttendanceEnabledToggleHtml()}
        </nav>
        <span class="manage-loc-state" data-attendance-state></span>
        <p class="manage-loc-live" data-live-location-status></p>
      </section>
      <section class="manage-loc-card manage-locations-schedule">
        <h3 class="manage-loc-card-title">${esc(tr("attendance.dailyScheduleTitle"))}</h3>
        <p class="manage-loc-sub">${esc(tr("attendance.dailyScheduleIntro"))}</p>
        <form id="manage-locations-schedule-form" class="manage-locations-schedule-form">
          <div class="manage-loc-fields">
            <label class="manage-loc-field" for="daily-check-in-time">
              <span>${esc(tr("attendance.dailyCheckInTime"))}</span>
              <input type="time" id="daily-check-in-time" step="60" />
            </label>
            <label class="manage-loc-field" for="daily-check-out-time">
              <span>${esc(tr("attendance.dailyCheckOutTime"))}</span>
              <input type="time" id="daily-check-out-time" step="60" />
            </label>
            <label class="manage-loc-field" for="attendance-start-date">
              <span>${esc(tr("attendance.attendanceStartDate"))}</span>
              <input type="date" id="attendance-start-date" />
              <small>${esc(tr("attendance.attendanceStartDateHint"))}</small>
            </label>
          </div>
          <div class="manage-loc-save-row">
            <button type="submit" class="manage-loc-save">${adminMsIconFn?.("check") ?? ""}${esc(tr("attendance.saveSchedule"))}</button>
          </div>
        </form>
      </section>
      <section class="manage-loc-card">
        <header class="manage-loc-list-head">
          <h3 class="manage-loc-card-title">${esc(tr("attendance.locationsHeading"))}</h3>
          <span class="manage-loc-count" data-locations-count></span>
        </header>
        <div class="manage-locations-list"></div>
      </section>
    </div>
  </div>`;
}

async function loadDailyScheduleForm() {
  if (!apiFn) return;
  try {
    const schedule = await apiFn("/api/attendance/daily-schedule");
    const checkInEl = document.getElementById("daily-check-in-time");
    const checkOutEl = document.getElementById("daily-check-out-time");
    const startDateEl = document.getElementById("attendance-start-date");
    if (checkInEl) checkInEl.value = schedule.checkInTime ?? "";
    if (checkOutEl) checkOutEl.value = schedule.checkOutTime ?? "";
    if (startDateEl) startDateEl.value = schedule.attendanceStartDate ?? "";
  } catch {
    /* ignore */
  }
}

async function saveDailySchedule(e) {
  e.preventDefault();
  if (!apiFn) return;
  const checkInTime = document.getElementById("daily-check-in-time")?.value?.trim() || null;
  const checkOutTime = document.getElementById("daily-check-out-time")?.value?.trim() || null;
  const attendanceStartDate =
    document.getElementById("attendance-start-date")?.value?.trim() || null;
  try {
    await apiFn("/api/attendance/daily-schedule", {
      method: "PATCH",
      body: JSON.stringify({ checkInTime, checkOutTime, attendanceStartDate }),
    });
    showToastFn?.(tr("attendance.scheduleSaved"), "success");
  } catch (err) {
    showToastFn?.(err.message || tr("errors.requestFailed"), "danger");
  }
}

function wireDailyScheduleForm() {
  const form = document.getElementById("manage-locations-schedule-form");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";
  form.addEventListener("submit", (e) => {
    void saveDailySchedule(e);
  });
}

export function wireManageLocationModal() {
  const form = document.getElementById("manage-location-form");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";
  form.addEventListener("submit", (e) => {
    void saveLocation(e);
  });
  document.getElementById("work-location-latitude")?.addEventListener("input", syncCoordinatesField);
  document.getElementById("work-location-longitude")?.addEventListener("input", syncCoordinatesField);
  document.getElementById("manageLocationModal")?.addEventListener("hidden.bs.modal", () => {
    editingLocationId = null;
  });
}

export function openOwnerManageLocationsView() {
  const main = document.getElementById("main-column");
  if (!main) return;
  main.innerHTML = manageLocationsPageHtml();
  wireOwnerChromeHeaderFn?.(main);
  wireCompanyAttendanceEnabledToggle(main, {
    api: apiFn,
    showToast: showToastFn,
    onChanged: (enabled) => onCompanyAttendanceChangedFn?.(enabled),
  });
  wireDailyScheduleForm();
  wireAttendanceState(main);
  document.getElementById("manage-locations-add-btn")?.addEventListener("click", () => openLocationModal());
  void loadDailyScheduleForm();
  void loadLiveLocationStatus();
  void renderLocationsList();
}

function syncAttendanceState(root) {
  const input = root.querySelector(".js-company-attendance-toggle");
  const pill = root.querySelector("[data-attendance-state]");
  if (!input || !pill) return;
  const on = input.checked;
  pill.textContent = tr(on ? "attendance.attendanceToggleOn" : "attendance.attendanceToggleOff");
  pill.classList.toggle("is-on", on);
}

function wireAttendanceState(root) {
  const input = root.querySelector(".js-company-attendance-toggle");
  const label = root.querySelector(".manage-locations-attendance-card .admin-settings-row-label");
  const pill = root.querySelector("[data-attendance-state]");
  if (label && pill) label.append(pill);
  if (!input) return;
  input.addEventListener("change", () => syncAttendanceState(root));
  syncAttendanceState(root);
  setTimeout(() => syncAttendanceState(root), 400);
  setTimeout(() => syncAttendanceState(root), 1200);
}

async function loadLiveLocationStatus() {
  const el = document.querySelector("[data-live-location-status]");
  if (!el || !apiFn) return;
  try {
    const settings = await apiFn("/api/attendance/company-settings");
    const on = settings?.liveLocationRequired !== false;
    el.textContent = tr("attendance.liveLocationState", {
      state: tr(on ? "attendance.attendanceToggleOn" : "attendance.attendanceToggleOff"),
    });
    el.classList.toggle("is-on", on);
  } catch {
    el.textContent = "";
  }
}
