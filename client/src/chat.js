/** @typedef {{ api: Function, escapeHtml: Function, showToast: Function, bootstrap: any, getUser: () => any }} ChatDeps */

const CHAT_POLL_MS = 8000;

/** @type {ChatDeps | null} */
let deps = null;
/** @type {number | null} */
let pollTimer = null;

/** @type {any[]} */
let conversations = [];
/** @type {any[]} */
let contacts = [];
/** @type {string | null} */
let activeConversationId = null;
/** @type {any[]} */
let activeMessages = [];
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
                <p class="small text-muted mb-0">Select a chat or pick someone under <strong>People</strong> to start messaging.</p>
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
    </div>`;
}

function filteredContacts() {
  const q = contactFilter.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (c) => c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  );
}

function filteredConversations() {
  const q = contactFilter.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter(
    (c) =>
      c.peer.displayName.toLowerCase().includes(q) ||
      (c.peer.email || "").toLowerCase().includes(q)
  );
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
  const list = filteredConversations();
  if (!list.length) {
    host.innerHTML = `<div class="team-chat-list-empty">
      <p class="small text-muted mb-0">${contactFilter.trim() ? "No chats match your search." : "No conversations yet. Open People to start one."}</p>
    </div>`;
    return;
  }
  host.innerHTML = list
    .map((c) => {
      const active = c.id === activeConversationId ? " team-chat-thread-item--active" : "";
      const unread =
        c.unreadCount > 0
          ? `<span class="team-chat-unread-badge">${c.unreadCount > 9 ? "9+" : c.unreadCount}</span>`
          : "";
      const prefix = c.lastMessage?.isMine ? "You: " : "";
      const unreadRow = c.unreadCount > 0 ? " team-chat-thread-item--unread" : "";
      return `<button type="button" class="team-chat-thread-item${active}${unreadRow}" data-conversation-id="${c.id}">
        ${contactAvatarHtml(c.peer.displayName, c.peer.role)}
        <span class="team-chat-thread-item-main">
          <span class="team-chat-thread-item-top">
            <span class="team-chat-thread-item-name text-truncate">${d().escapeHtml(c.peer.displayName)}</span>
            <span class="team-chat-thread-item-time tabular-nums">${d().escapeHtml(formatChatTime(c.lastMessage?.createdAt || c.updatedAt))}</span>
          </span>
          <span class="team-chat-thread-item-bottom">
            <span class="team-chat-thread-item-preview text-truncate">${d().escapeHtml(prefix + previewText(c.lastMessage?.body))}</span>
            ${unread}
          </span>
        </span>
      </button>`;
    })
    .join("");
  host.querySelectorAll("[data-conversation-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-conversation-id");
      if (id) void openConversation(id);
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
      return `<div class="team-chat-bubble-row${mine}">
        <div class="team-chat-bubble">
          <div class="team-chat-bubble-body text-break">${d().escapeHtml(m.body)}</div>
          <div class="team-chat-bubble-time tabular-nums">${d().escapeHtml(formatChatTime(m.createdAt))}</div>
        </div>
      </div>`;
    })
    .join("");
  host.scrollTop = host.scrollHeight;
}

function isMobileChatLayout() {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

function updateThreadPeerHeader(peer) {
  const nameEl = document.getElementById("team-chat-peer-name");
  const roleEl = document.getElementById("team-chat-peer-role");
  const avatarEl = document.getElementById("team-chat-peer-avatar");
  if (nameEl) nameEl.textContent = peer?.displayName || "Chat";
  if (roleEl) roleEl.innerHTML = peer ? rolePillHtml(peer.roleLabel || peer.role) : "";
  if (avatarEl) avatarEl.innerHTML = peer ? contactAvatarHtml(peer.displayName, peer.role, true) : "";
}

function setThreadVisible(open) {
  const empty = document.getElementById("team-chat-thread-empty");
  const active = document.getElementById("team-chat-thread-active");
  const sidebar = document.getElementById("team-chat-sidebar");
  if (!empty || !active || !sidebar) return;
  const hasThread = !!open && !!activeConversationId;
  empty.classList.toggle("d-none", hasThread);
  active.classList.toggle("d-none", !hasThread);
  active.classList.toggle("d-flex", hasThread);
  // Keep the people/chats list visible on desktop; only hide on small screens.
  sidebar.classList.toggle("d-none", hasThread && mobileShowThread && isMobileChatLayout());
}

function isChatPanelOpen() {
  return document.getElementById("teamChatOffcanvas")?.classList.contains("show") ?? false;
}

function notifyIncomingMessage(conv) {
  const name = conv.peer?.displayName || "Someone";
  const preview = previewText(conv.lastMessage?.body);
  d().showToast(`New message from ${name}: ${preview}`, "primary");
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    try {
      const n = new Notification(`Message from ${name}`, {
        body: preview,
        tag: `taskmgr-chat-${conv.id}`,
      });
      n.onclick = () => {
        window.focus();
        void openChatFromDeepLink(conv.id);
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
}

async function loadConversations() {
  const data = await d().api("/api/chat/conversations");
  conversations = data.conversations ?? [];
  renderThreadList();
  await refreshUnreadBadges();
}

async function openConversation(conversationId) {
  activeConversationId = conversationId;
  mobileShowThread = isMobileChatLayout();

  const cached = conversations.find((c) => c.id === conversationId);
  if (cached?.peer) updateThreadPeerHeader(cached.peer);

  setThreadVisible(true);
  activeMessages = [];
  const host = document.getElementById("team-chat-messages");
  if (host) {
    host.innerHTML = `<div class="team-chat-messages-empty"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading…</span></div></div>`;
  }
  renderThreadList();

  try {
    const data = await d().api(`/api/chat/conversations/${conversationId}/messages`);
    activeMessages = data.messages ?? [];
    const peer = data.conversation?.peer;
    if (peer) updateThreadPeerHeader(peer);
    renderMessages();
    try {
      await d().api(`/api/chat/conversations/${conversationId}/read`, { method: "POST", body: "{}" });
      await loadConversations();
    } catch {
      /* ignore */
    }
  } catch (err) {
    activeConversationId = null;
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
    await loadConversations();
    if (data.conversation?.id) await openConversation(data.conversation.id);
  } catch (err) {
    d().showToast(err.message, "danger");
  }
}

async function sendMessage(e) {
  e.preventDefault();
  if (!activeConversationId) return;
  const input = document.getElementById("team-chat-input");
  const body = input?.value?.trim();
  if (!body) return;
  const btn = document.getElementById("team-chat-send");
  if (btn) btn.disabled = true;
  try {
    const data = await d().api(`/api/chat/conversations/${activeConversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (input) input.value = "";
    if (data.message) activeMessages.push(data.message);
    renderMessages();
    await loadConversations();
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

async function refreshChatData() {
  try {
    const prevUnread = lastUnreadTotal;
    const prevFingerprints = new Map(
      conversations.map((c) => [c.id, `${c.unreadCount}:${c.lastMessage?.id || ""}`])
    );

    await loadConversations();

    const unreadNow = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    if (!chatPollInitialized) {
      chatPollInitialized = true;
      lastUnreadTotal = unreadNow;
    } else if (unreadNow > prevUnread) {
      const incoming = conversations
        .filter((c) => c.unreadCount > 0 && c.id !== activeConversationId)
        .sort(
          (a, b) =>
            new Date(b.lastMessage?.createdAt || b.updatedAt).getTime() -
            new Date(a.lastMessage?.createdAt || a.updatedAt).getTime()
        )[0];
      if (incoming) notifyIncomingMessage(incoming);
    } else {
      for (const c of conversations) {
        const prev = prevFingerprints.get(c.id);
        const cur = `${c.unreadCount}:${c.lastMessage?.id || ""}`;
        if (prev === cur || c.lastMessage?.isMine) continue;
        const offcanvasOpen = isChatPanelOpen();
        if (c.id === activeConversationId && offcanvasOpen) continue;
        notifyIncomingMessage(c);
        break;
      }
    }
    lastUnreadTotal = unreadNow;

    if (activeConversationId && isChatPanelOpen()) {
      const data = await d().api(`/api/chat/conversations/${activeConversationId}/messages`);
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
  setThreadVisible(!!activeConversationId);
  syncChatPushButton();
  d().bootstrap.Offcanvas.getOrCreateInstance(el).show();
  void (async () => {
    try {
      await Promise.all([loadContacts(), loadConversations()]);
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
  openTeamChat();
  try {
    await loadConversations();
    await openConversation(conversationId);
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
  setSidebarTab("chats");
  offcanvas.addEventListener("shown.bs.offcanvas", () => {
    syncChatPushButton();
  });
  offcanvas.addEventListener("hidden.bs.offcanvas", () => {
    mobileShowThread = false;
    activeConversationId = null;
    activeMessages = [];
    setThreadVisible(false);
  });

  window.addEventListener("resize", () => {
    if (isChatPanelOpen() && activeConversationId) {
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
