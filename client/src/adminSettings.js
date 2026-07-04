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

/** @type {(() => void) | null} */
let onOpenCompanyProfileFn = null;

/** @type {(() => void) | null} */
let onOpenManageEmployeesFn = null;

/** @type {(() => void) | null} */
let onOpenManageLocationsFn = null;

export function initAdminSettings({
  api,
  escapeHtml,
  adminMsIcon,
  ownerChromeHeader,
  employeeChromeHeader,
  wireOwnerChromeHeader,
  wireEmployeeChromeHeader,
  onOpenMyProfile,
  onOpenCompanyProfile,
  onOpenManageEmployees,
  onOpenManageLocations,
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
  onOpenCompanyProfileFn = onOpenCompanyProfile ?? null;
  onOpenManageEmployeesFn = onOpenManageEmployees ?? null;
  onOpenManageLocationsFn = onOpenManageLocations ?? null;
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

function myProfileSettingsRowHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<button type="button" class="admin-settings-row js-open-my-profile" data-my-profile-row="1">
    ${adminMsIconFn?.("account_circle") ?? ""}
    <span class="admin-settings-row-label">${esc(tr("profile.myProfile"))}</span>
    <span class="admin-settings-row-status admin-settings-row-status--incomplete d-none" data-my-profile-status>${esc(tr("profile.sectionIncompleteTitle"))}</span>
    ${adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}
  </button>`;
}

function companyProfileSettingsRowHtml() {
  const esc = escapeHtmlFn ?? ((s) => String(s ?? ""));
  return `<button type="button" class="admin-settings-row js-open-company-profile" data-company-profile-row="1">
    ${adminMsIconFn?.("business") ?? ""}
    <span class="admin-settings-row-label">${esc(tr("profile.myCompanyDetails"))}</span>
    <span class="admin-settings-row-status admin-settings-row-status--incomplete d-none" data-company-profile-status>${esc(tr("profile.sectionIncompleteTitle"))}</span>
    ${adminMsIconFn?.("chevron_right", "admin-settings-row-chevron") ?? ""}
  </button>`;
}

function ownerSettingsRowsHtml() {
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const rows = [myProfileSettingsRowHtml()];

  if (getUserFn?.()?.isOwner) {
    rows.push(companyProfileSettingsRowHtml());
  }

  rows.push(
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
      icon: "groups",
      label: tr("owner.manageEmployees"),
      extraClass: "js-open-manage-employees",
    }),
    settingsRowHtml({
      icon: "pin_drop",
      label: tr("attendance.manageLocations"),
      extraClass: "js-open-manage-locations",
    }),
    settingsRowHtml({
      icon: "person",
      label: tr("owner.switchToUserView"),
      extraClass: "js-switch-account-view",
      attrs: 'data-view-role="employee"',
    })
  );

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
    myProfileSettingsRowHtml(),
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

  main.querySelectorAll(".js-open-company-profile").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenCompanyProfileFn?.());
  });

  main.querySelectorAll(".js-open-manage-employees").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenManageEmployeesFn?.());
  });

  main.querySelectorAll(".js-open-manage-locations").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => onOpenManageLocationsFn?.());
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
  void refreshMyProfileSettingsBadge();
  if (role === "owner") {
    void refreshCompanyProfileSettingsBadge();
  }
}

export function refreshMyProfileSettingsBadge(incomplete = null) {
  const row = document.querySelector("[data-my-profile-row]");
  const badge = row?.querySelector("[data-my-profile-status]");
  if (!row || !badge) return;

  const apply = (isIncomplete) => {
    badge.classList.toggle("d-none", !isIncomplete);
    row.classList.toggle("admin-settings-row--incomplete", isIncomplete);
  };

  if (incomplete === null) {
    const cached = getUserFn?.()?.profileDocumentsComplete;
    if (typeof cached === "boolean") {
      apply(!cached);
    }
    if (!apiFn) return;
    void apiFn("/api/users/profile")
      .then(({ profile }) => {
        apply(!profile.profileDocumentsComplete);
        const user = getUserFn?.();
        if (user) user.profileDocumentsComplete = profile.profileDocumentsComplete;
      })
      .catch(() => {});
    return;
  }

  apply(incomplete);
}

export function refreshCompanyProfileSettingsBadge(incomplete = null) {
  const row = document.querySelector("[data-company-profile-row]");
  const badge = row?.querySelector("[data-company-profile-status]");
  if (!row || !badge) return;

  const apply = (isIncomplete) => {
    badge.classList.toggle("d-none", !isIncomplete);
    row.classList.toggle("admin-settings-row--incomplete", isIncomplete);
  };

  if (incomplete === null) {
    if (!getUserFn?.()?.isOwner || !apiFn) return;
    void apiFn("/api/company/profile")
      .then(({ profile }) => apply(!profile.companyProfileComplete))
      .catch(() => {});
    return;
  }

  apply(incomplete);
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
