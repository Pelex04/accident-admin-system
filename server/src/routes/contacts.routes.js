const express = require('express');
const db = require('../db');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { contact: toContact } = require('../utils/serializers');
const { PHONE_RE, validText } = require('../utils/validate');
const { ROLES } = require('../utils/incidents');

const router = express.Router();
router.use(requireAuth, requireWrite);

router.put('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM contacts WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Contact not found' });

  const { name, phoneNumber, priority, role } = req.body || {};

  if (name !== undefined && !validText(name, 120)) {
    return res.status(400).json({ error: 'name must be 1 to 120 characters' });
  }
  if (phoneNumber !== undefined && !PHONE_RE.test(String(phoneNumber).trim())) {
    return res.status(400).json({ error: 'phoneNumber must be a phone number such as +265888111222' });
  }
  if (priority !== undefined && (!Number.isInteger(Number(priority)) || Number(priority) < 1 || Number(priority) > 99)) {
    return res.status(400).json({ error: 'priority must be a whole number from 1 to 99' });
  }

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be next_of_kin or dispatcher' });
  }

  await db.run('UPDATE contacts SET name = ?, phone_number = ?, priority = ?, role = ? WHERE id = ?', [
    name !== undefined ? name.trim() : row.name,
    phoneNumber !== undefined ? String(phoneNumber).trim() : row.phone_number,
    priority !== undefined ? Number(priority) : row.priority,
    role !== undefined ? role : row.role,
    row.id
  ]);
  await audit(req, 'contact.update', 'contact', row.id, 'Updated contact ' + row.name);

  return res.json(toContact(await db.get('SELECT * FROM contacts WHERE id = ?', [row.id])));
}));

router.delete('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM contacts WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Contact not found' });

  await db.run('DELETE FROM contacts WHERE id = ?', [row.id]);
  await audit(req, 'contact.delete', 'contact', row.id, 'Removed contact ' + row.name);

  return res.status(204).send();
}));

module.exports = router;
