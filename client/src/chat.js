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

export function teamChatOffcanvasHtml() {
  return `
    <div class="offcanvas offcanvas-end team-chat-offcanvas" tabindex="-1" id="teamChatOffcanvas" aria-labelledby="teamChatOffcanvasLabel">
      <div class="offcanvas-header border-bottom py-3">
        <div class="min-w-0 flex-grow-1">
          <h2 class="offcanvas-title h5 mb-0" id="teamChatOffcanvasLabel">Messages</h2>
          <p class="small text-muted mb-0">Chat with employees and admins</p>
        </div>
        <button type="button" class="btn btn-sm btn-outline-primary me-2 d-none js-chat-enable-push" id="team-chat-enable-push" title="Enable message notifications">
          <i class="bi bi-bell me-1" aria-hidden="true"></i><span class="d-none d-sm-inline">Notify</span>
        </button>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body p-0 d-flex flex-column team-chat-body">
        <div class="team-chat-layout flex-grow-1 min-h-0">
          <aside class="team-chat-sidebar border-end" id="team-chat-sidebar">
            <div class="p-3 border-bottom">
              <label class="visually-hidden" for="team-chat-search">Search people</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span>
                <input type="search" class="form-control" id="team-chat-search" placeholder="Search people…" autocomplete="off" />
              </div>
            </div>
            <div class="team-chat-thread-list" id="team-chat-thread-list" aria-live="polite"></div>
            <div class="team-chat-contacts border-top">
              <p class="small text-uppercase text-muted fw-semibold px-3 pt-3 mb-2">Start a chat</p>
              <div id="team-chat-contact-list"></div>
            </div>
          </aside>
          <section class="team-chat-thread" id="team-chat-thread">
            <div class="team-chat-thread-empty h-100 d-flex flex-column align-items-center justify-content-center text-center p-4" id="team-chat-thread-empty">
              <i class="bi bi-chat-left-text fs-1 text-secondary mb-3" aria-hidden="true"></i>
              <p class="mb-1 fw-semibold">Select a conversation</p>
              <p class="small text-muted mb-0">Pick someone from the list or start a new chat below.</p>
            </div>
            <div class="team-chat-thread-active d-none flex-column h-100" id="team-chat-thread-active">
              <div class="team-chat-thread-head border-bottom px-3 py-2 d-flex align-items-center gap-2">
                <button type="button" class="btn btn-sm btn-outline-secondary d-lg-none" id="team-chat-back" aria-label="Back to conversations">
                  <i class="bi bi-arrow-left" aria-hidden="true"></i>
                </button>
                <div class="min-w-0 flex-grow-1">
                  <div class="fw-semibold text-truncate" id="team-chat-peer-name">—</div>
                  <div class="small text-muted" id="team-chat-peer-role">—</div>
                </div>
              </div>
              <div class="team-chat-messages flex-grow-1" id="team-chat-messages" aria-live="polite"></div>
              <form class="team-chat-compose border-top p-3" id="team-chat-compose">
                <div class="input-group">
                  <textarea class="form-control" id="team-chat-input" rows="2" maxlength="4000" placeholder="Write a message…" aria-label="Message"></textarea>
                  <button class="btn btn-primary" type="submit" id="team-chat-send" aria-label="Send message">
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

function renderThreadList() {
  const host = document.getElementById("team-chat-thread-list");
  if (!host) return;
  if (!conversations.length) {
    host.innerHTML = `<p class="small text-muted px-3 py-2 mb-0">No conversations yet.</p>`;
    return;
  }
  host.innerHTML = conversations
    .map((c) => {
      const active = c.id === activeConversationId ? " team-chat-thread-item--active" : "";
      const unread = c.unreadCount > 0 ? `<span class="badge rounded-pill text-bg-primary ms-auto">${c.unreadCount}</span>` : "";
      const prefix = c.lastMessage?.isMine ? "You: " : "";
      return `<button type="button" class="team-chat-thread-item${active}" data-conversation-id="${c.id}">
        <span class="team-chat-thread-item-main">
          <span class="team-chat-thread-item-name text-truncate">${d().escapeHtml(c.peer.displayName)}</span>
          <span class="team-chat-thread-item-preview text-truncate">${d().escapeHtml(prefix + previewText(c.lastMessage?.body))}</span>
        </span>
        <span class="team-chat-thread-item-meta">
          <span class="small text-muted tabular-nums">${d().escapeHtml(formatChatTime(c.lastMessage?.createdAt || c.updatedAt))}</span>
          ${unread}
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
    host.innerHTML = `<p class="small text-muted px-3 pb-3 mb-0">No people found.</p>`;
    return;
  }
  host.innerHTML = list
    .map(
      (c) => `<button type="button" class="team-chat-contact-item" data-peer-id="${c.id}">
        <span class="team-chat-contact-avatar" aria-hidden="true">${d().escapeHtml(c.displayName.slice(0, 1).toUpperCase())}</span>
        <span class="min-w-0">
          <span class="d-block fw-medium text-truncate">${d().escapeHtml(c.displayName)}</span>
          <span class="d-block small text-muted text-truncate">${d().escapeHtml(c.roleLabel)}</span>
        </span>
      </button>`
    )
    .join("");
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
    host.innerHTML = `<p class="small text-muted text-center my-4">No messages yet. Say hello.</p>`;
    return;
  }
  host.innerHTML = activeMessages
    .map((m) => {
      const mine = m.isMine ? " team-chat-bubble-row--mine" : "";
      const role = m.senderRole === "owner" ? "Admin" : "Employee";
      return `<div class="team-chat-bubble-row${mine}">
        <div class="team-chat-bubble">
          ${m.isMine ? "" : `<div class="team-chat-bubble-sender">${d().escapeHtml(m.senderName)} · ${role}</div>`}
          <div class="team-chat-bubble-body text-break">${d().escapeHtml(m.body)}</div>
          <div class="team-chat-bubble-time tabular-nums">${d().escapeHtml(formatChatTime(m.createdAt))}</div>
        </div>
      </div>`;
    })
    .join("");
  host.scrollTop = host.scrollHeight;
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
  sidebar.classList.toggle("d-none", hasThread && mobileShowThread);
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
  mobileShowThread = true;
  const data = await d().api(`/api/chat/conversations/${conversationId}/messages`);
  activeMessages = data.messages ?? [];
  const peer = data.conversation?.peer;
  const nameEl = document.getElementById("team-chat-peer-name");
  const roleEl = document.getElementById("team-chat-peer-role");
  if (nameEl) nameEl.textContent = peer?.displayName || "Chat";
  if (roleEl) roleEl.textContent = peer?.roleLabel || "";
  renderThreadList();
  renderMessages();
  setThreadVisible(true);
  try {
    await d().api(`/api/chat/conversations/${conversationId}/read`, { method: "POST", body: "{}" });
    await loadConversations();
  } catch {
    /* ignore */
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
    renderContactList();
  });
  document.getElementById("team-chat-compose")?.addEventListener("submit", (e) => {
    void sendMessage(e);
  });
  document.getElementById("team-chat-back")?.addEventListener("click", () => {
    mobileShowThread = false;
    setThreadVisible(false);
  });
  offcanvas.addEventListener("shown.bs.offcanvas", () => {
    syncChatPushButton();
  });
  offcanvas.addEventListener("hidden.bs.offcanvas", () => {
    mobileShowThread = false;
    activeConversationId = null;
    activeMessages = [];
    setThreadVisible(false);
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
