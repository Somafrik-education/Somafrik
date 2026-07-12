/**
 * Limiteur de débit en mémoire pour les routes sensibles (connexion).
 * En préproduction/production, compléter par un rate limit au reverse proxy si multi-instances.
 */
function createRateLimiter({
  windowMs = 60_000,
  max = 20,
  keyFn = (req) => req.ip || "unknown",
  message = "Trop de tentatives. Réessayez dans quelques minutes.",
} = {}) {
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = hits.get(key) ?? { count: 0, resetAt: now + windowMs };

    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    hits.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({ message });
    }

    return next();
  };
}

function loginRateLimitKey(req) {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? "").trim().toLowerCase();
  const schoolCode = String(req.body?.schoolCode ?? "").trim().toUpperCase();
  const ip = req.ip || "unknown";
  return `${ip}|${schoolCode}|${identifier}`;
}

module.exports = {
  createRateLimiter,
  loginRateLimitKey,
};
