const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY?.trim() || "";
}

export function isTurnstileConfigured() {
  return !!(getTurnstileSiteKey() && process.env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * @param {string} token
 * @param {string | undefined} remoteip
 */
export async function verifyTurnstileToken(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not configured");
    return { ok: false, error: "CAPTCHA is not configured on this server." };
  }

  if (!token?.trim()) {
    return { ok: false, error: "Please complete CAPTCHA." };
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  });
  if (remoteip) body.set("remoteip", remoteip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json();
    if (data.success === true) {
      return { ok: true };
    }

    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"].join(", ") : "verification failed";
    console.warn("[turnstile] siteverify failed:", codes);
    return { ok: false, error: "CAPTCHA verification failed. Please try again." };
  } catch (err) {
    console.error("[turnstile] siteverify request failed", err);
    return { ok: false, error: "CAPTCHA verification failed. Please try again." };
  }
}
