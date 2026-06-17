import * as bootstrap from "bootstrap";
import { openTeamChat } from "./chat.js";

const STORAGE_KEY = "taskmgr-owner-announcements-read";

/** @type {{ id: string; date: string; title: string; icon: string; body: string; action?: { label: string; type?: string; href?: string; download?: boolean } }[]} */
export const ADMIN_ANNOUNCEMENTS = [
  {
    id: "feature-team-chat-20260617",
    date: "17 Jun 2026",
    title: "Team chat",
    icon: "bi-chat-dots-fill",
    body:
      "You can now message employees directly or in groups. Open Messages in the sidebar to start a chat, create admin groups, manage members, and turn on notifications for new messages.",
    action: { label: "Open Messages", type: "open-chat" },
  },
  {
    id: "feature-apk-download-20260618",
    date: "18 Jun 2026",
    title: "Updated APK on website",
    icon: "bi-android2",
    body:
      "The latest Sugandh Reminder app (APK) is available for download on this website. Employees will see Download app (APK) on their dashboard after they sign in.",
    action: {
      label: "Download APK",
      href:
        (import.meta.env.VITE_APK_DOWNLOAD_URL || "").trim() || "/downloads/sugandh-reminder.apk",
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
    actionHtml = `<button type="button" class="btn btn-sm btn-outline-primary mt-2 js-admin-notif-action" data-action="open-chat" data-announcement-id="${escapeHtml(item.id)}">${escapeHtml(action.label)}</button>`;
  } else if (action?.href) {
    const dl = action.download ? ' download="sugandh-reminder.apk"' : "";
    actionHtml = `<a class="btn btn-sm btn-outline-primary mt-2 js-admin-notif-action" href="${escapeHtml(action.href)}"${dl} data-announcement-id="${escapeHtml(item.id)}">${escapeHtml(action.label)}</a>`;
  }

  return `
    <li class="admin-notif-item${isUnread ? " admin-notif-item--unread" : ""}" data-announcement-id="${escapeHtml(item.id)}">
      <div class="admin-notif-item-icon" aria-hidden="true"><i class="bi ${escapeHtml(item.icon)}"></i></div>
      <div class="admin-notif-item-body">
        <div class="admin-notif-item-head">
          <span class="admin-notif-item-title">${escapeHtml(item.title)}</span>
          <time class="admin-notif-item-date">${escapeHtml(item.date)}</time>
        </div>
        <p class="admin-notif-item-text mb-0">${escapeHtml(item.body)}</p>
        ${actionHtml}
      </div>
    </li>`;
}

/** @param {string | undefined | null} userId */
export function adminNotificationsBellHtml(userId) {
  const unread = getAdminUnreadCount(userId);
  const items = ADMIN_ANNOUNCEMENTS.map((a) => announcementItemHtml(a, userId)).join("");
  const emptyNote =
    unread === 0 && ADMIN_ANNOUNCEMENTS.length === 0
      ? `<p class="admin-notif-empty small text-muted mb-0 px-3 py-2">No announcements yet.</p>`
      : "";

  return `
    <div class="dropdown admin-notif-dropdown">
      <button
        type="button"
        class="btn btn-outline-secondary btn-sm admin-notif-btn position-relative js-admin-notif-toggle"
        data-bs-toggle="dropdown"
        data-bs-auto-close="outside"
        aria-expanded="false"
        aria-label="Notifications${unread ? `, ${unread} unread` : ""}"
      >
        <i class="bi bi-bell" aria-hidden="true"></i>
        ${badgeHtml(unread)}
      </button>
      <div class="dropdown-menu dropdown-menu-end admin-notif-menu shadow border-0 p-0">
        <div class="admin-notif-menu-head">
          <span class="fw-semibold">Notifications</span>
          ${unread ? `<span class="badge text-bg-primary rounded-pill js-admin-notif-menu-count">${unread}</span>` : ""}
        </div>
        <ul class="list-unstyled mb-0 admin-notif-list">
          ${items}
        </ul>
        ${emptyNote}
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
    btn.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
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
  root.querySelectorAll(".admin-notif-dropdown").forEach((dropdownEl) => {
    const toggle = dropdownEl.querySelector(".js-admin-notif-toggle");
    if (!toggle || toggle.dataset.wired === "1") return;
    toggle.dataset.wired = "1";

    toggle.addEventListener("shown.bs.dropdown", () => {
      markAllRead(userId);
      refreshBadges(userId);
    });

    dropdownEl.querySelectorAll(".js-admin-notif-action").forEach((actionEl) => {
      actionEl.addEventListener("click", () => {
        const id = actionEl.getAttribute("data-announcement-id");
        if (id) markOneRead(userId, id);
        refreshBadges(userId);
        if (actionEl.getAttribute("data-action") === "open-chat") {
          bootstrap.Dropdown.getInstance(toggle)?.hide();
          openTeamChat();
        }
      });
    });
  });
}
