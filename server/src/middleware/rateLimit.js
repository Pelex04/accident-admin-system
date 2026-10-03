const db = require('../db');

// Counters live in the database, so they are shared by every server instance and survive restarts.
// Fixed windows: the counter for a key resets when the window rolls over.
let lastPurge = 0;

async function purge(now) {
  if (now - lastPurge < 10 * 60 * 1000) return;
  lastPurge = now;
  await db.run('DELETE FROM rate_limits WHERE expires_at < ?', [new Date(now).toISOString()]).catch(() => {});
}

async function hit(name, id, max, windowMs) {
  const now = Date.now();
  const index = Math.floor(now / windowMs);
  const windowEnd = (index + 1) * windowMs;
  const rows = await db.all(
    'INSERT INTO rate_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits',
    [`${name}:${id}:${index}`, new Date(windowEnd).toISOString()]
  );
  await purge(now);
  if (Number(rows[0].hits) > max) return { ok: false, retryAfter: Math.max(1, Math.ceil((windowEnd - now) / 1000)) };
  return { ok: true, retryAfter: 0 };
}

async function reset(name, id, windowMs) {
  await db.run('DELETE FROM rate_limits WHERE key = ?', [`${name}:${id}:${Math.floor(Date.now() / windowMs)}`]);
}

function limit({ name, max, windowMs, key, message }) {
  return (req, res, next) => {
    hit(name, key(req), max, windowMs)
      .then((result) => {
        if (result.ok) return next();
        res.set('Retry-After', String(result.retryAfter));
        return res.status(429).json({ error: message || 'Too many attempts. Try again later.', code: 'rate_limited' });
      })
      .catch(next);
  };
}

module.exports = { hit, reset, limit };
