const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Records who did what. A failure here must never break the request itself.
async function audit(req, action, entityType, entityId, summary, actor) {
  try {
    const who = actor || req.admin || {};
    await db.run(
      'INSERT INTO audit_log (id, at, admin_id, admin_email, action, entity_type, entity_id, summary, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), new Date().toISOString(), who.id || null, who.email || null, action, entityType || null, entityId || null, String(summary || '').slice(0, 500), req.ip || null]
    );
  } catch (err) {
    console.error('Audit log write failed: ' + err.message);
  }
}

module.exports = { audit };
