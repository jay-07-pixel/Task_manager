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

/** @type {"google" | "leaflet" | null} */
let mapProvider = null;

/** @type {string | null} */
let googleMapsApiKey = null;

/** @type {Record<string, any>} */
let markers = {};

/** @type {any} */
let infoWindow = null;

/** @type {number | null} */
let pollTimer = null;

/** @type {"live" | "daily" | "report"} */
let attendanceViewTab = "live";

/** @type {string | null} */
let dailyReportDate = null;

/** @type {string | null} */
let monthlyReportMonth = null;

/** @type {(() => void) | null} */
let visibilityHandler = null;

const POLL_MS = 5_000;

/** @type {Map<string, any>} */
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
  const activeClass = active ? " admin-sidebar-nav-item--active" : "";
  const label = tr("attendance.navLabel");
  return `<button type="button" class="admin-sidebar-nav-item js-owner-attendance-nav${activeClass}">
    <span class="admin-nav-item-left">
      <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
      <span>${escapeHtmlFn?.(label) ?? label}</span>
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

async function loadMapsConfig() {
  if (!apiFn) return { provider: "leaflet", apiKey: null };
  if (mapProvider) return { provider: mapProvider, apiKey: googleMapsApiKey };
  try {
    const cfg = await apiFn("/api/attendance/maps-config");
    googleMapsApiKey = cfg?.apiKey || null;
    mapProvider = googleMapsApiKey ? "google" : "leaflet";
  } catch {
    mapProvider = "leaflet";
    googleMapsApiKey = null;
  }
  return { provider: mapProvider, apiKey: googleMapsApiKey };
}

async function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return window.google.maps;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(undefined));
      existing.addEventListener("error", reject);
      if (window.google?.maps) resolve(undefined);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "1";
    script.onload = () => resolve(undefined);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.google.maps;
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

async function ensureMapLibrary() {
  const cfg = await loadMapsConfig();
  if (cfg.provider === "google" && cfg.apiKey) {
    try {
      await loadGoogleMaps(cfg.apiKey);
      mapProvider = "google";
      return "google";
    } catch (err) {
      console.warn("[attendance] Google Maps failed, falling back to Leaflet", err);
      mapProvider = "leaflet";
    }
  }
  await loadLeaflet();
  mapProvider = "leaflet";
  return "leaflet";
}

function destroyMap() {
  if (mapProvider === "google" && mapInstance) {
    for (const id of Object.keys(markers)) {
      markers[id].setMap(null);
    }
    mapInstance = null;
  } else if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  markers = {};
  infoWindow = null;
}

function ensureMap() {
  const host = document.getElementById("admin-attendance-map");
  if (!host) return;

  if (mapProvider === "google" && window.google?.maps) {
    if (mapInstance && host.dataset.mapReady === "1") return;
    destroyMap();
    mapInstance = new window.google.maps.Map(host, {
      center: { lat: 20.5937, lng: 78.9629 },
      zoom: 5,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      clickableIcons: false,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "simplified" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });
    infoWindow = new window.google.maps.InfoWindow();
    host.dataset.mapReady = "1";
    return;
  }

  if (!window.L) return;
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
  host.dataset.mapReady = "1";
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

function googleMarkerIcon(emp) {
  const live = emp.trackingOn && !emp.isOff;
  const color = live ? "#0d7a3a" : "#b42318";
  const initial = (emp.displayName || "?").trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M20 2C11.7 2 5 8.7 5 17c0 11.2 15 29 15 29s15-17.8 15-29C35 8.7 28.3 2 20 2z"/>
    <circle cx="20" cy="17" r="8" fill="#fff"/>
    <text x="20" y="21" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="${color}">${initial}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(40, 48),
    anchor: new window.google.maps.Point(20, 48),
  };
}

async function resolvePlaceDetails(lat, lng) {
  if (!apiFn || typeof lat !== "number" || typeof lng !== "number") return null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (placeNameCache.has(key)) return placeNameCache.get(key);
  try {
    const data = await apiFn(`/api/attendance/geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    const details = {
      area: data?.area ?? null,
      city: data?.city ?? null,
      placeName:
        data?.area && data?.city && data.area !== data.city
          ? `${data.area}, ${data.city}`
          : data?.placeName ?? null,
    };
    placeNameCache.set(key, details);
    return details;
  } catch {
    placeNameCache.set(key, null);
    return null;
  }
}

async function resolvePlaceName(lat, lng) {
  const details = await resolvePlaceDetails(lat, lng);
  return details?.placeName ?? null;
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
  return `<div class="admin-attendance-popup"><strong>${label}</strong><br>${time}${placeLine}${staleLine}</div>`;
}

function updateMapMarkers(employees, { fitAll = false } = {}) {
  if (!mapInstance) return;

  if (mapProvider === "google" && window.google?.maps) {
    const bounds = new window.google.maps.LatLngBounds();
    let count = 0;
    const presentIds = new Set();
    for (const emp of employees) {
      const ping = emp.lastPing;
      if (!ping) {
        if (markers[emp.id]) {
          markers[emp.id].setMap(null);
          delete markers[emp.id];
        }
        continue;
      }
      presentIds.add(emp.id);
      const position = { lat: ping.latitude, lng: ping.longitude };
      bounds.extend(position);
      count += 1;
      if (markers[emp.id]) {
        markers[emp.id].setPosition(position);
        markers[emp.id].setIcon(googleMarkerIcon(emp));
        markers[emp.id]._emp = emp;
        markers[emp.id]._ping = ping;
      } else {
        const marker = new window.google.maps.Marker({
          map: mapInstance,
          position,
          icon: googleMarkerIcon(emp),
          title: emp.displayName,
        });
        marker._emp = emp;
        marker._ping = ping;
        marker.addListener("click", () => {
          void selectEmployeeOnMap(emp.id, { fromMarker: true });
        });
        markers[emp.id] = marker;
      }
      void buildMarkerPopup(emp, ping).then((html) => {
        if (markers[emp.id]) markers[emp.id]._popupHtml = html;
      });
    }
    for (const id of Object.keys(markers)) {
      if (!presentIds.has(id)) {
        markers[id].setMap(null);
        delete markers[id];
      }
    }
    if (fitAll) {
      if (count === 1) {
        mapInstance.setCenter(bounds.getCenter());
        mapInstance.setZoom(17);
      } else if (count > 1) {
        mapInstance.fitBounds(bounds, 48);
      }
    }
    return;
  }

  if (!window.L) return;
  const bounds = [];
  const presentIds = new Set();
  for (const emp of employees) {
    const ping = emp.lastPing;
    if (!ping) {
      if (markers[emp.id]) {
        mapInstance.removeLayer(markers[emp.id]);
        delete markers[emp.id];
      }
      continue;
    }
    presentIds.add(emp.id);
    const latlng = [ping.latitude, ping.longitude];
    bounds.push(latlng);
    if (markers[emp.id]) {
      markers[emp.id].setLatLng(latlng);
      markers[emp.id].setIcon(employeeMarkerIcon(emp));
      markers[emp.id]._emp = emp;
      markers[emp.id]._ping = ping;
      void buildMarkerPopup(emp, ping).then((popup) => {
        markers[emp.id]?.setPopupContent(popup);
      });
    } else {
      const marker = window.L.marker(latlng, { icon: employeeMarkerIcon(emp) })
        .addTo(mapInstance)
        .bindPopup(tr("attendance.loadingLocation"));
      marker._emp = emp;
      marker._ping = ping;
      marker.on("click", () => {
        void selectEmployeeOnMap(emp.id, { fromMarker: true });
      });
      markers[emp.id] = marker;
      void buildMarkerPopup(emp, ping).then((popup) => {
        marker.setPopupContent(popup);
      });
    }
  }
  for (const id of Object.keys(markers)) {
    if (!presentIds.has(id)) {
      mapInstance.removeLayer(markers[id]);
      delete markers[id];
    }
  }
  if (fitAll) {
    if (bounds.length === 1) {
      mapInstance.setView(bounds[0], 16);
    } else if (bounds.length > 1) {
      mapInstance.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
    }
  }
}

async function focusEmployeeOnMap(emp) {
  if (!mapInstance || !emp?.lastPing) return false;
  const ping = emp.lastPing;
  const lat = ping.latitude;
  const lng = ping.longitude;

  if (mapProvider === "google" && window.google?.maps) {
    mapInstance.panTo({ lat, lng });
    mapInstance.setZoom(17);
    let marker = markers[emp.id];
    if (!marker) {
      updateMapMarkers(liveData?.employees ?? [], { fitAll: false });
      marker = markers[emp.id];
    }
    if (marker && infoWindow) {
      const html = marker._popupHtml || (await buildMarkerPopup(emp, ping));
      infoWindow.setContent(html);
      infoWindow.open({ map: mapInstance, anchor: marker });
    }
    return true;
  }

  if (window.L) {
    mapInstance.setView([lat, lng], 17, { animate: true });
    let marker = markers[emp.id];
    if (!marker) {
      updateMapMarkers(liveData?.employees ?? [], { fitAll: false });
      marker = markers[emp.id];
    }
    marker?.openPopup();
    return true;
  }
  return false;
}

async function selectEmployeeOnMap(employeeId, { fromMarker = false } = {}) {
  if (!employeeId) return;
  selectedEmployeeId = employeeId;
  const employees = sortEmployeesLiveFirst(liveData?.employees ?? []);
  const emp = employees.find((e) => e.id === employeeId) ?? null;

  const listHost = document.getElementById("admin-attendance-emp-list");
  if (listHost && employees.length) {
    listHost.innerHTML = employees.map(employeeRowHtml).join("");
    wireEmployeeListHandlers(listHost);
  }

  await refreshDetailForSelection(employees);

  if (!emp?.lastPing) return;

  ensureMap();
  updateMapMarkers(employees, { fitAll: false });
  await focusEmployeeOnMap(emp);

  const mapWrap = document.querySelector(".admin-attendance-map-wrap");
  mapWrap?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

function sortEmployeesLiveFirst(employees) {
  return [...(employees ?? [])].sort((a, b) => {
    const aLive = a.trackingOn && !a.isOff ? 0 : 1;
    const bLive = b.trackingOn && !b.isOff ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, {
      sensitivity: "base",
    });
  });
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

function currentStatusBannerHtml(emp, placeDetails = null) {
  if (!emp) return "";
  const statusClass = emp.isOff ? "admin-attendance-live-status--off" : "admin-attendance-live-status--on";
  const label = emp.isOff ? tr("attendance.statusOff") : tr("attendance.statusLive");
  const detail = employeeMetaHtml(emp);
  const placeLine = placeDetails?.placeName
    ? `<span class="admin-attendance-live-status-place">${escapeHtmlFn?.(placeDetails.placeName) ?? placeDetails.placeName}</span>`
    : placeDetails?.area || placeDetails?.city
      ? `<span class="admin-attendance-live-status-place">${escapeHtmlFn?.(
          [placeDetails.area, placeDetails.city].filter(Boolean).join(", ")
        ) ?? ""}</span>`
      : "";
  return `<div class="admin-attendance-live-status ${statusClass}" role="status">
    <span class="admin-attendance-live-status-label">${escapeHtmlFn?.(label) ?? label}</span>
    <span class="admin-attendance-live-status-detail">${escapeHtmlFn?.(detail) ?? detail}</span>
    ${placeLine}
  </div>`;
}

function renderDetailPanel(history, liveEmp = null, placeDetails = null) {
  const panel = document.getElementById("admin-attendance-detail");
  if (!panel) return;
  if (!history) {
    panel.innerHTML = `<p class="text-muted small mb-0">${escapeHtmlFn?.(tr("attendance.selectEmployee")) ?? ""}</p>`;
    return;
  }
  const rows = (history.offPeriods ?? []).map(offPeriodRowHtml).join("");
  const banner = currentStatusBannerHtml(liveEmp, placeDetails);
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
      const id = btn.getAttribute("data-employee-id");
      void selectEmployeeOnMap(id);
    });
  });
}

function updateAttendanceDomInPlace(data) {
  const employees = sortEmployeesLiveFirst(data.employees ?? []);
  const listHost = document.getElementById("admin-attendance-emp-list");
  if (listHost) {
    listHost.innerHTML = employees.length
      ? employees.map(employeeRowHtml).join("")
      : `<p class="text-muted small">${escapeHtmlFn?.(tr("attendance.noEmployees")) ?? ""}</p>`;
    wireEmployeeListHandlers(listHost);
  }
}

function wireAttendanceRefreshButton(root = document) {
  root.querySelectorAll(".js-attendance-refresh").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      void manualRefreshAttendance(btn);
    });
  });
}

async function manualRefreshAttendance(btn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-refreshing");
  }
  try {
    await refreshAdminAttendance({ keepSelection: true, forceFull: true });
    updateLastRefreshedLabel();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-refreshing");
    }
  }
}

function updateLastRefreshedLabel() {
  const el = document.getElementById("admin-attendance-last-refreshed");
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit", second: "2-digit" });
  el.textContent = tr("attendance.lastRefreshed", { time });
}

function attendanceTabsHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<div class="admin-attendance-tabs" role="tablist">
    <button type="button" class="admin-attendance-tab${attendanceViewTab === "live" ? " admin-attendance-tab--active" : ""}" data-attendance-tab="live">${esc(tr("attendance.tabLive"))}</button>
    <button type="button" class="admin-attendance-tab${attendanceViewTab === "daily" ? " admin-attendance-tab--active" : ""}" data-attendance-tab="daily">${esc(tr("attendance.tabDaily"))}</button>
    <button type="button" class="admin-attendance-tab${attendanceViewTab === "report" ? " admin-attendance-tab--active" : ""}" data-attendance-tab="report">${esc(tr("attendance.tabReport"))}</button>
  </div>`;
}

function wireAttendanceTabs(root) {
  root.querySelectorAll("[data-attendance-tab]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-attendance-tab");
      if (tab !== "live" && tab !== "daily" && tab !== "report") return;
      if (attendanceViewTab === tab) return;
      attendanceViewTab = tab;
      if (tab === "live") {
        void refreshAdminAttendance();
        startAttendancePoll();
      } else {
        stopAttendancePoll();
        destroyMap();
        if (tab === "daily") {
          void renderDailyAttendancePage();
        } else {
          void renderMonthlyReportPage();
        }
      }
    });
  });
}

function dailyReportSortKey(row) {
  if (!row.checkIn) return 0;
  if (row.isCheckedIn) return 2;
  return 1;
}

function computeWorkingMinutes(row) {
  if (!row.checkIn?.recordedAt) return null;
  const start = new Date(row.checkIn.recordedAt);
  const end = row.isCheckedIn
    ? new Date()
    : row.checkOut?.recordedAt
      ? new Date(row.checkOut.recordedAt)
      : null;
  if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes >= 0 ? minutes : null;
}

function formatWorkingMinutes(row) {
  const minutes = computeWorkingMinutes(row);
  if (minutes == null) return "—";
  if (row.isCheckedIn) {
    return tr("attendance.workingMinutesOngoing", { minutes });
  }
  return tr("attendance.workingMinutes", { minutes });
}

function dailyReportTimingHtml(timingStatus) {
  if (timingStatus === "late") {
    return ` <span class="admin-attendance-timing admin-attendance-timing--late">${escapeHtmlFn?.(tr("attendance.timingLate")) ?? "Late"}</span>`;
  }
  if (timingStatus === "early") {
    return ` <span class="admin-attendance-timing admin-attendance-timing--early">${escapeHtmlFn?.(tr("attendance.timingEarly")) ?? "Early"}</span>`;
  }
  return "";
}

function dailyReportStats(rows) {
  const total = rows.length;
  const present = rows.filter((row) => row.checkIn).length;
  return { total, present, absent: total - present };
}

function dailySummaryHtml(present, total, absent) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<div class="admin-attendance-daily-kpi-grid">
    <div class="admin-attendance-daily-kpi admin-attendance-daily-kpi--present">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("how_to_reg") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value tabular-nums">${present}<span class="admin-attendance-daily-kpi-sep">/</span>${total}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.dailySummaryPresent"))}</span>
    </div>
    <div class="admin-attendance-daily-kpi admin-attendance-daily-kpi--absent">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("person_off") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value tabular-nums">${absent}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.dailySummaryAbsent"))}</span>
    </div>
  </div>`;
}

function dailyReportStatusBadgeHtml(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (row.isCheckedIn) {
    return `<span class="admin-attendance-daily-badge admin-attendance-daily-badge--in">${esc(tr("attendance.checkedInBadge"))}</span>`;
  }
  if (row.checkIn) {
    return `<span class="admin-attendance-daily-badge admin-attendance-daily-badge--present">${esc(tr("attendance.presentBadge"))}</span>`;
  }
  return `<span class="admin-attendance-daily-badge admin-attendance-daily-badge--absent">${esc(tr("attendance.absentBadge"))}</span>`;
}

function dailyReportCheckInText(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (!row.checkIn) return "—";
  return `${formatDateTime(row.checkIn.recordedAt)} · ${esc(row.checkIn.locationName ?? "—")}${dailyReportTimingHtml(row.checkIn.timingStatus)}`;
}

function dailyReportCheckOutText(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  if (row.isCheckedIn) return tr("attendance.stillCheckedIn");
  if (!row.checkOut) return "—";
  return `${formatDateTime(row.checkOut.recordedAt)} · ${esc(row.checkOut.locationName ?? "—")}${dailyReportTimingHtml(row.checkOut.timingStatus)}`;
}

function dailyReportRowHtml(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const checkIn = dailyReportCheckInText(row);
  const checkOut = dailyReportCheckOutText(row);
  const working = formatWorkingMinutes(row);
  return `<tr>
    <td class="admin-attendance-daily-employee">${esc(row.displayName)}</td>
    <td class="small admin-attendance-daily-time">${checkIn}</td>
    <td class="small admin-attendance-daily-time">${checkOut}</td>
    <td class="text-end fw-semibold tabular-nums admin-attendance-daily-working">${esc(working)}</td>
    <td class="admin-attendance-daily-status">${dailyReportStatusBadgeHtml(row)}</td>
  </tr>`;
}

function dailyReportMobileCardHtml(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const checkIn = dailyReportCheckInText(row);
  const checkOut = dailyReportCheckOutText(row);
  const working = formatWorkingMinutes(row);
  return `<article class="admin-attendance-daily-card">
    <div class="admin-attendance-daily-card-head">
      <h3 class="admin-attendance-daily-card-name">${esc(row.displayName)}</h3>
      ${dailyReportStatusBadgeHtml(row)}
    </div>
    <dl class="admin-attendance-daily-card-details">
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.checkIn"))}</dt>
        <dd>${checkIn}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.checkOut"))}</dt>
        <dd>${checkOut}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.workingMinutesColumn"))}</dt>
        <dd class="tabular-nums fw-semibold">${esc(working)}</dd>
      </div>
    </dl>
  </article>`;
}

function renderDailyReportContent(rows) {
  const summaryEl = document.getElementById("admin-attendance-daily-summary");
  const body = document.getElementById("admin-attendance-daily-body");
  const cardsEl = document.getElementById("admin-attendance-daily-cards");
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));

  const stats = dailyReportStats(rows);
  if (summaryEl) {
    summaryEl.innerHTML = dailySummaryHtml(stats.present, stats.total, stats.absent);
  }

  if (!rows.length) {
    const empty = `<p class="admin-attendance-daily-empty">${esc(tr("attendance.noEmployees"))}</p>`;
    if (body) body.innerHTML = `<tr><td colspan="5" class="text-muted">${esc(tr("attendance.noEmployees"))}</td></tr>`;
    if (cardsEl) cardsEl.innerHTML = empty;
    return;
  }

  if (body) body.innerHTML = rows.map((row) => dailyReportRowHtml(row)).join("");
  if (cardsEl) cardsEl.innerHTML = rows.map((row) => dailyReportMobileCardHtml(row)).join("");
}

async function renderDailyAttendancePage() {
  const main = document.getElementById("main-column");
  if (!main || !apiFn) return;
  if (!dailyReportDate) {
    dailyReportDate = new Date().toISOString().slice(0, 10);
  }
  main.innerHTML = `<div class="admin-main-scroll d-flex flex-column">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="admin-attendance-page admin-attendance-page--daily">
      <div class="admin-attendance-daily-panel">
        <div class="admin-attendance-toolbar admin-attendance-daily-toolbar">
          ${attendanceTabsHtml()}
          <div class="admin-attendance-toolbar-actions">
            <input type="date" class="form-control form-control-sm admin-attendance-date-input" id="admin-attendance-daily-date" value="${dailyReportDate}" aria-label="${escapeHtmlFn?.(tr("attendance.dailyReportDateLabel")) ?? "Date"}" />
            <button type="button" class="btn btn-sm btn-outline-primary js-attendance-daily-refresh">
              ${adminMsIconFn?.("refresh") ?? ""}
              <span>${escapeHtmlFn?.(tr("attendance.refresh")) ?? "Refresh"}</span>
            </button>
          </div>
        </div>
        <p class="admin-attendance-intro admin-attendance-daily-intro">${escapeHtmlFn?.(tr("attendance.dailyReportIntro")) ?? ""}</p>
        <div id="admin-attendance-daily-summary" class="admin-attendance-daily-summary">
          ${dailySummaryHtml(0, 0, 0)}
        </div>
        <div class="admin-attendance-daily-table-wrap d-none d-md-block">
          <table class="table table-hover align-middle mb-0 admin-attendance-daily-table">
            <thead>
              <tr>
                <th>${escapeHtmlFn?.(tr("common.employee")) ?? "Employee"}</th>
                <th>${escapeHtmlFn?.(tr("attendance.checkIn")) ?? "Check in"}</th>
                <th>${escapeHtmlFn?.(tr("attendance.checkOut")) ?? "Check out"}</th>
                <th class="text-end">${escapeHtmlFn?.(tr("attendance.workingMinutesColumn")) ?? "Working (min)"}</th>
                <th>${escapeHtmlFn?.(tr("attendance.statusColumn")) ?? "Status"}</th>
              </tr>
            </thead>
            <tbody id="admin-attendance-daily-body">
              <tr><td colspan="5" class="text-muted">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</td></tr>
            </tbody>
          </table>
        </div>
        <div id="admin-attendance-daily-cards" class="admin-attendance-daily-cards d-md-none">
          <p class="admin-attendance-daily-empty text-muted">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>
        </div>
      </div>
    </div>
  </div>`;
  wireOwnerChromeHeaderFn?.(main);
  wireAttendanceTabs(main);
  main.querySelector("#admin-attendance-daily-date")?.addEventListener("change", (e) => {
    dailyReportDate = e.target.value;
    void loadDailyReport();
  });
  main.querySelector(".js-attendance-daily-refresh")?.addEventListener("click", () => {
    void loadDailyReport();
  });
  await loadDailyReport();
}

async function loadDailyReport() {
  const body = document.getElementById("admin-attendance-daily-body");
  const cardsEl = document.getElementById("admin-attendance-daily-cards");
  if (!apiFn) return;

  const loading = escapeHtmlFn?.(tr("common.loading")) ?? "";
  if (body) body.innerHTML = `<tr><td colspan="5" class="text-muted">${loading}</td></tr>`;
  if (cardsEl) cardsEl.innerHTML = `<p class="admin-attendance-daily-empty text-muted">${loading}</p>`;

  try {
    const date = dailyReportDate || new Date().toISOString().slice(0, 10);
    const report = await apiFn(`/api/attendance/daily-report?date=${encodeURIComponent(date)}`);
    const rows = [...(report.employees ?? [])].sort((a, b) => {
      const keyDiff = dailyReportSortKey(b) - dailyReportSortKey(a);
      if (keyDiff !== 0) return keyDiff;
      return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""), undefined, { sensitivity: "base" });
    });
    renderDailyReportContent(rows);
  } catch (err) {
    const msg = escapeHtmlFn?.(err.message) ?? err.message;
    if (body) body.innerHTML = `<tr><td colspan="5" class="text-danger">${msg}</td></tr>`;
    if (cardsEl) cardsEl.innerHTML = `<p class="admin-attendance-daily-empty text-danger">${msg}</p>`;
  }
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthValue(value) {
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function formatMonthLabel(year, month) {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" });
}

function formatSalaryAmount(amount) {
  const value = Number(amount ?? 15000);
  return `₹${value.toLocaleString(dateLocale())}`;
}

function formatTotalMinutes(minutes) {
  const total = Number(minutes ?? 0);
  if (total <= 0) return tr("attendance.monthlyMinutesZero");
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0) {
    return tr("attendance.monthlyMinutesHours", { hours, minutes: mins });
  }
  return tr("attendance.workingMinutes", { minutes: total });
}

function monthlyReportStats(rows, workingDays) {
  const total = rows.length;
  const presentSum = rows.reduce((sum, row) => sum + (row.present ?? 0), 0);
  const absentSum = rows.reduce((sum, row) => sum + (row.absent ?? 0), 0);
  return { total, presentSum, absentSum, workingDays };
}

function monthlySummaryHtml(stats, monthLabel) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<div class="admin-attendance-daily-kpi-grid admin-attendance-monthly-kpi-grid">
    <div class="admin-attendance-daily-kpi admin-attendance-monthly-kpi admin-attendance-monthly-kpi--month">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("calendar_month") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value admin-attendance-monthly-kpi-month">${esc(monthLabel)}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.monthlyReportMonthLabel"))}</span>
    </div>
    <div class="admin-attendance-daily-kpi admin-attendance-monthly-kpi admin-attendance-monthly-kpi--working">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("event_available") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value tabular-nums">${stats.workingDays ?? 0}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.monthlyWorkingDaysLabel"))}</span>
    </div>
    <div class="admin-attendance-daily-kpi admin-attendance-daily-kpi--present admin-attendance-monthly-kpi">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("how_to_reg") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value tabular-nums">${stats.presentSum ?? 0}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.monthlyTotalPresentLabel"))}</span>
    </div>
    <div class="admin-attendance-daily-kpi admin-attendance-daily-kpi--absent admin-attendance-monthly-kpi">
      <div class="admin-attendance-daily-kpi-body">
        <span class="admin-attendance-daily-kpi-icon" aria-hidden="true">${adminMsIconFn?.("person_off") ?? ""}</span>
        <span class="admin-attendance-daily-kpi-value tabular-nums">${stats.absentSum ?? 0}</span>
      </div>
      <span class="admin-attendance-daily-kpi-label">${esc(tr("attendance.monthlyTotalAbsentLabel"))}</span>
    </div>
  </div>`;
}

function monthlyReportRowHtml(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const minutes = formatTotalMinutes(row.totalMinutes);
  const salary = formatSalaryAmount(row.salary);
  return `<tr>
    <td class="admin-attendance-daily-employee">${esc(row.displayName)}</td>
    <td class="text-center tabular-nums admin-attendance-monthly-present">${row.present ?? 0}</td>
    <td class="text-center tabular-nums admin-attendance-monthly-absent">${row.absent ?? 0}</td>
    <td class="text-center tabular-nums">${row.workingDays ?? 0}</td>
    <td class="text-end fw-semibold tabular-nums admin-attendance-daily-working">${esc(minutes)}</td>
    <td class="text-end tabular-nums admin-attendance-monthly-salary">${esc(salary)}</td>
  </tr>`;
}

function monthlyReportMobileCardHtml(row) {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  const minutes = formatTotalMinutes(row.totalMinutes);
  const salary = formatSalaryAmount(row.salary);
  return `<article class="admin-attendance-daily-card admin-attendance-monthly-card">
    <div class="admin-attendance-daily-card-head">
      <h3 class="admin-attendance-daily-card-name">${esc(row.displayName)}</h3>
      <span class="admin-attendance-daily-badge admin-attendance-daily-badge--present">${esc(tr("attendance.monthlyPresentShort", { count: row.present ?? 0 }))}</span>
    </div>
    <dl class="admin-attendance-daily-card-details">
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.monthlyPresentColumn"))}</dt>
        <dd class="tabular-nums fw-semibold admin-attendance-monthly-present">${row.present ?? 0}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.monthlyAbsentColumn"))}</dt>
        <dd class="tabular-nums fw-semibold admin-attendance-monthly-absent">${row.absent ?? 0}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.monthlyWorkingDaysColumn"))}</dt>
        <dd class="tabular-nums">${row.workingDays ?? 0}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("attendance.monthlyMinutesColumn"))}</dt>
        <dd class="tabular-nums fw-semibold">${esc(minutes)}</dd>
      </div>
      <div class="admin-attendance-daily-card-row">
        <dt>${esc(tr("profile.salary"))}</dt>
        <dd class="tabular-nums fw-semibold admin-attendance-monthly-salary">${esc(salary)}</dd>
      </div>
    </dl>
  </article>`;
}

function renderMonthlyReportContent(rows, meta) {
  const summaryEl = document.getElementById("admin-attendance-monthly-summary");
  const body = document.getElementById("admin-attendance-monthly-body");
  const cardsEl = document.getElementById("admin-attendance-monthly-cards");
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));

  const stats = monthlyReportStats(rows, meta.workingDays);
  const monthLabel = formatMonthLabel(meta.year, meta.month);
  if (summaryEl) {
    summaryEl.innerHTML = monthlySummaryHtml(stats, monthLabel);
  }

  if (!rows.length) {
    const empty = `<p class="admin-attendance-daily-empty">${esc(tr("attendance.noEmployees"))}</p>`;
    if (body) body.innerHTML = `<tr><td colspan="6" class="text-muted">${esc(tr("attendance.noEmployees"))}</td></tr>`;
    if (cardsEl) cardsEl.innerHTML = empty;
    return;
  }

  if (body) body.innerHTML = rows.map((row) => monthlyReportRowHtml(row)).join("");
  if (cardsEl) cardsEl.innerHTML = rows.map((row) => monthlyReportMobileCardHtml(row)).join("");
}

async function renderMonthlyReportPage() {
  const main = document.getElementById("main-column");
  if (!main || !apiFn) return;
  if (!monthlyReportMonth) {
    monthlyReportMonth = currentMonthValue();
  }
  main.innerHTML = `<div class="admin-main-scroll d-flex flex-column">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="admin-attendance-page admin-attendance-page--monthly">
      <div class="admin-attendance-daily-panel admin-attendance-monthly-panel">
        <div class="admin-attendance-toolbar admin-attendance-daily-toolbar">
          ${attendanceTabsHtml()}
          <div class="admin-attendance-toolbar-actions">
            <input type="month" class="form-control form-control-sm admin-attendance-date-input" id="admin-attendance-monthly-picker" value="${monthlyReportMonth}" aria-label="${escapeHtmlFn?.(tr("attendance.monthlyReportMonthPicker")) ?? "Month"}" />
            <button type="button" class="btn btn-sm btn-outline-primary js-attendance-monthly-refresh">
              ${adminMsIconFn?.("refresh") ?? ""}
              <span>${escapeHtmlFn?.(tr("attendance.refresh")) ?? "Refresh"}</span>
            </button>
          </div>
        </div>
        <p class="admin-attendance-intro admin-attendance-daily-intro">${escapeHtmlFn?.(tr("attendance.monthlyReportIntro")) ?? ""}</p>
        <div id="admin-attendance-monthly-summary" class="admin-attendance-daily-summary">
          ${monthlySummaryHtml({ total: 0, presentSum: 0, absentSum: 0, workingDays: 0 }, "")}
        </div>
        <div class="admin-attendance-daily-table-wrap d-none d-md-block">
          <table class="table table-hover align-middle mb-0 admin-attendance-daily-table admin-attendance-monthly-table">
            <thead>
              <tr>
                <th>${escapeHtmlFn?.(tr("common.employee")) ?? "Employee"}</th>
                <th class="text-center">${escapeHtmlFn?.(tr("attendance.monthlyPresentColumn")) ?? "Present"}</th>
                <th class="text-center">${escapeHtmlFn?.(tr("attendance.monthlyAbsentColumn")) ?? "Absent"}</th>
                <th class="text-center">${escapeHtmlFn?.(tr("attendance.monthlyWorkingDaysColumn")) ?? "Working days"}</th>
                <th class="text-end">${escapeHtmlFn?.(tr("attendance.monthlyMinutesColumn")) ?? "Minutes worked"}</th>
                <th class="text-end">${escapeHtmlFn?.(tr("profile.salary")) ?? "Salary"}</th>
              </tr>
            </thead>
            <tbody id="admin-attendance-monthly-body">
              <tr><td colspan="6" class="text-muted">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</td></tr>
            </tbody>
          </table>
        </div>
        <div id="admin-attendance-monthly-cards" class="admin-attendance-daily-cards d-md-none">
          <p class="admin-attendance-daily-empty text-muted">${escapeHtmlFn?.(tr("common.loading")) ?? ""}</p>
        </div>
      </div>
    </div>
  </div>`;
  wireOwnerChromeHeaderFn?.(main);
  wireAttendanceTabs(main);
  main.querySelector("#admin-attendance-monthly-picker")?.addEventListener("change", (e) => {
    monthlyReportMonth = e.target.value;
    void loadMonthlyReport();
  });
  main.querySelector(".js-attendance-monthly-refresh")?.addEventListener("click", () => {
    void loadMonthlyReport();
  });
  await loadMonthlyReport();
}

async function loadMonthlyReport() {
  const body = document.getElementById("admin-attendance-monthly-body");
  const cardsEl = document.getElementById("admin-attendance-monthly-cards");
  if (!apiFn) return;

  const loading = escapeHtmlFn?.(tr("common.loading")) ?? "";
  if (body) body.innerHTML = `<tr><td colspan="6" class="text-muted">${loading}</td></tr>`;
  if (cardsEl) cardsEl.innerHTML = `<p class="admin-attendance-daily-empty text-muted">${loading}</p>`;

  try {
    const monthValue = monthlyReportMonth || currentMonthValue();
    const parsed = parseMonthValue(monthValue);
    if (!parsed) throw new Error(tr("attendance.monthlyReportInvalidMonth"));
    const report = await apiFn(
      `/api/attendance/monthly-report?year=${parsed.year}&month=${parsed.month}`
    );
    const rows = [...(report.employees ?? [])].sort((a, b) => {
      const presentDiff = (b.present ?? 0) - (a.present ?? 0);
      if (presentDiff !== 0) return presentDiff;
      return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""), undefined, { sensitivity: "base" });
    });
    renderMonthlyReportContent(rows, {
      year: report.year ?? parsed.year,
      month: report.month ?? parsed.month,
      workingDays: report.workingDays ?? 0,
    });
  } catch (err) {
    const msg = escapeHtmlFn?.(err.message) ?? err.message;
    if (body) body.innerHTML = `<tr><td colspan="6" class="text-danger">${msg}</td></tr>`;
    if (cardsEl) cardsEl.innerHTML = `<p class="admin-attendance-daily-empty text-danger">${msg}</p>`;
  }
}

function renderAttendancePage() {
  const main = document.getElementById("main-column");
  if (!main) return;
  const employees = sortEmployeesLiveFirst(liveData?.employees ?? []);
  if (!selectedEmployeeId && employees.length) {
    selectedEmployeeId = employees.find((e) => e.trackingOn && e.lastPing)?.id ?? employees[0].id;
  }
  main.innerHTML = `<div class="admin-main-scroll d-flex flex-column">
    ${ownerChromeHeaderFn?.() ?? ""}
    <div class="admin-attendance-page">
      <div class="admin-attendance-toolbar">
        ${attendanceTabsHtml()}
        <div class="admin-attendance-toolbar-actions">
          <span class="admin-attendance-last-refreshed" id="admin-attendance-last-refreshed"></span>
          <button type="button" class="btn btn-sm btn-outline-primary js-attendance-refresh">
            ${adminMsIconFn?.("refresh") ?? ""}
            <span>${escapeHtmlFn?.(tr("attendance.refresh")) ?? "Refresh"}</span>
          </button>
        </div>
      </div>
      <p class="admin-attendance-intro mb-3">${escapeHtmlFn?.(tr("attendance.adminIntro")) ?? ""}</p>
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
  wireAttendanceTabs(main);
  wireEmployeeListHandlers(main);
  wireAttendanceRefreshButton(main);
  updateLastRefreshedLabel();
}

async function refreshDetailForSelection(employees) {
  if (!selectedEmployeeId) {
    renderDetailPanel(null);
    return;
  }
  const history = await loadEmployeeHistory(selectedEmployeeId);
  const liveEmp = (employees ?? []).find((e) => e.id === selectedEmployeeId) ?? null;
  let placeDetails = null;
  if (liveEmp?.lastPing) {
    placeDetails = await resolvePlaceDetails(liveEmp.lastPing.latitude, liveEmp.lastPing.longitude);
  } else if (history?.offPeriods?.[0]?.offLocation) {
    const loc = history.offPeriods[0].offLocation;
    placeDetails = {
      area: loc.area ?? null,
      city: loc.city ?? null,
      placeName: loc.placeName ?? null,
    };
  }
  renderDetailPanel(history, liveEmp, placeDetails);
}

async function loadEmployeeHistory(userId) {
  if (!apiFn || !userId) return null;
  return apiFn(`/api/attendance/employees/${userId}/history`);
}

export async function refreshAdminAttendance({ keepSelection = false, forceFull = false } = {}) {
  if (!apiFn) return;
  if (attendanceViewTab === "daily") {
    await renderDailyAttendancePage();
    return;
  }
  if (attendanceViewTab === "report") {
    await renderMonthlyReportPage();
    return;
  }
  const data = await apiFn("/api/attendance/live");
  liveData = data;
  if (!keepSelection) selectedEmployeeId = null;

  const pageExists = document.querySelector(".admin-attendance-page");
  const provider = await ensureMapLibrary();

  if (pageExists && keepSelection) {
    updateAttendanceDomInPlace(data);
    ensureMap();
    updateMapMarkers(data.employees ?? [], { fitAll: false });
    await refreshDetailForSelection(data.employees ?? []);
    updateLastRefreshedLabel();
    if (forceFull && selectedEmployeeId) {
      const emp = (data.employees ?? []).find((e) => e.id === selectedEmployeeId);
      if (emp?.lastPing) await focusEmployeeOnMap(emp);
    }
    return;
  }

  renderAttendancePage();
  ensureMap();
  updateMapMarkers(data.employees ?? [], { fitAll: !selectedEmployeeId });
  if (provider === "leaflet") {
    setTimeout(() => mapInstance?.invalidateSize?.(), 100);
  } else if (provider === "google" && mapInstance) {
    setTimeout(() => window.google?.maps?.event?.trigger(mapInstance, "resize"), 100);
  }
  if (selectedEmployeeId) {
    await refreshDetailForSelection(data.employees ?? []);
    const emp = (data.employees ?? []).find((e) => e.id === selectedEmployeeId);
    if (emp?.lastPing) {
      await focusEmployeeOnMap(emp);
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
  if (attendanceViewTab === "daily") {
    void renderDailyAttendancePage();
    return;
  }
  if (attendanceViewTab === "report") {
    void renderMonthlyReportPage();
    return;
  }
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
    <div class="admin-dash-utilities">
      <button type="button" class="admin-icon-btn js-attendance-refresh" aria-label="${tr("attendance.refresh")}" title="${tr("attendance.refresh")}">
        ${adminMsIconFn?.("refresh") ?? ""}
      </button>
    </div>
  </header>`;
}
