const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.put('/:id', (req, res) => {
  const contact = db.get('contacts').find({ id: req.params.id }).value();

  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  const { name, phoneNumber, priority } = req.body || {};

  db.get('contacts')
    .find({ id: req.params.id })
    .assign({
      name: name !== undefined ? name : contact.name,
      phoneNumber: phoneNumber !== undefined ? phoneNumber : contact.phoneNumber,
      priority: priority !== undefined ? priority : contact.priority
    })
    .write();

  const updated = db.get('contacts').find({ id: req.params.id }).value();
  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  const contact = db.get('contacts').find({ id: req.params.id }).value();

  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  db.get('contacts').remove({ id: req.params.id }).write();

  return res.status(204).send();
});

module.exports = router;
