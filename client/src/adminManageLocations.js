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
  return `<div class="admin-settings-row manage-location-row">
    <span class="manage-location-row-left">
      ${adminMsIconFn?.("location_on") ?? ""}
      <span class="admin-settings-row-label">
        <span class="manage-location-name">${esc(loc.name)}</span>
        <span class="manage-location-meta">${esc(loc.coordinates)} · ${esc(tr("attendance.radiusShort", { meters: loc.radiusMeters }))}</span>
      </span>
    </span>
    <span class="manage-location-actions">
      <button type="button" class="btn btn-sm btn-outline-primary manage-location-edit-btn" data-location-id="${esc(loc.id)}">${esc(tr("common.edit"))}</button>
      <button type="button" class="btn btn-sm btn-outline-danger manage-location-delete-btn" data-location-id="${esc(loc.id)}">${esc(tr("common.delete"))}</button>
    </span>
  </div>`;
}

async function renderLocationsList() {
  const host = document.querySelector(".manage-locations-list");
  if (!host || !apiFn) return;
  host.innerHTML = `<p class="admin-settings-intro mb-0">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>`;
  try {
    const { locations } = await apiFn("/api/attendance/work-locations");
    if (!locations.length) {
      host.innerHTML = `<p class="admin-settings-intro mb-0">${escapeHtmlFn?.(tr("attendance.noLocations")) ?? ""}</p>`;
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
    host.innerHTML = `<p class="admin-settings-intro text-danger mb-0">${escapeHtmlFn?.(err.message) ?? err.message}</p>`;
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
    <div class="admin-settings-page manage-locations-page">
      <p class="admin-settings-intro">${esc(tr("attendance.manageLocationsIntro"))}</p>
      <section class="card border-0 shadow-sm mb-4 manage-locations-attendance-card">
        <div class="card-body py-3">
          <nav class="admin-settings-list manage-locations-attendance-toggle" aria-label="${esc(tr("attendance.manageAttendance"))}">
            ${companyAttendanceEnabledToggleHtml()}
          </nav>
        </div>
      </section>
      <section class="manage-locations-schedule card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h3 class="h6 mb-1">${esc(tr("attendance.dailyScheduleTitle"))}</h3>
          <p class="small text-muted mb-3">${esc(tr("attendance.dailyScheduleIntro"))}</p>
          <form id="manage-locations-schedule-form" class="manage-locations-schedule-form">
            <div class="row g-3 align-items-end">
              <div class="col-sm-6 col-md-4">
                <label class="form-label" for="daily-check-in-time">${esc(tr("attendance.dailyCheckInTime"))}</label>
                <input type="time" class="form-control" id="daily-check-in-time" step="60" />
              </div>
              <div class="col-sm-6 col-md-4">
                <label class="form-label" for="daily-check-out-time">${esc(tr("attendance.dailyCheckOutTime"))}</label>
                <input type="time" class="form-control" id="daily-check-out-time" step="60" />
              </div>
              <div class="col-sm-6 col-md-4">
                <label class="form-label" for="attendance-start-date">${esc(tr("attendance.attendanceStartDate"))}</label>
                <input type="date" class="form-control" id="attendance-start-date" />
                <p class="form-text small text-muted mb-0 mt-1">${esc(tr("attendance.attendanceStartDateHint"))}</p>
              </div>
              <div class="col-sm-12 col-md-4">
                <button type="submit" class="profile-modal-btn-save w-100">${esc(tr("attendance.saveSchedule"))}</button>
              </div>
            </div>
          </form>
        </div>
      </section>
      <div class="manage-locations-toolbar mb-3">
        <button type="button" class="profile-modal-btn-save" id="manage-locations-add-btn">${esc(tr("attendance.addLocation"))}</button>
      </div>
      <div class="admin-settings-list manage-locations-list"></div>
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
  document.getElementById("manage-locations-add-btn")?.addEventListener("click", () => openLocationModal());
  void loadDailyScheduleForm();
  void renderLocationsList();
}
