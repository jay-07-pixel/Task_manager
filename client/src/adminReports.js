import { Chart } from "chart.js/auto";
import { t } from "./i18n/index.js";

/** @type {Record<string, Chart>} */
const chartInstances = {};

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((s: string) => string) | null} */
let escapeHtmlFn = null;

/** @type {((name: string, extraClass?: string) => string) | null} */
let adminMsIconFn = null;

/** @type {any} */
let reportData = null;

/** @type {number | null} */
let reportsResizeTimer = null;

function isReportMobile() {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

function truncateLabel(label, maxLen) {
  const s = String(label ?? "");
  const max = maxLen ?? (isReportMobile() ? 14 : 28);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function setChartWrapHeight(wrapEl, labelCount) {
  if (!wrapEl) return;
  const mobile = isReportMobile();
  const rowPx = mobile ? 30 : 36;
  const padPx = mobile ? 36 : 48;
  const minPx = mobile ? 200 : 224;
  wrapEl.style.height = `${Math.max(minPx, labelCount * rowPx + padPx)}px`;
}

function unwireReportsResize() {
  if (reportsResizeTimer != null) {
    window.clearTimeout(reportsResizeTimer);
    reportsResizeTimer = null;
  }
  window.removeEventListener("resize", onReportsResize);
}

function onReportsResize() {
  if (reportsResizeTimer != null) window.clearTimeout(reportsResizeTimer);
  reportsResizeTimer = window.setTimeout(() => {
    reportsResizeTimer = null;
    if (!document.querySelector(".admin-reports-page") || !reportData) return;
    renderCharts(reportData);
  }, 220);
}

function wireReportsResize() {
  unwireReportsResize();
  window.addEventListener("resize", onReportsResize);
}

/** @type {(() => string) | null} */
let chromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireChromeHeaderFn = null;

export function initAdminReports({ api, escapeHtml, adminMsIcon, reportsChromeHeader, wireReportsChromeHeader }) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  chromeHeaderFn = reportsChromeHeader ?? null;
  wireChromeHeaderFn = wireReportsChromeHeader ?? null;
}

export function ownerReportsNavItemHtml(active = false) {
  const activeClass = active ? " admin-sidebar-nav-item--active" : "";
  return `<button type="button" class="admin-sidebar-nav-item js-owner-reports-nav${activeClass}" data-owner-view="reports">
    <span class="admin-nav-item-left">
      <span class="material-symbols-outlined" aria-hidden="true">assessment</span>
      <span>${t("nav.reports")}</span>
    </span>
  </button>`;
}

function chartColors() {
  const shell = document.querySelector(".owner-shell.admin-mockup-ui");
  const style = shell ? getComputedStyle(shell) : getComputedStyle(document.documentElement);
  return {
    primary: style.getPropertyValue("--admin-primary-container").trim() || "#006d77",
    secondary: style.getPropertyValue("--admin-secondary").trim() || "#236863",
    error: style.getPropertyValue("--admin-error").trim() || "#ba1a1a",
    onSurface: style.getPropertyValue("--admin-on-surface").trim() || "#181a2e",
    onSurfaceVariant: style.getPropertyValue("--admin-on-surface-variant").trim() || "#3e494a",
    outline: style.getPropertyValue("--admin-outline-variant").trim() || "#bec8ca",
    surface: style.getPropertyValue("--admin-surface-container-high").trim() || "#e6e6ff",
  };
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

export function destroyAdminReportsCharts() {
  Object.keys(chartInstances).forEach(destroyChart);
  unwireReportsResize();
}

function baseChartOptions() {
  const c = chartColors();
  const mobile = isReportMobile();
  const tickSize = mobile ? 9 : 11;
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: mobile ? { left: 0, right: 4, top: 0, bottom: 0 } : undefined },
    plugins: {
      legend: {
        labels: {
          color: c.onSurfaceVariant,
          boxWidth: mobile ? 10 : 12,
          padding: mobile ? 10 : 14,
          font: { family: "Inter, system-ui, sans-serif", size: mobile ? 10 : 12 },
        },
      },
      tooltip: {
        backgroundColor: c.onSurface,
        titleFont: { family: "Inter, system-ui, sans-serif", size: mobile ? 11 : 13 },
        bodyFont: { family: "Inter, system-ui, sans-serif", size: mobile ? 11 : 13 },
        padding: mobile ? 8 : 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          color: c.onSurfaceVariant,
          font: { size: tickSize },
          maxRotation: mobile ? 50 : 0,
          minRotation: mobile ? 25 : 0,
          autoSkip: true,
          maxTicksLimit: mobile ? 6 : 12,
        },
        grid: { color: c.outline, drawBorder: false },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: c.onSurfaceVariant,
          font: { size: tickSize },
          precision: 0,
          autoSkip: false,
        },
        grid: { color: c.outline, drawBorder: false },
      },
    },
  };
}

function kpiCard(label, value, icon, accent = "") {
  const accentClass = accent ? ` admin-report-kpi--${accent}` : "";
  return `<div class="admin-report-kpi${accentClass}">
    <div class="admin-report-kpi-icon">${adminMsIconFn(icon)}</div>
    <div class="admin-report-kpi-body">
      <div class="admin-report-kpi-value">${escapeHtmlFn(String(value))}</div>
      <div class="admin-report-kpi-label">${escapeHtmlFn(label)}</div>
    </div>
  </div>`;
}

function reportPageHtml(data) {
  const o = data.overview;
  const generated = new Date(data.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
    <div class="admin-main-scroll d-flex flex-column">
      ${chromeHeaderFn ? chromeHeaderFn() : ""}
    <div class="admin-reports-page">
      <header class="admin-reports-header">
        <div>
          <p class="admin-reports-subtitle text-muted mb-0">${escapeHtmlFn(t("reports.subtitle"))}</p>
        </div>
        <div class="admin-reports-header-actions">
          <span class="admin-reports-updated small text-muted">${escapeHtmlFn(t("reports.updated", { time: generated }))}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary js-reports-refresh">
            ${adminMsIconFn("refresh")}
            ${escapeHtmlFn(t("common.refresh"))}
          </button>
        </div>
      </header>

      <div class="admin-report-kpi-grid">
        ${kpiCard(t("reports.totalTasks"), o.totalTasks, "assignment")}
        ${kpiCard(t("reports.active"), o.active, "bolt", "active")}
        ${kpiCard(t("reports.inReview"), o.inReview, "rate_review", "review")}
        ${kpiCard(t("reports.completed"), o.completed, "check_circle", "done")}
        ${kpiCard(t("reports.overdue"), o.overdue, "event_busy", o.overdue > 0 ? "warn" : "")}
        ${kpiCard(t("reports.submissions"), o.totalSubmissions, "upload_file")}
        ${kpiCard(t("reports.employees"), o.employeeCount, "groups")}
        ${kpiCard(t("reports.progressUpdates"), o.progressUpdates, "forum")}
        ${kpiCard(t("reports.chat30Days"), o.chatMessages30d, "chat")}
        ${kpiCard(t("reports.yourLists"), o.listCount, "folder")}
      </div>

      <div class="admin-reports-charts">
        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">${escapeHtmlFn(t("reports.taskStatus"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--doughnut">
            <canvas id="report-chart-status" aria-label="${escapeHtmlFn(t("reports.taskStatusAria"))}"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">${escapeHtmlFn(t("reports.tasksByList"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--lists">
            <canvas id="report-chart-lists" aria-label="${escapeHtmlFn(t("reports.tasksByListAria"))}"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart admin-report-card--wide">
          <h2 class="admin-report-card-title">${escapeHtmlFn(t("reports.activityTrend"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--tall">
            <canvas id="report-chart-trend" aria-label="${escapeHtmlFn(t("reports.activityTrendAria"))}"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart admin-report-card--wide">
          <h2 class="admin-report-card-title">${escapeHtmlFn(t("reports.employeeWorkload"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--tall admin-report-chart-wrap--employees">
            <canvas id="report-chart-employees" aria-label="${escapeHtmlFn(t("reports.employeeWorkloadAria"))}"></canvas>
          </div>
        </section>
      </div>
    </div>
    </div>`;
}

function renderCharts(data) {
  destroyAdminReportsCharts();
  const c = chartColors();
  const opts = baseChartOptions();
  const mobile = isReportMobile();

  const statusEl = document.getElementById("report-chart-status");
  if (statusEl) {
    chartInstances.status = new Chart(statusEl, {
      type: "doughnut",
      data: {
        labels: data.statusBreakdown.map((s) => s.label),
        datasets: [
          {
            data: data.statusBreakdown.map((s) => s.value),
            backgroundColor: data.statusBreakdown.map((s) => s.color),
            borderWidth: 0,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        ...opts,
        cutout: mobile ? "58%" : "62%",
        plugins: {
          ...opts.plugins,
          legend: {
            ...opts.plugins.legend,
            position: "bottom",
            align: "center",
          },
        },
        scales: undefined,
      },
    });
  }

  const listsEl = document.getElementById("report-chart-lists");
  if (listsEl && data.tasksByList.length) {
    const listsWrap = listsEl.closest(".admin-report-chart-wrap");
    setChartWrapHeight(listsWrap, data.tasksByList.length);
    const listLabels = data.tasksByList.map((r) => r.name);

    chartInstances.lists = new Chart(listsEl, {
      type: "bar",
      data: {
        labels: listLabels,
        datasets: [
          {
            label: t("reports.tasks"),
            data: data.tasksByList.map((r) => r.count),
            backgroundColor: c.primary,
            borderRadius: mobile ? 4 : 6,
            maxBarThickness: mobile ? 22 : 36,
          },
        ],
      },
      options: {
        ...opts,
        indexAxis: "y",
        plugins: { ...opts.plugins, legend: { display: false } },
        scales: {
          x: {
            ...opts.scales.x,
            ticks: { ...opts.scales.x.ticks, maxTicksLimit: mobile ? 5 : 10 },
          },
          y: {
            ...opts.scales.y,
            ticks: {
              ...opts.scales.y.ticks,
              callback(_value, index) {
                return truncateLabel(listLabels[index]);
              },
            },
          },
        },
      },
    });
  }

  const trendEl = document.getElementById("report-chart-trend");
  if (trendEl) {
    chartInstances.trend = new Chart(trendEl, {
      type: "line",
      data: {
        labels: data.tasksCreatedWeekly.labels,
        datasets: [
          {
            label: t("reports.tasksCreated"),
            data: data.tasksCreatedWeekly.values,
            borderColor: c.primary,
            backgroundColor: `${c.primary}33`,
            fill: true,
            tension: 0.35,
            pointRadius: mobile ? 2 : 3,
          },
          {
            label: t("reports.submitted"),
            data: data.submissionsWeekly.values,
            borderColor: c.secondary,
            backgroundColor: `${c.secondary}22`,
            fill: true,
            tension: 0.35,
            pointRadius: mobile ? 2 : 3,
          },
        ],
      },
      options: {
        ...opts,
        plugins: {
          ...opts.plugins,
          legend: { ...opts.plugins.legend, position: mobile ? "bottom" : "top" },
        },
      },
    });
  }

  const empEl = document.getElementById("report-chart-employees");
  if (empEl && data.employeePerformance.length) {
    const empWrap = empEl.closest(".admin-report-chart-wrap");
    const empNames = data.employeePerformance.map((e) => e.name);

    if (mobile) {
      setChartWrapHeight(empWrap, data.employeePerformance.length);
      chartInstances.employees = new Chart(empEl, {
        type: "bar",
        data: {
          labels: empNames,
          datasets: [
            {
              label: t("reports.assigned"),
              data: data.employeePerformance.map((e) => e.assigned),
              backgroundColor: c.surface,
              borderColor: c.primary,
              borderWidth: 1,
              borderRadius: 3,
              maxBarThickness: 18,
            },
            {
              label: t("reports.submitted"),
              data: data.employeePerformance.map((e) => e.submitted),
              backgroundColor: c.primary,
              borderRadius: 3,
              maxBarThickness: 18,
            },
            {
              label: t("reports.pending"),
              data: data.employeePerformance.map((e) => e.pending),
              backgroundColor: c.error,
              borderRadius: 3,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          ...opts,
          indexAxis: "y",
          plugins: {
            ...opts.plugins,
            legend: { ...opts.plugins.legend, position: "bottom" },
          },
          scales: {
            x: {
              ...opts.scales.x,
              ticks: { ...opts.scales.x.ticks, maxTicksLimit: 5 },
            },
            y: {
              ...opts.scales.y,
              ticks: {
                ...opts.scales.y.ticks,
                callback(_value, index) {
                  return truncateLabel(empNames[index], 12);
                },
              },
            },
          },
        },
      });
    } else {
      empWrap?.style.removeProperty("height");
      chartInstances.employees = new Chart(empEl, {
        type: "bar",
        data: {
          labels: empNames,
          datasets: [
            {
              label: t("reports.assigned"),
              data: data.employeePerformance.map((e) => e.assigned),
              backgroundColor: c.surface,
              borderColor: c.primary,
              borderWidth: 1,
              borderRadius: 4,
            },
            {
              label: t("reports.submitted"),
              data: data.employeePerformance.map((e) => e.submitted),
              backgroundColor: c.primary,
              borderRadius: 4,
            },
            {
              label: t("reports.pending"),
              data: data.employeePerformance.map((e) => e.pending),
              backgroundColor: c.error,
              borderRadius: 4,
            },
          ],
        },
        options: opts,
      });
    }
  }

  wireReportsResize();
}

function wireReportsPage(main) {
  main.querySelector(".js-reports-refresh")?.addEventListener("click", () => {
    void refreshAdminReports({ force: true });
  });
}

export async function refreshAdminReports({ force = false } = {}) {
  const main = document.getElementById("main-column");
  if (!main || !apiFn) return;

  const hasLayout = !!main.querySelector(".admin-reports-page");

  if (!force && reportData && hasLayout) {
    requestAnimationFrame(() => renderCharts(reportData));
    return;
  }

  if (!reportData || force) {
    main.innerHTML = `<div class="admin-reports-loading p-5 text-center text-muted">
      ${adminMsIconFn("hourglass_top")}
      <p class="mb-0 mt-2">${escapeHtmlFn(t("reports.loading"))}</p>
    </div>`;
  }

  try {
    if (!reportData || force) {
      reportData = await apiFn("/api/reports/summary");
    }
    main.innerHTML = reportPageHtml(reportData);
    wireReportsPage(main);
    if (wireChromeHeaderFn) wireChromeHeaderFn(main);
    requestAnimationFrame(() => renderCharts(reportData));
  } catch (err) {
    reportData = null;
    main.innerHTML = `<div class="admin-reports-error p-5 text-center">
      <p class="text-danger mb-2">${escapeHtmlFn(t("reports.loadError"))}</p>
      <p class="text-muted small mb-3">${escapeHtmlFn(err?.message || t("reports.unknownError"))}</p>
      <button type="button" class="btn btn-primary btn-sm js-reports-refresh">${escapeHtmlFn(t("reports.tryAgain"))}</button>
    </div>`;
    main.querySelector(".js-reports-refresh")?.addEventListener("click", () => {
      void refreshAdminReports({ force: true });
    });
  }
}

export function openOwnerReportsView() {
  void refreshAdminReports();
}

export function clearAdminReportsCache() {
  reportData = null;
  destroyAdminReportsCharts();
}