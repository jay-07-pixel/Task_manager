/** @typedef {{ api: Function, escapeHtml: Function, showToast: Function, bootstrap: any, getUser: () => any }} ChatDeps */

const CHAT_POLL_MS_HIDDEN = 20000;
const CHAT_POLL_MS_CLOSED = 6000;
const CHAT_POLL_MS_OPEN = 2500;
/** Active thread poll — matches Android app (~3s) as SSE fallback. */
const CHAT_POLL_MS_ACTIVE = 3000;
const CHAT_TYPING_DEBOUNCE_MS = 400;
const CHAT_TYPING_IDLE_MS = 3000;
const CHAT_DELETE_WINDOW_MS = 30 * 60 * 1000;

/** @type {ChatDeps | null} */
let deps = null;
/** @type {number | null} */
let pollTimer = null;
/** @type {EventSource | null} */
let chatEventSource = null;
/** @type {number | null} */
let chatLiveRetryTimer = null;

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
/** @type {File | null} */
let pendingChatFile = null;
/** @type {boolean} */
let activeThreadIsGroup = false;
/** @type {string} */
let contactFilter = "";
/** @type {boolean} */
let mobileShowThread = false;
/** @type {"chats" | "people"} */
let sidebarTab = "chats";
/** @type {"all" | "group" | "dm"} */
let threadTypeFilter = "all";
/** @type {number} */
let lastUnreadTotal = 0;
/** @type {string} */
let manageMemberFilter = "";
/** @type {boolean} */
let chatPollInitialized = false;
/** @type {{ id: string, displayName: string }[]} */
let activeTypingUsers = [];
/** @type {boolean} */
let typingPulseActive = false;
/** @type {number | null} */
let typingStopTimer = null;
/** @type {any | null} */
let replyingTo = null;
/** @type {number | null} */
let typingDebounceTimer = null;

function getChatPollMs() {
  if (document.hidden) return CHAT_POLL_MS_HIDDEN;
  if (!isChatPanelOpen()) return CHAT_POLL_MS_CLOSED;
  if (activeChatId && activeThreadType) return CHAT_POLL_MS_ACTIVE;
  return CHAT_POLL_MS_OPEN;
}

async function refreshActiveMessages() {
  if (!activeChatId || !activeThreadType || !isChatPanelOpen()) return;
  const base =
    activeThreadType === "group"
      ? `/api/chat/groups/${activeChatId}`
      : `/api/chat/conversations/${activeChatId}`;
  const prevFp = JSON.stringify(
    activeMessages.map((m) => ({
      id: m.id,
      readAt: m.readAt ?? null,
      seenCount: m.seenCount ?? null,
      seenByAll: !!m.seenByAll,
      deleted: !!m.deleted,
      body: m.body ?? "",
      replyToId: m.replyTo?.id ?? null,
    }))
  );
  const data = await d().api(`${base}/messages`);
  const next = data.messages ?? [];
  const nextFp = JSON.stringify(
    next.map((m) => ({
      id: m.id,
      readAt: m.readAt ?? null,
      seenCount: m.seenCount ?? null,
      seenByAll: !!m.seenByAll,
      deleted: !!m.deleted,
      body: m.body ?? "",
      replyToId: m.replyTo?.id ?? null,
    }))
  );
  const typingUsers = data.typingUsers ?? [];
  const typingChanged =
    JSON.stringify(typingUsers.map((u) => u.id)) !==
    JSON.stringify(activeTypingUsers.map((u) => u.id));
  if (nextFp === prevFp && !typingChanged) return;

  activeMessages = next;
  activeTypingUsers = typingUsers;
  renderMessages();
  updateTypingIndicator();

  await markActiveThreadRead();
  void refreshUnreadBadges();
  void loadThreads();
}

function activeThreadBase() {
  if (!activeChatId || !activeThreadType) return null;
  return activeThreadType === "group"
    ? `/api/chat/groups/${activeChatId}`
    : `/api/chat/conversations/${activeChatId}`;
}

async function markActiveThreadRead() {
  const base = activeThreadBase();
  if (!base) return;
  try {
    await d().api(`${base}/read`, { method: "POST", body: "{}" });
  } catch {
    /* ignore */
  }
}

function onChatLivePayload(payload) {
  if (!payload || payload.type === "connected") return;
  if (payload.kind === "thread_deleted" && payload.threadType === "group" && payload.threadId === activeChatId) {
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    activeMessages = [];
    activeTypingUsers = [];
    setThreadVisible(false);
    syncGroupManageUi();
    void loadThreads();
    return;
  }
  if (
    payload.kind === "typing" &&
    payload.threadType === activeThreadType &&
    payload.threadId === activeChatId &&
    isChatPanelOpen()
  ) {
    const meId = d().getUser()?.id;
    if (payload.userId === meId) return;
    if (payload.typing) {
      const name = payload.displayName || "Someone";
      const existing = activeTypingUsers.filter((u) => u.id !== payload.userId);
      activeTypingUsers = [...existing, { id: payload.userId, displayName: name }];
    } else {
      activeTypingUsers = activeTypingUsers.filter((u) => u.id !== payload.userId);
    }
    updateTypingIndicator();
    return;
  }
  if (
    payload.kind === "read" &&
    payload.threadType === activeThreadType &&
    payload.threadId === activeChatId
  ) {
    const meId = d().getUser()?.id;
    if (payload.readerId !== meId && payload.readAt && isChatPanelOpen()) {
      activeMessages = activeMessages.map((m) =>
        m.isMine && !m.readAt ? { ...m, readAt: payload.readAt } : m
      );
      renderMessages();
      void refreshActiveMessages();
    }
    void loadThreads();
    return;
  }
  if (
    payload.kind === "deleted" &&
    payload.threadType === activeThreadType &&
    payload.threadId === activeChatId &&
    isChatPanelOpen()
  ) {
    void refreshActiveMessages().then(() => loadThreads());
    return;
  }
  if (
    payload.kind === "message" &&
    payload.threadType === activeThreadType &&
    payload.threadId === activeChatId &&
    isChatPanelOpen()
  ) {
    void refreshActiveMessages().then(() => loadThreads());
    return;
  }
  void refreshChatData();
}

function stopChatLive() {
  if (chatLiveRetryTimer != null) {
    window.clearTimeout(chatLiveRetryTimer);
    chatLiveRetryTimer = null;
  }
  if (chatEventSource) {
    chatEventSource.close();
    chatEventSource = null;
  }
}

function startChatLive() {
  if (!("EventSource" in window) || chatEventSource) return;
  try {
    chatEventSource = new EventSource("/api/chat/live");
    chatEventSource.onmessage = (event) => {
      try {
        onChatLivePayload(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    };
    chatEventSource.onerror = () => {
      stopChatLive();
      chatLiveRetryTimer = window.setTimeout(() => {
        chatLiveRetryTimer = null;
        startChatLive();
      }, 5000);
    };
  } catch {
    /* unsupported */
  }
}

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

const CHAT_TIME_ZONE = (import.meta.env.VITE_APP_TIMEZONE || "Asia/Kolkata").trim() || "Asia/Kolkata";

function dateKeyInTimeZone(dt, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

function formatChatTime(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameDay = dateKeyInTimeZone(dt, CHAT_TIME_ZONE) === dateKeyInTimeZone(now, CHAT_TIME_ZONE);
  if (sameDay) {
    return dt.toLocaleTimeString("en-IN", {
      timeZone: CHAT_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
  return dt.toLocaleString("en-IN", {
    timeZone: CHAT_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const CHAT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const CHAT_MAX_FILE_MB = 5;

function formatTypingLabel(users) {
  if (!users.length) return "";
  const names = users.map((u) => u.displayName || "Someone");
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

function updateTypingIndicator() {
  const el = document.getElementById("team-chat-typing-status");
  if (!el) return;
  const label = formatTypingLabel(activeTypingUsers);
  el.textContent = label;
  el.classList.toggle("d-none", !label);
}

function messageStatusHtml(m) {
  if (!m.isMine) return "";
  if (activeThreadType === "group") {
    const total = m.seenTotal ?? 0;
    const count = m.seenCount ?? 0;
    if (total <= 0) return "";
    if (m.seenByAll) {
      return `<span class="team-chat-msg-status"><i class="bi bi-check2-all" aria-hidden="true"></i> Seen by all</span>`;
    }
    if (count > 0) {
      return `<span class="team-chat-msg-status"><i class="bi bi-check2-all" aria-hidden="true"></i> Seen by ${count}</span>`;
    }
    return `<span class="team-chat-msg-status team-chat-msg-status--sent"><i class="bi bi-check2" aria-hidden="true"></i> Sent</span>`;
  }
  if (m.readAt) {
    return `<span class="team-chat-msg-status"><i class="bi bi-check2-all" aria-hidden="true"></i> Seen</span>`;
  }
  return `<span class="team-chat-msg-status team-chat-msg-status--sent"><i class="bi bi-check2" aria-hidden="true"></i> Sent</span>`;
}

async function postTyping(typing) {
  if (!activeChatId || !activeThreadType) return;
  const base =
    activeThreadType === "group"
      ? `/api/chat/groups/${activeChatId}`
      : `/api/chat/conversations/${activeChatId}`;
  try {
    await d().api(`${base}/typing`, { method: "POST", body: JSON.stringify({ typing }) });
  } catch {
    /* ignore */
  }
}

function stopTypingPulse() {
  if (typingDebounceTimer != null) {
    window.clearTimeout(typingDebounceTimer);
    typingDebounceTimer = null;
  }
  if (typingStopTimer != null) {
    window.clearTimeout(typingStopTimer);
    typingStopTimer = null;
  }
  if (typingPulseActive) {
    typingPulseActive = false;
    void postTyping(false);
  }
}

function pulseTyping() {
  if (!activeChatId || !activeThreadType || !isChatPanelOpen()) return;

  if (!typingPulseActive && typingDebounceTimer == null) {
    typingDebounceTimer = window.setTimeout(() => {
      typingDebounceTimer = null;
      if (!activeChatId || !isChatPanelOpen()) return;
      typingPulseActive = true;
      void postTyping(true);
    }, CHAT_TYPING_DEBOUNCE_MS);
  }

  if (typingStopTimer != null) window.clearTimeout(typingStopTimer);
  typingStopTimer = window.setTimeout(() => {
    typingStopTimer = null;
    stopTypingPulse();
  }, CHAT_TYPING_IDLE_MS);
}

function previewText(body, hasAttachment, deleted = false) {
  if (deleted) return "Message deleted";
  const t = String(body || "").trim().replace(/\s+/g, " ");
  if (t) return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  if (hasAttachment) return "Attachment";
  return "No messages yet";
}

function messageCanDelete(m) {
  if (!m?.isMine || m.deleted) return false;
  const age = Date.now() - new Date(m.createdAt).getTime();
  return age <= CHAT_DELETE_WINDOW_MS;
}

function replyQuotePreview(replyTo) {
  if (!replyTo) return "";
  if (replyTo.deleted) return "Message deleted";
  const t = String(replyTo.body || "").trim();
  if (t) return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  return "Attachment";
}

function clearReplyingTo() {
  replyingTo = null;
  renderReplyComposerPreview();
}

function startReplyToMessage(m) {
  if (!m || m.deleted) return;
  replyingTo = {
    id: m.id,
    senderName: m.isMine ? "You" : m.senderName || "Member",
    body: replyQuotePreview(m),
    deleted: false,
  };
  renderReplyComposerPreview();
  document.getElementById("team-chat-input")?.focus();
}

function renderReplyComposerPreview() {
  const wrap = document.getElementById("team-chat-reply-preview");
  if (!wrap) return;
  if (!replyingTo) {
    wrap.classList.add("d-none");
    wrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("d-none");
  wrap.innerHTML = `
    <div class="team-chat-reply-compose">
      <div class="team-chat-reply-compose-main min-w-0">
        <span class="team-chat-reply-compose-label">Replying to ${d().escapeHtml(replyingTo.senderName)}</span>
        <span class="team-chat-reply-compose-text text-truncate">${d().escapeHtml(replyingTo.body)}</span>
      </div>
      <button type="button" class="btn btn-sm btn-link text-muted p-0 js-chat-reply-cancel" aria-label="Cancel reply">&times;</button>
    </div>`;
}

async function deleteChatMessage(messageId) {
  const base = activeThreadBase();
  if (!base || !messageId) return;
  if (!window.confirm("Delete this message? The other person will see it was removed.")) return;
  try {
    const data = await d().api(`${base}/messages/${messageId}`, { method: "DELETE" });
    if (data.message) {
      activeMessages = activeMessages.map((m) => (m.id === messageId ? data.message : m));
      renderMessages();
    } else {
      void refreshActiveMessages();
    }
    await loadThreads();
  } catch (err) {
    d().showToast(err.message, "danger");
  }
}

function isVideoAttachment(m) {
  if (m.attachmentIsVideo) return true;
  if (typeof m.attachmentMime === "string" && m.attachmentMime.startsWith("video/")) return true;
  return /\.(mp4|m4v|webm|mov|mkv|avi|3gp|3g2|ogv|mpeg|mpg)$/i.test(m.attachmentName || "");
}

function isImageAttachment(m) {
  if (m.attachmentIsImage) return true;
  if (typeof m.attachmentMime === "string" && m.attachmentMime.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(m.attachmentName || "");
}

function isPdfAttachment(m) {
  if (m.attachmentMime === "application/pdf") return true;
  return /\.pdf$/i.test(m.attachmentName || "");
}

function chatMediaDataAttrs(url, type, name, mime = "") {
  return `data-media-url="${url}" data-media-type="${type}" data-media-name="${name}" data-media-mime="${d().escapeHtml(mime)}"`;
}

function openChatMediaLightbox({ url, type, name, mime }) {
  const box = document.getElementById("team-chat-media-lightbox");
  const inner = document.getElementById("team-chat-media-lightbox-inner");
  if (!box || !inner || !url) return;
  let html = "";
  if (type === "image") {
    html = `<img src="${d().escapeHtml(url)}" alt="${d().escapeHtml(name || "Image")}" class="team-chat-media-lightbox-image" />`;
  } else if (type === "video") {
    const videoMime = mime && mime.startsWith("video/") ? mime : "video/mp4";
    html = `<video class="team-chat-media-lightbox-video" controls autoplay playsinline src="${d().escapeHtml(url)}" type="${d().escapeHtml(videoMime)}"></video>`;
  } else if (type === "pdf") {
    html = `<iframe class="team-chat-media-lightbox-pdf" src="${d().escapeHtml(url)}" title="${d().escapeHtml(name || "PDF")}"></iframe>`;
  } else {
    return;
  }
  inner.innerHTML = html;
  box.classList.remove("d-none");
  document.body.classList.add("team-chat-media-lightbox-open");
}

function closeChatMediaLightbox() {
  const box = document.getElementById("team-chat-media-lightbox");
  const inner = document.getElementById("team-chat-media-lightbox-inner");
  if (inner) {
    inner.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    inner.innerHTML = "";
  }
  box?.classList.add("d-none");
  document.body.classList.remove("team-chat-media-lightbox-open");
}

let chatMediaLightboxWired = false;

function wireChatMediaLightbox() {
  if (chatMediaLightboxWired) return;
  chatMediaLightboxWired = true;

  document.getElementById("team-chat-messages")?.addEventListener("click", (e) => {
    const replyBtn = e.target.closest(".js-chat-reply");
    if (replyBtn) {
      e.preventDefault();
      const messageId = replyBtn.getAttribute("data-message-id");
      const message = activeMessages.find((m) => m.id === messageId);
      if (message) startReplyToMessage(message);
      return;
    }
    const deleteBtn = e.target.closest(".js-chat-delete");
    if (deleteBtn) {
      e.preventDefault();
      void deleteChatMessage(deleteBtn.getAttribute("data-message-id"));
      return;
    }
    const playBtn = e.target.closest(".js-chat-inline-video-play");
    if (playBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = playBtn.closest(".team-chat-attach-video-wrap");
      const video = wrap?.querySelector(".js-chat-inline-video");
      const url = playBtn.getAttribute("data-video-url");
      if (video && url) {
        playBtn.classList.add("d-none");
        video.classList.remove("d-none");
        if (!video.src) video.src = url;
        void video.play().catch(() => {
          d().showToast("Could not play video. Try full screen or download.", "warning");
        });
      }
      return;
    }
    const open = e.target.closest(".js-chat-media-open");
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    openChatMediaLightbox({
      url: open.getAttribute("data-media-url") || "",
      type: open.getAttribute("data-media-type") || "image",
      name: open.getAttribute("data-media-name") || "",
      mime: open.getAttribute("data-media-mime") || "",
    });
  });

  document.getElementById("team-chat-media-lightbox")?.addEventListener("click", (e) => {
    if (e.target.closest(".js-chat-media-lightbox-close") || e.target.classList.contains("team-chat-media-lightbox-backdrop")) {
      closeChatMediaLightbox();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("team-chat-media-lightbox")?.classList.contains("d-none")) {
      closeChatMediaLightbox();
    }
  });
}

function messageAttachmentHtml(m) {
  if (!m.attachmentUrl) return "";
  const name = m.attachmentName || "File";
  const url = d().escapeHtml(m.attachmentUrl);
  const safeName = d().escapeHtml(name);
  const expandIcon = `<span class="team-chat-media-expand-icon" aria-hidden="true"><i class="bi bi-arrows-fullscreen"></i></span>`;
  if (isImageAttachment(m)) {
    const attrs = chatMediaDataAttrs(url, "image", safeName, m.attachmentMime || "");
    return `<button type="button" class="team-chat-attach-media-btn js-chat-media-open" ${attrs} aria-label="View image full screen" title="Full screen">
      <img src="${url}" alt="${safeName}" class="team-chat-attach-image" loading="lazy" />
      ${expandIcon}
    </button>`;
  }
  if (isVideoAttachment(m)) {
    const mime = m.attachmentMime && m.attachmentMime.startsWith("video/") ? m.attachmentMime : "video/mp4";
    const attrs = chatMediaDataAttrs(url, "video", safeName, mime);
    return `<div class="team-chat-attach-video-wrap">
      <button type="button" class="team-chat-attach-video-play js-chat-inline-video-play" data-video-url="${url}" data-video-mime="${d().escapeHtml(mime)}" aria-label="Play video">
        <i class="bi bi-play-circle-fill" aria-hidden="true"></i>
        <span class="text-truncate">${safeName}</span>
      </button>
      <video class="team-chat-attach-video d-none js-chat-inline-video" controls playsinline preload="none"></video>
      <button type="button" class="team-chat-media-expand-btn js-chat-media-open" ${attrs} aria-label="View video full screen" title="Full screen">
        <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
      </button>
    </div>`;
  }
  if (isPdfAttachment(m)) {
    const attrs = chatMediaDataAttrs(url, "pdf", safeName, "application/pdf");
    return `<div class="team-chat-attach-file-row">
      <button type="button" class="team-chat-attach-view-btn js-chat-media-open" ${attrs}>
        <i class="bi bi-file-earmark-pdf" aria-hidden="true"></i>
        <span class="text-truncate">${safeName}</span>
        <span class="team-chat-attach-view-label">View</span>
      </button>
      <a href="${url}" class="team-chat-attach-file team-chat-attach-file--compact" download="${safeName}" title="Download">
        <i class="bi bi-download" aria-hidden="true"></i>
      </a>
    </div>`;
  }
  return `<a href="${url}" class="team-chat-attach-file" download="${safeName}">
    <i class="bi bi-file-earmark-arrow-down" aria-hidden="true"></i>
    <span class="text-truncate">${safeName}</span>
  </a>`;
}

function messageReplyQuoteHtml(m) {
  if (!m.replyTo) return "";
  const name = d().escapeHtml(m.replyTo.senderName || "Member");
  const text = d().escapeHtml(replyQuotePreview(m.replyTo));
  return `<div class="team-chat-reply-quote" aria-label="Reply to ${name}">
    <span class="team-chat-reply-quote-name">${name}</span>
    <span class="team-chat-reply-quote-text">${text}</span>
  </div>`;
}

function messageDeletedHtml() {
  return `<div class="team-chat-bubble-deleted"><i class="bi bi-slash-circle me-1" aria-hidden="true"></i>This message was deleted</div>`;
}

function messageBodyHtml(m) {
  if (m.deleted) {
    return messageDeletedHtml();
  }
  const attach = messageAttachmentHtml(m);
  const text = String(m.body || "").trim();
  const textHtml = text
    ? `<div class="team-chat-bubble-body text-break">${d().escapeHtml(m.body)}</div>`
    : "";
  return `${messageReplyQuoteHtml(m)}${attach}${textHtml}`;
}

function messageActionsHtml(m) {
  if (m.deleted) return "";
  const canDelete = messageCanDelete(m);
  const replyBtn = `<button type="button" class="team-chat-msg-action js-chat-reply" data-message-id="${d().escapeHtml(m.id)}" aria-label="Reply" title="Reply">
    <i class="bi bi-reply-fill" aria-hidden="true"></i>
  </button>`;
  const deleteBtn = canDelete
    ? `<button type="button" class="team-chat-msg-action team-chat-msg-action--danger js-chat-delete" data-message-id="${d().escapeHtml(m.id)}" aria-label="Delete" title="Delete (30 min)">
        <i class="bi bi-trash" aria-hidden="true"></i>
      </button>`
    : "";
  return `<div class="team-chat-msg-actions">${replyBtn}${deleteBtn}</div>`;
}

function clearPendingChatFile() {
  pendingChatFile = null;
  const input = document.getElementById("team-chat-file-input");
  if (input) input.value = "";
  renderAttachPreview();
}

function renderAttachPreview() {
  const wrap = document.getElementById("team-chat-attach-preview");
  if (!wrap) return;
  if (!pendingChatFile) {
    wrap.classList.add("d-none");
    wrap.innerHTML = "";
    return;
  }
  const name = pendingChatFile.name;
  const isImage = pendingChatFile.type.startsWith("image/");
  const isVideo = pendingChatFile.type.startsWith("video/");
  const thumb = isImage
    ? `<img src="" alt="" class="team-chat-attach-preview-thumb" id="team-chat-attach-preview-thumb" />`
    : isVideo
      ? `<span class="team-chat-attach-preview-icon" aria-hidden="true"><i class="bi bi-camera-video"></i></span>`
      : `<span class="team-chat-attach-preview-icon" aria-hidden="true"><i class="bi bi-file-earmark"></i></span>`;
  wrap.classList.remove("d-none");
  wrap.innerHTML = `
    <div class="team-chat-attach-preview">
      ${thumb}
      <span class="team-chat-attach-preview-name text-truncate">${d().escapeHtml(name)}</span>
      <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-auto" id="team-chat-attach-remove" aria-label="Remove attachment">&times;</button>
    </div>`;
  if (isImage) {
    const img = document.getElementById("team-chat-attach-preview-thumb");
    if (img) {
      const url = URL.createObjectURL(pendingChatFile);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    }
  }
  document.getElementById("team-chat-attach-remove")?.addEventListener("click", () => {
    clearPendingChatFile();
  });
}

async function postChatMessage(base, body, file, replyToMessageId) {
  const fd = new FormData();
  if (body) fd.append("body", body);
  if (file) fd.append("file", file);
  if (replyToMessageId) fd.append("replyToMessageId", replyToMessageId);
  let res;
  try {
    res = await fetch(`${base}/messages`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
  } catch {
    throw new Error("Network error sending message.");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error(
        `File is too large for the server. Use a file under ${CHAT_MAX_FILE_MB} MB, or ask your admin to set nginx client_max_body_size to 6m.`
      );
    }
    let msg = data?.error;
    if (!msg && text && /413|entity too large/i.test(text)) {
      msg =
        "File is too large for the server. Ask your admin to set nginx client_max_body_size to 6m on the VPS.";
    }
    throw new Error(msg || "Could not send message.");
  }
  return data;
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
              <div class="team-chat-thread-type-tabs" role="tablist" aria-label="Chat type filters">
                <button type="button" class="team-chat-thread-type-tab team-chat-thread-type-tab--active" data-chat-thread-type="all" aria-pressed="true">All</button>
                <button type="button" class="team-chat-thread-type-tab" data-chat-thread-type="group" aria-pressed="false">Groups</button>
                <button type="button" class="team-chat-thread-type-tab" data-chat-thread-type="dm" aria-pressed="false">1-to-1</button>
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
                <button type="button" class="team-chat-thread-head-main min-w-0 flex-grow-1 text-start border-0 bg-transparent p-0" id="team-chat-thread-head-main">
                  <div class="fw-semibold text-truncate" id="team-chat-peer-name">—</div>
                  <div id="team-chat-peer-role"></div>
                </button>
                <button type="button" class="btn btn-sm btn-light border team-chat-group-manage-btn d-none" id="team-chat-group-manage-btn" title="Manage group" aria-label="Manage group">
                  <i class="bi bi-people-fill" aria-hidden="true"></i>
                </button>
              </div>
              <div class="team-chat-messages flex-grow-1" id="team-chat-messages" aria-live="polite"></div>
              <div id="team-chat-typing-status" class="team-chat-typing-status px-3 small text-muted d-none" aria-live="polite"></div>
              <form class="team-chat-compose" id="team-chat-compose">
                <div id="team-chat-reply-preview" class="d-none"></div>
                <div id="team-chat-attach-preview" class="d-none"></div>
                <div class="team-chat-compose-inner">
                  <input type="file" class="d-none" id="team-chat-file-input" accept="*/*" />
                  <button type="button" class="btn btn-light border team-chat-attach-btn" id="team-chat-attach-btn" aria-label="Attach file">
                    <i class="bi bi-paperclip" aria-hidden="true"></i>
                  </button>
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
    <div class="modal fade team-chat-group-modal" id="teamChatCreateGroupModal" tabindex="-1" aria-labelledby="teamChatCreateGroupLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content team-chat-group-modal-content">
          <form id="team-chat-create-group-form">
            <div class="modal-header border-bottom-0 pb-0">
              <h2 class="modal-title h5" id="teamChatCreateGroupLabel">Create group</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body team-chat-group-modal-body pt-2">
              <label class="form-label team-chat-group-label" for="team-chat-group-name">Group name</label>
              <input type="text" class="form-control mb-3" id="team-chat-group-name" maxlength="80" required placeholder="e.g. Sales team" />
              <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="team-chat-group-everyone" checked />
                <label class="form-check-label" for="team-chat-group-everyone">Include everyone on the team</label>
              </div>
              <div class="d-none" id="team-chat-group-members-wrap">
                <div class="team-chat-group-members-toolbar mb-2">
                  <label class="form-label team-chat-group-label mb-0">Members</label>
                  <span class="team-chat-member-count-text" id="team-chat-create-member-count">0 selected</span>
                </div>
                <div class="team-chat-member-pick-list" id="team-chat-group-member-picks"></div>
              </div>
            </div>
            <div class="modal-footer border-top-0 pt-0">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-dark" id="team-chat-group-submit">Create group</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="modal fade team-chat-group-modal" id="teamChatManageGroupModal" tabindex="-1" aria-labelledby="teamChatManageGroupLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content team-chat-group-modal-content">
          <form id="team-chat-manage-group-form">
            <div class="modal-header border-bottom-0 pb-0">
              <h2 class="modal-title h5" id="teamChatManageGroupLabel">Manage group</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body team-chat-group-modal-body pt-2">
              <label class="form-label team-chat-group-label" for="team-chat-manage-group-name">Group name</label>
              <input type="text" class="form-control mb-4" id="team-chat-manage-group-name" maxlength="80" required placeholder="Group name" />
              <div class="team-chat-group-members-toolbar mb-2">
                <label class="form-label team-chat-group-label mb-0">Members</label>
                <span class="team-chat-member-count-text" id="team-chat-manage-member-count">0 selected</span>
                <div class="team-chat-group-members-actions ms-auto">
                  <button type="button" class="btn btn-sm btn-link text-muted text-decoration-none p-0" id="team-chat-manage-select-all">Select all</button>
                  <span class="text-muted" aria-hidden="true">·</span>
                  <button type="button" class="btn btn-sm btn-link text-muted text-decoration-none p-0" id="team-chat-manage-select-none">Clear</button>
                </div>
              </div>
              <input type="search" class="form-control form-control-sm mb-2" id="team-chat-manage-member-search" placeholder="Search members…" autocomplete="off" />
              <div class="team-chat-member-pick-list" id="team-chat-manage-member-picks"></div>
            </div>
            <div class="modal-footer team-chat-group-modal-footer--split border-top-0 pt-0">
              <button type="button" class="btn btn-link text-danger text-decoration-none px-0" id="team-chat-delete-group-btn">Delete group</button>
              <div class="team-chat-group-modal-actions">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-dark" id="team-chat-manage-group-submit">Save</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div id="team-chat-media-lightbox" class="team-chat-media-lightbox d-none" role="dialog" aria-modal="true" aria-label="Full screen media">
      <button type="button" class="team-chat-media-lightbox-backdrop js-chat-media-lightbox-close" aria-label="Close"></button>
      <button type="button" class="team-chat-media-lightbox-close js-chat-media-lightbox-close" aria-label="Close">
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
      <div class="team-chat-media-lightbox-inner" id="team-chat-media-lightbox-inner"></div>
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

function syncGroupManageUi() {
  const btn = document.getElementById("team-chat-group-manage-btn");
  const headMain = document.getElementById("team-chat-thread-head-main");
  const show = isAdminUser() && activeThreadIsGroup && !!activeChatId;
  btn?.classList.toggle("d-none", !show);
  headMain?.classList.toggle("team-chat-thread-head-main--clickable", show);
}

function allPeopleForPicks() {
  const meId = d().getUser()?.id;
  const allPeople = [...contacts];
  if (meId && !allPeople.some((c) => c.id === meId)) {
    const me = d().getUser();
    allPeople.unshift({
      id: meId,
      displayName: me?.displayName || "You",
      email: me?.email || "",
      role: me?.role || "owner",
      roleLabel: me?.role === "owner" ? "Admin" : "Employee",
    });
  }
  return allPeople;
}

function countCheckedInList(listId) {
  return document.querySelectorAll(`#${listId} input.team-chat-member-pick-input:checked`).length;
}

function updateMemberPickCount(countId, listId) {
  const el = document.getElementById(countId);
  if (!el) return;
  const n = countCheckedInList(listId);
  el.textContent = `${n} selected`;
}

function neutralAvatarHtml(name) {
  const initial = String(name || "?").slice(0, 1).toUpperCase();
  return `<span class="team-chat-neutral-avatar" aria-hidden="true">${d().escapeHtml(initial)}</span>`;
}

function memberPickRowHtml(c, selected, inputPrefix, meId) {
  const checked = selected.has(c.id);
  const isMe = c.id === meId;
  const onCls = checked ? " team-chat-member-pick-row--on" : "";
  const roleLabel = c.roleLabel || (c.role === "owner" ? "Admin" : "Employee");
  return `<label class="team-chat-member-pick-row${onCls}">
    <input type="checkbox" class="form-check-input team-chat-member-pick-input flex-shrink-0" value="${c.id}" id="${inputPrefix}-pick-${c.id}"${checked ? " checked" : ""}${isMe ? " disabled" : ""} />
    ${neutralAvatarHtml(c.displayName)}
    <span class="team-chat-member-pick-info min-w-0">
      <span class="team-chat-member-pick-name text-truncate">${d().escapeHtml(c.displayName)}${isMe ? ' <span class="team-chat-member-you-tag">(you)</span>' : ""}</span>
      <span class="team-chat-member-pick-role">${d().escapeHtml(roleLabel)}</span>
    </span>
  </label>`;
}

function renderMemberPickList(hostId, selectedIds, { inputPrefix = "manage", searchQuery = "", countId = null } = {}) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const selected = new Set(selectedIds);
  const meId = d().getUser()?.id;
  let allPeople = allPeopleForPicks();
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    allPeople = allPeople.filter(
      (c) => c.displayName.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q)
    );
  }
  const admins = allPeople.filter((c) => c.role === "owner");
  const employees = allPeople.filter((c) => c.role !== "owner");
  const section = (title, items) => {
    if (!items.length) return "";
    return `<div class="team-chat-member-pick-section">
      <p class="team-chat-member-pick-section-label">${title}</p>
      <div class="team-chat-member-pick-section-list">
        ${items.map((c) => memberPickRowHtml(c, selected, inputPrefix, meId)).join("")}
      </div>
    </div>`;
  };
  host.innerHTML =
    admins.length || employees.length
      ? section("Admins", admins) + section("Employees", employees)
      : `<p class="small text-muted text-center py-4 mb-0">No members match your search.</p>`;
  if (countId) updateMemberPickCount(countId, hostId);
}

function renderManageMemberPicks(selectedIds = []) {
  renderMemberPickList("team-chat-manage-member-picks", selectedIds, {
    inputPrefix: "team-chat-manage",
    searchQuery: manageMemberFilter,
    countId: "team-chat-manage-member-count",
  });
}

function renderGroupMemberPicks() {
  const checked = [];
  document.querySelectorAll("#team-chat-group-member-picks input:checked").forEach((el) => {
    checked.push(el.value);
  });
  const selectedIds = checked.length ? checked : allPeopleForPicks().map((c) => c.id);
  renderMemberPickList("team-chat-group-member-picks", selectedIds, {
    inputPrefix: "team-chat-create",
    countId: "team-chat-create-member-count",
  });
}

async function openManageGroupModal() {
  if (!isAdminUser() || !activeChatId || activeThreadType !== "group") return;
  try {
    const data = await d().api(`/api/chat/groups/${activeChatId}`);
    const nameInput = document.getElementById("team-chat-manage-group-name");
    if (nameInput) nameInput.value = data.group?.name || "";
    manageMemberFilter = "";
    const searchEl = document.getElementById("team-chat-manage-member-search");
    if (searchEl) searchEl.value = "";
    renderManageMemberPicks((data.members ?? []).map((m) => m.id));
    const modalEl = document.getElementById("teamChatManageGroupModal");
    if (modalEl) d().bootstrap.Modal.getOrCreateInstance(modalEl).show();
  } catch (err) {
    d().showToast(err.message || "Could not load group", "danger");
  }
}

async function saveManageGroup(e) {
  e.preventDefault();
  if (!activeChatId || activeThreadType !== "group") return;
  const nameInput = document.getElementById("team-chat-manage-group-name");
  const submit = document.getElementById("team-chat-manage-group-submit");
  const name = nameInput?.value?.trim();
  if (!name) return;

  const memberIds = [];
  document.querySelectorAll("#team-chat-manage-member-picks input.team-chat-member-pick-input:checked").forEach((el) => {
    memberIds.push(el.value);
  });
  const meId = d().getUser()?.id;
  if (meId && !memberIds.includes(meId)) memberIds.push(meId);
  if (!memberIds.length) {
    d().showToast("Select at least one member.", "warning");
    return;
  }

  if (submit) submit.disabled = true;
  try {
    await d().api(`/api/chat/groups/${activeChatId}`, {
      method: "PATCH",
      body: JSON.stringify({ name, memberIds }),
    });
    const modalEl = document.getElementById("teamChatManageGroupModal");
    if (modalEl) d().bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    d().showToast("Group updated.", "success");
    await loadThreads();
    const cached = threads.find((t) => t.type === "group" && t.id === activeChatId);
    if (cached) updateThreadHeaderFromThread(cached);
  } catch (err) {
    d().showToast(err.message, "danger");
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function deleteActiveGroup() {
  if (!isAdminUser() || !activeChatId || activeThreadType !== "group") return;
  const cached = threads.find((t) => t.type === "group" && t.id === activeChatId);
  const groupName = cached?.group?.name || "this group";
  if (!window.confirm(`Delete "${groupName}"? All messages in this group will be removed.`)) return;

  const btn = document.getElementById("team-chat-delete-group-btn");
  if (btn) btn.disabled = true;
  try {
    await d().api(`/api/chat/groups/${activeChatId}`, { method: "DELETE" });
    const modalEl = document.getElementById("teamChatManageGroupModal");
    if (modalEl) d().bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    activeMessages = [];
    setThreadVisible(false);
    syncGroupManageUi();
    d().showToast("Group deleted.", "success");
    await loadThreads();
  } catch (err) {
    d().showToast(err.message, "danger");
  } finally {
    if (btn) btn.disabled = false;
  }
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

function setThreadTypeFilter(nextFilter) {
  threadTypeFilter =
    nextFilter === "group" || nextFilter === "dm" || nextFilter === "all" ? nextFilter : "all";
  document.querySelectorAll(".team-chat-thread-type-tab").forEach((btn) => {
    const on = btn.getAttribute("data-chat-thread-type") === threadTypeFilter;
    btn.classList.toggle("team-chat-thread-type-tab--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderThreadList();
}

function renderThreadList() {
  const host = document.getElementById("team-chat-thread-list");
  if (!host) return;
  const list = filteredThreads().filter((t) => {
    if (threadTypeFilter === "group") return t.type === "group";
    if (threadTypeFilter === "dm") return t.type === "dm";
    return true;
  });
  if (!list.length) {
    const emptyByType =
      threadTypeFilter === "group"
        ? "No groups found."
        : threadTypeFilter === "dm"
          ? "No 1-to-1 chats found."
          : "No chats match your search.";
    host.innerHTML = `<div class="team-chat-list-empty">
      <p class="small text-muted mb-0">${contactFilter.trim() ? emptyByType : "No conversations yet. Admins can create a group, or open People to DM someone."}</p>
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
      const typeCls = isGroup ? " team-chat-thread-item--group" : " team-chat-thread-item--dm";
      return `<button type="button" class="team-chat-thread-item${typeCls}${active}${unreadRow}" data-thread-type="${t.type}" data-thread-id="${t.id}">
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
            <span class="team-chat-thread-item-preview text-truncate">${d().escapeHtml(prefix + previewText(t.lastMessage?.body, t.lastMessage?.hasAttachment, t.lastMessage?.deleted))}</span>
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

function renderMessages() {
  const host = document.getElementById("team-chat-messages");
  if (!host) return;
  host.classList.toggle("team-chat-messages--group", activeThreadType === "group");
  host.classList.toggle("team-chat-messages--dm", activeThreadType === "dm");
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
      const typeCls = activeThreadType === "group" ? " team-chat-bubble-row--group" : " team-chat-bubble-row--dm";
      const senderLine =
        activeThreadIsGroup && !m.isMine
          ? `<div class="team-chat-bubble-sender">${d().escapeHtml(m.senderName || "Member")}</div>`
          : "";
      return `<div class="team-chat-bubble-row${typeCls}${mine}" data-message-id="${d().escapeHtml(m.id)}">
        <div class="team-chat-bubble-wrap">
          ${senderLine}
          <div class="team-chat-bubble${m.deleted ? " team-chat-bubble--deleted" : ""}">
            ${messageBodyHtml(m)}
            <div class="team-chat-bubble-meta">
              <div class="team-chat-bubble-time tabular-nums">${d().escapeHtml(formatChatTime(m.createdAt))}</div>
              ${messageStatusHtml(m)}
            </div>
          </div>
          ${messageActionsHtml(m)}
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
    syncGroupManageUi();
    return;
  }
  const peer = t.peer;
  if (nameEl) nameEl.textContent = peer?.displayName || "Chat";
  if (roleEl) roleEl.innerHTML = peer ? rolePillHtml(peer.roleLabel || peer.role) : "";
  if (avatarEl) avatarEl.innerHTML = peer ? contactAvatarHtml(peer.displayName, peer.role, true) : "";
  syncGroupManageUi();
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
  active.classList.toggle("team-chat-thread-active--group", hasThread && activeThreadType === "group");
  active.classList.toggle("team-chat-thread-active--dm", hasThread && activeThreadType === "dm");
  sidebar.classList.toggle("d-none", hasThread && mobileShowThread && isMobileChatLayout());
}

function isChatPanelOpen() {
  return document.getElementById("teamChatOffcanvas")?.classList.contains("show") ?? false;
}

function notifyIncomingMessage(thread) {
  const isGroup = thread.type === "group";
  const name = isGroup ? thread.group?.name : thread.peer?.displayName || "Someone";
  const preview = previewText(thread.lastMessage?.body, thread.lastMessage?.hasAttachment, thread.lastMessage?.deleted);
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
  stopTypingPulse();
  clearPendingChatFile();
  clearReplyingTo();
  activeThreadType = type === "group" ? "group" : "dm";
  activeChatId = id;
  activeThreadIsGroup = activeThreadType === "group";
  activeTypingUsers = [];
  updateTypingIndicator();
  mobileShowThread = isMobileChatLayout();
  syncGroupManageUi();

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
    activeTypingUsers = data.typingUsers ?? [];
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
    updateTypingIndicator();
    await markActiveThreadRead();
    await loadThreads();
  } catch (err) {
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    mobileShowThread = false;
    syncGroupManageUi();
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
    document.querySelectorAll("#team-chat-group-member-picks input.team-chat-member-pick-input:checked").forEach((el) => {
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
  stopTypingPulse();
  const input = document.getElementById("team-chat-input");
  const body = input?.value?.trim() || "";
  const file = pendingChatFile;
  if (!body && !file) return;
  const btn = document.getElementById("team-chat-send");
  if (btn) btn.disabled = true;
  const base =
    activeThreadType === "group"
      ? `/api/chat/groups/${activeChatId}`
      : `/api/chat/conversations/${activeChatId}`;
  const replyToMessageId = replyingTo?.id ?? null;
  try {
    const data = await postChatMessage(base, body, file, replyToMessageId);
    if (input) input.value = "";
    clearPendingChatFile();
    clearReplyingTo();
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
      await refreshActiveMessages();
    }
  } catch {
    /* ignore polling errors */
  }
}

function schedulePoll() {
  const tick = () => {
    void refreshChatData().finally(() => {
      pollTimer = window.setTimeout(tick, getChatPollMs());
    });
  };
  pollTimer = window.setTimeout(tick, getChatPollMs());
}

function startPolling() {
  stopPolling();
  schedulePoll();
}

export function stopPolling() {
  if (pollTimer != null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
  stopChatLive();
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

  wireChatMediaLightbox();

  document.getElementById("team-chat-search")?.addEventListener("input", (e) => {
    contactFilter = e.target.value || "";
    renderThreadList();
    renderContactList();
  });
  document.getElementById("team-chat-compose")?.addEventListener("submit", (e) => {
    void sendMessage(e);
  });
  document.getElementById("team-chat-compose")?.addEventListener("click", (e) => {
    if (e.target.closest(".js-chat-reply-cancel")) {
      e.preventDefault();
      clearReplyingTo();
    }
  });
  document.getElementById("team-chat-input")?.addEventListener("input", () => {
    pulseTyping();
  });
  document.getElementById("team-chat-input")?.addEventListener("blur", () => {
    stopTypingPulse();
  });
  document.getElementById("team-chat-attach-btn")?.addEventListener("click", () => {
    document.getElementById("team-chat-file-input")?.click();
  });
  document.getElementById("team-chat-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CHAT_MAX_FILE_BYTES) {
      d().showToast(`File must be ${CHAT_MAX_FILE_MB} MB or smaller.`, "warning");
      e.target.value = "";
      return;
    }
    pendingChatFile = file;
    renderAttachPreview();
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
  document.querySelectorAll(".team-chat-thread-type-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setThreadTypeFilter(btn.getAttribute("data-chat-thread-type") || "all");
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
    if (!e.target.checked) renderGroupMemberPicks();
  });
  document.getElementById("team-chat-manage-member-search")?.addEventListener("input", (e) => {
    manageMemberFilter = e.target.value || "";
    const selected = [];
    document.querySelectorAll("#team-chat-manage-member-picks input.team-chat-member-pick-input:checked").forEach((el) => {
      selected.push(el.value);
    });
    renderManageMemberPicks(selected);
  });
  document.getElementById("team-chat-manage-select-all")?.addEventListener("click", () => {
    document.querySelectorAll("#team-chat-manage-member-picks input.team-chat-member-pick-input:not(:disabled)").forEach((el) => {
      el.checked = true;
      el.closest(".team-chat-member-pick-row")?.classList.add("team-chat-member-pick-row--on");
    });
    updateMemberPickCount("team-chat-manage-member-count", "team-chat-manage-member-picks");
  });
  document.getElementById("team-chat-manage-select-none")?.addEventListener("click", () => {
    document.querySelectorAll("#team-chat-manage-member-picks input.team-chat-member-pick-input:not(:disabled)").forEach((el) => {
      el.checked = false;
      el.closest(".team-chat-member-pick-row")?.classList.remove("team-chat-member-pick-row--on");
    });
    updateMemberPickCount("team-chat-manage-member-count", "team-chat-manage-member-picks");
  });
  document.getElementById("team-chat-manage-member-picks")?.addEventListener("change", (e) => {
    const input = e.target;
    if (!input?.classList?.contains("team-chat-member-pick-input")) return;
    input.closest(".team-chat-member-pick-row")?.classList.toggle("team-chat-member-pick-row--on", input.checked);
    updateMemberPickCount("team-chat-manage-member-count", "team-chat-manage-member-picks");
  });
  document.getElementById("team-chat-group-member-picks")?.addEventListener("change", (e) => {
    const input = e.target;
    if (!input?.classList?.contains("team-chat-member-pick-input")) return;
    input.closest(".team-chat-member-pick-row")?.classList.toggle("team-chat-member-pick-row--on", input.checked);
    updateMemberPickCount("team-chat-create-member-count", "team-chat-group-member-picks");
  });
  document.getElementById("team-chat-group-manage-btn")?.addEventListener("click", () => {
    void openManageGroupModal();
  });
  document.getElementById("team-chat-thread-head-main")?.addEventListener("click", () => {
    if (isAdminUser() && activeThreadIsGroup) void openManageGroupModal();
  });
  document.getElementById("team-chat-manage-group-form")?.addEventListener("submit", (e) => {
    void saveManageGroup(e);
  });
  document.getElementById("team-chat-delete-group-btn")?.addEventListener("click", () => {
    void deleteActiveGroup();
  });

  setSidebarTab("chats");
  setThreadTypeFilter("all");
  syncAdminGroupUi();
  syncGroupManageUi();
  offcanvas.addEventListener("shown.bs.offcanvas", () => {
    startChatLive();
    syncChatPushButton();
    syncAdminGroupUi();
    void refreshChatData();
  });
  offcanvas.addEventListener("hidden.bs.offcanvas", () => {
    stopTypingPulse();
    clearReplyingTo();
    mobileShowThread = false;
    activeThreadType = null;
    activeChatId = null;
    activeThreadIsGroup = false;
    activeMessages = [];
    activeTypingUsers = [];
    updateTypingIndicator();
    syncGroupManageUi();
    setThreadVisible(false);
  });

  window.addEventListener("resize", () => {
    if (isChatPanelOpen() && activeChatId) {
      setThreadVisible(true);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshChatData();
  });

  window.addEventListener("focus", () => {
    void refreshChatData();
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
  startChatLive();
  startPolling();
  void refreshChatData();
  void refreshUnreadBadges();
  syncChatPushButton();
}

export function teamChatSidebarButtonHtml() {
  return `<button type="button" class="btn btn-outline-secondary w-100 mb-2 js-open-team-chat">
    <i class="bi bi-chat-dots me-1" aria-hidden="true"></i>Messages
    <span class="badge rounded-pill text-bg-danger ms-1 d-none js-chat-unread-badge">0</span>
  </button>`;
}

export function teamChatSidebarNavItemHtml() {
  return `<button type="button" class="admin-sidebar-nav-item js-open-team-chat">
    <i class="bi bi-chat-dots" aria-hidden="true"></i>
    <span>Messages</span>
    <span class="admin-nav-badge d-none js-chat-unread-badge">0</span>
  </button>`;
}
