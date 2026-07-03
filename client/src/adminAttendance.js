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

/** @type {(() => void) | null} */
let visibilityHandler = null;

const POLL_MS = 5_000;

/** @type {Map<string, string | null>} */
const placeNameCache = new Map();

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
  mapInstance = window.L.map(host, {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([20.5937, 78.9629], 5);
  window.L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(mapInstance);
}

function employeeMarkerIcon(emp) {
  const initial = (emp.displayName || "?").trim().charAt(0).toUpperCase() || "?";
  const live = emp.trackingOn && !emp.isOff;
  return window.L.divIcon({
    className: "admin-attendance-marker-host",
    html: `<div class="admin-attendance-marker ${live ? "admin-attendance-marker--live" : "admin-attendance-marker--off"}"><span>${escapeHtmlFn?.(initial) ?? initial}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -42],
  });
}

async function resolvePlaceName(lat, lng) {
  if (!apiFn || typeof lat !== "number" || typeof lng !== "number") return null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (placeNameCache.has(key)) return placeNameCache.get(key);
  try {
    const data = await apiFn(`/api/attendance/geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    const label =
      data?.area && data?.city && data.area !== data.city
        ? `${data.area}, ${data.city}`
        : data?.placeName ?? null;
    placeNameCache.set(key, label);
    return label;
  } catch {
    placeNameCache.set(key, null);
    return null;
  }
}

async function buildMarkerPopup(emp, ping) {
  const label = escapeHtmlFn?.(emp.displayName) ?? emp.displayName;
  const time = formatDateTime(ping.recordedAt);
  const place = await resolvePlaceName(ping.latitude, ping.longitude);
  const placeLine = place
    ? `<br><span class="admin-attendance-popup-place">${escapeHtmlFn?.(place) ?? place}</span>`
    : "";
  const staleLine = ping.stale
    ? `<br><em>${escapeHtmlFn?.(tr("attendance.staleLocation")) ?? "Stale"}</em>`
    : "";
  return `<strong>${label}</strong><br>${time}${placeLine}${staleLine}`;
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
    if (markers[emp.id]) {
      markers[emp.id].setLatLng(latlng);
      void buildMarkerPopup(emp, ping).then((popup) => {
        markers[emp.id]?.setPopupContent(popup);
      });
    } else {
      const marker = window.L.marker(latlng, { icon: employeeMarkerIcon(emp) })
        .addTo(mapInstance)
        .bindPopup(tr("attendance.loadingLocation"));
      markers[emp.id] = marker;
      void buildMarkerPopup(emp, ping).then((popup) => {
        marker.setPopupContent(popup);
      });
    }
  }
  if (bounds.length === 1) {
    mapInstance.setView(bounds[0], 16);
  } else if (bounds.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }
}

function employeeMetaHtml(emp) {
  if (emp.isOff && emp.offSince) {
    return tr("attendance.turnedOffAt", { time: formatDateTime(emp.offSince) });
  }
  if (emp.trackingOn && emp.lastPing) {
    if (emp.trackingResumedAt) {
      return tr("attendance.turnedBackOnAt", { time: formatDateTime(emp.trackingResumedAt) });
    }
    return tr("attendance.liveAt", { time: formatDateTime(emp.lastPing.recordedAt) });
  }
  return tr("attendance.noLocationYet");
}

function employeeRowHtml(emp) {
  const active = emp.id === selectedEmployeeId ? " admin-attendance-emp--active" : "";
  const statusClass = emp.isOff ? "admin-attendance-status--off" : "admin-attendance-status--on";
  const statusLabel = emp.isOff ? tr("attendance.statusOff") : tr("attendance.statusLive");
  const meta = employeeMetaHtml(emp);
  return `<button type="button" class="admin-attendance-emp${active}" data-employee-id="${escapeHtmlFn?.(emp.id) ?? emp.id}">
    <span class="admin-attendance-emp-name">${escapeHtmlFn?.(emp.displayName) ?? emp.displayName}</span>
    <span class="admin-attendance-status ${statusClass}">${escapeHtmlFn?.(statusLabel) ?? statusLabel}</span>
    <span class="admin-attendance-emp-meta">${escapeHtmlFn?.(meta) ?? meta}</span>
  </button>`;
}

function placeNameHtml(location) {
  if (!location) {
    return `<span class="text-muted">${escapeHtmlFn?.(tr("attendance.locationUnknown")) ?? ""}</span>`;
  }
  if (location.area && location.city && location.area !== location.city) {
    return `<span class="admin-attendance-area">${escapeHtmlFn?.(location.area) ?? location.area}</span>
      <span class="admin-attendance-city">${escapeHtmlFn?.(location.city) ?? location.city}</span>`;
  }
  if (location.placeName) {
    return `<span class="admin-attendance-place">${escapeHtmlFn?.(location.placeName) ?? location.placeName}</span>`;
  }
  return `<span class="text-muted">${escapeHtmlFn?.(tr("attendance.locationUnknown")) ?? ""}</span>`;
}

function locationCellHtml(isoTime, location) {
  const when = isoTime ? formatDateTime(isoTime) : tr("attendance.stillOff");
  return `<div class="admin-attendance-when">${escapeHtmlFn?.(when) ?? when}</div>
    <div class="admin-attendance-where">${placeNameHtml(location)}</div>`;
}

function offPeriodRowHtml(p) {
  const duration = formatDuration(p.durationMs);
  const backOnCell = p.endedAt
    ? locationCellHtml(p.endedAt, p.onLocation)
    : `<div class="admin-attendance-when text-muted">${escapeHtmlFn?.(tr("attendance.stillOff")) ?? ""}</div>`;
  return `<tr>
    <td>${locationCellHtml(p.startedAt, p.offLocation)}</td>
    <td>${backOnCell}</td>
    <td class="tabular-nums">${escapeHtmlFn?.(duration) ?? duration}</td>
  </tr>`;
}

function currentStatusBannerHtml(emp) {
  if (!emp) return "";
  const statusClass = emp.isOff ? "admin-attendance-live-status--off" : "admin-attendance-live-status--on";
  const label = emp.isOff ? tr("attendance.statusOff") : tr("attendance.statusLive");
  const detail = employeeMetaHtml(emp);
  return `<div class="admin-attendance-live-status ${statusClass}" role="status">
    <span class="admin-attendance-live-status-label">${escapeHtmlFn?.(label) ?? label}</span>
    <span class="admin-attendance-live-status-detail">${escapeHtmlFn?.(detail) ?? detail}</span>
  </div>`;
}

function renderDetailPanel(history, liveEmp = null) {
  const panel = document.getElementById("admin-attendance-detail");
  if (!panel) return;
  if (!history) {
    panel.innerHTML = `<p class="text-muted small mb-0">${escapeHtmlFn?.(tr("attendance.selectEmployee")) ?? ""}</p>`;
    return;
  }
  const rows = (history.offPeriods ?? []).map(offPeriodRowHtml).join("");
  const banner = currentStatusBannerHtml(liveEmp);
  panel.innerHTML = `
    <h3 class="admin-attendance-detail-title">${escapeHtmlFn?.(history.employee.displayName) ?? ""}</h3>
    ${banner}
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

function wireEmployeeListHandlers(root) {
  root?.querySelectorAll("[data-employee-id]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      selectedEmployeeId = btn.getAttribute("data-employee-id");
      void refreshAdminAttendance({ keepSelection: true });
    });
  });
}

function updateAttendanceDomInPlace(data) {
  const employees = data.employees ?? [];
  const listHost = document.getElementById("admin-attendance-emp-list");
  if (listHost) {
    listHost.innerHTML = employees.length
      ? employees.map(employeeRowHtml).join("")
      : `<p class="text-muted small">${escapeHtmlFn?.(tr("attendance.noEmployees")) ?? ""}</p>`;
    wireEmployeeListHandlers(listHost);
  }
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
          <div class="admin-attendance-map-wrap">
            <div id="admin-attendance-map" class="admin-attendance-map" aria-label="${escapeHtmlFn?.(tr("attendance.liveMap")) ?? ""}"></div>
            <div class="admin-attendance-map-legend">
              <span class="admin-attendance-legend-item admin-attendance-legend-item--live">${escapeHtmlFn?.(tr("attendance.statusLive")) ?? ""}</span>
              <span class="admin-attendance-legend-item admin-attendance-legend-item--off">${escapeHtmlFn?.(tr("attendance.statusOff")) ?? ""}</span>
            </div>
          </div>
          <div id="admin-attendance-detail" class="admin-attendance-detail"></div>
        </div>
      </div>
    </div>
  </div>`;
  wireOwnerChromeHeaderFn?.(main);
  wireEmployeeListHandlers(main);
}

async function refreshDetailForSelection(employees) {
  if (!selectedEmployeeId) {
    renderDetailPanel(null);
    return;
  }
  const history = await loadEmployeeHistory(selectedEmployeeId);
  const liveEmp = (employees ?? []).find((e) => e.id === selectedEmployeeId) ?? null;
  renderDetailPanel(history, liveEmp);
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

  const pageExists = document.querySelector(".admin-attendance-page");
  if (pageExists && keepSelection) {
    updateAttendanceDomInPlace(data);
    await loadLeaflet();
    ensureMap();
    updateMapMarkers(data.employees ?? []);
    await refreshDetailForSelection(data.employees ?? []);
    return;
  }

  renderAttendancePage();
  await loadLeaflet();
  ensureMap();
  updateMapMarkers(data.employees ?? []);
  setTimeout(() => mapInstance?.invalidateSize(), 100);
  if (selectedEmployeeId) {
    await refreshDetailForSelection(data.employees ?? []);
    const emp = (data.employees ?? []).find((e) => e.id === selectedEmployeeId);
    if (emp?.lastPing && mapInstance && !emp.isOff) {
      mapInstance.setView([emp.lastPing.latitude, emp.lastPing.longitude], 16);
      markers[emp.id]?.openPopup();
    }
  } else {
    renderDetailPanel(null);
  }
}

/** @param {{ type?: string, employeeName?: string }} [detail] */
export function handleAttendanceLiveEvent(detail) {
  if (!document.querySelector(".admin-attendance-page")) return;
  void refreshAdminAttendance({ keepSelection: true });
  return detail;
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
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
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

  visibilityHandler = () => {
    if (document.visibilityState !== "visible") return;
    if (!document.querySelector(".admin-attendance-page")) return;
    void refreshAdminAttendance({ keepSelection: true });
  };
  document.addEventListener("visibilitychange", visibilityHandler);
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
