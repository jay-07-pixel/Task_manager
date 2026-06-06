import "./scss/styles.scss";
import * as bootstrap from "bootstrap";
import Sortable from "sortablejs";

const app = document.getElementById("app");
const toastHost = document.getElementById("toastHost");

/** @type {any} */
let state = {
  user: null,
  lists: [],
  activeListId: null,
  tasks: [],
  assignees: [],
};

/** @type {any[]} */
let listSortables = [];
let taskRootSortable = null;

/** @type {Record<string, any> | null} */
let pendingCustomRecurrence = null;

/** @type {((value: string | null) => void) | null} */
let listNameResolve = null;

const THEME_STORAGE_KEY = "task-manager-theme";

function getStoredTheme() {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "dark") return "dark";
  return "light";
}

function effectiveTheme() {
  return getStoredTheme();
}

function applyTheme() {
  document.documentElement.setAttribute("data-bs-theme", effectiveTheme());
}

function setThemePreference(mode) {
  if (mode !== "light" && mode !== "dark") return;
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme();
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
                  <div class="alert alert-primary border-0 py-2 px-3 mb-3 auth-login-hint" role="note">
                    <div class="d-flex gap-2 align-items-start small mb-0">
                      <i class="bi bi-phone flex-shrink-0 text-primary" aria-hidden="true"></i>
                      <span><strong>Employees</strong> — after sign-in you&rsquo;ll be directed to the <strong>Kalpanik Reminder</strong> app for tasks. <strong>Owners</strong> use this dashboard.</span>
                    </div>
                  </div>
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
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  state.user = null;
  renderAuthForm();
}

function ownerDashboardMetrics() {
  const tasks = state.tasks;
  const active = tasks.filter((t) => !t.completed).length;
  const done = tasks.filter((t) => t.completed).length;
  let pendingAssignees = 0;
  for (const t of tasks) {
    for (const a of t.assignees ?? []) {
      if (!a.assigneeDone) pendingAssignees += 1;
    }
  }
  return { total: tasks.length, active, done, pendingAssignees };
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

function taskProofOnlyModalHtml() {
  return `
    <div class="modal fade" id="taskProofOnlyModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl modal-fullscreen-lg-down">
        <div class="modal-content bg-black border-0">
          <button type="button" class="btn-close btn-close-white position-absolute top-0 end-0 m-3 z-3" data-bs-dismiss="modal" aria-label="Close"></button>
          <div class="modal-body p-0 d-flex align-items-center justify-content-center bg-black">
            <img id="task-proof-only-img" src="" class="w-100" style="max-height: min(92vh, 920px); object-fit: contain;" alt="Completion proof" />
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

async function openProofImageModal(proofUrl, altLabel) {
  if (!proofUrl) return;
  const img = document.getElementById("task-proof-only-img");
  const modalEl = document.getElementById("taskProofOnlyModal");
  if (!img || !modalEl) return;
  img.removeAttribute("src");
  img.alt = altLabel || "Submission";
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  try {
    img.src = await fetchProofBlobUrl(proofUrl);
  } catch (err) {
    modal.hide();
    showToast(err.message || "Could not load proof image.", "danger");
  }
}

function wireTaskProofOnlyModal() {
  const modalEl = document.getElementById("taskProofOnlyModal");
  if (!modalEl || modalEl.dataset.wiredProof === "1") return;
  modalEl.dataset.wiredProof = "1";
  modalEl.addEventListener("hidden.bs.modal", () => {
    const img = document.getElementById("task-proof-only-img");
    if (img?.src?.startsWith("blob:")) {
      URL.revokeObjectURL(img.src);
      proofBlobUrls.delete(img.src);
    }
    if (img) img.removeAttribute("src");
  });
}

async function loadLists() {
  const { lists } = await api("/api/lists");
  state.lists = lists;
  if (!state.activeListId && lists.length) state.activeListId = lists[0].id;
}

async function loadTasks(listId) {
  if (!listId) {
    state.tasks = [];
    return;
  }
  const { tasks } = await api(`/api/tasks/lists/${listId}`);
  state.tasks = tasks;
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

  const assigneePanelRows =
    assignees.length === 0
      ? `<tr><td colspan="3" class="text-muted small py-3 px-3">No assignees yet. Edit the task to add people.</td></tr>`
      : assignees
          .map((a) => {
            const proofCell = a.completionProofUrl
              ? `<button type="button" class="btn btn-sm btn-outline-primary owner-assignee-proof-btn" data-proof-url="${escapeHtml(
                  a.completionProofUrl
                )}" title="View submission" aria-label="View submission for ${escapeHtml(a.displayName)}"><i class="bi bi-eye me-1" aria-hidden="true"></i>View</button>`
              : `<span class="text-muted">—</span>`;
            const doneLabel = a.assigneeDone
              ? `<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle owner-assignee-status-badge">Submitted</span>`
              : `<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle owner-assignee-status-badge">Pending</span>`;
            return `<tr>
              <td class="px-3 py-2 fw-medium">${escapeHtml(a.displayName)}</td>
              <td class="px-3 py-2 text-center">${doneLabel}</td>
              <td class="px-3 py-2 text-end">${proofCell}</td>
            </tr>`;
          })
          .join("");

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
          class="btn btn-sm btn-outline-primary owner-task-expand-btn"
          data-bs-toggle="collapse"
          data-bs-target="#${detailId}"
          aria-expanded="false"
          aria-controls="${detailId}"
          aria-label="Assignees and actions"
        >
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
      </td>
    </tr>
    <tr class="owner-task-detail-row">
      <td colspan="6" class="p-0">
        <div class="collapse owner-task-detail-collapse" id="${detailId}">
          <div class="owner-task-detail-inner">
            <div class="px-3 pt-3">
              <h3 class="owner-task-detail-heading small text-secondary mb-2">Assignees</h3>
              <div class="table-responsive rounded border bg-body-secondary">
                <table class="table table-hover align-middle mb-0 owner-assignee-panel-table">
                  <thead class="table-light">
                    <tr>
                      <th scope="col" class="px-3 py-2">Employee</th>
                      <th scope="col" class="px-3 py-2 text-center" style="width: 7.5rem;">Status</th>
                      <th scope="col" class="px-3 py-2 text-end" style="width: 6.5rem;">Proof</th>
                    </tr>
                  </thead>
                  <tbody>${assigneePanelRows}</tbody>
                </table>
              </div>
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

  const allTasks = [...state.tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  const tbodyInner = allTasks.map((t) => ownerTaskGroupTbody(t)).join("");

  const metrics = ownerDashboardMetrics();
  const kpiRow =
    list && metrics.total > 0
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
                <div class="owner-kpi-label">Completed</div>
              </div>
            </div>
          </div>
          <div class="col-6 col-xl-3">
            <div class="owner-kpi-card">
              <div class="owner-kpi-icon text-warning"><i class="bi bi-hourglass-split" aria-hidden="true"></i></div>
              <div>
                <div class="owner-kpi-value tabular-nums">${metrics.pendingAssignees}</div>
                <div class="owner-kpi-label">Pending submissions</div>
              </div>
            </div>
          </div>
          <div class="col-6 col-xl-3">
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

  const emptyMessage = list
    ? `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-clipboard2-plus owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">No tasks yet</p>
        <p class="owner-empty-desc text-muted small mb-0">Use quick add below to create the first task for this list.</p>
      </div>`
    : `<div class="owner-empty-state py-5 px-3">
        <i class="bi bi-folder2-open owner-empty-icon text-primary" aria-hidden="true"></i>
        <p class="owner-empty-title mb-1">Select a list</p>
        <p class="owner-empty-desc text-muted small mb-0">Choose a list from the sidebar or create a new one.</p>
      </div>`;

  const tableBlock =
    !list || allTasks.length === 0
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
        <p class="owner-page-sub text-muted small mb-0 mt-1">Assign tasks, track submissions, and review proof photos.</p>
      </div>
      <div class="d-flex flex-wrap gap-2 owner-toolbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-clear-completed" ${!list ? "disabled" : ""}>
          <i class="bi bi-archive me-1" aria-hidden="true"></i>Clear completed
        </button>
        <button type="button" class="btn btn-outline-danger btn-sm" id="btn-delete-list" ${!list ? "disabled" : ""}>
          <i class="bi bi-trash me-1" aria-hidden="true"></i>Delete list
        </button>
      </div>
    </header>
    ${kpiRow}
    <section class="owner-task-panel owner-task-panel--grow" aria-label="Tasks">
      ${tableBlock}
    </section>
    <section class="owner-quick-add-bar mt-3 mt-lg-4 flex-shrink-0" aria-label="Quick add task">
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

  document.getElementById("btn-clear-completed")?.addEventListener("click", async () => {
    if (!listId || !window.confirm("Remove all completed tasks in this list?")) return;
    try {
      await api(`/api/tasks/lists/${listId}/clear-completed`, { method: "POST" });
      await loadTasks(listId);
      renderOwnerMain();
    } catch (err) {
      showToast(err.message, "danger");
    }
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

  main.querySelectorAll("[data-proof-url]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-proof-url");
      const label = btn.getAttribute("aria-label") || "Submission";
      openProofImageModal(url, label);
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

  initIncompleteSortables(listId);
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
      ${taskProofOnlyModalHtml()}
      ${ownerMarkDoneModalHtml()}
    </div>`;

  wireChromeNav();
  renderListGroup();
  renderOwnerMain();
  wireTaskModal();
  wireCustomRecurrenceModal();
  wireListNameModal();
  wireTaskProofOnlyModal();
  wireOwnerMarkDoneModal();
  wireThemeIconToggles();
}

/** Optional Play Store link — set VITE_PLAY_STORE_URL at build time when published. */
function kalpanikPlayStoreUrl() {
  const url = (import.meta.env.VITE_PLAY_STORE_URL || "").trim();
  return url;
}

function renderEmployeeAppRedirect({ justRegistered = false } = {}) {
  const name = state.user?.displayName ? escapeHtml(state.user.displayName) : "there";
  const email = state.user?.email ? escapeHtml(state.user.email) : "";
  const playStore = kalpanikPlayStoreUrl();

  const welcomeAlert = justRegistered
    ? `<div class="alert alert-success d-flex align-items-start gap-2 mb-4 py-2 px-3" role="status">
        <i class="bi bi-check-circle-fill flex-shrink-0 mt-1" aria-hidden="true"></i>
        <div class="small mb-0"><strong>Account created.</strong> You can sign in on the app with the same email and password.</div>
      </div>`
    : "";

  const installCta = playStore
    ? `<a class="btn btn-primary btn-lg w-100 app-redirect-cta" href="${escapeHtml(playStore)}" target="_blank" rel="noopener noreferrer">
        <i class="bi bi-google-play me-2" aria-hidden="true"></i>Get Kalpanik Reminder
      </a>`
    : `<div class="app-redirect-install-hint rounded-3 p-3 text-center mb-0">
        <i class="bi bi-download text-primary fs-4 d-block mb-2" aria-hidden="true"></i>
        <p class="small fw-semibold mb-1">Install the app</p>
        <p class="small text-muted mb-0">Ask your administrator for the Kalpanik Reminder Android app, then sign in with <strong>${email || "your account email"}</strong>.</p>
      </div>`;

  app.innerHTML = `
    <div class="auth-page app-redirect-page">
      <div class="container px-3">
        <div class="auth-wrap app-redirect-wrap">
          <div class="card auth-card">
            <div class="auth-card-head">
              <div class="auth-brand-row">
                <div class="auth-brand-icon" aria-hidden="true"><i class="bi bi-phone-fill"></i></div>
                <div>
                  <div class="auth-brand-title text-white">Kalpanik Reminder</div>
                  <p class="auth-brand-sub text-white mb-0">Assigned tasks, proof photos, and alarms — on your phone.</p>
                </div>
              </div>
            </div>
            <div class="auth-card-body app-redirect-body">
              ${welcomeAlert}
              <div class="app-redirect-hero text-center mb-4">
                <div class="app-redirect-icon-ring mx-auto mb-3" aria-hidden="true">
                  <i class="bi bi-bell-fill"></i>
                </div>
                <h1 class="h5 fw-semibold mb-1">${justRegistered ? "You&rsquo;re all set" : `Hello, ${name}`}</h1>
                <p class="text-muted small mb-0">Use the mobile app for daily task work. This website is only for signing up and admin.</p>
              </div>

              <p class="app-redirect-steps-label">Next steps</p>
              <ol class="list-group list-group-numbered app-redirect-steps mb-4">
                <li class="list-group-item">Install <strong>Kalpanik Reminder</strong> on your phone</li>
                <li class="list-group-item">Sign in with your account${email ? ` — <span class="text-primary fw-medium">${email}</span>` : ""}</li>
                <li class="list-group-item">Complete tasks and upload proof when your manager asks</li>
              </ol>

              <div class="row g-2 mb-4 app-redirect-features">
                <div class="col-6">
                  <div class="app-redirect-feature">
                    <i class="bi bi-list-check text-primary" aria-hidden="true"></i>
                    <span>Assigned tasks</span>
                  </div>
                </div>
                <div class="col-6">
                  <div class="app-redirect-feature">
                    <i class="bi bi-camera text-primary" aria-hidden="true"></i>
                    <span>Proof upload</span>
                  </div>
                </div>
                <div class="col-6">
                  <div class="app-redirect-feature">
                    <i class="bi bi-alarm text-primary" aria-hidden="true"></i>
                    <span>Due reminders</span>
                  </div>
                </div>
                <div class="col-6">
                  <div class="app-redirect-feature">
                    <i class="bi bi-headset text-primary" aria-hidden="true"></i>
                    <span>Support</span>
                  </div>
                </div>
              </div>

              <div class="mb-4">${installCta}</div>

              <div class="alert alert-primary border-0 app-redirect-note mb-0" role="note">
                <div class="d-flex gap-2">
                  <i class="bi bi-info-circle flex-shrink-0" aria-hidden="true"></i>
                  <p class="small mb-0">Owners manage lists and review proof on this website. Employees do not use the web dashboard.</p>
                </div>
              </div>

              <div class="auth-theme-row app-redirect-footer d-flex flex-column flex-sm-row align-items-center justify-content-between gap-3">
                ${themeIconToggleMarkup()}
                <button type="button" class="btn btn-outline-danger w-100 w-sm-auto js-logout">
                  <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i>Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.querySelectorAll(".js-logout").forEach((b) => b.addEventListener("click", logout));
  wireThemeIconToggles();
}

async function render() {
  const ok = await refreshMe();
  if (!ok || !state.user) {
    renderAuthForm();
    return;
  }
  if (state.user.role === "employee") {
    const welcome = sessionStorage.getItem("taskmgr-app-welcome");
    if (welcome) sessionStorage.removeItem("taskmgr-app-welcome");
    renderEmployeeAppRedirect({ justRegistered: !!welcome });
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
