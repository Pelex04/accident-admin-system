const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { vehicle: toVehicle, contact: toContact } = require('../utils/serializers');
const { PHONE_RE, digits, validText } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth, requireWrite);

const STATUSES = ['active', 'inactive'];

async function simTaken(sim, exceptId) {
  const wanted = digits(sim);
  const rows = await db.all('SELECT id, arduino_sim_number FROM vehicles');
  return rows.some((r) => r.id !== exceptId && digits(r.arduino_sim_number) === wanted);
}

router.get('/', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM vehicles ORDER BY registered_at, id');
  return res.json(rows.map(toVehicle));
}));

router.post('/', wrap(async (req, res) => {
  const { name, arduinoSimNumber } = req.body || {};

  if (!name || !arduinoSimNumber) {
    return res.status(400).json({ error: 'name and arduinoSimNumber are required' });
  }
  if (!validText(name, 120)) {
    return res.status(400).json({ error: 'name must be 1 to 120 characters' });
  }
  if (!PHONE_RE.test(String(arduinoSimNumber).trim())) {
    return res.status(400).json({ error: 'arduinoSimNumber must be a phone number such as +265991234567' });
  }
  if (await simTaken(arduinoSimNumber)) {
    return res.status(409).json({ error: 'A vehicle with that SIM number already exists' });
  }

  const vehicle = {
    id: uuidv4(),
    name: name.trim(),
    arduino_sim_number: String(arduinoSimNumber).trim(),
    status: 'active',
    registered_at: new Date().toISOString()
  };

  await db.run(
    'INSERT INTO vehicles (id, name, arduino_sim_number, status, registered_at) VALUES (?, ?, ?, ?, ?)',
    [vehicle.id, vehicle.name, vehicle.arduino_sim_number, vehicle.status, vehicle.registered_at]
  );
  await audit(req, 'vehicle.create', 'vehicle', vehicle.id, 'Registered ' + vehicle.name);

  return res.status(201).json(toVehicle(vehicle));
}));

router.get('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });
  return res.json(toVehicle(row));
}));

router.put('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });

  const { name, arduinoSimNumber, status } = req.body || {};

  if (name !== undefined && !validText(name, 120)) {
    return res.status(400).json({ error: 'name must be 1 to 120 characters' });
  }
  if (arduinoSimNumber !== undefined && !PHONE_RE.test(String(arduinoSimNumber).trim())) {
    return res.status(400).json({ error: 'arduinoSimNumber must be a phone number such as +265991234567' });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be active or inactive' });
  }
  if (arduinoSimNumber !== undefined && (await simTaken(arduinoSimNumber, row.id))) {
    return res.status(409).json({ error: 'A vehicle with that SIM number already exists' });
  }

  const next = {
    name: name !== undefined ? name.trim() : row.name,
    sim: arduinoSimNumber !== undefined ? String(arduinoSimNumber).trim() : row.arduino_sim_number,
    status: status !== undefined ? status : row.status
  };

  await db.run('UPDATE vehicles SET name = ?, arduino_sim_number = ?, status = ? WHERE id = ?', [next.name, next.sim, next.status, row.id]);

  const changed = [];
  if (next.name !== row.name) changed.push('name');
  if (next.sim !== row.arduino_sim_number) changed.push('SIM number');
  if (next.status !== row.status) changed.push('status ' + row.status + ' to ' + next.status);
  await audit(req, 'vehicle.update', 'vehicle', row.id, next.name + ': changed ' + (changed.join(', ') || 'nothing'));

  const updated = await db.get('SELECT * FROM vehicles WHERE id = ?', [row.id]);
  return res.json(toVehicle(updated));
}));

router.delete('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });

  // Contacts and SIM status go with the vehicle. Crash events stay as history.
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM contacts WHERE vehicle_id = ?', [row.id]);
    await tx.run('DELETE FROM sim_statuses WHERE vehicle_id = ?', [row.id]);
    await tx.run('DELETE FROM vehicles WHERE id = ?', [row.id]);
  });
  await audit(req, 'vehicle.delete', 'vehicle', row.id, 'Deleted ' + row.name);

  return res.status(204).send();
}));

router.get('/:id/contacts', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM contacts WHERE vehicle_id = ? ORDER BY priority, name', [req.params.id]);
  return res.json(rows.map(toContact));
}));

router.post('/:id/contacts', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id, name FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const { name, phoneNumber, priority } = req.body || {};

  if (!name || !phoneNumber) {
    return res.status(400).json({ error: 'name and phoneNumber are required' });
  }
  if (!validText(name, 120)) {
    return res.status(400).json({ error: 'name must be 1 to 120 characters' });
  }
  if (!PHONE_RE.test(String(phoneNumber).trim())) {
    return res.status(400).json({ error: 'phoneNumber must be a phone number such as +265888111222' });
  }
  const level = priority !== undefined ? Number(priority) : 1;
  if (!Number.isInteger(level) || level < 1 || level > 99) {
    return res.status(400).json({ error: 'priority must be a whole number from 1 to 99' });
  }

  const contact = { id: uuidv4(), vehicle_id: vehicle.id, name: name.trim(), phone_number: String(phoneNumber).trim(), priority: level };
  await db.run('INSERT INTO contacts (id, vehicle_id, name, phone_number, priority) VALUES (?, ?, ?, ?, ?)',
    [contact.id, contact.vehicle_id, contact.name, contact.phone_number, contact.priority]);
  await audit(req, 'contact.create', 'contact', contact.id, 'Added ' + contact.name + ' to ' + vehicle.name);

  return res.status(201).json(toContact(contact));
}));

module.exports = router;
