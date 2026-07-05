const HOSTNAME_INSTANCE_ALIASES = {
  sugandhshoppee: "TM-SSPL",
  safari: "TM-SAFARI",
  tacs: "TM-TACS",
  acs: "TM-ACS",
  ss2n: "TM-SS2N",
};

function sanitizeInstanceSlug(raw) {
  const slug = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .replace(/^_+|_+$/g, "");
  return slug || "TM-TASKMANAGER";
}

export function pwaInstanceFromHostname(hostname = "") {
  const host = String(hostname).toLowerCase().split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "TM-TASKMANAGER";
  }
  const sub = host.split(".")[0];
  if (HOSTNAME_INSTANCE_ALIASES[sub]) return HOSTNAME_INSTANCE_ALIASES[sub];
  return `TM-${sub.toUpperCase()}`;
}

export function resolvePwaInstanceName() {
  const fromEnv = (import.meta.env.VITE_PWA_INSTANCE_NAME || "").trim();
  if (fromEnv) return sanitizeInstanceSlug(fromEnv);
  return sanitizeInstanceSlug(pwaInstanceFromHostname(window.location.hostname));
}

export function pwaAppDisplayName(instanceName) {
  return sanitizeInstanceSlug(instanceName);
}

export function buildWebAppManifest(instanceName) {
  const name = pwaAppDisplayName(instanceName);
  return {
    name,
    short_name: name,
    description: "Task lists, assignments, attendance, and team management",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#00535b",
    scope: "/",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/notification-icon.png", sizes: "96x96", type: "image/png", purpose: "any" },
    ],
  };
}

/** Dev / fallback: blob manifest when static file is not served dynamically. */
export function applyPwaBranding() {
  const instance = resolvePwaInstanceName();
  const name = pwaAppDisplayName(instance);

  document.querySelectorAll('meta[name="apple-mobile-web-app-title"], meta[name="application-name"]').forEach((el) => {
    el.setAttribute("content", name);
  });

  const link = document.querySelector('link[rel="manifest"]');
  if (link && !link.dataset.pwaDynamic) {
    const blob = new Blob([JSON.stringify(buildWebAppManifest(instance))], {
      type: "application/manifest+json",
    });
    link.href = URL.createObjectURL(blob);
    link.dataset.pwaDynamic = "1";
  }
}
