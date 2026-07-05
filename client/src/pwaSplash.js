const SPLASH_MAX_MS = 4500;
const SPLASH_FADE_MS = 420;

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    /** @type {{ standalone?: boolean }} */ (window.navigator).standalone === true
  );
}

function hidePwaSplash() {
  const splash = document.getElementById("pwa-splash");
  if (!splash || splash.classList.contains("pwa-splash--hide")) return;
  splash.classList.add("pwa-splash--hide");
  splash.setAttribute("aria-hidden", "true");
  window.setTimeout(() => splash.remove(), SPLASH_FADE_MS);
}

export function initPwaSplash() {
  const splash = document.getElementById("pwa-splash");
  if (!splash) return;

  if (!isStandalonePwa()) {
    splash.remove();
    return;
  }

  window.addEventListener("taskmgr-app-ready", hidePwaSplash, { once: true });
  window.setTimeout(hidePwaSplash, SPLASH_MAX_MS);
}

export function notifyAppReady() {
  window.dispatchEvent(new Event("taskmgr-app-ready"));
}
