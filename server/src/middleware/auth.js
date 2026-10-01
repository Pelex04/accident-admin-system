const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const RANK = { viewer: 1, admin: 2, super_admin: 3 };

// Loads the admin from the database on every request, so a disabled account, a changed role or a
// reset password takes effect immediately instead of when the token expires.
function auth(options) {
  const allowPasswordChange = !!(options && options.allowPasswordChange);

  return async function requireAuth(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;

      if (!token) return res.status(401).json({ error: 'Missing authorization token' });

      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const row = await db.get(
        'SELECT id, email, role, active, must_change_password, token_version FROM admin_users WHERE id = ?',
        [payload.id]
      );

      if (!row || !Number(row.active) || Number(row.token_version) !== payload.tv) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.admin = { id: row.id, email: row.email, role: row.role, mustChangePassword: !!Number(row.must_change_password) };

      if (req.admin.mustChangePassword && !allowPasswordChange) {
        return res.status(403).json({ error: 'You must change your password before continuing', code: 'password_change_required' });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requireRole(minimum) {
  return (req, res, next) =>
    RANK[req.admin.role] >= RANK[minimum]
      ? next()
      : res.status(403).json({ error: 'You do not have permission to do this', code: 'forbidden' });
}

// Viewers can read everything, changes need at least the admin role.
const requireWrite = (req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD' ? next() : requireRole('admin')(req, res, next);

module.exports = {
  requireAuth: auth(),
  requireAuthAllowChange: auth({ allowPasswordChange: true }),
  requireRole,
  requireWrite,
  RANK
};
