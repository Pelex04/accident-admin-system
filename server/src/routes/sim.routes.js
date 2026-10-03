const express = require('express');
const db = require('../db');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { sim: toSim } = require('../utils/serializers');
const { recordHeartbeat } = require('../utils/heartbeat');

const router = express.Router();
router.use(requireAuth, requireWrite);

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

  const { row, created } = await recordHeartbeat(vehicle.id, balanceText);
  return res.status(created ? 201 : 200).json(toSim(row));
}));

router.post('/:vehicleId/mark-topped-up', wrap(async (req, res) => {
  const existing = await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [req.params.vehicleId]);
  if (!existing) return res.status(404).json({ error: 'No sim status recorded for this vehicle yet' });

  await db.run('UPDATE sim_statuses SET low_balance_flag = 0, last_checked_at = ? WHERE vehicle_id = ?', [new Date().toISOString(), existing.vehicle_id]);
  await audit(req, 'sim.topped_up', 'vehicle', existing.vehicle_id, 'Marked SIM as topped up');

  return res.json(toSim(await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [existing.vehicle_id])));
}));

module.exports = router;
