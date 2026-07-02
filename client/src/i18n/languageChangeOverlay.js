/** @type {HTMLElement | null} */
let overlayEl = null;

/** @type {HTMLElement | null} */
let messageEl = null;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.id = "app-lang-change-overlay";
  overlayEl.className = "app-lang-change-overlay";
  overlayEl.setAttribute("role", "alertdialog");
  overlayEl.setAttribute("aria-modal", "true");
  overlayEl.setAttribute("aria-busy", "true");
  overlayEl.setAttribute("aria-live", "polite");
  overlayEl.innerHTML = `<div class="app-lang-change-overlay-card">
    <div class="spinner-border text-primary app-lang-change-overlay-spinner" role="status" aria-hidden="true"></div>
    <p class="app-lang-change-overlay-message mb-0"></p>
  </div>`;
  messageEl = overlayEl.querySelector(".app-lang-change-overlay-message");
  document.body.appendChild(overlayEl);
}

function setLanguageSelectsDisabled(disabled) {
  document.querySelectorAll("[data-lang-selector] select").forEach((select) => {
    select.disabled = disabled;
  });
}

/** @param {string} [message] */
export function showLanguageChangeOverlay(message = "") {
  ensureOverlay();
  if (messageEl) messageEl.textContent = message;
  overlayEl?.classList.add("is-visible");
  document.body.classList.add("app-lang-change-active");
  setLanguageSelectsDisabled(true);
}

/** @param {string} message */
export function updateLanguageChangeOverlay(message) {
  if (messageEl) messageEl.textContent = message;
}

export function hideLanguageChangeOverlay() {
  overlayEl?.classList.remove("is-visible");
  document.body.classList.remove("app-lang-change-active");
  setLanguageSelectsDisabled(false);
}
