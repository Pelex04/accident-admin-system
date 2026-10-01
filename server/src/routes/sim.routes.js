const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { sim: toSim } = require('../utils/serializers');

const router = express.Router();
router.use(requireAuth, requireWrite);

function detectLowBalance(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return config.lowBalanceKeywords.some((keyword) => lower.includes(keyword));
}

router.get('/', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM sim_statuses');
  return res.json(rows.map(toSim));
}));

router.get('/:vehicleId', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [req.params.vehicleId]);
  if (!row) return res.status(404).json({ error: 'No sim status recorded for this vehicle yet' });
  return res.json(toSim(row));
}));

router.post('/:vehicleId/heartbeat', wrap(async (req, res) => {
  const vehicle = await db.get('SELECT id FROM vehicles WHERE id = ?', [req.params.vehicleId]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const { balanceText } = req.body || {};
  if (balanceText !== undefined && (typeof balanceText !== 'string' || balanceText.length > 500)) {
    return res.status(400).json({ error: 'balanceText must be text of 500 characters or fewer' });
  }

  const low = detectLowBalance(balanceText) ? 1 : 0;
  const now = new Date().toISOString();
  const existing = await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [vehicle.id]);

  if (existing) {
    await db.run(
      'UPDATE sim_statuses SET last_heartbeat_at = ?, last_known_balance_text = ?, low_balance_flag = ?, last_checked_at = ? WHERE vehicle_id = ?',
      [now, balanceText !== undefined ? balanceText : existing.last_known_balance_text, low, now, vehicle.id]
    );
    return res.json(toSim(await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [vehicle.id])));
  }

  const created = { id: uuidv4(), vehicle_id: vehicle.id, last_heartbeat_at: now, last_known_balance_text: balanceText || '', low_balance_flag: low, last_checked_at: now };
  await db.run(
    'INSERT INTO sim_statuses (id, vehicle_id, last_heartbeat_at, last_known_balance_text, low_balance_flag, last_checked_at) VALUES (?, ?, ?, ?, ?, ?)',
    [created.id, created.vehicle_id, created.last_heartbeat_at, created.last_known_balance_text, created.low_balance_flag, created.last_checked_at]
  );
  return res.status(201).json(toSim(created));
}));

router.post('/:vehicleId/mark-topped-up', wrap(async (req, res) => {
  const existing = await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [req.params.vehicleId]);
  if (!existing) return res.status(404).json({ error: 'No sim status recorded for this vehicle yet' });

  await db.run('UPDATE sim_statuses SET low_balance_flag = 0, last_checked_at = ? WHERE vehicle_id = ?', [new Date().toISOString(), existing.vehicle_id]);
  await audit(req, 'sim.topped_up', 'vehicle', existing.vehicle_id, 'Marked SIM as topped up');

  return res.json(toSim(await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [existing.vehicle_id])));
}));

module.exports = router;
