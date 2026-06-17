/** @typedef {{ api: Function, escapeHtml: Function, showToast: Function, bootstrap: any, getUser: () => any }} ChatDeps */

const CHAT_POLL_MS = 8000;

/** @type {ChatDeps | null} */
let deps = null;
/** @type {number | null} */
let pollTimer = null;

/** @type {any[]} */
let threads = [];
/** @type {any[]} */
let contacts = [];
/** @type {"dm" | "group" | null} */
let activeThreadType = null;
/** @type {string | null} */
let activeChatId = null;
/** @type {any[]} */
let activeMessages = [];
/** @type {boolean} */
let activeThreadIsGroup = false;
/** @type {string} */
let contactFilter = "";
/** @type {boolean} */
let mobileShowThread = false;
/** @type {"chats" | "people"} */
let sidebarTab = "chats";
/** @type {number} */
let lastUnreadTotal = 0;
/** @type {boolean} */
let chatPollInitialized = false;

function d() {
  if (!deps) throw new Error("Chat not initialized");
  return deps;
}

function isAdminUser() {
  return d().getUser()?.role === "owner";
}

function threadKey(t) {
  return `${t.type}:${t.id}`;
}

function isActiveThread(t) {
  return t.type === activeThreadType && t.id === activeChatId;
}

function parseChatDeepLink(raw) {
  const id = String(raw || "");
  if (id.startsWith("g:")) return { type: "group", id: id.slice(2) };
  return { type: "dm", id };
}

function formatChatTime(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) {
    return dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function previewText(body) {
  const t = String(body || "").trim().replace(/\s+/g, " ");
  if (!t) return "No messages yet";
  return t.length > 72 ? `${t.slice(0, 69)}…` : t;
}

function avatarColor(name) {
  let h = 0;
  const s = String(name || "?");
  for (let i = 0; i < s.length; i += 1) h = (h + s.charCodeAt(i) * 17) % 360;
  return `hsl(${h} 52% 40%)`;
}

function contactAvatarHtml(name, roleOrLabel, large = false) {
  const initial = String(name || "?").slice(0, 1).toUpperCase();
  const isAdmin = roleOrLabel === "owner" || roleOrLabel === "Admin";
  const sizeCls = large ? " team-chat-avatar--lg" : "";
  const adminCls = isAdmin ? " team-chat-avatar--admin" : "";
  return `<span class="team-chat-avatar${sizeCls}${adminCls}" style="--avatar-bg:${avatarColor(name)}" aria-hidden="true">${d().escapeHtml(initial)}</span>`;
}

function groupAvatarHtml(name, large = false) {
  const sizeCls = large ? " team-chat-avatar--lg" : "";
  return `<span class="team-chat-avatar team-chat-avatar--group${sizeCls}" style="--avatar-bg:${avatarColor(name)}" aria-hidden="true"><i class="bi bi-people-fill"></i></span>`;
}

function rolePillHtml(roleOrLabel) {
  const isAdmin = roleOrLabel === "owner" || roleOrLabel === "Admin";
  const label = isAdmin ? "Admin" : "Employee";
  const cls = isAdmin ? "team-chat-role-pill team-chat-role-pill--admin" : "team-chat-role-pill";
  return `<span class="${cls}">${label}</span>`;
}

export function teamChatOffcanvasHtml() {
  return `
    <div class="offcanvas offcanvas-end team-chat-offcanvas" tabindex="-1" id="teamChatOffcanvas" aria-labelledby="teamChatOffcanvasLabel">
      <div class="offcanvas-header team-chat-header border-0">
        <div class="team-chat-header-brand min-w-0 flex-grow-1">
          <div class="team-chat-header-icon" aria-hidden="true"><i class="bi bi-chat-heart-fill"></i></div>
          <div class="min-w-0">
            <h2 class="offcanvas-title h5 mb-0" id="teamChatOffcanvasLabel">Messages</h2>
            <p class="small text-muted mb-0">Chat with your team</p>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-light border team-chat-notify-btn d-none js-chat-enable-push" id="team-chat-enable-push" title="Enable message notifications">
          <i class="bi bi-bell" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-close ms-2" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body p-0 d-flex flex-column team-chat-body">
        <div class="team-chat-layout flex-grow-1 min-h-0">
          <aside class="team-chat-sidebar" id="team-chat-sidebar">
            <div class="team-chat-search-wrap">
              <label class="visually-hidden" for="team-chat-search">Search</label>
              <div class="team-chat-search">
                <i class="bi bi-search" aria-hidden="true"></i>
                <input type="search" class="form-control form-control-sm border-0 shadow-none" id="team-chat-search" placeholder="Search chats or people…" autocomplete="off" />
              </div>
            </div>
            <div class="team-chat-tabs" role="tablist" aria-label="Message views">
              <button type="button" class="team-chat-tab team-chat-tab--active" data-chat-tab="chats" role="tab" aria-selected="true">Chats</button>
              <button type="button" class="team-chat-tab" data-chat-tab="people" role="tab" aria-selected="false">People</button>
            </div>
            <div class="team-chat-list-scroll" id="team-chat-pane-chats" role="tabpanel">
              <div class="team-chat-create-group-wrap d-none" id="team-chat-create-group-wrap">
                <button type="button" class="btn btn-sm btn-primary w-100 team-chat-create-group-btn" id="team-chat-create-group-btn">
                  <i class="bi bi-people-fill me-1" aria-hidden="true"></i>New group
                </button>
              </div>
              <div id="team-chat-thread-list" aria-live="polite"></div>
            </div>
            <div class="team-chat-list-scroll d-none" id="team-chat-pane-people" role="tabpanel">
              <div id="team-chat-contact-list"></div>
            </div>
          </aside>
          <section class="team-chat-thread" id="team-chat-thread">
            <div class="team-chat-thread-empty" id="team-chat-thread-empty">
              <div class="team-chat-empty-card">
                <div class="team-chat-empty-icon" aria-hidden="true"><i class="bi bi-chat-square-dots"></i></div>
                <p class="fw-semibold mb-1">Your team chat</p>
                <p class="small text-muted mb-0">Select a chat, open a <strong>group</strong>, or pick someone under <strong>People</strong>.</p>
              </div>
            </div>
            <div class="team-chat-thread-active d-none flex-column h-100" id="team-chat-thread-active">
              <div class="team-chat-thread-head">
                <button type="button" class="btn btn-sm btn-light border team-chat-back-btn d-md-none" id="team-chat-back" aria-label="Back to list">
                  <i class="bi bi-arrow-left" aria-hidden="true"></i>
                </button>
                <span id="team-chat-peer-avatar"></span>
                <div class="min-w-0 flex-grow-1">
                  <div class="fw-semibold text-truncate" id="team-chat-peer-name">—</div>
                  <div id="team-chat-peer-role"></div>
                </div>
              </div>
              <div class="team-chat-messages flex-grow-1" id="team-chat-messages" aria-live="polite"></div>
              <form class="team-chat-compose" id="team-chat-compose">
                <div class="team-chat-compose-inner">
                  <textarea class="form-control team-chat-input" id="team-chat-input" rows="1" maxlength="4000" placeholder="Type a message…" aria-label="Message"></textarea>
                  <button class="btn btn-primary team-chat-send-btn" type="submit" id="team-chat-send" aria-label="Send message">
                    <i class="bi bi-send-fill" aria-hidden="true"></i>
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
    <div class="modal fade" id="teamChatCreateGroupModal" tabindex="-1" aria-labelledby="teamChatCreateGroupLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <form id="team-chat-create-group-form">
            <div class="modal-header">
              <h2 class="modal-title h5" id="teamChatCreateGroupLabel">Create group</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label" for="team-chat-group-name">Group name</label>
                <input type="text" class="form-control" id="team-chat-group-name" maxlength="80" required placeholder="e.g. Sales team" />
              </div>
              <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="team-chat-group-everyone" checked />
                <label class="form-check-label" for="team-chat-group-everyone">Include everyone on the team</label>
              </div>
              <div class="d-none" id="team-chat-group-members-wrap">
                <p class="small text-muted mb-2">Select members</p>
                <div class="team-chat-group-member-picks border rounded p-2" id="team-chat-group-member-picks"></div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="team-chat-group-submit">Create group</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function filteredContacts() {
  const q = contactFilter.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (c) => c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  );
}

function filteredThreads() {
  const q = contactFilter.trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((t) => {
    if (t.type === "group") {
      return t.group?.name?.toLowerCase().includes(q);
    }
    return (
      t.peer?.displayName?.toLowerCase().includes(q) ||
      (t.peer?.email || "").toLowerCase().includes(q)
    );
  });
}

function syncAdminGroupUi() {
  const wrap = document.getElementById("team-chat-create-group-wrap");
  if (wrap) wrap.classList.toggle("d-none", !isAdminUser());
}

function setSidebarTab(tab) {
  sidebarTab = tab === "people" ? "people" : "chats";
  document.querySelectorAll(".team-chat-tab").forEach((btn) => {
    const on = btn.getAttribute("data-chat-tab") === sidebarTab;
    btn.classList.toggle("team-chat-tab--active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("team-chat-pane-chats")?.classList.toggle("d-none", sidebarTab !== "chats");
  document.getElementById("team-chat-pane-people")?.classList.toggle("d-none", sidebarTab !== "people");
}

function renderThreadList() {
  const host = document.getElementById("team-chat-thread-list");
  if (!host) return;
  const list = filteredThreads();
  if (!list.length) {
    host.innerHTML = `<div class="team-chat-list-empty">
      <p class="small text-muted mb-0">${contactFilter.trim() ? "No chats match your search." : "No conversations yet. Admins can create a group, or open People to DM someone."}</p>
    </div>`;
    return;
  }
  host.innerHTML = list
    .map((t) => {
      const active = isActiveThread(t) ? " team-chat-thread-item--active" : "";
      const unread =
        t.unreadCount > 0
          ? `<span class="team-chat-unread-badge">${t.unreadCount > 9 ? "9+" : t.unreadCount}</span>`
          : "";
      const unreadRow = t.unreadCount > 0 ? " team-chat-thread-item--unread" : "";
      const isGroup = t.type === "group";
      const title = isGroup ? t.group.name : t.peer.displayName;
      const avatar = isGroup
        ? groupAvatarHtml(t.group.name)
        : contactAvatarHtml(t.peer.displayName, t.peer.role);
      const prefix = t.lastMessage?.isMine ? "You: " : t.lastMessage?.senderName && isGroup ? `${t.lastMessage.senderName}: ` : "";
      return `<button type="button" class="team-chat-thread-item${active}${unreadRow}" data-thread-type="${t.type}" data-thread-id="${t.id}">
        ${avatar}
        <span class="team-chat-thread-item-main">
          <span class="team-chat-thread-item-top">
            <span class="team-chat-thread-item-title-wrap">
              <span class="team-chat-thread-item-name text-truncate">${d().escapeHtml(title)}</span>
              ${isGroup ? `<span class="team-chat-group-badge">Group</span>` : ""}
            </span>
            <span class="team-chat-thread-item-time tabular-nums">${d().escapeHtml(formatChatTime(t.lastMessage?.createdAt || t.updatedAt))}</span>
          </span>
          <span class="team-chat-thread-item-bottom">
            <span class="team-chat-thread-item-preview text-truncate">${d().escapeHtml(prefix + previewText(t.lastMessage?.body))}</span>
            ${unread}
          </span>
        </span>
      </button>`;
    })
    .join("");
  host.querySelectorAll("[data-thread-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-thread-type");
      const id = btn.getAttribute("data-thread-id");
      if (type && id) void openThread(type, id);
    });
  });
}

function renderContactList() {
  const host = document.getElementById("team-chat-contact-list");
  if (!host) return;
  const list = filteredContacts();
  if (!list.length) {
    host.innerHTML = `<div class="team-chat-list-empty"><p class="small text-muted mb-0">No people found.</p></div>`;
    return;
  }
  const admins = list.filter((c) => c.role === "owner");
  const employees = list.filter((c) => c.role !== "owner");

  const section = (title, items) => {
    if (!items.length) return "";
    return `<div class="team-chat-people-section">
      <p class="team-chat-people-section-label">${title}</p>
      ${items
        .map(
          (c) => `<button type="button" class="team-chat-contact-item" data-peer-id="${c.id}">
            ${contactAvatarHtml(c.displayName, c.role)}
            <span class="min-w-0 flex-grow-1">
              <span class="d-flex align-items-center gap-2">
                <span class="fw-medium text-truncate">${d().escapeHtml(c.displayName)}</span>
                ${rolePillHtml(c.roleLabel)}
              </span>
              <span class="d-block small text-muted text-truncate">${d().escapeHtml(c.email)}</span>
            </span>
            <i class="bi bi-chevron-right text-muted small" aria-hidden="true"></i>
          </button>`
        )
        .join("")}
    </div>`;
  };

  host.innerHTML = section("Admins", admins) + section("Employees", employees);
  host.querySelectorAll("[data-peer-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const peerId = btn.getAttribute("data-peer-id");
      if (peerId) void startChatWithPeer(peerId);
    });
  });
}

function renderGroupMemberPicks() {
  const host = document.getElementById("team-chat-group-member-picks");
  if (!host) return;
  host.innerHTML = contacts
    .map(
      (c) => `<div class="form-check">
        <input class="form-check-input" type="checkbox" value="${c.id}" id="team-chat-pick-${c.id}" checked />
        <label class="form-check-label" for="team-chat-pick-${c.id}">${d().escapeHtml(c.displayName)}</label>
      </div>`
    )
    .join("");
}

function renderMessages() {
  const host = document.getElementById("team-chat-messages");
  if (!host) return;
  if (!activeMessages.length) {
    host.innerHTML = `<div class="team-chat-messages-empty">
      <div class="team-chat-empty-icon team-chat-empty-icon--sm" aria-hidden="true"><i class="bi bi-emoji-smile"></i></div>
      <p class="small text-muted mb-0">No messages yet — say hello!</p>
    </div>`;
    return;
  }
  host.innerHTML = activeMessages
    .map((m) => {
      const mine = m.isMine ? " team-chat-bubble-row--mine" : "";
      const senderLine =
        activeThreadIsGroup && !m.isMine
          ? `<div class="team-chat-bubble-sender">${d().escapeHtml(m.senderName || "Member")}</div>`
          : "";
      return `<div class="team-chat-bubble-row${mine}">
        <div class="team-chat-bubble-wrap">
          ${senderLine}
          <div class="team-chat-bubble">
            <div class="team-chat-bubble-body text-break">${d().escapeHtml(m.body)}</div>
            <div class="team-chat-bubble-time tabular-nums">${d().escapeHtml(formatChatTime(m.createdAt))}</div>
          </div>
        </div>
      </div>`;
    })
    .join("");
  host.scrollTop = host.scrollHeight;
}

function isMobileChatLayout() {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

function updateThreadHeaderFromThread(t) {
  const nameEl = document.getElementById("team-chat-peer-name");
  const roleEl = document.getElementById("team-chat-peer-role");
  const avatarEl = document.getElementById("team-chat-peer-avatar");
  if (!t) return;
  if (t.type === "group") {
    if (nameEl) nameEl.textContent = t.group?.name || "Group";
    if (roleEl) {
      roleEl.innerHTML = `<span class="team-chat-role-pill team-chat-role-pill--group">${t.group?.memberCount ?? 0} members</span>`;
    }
    if (avatarEl) avatarEl.innerHTML = groupAvatarHtml(t.group?.name || "Group", true);
    return;
  }
  const peer = t.peer;
  if (nameEl) nameEl.textContent = peer?.displayName || "Chat";
  if (roleEl) roleEl.innerHTML = peer ? rolePillHtml(peer.roleLabel || peer.role) : "";
  if (avatarEl) avatarEl.innerHTML = peer ? contactAvatarHtml(peer.displayName, peer.role, true) : "";
}

function setThreadVisible(open) {
  const empty = document.getElementById("team-chat-thread-empty");
  const active = document.getElementById("team-chat-thread-active");
  const sidebar = document.getElementById("team-chat-sidebar");
  if (!empty || !active || !sidebar) return;
  const hasThread = !!open && !!activeChatId && !!activeThreadType;
  empty.classList.toggle("d-none", hasThread);
  active.classList.toggle("d-none", !hasThread);
  active.classList.toggle("d-flex", hasThread);
  sidebar.classList.toggle("d-none", hasThread && mobileShowThread && isMobileChatLayout());
}

function isChatPanelOpen() {
  return document.getElementById("teamChatOffcanvas")?.classList.contains("show") ?? false;
}

function notifyIncomingMessage(thread) {
  const isGroup = thread.type === "group";
  const name = isGroup ? thread.group?.name : thread.peer?.displayName || "Someone";
  const preview = previewText(thread.lastMessage?.body);
  const label = isGroup && thread.lastMessage?.senderName
    ? `${thread.lastMessage.senderName} in ${name}`
    : name;
  d().showToast(`New message from ${label}: ${preview}`, "primary");
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    try {
      const openId = isGroup ? `g:${thread.id}` : thread.id;
      const n = new Notification(isGroup ? `${name}` : `Message from ${name}`, {
        body: preview,
        tag: `taskmgr-chat-${thread.id}`,
      });
      n.onclick = () => {
        window.focus();
        void openChatFromDeepLink(openId);
      };
    } catch {
      /* ignore */
    }
  }
}

function syncChatPushButton() {
  const btn = document.getElementById("team-chat-enable-push");
  if (!btn) return;
  const show =
    typeof Notification !== "undefined" &&
    Notification.permission !== "granted" &&
    d().isPushSupported?.();
  btn.classList.toggle("d-none", !show);
}

async function loadContacts() {
  const data = await d().api("/api/chat/contacts");
  contacts = data.contacts ?? [];
  renderContactList();
  renderGroupMemberPicks();
}

async function loadThreads() {
  const data = await d().api("/api/chat/threads");
  threads = data.threads ?? [];
  renderThreadList();
  await refreshUnreadBadges();
}

async function openThread(type, id) {
  activeThreadType = type === "group" ? "group" : "dm";
  activeChatId = id;
  activeThreadIsGroup = activeThreadType === "group";
  mobileShowThread = isMobileChatLayout();

  const cached = threads.find((t) => t.type === activeThreadType && t.id === id);
  if (cached) updateThreadHeaderFromThread(cached);

  setThreadVisible(true);
  activeMessages = [];
  const host = document.getElementById("team-chat-messages");
  if (host) {
    host.innerHTML = `<div class="team-chat-messages-empty"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading…</span></div></div>`;
  }
  renderThreadList();

  const base =
    activeThreadType === "group"
      ? `/api/chat/groups/${id}`
      : `/api/chat/conversations/${id}`;

  try {
    const data = await d().api(`${base}/messages`);
    activeMessages = data.messages ?? [];
    if (activeThreadType === "group" && data.group) {
      updateThreadHeaderFromThread({
        type: "group",
        group: data.group,
      });
    } else if (data.conversation?.peer) {
      updateThreadHeaderFromThread({
        type: "dm",
        peer: data.conversation.peer,
      });
    }
    renderMessages();
    try {
      await d().api(`${base}/read`, { method: "POST", body: "{}" });
      await loadThreads();
    } catch {
      /* ignore */
    }
  } catch (err) {
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    mobileShowThread = false;
    setThreadVisible(false);
    d().showToast(err.message || "Could not open chat", "danger");
  }
}

async function startChatWithPeer(peerUserId) {
  try {
    const data = await d().api("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ peerUserId }),
    });
    await loadThreads();
    if (data.conversation?.id) await openThread("dm", data.conversation.id);
  } catch (err) {
    d().showToast(err.message, "danger");
  }
}

async function createGroup(e) {
  e.preventDefault();
  const nameInput = document.getElementById("team-chat-group-name");
  const everyone = document.getElementById("team-chat-group-everyone");
  const submit = document.getElementById("team-chat-group-submit");
  const name = nameInput?.value?.trim();
  if (!name) return;

  const includeEveryone = everyone?.checked !== false;
  let memberIds = [];
  if (!includeEveryone) {
    document.querySelectorAll("#team-chat-group-member-picks input:checked").forEach((el) => {
      memberIds.push(el.value);
    });
    if (!memberIds.length) {
      d().showToast("Select at least one member.", "warning");
      return;
    }
  }

  if (submit) submit.disabled = true;
  try {
    const data = await d().api("/api/chat/groups", {
      method: "POST",
      body: JSON.stringify({ name, includeEveryone, memberIds: includeEveryone ? undefined : memberIds }),
    });
    const modalEl = document.getElementById("teamChatCreateGroupModal");
    if (modalEl) d().bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    if (nameInput) nameInput.value = "";
    if (everyone) everyone.checked = true;
    document.getElementById("team-chat-group-members-wrap")?.classList.add("d-none");
    d().showToast(`Group "${name}" created.`, "success");
    await loadThreads();
    if (data.group?.id) {
      setSidebarTab("chats");
      await openThread("group", data.group.id);
    }
  } catch (err) {
    d().showToast(err.message, "danger");
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function sendMessage(e) {
  e.preventDefault();
  if (!activeChatId || !activeThreadType) return;
  const input = document.getElementById("team-chat-input");
  const body = input?.value?.trim();
  if (!body) return;
  const btn = document.getElementById("team-chat-send");
  if (btn) btn.disabled = true;
  const base =
    activeThreadType === "group"
      ? `/api/chat/groups/${activeChatId}`
      : `/api/chat/conversations/${activeChatId}`;
  try {
    const data = await d().api(`${base}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (input) input.value = "";
    if (data.message) activeMessages.push(data.message);
    renderMessages();
    await loadThreads();
  } catch (err) {
    d().showToast(err.message, "danger");
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function refreshUnreadBadges() {
  try {
    const data = await d().api("/api/chat/unread-count");
    const count = Number(data.count) || 0;
    document.querySelectorAll(".js-chat-unread-badge").forEach((el) => {
      el.textContent = String(count);
      el.classList.toggle("d-none", count <= 0);
    });
  } catch {
    /* ignore when logged out */
  }
}

function isSameActiveThread(t) {
  return t.type === activeThreadType && t.id === activeChatId;
}

async function refreshChatData() {
  try {
    const prevUnread = lastUnreadTotal;
    const prevFingerprints = new Map(threads.map((t) => [threadKey(t), `${t.unreadCount}:${t.lastMessage?.id || ""}`]));

    await loadThreads();

    const unreadNow = threads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
    if (!chatPollInitialized) {
      chatPollInitialized = true;
      lastUnreadTotal = unreadNow;
    } else if (unreadNow > prevUnread) {
      const incoming = threads
        .filter((t) => t.unreadCount > 0 && !isSameActiveThread(t))
        .sort(
          (a, b) =>
            new Date(b.lastMessage?.createdAt || b.updatedAt).getTime() -
            new Date(a.lastMessage?.createdAt || a.updatedAt).getTime()
        )[0];
      if (incoming) notifyIncomingMessage(incoming);
    } else {
      for (const t of threads) {
        const prev = prevFingerprints.get(threadKey(t));
        const cur = `${t.unreadCount}:${t.lastMessage?.id || ""}`;
        if (prev === cur || t.lastMessage?.isMine) continue;
        if (isSameActiveThread(t) && isChatPanelOpen()) continue;
        notifyIncomingMessage(t);
        break;
      }
    }
    lastUnreadTotal = unreadNow;

    if (activeChatId && activeThreadType && isChatPanelOpen()) {
      const base =
        activeThreadType === "group"
          ? `/api/chat/groups/${activeChatId}`
          : `/api/chat/conversations/${activeChatId}`;
      const data = await d().api(`${base}/messages`);
      activeMessages = data.messages ?? [];
      renderMessages();
    }
  } catch {
    /* ignore polling errors */
  }
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void refreshChatData();
  }, CHAT_POLL_MS);
}

export function stopPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function openTeamChat() {
  const el = document.getElementById("teamChatOffcanvas");
  if (!el) return;
  mobileShowThread = false;
  syncAdminGroupUi();
  setThreadVisible(!!activeChatId);
  syncChatPushButton();
  d().bootstrap.Offcanvas.getOrCreateInstance(el).show();
  void (async () => {
    try {
      await Promise.all([loadContacts(), loadThreads()]);
      if (d().preparePushInfrastructure) {
        void d().preparePushInfrastructure();
      }
    } catch (err) {
      d().showToast(err.message, "danger");
    }
  })();
}

export async function openChatFromDeepLink(conversationId) {
  if (!conversationId) return;
  const { type, id } = parseChatDeepLink(conversationId);
  if (!id) return;
  openTeamChat();
  try {
    await loadThreads();
    await openThread(type, id);
  } catch (err) {
    d().showToast(err.message, "danger");
  }
}

export function wireTeamChatButtons() {
  document.querySelectorAll(".js-open-team-chat").forEach((btn) => {
    btn.addEventListener("click", () => openTeamChat());
  });
}

export function initTeamChat(chatDeps) {
  deps = chatDeps;
  stopPolling();
  const offcanvas = document.getElementById("teamChatOffcanvas");
  if (!offcanvas) return;

  document.getElementById("team-chat-search")?.addEventListener("input", (e) => {
    contactFilter = e.target.value || "";
    renderThreadList();
    renderContactList();
  });
  document.getElementById("team-chat-compose")?.addEventListener("submit", (e) => {
    void sendMessage(e);
  });
  document.getElementById("team-chat-back")?.addEventListener("click", () => {
    mobileShowThread = false;
    setThreadVisible(false);
  });
  document.querySelectorAll(".team-chat-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSidebarTab(btn.getAttribute("data-chat-tab") || "chats");
    });
  });
  document.getElementById("team-chat-create-group-btn")?.addEventListener("click", () => {
    renderGroupMemberPicks();
    const modalEl = document.getElementById("teamChatCreateGroupModal");
    if (modalEl) d().bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });
  document.getElementById("team-chat-create-group-form")?.addEventListener("submit", (e) => {
    void createGroup(e);
  });
  document.getElementById("team-chat-group-everyone")?.addEventListener("change", (e) => {
    const wrap = document.getElementById("team-chat-group-members-wrap");
    if (wrap) wrap.classList.toggle("d-none", e.target.checked);
  });

  setSidebarTab("chats");
  syncAdminGroupUi();
  offcanvas.addEventListener("shown.bs.offcanvas", () => {
    syncChatPushButton();
    syncAdminGroupUi();
  });
  offcanvas.addEventListener("hidden.bs.offcanvas", () => {
    mobileShowThread = false;
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    activeMessages = [];
    setThreadVisible(false);
  });

  window.addEventListener("resize", () => {
    if (isChatPanelOpen() && activeChatId) {
      setThreadVisible(true);
    }
  });

  document.getElementById("team-chat-enable-push")?.addEventListener("click", () => {
    void (async () => {
      if (!d().subscribeToPush) return;
      const result = await d().subscribeToPush();
      if (result?.ok) {
        d().showToast("Message notifications enabled.", "success");
        syncChatPushButton();
      } else if (result?.reason === "denied") {
        d().showToast("Notifications blocked in browser settings.", "warning");
      }
    })();
  });

  wireTeamChatButtons();
  startPolling();
  void refreshUnreadBadges();
  syncChatPushButton();
}

export function teamChatSidebarButtonHtml() {
  return `<button type="button" class="btn btn-outline-secondary w-100 mb-2 js-open-team-chat">
    <i class="bi bi-chat-dots me-1" aria-hidden="true"></i>Messages
    <span class="badge rounded-pill text-bg-danger ms-1 d-none js-chat-unread-badge">0</span>
  </button>`;
}
