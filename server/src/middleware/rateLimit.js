function createLimiter({ windowMs, max }) {
  const hits = new Map();

  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const keep = times.filter((t) => t > cutoff);
      if (keep.length) hits.set(key, keep);
      else hits.delete(key);
    }
  }, 60000);
  timer.unref();

  function take(key) {
    const now = Date.now();
    const times = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (times.length >= max) {
      hits.set(key, times);
      return { ok: false, retryAfter: Math.ceil((times[0] + windowMs - now) / 1000) };
    }
    times.push(now);
    hits.set(key, times);
    return { ok: true };
  }

  return {
    take,
    reset: (key) => hits.delete(key),
    middleware: (keyFn, message) => (req, res, next) => {
      const result = take(keyFn(req));
      if (result.ok) return next();
      res.set('Retry-After', String(result.retryAfter));
      return res.status(429).json({ error: message || 'Too many attempts. Try again later.' });
    }
  };
}

module.exports = { createLimiter };
