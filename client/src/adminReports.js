import { Chart } from "chart.js/auto";
import { tr, dateLocale } from "./i18n/index.js";
import { dt, ensureContentTranslations } from "./i18n/contentTranslate.js";

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

/** @type {any} */
let employeePerfData = null;

/** @type {{ employeeId: string, period: string }} */
let employeePerfFilters = { employeeId: "", period: "daily" };

/** @type {boolean} */
let employeePerfLoading = false;

/** @type {"full" | "owner-dashboard"} */
let reportViewMode = "full";

const PERIOD_BUCKET_COUNTS = { daily: 14, weekly: 12, monthly: 6 };

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
    renderEmployeePerfChart();
    renderMonthlyBudgetChart();
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
      <span>${tr("nav.reports")}</span>
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

function perfChartColors() {
  const dark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  return {
    onTime: dark ? "#66bb6a" : "#2e7d32",
    late: dark ? "#ffb74d" : "#e65100",
    pending: dark ? "#90a4ae" : "#78909c",
    allocated: dark ? "#4db6ac" : "#006d77",
  };
}

function statusBreakdownColors(labels) {
  const dark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const map = {
    Active: dark ? "#4db6ac" : "#006d77",
    "In review": dark ? "#ffb74d" : "#e65100",
    Completed: dark ? "#66bb6a" : "#2e7d32",
  };
  return labels.map((label) => map[label] ?? (dark ? "#90a4ae" : "#78909c"));
}

function formatReportDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(dateLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function formatBudgetMinutes(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}

function budgetMonthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" });
}

function recurrenceLabel(recurrence) {
  const map = {
    none: tr("owner.recurrenceNoRepeat"),
    daily: tr("owner.recurrenceDaily"),
    weekly: tr("owner.recurrenceWeekly"),
    monthly: tr("owner.recurrenceMonthly"),
    yearly: tr("owner.recurrenceYearly"),
    custom: tr("owner.recurrenceCustom"),
  };
  return map[recurrence] ?? recurrence;
}

function utilizationBarHtml(pct, overBudget = false) {
  const width = Math.min(100, Math.max(0, pct));
  const mod = overBudget ? " owner-dash-budget-bar--over" : pct >= 90 ? " owner-dash-budget-bar--warn" : "";
  return `<div class="owner-dash-budget-bar${mod}" role="progressbar" aria-valuenow="${escapeHtmlFn(String(Math.round(pct)))}" aria-valuemin="0" aria-valuemax="100">
    <div class="owner-dash-budget-bar-fill" style="width: ${width}%"></div>
  </div>`;
}

function personInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function rolePillHtml(role) {
  const isAdmin = role === "admin";
  const cls = isAdmin ? "owner-dash-role-pill--admin" : "owner-dash-role-pill--employee";
  const label = isAdmin ? tr("common.admin") : tr("common.employee");
  const icon = isAdmin ? "admin_panel_settings" : "badge";
  return `<span class="owner-dash-role-pill ${cls}">${adminMsIconFn(icon, "owner-dash-role-pill-icon")}<span>${escapeHtmlFn(label)}</span></span>`;
}

function personAvatarHtml(name, role) {
  const cls = role === "admin" ? "owner-dash-person-avatar--admin" : "owner-dash-person-avatar--employee";
  return `<div class="owner-dash-person-avatar ${cls}" aria-hidden="true">${escapeHtmlFn(personInitials(name))}</div>`;
}

function adminPersonChipHtml(name) {
  if (!name) return `<span class="text-muted">—</span>`;
  const safe = escapeHtmlFn(dt(name));
  return `<span class="owner-dash-inline-person owner-dash-inline-person--admin" title="${safe}">
    <span class="owner-dash-inline-person-avatar">${escapeHtmlFn(personInitials(name))}</span>
    <span class="owner-dash-inline-person-name">${safe}</span>
  </span>`;
}

function employeeFocusBannerHtml(empName, periodHint) {
  if (!empName) return "";
  return `<div class="owner-dash-employee-banner">
    ${personAvatarHtml(empName, "employee")}
    <div class="owner-dash-employee-banner-body">
      ${rolePillHtml("employee")}
      <h3 class="owner-dash-employee-banner-name">${escapeHtmlFn(dt(empName))}</h3>
      <p class="owner-dash-employee-banner-hint mb-0">${escapeHtmlFn(periodHint)}</p>
    </div>
  </div>`;
}

function adminStatCell(value, label, modifier = "") {
  const mod = modifier ? ` owner-dash-admin-stat--${modifier}` : "";
  return `<div class="owner-dash-admin-stat${mod}">
    <span class="owner-dash-admin-stat-value tabular-nums">${escapeHtmlFn(String(value))}</span>
    <span class="owner-dash-admin-stat-label">${escapeHtmlFn(label)}</span>
  </div>`;
}

function lateSubmissionsTableHtml(items, showAdmin = false) {
  if (!items) return "";
  const rows = items.length
    ? items
        .map((row) => {
          const lateLabel = tr("reports.submittedLateByDays", { count: row.lateDays });
          const adminCell = showAdmin
            ? `<td class="text-nowrap">${adminPersonChipHtml(row.assignedBy?.name)}</td>`
            : "";
          return `<tr>
            <td class="admin-report-late-task">${escapeHtmlFn(dt(row.title))}</td>
            ${adminCell}
            <td class="tabular-nums text-nowrap">${escapeHtmlFn(formatReportDateTime(row.dueAt))}</td>
            <td class="tabular-nums text-nowrap">${escapeHtmlFn(formatReportDateTime(row.submittedAt))}</td>
            <td class="admin-report-late-days text-danger fw-semibold text-nowrap">${escapeHtmlFn(lateLabel)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${showAdmin ? 5 : 4}" class="text-muted small py-3">${escapeHtmlFn(tr("reports.noLateSubmissions"))}</td></tr>`;

  const adminHeader = showAdmin
    ? `<th scope="col">${escapeHtmlFn(tr("reports.assignedByAdmin"))}</th>`
    : "";

  return `<div class="admin-report-late-section mt-3">
    <h3 class="admin-report-late-title h6 mb-2">${escapeHtmlFn(tr("reports.lateSubmissions"))}</h3>
    <div class="table-responsive admin-report-late-table-wrap">
      <table class="table table-sm admin-report-late-table mb-0">
        <thead>
          <tr>
            <th scope="col">${escapeHtmlFn(tr("reports.taskColumn"))}</th>
            ${adminHeader}
            <th scope="col">${escapeHtmlFn(tr("reports.deadlineColumn"))}</th>
            <th scope="col">${escapeHtmlFn(tr("reports.submittedColumn"))}</th>
            <th scope="col">${escapeHtmlFn(tr("reports.daysLateColumn"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function byAdminSectionHtml(byAdmin, totals) {
  if (!byAdmin?.length) {
    return `<p class="admin-report-by-admin-empty text-muted small mb-0">${escapeHtmlFn(tr("reports.noAdminAllocations"))}</p>`;
  }

  const cards = byAdmin
    .map(
      (row) => `<article class="owner-dash-admin-card">
      <div class="owner-dash-admin-card-head">
        ${personAvatarHtml(row.name, "admin")}
        <div class="owner-dash-admin-card-identity">
          ${rolePillHtml("admin")}
          <h4 class="owner-dash-admin-card-name">${escapeHtmlFn(dt(row.name))}</h4>
        </div>
      </div>
      <div class="owner-dash-admin-stats">
        ${adminStatCell(row.allocated, tr("reports.allocated"), "allocated")}
        ${adminStatCell(row.onTime, tr("reports.onTime"), "ontime")}
        ${adminStatCell(row.late, tr("reports.late"), "late")}
        ${adminStatCell(row.pending, tr("reports.pending"), "pending")}
      </div>
    </article>`
    )
    .join("");

  const totalCard = totals
    ? `<article class="owner-dash-admin-card owner-dash-admin-card--total" aria-label="${escapeHtmlFn(tr("reports.total"))}">
      <div class="owner-dash-admin-card-head">
        <div class="owner-dash-person-avatar owner-dash-person-avatar--total">${adminMsIconFn("summarize")}</div>
        <div class="owner-dash-admin-card-identity">
          <span class="owner-dash-role-pill owner-dash-role-pill--total">${escapeHtmlFn(tr("reports.total"))}</span>
          <h4 class="owner-dash-admin-card-name">${escapeHtmlFn(tr("reports.allAdminsCombined"))}</h4>
        </div>
      </div>
      <div class="owner-dash-admin-stats">
        ${adminStatCell(totals.allocated, tr("reports.allocated"), "allocated")}
        ${adminStatCell(totals.onTime, tr("reports.onTime"), "ontime")}
        ${adminStatCell(totals.late, tr("reports.late"), "late")}
        ${adminStatCell(totals.pending, tr("reports.pending"), "pending")}
      </div>
    </article>`
    : "";

  return `<div class="owner-dash-admin-section">
    <header class="owner-dash-section-head">
      <div class="owner-dash-section-head-icon owner-dash-section-head-icon--admin">${adminMsIconFn("admin_panel_settings")}</div>
      <div>
        <h3 class="owner-dash-section-title">${escapeHtmlFn(tr("reports.tasksByAdmin"))}</h3>
        <p class="owner-dash-section-subtitle mb-0">${escapeHtmlFn(tr("reports.tasksByAdminHint"))}</p>
      </div>
    </header>
    <div class="owner-dash-admin-grid">${cards}${totalCard}</div>
  </div>`;
}

function employeeBudgetSummaryCardHtml(emp, monthlyBudgetMinutes) {
  const over = emp.usedMinutes > monthlyBudgetMinutes;
  const remainingCls = over ? "text-danger fw-semibold" : "";
  const pctLabel = `${emp.utilizationPct}%`;
  return `<article class="owner-dash-budget-emp-card${over ? " owner-dash-budget-emp-card--over" : ""}">
    <div class="owner-dash-budget-emp-card-head">
      <div class="owner-dash-budget-employee">
        ${personAvatarHtml(emp.name, "employee")}
        <span class="text-truncate">${escapeHtmlFn(dt(emp.name))}</span>
      </div>
      <span class="owner-dash-budget-emp-card-pct tabular-nums">${escapeHtmlFn(pctLabel)}</span>
    </div>
    ${utilizationBarHtml(emp.utilizationPct, over)}
    <dl class="owner-dash-budget-emp-card-stats">
      <div>
        <dt>${escapeHtmlFn(tr("owner.monthlyCapacityBudget"))}</dt>
        <dd class="tabular-nums">${escapeHtmlFn(formatBudgetMinutes(monthlyBudgetMinutes))}</dd>
      </div>
      <div>
        <dt>${escapeHtmlFn(tr("owner.monthlyCapacityUsed"))}</dt>
        <dd class="tabular-nums">${escapeHtmlFn(formatBudgetMinutes(emp.usedMinutes))}</dd>
      </div>
      <div>
        <dt>${escapeHtmlFn(tr("owner.monthlyCapacityRemaining"))}</dt>
        <dd class="tabular-nums ${remainingCls}">${escapeHtmlFn(formatBudgetMinutes(emp.remainingMinutes))}${over ? ` (+${escapeHtmlFn(formatBudgetMinutes(emp.overBudgetMinutes))})` : ""}</dd>
      </div>
    </dl>
  </article>`;
}

function taskBudgetBreakdownCardHtml(emp, task) {
  const recur = recurrenceLabel(task.recurrence);
  const occ =
    task.occurrencesPerMonth > 1
      ? tr("owner.monthlyCapacityOccurrences", { count: task.occurrencesPerMonth })
      : "";
  return `<article class="owner-dash-budget-task-card">
    <div class="owner-dash-budget-task-card-top">
      <div class="owner-dash-budget-employee owner-dash-budget-employee--compact">
        ${personAvatarHtml(emp.name, "employee")}
        <span class="text-truncate">${escapeHtmlFn(dt(emp.name))}</span>
      </div>
      <span class="owner-dash-budget-task-card-cost tabular-nums">${escapeHtmlFn(formatBudgetMinutes(task.monthlyMinutes))} <span class="owner-dash-budget-task-card-cost-unit">min</span></span>
    </div>
    <h4 class="owner-dash-budget-task-card-title">${escapeHtmlFn(dt(task.title))}</h4>
    <p class="owner-dash-budget-task-card-meta mb-0">
      <span>${escapeHtmlFn(dt(task.listTitle))}</span>
      <span aria-hidden="true">·</span>
      <span>${escapeHtmlFn(formatBudgetMinutes(task.durationMinutes))} min</span>
      <span aria-hidden="true">·</span>
      <span>${escapeHtmlFn(recur)}${occ ? ` (${escapeHtmlFn(occ)})` : ""}</span>
    </p>
  </article>`;
}

function monthlyMinuteBudgetSectionHtml(data) {
  const budget = data.monthlyMinuteBudget;
  if (!budget) return "";

  const { employees = [], totals = {}, monthlyBudgetMinutes, budgetYear, budgetMonth } = budget;
  const monthLabel = budgetMonthLabel(budgetYear, budgetMonth);

  const kpiRow = `<div class="admin-report-emp-kpi-grid owner-dash-budget-kpis">
    ${kpiCard(tr("owner.monthlyCapacityEmployees"), totals.employeeCount ?? 0, "groups")}
    ${kpiCard(tr("owner.monthlyCapacityUsed"), formatBudgetMinutes(totals.totalUsedMinutes ?? 0), "schedule", "review")}
    ${kpiCard(tr("owner.monthlyCapacityRemaining"), formatBudgetMinutes(totals.totalRemainingMinutes ?? 0), "hourglass_top", "done")}
    ${kpiCard(
      tr("owner.monthlyCapacityOverBudgetCount"),
      totals.overBudgetEmployeeCount ?? 0,
      "warning",
      (totals.overBudgetEmployeeCount ?? 0) > 0 ? "warn" : ""
    )}
  </div>`;

  const summaryRows = employees.length
    ? employees
        .map((emp) => {
          const over = emp.usedMinutes > monthlyBudgetMinutes;
          const pctLabel = `${emp.utilizationPct}%`;
          const remainingCls = over ? "text-danger fw-semibold" : "";
          return `<tr class="${over ? "owner-dash-budget-row--over" : ""}">
            <td class="owner-dash-budget-employee">
              ${personAvatarHtml(emp.name, "employee")}
              <span>${escapeHtmlFn(dt(emp.name))}</span>
            </td>
            <td class="tabular-nums text-nowrap">${escapeHtmlFn(formatBudgetMinutes(monthlyBudgetMinutes))}</td>
            <td class="tabular-nums text-nowrap">${escapeHtmlFn(formatBudgetMinutes(emp.usedMinutes))}</td>
            <td class="tabular-nums text-nowrap ${remainingCls}">${escapeHtmlFn(formatBudgetMinutes(emp.remainingMinutes))}${over ? ` (+${escapeHtmlFn(formatBudgetMinutes(emp.overBudgetMinutes))})` : ""}</td>
            <td class="owner-dash-budget-util-cell">
              <span class="owner-dash-budget-util-pct tabular-nums">${escapeHtmlFn(pctLabel)}</span>
              ${utilizationBarHtml(emp.utilizationPct, over)}
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="text-muted small py-3">${escapeHtmlFn(tr("reports.noEmployeesWithTasks"))}</td></tr>`;

  const taskRows = employees.flatMap((emp) =>
    emp.tasks.map((task) => {
      const recur = recurrenceLabel(task.recurrence);
      const occ =
        task.occurrencesPerMonth > 1
          ? tr("owner.monthlyCapacityOccurrences", { count: task.occurrencesPerMonth })
          : "";
      return `<tr>
        <td class="owner-dash-budget-employee">
          ${personAvatarHtml(emp.name, "employee")}
          <span>${escapeHtmlFn(dt(emp.name))}</span>
        </td>
        <td>${escapeHtmlFn(dt(task.title))}</td>
        <td class="text-muted small">${escapeHtmlFn(dt(task.listTitle))}</td>
        <td class="tabular-nums text-nowrap">${escapeHtmlFn(formatBudgetMinutes(task.durationMinutes))}</td>
        <td class="text-nowrap small">${escapeHtmlFn(recur)}${occ ? ` <span class="text-muted">(${escapeHtmlFn(occ)})</span>` : ""}</td>
        <td class="tabular-nums text-nowrap fw-semibold">${escapeHtmlFn(formatBudgetMinutes(task.monthlyMinutes))}</td>
      </tr>`;
    })
  );

  const taskTableBody = taskRows.length
    ? taskRows.join("")
    : `<tr><td colspan="6" class="text-muted small py-3">${escapeHtmlFn(tr("owner.monthlyCapacityNoTasks"))}</td></tr>`;

  const chartBlock =
    employees.length > 0
      ? `<div class="admin-report-chart-wrap admin-report-chart-wrap--tall admin-report-chart-wrap--budget">
          <canvas id="report-chart-monthly-budget" aria-label="${escapeHtmlFn(tr("owner.monthlyCapacityChartAria"))}"></canvas>
        </div>`
      : "";

  const summaryMobile = employees.length
    ? `<div class="owner-dash-budget-mobile-list d-md-none">${employees.map((emp) => employeeBudgetSummaryCardHtml(emp, monthlyBudgetMinutes)).join("")}</div>`
    : `<p class="text-muted small py-2 mb-0 d-md-none">${escapeHtmlFn(tr("reports.noEmployeesWithTasks"))}</p>`;

  const taskMobile = taskRows.length
    ? `<div class="owner-dash-budget-mobile-list d-md-none">${employees
        .flatMap((emp) => emp.tasks.map((task) => taskBudgetBreakdownCardHtml(emp, task)))
        .join("")}</div>`
    : `<p class="text-muted small py-2 mb-0 d-md-none">${escapeHtmlFn(tr("owner.monthlyCapacityNoTasks"))}</p>`;

  return `<section class="admin-report-card admin-report-card--wide owner-dash-budget-card">
    <header class="owner-dash-section-header mb-3">
      <div>
        <h2 class="admin-report-card-title mb-1">${escapeHtmlFn(tr("owner.monthlyCapacityTitle"))}</h2>
        <p class="owner-dash-section-subtitle mb-0">${escapeHtmlFn(tr("owner.monthlyCapacitySubtitle", { month: monthLabel, budget: formatBudgetMinutes(monthlyBudgetMinutes) }))}</p>
      </div>
    </header>
    ${kpiRow}
    ${chartBlock}
    ${summaryMobile}
    <div class="table-responsive owner-dash-budget-table-wrap mt-3 d-none d-md-block">
      <table class="table table-sm admin-report-table owner-dash-budget-table mb-0">
        <thead>
          <tr>
            <th>${escapeHtmlFn(tr("common.employee"))}</th>
            <th class="text-nowrap">${escapeHtmlFn(tr("owner.monthlyCapacityBudget"))}</th>
            <th class="text-nowrap">${escapeHtmlFn(tr("owner.monthlyCapacityUsed"))}</th>
            <th class="text-nowrap">${escapeHtmlFn(tr("owner.monthlyCapacityRemaining"))}</th>
            <th>${escapeHtmlFn(tr("owner.monthlyCapacityUtilization"))}</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>
    <h3 class="owner-dash-budget-breakdown-title mt-4 mb-2">${escapeHtmlFn(tr("owner.monthlyCapacityTaskBreakdown"))}</h3>
    ${taskMobile}
    <div class="table-responsive owner-dash-budget-table-wrap d-none d-md-block">
      <table class="table table-sm admin-report-table owner-dash-budget-table mb-0">
        <thead>
          <tr>
            <th>${escapeHtmlFn(tr("common.employee"))}</th>
            <th>${escapeHtmlFn(tr("owner.tableTaskTitle"))}</th>
            <th>${escapeHtmlFn(tr("tasks.list"))}</th>
            <th class="text-nowrap">${escapeHtmlFn(tr("owner.monthlyCapacityDuration"))}</th>
            <th>${escapeHtmlFn(tr("owner.tableRecurrence"))}</th>
            <th class="text-nowrap">${escapeHtmlFn(tr("owner.monthlyCapacityMonthlyCost"))}</th>
          </tr>
        </thead>
        <tbody>${taskTableBody}</tbody>
      </table>
    </div>
  </section>`;
}

function renderMonthlyBudgetChart() {
  destroyChart("monthlyBudget");
  const budget = reportData?.monthlyMinuteBudget;
  if (!budget?.employees?.length) return;

  const el = document.getElementById("report-chart-monthly-budget");
  if (!el) return;

  const colors = perfChartColors();
  const opts = baseChartOptions();
  const mobile = isReportMobile();
  const employees = budget.employees;
  const wrap = el.closest(".admin-report-chart-wrap--budget");
  if (wrap) setChartWrapHeight(wrap, employees.length);

  chartInstances.monthlyBudget = new Chart(el, {
    type: "bar",
    data: {
      labels: employees.map((e) => truncateLabel(e.name, mobile ? 12 : 20)),
      datasets: [
        {
          label: tr("owner.monthlyCapacityUsed"),
          data: employees.map((e) => e.usedMinutes),
          backgroundColor: colors.late,
          borderRadius: 4,
          stack: "capacity",
        },
        {
          label: tr("owner.monthlyCapacityRemaining"),
          data: employees.map((e) => e.remainingMinutes),
          backgroundColor: colors.onTime,
          borderRadius: 4,
          stack: "capacity",
        },
      ],
    },
    options: {
      ...opts,
      indexAxis: "y",
      plugins: {
        ...opts.plugins,
        legend: { ...opts.plugins.legend, position: mobile ? "bottom" : "top" },
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: {
            label(ctx) {
              const val = Number(ctx.raw) || 0;
              return `${ctx.dataset.label}: ${formatBudgetMinutes(val)} min`;
            },
          },
        },
      },
      scales: {
        x: {
          ...opts.scales.x,
          stacked: true,
          ticks: {
            ...opts.scales.x.ticks,
            callback: (v) => formatBudgetMinutes(v),
          },
        },
        y: {
          ...opts.scales.y,
          stacked: true,
        },
      },
    },
  });
}

function employeePerfSectionHtml(data) {
  const employees = data.employeeOptions ?? [];
  const selectedId = employeePerfFilters.employeeId || employees[0]?.id || "";
  if (!employeePerfFilters.employeeId && selectedId) {
    employeePerfFilters.employeeId = selectedId;
  }

  const period = employeePerfFilters.period || "daily";
  const employeeOptions = employees
    .map(
      (e) =>
        `<option value="${escapeHtmlFn(e.id)}"${e.id === selectedId ? " selected" : ""}>${escapeHtmlFn(e.name)}</option>`
    )
    .join("");

  const periodOptions = ["daily", "weekly", "monthly"]
    .map(
      (p) =>
        `<option value="${p}"${p === period ? " selected" : ""}>${escapeHtmlFn(tr(`reports.period_${p}`))}</option>`
    )
    .join("");

  const totals = employeePerfData?.totals;
  const empName = employeePerfData?.employee?.name ?? employees.find((e) => e.id === selectedId)?.name ?? "";

  const kpiRow =
    totals && !employeePerfLoading
      ? `<div class="admin-report-emp-kpi-grid">
          ${kpiCard(tr("reports.allocated"), totals.allocated, "assignment", "active")}
          ${kpiCard(tr("reports.onTime"), totals.onTime, "schedule", "done")}
          ${kpiCard(tr("reports.late"), totals.late, "running_with_errors", "review")}
          ${kpiCard(tr("reports.pending"), totals.pending, "pending", totals.pending > 0 ? "warn" : "")}
        </div>`
      : "";

  const emptyEmployees =
    employees.length === 0
      ? `<p class="admin-report-emp-empty text-muted small mb-0">${escapeHtmlFn(tr("reports.noEmployeesWithTasks"))}</p>`
      : "";

  const chartBlock =
    employees.length > 0
      ? `<div class="admin-report-chart-wrap admin-report-chart-wrap--tall admin-report-chart-wrap--emp-perf">
          <canvas id="report-chart-employee-perf" aria-label="${escapeHtmlFn(tr("reports.employeePerfAria"))}"></canvas>
        </div>`
      : "";

  const lateTable =
    employees.length > 0 && !employeePerfLoading
      ? lateSubmissionsTableHtml(
          employeePerfData?.lateSubmissions ?? [],
          reportViewMode === "owner-dashboard"
        )
      : "";

  const byAdminBlock =
    reportViewMode === "owner-dashboard" && employees.length > 0 && !employeePerfLoading
      ? byAdminSectionHtml(employeePerfData?.byAdmin ?? [], employeePerfData?.totals)
      : "";

  const loadingHint = employeePerfLoading
    ? `<p class="admin-report-emp-loading small text-muted mb-2">${escapeHtmlFn(tr("reports.loadingEmployeePerf"))}</p>`
    : "";

  const periodHint = tr(`reports.periodHint_${period}`, {
    count: employeePerfData?.bucketCount ?? PERIOD_BUCKET_COUNTS[period] ?? 14,
  });

  const isOwnerDash = reportViewMode === "owner-dashboard";
  const sectionClass = isOwnerDash
    ? "admin-report-card admin-report-card--wide admin-report-card--employee-perf owner-dash-perf-card"
    : "admin-report-card admin-report-card--wide admin-report-card--employee-perf";

  const employeeFilterLabel = isOwnerDash
    ? `<span class="admin-report-filter-label owner-dash-filter-label owner-dash-filter-label--employee">${adminMsIconFn("badge", "owner-dash-filter-icon")}<span>${escapeHtmlFn(tr("reports.selectEmployee"))}</span></span>`
    : `<span class="admin-report-filter-label">${escapeHtmlFn(tr("reports.selectEmployee"))}</span>`;

  const periodFilterLabel = `<span class="admin-report-filter-label">${adminMsIconFn("calendar_month", "owner-dash-filter-icon")}<span>${escapeHtmlFn(tr("reports.selectPeriod"))}</span></span>`;

  const employeeBanner =
    isOwnerDash && empName && !employeePerfLoading
      ? employeeFocusBannerHtml(empName, periodHint)
      : !isOwnerDash && empName
        ? `<p class="admin-report-emp-name small mb-2"><strong>${escapeHtmlFn(empName)}</strong></p>`
        : "";

  const headSubtitle = isOwnerDash
    ? `<p class="admin-report-emp-subtitle text-muted small mb-0">${escapeHtmlFn(tr("owner.ownerDashboardPerfHint"))}</p>`
    : `<p class="admin-report-emp-subtitle text-muted small mb-0">${escapeHtmlFn(periodHint)}</p>`;

  const chartSection =
    employees.length > 0
      ? `<div class="owner-dash-chart-section">
          <header class="owner-dash-section-head owner-dash-section-head--compact">
            <div class="owner-dash-section-head-icon owner-dash-section-head-icon--chart">${adminMsIconFn("bar_chart")}</div>
            <div>
              <h3 class="owner-dash-section-title">${escapeHtmlFn(tr("reports.performanceTrend"))}</h3>
              <p class="owner-dash-section-subtitle mb-0">${escapeHtmlFn(periodHint)}</p>
            </div>
          </header>
          ${chartBlock}
        </div>`
      : chartBlock;

  const lateSection =
    employees.length > 0 && !employeePerfLoading && isOwnerDash
      ? `<div class="owner-dash-late-section">${lateTable}</div>`
      : lateTable;

  return `
    <section class="${sectionClass}">
      <div class="admin-report-emp-head">
        <div>
          <h2 class="admin-report-card-title mb-1">${escapeHtmlFn(isOwnerDash ? tr("owner.ownerDashboardPerfTitle") : tr("reports.employeePerformance"))}</h2>
          ${headSubtitle}
        </div>
        <div class="admin-report-emp-filters${isOwnerDash ? " owner-dash-emp-filters" : ""}">
          <label class="admin-report-filter${isOwnerDash ? " owner-dash-filter owner-dash-filter--employee" : ""}">
            ${employeeFilterLabel}
            <select class="form-select form-select-sm js-report-employee${isOwnerDash ? " owner-dash-select owner-dash-select--employee" : ""}" ${employees.length === 0 ? "disabled" : ""}>
              ${employees.length ? employeeOptions : `<option value="">${escapeHtmlFn(tr("reports.noEmployees"))}</option>`}
            </select>
          </label>
          <label class="admin-report-filter${isOwnerDash ? " owner-dash-filter" : ""}">
            ${isOwnerDash ? periodFilterLabel : `<span class="admin-report-filter-label">${escapeHtmlFn(tr("reports.selectPeriod"))}</span>`}
            <select class="form-select form-select-sm js-report-period${isOwnerDash ? " owner-dash-select" : ""}" ${employees.length === 0 ? "disabled" : ""}>
              ${periodOptions}
            </select>
          </label>
        </div>
      </div>
      ${employeeBanner}
      ${loadingHint}
      ${kpiRow}
      ${byAdminBlock}
      ${emptyEmployees}
      ${isOwnerDash ? chartSection : chartBlock}
      ${isOwnerDash ? lateSection : lateTable}
    </section>`;
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

function ownerDashboardPageHtml(data) {
  const generated = new Date(data.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
    <div class="admin-main-scroll d-flex flex-column">
      ${chromeHeaderFn ? chromeHeaderFn() : ""}
    <div class="admin-reports-page admin-owner-dashboard-page">
      <header class="admin-reports-header">
        <div>
          <h2 class="admin-reports-title mb-1">${escapeHtmlFn(tr("owner.ownerDashboardTitle"))}</h2>
          <p class="admin-reports-subtitle text-muted mb-0">${escapeHtmlFn(tr("owner.ownerDashboardSubtitle"))}</p>
        </div>
        <div class="admin-reports-header-actions">
          <span class="admin-reports-updated small text-muted">${escapeHtmlFn(tr("reports.updated", { time: generated }))}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary js-reports-refresh">
            ${adminMsIconFn("refresh")}
            ${escapeHtmlFn(tr("common.refresh"))}
          </button>
        </div>
      </header>

      <div class="admin-reports-charts admin-reports-charts--owner-dashboard">
        ${monthlyMinuteBudgetSectionHtml(data)}
        ${employeePerfSectionHtml(data)}
      </div>
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
          <p class="admin-reports-subtitle text-muted mb-0">${escapeHtmlFn(tr("reports.subtitle"))}</p>
        </div>
        <div class="admin-reports-header-actions">
          <span class="admin-reports-updated small text-muted">${escapeHtmlFn(tr("reports.updated", { time: generated }))}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary js-reports-refresh">
            ${adminMsIconFn("refresh")}
            ${escapeHtmlFn(tr("common.refresh"))}
          </button>
        </div>
      </header>

      <div class="admin-report-kpi-grid">
        ${kpiCard(tr("reports.totalTasks"), o.totalTasks, "assignment")}
        ${kpiCard(tr("reports.active"), o.active, "bolt", "active")}
        ${kpiCard(tr("reports.inReview"), o.inReview, "rate_review", "review")}
        ${kpiCard(tr("reports.completed"), o.completed, "check_circle", "done")}
        ${kpiCard(tr("reports.overdue"), o.overdue, "event_busy", o.overdue > 0 ? "warn" : "")}
        ${kpiCard(tr("reports.submissions"), o.totalSubmissions, "upload_file")}
        ${kpiCard(tr("reports.employees"), o.employeeCount, "groups")}
        ${kpiCard(tr("reports.progressUpdates"), o.progressUpdates, "forum")}
        ${kpiCard(tr("reports.chat30Days"), o.chatMessages30d, "chat")}
        ${kpiCard(tr("reports.yourLists"), o.listCount, "folder")}
      </div>

      <div class="admin-reports-charts">
        ${employeePerfSectionHtml(data)}

        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">${escapeHtmlFn(tr("reports.taskStatus"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--doughnut">
            <canvas id="report-chart-status" aria-label="${escapeHtmlFn(tr("reports.taskStatusAria"))}"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart">
          <h2 class="admin-report-card-title">${escapeHtmlFn(tr("reports.tasksByList"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--lists">
            <canvas id="report-chart-lists" aria-label="${escapeHtmlFn(tr("reports.tasksByListAria"))}"></canvas>
          </div>
        </section>

        <section class="admin-report-card admin-report-card--chart admin-report-card--wide">
          <h2 class="admin-report-card-title">${escapeHtmlFn(tr("reports.employeeWorkload"))}</h2>
          <div class="admin-report-chart-wrap admin-report-chart-wrap--tall admin-report-chart-wrap--employees">
            <canvas id="report-chart-employees" aria-label="${escapeHtmlFn(tr("reports.employeeWorkloadAria"))}"></canvas>
          </div>
        </section>
      </div>
    </div>
    </div>`;
}

function renderEmployeePerfChart() {
  destroyChart("employeePerf");
  if (!employeePerfData?.series) return;

  const el = document.getElementById("report-chart-employee-perf");
  if (!el) return;

  const colors = perfChartColors();
  const opts = baseChartOptions();
  const mobile = isReportMobile();

  chartInstances.employeePerf = new Chart(el, {
    type: "bar",
    data: {
      labels: employeePerfData.labels,
      datasets: [
        {
          label: tr("reports.onTime"),
          data: employeePerfData.series.onTime,
          backgroundColor: colors.onTime,
          borderRadius: mobile ? 3 : 4,
          stack: "tasks",
        },
        {
          label: tr("reports.late"),
          data: employeePerfData.series.late,
          backgroundColor: colors.late,
          borderRadius: mobile ? 3 : 4,
          stack: "tasks",
        },
        {
          label: tr("reports.pending"),
          data: employeePerfData.series.pending,
          backgroundColor: colors.pending,
          borderRadius: mobile ? 3 : 4,
          stack: "tasks",
        },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        legend: {
          ...opts.plugins.legend,
          position: mobile ? "bottom" : "top",
        },
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: {
            footer(items) {
              const total = items.reduce((sum, item) => sum + (Number(item.raw) || 0), 0);
              return `${tr("reports.allocated")}: ${total}`;
            },
          },
        },
      },
      scales: {
        x: {
          ...opts.scales.x,
          stacked: true,
          ticks: {
            ...opts.scales.x.ticks,
            maxTicksLimit: mobile ? 7 : 14,
          },
        },
        y: {
          ...opts.scales.y,
          stacked: true,
          ticks: {
            ...opts.scales.y.ticks,
            maxTicksLimit: mobile ? 5 : 8,
          },
        },
      },
    },
  });
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
            backgroundColor: statusBreakdownColors(data.statusBreakdown.map((s) => s.label)),
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
            label: tr("reports.tasks"),
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
              label: tr("reports.assigned"),
              data: data.employeePerformance.map((e) => e.assigned),
              backgroundColor: c.surface,
              borderColor: c.primary,
              borderWidth: 1,
              borderRadius: 3,
              maxBarThickness: 18,
            },
            {
              label: tr("reports.submitted"),
              data: data.employeePerformance.map((e) => e.submitted),
              backgroundColor: c.primary,
              borderRadius: 3,
              maxBarThickness: 18,
            },
            {
              label: tr("reports.pending"),
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
              label: tr("reports.assigned"),
              data: data.employeePerformance.map((e) => e.assigned),
              backgroundColor: c.surface,
              borderColor: c.primary,
              borderWidth: 1,
              borderRadius: 4,
            },
            {
              label: tr("reports.submitted"),
              data: data.employeePerformance.map((e) => e.submitted),
              backgroundColor: c.primary,
              borderRadius: 4,
            },
            {
              label: tr("reports.pending"),
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

  renderEmployeePerfChart();
  wireReportsResize();
}

function wireReportsPage(main) {
  const refreshBtn = main.querySelector(".js-reports-refresh");
  if (refreshBtn && refreshBtn.dataset.wiredReports !== "1") {
    refreshBtn.dataset.wiredReports = "1";
    refreshBtn.addEventListener("click", () => {
      if (reportViewMode === "owner-dashboard") void refreshOwnerDashboard({ force: true });
      else void refreshAdminReports({ force: true });
    });
  }
  wireEmployeePerfFilters(main);
}

function wireEmployeePerfFilters(main) {
  main.querySelector(".js-report-employee")?.addEventListener("change", (e) => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    employeePerfFilters.employeeId = target.value;
    void loadEmployeePerformance(main);
  });

  main.querySelector(".js-report-period")?.addEventListener("change", (e) => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    employeePerfFilters.period = target.value;
    void loadEmployeePerformance(main);
  });
}

async function loadEmployeePerformance(main) {
  if (!apiFn || !employeePerfFilters.employeeId) return;

  employeePerfLoading = true;
  const section = main?.querySelector(".admin-report-card--employee-perf");
  if (section && reportData) {
    const replacement = document.createElement("div");
    replacement.innerHTML = employeePerfSectionHtml(reportData);
    const newSection = replacement.querySelector(".admin-report-card--employee-perf");
    if (newSection) {
      section.replaceWith(newSection);
      wireEmployeePerfFilters(main);
    }
  }

  try {
    const q = new URLSearchParams({
      employeeId: employeePerfFilters.employeeId,
      period: employeePerfFilters.period || "daily",
    });
    if (reportViewMode === "owner-dashboard") q.set("scope", "org");
    employeePerfData = await apiFn(`/api/reports/employee-performance?${q}`);
    const names = [
      ...(employeePerfData?.lateSubmissions ?? []).map((r) => r.title),
      ...(employeePerfData?.byAdmin ?? []).map((r) => r.name),
    ];
    await ensureContentTranslations(names);
  } catch {
    employeePerfData = null;
  } finally {
    employeePerfLoading = false;
  }

  if (main && reportData) {
    const sectionEl = main.querySelector(".admin-report-card--employee-perf");
    if (sectionEl) {
      const replacement = document.createElement("div");
      replacement.innerHTML = employeePerfSectionHtml(reportData);
      const newSection = replacement.querySelector(".admin-report-card--employee-perf");
      if (newSection) {
        sectionEl.replaceWith(newSection);
        wireEmployeePerfFilters(main);
      }
    }
    requestAnimationFrame(() => renderEmployeePerfChart());
  }
}

export function onReportsThemeChange() {
  if (!reportData || !document.querySelector(".admin-reports-page")) return;
  requestAnimationFrame(() => {
    if (reportViewMode === "full") renderCharts(reportData);
    renderEmployeePerfChart();
  });
}

export async function refreshAdminReports({ force = false } = {}) {
  reportViewMode = "full";
  const main = document.getElementById("main-column");
  if (!main || !apiFn) return;

  const hasLayout = !!main.querySelector(".admin-reports-page");

  if (!force && reportData && hasLayout) {
    requestAnimationFrame(() => {
      renderCharts(reportData);
      renderEmployeePerfChart();
    });
    return;
  }

  if (!reportData || force) {
    main.innerHTML = `<div class="admin-reports-loading p-5 text-center text-muted">
      ${adminMsIconFn("hourglass_top")}
      <p class="mb-0 mt-2">${escapeHtmlFn(tr("reports.loading"))}</p>
    </div>`;
  }

  try {
    if (!reportData || force) {
      reportData = await apiFn("/api/reports/summary");
      if (force) {
        employeePerfData = null;
        employeePerfFilters = { employeeId: "", period: employeePerfFilters.period || "daily" };
      }
    }
    main.innerHTML = reportPageHtml(reportData);
    wireReportsPage(main);
    if (wireChromeHeaderFn) wireChromeHeaderFn(main);
    requestAnimationFrame(() => {
      renderCharts(reportData);
      void loadEmployeePerformance(main);
    });
  } catch (err) {
    reportData = null;
    main.innerHTML = `<div class="admin-reports-error p-5 text-center">
      <p class="text-danger mb-2">${escapeHtmlFn(tr("reports.loadError"))}</p>
      <p class="text-muted small mb-3">${escapeHtmlFn(err?.message || tr("reports.unknownError"))}</p>
      <button type="button" class="btn btn-primary btn-sm js-reports-refresh">${escapeHtmlFn(tr("reports.tryAgain"))}</button>
    </div>`;
    main.querySelector(".js-reports-refresh")?.addEventListener("click", () => {
      void refreshAdminReports({ force: true });
    });
  }
}

export async function refreshOwnerDashboard({ force = false } = {}) {
  reportViewMode = "owner-dashboard";
  const main = document.getElementById("main-column");
  if (!main || !apiFn) return;

  const hasLayout = !!main.querySelector(".admin-owner-dashboard-page");

  if (!force && reportData && hasLayout) {
    requestAnimationFrame(() => {
      renderEmployeePerfChart();
      renderMonthlyBudgetChart();
    });
    return;
  }

  if (!reportData || force) {
    main.innerHTML = `<div class="admin-reports-loading p-5 text-center text-muted">
      ${adminMsIconFn("hourglass_top")}
      <p class="mb-0 mt-2">${escapeHtmlFn(tr("reports.loading"))}</p>
    </div>`;
  }

  try {
    if (!reportData || force) {
      reportData = await apiFn("/api/reports/owner-dashboard/summary");
      if (force) {
        employeePerfData = null;
        employeePerfFilters = { employeeId: "", period: employeePerfFilters.period || "daily" };
      }
    }
    main.innerHTML = ownerDashboardPageHtml(reportData);
    wireReportsPage(main);
    if (wireChromeHeaderFn) wireChromeHeaderFn(main);
    requestAnimationFrame(() => {
      renderMonthlyBudgetChart();
      void loadEmployeePerformance(main);
    });
  } catch (err) {
    reportData = null;
    main.innerHTML = `<div class="admin-reports-error p-5 text-center">
      <p class="text-danger mb-2">${escapeHtmlFn(tr("reports.loadError"))}</p>
      <p class="text-muted small mb-3">${escapeHtmlFn(err?.message || tr("reports.unknownError"))}</p>
      <button type="button" class="btn btn-primary btn-sm js-reports-refresh">${escapeHtmlFn(tr("reports.tryAgain"))}</button>
    </div>`;
    main.querySelector(".js-reports-refresh")?.addEventListener("click", () => {
      void refreshOwnerDashboard({ force: true });
    });
  }
}

export function openOwnerDashboardView() {
  reportViewMode = "owner-dashboard";
  void refreshOwnerDashboard();
}

export function openOwnerReportsView() {
  reportViewMode = "full";
  void refreshAdminReports();
}

export function clearAdminReportsCache() {
  reportData = null;
  employeePerfData = null;
  employeePerfFilters = { employeeId: "", period: "daily" };
  reportViewMode = "full";
  destroyAdminReportsCharts();
}