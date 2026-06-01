const buckets = new Map();

/**
 * Simple in-memory rate limiter (per IP).
 * @param {{ windowMs?: number, max?: number, keyPrefix?: string }} opts
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 20, keyPrefix = "otp" } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      buckets.set(key, entry);
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        error: "Too many requests. Please wait a few minutes and try again.",
      });
    }

    next();
  };
}
