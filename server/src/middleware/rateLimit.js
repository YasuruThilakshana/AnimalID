/**
 * Tiny in-memory fixed-window rate limiter (no dependency, single-process).
 * Each limiter tracks hits per key (client IP by default); over-limit
 * requests get 429 + Retry-After instead of touching handlers. Expired
 * buckets are pruned lazily with a bounded map so memory can't grow
 * unbounded under distributed abuse.
 *
 * NOTE: counts live in this process only — a multi-instance deployment
 * should back them with Redis. The middleware signature stays identical.
 */
function rateLimit({ windowMs, max, message, keyFn }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("rateLimit needs windowMs");
  if (!Number.isFinite(max) || max <= 0) throw new Error("rateLimit needs max");
  const buckets = new Map();
  const failMessage = message || "Too many requests. Please slow down.";

  function prune(now) {
    if (buckets.size < 5000) return;
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = typeof keyFn === "function" ? keyFn(req) : String((req && req.ip) || "unknown");
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    prune(now);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: failMessage });
    }
    next();
  };
}

// Route presets — generous for humans, tight for credential-stuffing and
// mail-bombing scripts.
const MINUTE = 60 * 1000;
const limiters = {
  auth: () => rateLimit({ windowMs: 15 * MINUTE, max: 30, message: "Too many sign-in attempts. Try again later." }),
  password: () => rateLimit({ windowMs: 60 * MINUTE, max: 10, message: "Too many reset requests. Try again later." }),
  chat: () => rateLimit({ windowMs: MINUTE, max: 120 }),
  message: () => rateLimit({ windowMs: MINUTE, max: 60 }),
  upload: () => rateLimit({ windowMs: MINUTE, max: 20 }),
  scan: () => rateLimit({ windowMs: MINUTE, max: 30 }),
  sighting: () => rateLimit({ windowMs: MINUTE, max: 60 }),
  // Whole-database maintenance (embedding reindex): rare, expensive, and
  // idempotent — a handful per hour is plenty even for admin retries.
  heavy: () => rateLimit({ windowMs: 60 * MINUTE, max: 10, message: "That job runs rarely. Try again later." }),
};

module.exports = { rateLimit, limiters };
