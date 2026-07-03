import { tr, dateLocale } from "./i18n/index.js";

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

/** @type {any} */
let liveData = null;

/** @type {string | null} */
let selectedEmployeeId = null;

/** @type {any} */
let mapInstance = null;

/** @type {Record<string, any>} */
let markers = {};

/** @type {number | null} */
let pollTimer = null;

const POLL_MS = 20_000;

export function initAdminAttendance({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  wireOwnerChromeHeader,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
}

export function ownerAttendanceNavItemHtml(active = false) {
  return `<button type="button" class="admin-sidebar-nav-item js-owner-attendance-nav${active ? " admin-sidebar-nav-item--active" : ""}">
    <span class="admin-nav-item-left">
      ${adminMsIconFn?.("location_on") ?? ""}
      <span>${escapeHtmlFn?.(tr("attendance.navLabel")) ?? "Attendance"}</span>
    </span>
  </button>`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(dateLocale(), { dateStyle: "medium", timeStyle: "short" });
}

async function loadLeaflet() {
  if (window.L) return window.L;
  await new Promise((resolve, reject) => {
    if (document.querySelector('link[data-leaflet-css="1"]')) {
      resolve(undefined);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.dataset.leafletCss = "1";
    document.head.appendChild(link);
    link.onload = () => resolve(undefined);
    link.onerror = reject;
  });
  if (window.L) return window.L;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.L;
}

function destroyMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  markers = {};
}

function ensureMap() {
  const host = document.getElementById("admin-attendance-map");
  if (!host || !window.L) return;
  if (mapInstance) {
    if (mapInstance.getContainer() !== host) {
      destroyMap();
    } else {
      return;
    }
  }
  mapInstance = window.L.map(host, { zoomControl: true }).setView([20.5937, 78.9629], 5);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(mapInstance);
}

function updateMapMarkers(employees) {
  if (!mapInstance || !window.L) return;
  const bounds = [];
  for (const emp of employees) {
    const ping = emp.lastPing;
    if (!ping || emp.isOff) {
      if (markers[emp.id]) {
        mapInstance.removeLayer(markers[emp.id]);
        delete markers[emp.id];
      }
      continue;
    }
    const latlng = [ping.latitude, ping.longitude];
    bounds.push(latlng);
    const label = escapeHtmlFn?.(emp.displayName) ?? emp.displayName;
    const time = formatDateTime(ping.recordedAt);
    const popup = `<strong>${label}</strong><br>${time}${ping.stale ? `<br><em>${escapeHtmlFn?.(tr("attendance.staleLocation")) ?? "Stale"}</em>` : ""}`;
    if (markers[emp.id]) {
      markers[emp.id].setLatLng(latlng).setPopupContent(popup);
    } else {
      markers[emp.id] = window.L.marker(latlng).addTo(mapInstance).bindPopup(popup);
    }
  }
  if (bounds.length === 1) {
    mapInstance.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
}

function employeeRowHtml(emp) {
  const active = emp.id === selectedEmployeeId ? " admin-attendance-emp--active" : "";
  const statusClass = emp.isOff ? "admin-attendance-status--off" : "admin-attendance-status--on";
  const statusLabel = emp.isOff ? tr("attendance.statusOff") : tr("attendance.statusLive");
  const last = emp.lastPing ? formatDateTime(emp.lastPing.recordedAt) : tr("attendance.noLocationYet");
  return `<button type="button" class="admin-attendance-emp${active}" data-employee-id="${escapeHtmlFn?.(emp.id) ?? emp.id}">
    <span class="admin-attendance-emp-name">${escapeHtmlFn?.(emp.displayName) ?? emp.displayName}</span>
    <span class="admin-attendance-status ${statusClass}">${escapeHtmlFn?.(statusLabel) ?? statusLabel}</span>
    <span class="admin-attendance-emp-meta">${escapeHtmlFn?.(last) ?? last}</span>
  </button>`;
}

function offPeriodRowHtml(p) {
  const duration = formatDuration(p.durationMs);
  return `<tr>
    <td>${escapeHtmlFn?.(formatDateTime(p.startedAt)) ?? ""}</td>
    <td>${escapeHtmlFn?.(p.endedAt ? formatDateTime(p.endedAt) : tr("attendance.stillOff")) ?? ""}</td>
    <td class="tabular-nums">${escapeHtmlFn?.(duration) ?? duration}</td>
  </tr>`;
}

function renderDetailPanel(history) {
  const panel = document.getElementById("admin-attendance-detail");
  if (!panel) return;
  if (!history) {
    panel.innerHTML = `<p class="text-muted small mb-0">${escapeHtmlFn?.(tr("attendance.selectEmployee")) ?? ""}</p>`;
    return;
  }
  const rows = (history.offPeriods ?? []).map(offPeriodRowHtml).join("");
  panel.innerHTML = `
    <h3 class="admin-attendance-detail-title">${escapeHtmlFn?.(history.employee.displayName) ?? ""}</h3>
    <p class="admin-attendance-detail-sub">${escapeHtmlFn?.(tr("attendance.offPeriodsTitle")) ?? ""}</p>
    <div class="table-responsive">
      <table class="table table-sm admin-attendance-off-table">
        <thead><tr>
          <th>${escapeHtmlFn?.(tr("attendance.offFrom")) ?? ""}</th>
          <th>${escapeHtmlFn?.(tr("attendance.offUntil")) ?? ""}</th>
          <th>${escapeHtmlFn?.(tr("attendance.duration")) ?? ""}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="3" class="text-muted">${escapeHtmlFn?.(tr("attendance.noOffPeriods")) ?? ""}</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderAttendancePage() {
  const main = document.getElementById("main-column");
  if (!main) return;
  const employees = liveData?.employees ?? [];
  if (!selectedEmployeeId && employees.length) {
    selectedEmployeeId = employees.find((e) => e.trackingOn && e.lastPing)?.id ?? employees[0].id;
  }
  main.innerHTML = `<div class="admin-main-scroll d-flex flex-column">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="admin-attendance-page">
      <p class="admin-attendance-intro">${escapeHtmlFn?.(tr("attendance.adminIntro")) ?? ""}</p>
      <div class="admin-attendance-layout">
        <aside class="admin-attendance-sidebar" id="admin-attendance-emp-list">
          ${employees.length ? employees.map(employeeRowHtml).join("") : `<p class="text-muted small">${escapeHtmlFn?.(tr("attendance.noEmployees")) ?? ""}</p>`}
        </aside>
        <div class="admin-attendance-main">
          <div id="admin-attendance-map" class="admin-attendance-map" aria-label="${escapeHtmlFn?.(tr("attendance.liveMap")) ?? ""}"></div>
          <div id="admin-attendance-detail" class="admin-attendance-detail"></div>
        </div>
      </div>
    </div>
  </div>`;
  wireOwnerChromeHeaderFn?.(main);
  main.querySelectorAll("[data-employee-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedEmployeeId = btn.getAttribute("data-employee-id");
      void refreshAdminAttendance({ keepSelection: true });
    });
  });
}

async function loadEmployeeHistory(userId) {
  if (!apiFn || !userId) return null;
  return apiFn(`/api/attendance/employees/${userId}/history`);
}

export async function refreshAdminAttendance({ keepSelection = false } = {}) {
  if (!apiFn) return;
  const data = await apiFn("/api/attendance/live");
  liveData = data;
  if (!keepSelection) selectedEmployeeId = null;
  renderAttendancePage();
  await loadLeaflet();
  ensureMap();
  updateMapMarkers(data.employees ?? []);
  setTimeout(() => mapInstance?.invalidateSize(), 100);
  if (selectedEmployeeId) {
    const history = await loadEmployeeHistory(selectedEmployeeId);
    renderDetailPanel(history);
    const emp = (data.employees ?? []).find((e) => e.id === selectedEmployeeId);
    if (emp?.lastPing && mapInstance) {
      mapInstance.setView([emp.lastPing.latitude, emp.lastPing.longitude], 16);
      markers[emp.id]?.openPopup();
    }
  } else {
    renderDetailPanel(null);
  }
}

export function openOwnerAttendanceView() {
  destroyMap();
  stopAttendancePoll();
  void refreshAdminAttendance().then(() => startAttendancePoll());
}

export function stopAttendancePoll() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startAttendancePoll() {
  stopAttendancePoll();
  pollTimer = window.setInterval(() => {
    if (!document.querySelector(".admin-attendance-page")) {
      stopAttendancePoll();
      return;
    }
    void refreshAdminAttendance({ keepSelection: true });
  }, POLL_MS);
}

export function destroyAdminAttendance() {
  stopAttendancePoll();
  destroyMap();
}

export function ownerAttendanceChromeHeaderHtml() {
  return `<header class="admin-dash-header">
    <div>
      <p class="admin-dash-eyebrow">${tr("nav.adminDashboard")}</p>
      <h1 class="admin-dash-title">${tr("attendance.title")}</h1>
    </div>
  </header>`;
}
