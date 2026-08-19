import { IS_PORTFOLIO_DEMO } from "./isPortfolioDemo.js";
import { handleDemoRequest } from "./handlers.js";

const BANNER_TEXT =
  "Portfolio demo — sample data. Buttons work in this tab only. Nothing is saved.";

function injectBanner() {
  if (document.getElementById("portfolio-demo-banner")) return;
  const el = document.createElement("div");
  el.id = "portfolio-demo-banner";
  el.setAttribute("role", "status");
  el.textContent = BANNER_TEXT;
  document.body.prepend(el);
  document.documentElement.classList.add("portfolio-demo");
}

function stubEventSource() {
  class DemoEventSource {
    constructor() {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      queueMicrotask(() => {
        if (typeof this.onopen === "function") this.onopen({ type: "open" });
      });
    }
    addEventListener(type, fn) {
      if (type === "open") this.onopen = fn;
      if (type === "message") this.onmessage = fn;
      if (type === "error") this.onerror = fn;
    }
    removeEventListener() {}
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = DemoEventSource;
}

function disableServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const noopReg = {
    installing: null,
    waiting: null,
    active: null,
    scope: "/",
    update: async () => {},
    unregister: async () => true,
    addEventListener() {},
    removeEventListener() {},
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => {
        throw new Error("Push disabled in portfolio demo");
      },
    },
  };
  navigator.serviceWorker.register = async () => noopReg;
  navigator.serviceWorker.getRegistration = async () => undefined;
  navigator.serviceWorker.getRegistrations = async () => [];
}

function patchFetch() {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : typeof input === "string" ? input : String(input?.url ?? input);
    let pathname = "";
    try {
      pathname = new URL(url, location.origin).pathname;
    } catch {
      return origFetch(input, init);
    }
    if (!pathname.startsWith("/api")) return origFetch(input, init);
    const method = (init.method || req?.method || "GET").toUpperCase();
    let body = init.body;
    if (body == null && req && method !== "GET" && method !== "HEAD") {
      try {
        const clone = req.clone();
        const ct = clone.headers.get("content-type") || "";
        if (ct.includes("application/json")) body = await clone.text();
        else body = await clone.formData().catch(() => clone.text());
      } catch {
        body = undefined;
      }
    }
    return handleDemoRequest(url, { ...init, method, body });
  };
}

/**
 * Intercepts `/api` fetch + chat SSE. No-op unless Vite built with VITE_PORTFOLIO_DEMO=true.
 */
export function installPortfolioDemo() {
  if (!IS_PORTFOLIO_DEMO) return;
  patchFetch();
  stubEventSource();
  disableServiceWorker();
  if (document.body) injectBanner();
  else document.addEventListener("DOMContentLoaded", injectBanner);
}
