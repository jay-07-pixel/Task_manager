import "./scss/styles.scss";
import * as bootstrap from "bootstrap";
import Sortable from "sortablejs";
import { startEmployeeReminders, stopEmployeeReminders, clearReminderForTask } from "./reminders.js";
import {
  isPushSupported,
  isPushInfrastructureReady,
  preparePushInfrastructure,
  linkPushSubscriptionToServer,
  runPushRegistrationDuringGesture,
} from "./sw-register.js";

const app = document.getElementById("app");
const toastHost = document.getElementById("toastHost");

/** @type {any} */
let state = {
  user: null,
  lists: [],
  activeListId: null,
  tasks: [],
  assignees: [],
  empTasks: [],
  empFilter: "active",
  ownerTaskFilter: "active",
};

/** @type {any[]} */
let listSortables = [];
let taskRootSortable = null;

/** @type {Record<string, any> | null} */
let pendingCustomRecurrence = null;

/** @type {((value: string | null) => void) | null} */
let listNameResolve = null;

const OWNER_SYNC_INTERVAL_MS = 12_000;
/** @type {number | null} */
let ownerSyncTimer = null;
let ownerTasksFingerprint = "";

const THEME_STORAGE_KEY = "task-manager-theme";
const THEME_TRANSITION_MS = 450;

function getStoredTheme() {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "dark") return "dark";
  return "light";
}

function effectiveTheme() {
  return getStoredTheme();
}

function applyTheme({ animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
  }
  root.setAttribute("data-bs-theme", effectiveTheme());
  if (animate) {
    window.setTimeout(() => root.classList.remove("theme-switching"), THEME_TRANSITION_MS);
  }
}

function setThemePreference(mode) {
  if (mode !== "light" && mode !== "dark") return;
  if (mode === getStoredTheme()) return;
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme({ animate: true });
  syncThemeIconButtons();
}

function initTheme() {
  applyTheme();
}

function syncThemeIconButtons() {
  const t = document.documentElement.getAttribute("data-bs-theme") || "light";
  document.querySelectorAll(".js-theme-light").forEach((btn) => {
    const on = t === "light";
    btn.classList.toggle("btn-primary", on);
    btn.classList.toggle("btn-outline-secondary", !on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll(".js-theme-dark").forEach((btn) => {
    const on = t === "dark";
    btn.classList.toggle("btn-primary", on);
    btn.classList.toggle("btn-outline-secondary", !on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function wireThemeIconToggles() {
  document.querySelectorAll(".js-theme-light").forEach((btn) => {
    btn.addEventListener("click", () => setThemePreference("light"));
  });
  document.querySelectorAll(".js-theme-dark").forEach((btn) => {
    btn.addEventListener("click", () => setThemePreference("dark"));
  });
  syncThemeIconButtons();
}

function themeIconToggleMarkup() {
  return `<div class="theme-icon-toggles d-inline-flex gap-1 justify-content-center" role="group" aria-label="Theme">
      <button type="button" class="btn btn-sm theme-icon-btn btn-outline-secondary js-theme-light" title="Light mode" aria-label="Light mode"><i class="bi bi-sun-fill" aria-hidden="true"></i></button>
      <button type="button" class="btn btn-sm theme-icon-btn btn-outline-secondary js-theme-dark" title="Dark mode" aria-label="Dark mode"><i class="bi bi-moon-stars-fill" aria-hidden="true"></i></button>
    </div>`;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    throw new Error(
      "Network error: could not reach the server. Confirm the API is running (npm run dev) on port 3000."
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && !isPublicAuthPath(path)) {
      const wasLoggedIn = !!state.user;
      state.user = null;
      renderAuthForm();
      if (wasLoggedIn) {
        showToast("Session expired or you were signed out. Please sign in again.", "warning");
      }
    }
    let msg = data?.error ?? res.statusText;
    if (typeof msg === "object") msg = JSON.stringify(msg);
    const s = String(msg || "Request failed");
    if (
      (res.status === 500 || res.status === 502 || res.status === 504) &&
      (s === "Internal Server Error" || s.includes("ECONNREFUSED") || s.toLowerCase().includes("proxy error"))
    ) {
      throw new Error(
        "The API is not responding (it may have crashed — check the dev terminal and restart if needed)."
      );
    }
    throw new Error(s);
  }
  return data;
}

function showToast(message, variant = "secondary") {
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  toastHost.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** @type {Set<string>} */
const proofBlobUrls = new Set();

const EMP_SUBMISSION_TEXT_MAX = 2000;
const EMP_SUBMISSION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const EMP_SUBMISSION_REQUIRED_MSG = "Please provide submission text or upload an image.";
const PROGRESS_UPDATE_TEXT_MAX = 2000;
const PROGRESS_UPDATE_TYPES = [
  {
    id: "started",
    label: "Started working",
    badge: "Started",
    badgeClass: "text-bg-primary",
    icon: "play-circle",
    defaultMsg: "Started working on this task.",
  },
  {
    id: "in_progress",
    label: "In progress",
    badge: "In progress",
    badgeClass: "text-bg-info",
    icon: "arrow-repeat",
    defaultMsg: "Still working on this — making progress.",
  },
  {
    id: "blocked",
    label: "Blocked",
    badge: "Blocked",
    badgeClass: "text-bg-warning",
    icon: "pause-circle",
    defaultMsg: "Blocked — need help or waiting on something.",
  },
  {
    id: "update",
    label: "General update",
    badge: "Update",
    badgeClass: "text-bg-secondary",
    icon: "chat-left-text",
    defaultMsg: "",
  },
];

function submissionUploadErrorMessage(res, rawText) {
  if (res.status === 413) {
    return "Image is too large for the server (max 5 MB). Use a smaller image or submit text only.";
  }
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    if (rawText && /413|entity too large/i.test(rawText)) {
      return "Upload is too large. Use an image under 5 MB, or ask your admin to raise nginx client_max_body_size.";
    }
    return "Submission failed. Please try again.";
  }
  const msg = data?.error || "Submission failed";
  if (msg === "Server error") {
    return "Server error. On the VPS run: cd server && npx prisma migrate deploy && npm run db:generate && pm2 restart taskmanager";
  }
  return msg;
}

function validateEmpSubmissionImageFile(file) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type)) {
    return "Only JPEG, PNG, GIF, or WebP images are allowed.";
  }
  if (file.size > EMP_SUBMISSION_IMAGE_MAX_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

async function fetchProofBlobUrl(proofUrl) {
  const res = await fetch(proofUrl, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sign in again to view proof images.");
    if (res.status === 403) throw new Error("You do not have permission to view this proof.");
    if (res.status === 404) throw new Error("Proof image not found on the server.");
    throw new Error(`Could not load proof (${res.status}).`);
  }
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("Proof file is missing or not a valid image.");
  }
  const blobUrl = URL.createObjectURL(blob);
  proofBlobUrls.add(blobUrl);
  return blobUrl;
}

async function refreshMe() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    return true;
  } catch {
    state.user = null;
    return false;
  }
}

const PUBLIC_AUTH_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
];

function isPublicAuthPath(path) {
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}?`));
}

let registerOtpCountdownTimer = null;

const registerGate = { otpVerified: false, turnstileToken: null };
let turnstileScriptPromise = null;
let turnstileWidgetId = null;

function updateRegisterSubmitButton() {
  const submitBtn = document.getElementById("btn-register-submit");
  if (submitBtn) submitBtn.disabled = !registerGate.otpVerified;
}

function updateSendOtpButton() {
  const sendBtn = document.getElementById("btn-send-otp");
  if (sendBtn) sendBtn.disabled = !registerGate.turnstileToken;
}

function clearTurnstileToken() {
  registerGate.turnstileToken = null;
  updateSendOtpButton();
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load CAPTCHA."));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

function resetTurnstileWidget() {
  if (window.turnstile && turnstileWidgetId != null) {
    try {
      window.turnstile.remove(turnstileWidgetId);
    } catch {
      /* ignore */
    }
    turnstileWidgetId = null;
  }
  clearTurnstileToken();
}

async function wireRegisterTurnstile() {
  resetTurnstileWidget();
  const container = document.getElementById("reg-turnstile");
  if (!container) return;

  let siteKey;
  try {
    const data = await api("/api/auth/turnstile-site-key");
    siteKey = data.siteKey;
  } catch {
    container.innerHTML =
      '<p class="form-text text-danger mb-0">Security check unavailable. Contact your administrator.</p>';
    return;
  }

  try {
    await loadTurnstileScript();
  } catch {
    container.innerHTML =
      '<p class="form-text text-danger mb-0">Could not load CAPTCHA. Check your network and refresh.</p>';
    return;
  }

  container.innerHTML = "";
  const turnstileSize = window.matchMedia("(max-width: 575.98px)").matches ? "compact" : "flexible";
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    size: turnstileSize,
    callback(token) {
      registerGate.turnstileToken = token;
      updateSendOtpButton();
      const hint = document.getElementById("reg-turnstile-hint");
      if (hint) hint.classList.add("d-none");
    },
    "expired-callback"() {
      clearTurnstileToken();
      showToast("CAPTCHA expired. Please complete it again.", "warning");
    },
    "error-callback"() {
      clearTurnstileToken();
      showToast("CAPTCHA error. Please try again.", "warning");
    },
  });
  updateSendOtpButton();
}

function clearRegisterOtpTimer() {
  if (registerOtpCountdownTimer) {
    clearInterval(registerOtpCountdownTimer);
    registerOtpCountdownTimer = null;
  }
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function wireRegisterOtp() {
  clearRegisterOtpTimer();

  const emailEl = document.getElementById("reg-email");
  const otpSection = document.getElementById("reg-otp-section");
  const otpEl = document.getElementById("reg-otp");
  const sendBtn = document.getElementById("btn-send-otp");
  const verifyBtn = document.getElementById("btn-verify-otp");
  const resendBtn = document.getElementById("btn-resend-otp");
  const countdownEl = document.getElementById("reg-otp-countdown");
  const statusEl = document.getElementById("reg-otp-status");
  const submitBtn = document.getElementById("btn-register-submit");
  if (!emailEl || !otpSection || !sendBtn) return;

  let otpExpiresAt = 0;

  const setVerified = (verified) => {
    registerGate.otpVerified = verified;
    updateRegisterSubmitButton();
    if (statusEl) {
      statusEl.textContent = verified ? "Email verified — you can create your account." : "";
      statusEl.classList.toggle("text-success", verified);
      statusEl.classList.toggle("d-none", !verified);
    }
    if (verified && otpEl) otpEl.disabled = true;
    if (verified && verifyBtn) verifyBtn.disabled = true;
  };

  const updateCountdown = () => {
    if (!countdownEl) return;
    const left = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
    if (left <= 0) {
      countdownEl.textContent = "Code expired — resend a new one.";
      if (resendBtn) resendBtn.disabled = false;
      clearRegisterOtpTimer();
      return;
    }
    countdownEl.textContent = `Code expires in ${formatCountdown(left)}`;
    if (resendBtn) resendBtn.disabled = left > 0 && !registerGate.otpVerified;
  };

  const startCountdown = (expiresInSeconds) => {
    otpExpiresAt = Date.now() + expiresInSeconds * 1000;
    if (otpEl) otpEl.disabled = false;
    if (verifyBtn) verifyBtn.disabled = false;
    if (resendBtn) resendBtn.disabled = true;
    updateCountdown();
    clearRegisterOtpTimer();
    registerOtpCountdownTimer = setInterval(updateCountdown, 1000);
    if (resendBtn) resendBtn.disabled = true;
    setTimeout(() => {
      if (resendBtn && !registerGate.otpVerified) resendBtn.disabled = false;
    }, 60_000);
  };

  const getEmail = () => String(emailEl.value || "").trim().toLowerCase();

  const sendOtp = async (isResend) => {
    const email = getEmail();
    if (!email || !emailEl.checkValidity()) {
      emailEl.reportValidity();
      showToast("Enter a valid email address first.", "warning");
      return;
    }
    if (!registerGate.turnstileToken) {
      showToast("Please complete CAPTCHA before sending OTP.", "warning");
      const hint = document.getElementById("reg-turnstile-hint");
      if (hint) hint.classList.remove("d-none");
      return;
    }
    const turnstileToken = registerGate.turnstileToken;
    sendBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    try {
      const data = await api("/api/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ email, turnstileToken }),
      });
      setVerified(false);
      if (otpEl) {
        otpEl.value = "";
        otpEl.disabled = false;
      }
      if (verifyBtn) verifyBtn.disabled = false;
      startCountdown(data.expiresInSeconds ?? 600);
      showToast(isResend ? "New code sent." : "Verification code sent to your email.", "success");
      resetTurnstileWidget();
      void wireRegisterTurnstile();
    } catch (err) {
      showToast(err.message, "danger");
      resetTurnstileWidget();
      void wireRegisterTurnstile();
    } finally {
      updateSendOtpButton();
    }
  };

  sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    void sendOtp(false);
  });

  if (resendBtn) {
    resendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void sendOtp(true);
    });
  }

  if (verifyBtn) {
    verifyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void (async () => {
        const email = getEmail();
        const otp = String(otpEl?.value || "").replace(/\D/g, "").slice(0, 6);
        if (!email || !emailEl.checkValidity()) {
          emailEl.reportValidity();
          return;
        }
        if (otp.length !== 6) {
          showToast("Enter the 6-digit code from your email.", "warning");
          return;
        }
        verifyBtn.disabled = true;
        try {
          await api("/api/auth/verify-otp", {
            method: "POST",
            body: JSON.stringify({ email, otp }),
          });
          setVerified(true);
          clearRegisterOtpTimer();
          if (countdownEl) countdownEl.textContent = "Email verified.";
          showToast("Email verified. Complete the form and create your account.", "success");
        } catch (err) {
          showToast(err.message, "danger");
          verifyBtn.disabled = false;
        }
      })();
    });
  }

  if (otpEl) {
    otpEl.addEventListener("input", () => {
      otpEl.value = otpEl.value.replace(/\D/g, "").slice(0, 6);
    });
  }

  emailEl.addEventListener("change", () => {
    registerGate.otpVerified = false;
    updateRegisterSubmitButton();
    clearRegisterOtpTimer();
    resetTurnstileWidget();
    void wireRegisterTurnstile();
    if (statusEl) statusEl.classList.add("d-none");
    const captchaHint = document.getElementById("reg-turnstile-hint");
    if (captchaHint) captchaHint.classList.add("d-none");
    if (otpEl) {
      otpEl.value = "";
      otpEl.disabled = true;
    }
    if (verifyBtn) verifyBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    if (countdownEl) countdownEl.textContent = "Complete CAPTCHA, then send OTP.";
  });

  setVerified(false);
}

function wireRegisterPhoneDigits() {
  const el = document.getElementById("reg-phone");
  if (!el) return;
  const strip = () => {
    const digits = el.value.replace(/\D/g, "").slice(0, 10);
    if (el.value !== digits) el.value = digits;
  };
  el.addEventListener("input", strip);
  el.addEventListener("paste", () => queueMicrotask(strip));
  el.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const allowNav = [
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "Enter",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ];
    if (allowNav.includes(e.key)) return;
    if (e.key.length === 1 && /\d/.test(e.key)) {
      const s = el.selectionStart ?? 0;
      const ed = el.selectionEnd ?? 0;
      if (s === ed && el.value.length >= 10) {
        e.preventDefault();
      }
      return;
    }
    if (e.key.length === 1 && !/\d/.test(e.key)) {
      e.preventDefault();
    }
  });
}

function renderAuthForm() {
  app.innerHTML = `
    <div class="auth-page">
      <div class="container px-3">
        <div class="auth-wrap">
          <div class="card auth-card">
            <div class="auth-card-head">
              <div class="auth-brand-row">
                <div class="auth-brand-icon" aria-hidden="true"><i class="bi bi-kanban-fill"></i></div>
                <div>
                  <div class="auth-brand-title text-white">Task Manager</div>
                  <p class="auth-brand-sub text-white">Organize lists, assign people, track what&rsquo;s done.</p>
                </div>
              </div>
            </div>
            <div class="auth-card-body">
              <ul class="nav nav-pills auth-tabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active w-100" id="tab-login-btn" data-bs-toggle="pill" data-bs-target="#tab-login" type="button" role="tab" aria-controls="tab-login" aria-selected="true">Sign in</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link w-100" id="tab-register-btn" data-bs-toggle="pill" data-bs-target="#tab-register" type="button" role="tab" aria-controls="tab-register" aria-selected="false">Register</button>
                </li>
              </ul>
              <div class="tab-content">
                <div class="tab-pane fade show active" id="tab-login" role="tabpanel" aria-labelledby="tab-login-btn" tabindex="0">
                  <div class="auth-form-login">
                  <form id="form-login" novalidate>
                    <div class="mb-3">
                      <label class="auth-field-label" for="login-email">Email</label>
                    <div class="input-group auth-input-group">
                      <span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>
                      <input class="form-control" id="login-email" name="email" type="email" autocomplete="username" placeholder="you@company.com" required />
                    </div>
                    </div>
                    <div class="mb-3">
                      <label class="auth-field-label" for="login-password">Password</label>
                    <div class="input-group auth-input-group">
                      <span class="input-group-text"><i class="bi bi-key" aria-hidden="true"></i></span>
                      <input class="form-control" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
                    </div>
                    </div>
                    <button class="btn btn-primary w-100 auth-submit" type="submit">Sign in</button>
                  </form>
                  </div>
                </div>
                <div class="tab-pane fade" id="tab-register" role="tabpanel" aria-labelledby="tab-register-btn" tabindex="0">
                  <form id="form-register" class="auth-form-register">
                    <p class="auth-reg-section-title">Account details</p>
                    <div class="auth-reg-grid auth-reg-grid-fields">
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-name">Display name</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-person" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-name" name="displayName" autocomplete="name" placeholder="Your name" required />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-email">Email</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-phone">Phone</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-telephone" aria-hidden="true"></i></span>
                          <input
                            class="form-control"
                            id="reg-phone"
                            name="phone"
                            type="text"
                            inputmode="numeric"
                            autocomplete="tel"
                            maxlength="10"
                            minlength="10"
                            pattern="[0-9]{10}"
                            placeholder="10 digits"
                            title="10 digits only"
                            required
                          />
                        </div>
                      </div>
                      <div class="mb-2">
                        <label class="auth-field-label" for="reg-password">Password</label>
                        <div class="input-group input-group-sm auth-input-group">
                          <span class="input-group-text"><i class="bi bi-shield-lock" aria-hidden="true"></i></span>
                          <input class="form-control" id="reg-password" name="password" type="password" minlength="6" autocomplete="new-password" placeholder="Min. 6 characters" required />
                        </div>
                      </div>
                    </div>

                    <p class="auth-reg-section-title mt-3">Email verification</p>
                    <div class="auth-reg-verify-card">
                      <div class="auth-reg-captcha-row">
                        <div class="reg-turnstile-wrap" id="reg-turnstile-wrap">
                          <span class="auth-reg-mini-label">Security check</span>
                          <div class="reg-turnstile-viewport">
                            <div id="reg-turnstile" class="reg-turnstile"></div>
                          </div>
                          <p class="form-text text-danger d-none mb-0" id="reg-turnstile-hint" role="alert">
                            Complete CAPTCHA before sending OTP.
                          </p>
                        </div>
                        <button class="btn btn-outline-primary auth-reg-action-btn" type="button" id="btn-send-otp" disabled>
                          Send OTP
                        </button>
                      </div>
                      <div class="auth-reg-divider" aria-hidden="true"></div>
                      <div class="auth-reg-otp-row" id="reg-otp-section">
                        <div class="auth-reg-otp-field">
                          <label class="auth-reg-mini-label" for="reg-otp">Verification code</label>
                          <div class="input-group input-group-sm auth-input-group">
                            <span class="input-group-text"><i class="bi bi-shield-check" aria-hidden="true"></i></span>
                            <input
                              class="form-control font-monospace text-center"
                              id="reg-otp"
                              name="otp"
                              type="text"
                              inputmode="numeric"
                              autocomplete="one-time-code"
                              maxlength="6"
                              pattern="[0-9]{6}"
                              placeholder="000000"
                              title="6-digit code"
                              disabled
                            />
                          </div>
                        </div>
                        <button class="btn btn-primary auth-reg-action-btn" type="button" id="btn-verify-otp" disabled>
                          Verify
                        </button>
                      </div>
                      <div class="auth-reg-otp-meta">
                        <small class="text-muted" id="reg-otp-countdown">Complete CAPTCHA, then send OTP.</small>
                        <button class="btn btn-sm btn-outline-secondary auth-reg-resend" type="button" id="btn-resend-otp" disabled>
                          Resend OTP
                        </button>
                      </div>
                      <div class="form-text text-success d-none mb-0" id="reg-otp-status" role="status"></div>
                    </div>

                    <div class="auth-reg-submit-wrap">
                      <button class="btn btn-primary auth-submit auth-reg-create-btn" type="submit" id="btn-register-submit" disabled>
                        Create account
                      </button>
                    </div>
                  </form>
                </div>
              </div>
              <div class="auth-theme-row text-center">
                ${themeIconToggleMarkup()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById("form-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    void (async () => {
      try {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
        });
        await refreshMe();
        render();
      } catch (err) {
        showToast(err.message, "danger");
      }
    })();
  });

  document.getElementById("form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("btn-register-submit");

    if (!registerGate.otpVerified) {
      showToast("Verify your email with the OTP code first.", "warning");
      return;
    }
    if (submitBtn?.disabled) return;

    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          displayName: fd.get("displayName"),
          phone: fd.get("phone"),
          role: "employee",
        }),
      });
      sessionStorage.setItem("taskmgr-app-welcome", "1");
      await refreshMe();
      render();
    } catch (err) {
      showToast(err.message, "danger");
    }
  });

  registerGate.otpVerified = false;
  registerGate.turnstileToken = null;
  wireRegisterPhoneDigits();
  wireRegisterOtp();
  void wireRegisterTurnstile();
  wireThemeIconToggles();
}

async function logout() {
  stopOwnerAutoSync();
  stopEmployeeReminders();
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  state.user = null;
  renderAuthForm();
}

function getEmployeeNotifyParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "notify") return null;
  const taskId = params.get("taskId");
  if (!taskId) return null;
  return {
    taskId,
    title: params.get("title") || "",
    slot: params.get("slot") || "before10",
    dueAt: params.get("dueAt"),
  };
}

async function focusEmployeeTaskFromNotify(notify) {
  if (!notify?.taskId) return;

  if (window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }

  if (!state.empTasks.some((t) => t.id === notify.taskId)) {
    try {
      await loadEmployeeTasks();
    } catch {
      /* keep going */
    }
  }

  const task = state.empTasks.find((t) => t.id === notify.taskId);
  if (task && employeeMyAssignee(task)?.assigneeDone) {
    state.empFilter = "submitted";
  } else if (!task) {
    state.empFilter = "all";
  } else {
    state.empFilter = "active";
  }

  renderEmpListContentOnly();
  renderEmployeeMain();

  const slotLabel = notify.slot?.startsWith("followup")
    ? "Task overdue — reminder"
    : "Due in about 10 minutes";
  const title = notify.title || task?.title || "Your task";

  requestAnimationFrame(() => {
    const row = document.querySelector(
      `tr.owner-task-row[data-task-id="${CSS.escape(notify.taskId)}"]`
    );
    if (row) {
      row.classList.add("owner-task-row--notify-highlight");
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row.classList.remove("owner-task-row--notify-highlight"), 12000);
    }
  });

  showToast(`${slotLabel}: ${title}`, "warning");
}

async function handleEmployeeNotifyDeepLink() {
  const notify = getEmployeeNotifyParams();
  if (notify) await focusEmployeeTaskFromNotify(notify);
}

function wireEmployeeNotifyHandlers() {
  if (document.documentElement.dataset.taskmgrNotifyWired === "1") return;
  document.documentElement.dataset.taskmgrNotifyWired = "1";

  document.addEventListener("taskmgr-focus-task", (event) => {
    if (state.user?.role !== "employee") return;
    void focusEmployeeTaskFromNotify(event.detail || {});
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "taskmgr-open-task" && state.user?.role === "employee") {
        void focusEmployeeTaskFromNotify({
          taskId: event.data.payload?.taskId,
          title: event.data.payload?.title,
          slot: event.data.payload?.slot,
          dueAt: event.data.payload?.dueAt,
        });
      }
    });
  }
}

function startEmployeeReminderSystem() {
  if (state.user?.role !== "employee") return;
  wireEmployeeNotifyHandlers();
  startEmployeeReminders(
    loadEmployeeTasks,
    () => state.empTasks,
    employeeMyAssignee,
    showToast,
    () => state.user?.id,
    api
  );
}

function empPushButtonLabel() {
  return Notification.permission === "granted" ? "Enable Chrome reminders" : "Enable Chrome reminders";
}

function empRemindersButtonHtml() {
  if (!isPushSupported()) return "";
  const perm = Notification.permission;
  if (perm === "denied") {
    return `<p class="small text-warning mb-2 px-1">Notifications blocked — allow them in Chrome settings for this site.</p>`;
  }
  return `<button type="button" class="btn btn-outline-warning w-100 mb-2 js-emp-enable-push">
    <i class="bi bi-bell me-1" aria-hidden="true"></i><span class="js-emp-push-btn-label">${empPushButtonLabel()}</span>
  </button>
  <p class="small text-muted mb-2 px-1">Tap once to prepare, then tap again to connect. Alerts work when Chrome is closed.</p>`;
}

function refreshEmpPushButtonLabels() {
  document.querySelectorAll(".js-emp-push-btn-label").forEach((el) => {
    el.textContent = empPushButtonLabel();
  });
  document.querySelectorAll(".js-emp-enable-push").forEach((btn) => {
    btn.disabled = false;
  });
}

async function prepareEmployeePushOnLogin() {
  if (!isPushSupported()) return;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ready = await preparePushInfrastructure(api, { force: attempt > 0 });
    refreshEmpPushButtonLabels();
    if (ready) {
      if (Notification.permission === "granted") {
        const link = await linkPushSubscriptionToServer(api);
        if (link.ok) {
          showToast("Chrome reminders connected on this device.", "success");
          document.dispatchEvent(new CustomEvent("taskmgr-push-subscribed"));
        }
      }
      return;
    }
    await new Promise((r) => window.setTimeout(r, 1500));
  }
}

const EMP_PUSH_PRIMED_KEY = "taskmgr-push-primed";

function wireEmpEnablePush() {
  document.querySelectorAll(".js-emp-enable-push").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!isPushSupported()) {
        showToast("This browser does not support background reminders.", "warning");
        return;
      }
      if (Notification.permission === "denied") {
        showToast("Notifications blocked — allow them in Chrome site settings.", "warning");
        return;
      }

      const label = btn.querySelector(".js-emp-push-btn-label");
      const finish = (result) => {
        refreshEmpPushButtonLabels();
        if (result.ok) {
          sessionStorage.removeItem(EMP_PUSH_PRIMED_KEY);
          showToast("Chrome reminders are active on this device.", "success");
        } else if (result.reason === "not-ready") {
          showToast(result.message || "Pull down to refresh the page, then tap Enable twice.", "warning");
        } else if (result.reason === "no-vapid") {
          showToast("Server push is not configured. Contact your administrator.", "danger");
        } else if (result.reason === "denied") {
          showToast("Allow notifications to get alerts 10 minutes before deadlines.", "warning");
        } else {
          showToast(result.message || "Tap Enable one more time.", "warning");
        }
      };

      const primed =
        sessionStorage.getItem(EMP_PUSH_PRIMED_KEY) === "1" && isPushInfrastructureReady();

      if (primed) {
        sessionStorage.removeItem(EMP_PUSH_PRIMED_KEY);
        btn.disabled = true;
        runPushRegistrationDuringGesture(api, (result) => {
          btn.disabled = false;
          finish(result);
        });
        return;
      }

      btn.disabled = true;
      if (label) label.textContent = "Setting up…";

      const runSetup = async () => {
        try {
          if (Notification.permission !== "granted") {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") {
              finish({ ok: false, reason: "denied" });
              return;
            }
          }

          const ready = await preparePushInfrastructure(api, { force: true });
          if (!ready) {
            finish({
              ok: false,
              reason: "not-ready",
              message: "Could not load push setup. Pull down to refresh, then tap Enable again.",
            });
            return;
          }

          const link = await linkPushSubscriptionToServer(api);
          if (link.ok) {
            finish({ ok: true });
            return;
          }

          sessionStorage.setItem(EMP_PUSH_PRIMED_KEY, "1");
          showToast("Almost done — tap Enable one more time.", "primary");
        } finally {
          btn.disabled = false;
          refreshEmpPushButtonLabels();
        }
      };

      void runSetup();
    });
  });
}

function taskHasUnreadProgressUpdates(task) {
  return (task.assignees ?? []).some((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
}

/** In review = employee posted a progress update and has not submitted the task yet. */
function taskIsInReview(task) {
  return (task.assignees ?? []).some(
    (a) => (a.progressUpdateCount ?? 0) > 0 && !a.assigneeDone
  );
}

function ownerDashboardMetrics() {
  const tasks = state.tasks;
  const inReview = tasks.filter(taskIsInReview).length;
  const done = tasks.filter((t) => t.completed).length;
  const active = tasks.filter((t) => !t.completed && !taskIsInReview(t)).length;
  return { total: tasks.length, active, done, inReview };
}

function ownerFilteredTasks() {
  if (state.ownerTaskFilter === "completed") {
    return state.tasks.filter((t) => t.completed);
  }
  if (state.ownerTaskFilter === "in_review") {
    return state.tasks.filter(taskIsInReview);
  }
  return state.tasks.filter((t) => !t.completed && !taskIsInReview(t));
}

function setOwnerTaskFilter(filter) {
  if (filter !== "active" && filter !== "completed" && filter !== "in_review") return;
  state.ownerTaskFilter = filter;
  renderOwnerMain();
}

function leftNavInner() {
  const displayName = state.user ? escapeHtml(state.user.displayName) : "";
  return `
    <div class="owner-sidebar d-flex flex-column h-100">
      <div class="owner-sidebar-brand">
        <div class="owner-sidebar-brand-icon" aria-hidden="true"><i class="bi bi-kanban-fill"></i></div>
        <div class="min-w-0">
          <div class="owner-sidebar-brand-title">Task Manager</div>
          <div class="owner-sidebar-brand-user text-truncate">${displayName}</div>
          <span class="badge rounded-pill owner-role-badge mt-1">Admin</span>
        </div>
      </div>
      <button type="button" class="btn btn-primary w-100 owner-sidebar-new-list js-new-list">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>New list
      </button>
      <p class="owner-sidebar-label mb-2">Your lists</p>
      <div class="list-group list-group-flush flex-grow-1 overflow-auto owner-list-nav js-list-host"></div>
      <div class="owner-sidebar-footer">
        <button type="button" class="btn btn-outline-primary w-100 mb-2" data-bs-toggle="modal" data-bs-target="#teamAdminModal">
          <i class="bi bi-person-badge me-1" aria-hidden="true"></i>Manage admins
        </button>
        <div class="d-flex justify-content-center mb-2">${themeIconToggleMarkup()}</div>
        <button type="button" class="btn btn-outline-danger w-100 js-logout">
          <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i>Sign out
        </button>
      </div>
    </div>`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localDateParts(d) {
  return {
    y: d.getFullYear(),
    m: pad2(d.getMonth() + 1),
    day: pad2(d.getDate()),
    hh: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
  };
}

/** Date used for repeat labels: task due date in the modal, or today if no date set. */
function dateFromModalDueInput() {
  const dateStr = document.getElementById("modal-due")?.value?.trim();
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }
  return new Date();
}

function ordinalDayOfMonth(day) {
  const n = Number(day);
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"];
  return `${n}${suffix[n % 10] || "th"}`;
}

function refreshModalRepeatLabels() {
  const sel = document.getElementById("modal-repeat");
  if (!sel) return;
  const current = sel.value;
  const d = dateFromModalDueInput();
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const monthLong = d.toLocaleDateString(undefined, { month: "long" });
  const ord = ordinalDayOfMonth(d.getDate());

  const labels = {
    none: "Does not repeat",
    daily: "Daily",
    weekly: `Weekly ${weekday}`,
    monthly: `Monthly ${ord}`,
    yearly: `Yearly ${monthLong} ${ord}`,
    custom: "Custom",
  };

  for (const opt of sel.options) {
    if (labels[opt.value]) opt.textContent = labels[opt.value];
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function getBrowserDueTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function buildDueAtFromModal() {
  const dateStr = document.getElementById("modal-due").value;
  if (!dateStr) return null;
  const allDay = document.getElementById("modal-all-day").checked;
  if (allDay) {
    return `${dateStr}T12:00:00.000Z`;
  }
  const timeStr = document.getElementById("modal-due-time").value || "12:00";
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0).toISOString();
}

function fillModalAssigneeCheckboxes(selectedIds) {
  const host = document.getElementById("modal-assignee-options");
  if (!host) return;
  const set = new Set(selectedIds);
  if (!state.assignees.length) {
    host.innerHTML = '<p class="small text-muted mb-0 py-2 px-1">No employees yet.</p>';
    refreshModalAssigneeChipsAndLabel();
    return;
  }
  host.innerHTML = state.assignees
    .map(
      (u) => `
    <div class="modal-assignee-option">
      <div class="form-check mb-1">
        <input class="form-check-input modal-assignee-cb" type="checkbox" value="${u.id}" id="modal-assignee-${u.id}" ${
        set.has(u.id) ? "checked" : ""
      }>
        <label class="form-check-label w-100" for="modal-assignee-${u.id}">${escapeHtml(u.displayName)}</label>
      </div>
    </div>`
    )
    .join("");
  refreshModalAssigneeChipsAndLabel();
  filterModalAssigneeOptions();
}

function filterModalAssigneeOptions() {
  const q = (document.getElementById("modal-assignee-search")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#modal-assignee-options .modal-assignee-option").forEach((row) => {
    const label = row.querySelector("label");
    const text = (label?.textContent || "").toLowerCase();
    row.classList.toggle("d-none", q.length > 0 && !text.includes(q));
  });
}

function refreshModalAssigneeChipsAndLabel() {
  const chipsHost = document.getElementById("modal-assignee-chips");
  const labelEl = document.getElementById("modal-assignee-toggle-label");
  if (!chipsHost || !labelEl) return;

  const selected = [...document.querySelectorAll("#modal-assignee-options .modal-assignee-cb:checked")];
  const usersById = new Map(state.assignees.map((u) => [u.id, u]));

  chipsHost.replaceChildren();
  for (const cb of selected) {
    const u = usersById.get(cb.value);
    if (!u) continue;
    const chip = document.createElement("span");
    chip.className =
      "badge rounded-pill text-bg-primary d-inline-flex align-items-center gap-1 py-1 ps-2 pe-1 modal-assignee-chip";
    const safeName = escapeHtml(u.displayName);
    chip.innerHTML = `<span class="modal-assignee-chip-text">${safeName}</span><button type="button" class="btn btn-link text-white text-decoration-none p-0 lh-1 modal-assignee-chip-remove" data-user-id="${escapeHtml(
      u.id
    )}" aria-label="Remove ${safeName}" style="font-size: 1rem; line-height: 1">&times;</button>`;
    chip.querySelector(".modal-assignee-chip-remove")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const box = document.getElementById(`modal-assignee-${u.id}`);
      if (box) {
        box.checked = false;
        refreshModalAssigneeChipsAndLabel();
      }
    });
    chipsHost.appendChild(chip);
  }

  if (selected.length === 0) {
    labelEl.textContent = "Select employees…";
  } else if (selected.length === 1) {
    const u = usersById.get(selected[0].value);
    labelEl.textContent = u?.displayName ?? "1 selected";
  } else {
    labelEl.textContent = `${selected.length} employees selected`;
  }
}

function getSelectedAssigneeIdsFromModal() {
  return [...document.querySelectorAll("#modal-assignee-options .modal-assignee-cb:checked")].map((cb) => cb.value);
}

function wireModalAssigneePicker() {
  const modal = document.getElementById("taskModal");
  if (!modal || modal.dataset.assigneePickerWired === "1") return;
  modal.dataset.assigneePickerWired = "1";

  modal.addEventListener("change", (e) => {
    if (e.target?.classList?.contains("modal-assignee-cb")) {
      refreshModalAssigneeChipsAndLabel();
    }
  });

  document.getElementById("modal-assignee-search")?.addEventListener("input", filterModalAssigneeOptions);

  document.getElementById("modal-assignee-panel")?.addEventListener("shown.bs.collapse", () => {
    document.getElementById("modal-assignee-search")?.focus();
  });

  modal.addEventListener("hidden.bs.modal", () => {
    const search = document.getElementById("modal-assignee-search");
    if (search) search.value = "";
    filterModalAssigneeOptions();
    const panel = document.getElementById("modal-assignee-panel");
    if (panel?.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(panel).hide();
    }
  });
}

function fillModalDueFields(task) {
  const dueEl = document.getElementById("modal-due");
  const timeEl = document.getElementById("modal-due-time");
  const allDayEl = document.getElementById("modal-all-day");
  if (!dueEl || !timeEl || !allDayEl) return;
  allDayEl.checked = task.allDay === true;
  document.getElementById("modal-repeat").value = task.recurrence || "none";
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    const p = localDateParts(d);
    dueEl.value = `${p.y}-${p.m}-${p.day}`;
    if (task.allDay === true) {
      timeEl.value = "12:00";
    } else {
      timeEl.value = `${p.hh}:${p.mm}`;
    }
  } else {
    dueEl.value = "";
    timeEl.value = "12:00";
  }
  toggleModalTimeRow();
  refreshModalRepeatLabels();
}

function toggleModalTimeRow() {
  const wrap = document.getElementById("modal-time-wrap");
  const allDay = document.getElementById("modal-all-day")?.checked;
  if (wrap) wrap.classList.toggle("d-none", !!allDay);
}

function defaultCustomRecurrenceFromMainModal() {
  const due = document.getElementById("modal-due")?.value || "";
  const time = document.getElementById("modal-due-time")?.value || "12:00";
  return {
    every: 1,
    unit: "day",
    startTime: time,
    startDate: due || new Date().toISOString().slice(0, 10),
    endType: "never",
    endOn: null,
    endAfterOccurrences: null,
  };
}

function fillCustomRecurrenceForm(rule) {
  document.getElementById("cr-every").value = String(rule.every ?? 1);
  document.getElementById("cr-unit").value = rule.unit || "day";
  document.getElementById("cr-time").value = rule.startTime || "12:00";
  document.getElementById("cr-start").value = rule.startDate || "";
  const end = rule.endType || "never";
  const endEl = document.querySelector(`input[name="cr-end"][value="${end}"]`);
  if (endEl) endEl.checked = true;
  else document.getElementById("cr-end-never").checked = true;
  document.getElementById("cr-end-on").value = rule.endOn || "";
  document.getElementById("cr-after").value = String(rule.endAfterOccurrences ?? 30);
  toggleCustomEndFields();
}

function toggleCustomEndFields() {
  const end = document.querySelector('input[name="cr-end"]:checked')?.value || "never";
  document.getElementById("cr-end-on").disabled = end !== "on";
  document.getElementById("cr-after").disabled = end !== "after";
}

function readCustomRecurrenceForm() {
  const every = Math.min(999, Math.max(1, parseInt(document.getElementById("cr-every").value, 10) || 1));
  const unit = document.getElementById("cr-unit").value;
  const startTime = document.getElementById("cr-time").value || "12:00";
  const startRaw = (document.getElementById("cr-start").value || "").trim();
  const startDate = startRaw.length > 0 ? startRaw : undefined;
  const endType = document.querySelector('input[name="cr-end"]:checked')?.value || "never";
  let endOn = null;
  let endAfterOccurrences = null;
  if (endType === "on") {
    const onRaw = (document.getElementById("cr-end-on").value || "").trim();
    endOn = onRaw.length > 0 ? onRaw : null;
  }
  if (endType === "after") {
    endAfterOccurrences = Math.min(9999, Math.max(1, parseInt(document.getElementById("cr-after").value, 10) || 1));
  }
  const rule = {
    every,
    unit,
    startTime,
    endType,
    endOn,
    endAfterOccurrences,
  };
  if (startDate !== undefined) rule.startDate = startDate;
  return rule;
}

function openCustomRecurrenceEditor() {
  const rule = pendingCustomRecurrence || defaultCustomRecurrenceFromMainModal();
  fillCustomRecurrenceForm(rule);
  bootstrap.Modal.getOrCreateInstance(document.getElementById("customRecurrenceModal")).show();
}

function customRecurrenceModalHtml() {
  return `
    <div class="modal fade" id="customRecurrenceModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content custom-recurrence-sheet border-0 shadow">
          <div class="modal-header border-0 pb-0 pt-3 px-3">
            <button type="button" class="btn-close ms-auto" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body pt-2 px-3 pb-3">
            <label class="form-label small mb-1 cr-label" for="cr-every">Repeats every</label>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
              <input type="number" class="form-control form-control-sm cr-field" id="cr-every" min="1" max="999" value="1" style="width:4.5rem" />
              <select class="form-select form-select-sm flex-grow-1 cr-field" id="cr-unit" style="min-width:8rem">
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label small mb-1 cr-label visually-hidden" for="cr-time">Time</label>
              <input type="time" class="form-control cr-field" id="cr-time" value="12:00" />
            </div>
            <div class="mb-3">
              <label class="form-label small mb-1 cr-label" for="cr-start">Starts</label>
              <input type="date" class="form-control cr-field" id="cr-start" />
            </div>
            <label class="form-label small mb-1 cr-label">Ends</label>
            <div class="form-check">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-never" value="never" checked />
              <label class="form-check-label" for="cr-end-never">Never</label>
            </div>
            <div class="form-check d-flex flex-wrap align-items-center gap-2 mt-2">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-on-radio" value="on" />
              <label class="form-check-label mb-0" for="cr-end-on-radio">On</label>
              <input type="date" class="form-control form-control-sm cr-field" id="cr-end-on" disabled style="max-width:11rem" />
            </div>
            <div class="form-check d-flex flex-wrap align-items-center gap-2 mt-2">
              <input class="form-check-input cr-check" type="radio" name="cr-end" id="cr-end-after-radio" value="after" />
              <label class="form-check-label mb-0" for="cr-end-after-radio">After</label>
              <input type="number" class="form-control form-control-sm cr-field" id="cr-after" min="1" max="9999" value="30" disabled style="width:4.5rem" />
              <span class="small cr-muted">occurrences</span>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0 pb-3 px-3 gap-2">
            <button type="button" class="btn btn-link text-decoration-none cr-cancel-link" data-bs-dismiss="modal" id="cr-cancel">Cancel</button>
            <button type="button" class="btn cr-done-pill ms-auto" id="cr-done">Done</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireCustomRecurrenceModal() {
  document.querySelectorAll('input[name="cr-end"]').forEach((r) => {
    r.addEventListener("change", toggleCustomEndFields);
  });
  document.getElementById("cr-done").addEventListener("click", () => {
    const draft = readCustomRecurrenceForm();
    if (draft.endType === "on" && !draft.endOn) {
      showToast('Choose an end date for "On", or pick Never / After occurrences.', "warning");
      return;
    }
    pendingCustomRecurrence = draft;
    document.getElementById("modal-repeat").value = "custom";
    const mainDue = document.getElementById("cr-start").value;
    if (mainDue) {
      document.getElementById("modal-due").value = mainDue;
    }
    const t = pendingCustomRecurrence.startTime;
    if (t) document.getElementById("modal-due-time").value = t;
    bootstrap.Modal.getInstance(document.getElementById("customRecurrenceModal")).hide();
  });
  document.getElementById("cr-cancel").addEventListener("click", () => {
    if (!pendingCustomRecurrence) {
      document.getElementById("modal-repeat").value = "none";
    }
  });
}

function listNameModalHtml() {
  return `
    <div class="modal fade" id="listNameModal" tabindex="-1" aria-labelledby="listNameModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="listNameModalTitle">List name</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <label class="form-label mb-1" for="listNameInput" id="listNameModalLabel">Name</label>
            <input type="text" class="form-control" id="listNameInput" maxlength="200" autocomplete="off" />
          </div>
          <div class="modal-footer border-top-0 pt-0">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="listNameModalSave">Save</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireListNameModal() {
  const modalEl = document.getElementById("listNameModal");
  const inputEl = document.getElementById("listNameInput");
  const saveBtn = document.getElementById("listNameModalSave");
  if (!modalEl || !inputEl || !saveBtn) return;

  inputEl.replaceWith(inputEl.cloneNode(true));
  saveBtn.replaceWith(saveBtn.cloneNode(true));
  const input = document.getElementById("listNameInput");
  const save = document.getElementById("listNameModalSave");

  const updateSaveEnabled = () => {
    save.disabled = !input.value.trim();
  };

  input.addEventListener("input", updateSaveEnabled);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!save.disabled) save.click();
    }
  });
  save.addEventListener("click", () => {
    const value = input.value.trim();
    if (!value) return;
    const resolve = listNameResolve;
    listNameResolve = null;
    bootstrap.Modal.getInstance(modalEl)?.hide();
    if (resolve) resolve(value);
  });
  modalEl.addEventListener("hidden.bs.modal", () => {
    if (listNameResolve) {
      listNameResolve(null);
      listNameResolve = null;
    }
  });
}

/**
 * @param {{ heading: string; fieldLabel?: string; initialValue?: string }} opts
 * @returns {Promise<string | null>} trimmed name, or null if cancelled
 */
function openListNameModal(opts) {
  const { heading, fieldLabel = "List name", initialValue = "" } = opts;
  return new Promise((resolve) => {
    listNameResolve = resolve;
    const titleEl = document.getElementById("listNameModalTitle");
    const labelEl = document.getElementById("listNameModalLabel");
    const input = document.getElementById("listNameInput");
    const save = document.getElementById("listNameModalSave");
    const modalEl = document.getElementById("listNameModal");
    if (!titleEl || !labelEl || !input || !save || !modalEl) {
      resolve(null);
      listNameResolve = null;
      return;
    }
    titleEl.textContent = heading;
    labelEl.textContent = fieldLabel;
    input.value = initialValue;
    save.disabled = !initialValue.trim();
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  });
}

function updateModalSaveEnabled() {
  const btn = document.getElementById("modal-save");
  if (!btn) return;
  const title = document.getElementById("modal-title")?.value?.trim();
  btn.disabled = !title;
}

function taskModalHtml() {
  return `
    <div class="modal fade" id="taskModal" tabindex="-1" aria-labelledby="taskModalLabel">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0 align-items-start">
            <div class="flex-grow-1 me-2">
              <label class="visually-hidden" for="modal-title" id="taskModalLabel">Title</label>
              <input type="text" class="form-control form-control-lg border-0 border-bottom rounded-0 shadow-none px-0 task-modal-title-input" id="modal-title" placeholder="Add title" autocomplete="off" />
            </div>
            <button type="button" class="btn-close mt-1" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body pt-3">
            <input type="hidden" id="modal-task-id" />
            <div id="modal-schedule-wrap">
              <div class="d-flex align-items-start gap-2 mb-3">
                <i class="bi bi-clock text-secondary fs-5 mt-1 flex-shrink-0" aria-hidden="true"></i>
                <div class="flex-grow-1">
                  <div class="row g-2">
                    <div class="col-sm-6">
                      <label class="form-label small text-muted mb-0" for="modal-due">Date</label>
                      <input class="form-control" type="date" id="modal-due" />
                    </div>
                    <div class="col-sm-6" id="modal-time-wrap">
                      <label class="form-label small text-muted mb-0" for="modal-due-time">Time</label>
                      <input class="form-control" type="time" id="modal-due-time" value="12:00" />
                    </div>
                  </div>
                  <div class="form-check mt-2">
                    <input class="form-check-input" type="checkbox" id="modal-all-day" />
                    <label class="form-check-label" for="modal-all-day">All day</label>
                  </div>
                  <label class="form-label small text-muted mt-2 mb-0" for="modal-repeat">Repeat</label>
                  <select class="form-select form-select-sm mt-1" id="modal-repeat">
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="d-flex align-items-start gap-2 mb-3">
              <i class="bi bi-text-left text-secondary fs-5 mt-1 flex-shrink-0" aria-hidden="true"></i>
              <div class="flex-grow-1">
                <label class="form-label visually-hidden" for="modal-notes">Description</label>
                <textarea class="form-control" id="modal-notes" rows="4" placeholder="Add description"></textarea>
              </div>
            </div>
            <div class="d-flex align-items-start gap-2 mb-3" id="modal-list-wrap">
              <i class="bi bi-list-task text-secondary fs-5 mt-2 flex-shrink-0" aria-hidden="true"></i>
              <div class="flex-grow-1">
                <label class="form-label small text-muted mb-0" for="modal-move-list">List</label>
                <select class="form-select form-select-sm mt-1" id="modal-move-list"></select>
              </div>
            </div>
            <div class="d-flex align-items-start gap-2 mb-3" id="modal-assignee-wrap">
              <i class="bi bi-people text-secondary fs-5 mt-2 flex-shrink-0" aria-hidden="true"></i>
              <div class="flex-grow-1">
                <label class="form-label small text-muted mb-0" id="modal-assignee-label" for="modal-assignee-toggle">Assign to</label>
                <div class="modal-assignee-picker mt-1">
                  <button
                    class="btn btn-outline-secondary w-100 text-start d-flex justify-content-between align-items-center gap-2"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#modal-assignee-panel"
                    aria-expanded="false"
                    aria-controls="modal-assignee-panel"
                    id="modal-assignee-toggle"
                  >
                    <span id="modal-assignee-toggle-label" class="text-truncate">Select employees…</span>
                    <i class="bi bi-chevron-down small flex-shrink-0 modal-assignee-chevron" aria-hidden="true"></i>
                  </button>
                  <div class="collapse border rounded bg-body mt-1 shadow-sm" id="modal-assignee-panel">
                    <label class="visually-hidden" for="modal-assignee-search">Search employees</label>
                    <div class="p-2 border-bottom">
                      <div class="input-group input-group-sm">
                        <span class="input-group-text bg-body border-end-0 ps-2 pe-0 text-muted"><i class="bi bi-search" aria-hidden="true"></i></span>
                        <input
                          type="search"
                          class="form-control border-start-0"
                          id="modal-assignee-search"
                          placeholder="Search employees"
                          autocomplete="off"
                        />
                      </div>
                    </div>
                    <div id="modal-assignee-options" class="px-2 py-2" style="max-height: 11rem; overflow-y: auto"></div>
                  </div>
                </div>
                <div id="modal-assignee-chips" class="d-flex flex-wrap gap-1 mt-2" role="list" aria-label="Selected assignees"></div>
                <p class="small text-muted mb-0 mt-1">Open the list to search and select one or more employees. Selected names appear below.</p>
              </div>
            </div>
          </div>
          <div class="modal-footer d-flex justify-content-between flex-wrap gap-2 border-0 pt-0">
            <button type="button" class="btn btn-outline-danger" id="modal-delete">Delete task</button>
            <div class="ms-auto">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="modal-save">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function submissionDetailModalHtml() {
  return `
    <div class="modal fade" id="submissionDetailModal" tabindex="-1" aria-labelledby="submissionDetailTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="submissionDetailTitle">Submission</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="submission-detail-text-wrap" class="submission-detail-text-wrap mb-3 d-none">
              <p class="small text-uppercase text-secondary fw-semibold mb-2">Submission notes</p>
              <div id="submission-detail-text" class="submission-detail-text border rounded p-3 bg-body-secondary small mb-0"></div>
            </div>
            <div id="submission-detail-image-wrap" class="submission-detail-image-wrap d-none">
              <p class="small text-uppercase text-secondary fw-semibold mb-2">Image</p>
              <div class="submission-detail-image-frame rounded border bg-black d-flex align-items-center justify-content-center">
                <img id="submission-detail-img" src="" class="w-100" style="max-height: min(70vh, 720px); object-fit: contain;" alt="Submission image" />
              </div>
            </div>
            <p id="submission-detail-empty" class="text-muted small mb-0 d-none">No submission content.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

function progressUpdateModalHtml() {
  return `
    <div class="modal fade" id="progressUpdateModal" tabindex="-1" aria-labelledby="progressUpdateModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="progressUpdateModalTitle">Task update</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="progress-update-task-id" value="" />
            <input type="hidden" id="progress-update-user-id" value="" />
            <input type="hidden" id="progress-update-readonly" value="0" />
            <p class="fw-medium text-body-secondary mb-1 small text-uppercase text-secondary">Task</p>
            <p id="progress-update-task-title" class="fw-semibold mb-1"></p>
            <p id="progress-update-assignee-label" class="small text-muted mb-3 d-none"></p>
            <div id="progress-update-compose-wrap">
              <p class="small text-uppercase text-secondary fw-semibold mb-2">Update type</p>
              <div id="progress-update-type-chips" class="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Update type"></div>
              <label class="form-label" for="progress-update-message">Your update</label>
              <textarea
                class="form-control progress-update-textarea"
                id="progress-update-message"
                rows="4"
                maxlength="${PROGRESS_UPDATE_TEXT_MAX}"
                placeholder="Share what you are doing, any blockers, or progress on this task."
              ></textarea>
              <div class="d-flex justify-content-end mt-1">
                <span id="progress-update-count" class="small text-muted tabular-nums">0 / ${PROGRESS_UPDATE_TEXT_MAX}</span>
              </div>
              <p id="progress-update-error" class="text-danger small mb-0 mt-2 d-none" role="alert"></p>
            </div>
            <div id="progress-update-history-wrap" class="mt-3">
              <p class="small text-uppercase text-secondary fw-semibold mb-2">Update history</p>
              <div id="progress-update-history" class="progress-update-timeline"></div>
              <p id="progress-update-history-empty" class="text-muted small mb-0 d-none">No updates yet.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary" id="progress-update-submit">
              <i class="bi bi-send me-1" aria-hidden="true"></i>Post update
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function empCreateTaskModalHtml() {
  return `
    <div class="modal fade" id="empCreateTaskModal" tabindex="-1" aria-labelledby="empCreateTaskModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="empCreateTaskModalTitle">Create & assign task</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <label class="form-label" for="emp-create-title">Task title</label>
            <input type="text" class="form-control mb-3" id="emp-create-title" maxlength="500" placeholder="What needs to be done?" autocomplete="off" />
            <label class="form-label" for="emp-create-notes">Description <span class="text-muted fw-normal">(optional)</span></label>
            <textarea class="form-control mb-3" id="emp-create-notes" rows="3" placeholder="Add details for the assignee"></textarea>
            <label class="form-label" for="emp-create-due">Deadline <span class="text-muted fw-normal">(optional)</span></label>
            <input type="datetime-local" class="form-control mb-3" id="emp-create-due" />
            <label class="form-label" for="emp-create-assignee">Assign to</label>
            <select class="form-select" id="emp-create-assignee">
              <option value="">Choose an employee…</option>
            </select>
            <p class="small text-muted mt-3 mb-0">The task is added to admin's list. Only admin can see updates and submissions.</p>
            <p id="emp-create-error" class="text-danger small mb-0 mt-2 d-none" role="alert"></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="emp-create-submit">
              <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Create task
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function empDelegateModalHtml() {
  return `
    <div class="modal fade" id="empDelegateModal" tabindex="-1" aria-labelledby="empDelegateModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="empDelegateModalTitle">Assign task to colleague</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="emp-delegate-task-id" value="" />
            <p class="fw-medium text-body-secondary mb-1 small text-uppercase text-secondary">Task</p>
            <p id="emp-delegate-task-title" class="fw-semibold mb-3"></p>
            <p class="small text-muted mb-3">The colleague will work on this task. Updates and submission are visible to admin only. You will no longer see this task on your list.</p>
            <label class="form-label" for="emp-delegate-employee">Assign to</label>
            <select class="form-select" id="emp-delegate-employee">
              <option value="">Choose an employee…</option>
            </select>
            <p id="emp-delegate-error" class="text-danger small mb-0 mt-2 d-none" role="alert"></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="emp-delegate-submit">
              <i class="bi bi-person-plus me-1" aria-hidden="true"></i>Assign task
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function empSubmissionModalHtml() {
  return `
    <div class="modal fade" id="empSubmissionModal" tabindex="-1" aria-labelledby="empSubmissionModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="empSubmissionModalTitle">Submit task</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="emp-submission-task-id" value="" />
            <p class="fw-medium text-body-secondary mb-1 small text-uppercase text-secondary">Task</p>
            <p id="emp-submission-task-title" class="fw-semibold mb-3"></p>
            <label class="form-label" for="emp-submission-text">Submission notes</label>
            <textarea
              class="form-control emp-submission-textarea"
              id="emp-submission-text"
              rows="5"
              maxlength="${EMP_SUBMISSION_TEXT_MAX}"
              placeholder="Describe what you completed, paste notes, or leave blank if you only upload an image."
            ></textarea>
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-2">
              <button type="button" class="btn btn-sm btn-outline-secondary" id="emp-submission-paste">
                <i class="bi bi-clipboard me-1" aria-hidden="true"></i>Paste from clipboard
              </button>
              <span id="emp-submission-count" class="small text-muted tabular-nums">0 / ${EMP_SUBMISSION_TEXT_MAX}</span>
            </div>
            <p id="emp-submission-error" class="text-danger small mb-0 mt-2 d-none" role="alert"></p>
            <hr class="my-3" />
            <label class="form-label" for="emp-submission-image">Submission image <span class="text-muted fw-normal">(optional)</span></label>
            <input
              type="file"
              class="form-control"
              id="emp-submission-image"
              accept="image/jpeg,image/png,image/gif,image/webp"
            />
            <div id="emp-submission-preview-wrap" class="mt-2 d-none">
              <img id="emp-submission-preview" src="" alt="Selected image preview" class="submission-preview-thumb rounded border" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="emp-submission-submit">
              <i class="bi bi-send me-1" aria-hidden="true"></i>Submit
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function ownerMarkDoneModalHtml() {
  return `
    <div class="modal fade" id="ownerMarkDoneModal" tabindex="-1" aria-labelledby="ownerMarkDoneModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="ownerMarkDoneModalTitle">Mark task done</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="owner-mark-done-task-id" value="" />
            <p class="fw-medium text-body-secondary mb-1 small text-uppercase text-secondary">Task</p>
            <p class="mb-3" id="owner-mark-done-task-title"></p>
            <label class="form-label small text-muted mb-1" for="owner-mark-done-search">Search employees</label>
            <div class="input-group input-group-sm mb-3">
              <span class="input-group-text bg-body border-end-0"><i class="bi bi-search" aria-hidden="true"></i></span>
              <input
                type="search"
                class="form-control border-start-0"
                id="owner-mark-done-search"
                placeholder="Type a name"
                autocomplete="off"
              />
            </div>
            <p class="small text-muted mb-2" id="owner-mark-done-hint">Check an employee to mark them submitted; uncheck for pending.</p>
            <div id="owner-mark-done-list" class="border rounded px-3 py-2 bg-body-secondary bg-opacity-25" style="max-height: 280px; overflow-y: auto"></div>
            <p class="small text-muted mb-0 mt-3 d-none" id="owner-mark-done-empty">
              No one is assigned yet. Use <strong>Edit</strong> on the task to add employees.
            </p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

function teamAdminModalHtml() {
  return `
    <div class="modal fade" id="teamAdminModal" tabindex="-1" aria-labelledby="teamAdminModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" id="teamAdminModalTitle">Team &amp; admin access</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-3">Promote employees to admin or revoke admin access. Email notifications are sent automatically.</p>
            <div id="team-admin-list"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function refreshTeamAdminList() {
  const host = document.getElementById("team-admin-list");
  if (!host) return;
  host.innerHTML = '<p class="small text-muted mb-0">Loading…</p>';
  try {
    const { users } = await api("/api/users/team");
    if (!users.length) {
      host.innerHTML = '<p class="small text-muted mb-0">No team members yet.</p>';
      return;
    }
    const selfId = state.user?.id || "";
    host.innerHTML = `<div class="list-group list-group-flush border rounded team-admin-list">
      ${users
        .map((u) => {
          const isAdmin = u.role === "owner";
          const isSelf = u.id === selfId;
          let action;
          if (isAdmin) {
            if (isSelf) {
              action =
                '<span class="badge rounded-pill owner-role-badge flex-shrink-0">Admin (you)</span>';
            } else {
              action = `<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0 team-revoke-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
                u.displayName
              )}">Revoke admin</button>`;
            }
          } else {
            action = `<button type="button" class="btn btn-sm btn-primary flex-shrink-0 team-promote-btn" data-user-id="${u.id}" data-user-name="${escapeHtml(
              u.displayName
            )}">Make admin</button>`;
          }
          return `<div class="list-group-item d-flex justify-content-between align-items-center gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-truncate">${escapeHtml(u.displayName)}</div>
              <div class="small text-muted text-truncate">${escapeHtml(u.email)}</div>
            </div>
            ${action}
          </div>`;
        })
        .join("")}
    </div>`;

    async function patchTeamRole(id, role, name, successMsg, warnMsg) {
      const result = await api(`/api/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      if (result.emailSent) {
        showToast(`${successMsg} A notification email was sent.`, "success");
      } else {
        showToast(`${warnMsg} The notification email could not be sent.`, "warning");
      }
      await refreshTeamAdminList();
      await loadAssignees();
    }

    host.querySelectorAll(".team-promote-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (!id || !window.confirm(`Make ${name} an admin? They will get full dashboard access on the website.`)) return;
        btn.disabled = true;
        try {
          await patchTeamRole(id, "owner", name, `${name} is now an admin.`, `${name} is now an admin, but`);
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });

    host.querySelectorAll(".team-revoke-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-user-id");
        const name = btn.getAttribute("data-user-name");
        if (
          !id ||
          !window.confirm(
            `Revoke admin access for ${name}? They will lose dashboard access and return to employee sign-in.`
          )
        ) {
          return;
        }
        btn.disabled = true;
        try {
          await patchTeamRole(
            id,
            "employee",
            name,
            `${name}'s admin access was revoked.`,
            `${name}'s admin access was revoked, but`
          );
        } catch (err) {
          showToast(err.message, "danger");
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="small text-danger mb-0">${escapeHtml(err.message)}</p>`;
  }
}

function wireTeamAdminModal() {
  const el = document.getElementById("teamAdminModal");
  if (!el) return;
  el.addEventListener("show.bs.modal", () => {
    refreshTeamAdminList();
  });
}

function filterOwnerMarkDoneModalList() {
  const q = (document.getElementById("owner-mark-done-search")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#owner-mark-done-list .owner-mark-done-row").forEach((row) => {
    const label = row.querySelector("label");
    const text = (label?.textContent || "").toLowerCase();
    row.classList.toggle("d-none", q.length > 0 && !text.includes(q));
  });
}

function fillOwnerMarkDoneModalList(taskId) {
  const task = findTaskById(taskId);
  const host = document.getElementById("owner-mark-done-list");
  const emptyEl = document.getElementById("owner-mark-done-empty");
  const hintEl = document.getElementById("owner-mark-done-hint");
  if (!host) return;
  if (!task) {
    host.innerHTML = "";
    emptyEl?.classList.remove("d-none");
    hintEl?.classList.add("d-none");
    return;
  }
  const assignees = task.assignees ?? [];
  if (assignees.length === 0) {
    host.innerHTML = "";
    emptyEl?.classList.remove("d-none");
    hintEl?.classList.add("d-none");
    return;
  }
  emptyEl?.classList.add("d-none");
  hintEl?.classList.remove("d-none");
  host.innerHTML = assignees
    .map((a) => {
      const cbId = `owner-md-mod-${taskId}-${a.id}`;
      return `<div class="owner-mark-done-row py-1">
        <div class="form-check mb-0">
          <input class="form-check-input owner-mark-done-modal-cb" type="checkbox" data-task-id="${taskId}" data-user-id="${
        a.id
      }" id="${cbId}" ${a.assigneeDone ? "checked" : ""} />
          <label class="form-check-label" for="${cbId}">${escapeHtml(a.displayName)}</label>
        </div>
      </div>`;
    })
    .join("");
}

function openOwnerMarkDoneModal(taskId) {
  const modalEl = document.getElementById("ownerMarkDoneModal");
  if (!modalEl) return;
  document.getElementById("owner-mark-done-task-id").value = taskId;
  const task = findTaskById(taskId);
  const titleLine = document.getElementById("owner-mark-done-task-title");
  if (titleLine) titleLine.textContent = task?.title ?? "—";
  const search = document.getElementById("owner-mark-done-search");
  if (search) search.value = "";
  fillOwnerMarkDoneModalList(taskId);
  filterOwnerMarkDoneModalList();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function wireOwnerMarkDoneModal() {
  const modal = document.getElementById("ownerMarkDoneModal");
  if (!modal || modal.dataset.markDoneWired === "1") return;
  modal.dataset.markDoneWired = "1";

  modal.addEventListener("change", async (e) => {
    const cb = e.target;
    if (!cb.classList?.contains("owner-mark-done-modal-cb")) return;
    const taskId = cb.getAttribute("data-task-id");
    const userId = cb.getAttribute("data-user-id");
    const listId = state.activeListId;
    if (!taskId || !userId || !listId) return;
    const prev = !cb.checked;
    try {
      await api(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ assigneeSetDone: { userId, assigneeDone: cb.checked } }),
      });
      await loadTasks(listId);
      fillOwnerMarkDoneModalList(taskId);
      filterOwnerMarkDoneModalList();
      renderOwnerMain();
    } catch (err) {
      showToast(err.message, "danger");
      cb.checked = prev;
    }
  });

  document.getElementById("owner-mark-done-search")?.addEventListener("input", filterOwnerMarkDoneModalList);

  modal.addEventListener("shown.bs.modal", () => {
    document.getElementById("owner-mark-done-search")?.focus();
  });

  modal.addEventListener("hidden.bs.modal", () => {
    const s = document.getElementById("owner-mark-done-search");
    if (s) s.value = "";
    filterOwnerMarkDoneModalList();
  });
}

function submissionPreviewText(text, max = 72) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function assigneeHasSubmission(a) {
  if (!a) return false;
  return !!(a.submissionText?.trim() || a.completionProofUrl);
}

function lookupAssigneeSubmission(taskId, userId) {
  const task =
    state.empTasks.find((t) => t.id === taskId) ?? state.tasks.find((t) => t.id === taskId) ?? null;
  if (!task) return null;
  const assignee = (task.assignees ?? []).find((a) => a.id === userId) ?? null;
  if (!assignee) return null;
  return {
    taskTitle: task.title,
    submissionText: assignee.submissionText?.trim() || "",
    proofUrl: assignee.completionProofUrl || null,
  };
}

function clearSubmissionDetailImage() {
  const img = document.getElementById("submission-detail-img");
  if (img?.src?.startsWith("blob:")) {
    URL.revokeObjectURL(img.src);
    proofBlobUrls.delete(img.src);
  }
  if (img) img.removeAttribute("src");
}

async function openSubmissionDetailModal({ title, submissionText, proofUrl }) {
  const modalEl = document.getElementById("submissionDetailModal");
  const titleEl = document.getElementById("submissionDetailTitle");
  const textWrap = document.getElementById("submission-detail-text-wrap");
  const textEl = document.getElementById("submission-detail-text");
  const imageWrap = document.getElementById("submission-detail-image-wrap");
  const img = document.getElementById("submission-detail-img");
  const emptyEl = document.getElementById("submission-detail-empty");
  if (!modalEl || !titleEl || !textWrap || !textEl || !imageWrap || !img || !emptyEl) return;

  const text = (submissionText || "").trim();
  const hasText = text.length > 0;
  const hasImage = !!proofUrl;

  titleEl.textContent = title || "Submission";
  clearSubmissionDetailImage();

  if (hasText) {
    textWrap.classList.remove("d-none");
    textEl.textContent = text;
  } else {
    textWrap.classList.add("d-none");
    textEl.textContent = "";
  }

  if (hasImage) {
    imageWrap.classList.remove("d-none");
    img.alt = title || "Submission image";
  } else {
    imageWrap.classList.add("d-none");
  }

  emptyEl.classList.toggle("d-none", hasText || hasImage);

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  if (hasImage) {
    try {
      img.src = await fetchProofBlobUrl(proofUrl);
    } catch (err) {
      modal.hide();
      showToast(err.message || "Could not load submission image.", "danger");
    }
  }
}

async function openProofImageModal(proofUrl, altLabel) {
  await openSubmissionDetailModal({ title: altLabel, submissionText: null, proofUrl });
}

async function openSubmissionDetailForAssignee(taskId, userId) {
  const q =
    state.user?.role === "employee"
      ? ""
      : `?assigneeUserId=${encodeURIComponent(userId)}`;
  const data = await api(`/api/tasks/${taskId}/submission${q}`);
  await openSubmissionDetailModal({
    title: data.taskTitle,
    submissionText: data.submissionText,
    proofUrl: data.completionProofUrl,
  });
}

function wireSubmissionDetailModal() {
  const modalEl = document.getElementById("submissionDetailModal");
  if (!modalEl || modalEl.dataset.wiredSubmissionDetail === "1") return;
  modalEl.dataset.wiredSubmissionDetail = "1";
  modalEl.addEventListener("hidden.bs.modal", () => {
    clearSubmissionDetailImage();
  });
}

function syncEmpSubmissionCharCount() {
  const ta = document.getElementById("emp-submission-text");
  const counter = document.getElementById("emp-submission-count");
  if (!ta || !counter) return;
  const len = ta.value.length;
  counter.textContent = `${len} / ${EMP_SUBMISSION_TEXT_MAX}`;
  counter.classList.toggle("text-danger", len >= EMP_SUBMISSION_TEXT_MAX);
}

function resetEmpSubmissionPreview() {
  const input = document.getElementById("emp-submission-image");
  const wrap = document.getElementById("emp-submission-preview-wrap");
  const preview = document.getElementById("emp-submission-preview");
  if (input) input.value = "";
  if (preview?.src?.startsWith("blob:")) URL.revokeObjectURL(preview.src);
  if (preview) preview.removeAttribute("src");
  if (wrap) wrap.classList.add("d-none");
}

function openEmpSubmissionModal(task) {
  const modalEl = document.getElementById("empSubmissionModal");
  if (!modalEl || !task) return;
  const idInput = document.getElementById("emp-submission-task-id");
  const titleEl = document.getElementById("emp-submission-task-title");
  const ta = document.getElementById("emp-submission-text");
  const errEl = document.getElementById("emp-submission-error");
  if (!idInput || !titleEl || !ta || !errEl) return;

  idInput.value = task.id;
  titleEl.textContent = task.title;
  ta.value = "";
  errEl.textContent = "";
  errEl.classList.add("d-none");
  resetEmpSubmissionPreview();
  syncEmpSubmissionCharCount();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  window.setTimeout(() => ta.focus(), 300);
}

async function submitEmployeeSubmission(taskId, submissionText, file) {
  const fd = new FormData();
  fd.append("submissionText", submissionText);
  if (file) fd.append("proof", file);
  let res;
  try {
    res = await fetch(`/api/tasks/${taskId}/completion-proof`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
  } catch {
    throw new Error("Network error submitting task.");
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      state.user = null;
      renderAuthForm();
      throw new Error("Session expired. Please sign in again.");
    }
    throw new Error(submissionUploadErrorMessage(res, text));
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return data;
}

function wireEmpSubmissionModal() {
  const modalEl = document.getElementById("empSubmissionModal");
  if (!modalEl || modalEl.dataset.wiredEmpSubmission === "1") return;
  modalEl.dataset.wiredEmpSubmission = "1";

  const ta = document.getElementById("emp-submission-text");
  const pasteBtn = document.getElementById("emp-submission-paste");
  const fileInput = document.getElementById("emp-submission-image");
  const submitBtn = document.getElementById("emp-submission-submit");
  const previewWrap = document.getElementById("emp-submission-preview-wrap");
  const preview = document.getElementById("emp-submission-preview");

  ta?.addEventListener("input", syncEmpSubmissionCharCount);

  pasteBtn?.addEventListener("click", async () => {
    if (!ta) return;
    if (!navigator.clipboard?.readText) {
      showToast("Clipboard paste is not supported in this browser.", "warning");
      return;
    }
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        showToast("Clipboard is empty.", "warning");
        return;
      }
      const room = EMP_SUBMISSION_TEXT_MAX - ta.value.length;
      if (room <= 0) {
        showToast(`Notes are limited to ${EMP_SUBMISSION_TEXT_MAX} characters.`, "warning");
        return;
      }
      ta.value = (ta.value + clip).slice(0, EMP_SUBMISSION_TEXT_MAX);
      syncEmpSubmissionCharCount();
      showToast("Pasted from clipboard.", "success");
    } catch {
      showToast("Could not read clipboard. Allow paste permission and try again.", "warning");
    }
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file || !preview || !previewWrap) {
      resetEmpSubmissionPreview();
      return;
    }
    const fileErr = validateEmpSubmissionImageFile(file);
    if (fileErr) {
      showToast(fileErr, "warning");
      fileInput.value = "";
      resetEmpSubmissionPreview();
      return;
    }
    if (preview.src?.startsWith("blob:")) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    previewWrap.classList.remove("d-none");
  });

  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("emp-submission-task-id");
    const errEl = document.getElementById("emp-submission-error");
    const taskId = idInput?.value?.trim();
    if (!taskId || !ta || !errEl) return;

    const text = ta.value.trim();
    const file = fileInput?.files?.[0] ?? null;
    errEl.classList.add("d-none");
    errEl.textContent = "";

    if (!text && !file) {
      errEl.textContent = EMP_SUBMISSION_REQUIRED_MSG;
      errEl.classList.remove("d-none");
      return;
    }
    if (text.length > EMP_SUBMISSION_TEXT_MAX) {
      errEl.textContent = `Submission notes must be ${EMP_SUBMISSION_TEXT_MAX} characters or fewer.`;
      errEl.classList.remove("d-none");
      return;
    }
    if (file) {
      const fileErr = validateEmpSubmissionImageFile(file);
      if (fileErr) {
        errEl.textContent = fileErr;
        errEl.classList.remove("d-none");
        return;
      }
    }

    submitBtn.disabled = true;
    try {
      const task = state.empTasks.find((t) => t.id === taskId);
      const result = await submitEmployeeSubmission(taskId, ta.value, file);
      if (task?.dueAt) clearReminderForTask(taskId, task.dueAt);
      bootstrap.Modal.getInstance(modalEl)?.hide();
      if (result?.task) {
        const idx = state.empTasks.findIndex((t) => t.id === taskId);
        if (idx >= 0) state.empTasks[idx] = result.task;
        else state.empTasks.push(result.task);
      }
      showToast("Task submitted.", "success");
      await loadEmployeeTasks();
      renderEmpListContentOnly();
      renderEmployeeMain();
    } catch (err) {
      errEl.textContent = err.message || "Submission failed";
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    resetEmpSubmissionPreview();
    if (ta) ta.value = "";
    syncEmpSubmissionCharCount();
    const errEl = document.getElementById("emp-submission-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("d-none");
    }
  });
}

function progressUpdateTypeMeta(type) {
  return PROGRESS_UPDATE_TYPES.find((t) => t.id === type) ?? PROGRESS_UPDATE_TYPES[3];
}

function formatProgressUpdateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function assigneeInitials(displayName) {
  const parts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function ownerUpdateTotalCountBadgeHtml(count) {
  const total = count ?? 0;
  if (total < 1) return "";
  return `<span class="owner-update-total-badge tabular-nums" aria-label="${total} update${
    total === 1 ? "" : "s"
  } posted">${total}</span>`;
}

function ownerProgressUpdateBadgeHtml(assignee) {
  const total = assignee.progressUpdateCount ?? 0;
  const unread = assignee.unreadProgressUpdateCount ?? 0;
  if (total === 0 || unread === 0) return "";
  return `<span class="owner-update-unread-badge tabular-nums" aria-label="${unread} unread update${
    unread === 1 ? "" : "s"
  }">${unread}</span>`;
}

function ownerLatestUpdateSnippet(message, max = 96) {
  const text = (message || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ownerAssigneeUpdatesHtml(taskId, assignee) {
  const latest = assignee.latestProgressUpdate;
  const total = assignee.progressUpdateCount ?? 0;
  if (!total || !latest?.message) {
    return `<span class="owner-assignee-empty-hint text-muted small">No updates yet</span>`;
  }
  const snippet = ownerLatestUpdateSnippet(latest.message);
  const badge = ownerProgressUpdateBadgeHtml(assignee);
  return `<button
      type="button"
      class="owner-assignee-update-preview owner-view-progress-btn"
      data-view-progress-task-id="${taskId}"
      data-view-progress-user-id="${escapeHtml(assignee.id)}"
      data-view-progress-user-name="${escapeHtml(assignee.displayName)}"
      title="${escapeHtml((latest.message || "").trim())}"
      aria-label="View all updates for ${escapeHtml(assignee.displayName)}"
    >
      ${badge}
      <span class="owner-assignee-update-text">${escapeHtml(snippet)}</span>
    </button>`;
}

function ownerDelegationHistoryHtml(task) {
  const rows = task.delegations ?? [];
  if (!rows.length) return "";
  const items = rows
    .map((d) => {
      const when = formatProgressUpdateTime(d.createdAt);
      return `<li class="owner-delegation-item"><i class="bi bi-arrow-right-short text-primary" aria-hidden="true"></i> ${escapeHtml(
        d.fromUserName
      )} assigned to ${escapeHtml(d.toUserName)} <span class="text-muted tabular-nums">· ${escapeHtml(when)}</span></li>`;
    })
    .join("");
  return `<div class="owner-delegation-history mt-3 px-1">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <p class="owner-task-detail-heading small text-secondary mb-0">Assignment history</p>
        <button type="button" class="btn btn-sm btn-link p-0 owner-view-all-activity" data-task-id="${escapeHtml(task.id)}">View all updates</button>
      </div>
      <ul class="list-unstyled small mb-0">${items}</ul>
    </div>`;
}

function ownerAssigneeSubmissionHtml(taskId, assignee) {
  if (!assigneeHasSubmission(assignee)) {
    return `<span class="owner-assignee-empty-hint text-muted small">No submission yet</span>`;
  }
  return `<button
      type="button"
      class="btn btn-sm btn-outline-primary owner-view-submission-btn owner-assignee-submission-btn"
      data-view-submission-task-id="${taskId}"
      data-view-submission-user-id="${escapeHtml(assignee.id)}"
      title="View submission"
      aria-label="View submission for ${escapeHtml(assignee.displayName)}"
    >
      <i class="bi bi-eye me-1" aria-hidden="true"></i>View submission
    </button>`;
}

async function markProgressUpdatesRead(taskId, assigneeUserId) {
  await api(`/api/tasks/${taskId}/progress-updates/mark-read`, {
    method: "POST",
    body: JSON.stringify({ assigneeUserId }),
  });
}

async function markTaskProgressUpdatesRead(taskId) {
  const task = findTaskById(taskId);
  if (!task) return;
  const unreadAssignees = (task.assignees ?? []).filter((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
  for (const a of unreadAssignees) {
    await markProgressUpdatesRead(taskId, a.id);
  }
}

function renderProgressUpdateTimeline(updates, { showAuthor = false } = {}) {
  if (!updates?.length) return "";
  return updates
    .map((u) => {
      const meta = progressUpdateTypeMeta(u.updateType);
      const author =
        showAuthor && u.displayName
          ? `<span class="small fw-semibold text-body-secondary">${escapeHtml(u.displayName)}</span>`
          : "";
      return `<article class="progress-update-item">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          ${author}
          <span class="badge rounded-pill ${meta.badgeClass}">${escapeHtml(meta.badge)}</span>
          <time class="small text-muted tabular-nums" datetime="${escapeHtml(u.createdAt)}">${escapeHtml(
        formatProgressUpdateTime(u.createdAt)
      )}</time>
        </div>
        <p class="progress-update-item-message small mb-0">${escapeHtml(u.message)}</p>
      </article>`;
    })
    .join("");
}

function syncProgressUpdateCharCount() {
  const ta = document.getElementById("progress-update-message");
  const counter = document.getElementById("progress-update-count");
  if (!ta || !counter) return;
  counter.textContent = `${ta.value.length} / ${PROGRESS_UPDATE_TEXT_MAX}`;
}

function renderProgressUpdateTypeChips(selectedType = "started") {
  const host = document.getElementById("progress-update-type-chips");
  if (!host) return;
  host.innerHTML = PROGRESS_UPDATE_TYPES.map((t) => {
    const active = t.id === selectedType;
    return `<button
      type="button"
      class="btn btn-sm ${active ? "btn-primary" : "btn-outline-primary"} progress-update-type-chip"
      data-progress-type="${t.id}"
      aria-pressed="${active}"
    >
      <i class="bi bi-${t.icon} me-1" aria-hidden="true"></i>${t.label}
    </button>`;
  }).join("");
}

function setProgressUpdateModalReadOnly(readOnly) {
  const compose = document.getElementById("progress-update-compose-wrap");
  const submitBtn = document.getElementById("progress-update-submit");
  const readonlyInput = document.getElementById("progress-update-readonly");
  if (readonlyInput) readonlyInput.value = readOnly ? "1" : "0";
  compose?.classList.toggle("d-none", readOnly);
  submitBtn?.classList.toggle("d-none", readOnly);
}

function renderDelegationTimeline(delegations) {
  if (!delegations?.length) return "";
  const items = delegations
    .map((d) => {
      const when = formatProgressUpdateTime(d.createdAt);
      return `<div class="progress-update-timeline-item owner-delegation-timeline-item small text-muted mb-2">
        <i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>
        ${escapeHtml(d.fromUserName)} assigned to ${escapeHtml(d.toUserName)}
        <span class="tabular-nums">· ${escapeHtml(when)}</span>
      </div>`;
    })
    .join("");
  return `<div class="owner-delegation-timeline mb-3 pb-2 border-bottom">${items}</div>`;
}

async function loadProgressUpdateHistory(taskId, userId, { all = false } = {}) {
  const historyEl = document.getElementById("progress-update-history");
  const emptyEl = document.getElementById("progress-update-history-empty");
  if (!historyEl || !emptyEl) return;
  const q = all
    ? "?all=1"
    : state.user?.role === "owner"
      ? `?assigneeUserId=${encodeURIComponent(userId)}`
      : "";
  const data = await api(`/api/tasks/${taskId}/progress-updates${q}`);
  const updates = data.updates ?? [];
  const delegationBlock = all ? renderDelegationTimeline(data.delegations ?? []) : "";
  historyEl.innerHTML = `${delegationBlock}${renderProgressUpdateTimeline(updates, { showAuthor: all })}`;
  const hasContent = updates.length > 0 || (all && (data.delegations ?? []).length > 0);
  emptyEl.classList.toggle("d-none", hasContent);
  historyEl.classList.toggle("d-none", !hasContent);
  return data;
}

async function openEmpProgressUpdateModal(task) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !task || !state.user?.id) return;
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  const ta = document.getElementById("progress-update-message");
  const errEl = document.getElementById("progress-update-error");
  if (!idInput || !userInput || !titleEl || !ta || !errEl) return;

  idInput.value = task.id;
  userInput.value = state.user.id;
  titleEl.textContent = task.title;
  assigneeLabel?.classList.add("d-none");
  if (modalTitle) modalTitle.textContent = "Post task update";
  ta.value = "";
  errEl.textContent = "";
  errEl.classList.add("d-none");
  setProgressUpdateModalReadOnly(false);
  renderProgressUpdateTypeChips("started");
  const startedMeta = progressUpdateTypeMeta("started");
  ta.value = startedMeta.defaultMsg;
  syncProgressUpdateCharCount();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(task.id, state.user.id);
  } catch (err) {
    showToast(err.message || "Could not load update history.", "danger");
  }
  window.setTimeout(() => ta.focus(), 300);
}

async function openProgressUpdatesForAssignee(taskId, userId, assigneeName) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !taskId || !userId) return;
  const task = state.tasks.find((t) => t.id === taskId) ?? state.empTasks.find((t) => t.id === taskId);
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  if (!idInput || !userInput || !titleEl) return;

  idInput.value = taskId;
  userInput.value = userId;
  titleEl.textContent = task?.title ?? "Task";
  if (assigneeLabel) {
    assigneeLabel.textContent = `Employee: ${assigneeName || "Assignee"}`;
    assigneeLabel.classList.remove("d-none");
  }
  if (modalTitle) modalTitle.textContent = "Review task updates";
  setProgressUpdateModalReadOnly(true);
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(taskId, userId);
  } catch (err) {
    showToast(err.message || "Could not load updates.", "danger");
  }
}

async function openProgressUpdatesAll(taskId) {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || !taskId) return;
  const task = state.tasks.find((t) => t.id === taskId);
  const idInput = document.getElementById("progress-update-task-id");
  const userInput = document.getElementById("progress-update-user-id");
  const titleEl = document.getElementById("progress-update-task-title");
  const assigneeLabel = document.getElementById("progress-update-assignee-label");
  const modalTitle = document.getElementById("progressUpdateModalTitle");
  if (!idInput || !userInput || !titleEl) return;

  idInput.value = taskId;
  userInput.value = "";
  titleEl.textContent = task?.title ?? "Task";
  if (assigneeLabel) {
    assigneeLabel.textContent = "All employees — full activity";
    assigneeLabel.classList.remove("d-none");
  }
  if (modalTitle) modalTitle.textContent = "Full task activity";
  setProgressUpdateModalReadOnly(true);
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    await loadProgressUpdateHistory(taskId, null, { all: true });
  } catch (err) {
    showToast(err.message || "Could not load activity.", "danger");
  }
}

function wireProgressUpdateModal() {
  const modalEl = document.getElementById("progressUpdateModal");
  if (!modalEl || modalEl.dataset.wiredProgressUpdate === "1") return;
  modalEl.dataset.wiredProgressUpdate = "1";

  const chipsHost = document.getElementById("progress-update-type-chips");
  const ta = document.getElementById("progress-update-message");
  const submitBtn = document.getElementById("progress-update-submit");

  ta?.addEventListener("input", syncProgressUpdateCharCount);

  chipsHost?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-progress-type]");
    if (!btn || !ta) return;
    const type = btn.getAttribute("data-progress-type") || "update";
    renderProgressUpdateTypeChips(type);
    const meta = progressUpdateTypeMeta(type);
    const current = ta.value.trim();
    const defaults = PROGRESS_UPDATE_TYPES.map((t) => t.defaultMsg).filter(Boolean);
    if (!current || defaults.includes(current)) {
      ta.value = meta.defaultMsg;
      syncProgressUpdateCharCount();
    }
  });

  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("progress-update-task-id");
    const errEl = document.getElementById("progress-update-error");
    const taskId = idInput?.value?.trim();
    if (!taskId || !ta || !errEl) return;

    const activeChip = chipsHost?.querySelector(".progress-update-type-chip.btn-primary");
    const updateType = activeChip?.getAttribute("data-progress-type") || "update";
    const message = ta.value.trim();
    errEl.classList.add("d-none");
    errEl.textContent = "";

    if (!message) {
      errEl.textContent = "Please enter an update message.";
      errEl.classList.remove("d-none");
      return;
    }
    if (message.length > PROGRESS_UPDATE_TEXT_MAX) {
      errEl.textContent = `Updates must be ${PROGRESS_UPDATE_TEXT_MAX} characters or fewer.`;
      errEl.classList.remove("d-none");
      return;
    }

    submitBtn.disabled = true;
    try {
      await api(`/api/tasks/${taskId}/progress-updates`, {
        method: "POST",
        body: JSON.stringify({ updateType, message }),
      });
      showToast("Update posted.", "success");
      ta.value = "";
      syncProgressUpdateCharCount();
      const userId = state.user?.id;
      if (userId) await loadProgressUpdateHistory(taskId, userId);
      await loadEmployeeTasks();
      renderEmpListContentOnly();
      renderEmployeeMain();
    } catch (err) {
      errEl.textContent = err.message || "Could not post update.";
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    if (ta) ta.value = "";
    syncProgressUpdateCharCount();
    const errEl = document.getElementById("progress-update-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("d-none");
    }
    setProgressUpdateModalReadOnly(false);
  });
}

async function loadLists() {
  const { lists } = await api("/api/lists");
  state.lists = lists;
  if (!state.activeListId && lists.length) state.activeListId = lists[0].id;
}

function ownerTasksFingerprintFrom(tasks) {
  return JSON.stringify(
    (tasks ?? []).map((t) => ({
      id: t.id,
      c: t.completed,
      s: t.sortOrder,
      a: (t.assignees ?? []).map((x) => [
        x.id,
        x.assigneeDone,
        x.submissionText ?? "",
        x.completionProofUrl ?? "",
        x.progressUpdateCount ?? 0,
        x.unreadProgressUpdateCount ?? 0,
        x.latestProgressUpdate?.message ?? "",
        x.latestProgressUpdate?.createdAt ?? "",
        x.assigneeDone,
      ]),
    }))
  );
}

function captureOwnerExpandedTaskIds() {
  const ids = [];
  document.querySelectorAll(".owner-task-detail-collapse.show").forEach((el) => {
    const match = /^owner-task-detail-(.+)$/.exec(el.id || "");
    if (match) ids.push(match[1]);
  });
  return ids;
}

function restoreOwnerExpandedTaskIds(ids) {
  for (const id of ids) {
    const el = document.getElementById(`owner-task-detail-${id}`);
    if (el && !el.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(el).show();
    }
  }
}

function captureOwnerUiState() {
  const main = document.getElementById("main-column");
  return {
    expandedTaskIds: captureOwnerExpandedTaskIds(),
    quickAddTitle: document.getElementById("quick-add-title")?.value ?? "",
    scrollTop: main?.scrollTop ?? 0,
  };
}

function restoreOwnerUiState(ui) {
  if (!ui) return;
  const input = document.getElementById("quick-add-title");
  if (input && ui.quickAddTitle) input.value = ui.quickAddTitle;
  const main = document.getElementById("main-column");
  if (main && ui.scrollTop > 0) main.scrollTop = ui.scrollTop;
  restoreOwnerExpandedTaskIds(ui.expandedTaskIds);
}

function isOwnerInteractiveBusy() {
  for (const id of [
    "taskModal",
    "ownerMarkDoneModal",
    "submissionDetailModal",
    "listNameModal",
    "customRecurrenceModal",
    "teamAdminModal",
    "progressUpdateModal",
  ]) {
    const el = document.getElementById(id);
    if (el?.classList.contains("show")) return true;
  }
  return false;
}

function isOwnerSortableActive() {
  return !!document.querySelector(".sortable-ghost, .sortable-drag, .sortable-chosen");
}

function updateOwnerTasksFingerprint() {
  ownerTasksFingerprint = ownerTasksFingerprintFrom(state.tasks);
}

async function syncOwnerDashboard({ forceRender = false } = {}) {
  if (state.user?.role !== "owner") return;
  if (!state.activeListId) return;
  if (!document.getElementById("main-column")) return;
  if (!forceRender && document.hidden) return;
  if (!forceRender && (isOwnerInteractiveBusy() || isOwnerSortableActive())) return;

  const ui = forceRender ? null : captureOwnerUiState();
  try {
    const { tasks } = await api(`/api/tasks/lists/${state.activeListId}`);
    const fp = ownerTasksFingerprintFrom(tasks);
    if (!forceRender && fp === ownerTasksFingerprint) return;
    ownerTasksFingerprint = fp;
    state.tasks = tasks;
    renderOwnerMain();
    restoreOwnerUiState(ui);
  } catch {
    /* background sync — ignore transient errors */
  }
}

function onOwnerVisibilitySync() {
  if (!document.hidden) void syncOwnerDashboard();
}

function onOwnerFocusSync() {
  void syncOwnerDashboard();
}

function stopOwnerAutoSync() {
  if (ownerSyncTimer != null) {
    window.clearInterval(ownerSyncTimer);
    ownerSyncTimer = null;
  }
  document.removeEventListener("visibilitychange", onOwnerVisibilitySync);
  window.removeEventListener("focus", onOwnerFocusSync);
  ownerTasksFingerprint = "";
}

function startOwnerAutoSync() {
  stopOwnerAutoSync();
  if (state.user?.role !== "owner") return;
  updateOwnerTasksFingerprint();
  ownerSyncTimer = window.setInterval(() => {
    void syncOwnerDashboard();
  }, OWNER_SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", onOwnerVisibilitySync);
  window.addEventListener("focus", onOwnerFocusSync);
}

async function loadTasks(listId) {
  if (!listId) {
    state.tasks = [];
    updateOwnerTasksFingerprint();
    return;
  }
  const { tasks } = await api(`/api/tasks/lists/${listId}`);
  state.tasks = tasks;
  updateOwnerTasksFingerprint();
}

async function loadAssignees() {
  try {
    const { users } = await api("/api/users/assignees");
    state.assignees = users;
  } catch {
    state.assignees = [];
  }
}

function bindListNavHandlers() {
  document.querySelectorAll(".js-list-host").forEach((host) => {
    host.querySelectorAll("[data-list-id]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        if (e.target.closest(".grip-handle")) return;
        state.activeListId = btn.getAttribute("data-list-id");
        state.ownerTaskFilter = "active";
        await loadTasks(state.activeListId);
        renderOwnerMain();
        renderListContentOnly();
        initListSortable();
      });
      btn.querySelector(".list-title-edit")?.addEventListener("dblclick", async (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute("data-list-id");
        const list = state.lists.find((x) => x.id === id);
        const name = await openListNameModal({
          heading: "Rename list",
          fieldLabel: "List name",
          initialValue: list?.title || "",
        });
        if (name == null || !name.trim()) return;
        try {
          await api(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ title: name.trim() }) });
          await loadLists();
          renderOwnerChrome();
        } catch (err) {
          showToast(err.message, "danger");
        }
      });
    });
  });
}

function renderListContentOnly() {
  const html = state.lists
    .map(
      (l) => `
    <button type="button" class="list-group-item list-group-item-action owner-list-item d-flex justify-content-between align-items-center gap-2 ${
      l.id === state.activeListId ? "active" : ""
    }" data-list-id="${l.id}">
      <span class="d-flex align-items-center gap-2 min-w-0">
        <i class="bi bi-folder2${l.id === state.activeListId ? "-open" : ""} flex-shrink-0" aria-hidden="true"></i>
        <span class="text-truncate list-title-edit" title="Double-click to rename">${escapeHtml(l.title)}</span>
      </span>
      <i class="bi bi-grip-vertical grip-handle flex-shrink-0" title="Drag to reorder"></i>
    </button>`
    )
    .join("");
  document.querySelectorAll(".js-list-host").forEach((host) => {
    host.innerHTML = html;
  });
  bindListNavHandlers();
}

function renderListGroup() {
  renderListContentOnly();
  initListSortable();
}

function destroyListSortable() {
  listSortables.forEach((s) => s.destroy());
  listSortables = [];
}

function initListSortable() {
  destroyListSortable();
  if (state.lists.length < 2) return;
  document.querySelectorAll(".js-list-host").forEach((host) => {
    const s = Sortable.create(host, {
      handle: ".grip-handle",
      animation: 150,
      onEnd: async () => {
        const orderedIds = [...host.querySelectorAll("[data-list-id]")].map((el) =>
          el.getAttribute("data-list-id")
        );
        try {
          await api("/api/lists/reorder/bulk", {
            method: "PATCH",
            body: JSON.stringify({ orderedIds }),
          });
          await loadLists();
          renderListContentOnly();
          initListSortable();
        } catch (err) {
          showToast(err.message, "danger");
        }
      },
    });
    listSortables.push(s);
  });
}

function destroyTaskSortables() {
  if (taskRootSortable) {
    taskRootSortable.destroy();
    taskRootSortable = null;
  }
}

function initIncompleteSortables(listId) {
  destroyTaskSortables();
  const table = document.getElementById("owner-task-table-sort");
  if (!table || !table.querySelector("tbody.owner-task-group")) return;

  taskRootSortable = Sortable.create(table, {
    handle: ".task-grip",
    animation: 150,
    draggable: "tbody.owner-task-group",
    onEnd: async () => {
      const orderedIds = [...table.querySelectorAll("tbody.owner-task-group")].map((el) => el.getAttribute("data-task-id"));
      try {
        await api("/api/tasks/reorder/bulk", {
          method: "PATCH",
          body: JSON.stringify({ listId, orderedIds }),
        });
        await loadTasks(listId);
        renderOwnerMain();
      } catch (err) {
        showToast(err.message, "danger");
      }
    },
  });
}

function openTaskModal(task) {
  const modalEl = document.getElementById("taskModal");
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modalEl.dataset.mode = "root";
  document.getElementById("modal-task-id").value = task.id;
  document.getElementById("modal-title").value = task.title;
  document.getElementById("modal-notes").value = task.notes || "";
  fillModalDueFields(task);
  pendingCustomRecurrence =
    task.recurrence === "custom" && task.recurrenceRule && typeof task.recurrenceRule === "object"
      ? { ...task.recurrenceRule }
      : null;
  document.getElementById("modal-schedule-wrap").classList.remove("d-none");
  document.getElementById("modal-list-wrap").classList.remove("d-none");
  document.getElementById("modal-assignee-wrap").classList.remove("d-none");
  document.getElementById("modal-move-list").disabled = false;
  document.getElementById("modal-delete").classList.remove("d-none");

  fillModalAssigneeCheckboxes((task.assignees ?? []).map((a) => a.id));

  document.getElementById("modal-move-list").innerHTML = state.lists
    .map(
      (l) =>
        `<option value="${l.id}" ${l.id === task.listId ? "selected" : ""}>${escapeHtml(l.title)}</option>`
    )
    .join("");

  modal.show();
  updateModalSaveEnabled();
}

function wireTaskModal() {
  const modalEl = document.getElementById("taskModal");
  wireModalAssigneePicker();
  const saveHandler = async () => {
    const id = document.getElementById("modal-task-id").value;
    const rec = document.getElementById("modal-repeat").value;
    let recurrenceRule = null;
    if (rec === "custom") {
      if (!pendingCustomRecurrence) {
        showToast("Open Custom recurrence and tap Done to save your repeat settings.");
        return;
      }
      if (pendingCustomRecurrence.endType === "on" && !pendingCustomRecurrence.endOn) {
        showToast('Custom repeat: pick an end date for "On", or choose Never / After.', "warning");
        return;
      }
      recurrenceRule = pendingCustomRecurrence;
    }
    const dueAt = buildDueAtFromModal();
    const body = {
      title: document.getElementById("modal-title").value,
      notes: document.getElementById("modal-notes").value,
      dueAt,
      dueTimeZone: dueAt ? getBrowserDueTimeZone() : null,
      allDay: document.getElementById("modal-all-day").checked,
      recurrence: rec,
      recurrenceRule,
      assigneeIds: getSelectedAssigneeIdsFromModal(),
    };
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      const moveList = document.getElementById("modal-move-list").value;
      const task = findTaskById(id);
      if (task && moveList && moveList !== task.listId) {
        await api(`/api/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ listId: moveList }) });
        state.activeListId = moveList;
        await loadLists();
      }
      await loadTasks(state.activeListId);
      bootstrap.Modal.getInstance(modalEl).hide();
      renderOwnerChrome();
    } catch (err) {
      showToast(err.message, "danger");
    }
  };

  document.getElementById("modal-save").replaceWith(document.getElementById("modal-save").cloneNode(true));
  document.getElementById("modal-save").addEventListener("click", saveHandler);

  document.getElementById("modal-delete").replaceWith(document.getElementById("modal-delete").cloneNode(true));
  document.getElementById("modal-delete").addEventListener("click", async () => {
    const id = document.getElementById("modal-task-id").value;
    if (!window.confirm("Delete this task?")) return;
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      bootstrap.Modal.getInstance(modalEl).hide();
      await loadTasks(state.activeListId);
      renderOwnerChrome();
    } catch (err) {
      showToast(err.message, "danger");
    }
  });

  document.getElementById("modal-title").addEventListener("input", updateModalSaveEnabled);
  document.getElementById("modal-due")?.addEventListener("change", refreshModalRepeatLabels);
  document.getElementById("modal-all-day").addEventListener("change", () => {
    toggleModalTimeRow();
    refreshModalRepeatLabels();
  });
  const repeatEl = document.getElementById("modal-repeat");
  repeatEl.replaceWith(repeatEl.cloneNode(true));
  document.getElementById("modal-repeat").addEventListener("change", (e) => {
    if (e.target.value === "custom") {
      openCustomRecurrenceEditor();
    } else {
      pendingCustomRecurrence = null;
    }
  });

  updateModalSaveEnabled();
}

function ownerTaskGroupTbody(t) {
  const assignees = t.assignees ?? [];
  const nAssigned = assignees.length;
  const nDone = assignees.filter((a) => a.assigneeDone).length;
  const progressNumbers = `${nDone}\u00a0/\u00a0${nAssigned}`;
  const detailId = `owner-task-detail-${t.id}`;

  const deadlineCell = t.dueAt
    ? `<span class="text-body tabular-nums">${escapeHtml(t.dueAt.slice(0, 10))}</span>`
    : `<span class="text-muted">—</span>`;

  const notesRaw = (t.notes || "").trim().replace(/\s+/g, " ");
  const notesPreview = notesRaw.length > 100 ? `${notesRaw.slice(0, 97)}…` : notesRaw;
  const descriptionBox =
    notesPreview.length > 0
      ? `<div class="owner-task-desc-box small text-body-secondary text-truncate mb-0" title="${escapeHtml(notesRaw)}">${escapeHtml(notesPreview)}</div>`
      : `<div class="owner-task-desc-box small text-muted fst-italic mb-0">No description</div>`;

  const assigneeCards =
    assignees.length === 0
      ? `<p class="owner-assignee-empty text-muted small mb-0 px-1">No assignees yet. Edit the task to add people.</p>`
      : assignees
          .map((a) => {
            const statusClass = a.assigneeDone
              ? "owner-assignee-status--done"
              : "owner-assignee-status--pending";
            const statusLabel = a.assigneeDone ? "Submitted" : "Pending";
            const assignedByNote = a.assignedBy?.displayName
              ? `<div class="small text-muted owner-delegated-by-note">Assigned by ${escapeHtml(a.assignedBy.displayName)}</div>`
              : "";
            return `<article class="owner-team-card">
                <div class="owner-team-card-head">
                  <div class="owner-team-avatar" aria-hidden="true">${escapeHtml(assigneeInitials(a.displayName))}</div>
                  <div class="owner-team-ident min-w-0">
                    <div class="owner-team-name text-truncate">${escapeHtml(a.displayName)}</div>
                    <span class="owner-assignee-status ${statusClass}">${statusLabel}</span>
                    ${assignedByNote}
                  </div>
                </div>
                <div class="owner-team-card-grid">
                  <div class="owner-team-col owner-team-col--updates">
                    <div class="owner-team-col-head">
                      <span class="owner-team-col-label">Updates</span>
                      ${ownerUpdateTotalCountBadgeHtml(a.progressUpdateCount ?? 0)}
                    </div>
                    ${ownerAssigneeUpdatesHtml(t.id, a)}
                  </div>
                  <div class="owner-team-col owner-team-col--submission">
                    <span class="owner-team-col-label">Submission</span>
                    ${ownerAssigneeSubmissionHtml(t.id, a)}
                  </div>
                </div>
              </article>`;
          })
          .join("");

  const hasUnreadUpdates = assignees.some((a) => (a.unreadProgressUpdateCount ?? 0) > 0);
  const expandUnreadClass = hasUnreadUpdates ? " owner-task-expand-btn--unread" : "";

  const assigneeMarkDoneControl = `<div class="owner-mark-done-wrap">
      <button
        type="button"
        class="btn btn-sm btn-primary d-inline-flex align-items-center gap-2 owner-mark-done-open"
        data-task-id="${t.id}"
        aria-haspopup="dialog"
        aria-controls="ownerMarkDoneModal"
      >
        <i class="bi bi-check-lg" aria-hidden="true"></i>
        <span>Mark assignees done</span>
      </button>
    </div>`;

  const groupDone = t.completed ? "owner-task-group--completed" : "";

  return `<tbody class="owner-task-group ${groupDone}" data-task-id="${t.id}">
    <tr class="task-sort-row owner-task-row ${t.completed ? "owner-task-row--completed" : ""}" data-task-id="${t.id}">
      <td class="owner-task-cell owner-task-cell--grip text-center align-middle">
        <span class="task-grip grip-handle d-inline-flex align-items-center justify-content-center rounded p-1" title="Drag to reorder"><i class="bi bi-grip-vertical fs-5"></i></span>
      </td>
      <td class="owner-task-cell owner-task-col--task align-middle">
        <button type="button" class="btn btn-link text-start text-body fw-semibold text-decoration-none p-0 owner-task-open-details" data-open-id="${
          t.id
        }" aria-label="Open task details">${escapeHtml(t.title)}</button>
      </td>
      <td class="owner-task-cell owner-task-col--deadline align-middle small text-nowrap tabular-nums">${deadlineCell}</td>
      <td class="owner-task-cell owner-task-col--description align-middle">${descriptionBox}</td>
      <td class="owner-task-cell owner-task-col--employees align-middle text-center small tabular-nums text-nowrap">
        <span class="text-muted me-1"><i class="bi bi-people" aria-hidden="true"></i></span>${progressNumbers}
      </td>
      <td class="owner-task-cell owner-task-col--trail align-middle text-end">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary owner-task-expand-btn${expandUnreadClass}"
          data-bs-toggle="collapse"
          data-bs-target="#${detailId}"
          aria-expanded="false"
          aria-controls="${detailId}"
          aria-label="Assignees and actions${hasUnreadUpdates ? " — unread updates" : ""}"
        >
          ${hasUnreadUpdates ? `<span class="owner-task-expand-unread-dot" aria-hidden="true"></span>` : ""}
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
      </td>
    </tr>
    <tr class="owner-task-detail-row">
      <td colspan="6" class="p-0">
        <div class="collapse owner-task-detail-collapse" id="${detailId}">
          <div class="owner-task-detail-inner">
            <div class="owner-team-progress px-3 pt-3 pb-2">
              <div class="owner-team-progress-head d-flex align-items-center justify-content-between gap-2 mb-3">
                <h3 class="owner-task-detail-heading small text-secondary mb-0">Team progress</h3>
                <span class="owner-team-count-pill small tabular-nums">
                  <i class="bi bi-people me-1" aria-hidden="true"></i>${progressNumbers}
                </span>
              </div>
              <div class="owner-team-cards">${assigneeCards}</div>
              ${ownerDelegationHistoryHtml(t)}
            </div>
            <div class="px-3 py-3 mt-2 d-flex flex-wrap align-items-center justify-content-between gap-2 border-top owner-task-detail-actions">
              ${assigneeMarkDoneControl}
              <div class="d-flex align-items-center gap-1 owner-task-actions">
                <button type="button" class="owner-action-tile owner-action-tile--edit" data-open-id="${t.id}" title="Edit" aria-label="Edit task"><i class="bi bi-pencil"></i></button>
                <button type="button" class="owner-action-tile owner-action-tile--danger" data-delete-id="${t.id}" title="Delete" aria-label="Delete task"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  </tbody>`;
}

function findTaskById(id) {
  return state.tasks.find((t) => t.id === id) ?? null;
}

function renderOwnerMain() {
  const main = document.getElementById("main-column");
  if (!main) return;
  const list = state.lists.find((l) => l.id === state.activeListId);
  const listId = state.activeListId;

  const filteredTasks = ownerFilteredTasks();
  const visibleTasks = [...filteredTasks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const tbodyInner = visibleTasks.map((t) => ownerTaskGroupTbody(t)).join("");

  const metrics = ownerDashboardMetrics();
  const activeKpiClass =
    state.ownerTaskFilter === "active" ? " owner-kpi-card--active owner-kpi-card--active-primary" : "";
  const inReviewKpiClass =
    state.ownerTaskFilter === "in_review" ? " owner-kpi-card--active owner-kpi-card--active-danger" : "";
  const completedKpiClass =
    state.ownerTaskFilter === "completed" ? " owner-kpi-card--active owner-kpi-card--active-success" : "";
  const kpiRow =
    list && metrics.total > 0
      ? `<div class="row g-3 mb-4 owner-kpi-row">
          <div class="col-6 col-lg-3">
            <button type="button" class="owner-kpi-card owner-kpi-card--filter w-100 text-start${activeKpiClass}" data-owner-filter="active" aria-pressed="${state.ownerTaskFilter === "active"}">
              <div class="owner-kpi-icon text-primary"><i class="bi bi-list-task" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.active}</div>
                <div class="owner-kpi-label">Active tasks</div>
              </div>
            </button>
          </div>
          <div class="col-6 col-lg-3">
            <button type="button" class="owner-kpi-card owner-kpi-card--filter w-100 text-start${inReviewKpiClass}" data-owner-filter="in_review" aria-pressed="${state.ownerTaskFilter === "in_review"}">
              <div class="owner-kpi-icon text-danger"><i class="bi bi-chat-left-dots" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.inReview}</div>
                <div class="owner-kpi-label">In review</div>
              </div>
            </button>
          </div>
          <div class="col-6 col-lg-3">
            <button type="button" class="owner-kpi-card owner-kpi-card--filter w-100 text-start${completedKpiClass}" data-owner-filter="completed" aria-pressed="${state.ownerTaskFilter === "completed"}">
              <div class="owner-kpi-icon text-success"><i class="bi bi-check-circle" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.done}</div>
                <div class="owner-kpi-label">Completed</div>
              </div>
            </button>
          </div>
          <div class="col-6 col-lg-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-info"><i class="bi bi-collection" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.total}</div>
                <div class="owner-kpi-label">Total in list</div>
              </div>
            </div>
          </div>
        </div>`
      : "";

  const emptyMessage = !list
    ? `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-folder2-open owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">Select a list</p>
        <p class="owner-empty-desc text-muted small mb-0">Choose a list from the sidebar or create a new one.</p>
      </div>`
    : metrics.total === 0
      ? `<div class="owner-empty-state py-5 px-3">
          <i class="bi bi-clipboard2-plus owner-empty-icon text-primary" aria-hidden="true"></i>
          <p class="owner-empty-title mb-1">No tasks yet</p>
          <p class="owner-empty-desc text-muted small mb-0">Use quick add below to create the first task for this list.</p>
        </div>`
      : state.ownerTaskFilter === "completed"
        ? `<div class="owner-empty-state py-5 px-3">
            <i class="bi bi-check-circle owner-empty-icon text-success" aria-hidden="true"></i>
            <p class="owner-empty-title mb-1">No completed tasks</p>
            <p class="owner-empty-desc text-muted small mb-0">Tasks appear here after every assigned employee has submitted.</p>
          </div>`
        : state.ownerTaskFilter === "in_review"
          ? `<div class="owner-empty-state py-5 px-3">
              <i class="bi bi-chat-left-dots owner-empty-icon text-danger" aria-hidden="true"></i>
              <p class="owner-empty-title mb-1">Nothing in review</p>
              <p class="owner-empty-desc text-muted small mb-0">Tasks appear here when an employee posts a progress update and has not submitted yet.</p>
            </div>`
          : `<div class="owner-empty-state py-5 px-3">
              <i class="bi bi-check2-all owner-empty-icon text-success" aria-hidden="true"></i>
              <p class="owner-empty-title mb-1">No active tasks</p>
              <p class="owner-empty-desc text-muted small mb-0">All caught up. Click <strong>Completed</strong> above to review finished tasks.</p>
            </div>`;

  const tableBlock =
    !list || visibleTasks.length === 0
      ? emptyMessage
      : `<div class="table-responsive owner-task-table-wrap">
          <table class="table table-hover align-middle mb-0 owner-task-table" id="owner-task-table-sort">
            <thead>
              <tr>
                <th scope="col" class="owner-task-cell owner-task-cell--grip border-end-0"><span class="visually-hidden">Reorder</span></th>
                <th scope="col" class="owner-task-head owner-task-col--task">Task</th>
                <th scope="col" class="owner-task-head owner-task-col--deadline text-nowrap">Deadline</th>
                <th scope="col" class="owner-task-head">Description</th>
                <th scope="col" class="owner-task-head owner-task-col--employees text-center text-nowrap">Team</th>
                <th scope="col" class="owner-task-head owner-task-col--trail text-end"><span class="visually-hidden">Details</span></th>
              </tr>
            </thead>
            ${tbodyInner}
          </table>
        </div>`;

  main.innerHTML = `
    <header class="owner-page-header d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
      <div>
        <p class="owner-page-eyebrow mb-1">Admin dashboard</p>
        <h2 class="owner-page-title h4 mb-0">${list ? escapeHtml(list.title) : "Select a list"}</h2>
        <p class="owner-page-sub text-muted small mb-0 mt-1">Assign tasks, review progress updates, and check final submissions.</p>
      </div>
      <div class="d-flex flex-wrap gap-2 owner-toolbar">
        <button type="button" class="btn btn-outline-danger btn-sm" id="btn-delete-list" ${!list ? "disabled" : ""}>
          <i class="bi bi-trash me-1" aria-hidden="true"></i>Delete list
        </button>
      </div>
    </header>
    ${kpiRow}
    <section class="owner-task-panel" aria-label="Tasks">
      ${tableBlock}
    </section>
    <section class="owner-quick-add-bar mt-auto flex-shrink-0 ${state.ownerTaskFilter === "completed" || state.ownerTaskFilter === "in_review" ? "d-none" : ""}" aria-label="Quick add task">
      <label class="owner-quick-add-label form-label" for="quick-add-title">Quick add task</label>
      <div class="input-group">
        <span class="input-group-text"><i class="bi bi-plus-lg" aria-hidden="true"></i></span>
        <input class="form-control" id="quick-add-title" placeholder="Task title…" ${!list ? "disabled" : ""} />
        <button class="btn btn-primary px-4" type="button" id="quick-add-btn" ${!list ? "disabled" : ""}>
          <i class="bi bi-plus-circle me-1 d-none d-sm-inline" aria-hidden="true"></i>Add
        </button>
      </div>
    </section>
  `;

  document.getElementById("btn-delete-list")?.addEventListener("click", async () => {
    if (!list || !window.confirm(`Delete list "${list.title}" and all its tasks?`)) return;
    try {
      await api(`/api/lists/${list.id}`, { method: "DELETE" });
      state.activeListId = null;
      await loadLists();
      if (state.lists.length) state.activeListId = state.lists[0].id;
      await loadTasks(state.activeListId);
      renderOwnerChrome();
    } catch (err) {
      showToast(err.message, "danger");
    }
  });

  main.querySelectorAll("[data-owner-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-owner-filter");
      if (filter) setOwnerTaskFilter(filter);
    });
  });

  main.querySelectorAll(".owner-mark-done-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      if (id) openOwnerMarkDoneModal(id);
    });
  });

  main.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open-id");
      const t = findTaskById(id);
      if (t) openTaskModal(t);
    });
  });

  main.querySelectorAll(".owner-view-submission-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-view-submission-task-id");
      const userId = btn.getAttribute("data-view-submission-user-id");
      if (!taskId || !userId) return;
      void openSubmissionDetailForAssignee(taskId, userId).catch((err) => {
        showToast(err.message || "Could not load submission.", "danger");
      });
    });
  });

  main.querySelectorAll(".owner-view-progress-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-view-progress-task-id");
      const userId = btn.getAttribute("data-view-progress-user-id");
      const userName = btn.getAttribute("data-view-progress-user-name") || "";
      if (!taskId || !userId) return;
      void openProgressUpdatesForAssignee(taskId, userId, userName).catch((err) => {
        showToast(err.message || "Could not load updates.", "danger");
      });
    });
  });

  main.querySelectorAll(".owner-view-all-activity").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute("data-task-id");
      if (!taskId) return;
      void openProgressUpdatesAll(taskId).catch((err) => {
        showToast(err.message || "Could not load activity.", "danger");
      });
    });
  });

  main.querySelectorAll(".owner-task-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-expanded") === "true") return;
      const target = btn.getAttribute("data-bs-target") || "";
      const match = /^#owner-task-detail-(.+)$/.exec(target);
      if (!match) return;
      const taskId = match[1];
      const task = findTaskById(taskId);
      if (!task?.assignees?.some((a) => (a.unreadProgressUpdateCount ?? 0) > 0)) return;
      const ui = captureOwnerUiState();
      if (!ui.expandedTaskIds.includes(taskId)) ui.expandedTaskIds.push(taskId);
      void (async () => {
        try {
          await markTaskProgressUpdatesRead(taskId);
          if (state.activeListId) {
            await loadTasks(state.activeListId);
            renderOwnerMain();
            restoreOwnerUiState(ui);
          }
        } catch {
          /* ignore */
        }
      })();
    });
  });

  main.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-id");
      const t = findTaskById(id);
      if (!t || !listId) return;
      if (!window.confirm(`Delete this task?\n\n${t.title}`)) return;
      try {
        await api(`/api/tasks/${id}`, { method: "DELETE" });
        await loadTasks(listId);
        renderOwnerMain();
      } catch (err) {
        showToast(err.message, "danger");
      }
    });
  });

  async function doQuickAdd() {
    const input = document.getElementById("quick-add-title");
    const title = input.value.trim();
    if (!title || !listId) return;
    try {
      await api(`/api/tasks/lists/${listId}`, { method: "POST", body: JSON.stringify({ title }) });
      input.value = "";
      await loadTasks(listId);
      renderOwnerMain();
    } catch (err) {
      showToast(err.message, "danger");
    }
  }
  document.getElementById("quick-add-btn")?.addEventListener("click", doQuickAdd);
  document.getElementById("quick-add-title")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doQuickAdd();
    }
  });

  if (state.ownerTaskFilter === "active" && visibleTasks.length > 0) {
    initIncompleteSortables(listId);
  } else {
    destroyTaskSortables();
  }
}

function wireChromeNav() {
  document.querySelectorAll(".js-logout").forEach((b) => b.addEventListener("click", logout));
  document.querySelectorAll(".js-new-list").forEach((b) =>
    b.addEventListener("click", async () => {
      const title = await openListNameModal({
        heading: "New list",
        fieldLabel: "List name",
        initialValue: "",
      });
      if (title == null || !title.trim()) return;
      try {
        await api("/api/lists", { method: "POST", body: JSON.stringify({ title: title.trim() }) });
        await loadLists();
        state.activeListId = state.lists[state.lists.length - 1]?.id || state.activeListId;
        await loadTasks(state.activeListId);
        renderOwnerChrome();
      } catch (err) {
        showToast(err.message, "danger");
      }
    })
  );
}

function renderOwnerChrome() {
  const activeList = state.lists.find((l) => l.id === state.activeListId);
  const mobileListTitle = activeList ? escapeHtml(activeList.title) : "Lists";

  app.innerHTML = `
    <div class="owner-shell min-h-main">
      <div class="container-fluid owner-shell-inner py-3 py-lg-4 d-flex flex-column">
        <div class="owner-topbar d-lg-none d-flex align-items-center justify-content-between gap-2 mb-3">
          <button class="btn btn-outline-primary btn-sm" type="button" data-bs-toggle="offcanvas" data-bs-target="#leftNavOffcanvas" aria-label="Open lists">
            <i class="bi bi-list me-1" aria-hidden="true"></i>Lists
          </button>
          <span class="owner-topbar-title text-truncate fw-semibold small">${mobileListTitle}</span>
          <button type="button" class="btn btn-primary btn-sm js-new-list" aria-label="New list">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
          </button>
        </div>
        <div class="row g-3 g-lg-4 owner-shell-row flex-lg-grow-1">
          <aside class="col-lg-3 d-none d-lg-flex owner-sidebar-col">
            <div class="owner-sidebar-panel w-100">${leftNavInner()}</div>
          </aside>
          <div class="offcanvas offcanvas-start owner-offcanvas" tabindex="-1" id="leftNavOffcanvas" aria-labelledby="leftNavLabel">
            <div class="offcanvas-header owner-offcanvas-header border-0">
              <h2 class="offcanvas-title h5 mb-0 text-white" id="leftNavLabel">Lists</h2>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close"></button>
            </div>
            <div class="offcanvas-body pt-0">${leftNavInner()}</div>
          </div>
          <main class="col-12 col-lg-9 d-flex owner-main-col">
            <div id="main-column" class="owner-main-panel owner-main-fill p-3 p-lg-4 d-flex flex-column w-100"></div>
          </main>
        </div>
      </div>
      ${taskModalHtml()}
      ${customRecurrenceModalHtml()}
      ${listNameModalHtml()}
      ${submissionDetailModalHtml()}
      ${progressUpdateModalHtml()}
      ${ownerMarkDoneModalHtml()}
      ${teamAdminModalHtml()}
    </div>`;

  wireChromeNav();
  renderListGroup();
  renderOwnerMain();
  wireTaskModal();
  wireCustomRecurrenceModal();
  wireListNameModal();
  wireSubmissionDetailModal();
  wireProgressUpdateModal();
  wireOwnerMarkDoneModal();
  wireTeamAdminModal();
  wireThemeIconToggles();
  startOwnerAutoSync();
}

/** Optional Play Store link — set VITE_PLAY_STORE_URL at build time when published. */
function kalpanikPlayStoreUrl() {
  const url = (import.meta.env.VITE_PLAY_STORE_URL || "").trim();
  return url;
}

/** APK served from client/public/downloads/ after build — override with VITE_APK_DOWNLOAD_URL. */
function employeeApkDownloadUrl() {
  const custom = (import.meta.env.VITE_APK_DOWNLOAD_URL || "").trim();
  return custom || "/downloads/sugandh-reminder.apk";
}

function empMobileAppButtonsHtml({ block = true, size = "" } = {}) {
  const apkUrl = employeeApkDownloadUrl();
  const playStore = kalpanikPlayStoreUrl();
  const btnClass = `${block ? "w-100 " : ""}btn ${size} btn-outline-success${block ? " mb-2" : ""}`;
  const apkBtn = `<a class="${btnClass}" href="${escapeHtml(apkUrl)}" download="sugandh-reminder.apk">
        <i class="bi bi-android2 me-1" aria-hidden="true"></i>Download app (APK)
      </a>`;
  const playBtn = playStore
    ? `<a class="${block ? "w-100 " : ""}btn ${size} btn-outline-primary${block ? " mb-2" : ""}" href="${escapeHtml(playStore)}" target="_blank" rel="noopener noreferrer">
        <i class="bi bi-google-play me-1" aria-hidden="true"></i>Get on Play Store
      </a>`
    : "";
  return `${apkBtn}${playBtn}`;
}

function employeeMyAssignee(task) {
  const uid = state.user?.id;
  if (!uid) return null;
  return (task.assignees ?? []).find((a) => a.id === uid) ?? null;
}

function formatEmpDue(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function loadEmployeeTasks() {
  const { tasks } = await api("/api/tasks/assigned");
  state.empTasks = tasks;
}

async function loadEmpPeers() {
  const { users } = await api("/api/users/peers");
  state.empPeers = users ?? [];
  return state.empPeers;
}

async function openEmpCreateTaskModal() {
  const modalEl = document.getElementById("empCreateTaskModal");
  if (!modalEl) return;
  const titleInput = document.getElementById("emp-create-title");
  const notesInput = document.getElementById("emp-create-notes");
  const dueInput = document.getElementById("emp-create-due");
  const select = document.getElementById("emp-create-assignee");
  const errEl = document.getElementById("emp-create-error");
  if (!titleInput || !notesInput || !dueInput || !select || !errEl) return;

  titleInput.value = "";
  notesInput.value = "";
  dueInput.value = "";
  errEl.classList.add("d-none");
  errEl.textContent = "";
  select.innerHTML = `<option value="">Choose an employee…</option>`;

  try {
    const peers = state.empPeers?.length ? state.empPeers : await loadEmpPeers();
    peers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.displayName;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message || "Could not load employees.", "danger");
    return;
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  window.setTimeout(() => titleInput.focus(), 300);
}

function wireEmpCreateTaskModal() {
  const modalEl = document.getElementById("empCreateTaskModal");
  if (!modalEl || modalEl.dataset.wiredEmpCreate === "1") return;
  modalEl.dataset.wiredEmpCreate = "1";

  const submitBtn = document.getElementById("emp-create-submit");
  submitBtn?.addEventListener("click", async () => {
    const titleInput = document.getElementById("emp-create-title");
    const notesInput = document.getElementById("emp-create-notes");
    const dueInput = document.getElementById("emp-create-due");
    const select = document.getElementById("emp-create-assignee");
    const errEl = document.getElementById("emp-create-error");
    if (!titleInput || !notesInput || !dueInput || !select || !errEl) return;

    const title = titleInput.value.trim();
    const notes = notesInput.value.trim();
    const dueRaw = dueInput.value.trim();
    const assigneeId = select.value.trim();

    errEl.classList.add("d-none");
    errEl.textContent = "";
    if (!title) {
      errEl.textContent = "Please enter a task title.";
      errEl.classList.remove("d-none");
      return;
    }
    if (!assigneeId) {
      errEl.textContent = "Please choose an employee to assign.";
      errEl.classList.remove("d-none");
      return;
    }

    const body = { title, notes, assigneeId };
    if (dueRaw) {
      body.dueAt = new Date(dueRaw).toISOString();
      body.allDay = false;
    }

    submitBtn.disabled = true;
    try {
      await api("/api/tasks/employee-create", {
        method: "POST",
        body: JSON.stringify(body),
      });
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToast("Task created and assigned.", "success");
    } catch (err) {
      errEl.textContent = err.message || "Could not create task.";
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function openEmpDelegateModal(task) {
  const modalEl = document.getElementById("empDelegateModal");
  if (!modalEl || !task) return;
  const idInput = document.getElementById("emp-delegate-task-id");
  const titleEl = document.getElementById("emp-delegate-task-title");
  const select = document.getElementById("emp-delegate-employee");
  const errEl = document.getElementById("emp-delegate-error");
  if (!idInput || !titleEl || !select || !errEl) return;

  idInput.value = task.id;
  titleEl.textContent = task.title;
  errEl.classList.add("d-none");
  errEl.textContent = "";
  select.innerHTML = `<option value="">Choose an employee…</option>`;

  try {
    const peers = state.empPeers?.length ? state.empPeers : await loadEmpPeers();
    peers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.displayName;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message || "Could not load employees.", "danger");
    return;
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function wireEmpDelegateModal() {
  const modalEl = document.getElementById("empDelegateModal");
  if (!modalEl || modalEl.dataset.wiredEmpDelegate === "1") return;
  modalEl.dataset.wiredEmpDelegate = "1";

  const submitBtn = document.getElementById("emp-delegate-submit");
  submitBtn?.addEventListener("click", async () => {
    const idInput = document.getElementById("emp-delegate-task-id");
    const select = document.getElementById("emp-delegate-employee");
    const errEl = document.getElementById("emp-delegate-error");
    const taskId = idInput?.value?.trim();
    const employeeId = select?.value?.trim();
    if (!taskId || !select || !errEl) return;

    errEl.classList.add("d-none");
    errEl.textContent = "";
    if (!employeeId) {
      errEl.textContent = "Please choose an employee.";
      errEl.classList.remove("d-none");
      return;
    }

    submitBtn.disabled = true;
    try {
      await api(`/api/tasks/${taskId}/delegate`, {
        method: "POST",
        body: JSON.stringify({ employeeId }),
      });
      bootstrap.Modal.getInstance(modalEl)?.hide();
      showToast("Task assigned to colleague.", "success");
      await loadEmployeeTasks();
      renderEmpListContentOnly();
      renderEmployeeMain();
    } catch (err) {
      errEl.textContent = err.message || "Could not assign task.";
      errEl.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function employeeDashboardMetrics() {
  const tasks = state.empTasks;
  const active = tasks.filter((t) => !employeeMyAssignee(t)?.assigneeDone).length;
  const done = tasks.filter((t) => employeeMyAssignee(t)?.assigneeDone).length;
  const now = Date.now();
  const dueSoon = tasks.filter((t) => {
    if (!t.dueAt || employeeMyAssignee(t)?.assigneeDone) return false;
    const due = new Date(t.dueAt).getTime();
    return Number.isFinite(due) && due > now && due - now < 24 * 60 * 60 * 1000;
  }).length;
  return { total: tasks.length, active, done, dueSoon };
}

function empFilterLabel(filter) {
  if (filter === "submitted") return "Submitted tasks";
  if (filter === "all") return "All assigned tasks";
  return "Active tasks";
}

function empFilteredTasks() {
  if (state.empFilter === "submitted") {
    return state.empTasks.filter((t) => employeeMyAssignee(t)?.assigneeDone);
  }
  if (state.empFilter === "all") return state.empTasks;
  return state.empTasks.filter((t) => !employeeMyAssignee(t)?.assigneeDone);
}

function empTaskTableRows(tasks) {
  const emptyCopy =
    state.empFilter === "submitted"
      ? { icon: "check-circle", title: "Nothing submitted yet", desc: "Tasks you complete will appear here." }
      : state.empFilter === "all"
        ? { icon: "folder2-open", title: "No assigned tasks", desc: "When your manager assigns work, it will show up here." }
        : { icon: "clipboard2-plus", title: "No active tasks", desc: "You are all caught up — check Submitted for completed work." };

  if (!tasks.length) {
    return `<tbody class="owner-task-empty"><tr><td colspan="5">
      <div class="owner-empty-state py-5 px-3">
        <i class="bi bi-${emptyCopy.icon} owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">${emptyCopy.title}</p>
        <p class="owner-empty-desc text-muted small mb-0">${emptyCopy.desc}</p>
      </div>
    </td></tr></tbody>`;
  }

  return `<tbody>${tasks
    .map((t) => {
      const me = employeeMyAssignee(t);
      const submitted = me?.assigneeDone ?? false;
      const hasSubmission = assigneeHasSubmission(me);
      const notesRaw = (t.notes || "").trim().replace(/\s+/g, " ");
      const notesPreview = notesRaw.length > 100 ? `${notesRaw.slice(0, 97)}…` : notesRaw;
      const descriptionBox =
        notesPreview.length > 0
          ? `<div class="owner-task-desc-box small text-body-secondary text-truncate mb-0" title="${escapeHtml(notesRaw)}">${escapeHtml(notesPreview)}</div>`
          : `<div class="owner-task-desc-box small text-muted fst-italic mb-0">No description</div>`;
      const updateCount = me?.progressUpdateCount ?? 0;
      const updateBadge =
        updateCount > 0
          ? `<span class="badge rounded-pill text-bg-secondary ms-1 tabular-nums">${updateCount}</span>`
          : "";
      const submissionBtn =
        submitted && hasSubmission
          ? `<button type="button" class="btn btn-sm btn-outline-primary emp-view-submission" data-task-id="${t.id}" data-user-id="${escapeHtml(state.user?.id || "")}"><i class="bi bi-eye me-1" aria-hidden="true"></i>View</button>`
          : `<button type="button" class="btn btn-sm btn-primary emp-open-submit" data-task-id="${t.id}"><i class="bi bi-send me-1" aria-hidden="true"></i>Submit</button>`;
      const assignedByLine = me?.assignedBy?.displayName
        ? `<div class="small text-muted emp-assigned-by-line mt-1">From ${escapeHtml(me.assignedBy.displayName)}</div>`
        : "";
      const delegateBtn = !submitted
        ? `<button type="button" class="btn btn-sm btn-outline-info emp-open-delegate" data-task-id="${t.id}"><i class="bi bi-person-plus me-1" aria-hidden="true"></i>Assign</button>`
        : "";
      const submissionCell = `<div class="d-flex flex-column align-items-end gap-1 emp-task-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary emp-open-progress-update" data-task-id="${t.id}">
            <i class="bi bi-chat-left-dots me-1" aria-hidden="true"></i>Update${updateBadge}
          </button>
          ${delegateBtn}
          ${submissionBtn}
        </div>`;
      const rowDone = submitted ? "owner-task-row--completed" : "";
      const deadlineDisplay = t.dueAt
        ? `<span class="text-body tabular-nums emp-deadline-full d-none d-md-inline">${escapeHtml(
            formatEmpDue(t.dueAt)
          )}</span><span class="text-body tabular-nums emp-deadline-short d-md-none">${escapeHtml(
            t.dueAt.slice(0, 10)
          )}</span>`
        : `<span class="text-muted">—</span>`;
      return `<tr class="owner-task-row emp-task-row ${rowDone}" data-task-id="${t.id}">
        <td class="owner-task-cell emp-col-check text-center align-middle">
          <input type="checkbox" class="form-check-input emp-task-check" data-task-id="${t.id}" ${
        submitted ? "checked" : ""
      } aria-label="Mark ${escapeHtml(t.title)} submitted" />
        </td>
        <td class="owner-task-cell owner-task-col--task emp-col-task align-middle">
          <span class="fw-semibold emp-task-title ${submitted ? "text-muted text-decoration-line-through" : ""}">${escapeHtml(t.title)}</span>
          ${assignedByLine}
        </td>
        <td class="owner-task-cell owner-task-col--deadline emp-col-deadline align-middle small">${deadlineDisplay}</td>
        <td class="owner-task-cell emp-col-desc align-middle">${descriptionBox}</td>
        <td class="owner-task-cell emp-col-proof text-end align-middle">${submissionCell}</td>
      </tr>`;
    })
    .join("")}</tbody>`;
}

function empLeftNavInner() {
  const displayName = state.user ? escapeHtml(state.user.displayName) : "";
  const metrics = employeeDashboardMetrics();
  const appBtn = empMobileAppButtonsHtml();

  return `
    <div class="owner-sidebar d-flex flex-column h-100">
      <div class="owner-sidebar-brand">
        <div class="owner-sidebar-brand-icon" aria-hidden="true"><i class="bi bi-person-workspace"></i></div>
        <div class="min-w-0">
          <div class="owner-sidebar-brand-title">Task Manager</div>
          <div class="owner-sidebar-brand-user text-truncate">${displayName}</div>
          <span class="badge rounded-pill emp-role-badge mt-1">Employee</span>
        </div>
      </div>
      <button type="button" class="btn btn-primary w-100 owner-sidebar-new-list js-emp-create-task">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Create & assign task
      </button>
      <button type="button" class="btn btn-outline-primary w-100 mb-2 js-emp-refresh">
        <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh tasks
      </button>
      <p class="owner-sidebar-label mb-2">My work</p>
      <div class="list-group list-group-flush flex-grow-1 overflow-auto owner-list-nav js-emp-nav-host"></div>
      <div class="owner-sidebar-footer">
        ${empRemindersButtonHtml()}
        ${appBtn}
        <div class="d-flex justify-content-center mb-2">${themeIconToggleMarkup()}</div>
        <button type="button" class="btn btn-outline-danger w-100 js-logout">
          <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i>Sign out
        </button>
      </div>
    </div>`;
}

function syncEmpTopbarTitle() {
  const title = empFilterLabel(state.empFilter);
  document.querySelectorAll(".owner-topbar-title").forEach((el) => {
    el.textContent = title;
  });
}

function renderEmpMobileFilters() {
  const host = document.getElementById("emp-mobile-filters");
  if (!host) return;
  const metrics = employeeDashboardMetrics();
  const filters = [
    { id: "active", label: "Active", count: metrics.active },
    { id: "submitted", label: "Submitted", count: metrics.done },
    { id: "all", label: "All", count: metrics.total },
  ];
  host.innerHTML = filters
    .map((f) => {
      const active = state.empFilter === f.id;
      return `<button type="button" class="btn btn-sm emp-filter-chip ${
        active ? "btn-primary" : "btn-outline-primary"
      }" data-emp-filter="${f.id}">
        ${f.label}
        <span class="badge rounded-pill ms-1 ${
          active ? "text-bg-light" : "bg-body-secondary text-body border"
        } tabular-nums">${f.count}</span>
      </button>`;
    })
    .join("");
  host.querySelectorAll("[data-emp-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.empFilter = btn.getAttribute("data-emp-filter") || "active";
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmpTopbarTitle();
      const offcanvas = document.getElementById("empNavOffcanvas");
      if (offcanvas) bootstrap.Offcanvas.getInstance(offcanvas)?.hide();
    });
  });
}

function renderEmpListContentOnly() {
  const metrics = employeeDashboardMetrics();
  const filters = [
    { id: "active", label: "Active tasks", icon: "list-task", count: metrics.active },
    { id: "submitted", label: "Submitted", icon: "check-circle", count: metrics.done },
    { id: "all", label: "All assigned", icon: "collection", count: metrics.total },
  ];
  const html = filters
    .map((f) => {
      const active = state.empFilter === f.id;
      const icon =
        f.id === "submitted"
          ? active
            ? "bi-check-circle-fill"
            : "bi-check-circle"
          : f.id === "all"
            ? "bi-collection"
            : "bi-list-task";
      return `
    <button type="button" class="list-group-item list-group-item-action owner-list-item d-flex justify-content-between align-items-center gap-2 ${
      active ? "active" : ""
    }" data-emp-filter="${f.id}">
      <span class="d-flex align-items-center gap-2 min-w-0">
        <i class="bi ${icon} flex-shrink-0" aria-hidden="true"></i>
        <span class="text-truncate">${f.label}</span>
      </span>
      <span class="badge rounded-pill bg-body-secondary text-body border tabular-nums flex-shrink-0">${f.count}</span>
    </button>`;
    })
    .join("");
  document.querySelectorAll(".js-emp-nav-host").forEach((host) => {
    host.innerHTML = html;
  });
  bindEmpNavHandlers();
  renderEmpMobileFilters();
}

function bindEmpNavHandlers() {
  document.querySelectorAll(".js-emp-nav-host [data-emp-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.empFilter = btn.getAttribute("data-emp-filter") || "active";
      renderEmpListContentOnly();
      renderEmployeeMain();
      syncEmpTopbarTitle();
      const offcanvas = document.getElementById("empNavOffcanvas");
      if (offcanvas) bootstrap.Offcanvas.getInstance(offcanvas)?.hide();
    });
  });
}

function wireEmpChromeNav() {
  document.querySelectorAll(".js-logout").forEach((b) => b.addEventListener("click", logout));
  wireEmpEnablePush();
  document.querySelectorAll(".js-emp-create-task").forEach((b) =>
    b.addEventListener("click", () => void openEmpCreateTaskModal())
  );
  document.querySelectorAll(".js-emp-refresh").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await loadEmployeeTasks();
        renderEmpListContentOnly();
        renderEmployeeMain();
        showToast("Tasks refreshed.", "success");
      } catch (err) {
        showToast(err.message, "danger");
      } finally {
        b.disabled = false;
      }
    })
  );
  wireThemeIconToggles();
}

function renderEmployeeMain() {
  const main = document.getElementById("emp-main-column");
  if (!main) return;

  const metrics = employeeDashboardMetrics();
  const filtered = empFilteredTasks();
  const filterTitle = empFilterLabel(state.empFilter);
  const tableBody = empTaskTableRows(filtered);

  const kpiRow =
    metrics.total > 0
      ? `<div class="row g-3 mb-4 owner-kpi-row">
          <div class="col-6 col-xl-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-primary"><i class="bi bi-list-task" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.active}</div>
                <div class="owner-kpi-label">Active tasks</div>
              </div>
            </div>
          </div>
          <div class="col-6 col-xl-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-success"><i class="bi bi-check-circle" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.done}</div>
                <div class="owner-kpi-label">Submitted</div>
              </div>
            </div>
          </div>
          <div class="col-6 col-xl-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-warning"><i class="bi bi-alarm" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.dueSoon}</div>
                <div class="owner-kpi-label">Due in 24h</div>
              </div>
            </div>
          </div>
          <div class="col-6 col-xl-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-info"><i class="bi bi-collection" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.total}</div>
                <div class="owner-kpi-label">Total assigned</div>
              </div>
            </div>
          </div>
        </div>`
      : "";

  main.innerHTML = `
    <header class="owner-page-header emp-page-header d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3 mb-md-4">
      <div class="min-w-0">
        <p class="owner-page-eyebrow mb-1 d-none d-md-block">Employee dashboard</p>
        <h2 class="owner-page-title h4 mb-0 text-truncate d-none d-md-block">${escapeHtml(filterTitle)}</h2>
        <p class="owner-page-sub text-muted small mb-0 mt-1 d-none d-md-block">Post progress updates while you work, then submit with notes and/or an image when done.</p>
      </div>
      <div class="d-none d-md-flex flex-wrap gap-2 owner-toolbar">
        <button type="button" class="btn btn-primary btn-sm js-emp-create-task">
          <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Create & assign
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm js-emp-refresh">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>
    </header>
    ${kpiRow}
    <section class="owner-task-panel" aria-label="Assigned tasks">
      <div class="table-responsive owner-task-table-wrap">
        <table class="table table-hover align-middle mb-0 owner-task-table emp-owner-task-table">
          <thead>
            <tr>
              <th scope="col" class="owner-task-head text-center" style="width:3rem;"><span class="visually-hidden">Done</span></th>
              <th scope="col" class="owner-task-head owner-task-col--task">Task</th>
              <th scope="col" class="owner-task-head owner-task-col--deadline text-nowrap">Deadline</th>
              <th scope="col" class="owner-task-head">Description</th>
              <th scope="col" class="owner-task-head text-end" style="width:9rem;">Actions</th>
            </tr>
          </thead>
          ${tableBody}
        </table>
      </div>
    </section>
  `;

  main.querySelectorAll(".emp-task-check").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const id = cb.getAttribute("data-task-id");
      if (!id) return;
      const task = state.empTasks.find((t) => t.id === id);
      const completed = cb.checked;
      const me = employeeMyAssignee(task);

      if (completed && !assigneeHasSubmission(me)) {
        cb.checked = false;
        if (task) openEmpSubmissionModal(task);
        return;
      }

      if (!completed) {
        const ok = window.confirm("Remove this submission and mark the task as not submitted?");
        if (!ok) {
          cb.checked = true;
          return;
        }
      }

      cb.disabled = true;
      try {
        await api(`/api/tasks/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ completed }),
        });
        if (completed && task?.dueAt) clearReminderForTask(id, task.dueAt);
        await loadEmployeeTasks();
        renderEmpListContentOnly();
        renderEmployeeMain();
      } catch (err) {
        showToast(err.message, "danger");
        cb.checked = !completed;
        cb.disabled = false;
      }
    });
  });

  main.querySelectorAll(".js-emp-refresh").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await loadEmployeeTasks();
        renderEmpListContentOnly();
        renderEmployeeMain();
        showToast("Tasks refreshed.", "success");
      } catch (err) {
        showToast(err.message, "danger");
      } finally {
        btn.disabled = false;
      }
    });
  });

  main.querySelectorAll(".js-emp-create-task").forEach((btn) => {
    btn.addEventListener("click", () => void openEmpCreateTaskModal());
  });

  main.querySelectorAll(".emp-open-submit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      const task = state.empTasks.find((t) => t.id === id);
      if (task) openEmpSubmissionModal(task);
    });
  });

  main.querySelectorAll(".emp-open-progress-update").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      const task = state.empTasks.find((t) => t.id === id);
      if (task) void openEmpProgressUpdateModal(task);
    });
  });

  main.querySelectorAll(".emp-open-delegate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      const task = state.empTasks.find((t) => t.id === id);
      if (task) void openEmpDelegateModal(task);
    });
  });

  main.querySelectorAll(".emp-view-submission").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-task-id");
      const userId = btn.getAttribute("data-user-id") || state.user?.id;
      if (!taskId || !userId) return;
      void openSubmissionDetailForAssignee(taskId, userId).catch((err) => {
        showToast(err.message || "Could not load submission.", "danger");
      });
    });
  });
}

function renderEmployeeChrome() {
  const filterTitle = empFilterLabel(state.empFilter);

  app.innerHTML = `
    <div class="owner-shell emp-shell min-h-main">
      <div class="container-fluid owner-shell-inner py-2 py-md-3 py-lg-4 d-flex flex-column">
        <div class="owner-topbar d-lg-none d-flex align-items-center justify-content-between gap-2 mb-2">
          <button class="btn btn-outline-primary btn-sm" type="button" data-bs-toggle="offcanvas" data-bs-target="#empNavOffcanvas" aria-label="Open menu">
            <i class="bi bi-list me-1" aria-hidden="true"></i>Menu
          </button>
          <span class="owner-topbar-title text-truncate fw-semibold small">${escapeHtml(filterTitle)}</span>
          <button type="button" class="btn btn-primary btn-sm js-emp-refresh" aria-label="Refresh tasks">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>
        </div>
        <div id="emp-mobile-filters" class="emp-mobile-filters d-lg-none mb-2" aria-label="Task filters"></div>
        <div class="row g-2 g-md-3 g-lg-4 owner-shell-row flex-lg-grow-1">
          <aside class="col-lg-3 d-none d-lg-flex owner-sidebar-col">
            <div class="owner-sidebar-panel sticky-lg-top w-100">${empLeftNavInner()}</div>
          </aside>
          <div class="offcanvas offcanvas-start owner-offcanvas emp-offcanvas" tabindex="-1" id="empNavOffcanvas" aria-labelledby="empNavLabel">
            <div class="offcanvas-header owner-offcanvas-header border-0">
              <h2 class="offcanvas-title h5 mb-0 text-white" id="empNavLabel">My work</h2>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close"></button>
            </div>
            <div class="offcanvas-body pt-0">${empLeftNavInner()}</div>
          </div>
          <main class="col-12 col-lg-9 d-flex owner-main-col">
            <div id="emp-main-column" class="owner-main-panel owner-main-fill p-2 p-sm-3 p-lg-4 d-flex flex-column w-100"></div>
          </main>
        </div>
      </div>
      ${submissionDetailModalHtml()}
      ${empSubmissionModalHtml()}
      ${progressUpdateModalHtml()}
      ${empDelegateModalHtml()}
      ${empCreateTaskModalHtml()}
    </div>`;

  wireEmpChromeNav();
  renderEmpListContentOnly();
  wireSubmissionDetailModal();
  wireEmpSubmissionModal();
  wireProgressUpdateModal();
  wireEmpDelegateModal();
  wireEmpCreateTaskModal();
  renderEmployeeMain();
}

async function render() {
  const ok = await refreshMe();
  if (!ok || !state.user) {
    const notify = getEmployeeNotifyParams();
    if (notify) {
      sessionStorage.setItem("taskmgr-pending-notify", JSON.stringify(notify));
      window.history.replaceState({}, "", window.location.pathname);
    }
    renderAuthForm();
    return;
  }
  if (state.user.role === "employee") {
    const welcome = sessionStorage.getItem("taskmgr-app-welcome");
    if (welcome) {
      sessionStorage.removeItem("taskmgr-app-welcome");
      showToast("Welcome! Your assigned tasks are below.", "success");
    }
    await loadEmployeeTasks();
    renderEmployeeChrome();
    startEmployeeReminderSystem();
    void prepareEmployeePushOnLogin();
    await handleEmployeeNotifyDeepLink();
    const pendingNotify = sessionStorage.getItem("taskmgr-pending-notify");
    if (pendingNotify) {
      sessionStorage.removeItem("taskmgr-pending-notify");
      try {
        await focusEmployeeTaskFromNotify(JSON.parse(pendingNotify));
      } catch {
        /* ignore */
      }
    }
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.update();
      });
    }
    return;
  }
  await loadLists();
  await loadAssignees();
  await loadTasks(state.activeListId);
  renderOwnerChrome();
}

initTheme();
render().catch((e) => {
  console.error(e);
  showToast(String(e.message || e), "danger");
});
