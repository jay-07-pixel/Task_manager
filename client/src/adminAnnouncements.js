import * as bootstrap from "bootstrap";
import { openTeamChat } from "./chat.js";
import { t } from "./i18n/index.js";

const STORAGE_KEY = "taskmgr-owner-announcements-read";
const OFFCANVAS_ID = "adminNotifOffcanvas";
const APK_FILENAME = "kalpanik-reminder.apk";

/** @type {{ id: string; date: string; title: string; icon: string; body: string; action?: { label: string; type?: string; href?: string; download?: boolean } }[]} */
export const ADMIN_ANNOUNCEMENTS = [
  {
    id: "feature-chat-reply-delete-20260619",
    date: "19-06-26",
    title: "Reply & delete in chat",
    icon: "bi-reply-fill",
    body:
      "Reply to a specific message in 1-to-1 and group chats. You can delete your own messages within 30 minutes — others will see that the message was removed.",
    action: { labelKey: "notifications.openMessages", type: "open-chat" },
  },
  {
    id: "feature-updates-20260619",
    date: "19-06-26",
    title: "Important updates (since 18 Jun)",
    icon: "bi-megaphone-fill",
    body:
      "Messages — Seen receipts and typing indicators; attachment playback and video fixes. Tasks — Employees can submit PDF completion proof; unassigned tasks show Unassigned in bold red; repeating tasks show Daily, Weekly, Monthly, etc. on the row; full description only when you expand a task. Employee assignments — Active, In review, and Completed filters now work on that list. App — Latest Kalpanik Reminder APK is on the employee dashboard; ask staff to install it for chat files, seen status, and typing.",
    action: {
      labelKey: "notifications.downloadApk",
      href: (import.meta.env.VITE_APK_DOWNLOAD_URL || "").trim() || "/downloads/sugandh-reminder.apk",
      download: true,
    },
  },
  {
    id: "feature-chat-files-20260618",
    date: "18-06-26",
    title: "Share files in chat",
    icon: "bi-paperclip",
    body:
      "Users can now send images, videos, PDFs, and other files in team chat (up to 5 MB). View them full screen on the website and in the Kalpanik Reminder app after employees update the APK.",
    action: { labelKey: "notifications.openMessages", type: "open-chat" },
  },
  {
    id: "feature-team-chat-20260617",
    date: "17-06-26",
    title: "Team chat",
    icon: "bi-chat-dots-fill",
    body:
      "Message employees directly or in groups. Open Messages in the sidebar to chat, create groups, manage members, and enable notifications.",
    action: { labelKey: "notifications.openMessages", type: "open-chat" },
  },
  {
    id: "feature-apk-download-20260618",
    date: "18-06-26",
    title: "Kalpanik Reminder APK",
    icon: "bi-android2",
    body:
      "The latest Kalpanik Reminder app (APK) is on this website. Employees can download it from their dashboard after sign-in.",
    action: {
      labelKey: "notifications.downloadApk",
      href: (import.meta.env.VITE_APK_DOWNLOAD_URL || "").trim() || "/downloads/sugandh-reminder.apk",
      download: true,
    },
  },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @returns {Record<string, string[]>} */
function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** @param {string | undefined | null} userId */
function getReadIds(userId) {
  if (!userId) return [];
  const store = readStore();
  const ids = store[userId];
  return Array.isArray(ids) ? ids : [];
}

/** @param {string | undefined | null} userId */
export function getAdminUnreadCount(userId) {
  const read = new Set(getReadIds(userId));
  return ADMIN_ANNOUNCEMENTS.filter((a) => !read.has(a.id)).length;
}

/** @param {string | undefined | null} userId */
function markAllRead(userId) {
  if (!userId) return;
  const store = readStore();
  store[userId] = ADMIN_ANNOUNCEMENTS.map((a) => a.id);
  writeStore(store);
}

/** @param {string | undefined | null} userId @param {string} announcementId */
function markOneRead(userId, announcementId) {
  if (!userId) return;
  const store = readStore();
  const set = new Set(getReadIds(userId));
  set.add(announcementId);
  store[userId] = [...set];
  writeStore(store);
}

function badgeHtml(count) {
  if (!count) return "";
  const label = count > 9 ? "9+" : String(count);
  return `<span class="admin-notif-badge js-admin-notif-badge" aria-hidden="true">${label}</span>`;
}

function announcementItemHtml(item, userId) {
  const read = new Set(getReadIds(userId));
  const isUnread = !read.has(item.id);
  const action = item.action;
  let actionHtml = "";
  if (action?.type === "open-chat") {
    actionHtml = `<button type="button" class="btn btn-sm btn-outline-primary js-admin-notif-action" data-action="open-chat" data-announcement-id="${escapeHtml(item.id)}">${escapeHtml(t(action.labelKey || "notifications.openMessages"))}</button>`;
  } else if (action?.href) {
    const dl = action.download ? ` download="${APK_FILENAME}"` : "";
    actionHtml = `<a class="btn btn-sm btn-outline-primary js-admin-notif-action" href="${escapeHtml(action.href)}"${dl} data-announcement-id="${escapeHtml(item.id)}">${escapeHtml(t(action.labelKey || "notifications.downloadApk"))}</a>`;
  }

  return `
    <li class="admin-notif-item${isUnread ? " admin-notif-item--unread" : ""}" data-announcement-id="${escapeHtml(item.id)}">
      <div class="admin-notif-item-icon" aria-hidden="true"><i class="bi ${escapeHtml(item.icon)}"></i></div>
      <div class="admin-notif-item-body">
        <div class="admin-notif-item-head">
          <span class="admin-notif-item-title">${escapeHtml(item.title)}</span>
          <time class="admin-notif-item-date" datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time>
        </div>
        <p class="admin-notif-item-text mb-0">${escapeHtml(item.body)}</p>
        ${actionHtml ? `<div class="admin-notif-item-actions">${actionHtml}</div>` : ""}
      </div>
    </li>`;
}

function notificationsListInnerHtml(userId) {
  if (!ADMIN_ANNOUNCEMENTS.length) {
    return `<p class="admin-notif-empty small text-muted mb-0">${escapeHtml(t("notifications.empty"))}</p>`;
  }
  return `<ul class="list-unstyled mb-0 admin-notif-list">${ADMIN_ANNOUNCEMENTS.map((a) => announcementItemHtml(a, userId)).join("")}</ul>`;
}

/** Bell button only — panel opens in offcanvas on click. */
export function adminNotificationsBellHtml(userId) {
  const unread = getAdminUnreadCount(userId);
  return `
    <button
      type="button"
      class="btn btn-outline-secondary btn-sm admin-notif-btn position-relative js-admin-notif-toggle"
      data-bs-toggle="offcanvas"
      data-bs-target="#${OFFCANVAS_ID}"
      aria-controls="${OFFCANVAS_ID}"
      aria-label="${escapeHtml(unread ? t("notifications.unread", { count: unread }) : t("notifications.title"))}"
    >
      <i class="bi bi-bell" aria-hidden="true"></i>
      ${badgeHtml(unread)}
    </button>`;
}

/** Render once in owner shell — hidden until bell is tapped. */
export function adminNotifOffcanvasHtml(userId) {
  const unread = getAdminUnreadCount(userId);
  return `
    <div class="offcanvas offcanvas-end admin-notif-offcanvas" tabindex="-1" id="${OFFCANVAS_ID}" aria-labelledby="${OFFCANVAS_ID}Label">
      <div class="offcanvas-header admin-notif-offcanvas-head border-bottom">
        <div>
          <h2 class="offcanvas-title h5 mb-0" id="${OFFCANVAS_ID}Label">${escapeHtml(t("notifications.title"))}</h2>
          <p class="small text-muted mb-0 mt-1">${escapeHtml(t("notifications.subtitle"))}</p>
        </div>
        <div class="d-flex align-items-center gap-2">
          ${unread ? `<span class="badge text-bg-primary rounded-pill js-admin-notif-menu-count">${unread}</span>` : ""}
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="${escapeHtml(t("common.close"))}"></button>
        </div>
      </div>
      <div class="offcanvas-body admin-notif-offcanvas-body p-0">
        ${notificationsListInnerHtml(userId)}
      </div>
    </div>`;
}

function refreshBadges(userId) {
  const unread = getAdminUnreadCount(userId);
  document.querySelectorAll(".js-admin-notif-badge").forEach((el) => {
    if (unread) {
      el.textContent = unread > 9 ? "9+" : String(unread);
      el.classList.remove("d-none");
    } else {
      el.remove();
    }
  });
  document.querySelectorAll(".js-admin-notif-toggle").forEach((btn) => {
    btn.setAttribute("aria-label", unread ? t("notifications.unread", { count: unread }) : t("notifications.title"));
  });
  document.querySelectorAll(".js-admin-notif-menu-count").forEach((el) => {
    if (unread) el.textContent = String(unread);
    else el.remove();
  });
  document.querySelectorAll(".admin-notif-item").forEach((el) => {
    const id = el.getAttribute("data-announcement-id");
    const read = new Set(getReadIds(userId));
    el.classList.toggle("admin-notif-item--unread", !!id && !read.has(id));
  });
}

/** @param {string | undefined | null} userId @param {ParentNode} [root] */
export function wireAdminNotifications(userId, root = document) {
  const offcanvasEl = root.querySelector(`#${OFFCANVAS_ID}`) || document.getElementById(OFFCANVAS_ID);
  if (offcanvasEl && offcanvasEl.dataset.wired !== "1") {
    offcanvasEl.dataset.wired = "1";
    offcanvasEl.addEventListener("shown.bs.offcanvas", () => {
      markAllRead(userId);
      refreshBadges(userId);
    });
    offcanvasEl.querySelectorAll(".js-admin-notif-action").forEach((actionEl) => {
      actionEl.addEventListener("click", () => {
        const id = actionEl.getAttribute("data-announcement-id");
        if (id) markOneRead(userId, id);
        refreshBadges(userId);
        if (actionEl.getAttribute("data-action") === "open-chat") {
          bootstrap.Offcanvas.getInstance(offcanvasEl)?.hide();
          openTeamChat();
        }
      });
    });
  }
}
