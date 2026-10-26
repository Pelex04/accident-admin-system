const express = require('express');
const { ROLES } = require('../utils/incidents');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { vehicle: toVehicle, contact: toContact } = require('../utils/serializers');
const { PHONE_RE, digits, validText } = require('../utils/validate');
const { generateDeviceKey, hashDeviceKey, keyPrefix } = require('../utils/deviceKeys');

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
    await tx.run('DELETE FROM device_keys WHERE vehicle_id = ?', [row.id]);
    await tx.run('DELETE FROM device_event_ids WHERE vehicle_id = ?', [row.id]);
    await tx.run('DELETE FROM vehicles WHERE id = ?', [row.id]);
  });
  await audit(req, 'vehicle.delete', 'vehicle', row.id, 'Deleted ' + row.name);

  return res.status(204).send();
}));

// Device keys. The key itself is shown once, when it is created. Only its fingerprint is stored.
router.get('/:id/device-key', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  const row = await db.get('SELECT key_prefix, created_at, last_used_at FROM device_keys WHERE vehicle_id = ?', [vehicle.id]);
  return res.json(row ? { exists: true, prefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at } : { exists: false });
}));

router.post('/:id/device-key', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id, name FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const replacing = !!(await db.get('SELECT vehicle_id FROM device_keys WHERE vehicle_id = ?', [vehicle.id]));
  const key = generateDeviceKey();
  const createdAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM device_keys WHERE vehicle_id = ?', [vehicle.id]);
    await tx.run(
      'INSERT INTO device_keys (vehicle_id, key_hash, key_prefix, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
      [vehicle.id, hashDeviceKey(key), keyPrefix(key), createdAt, req.admin.email]
    );
  });
  await audit(req, replacing ? 'device_key.regenerate' : 'device_key.create', 'vehicle', vehicle.id, (replacing ? 'Regenerated' : 'Created') + ' device key for ' + vehicle.name);

  res.set('Cache-Control', 'no-store');
  return res.status(201).json({ deviceKey: key, prefix: keyPrefix(key), createdAt });
}));

router.delete('/:id/device-key', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id, name FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  const result = await db.run('DELETE FROM device_keys WHERE vehicle_id = ?', [vehicle.id]);
  if (!result.changes) return res.status(404).json({ error: 'This vehicle has no device key' });
  await audit(req, 'device_key.revoke', 'vehicle', vehicle.id, 'Revoked device key for ' + vehicle.name);
  return res.status(204).send();
}));

router.get('/:id/contacts', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM contacts WHERE vehicle_id = ? ORDER BY priority, name', [req.params.id]);
  return res.json(rows.map(toContact));
}));

router.post('/:id/contacts', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id, name FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const { name, phoneNumber, priority, role } = req.body || {};

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

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be next_of_kin or dispatcher' });
  }

  const contact = { id: uuidv4(), vehicle_id: vehicle.id, name: name.trim(), phone_number: String(phoneNumber).trim(), priority: level, role: role || 'next_of_kin' };
  await db.run('INSERT INTO contacts (id, vehicle_id, name, phone_number, priority, role) VALUES (?, ?, ?, ?, ?, ?)',
    [contact.id, contact.vehicle_id, contact.name, contact.phone_number, contact.priority, contact.role]);
  await audit(req, 'contact.create', 'contact', contact.id, 'Added ' + contact.name + ' to ' + vehicle.name);

  return res.status(201).json(toContact(contact));
}));

module.exports = router;
