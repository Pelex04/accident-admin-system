const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { requireAuthAllowChange } = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimit');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { admin: toAdmin } = require('../utils/serializers');
const { validatePassword } = require('../utils/passwords');

const router = express.Router();

const WINDOW = 15 * 60 * 1000;
const ipLimiter = createLimiter({ windowMs: WINDOW, max: config.loginMaxPerIp });
const emailLimiter = createLimiter({ windowMs: WINDOW, max: config.loginMaxPerEmail });
const changeLimiter = createLimiter({ windowMs: WINDOW, max: 10 });
// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sign = (row) =>
  jwt.sign({ id: row.id, tv: Number(row.token_version) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });

router.post(
  '/login',
  ipLimiter.middleware((req) => req.ip, 'Too many sign in attempts. Try again in a few minutes.'),
  wrap(async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const gate = emailLimiter.take(email.slice(0, 254));
    if (!gate.ok) {
      res.set('Retry-After', String(gate.retryAfter));
      return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }

    const row = email.length <= 254 ? await db.get('SELECT * FROM admin_users WHERE email = ?', [email]) : null;
    const matches = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);

    if (!row || !matches || !Number(row.active)) {
      await audit(req, 'auth.login_failed', 'admin', row ? row.id : null, 'Failed sign in for ' + email.slice(0, 120), { id: row ? row.id : null, email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    emailLimiter.reset(email);
    await db.run('UPDATE admin_users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    await audit(req, 'auth.login', 'admin', row.id, 'Signed in', { id: row.id, email: row.email });

    return res.json({ token: sign(row), admin: toAdmin(row) });
  })
);

router.get('/me', requireAuthAllowChange, wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.admin.id]);
  return res.json(toAdmin(row));
}));

router.post('/change-password', requireAuthAllowChange, wrap(async (req, res) => {
  const gate = changeLimiter.take(req.admin.id);
  if (!gate.ok) {
    res.set('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  const current = String((req.body && req.body.currentPassword) || '').trim();
  const next = String((req.body && req.body.newPassword) || '').trim();
  const row = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.admin.id]);

  // 400, not 401: the dashboard treats a 401 as an expired session.
  if (!(await bcrypt.compare(current, row.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const problem = validatePassword(next, row.email);
  if (problem) return res.status(400).json({ error: problem });
  if (next === current) return res.status(400).json({ error: 'The new password must be different from the current one' });

  const hash = await bcrypt.hash(next, 10);
  await db.run('UPDATE admin_users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?', [hash, row.id]);
  const updated = await db.get('SELECT * FROM admin_users WHERE id = ?', [row.id]);
  await audit(req, 'auth.password_changed', 'admin', row.id, 'Changed own password');

  // Changing the password signs out every other session, so hand this one a fresh token.
  return res.json({ token: sign(updated), admin: toAdmin(updated) });
}));

module.exports = router;
