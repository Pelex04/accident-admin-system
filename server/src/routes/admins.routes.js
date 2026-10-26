const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { admin: toAdmin } = require('../utils/serializers');
const { EMAIL_RE } = require('../utils/validate');
const { validatePassword, generateTempPassword } = require('../utils/passwords');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

const ROLES = ['viewer', 'dispatcher', 'admin', 'super_admin'];

router.get('/', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM admin_users ORDER BY created_at, email');
  return res.json(rows.map(toAdmin));
}));

router.post('/', wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const role = req.body && req.body.role;
  const supplied = req.body && req.body.password ? String(req.body.password).trim() : null;

  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'A valid email is required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role must be viewer, dispatcher, admin or super_admin' });
  if (await db.get('SELECT id FROM admin_users WHERE email = ?', [email])) {
    return res.status(409).json({ error: 'An admin with that email already exists' });
  }

  let password = supplied;
  if (password) {
    const problem = validatePassword(password, email);
    if (problem) return res.status(400).json({ error: problem });
  } else {
    password = generateTempPassword();
  }

  const id = uuidv4();
  await db.run(
    'INSERT INTO admin_users (id, email, password_hash, role, active, must_change_password, token_version, created_at) VALUES (?, ?, ?, ?, 1, 1, 0, ?)',
    [id, email, await bcrypt.hash(password, 10), role, new Date().toISOString()]
  );
  await audit(req, 'admin.create', 'admin', id, 'Created ' + email + ' as ' + role);

  const created = await db.get('SELECT * FROM admin_users WHERE id = ?', [id]);
  return res.status(201).json({ admin: toAdmin(created), temporaryPassword: supplied ? undefined : password });
}));

router.put('/:id', wrap(async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Admin not found' });
  if (target.id === req.admin.id) {
    return res.status(400).json({ error: 'You cannot change your own role or status. Ask another super admin.' });
  }

  const { role, active } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'role must be viewer, dispatcher, admin or super_admin' });
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });

  const nextRole = role !== undefined ? role : target.role;
  const nextActive = active !== undefined ? active : !!Number(target.active);

  await db.run('UPDATE admin_users SET role = ?, active = ?, token_version = token_version + 1 WHERE id = ?', [nextRole, nextActive ? 1 : 0, target.id]);

  const changed = [];
  if (nextRole !== target.role) changed.push('role ' + target.role + ' to ' + nextRole);
  if (nextActive !== !!Number(target.active)) changed.push(nextActive ? 'activated' : 'deactivated');
  await audit(req, 'admin.update', 'admin', target.id, target.email + ': ' + (changed.join(', ') || 'no change'));

  return res.json(toAdmin(await db.get('SELECT * FROM admin_users WHERE id = ?', [target.id])));
}));

router.post('/:id/reset-password', wrap(async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Admin not found' });

  const password = generateTempPassword();
  await db.run('UPDATE admin_users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(password, 10), target.id]);
  await audit(req, 'admin.reset_password', 'admin', target.id, 'Reset password for ' + target.email);

  return res.json({ temporaryPassword: password });
}));

router.delete('/:id', wrap(async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Admin not found' });
  if (target.id === req.admin.id) return res.status(400).json({ error: 'You cannot delete your own account.' });

  await db.run('DELETE FROM admin_users WHERE id = ?', [target.id]);
  await audit(req, 'admin.delete', 'admin', target.id, 'Deleted ' + target.email);

  return res.status(204).send();
}));

module.exports = router;
