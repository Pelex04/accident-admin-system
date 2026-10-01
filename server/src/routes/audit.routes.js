const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit: toAudit } = require('../utils/serializers');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

router.get('/', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('action LIKE ?'); params.push(String(req.query.action).replace(/[%_]/g, '') + '%'); }
  if (req.query.adminEmail) { where.push('admin_email = ?'); params.push(String(req.query.adminEmail).toLowerCase()); }
  if (req.query.before) { where.push('at < ?'); params.push(String(req.query.before)); }

  const rows = await db.all(
    'SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY at DESC LIMIT ?',
    params.concat([limit])
  );
  return res.json(rows.map(toAudit));
}));

module.exports = router;
