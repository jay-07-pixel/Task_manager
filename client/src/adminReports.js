import { Chart } from "chart.js/auto";

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
      <span>Reports</span>
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
}

function baseChartOptions() {
  const c = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: c.onSurfaceVariant, boxWidth: 12, padding: 14, font: { family: "Inter, system-ui, sans-serif" } },
      },
      tooltip: {
        backgroundColor: c.onSurface,
        titleFont: { family: "Inter, system-ui, sans-serif" },
        bodyFont: { family: "Inter, system-ui, sans-serif" },
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: { color: c.onSurfaceVariant, font: { size: 11 } },
        grid: { color: c.outline, drawBorder: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: c.onSurfaceVariant, font: { size: 11 }, precision: 0 },
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
          <p class="admin-reports-subtitle text-muted mb-0">Overview across all lists, employees, and activity</p>
        </div>
        <div class="admin-reports-header-actions">
          <span class="admin-reports-updated small text-muted">Updated ${escapeHtmlFn(generated)}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary js-reports-refresh">
            ${adminMsIconFn("refresh")}
            Refresh
          </button>
        </div>
      </header>

      <div class="admin-report-kpi-grid">
        ${kpiCard("Total tasks", o.totalTasks, "assignment")}
        ${kpiCard("Active", o.active, "bolt", "active")}
        ${kpiCard("In review", o.inReview, "rate_review", "review")}
        ${kpiCard("Completed", o.completed, "check_circle", "done")}
        ${kpiCard("Overdue", o.overdue, "event_busy", o.overdue > 0 ? "warn" : "")}
        ${kpiCard("Submissions", o.totalSubmissions, "upload_file")}
        ${kpiCard("Employees", o.employeeCount, "groups")}
        ${kpiCard("Progress updates", o.progressUpdates, "forum")}
        ${kpiCard("Chat (30 days)", o.chatMessages30d, "chat")}
        ${kpiCard("Your lists", o.listCount, "folder")}
      </div>

      <div class="admin-reports-charts">
        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">Task status</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--doughnut">
            <canvas id="report-chart-status" aria-label="Task status breakdown"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">Tasks by list</h2>
          <div class="admin-report-chart-wrap">
            <canvas id="report-chart-lists" aria-label="Tasks per list"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart admin-report-card--wide">
          <h2 class="admin-report-card-title">Activity trend (last 12 weeks)</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--tall">
            <canvas id="report-chart-trend" aria-label="Tasks created and submissions over time"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart admin-report-card--wide">
          <h2 class="admin-report-card-title">Employee workload</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--tall">
            <canvas id="report-chart-employees" aria-label="Assigned vs submitted per employee"></canvas>
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
        cutout: "62%",
        plugins: {
          ...opts.plugins,
          legend: { ...opts.plugins.legend, position: "bottom" },
        },
        scales: undefined,
      },
    });
  }

  const listsEl = document.getElementById("report-chart-lists");
  if (listsEl && data.tasksByList.length) {
    chartInstances.lists = new Chart(listsEl, {
      type: "bar",
      data: {
        labels: data.tasksByList.map((r) => r.name),
        datasets: [
          {
            label: "Tasks",
            data: data.tasksByList.map((r) => r.count),
            backgroundColor: c.primary,
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        ...opts,
        indexAxis: "y",
        plugins: { ...opts.plugins, legend: { display: false } },
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
            label: "Tasks created",
            data: data.tasksCreatedWeekly.values,
            borderColor: c.primary,
            backgroundColor: `${c.primary}33`,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
          },
          {
            label: "Submissions",
            data: data.submissionsWeekly.values,
            borderColor: c.secondary,
            backgroundColor: `${c.secondary}22`,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
          },
        ],
      },
      options: opts,
    });
  }

  const empEl = document.getElementById("report-chart-employees");
  if (empEl && data.employeePerformance.length) {
    chartInstances.employees = new Chart(empEl, {
      type: "bar",
      data: {
        labels: data.employeePerformance.map((e) => e.name),
        datasets: [
          {
            label: "Assigned",
            data: data.employeePerformance.map((e) => e.assigned),
            backgroundColor: c.surface,
            borderColor: c.primary,
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: "Submitted",
            data: data.employeePerformance.map((e) => e.submitted),
            backgroundColor: c.primary,
            borderRadius: 4,
          },
          {
            label: "Pending",
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
      <p class="mb-0 mt-2">Loading reports…</p>
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
      <p class="text-danger mb-2">Could not load reports</p>
      <p class="text-muted small mb-3">${escapeHtmlFn(err?.message || "Unknown error")}</p>
      <button type="button" class="btn btn-primary btn-sm js-reports-refresh">Try again</button>
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