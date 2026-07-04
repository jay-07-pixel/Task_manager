import { tr } from "./i18n/index.js";
import {
  attendanceSettingsToggleHtml,
  wireAttendanceSettingsToggle,
  companyLiveLocationSettingsToggleHtml,
  wireCompanyLiveLocationToggle,
} from "./attendance.js";
import {
  isPushSupported,
  isPushSubscribed,
  preparePushInfrastructure,
  requestNotificationPermissionForAlarms,
  runPushRegistrationDuringGesture,
  unsubscribeFromPush,
} from "./sw-register.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((s: string) => string) | null} */
let escapeHtmlFn = null;

/** @type {((name: string, extraClass?: string) => string) | null} */
let adminMsIconFn = null;

/** @type {(() => string) | null} */
let ownerChromeHeaderFn = null;

/** @type {(() => string) | null} */
let employeeChromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireOwnerChromeHeaderFn = null;

/** @type {((main: HTMLElement) => void) | null} */
let wireEmployeeChromeHeaderFn = null;

/** @type {(() => void) | null} */
let onOpenMyProfileFn = null;

/** @type {(() => void) | null} */
let onToggleThemeFn = null;

/** @type {(() => any) | null} */
let getUserFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {((enabled: boolean) => void) | null} */
let onCompanyLiveLocationChangedFn = null;

let visitUrl = "https://kalpanik.in/";

export function initAdminSettings({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  employeeChromeHeader,
  wireOwnerChromeHeader,
  wireEmployeeChromeHeader,
  onOpenMyProfile,
  onToggleTheme,
  getUser,
  showToast,
  kalpanikWebsiteUrl,
  onCompanyLiveLocationChanged,
}) {
  apiFn = api;
  escapeHtmlFn = escapeHtml;
  adminMsIconFn = adminMsIcon;
  ownerChromeHeaderFn = ownerChromeHeader ?? null;
  employeeChromeHeaderFn = employeeChromeHeader ?? null;
  wireOwnerChromeHeaderFn = wireOwnerChromeHeader ?? null;
  wireEmployeeChromeHeaderFn = wireEmployeeChromeHeader ?? null;
  onOpenMyProfileFn = onOpenMyProfile ?? null;
  onToggleThemeFn = onToggleTheme ?? null;
  getUserFn = getUser ?? null;
  showToastFn = showToast ?? null;
  onCompanyLiveLocationChangedFn = onCompanyLiveLocationChanged ?? null;
  if (kalpanikWebsiteUrl) visitUrl = kalpanikWebsiteUrl;
}

function settingsRowHtml({ icon, label, extraClass = "", attrs = "", tag = "button" }) {
  const inner = `${adminMsIconFn?.(icon) ?? ""}<span class="admin-settings-row-label">${escapeHtmlFn?.(label) ?? label}</span>${extraClass.includes("admin-settings-row--link") ? adminMsIconFn?.("open_in_new", "admin-settings-row-chevron") ?? "" : adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}`;
  if (tag === "a") {
    return `<a class="admin-settings-row ${extraClass}" ${attrs}>${inner}</a>`;
  }
  return `<button type="button" class="admin-settings-row ${extraClass}" ${attrs}>${inner}</button>`;
}

function ownerSettingsRowsHtml() {
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const rows = [
    settingsRowHtml({
      icon: "account_circle",
      label: tr("profile.myProfile"),
      extraClass: "js-open-my-profile",
    }),
    settingsRowHtml({
      icon: isDark ? "light_mode" : "dark_mode",
      label: tr("owner.themeToggle"),
      extraClass: "js-admin-theme-toggle",
    }),
    settingsRowHtml({
      icon: "language",
      label: tr("common.visitUs"),
      extraClass: "admin-settings-row--link",
      tag: "a",
      attrs: `href="${escapeHtmlFn?.(visitUrl) ?? visitUrl}" target="_blank" rel="noopener noreferrer"`,
    }),
    settingsRowHtml({
      icon: "admin_panel_settings",
      label: tr("owner.manageAdmin"),
      extraClass: "js-admin-manage-admin",
      attrs: 'data-bs-toggle="modal" data-bs-target="#teamAdminModal"',
    }),
    settingsRowHtml({
      icon: "person",
      label: tr("owner.switchToUserView"),
      extraClass: "js-switch-account-view",
      attrs: 'data-view-role="employee"',
    }),
  ];

  rows.push(companyLiveLocationSettingsToggleHtml());

  if (isPushSupported()) {
    rows.push(`<div class="admin-settings-row admin-settings-row--toggle">
      <span class="admin-settings-row-left">
        ${adminMsIconFn?.("notifications") ?? ""}
        <span class="admin-settings-row-label">${escapeHtmlFn?.(tr("settings.manageNotifications")) ?? ""}</span>
      </span>
      <label class="admin-settings-switch">
        <input type="checkbox" class="admin-settings-switch-input js-admin-notifications-toggle" aria-label="${escapeHtmlFn?.(tr("settings.manageNotifications")) ?? ""}" />
        <span class="admin-settings-switch-track" aria-hidden="true"></span>
      </label>
    </div>`);
  }

  return rows.join("");
}

function employeeSettingsRowsHtml() {
  const user = getUserFn?.();
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const rows = [
    settingsRowHtml({
      icon: "account_circle",
      label: tr("profile.myProfile"),
      extraClass: "js-open-my-profile",
    }),
    settingsRowHtml({
      icon: isDark ? "light_mode" : "dark_mode",
      label: tr("owner.themeToggle"),
      extraClass: "js-admin-theme-toggle",
    }),
    settingsRowHtml({
      icon: "language",
      label: tr("common.visitUs"),
      extraClass: "admin-settings-row--link",
      tag: "a",
      attrs: `href="${escapeHtmlFn?.(visitUrl) ?? visitUrl}" target="_blank" rel="noopener noreferrer"`,
    }),
  ];

  if (user?.isAdmin) {
    rows.push(
      settingsRowHtml({
        icon: "admin_panel_settings",
        label: tr("owner.switchToAdminView"),
        extraClass: "js-switch-account-view",
        attrs: 'data-view-role="owner"',
      })
    );
  }

  if (isPushSupported()) {
    rows.push(
      settingsRowHtml({
        icon: "notifications",
        label: tr("employee.enableChromeReminders"),
        extraClass: "js-emp-enable-push",
      })
    );
  }

  if (user?.role === "employee" && user?.liveLocationRequired !== false) {
    rows.push(attendanceSettingsToggleHtml());
  }

  return rows.join("");
}

function settingsPageHtml(role) {
  const rows = role === "owner" ? ownerSettingsRowsHtml() : employeeSettingsRowsHtml();
  const chromeHeader = role === "owner" ? ownerChromeHeaderFn?.() ?? "" : employeeChromeHeaderFn?.() ?? "";
  return `<div class="admin-main-scroll d-flex flex-column">
    ${chromeHeader}
    <div class="admin-settings-page">
      <p class="admin-settings-intro">${escapeHtmlFn?.(tr("settings.intro")) ?? ""}</p>
      <nav class="admin-settings-list" aria-label="${escapeHtmlFn?.(tr("settings.title")) ?? "Settings"}">
        ${rows}
      </nav>
    </div>
  </div>`;
}

async function syncNotificationsToggle(root) {
  const toggle = root.querySelector(".js-admin-notifications-toggle");
  if (!toggle) return;
  toggle.disabled = true;
  try {
    toggle.checked = await isPushSubscribed();
  } finally {
    toggle.disabled = false;
  }
}

function wireNotificationsToggle(root) {
  const toggle = root.querySelector(".js-admin-notifications-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";

  void syncNotificationsToggle(root);

  toggle.addEventListener("change", () => {
    const wantOn = toggle.checked;
    if (!apiFn) return;

    if (!wantOn) {
      toggle.disabled = true;
      void unsubscribeFromPush(apiFn).then(() => {
        showToastFn?.(tr("settings.notificationsTurnedOff"), "success");
        toggle.disabled = false;
      });
      return;
    }

    if (!isPushSupported()) {
      toggle.checked = false;
      showToastFn?.(tr("toast.browserNoReminders"), "warning");
      return;
    }

    if (Notification.permission === "denied") {
      toggle.checked = false;
      showToastFn?.(tr("toast.notificationsBlockedChrome"), "warning");
      return;
    }

    toggle.disabled = true;

    const finishEnable = (result) => {
      toggle.disabled = false;
      if (result.ok) {
        toggle.checked = true;
        showToastFn?.(tr("settings.notificationsTurnedOn"), "success");
        return;
      }
      toggle.checked = false;
      if (result.reason === "denied") {
        showToastFn?.(tr("toast.allowNotifications"), "warning");
      } else if (result.reason === "not-ready") {
        showToastFn?.(result.message || tr("toast.pullRefreshEnable"), "warning");
      } else if (result.reason === "no-vapid") {
        showToastFn?.(tr("toast.pushNotConfigured"), "danger");
      } else {
        showToastFn?.(result.message || tr("toast.tapEnableAgain"), "warning");
      }
    };

    const runSubscribe = () => {
      void preparePushInfrastructure(apiFn).then((ready) => {
        if (!ready) {
          finishEnable({ ok: false, reason: "not-ready" });
          return;
        }
        runPushRegistrationDuringGesture(apiFn, finishEnable);
      });
    };

    if (Notification.permission === "granted") {
      runSubscribe();
      return;
    }

    void requestNotificationPermissionForAlarms().then((perm) => {
      if (perm !== "granted") {
        finishEnable({ ok: false, reason: "denied" });
        return;
      }
      runSubscribe();
    });
  });
}

function wireSettingsPage(main, role) {
  main.querySelectorAll(".js-admin-theme-toggle").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      onToggleThemeFn?.();
      openSettingsView(role);
    });
  });

  main.querySelectorAll(".js-open-my-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenMyProfileFn?.());
  });

  wireNotificationsToggle(main);
  if (role === "owner") {
    wireCompanyLiveLocationToggle(main, {
      api: apiFn,
      showToast: showToastFn,
      onChanged: (enabled) => onCompanyLiveLocationChangedFn?.(enabled),
    });
  }
  if (role === "employee") {
    wireAttendanceSettingsToggle(main);
  }
}

function openSettingsView(role) {
  const mainId = role === "owner" ? "main-column" : "emp-main-column";
  const main = document.getElementById(mainId);
  if (!main) return;

  main.innerHTML = settingsPageHtml(role);
  wireSettingsPage(main, role);

  if (role === "owner") {
    wireOwnerChromeHeaderFn?.(main);
  } else {
    wireEmployeeChromeHeaderFn?.(main);
  }
}

export function openOwnerSettingsView() {
  openSettingsView("owner");
}

export function openEmployeeSettingsView() {
  openSettingsView("employee");
}

export function onSettingsThemeChange() {
  if (!document.querySelector(".admin-settings-page")) return;
  const ownerMain = document.getElementById("main-column")?.querySelector(".admin-settings-page");
  const empMain = document.getElementById("emp-main-column")?.querySelector(".admin-settings-page");
  if (ownerMain) openSettingsView("owner");
  else if (empMain) openSettingsView("employee");
}
