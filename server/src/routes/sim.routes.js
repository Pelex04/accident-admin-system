const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

function detectLowBalance(text) {
  if (!text) {
    return false;
  }
  const lowerText = text.toLowerCase();
  return config.lowBalanceKeywords.some((keyword) => lowerText.includes(keyword));
}

router.get('/', (req, res) => {
  return res.json(db.get('simStatuses').value());
});

router.get('/:vehicleId', (req, res) => {
  const status = db.get('simStatuses').find({ vehicleId: req.params.vehicleId }).value();

  if (!status) {
    return res.status(404).json({ error: 'No sim status recorded for this vehicle yet' });
  }

  return res.json(status);
});

router.post('/:vehicleId/heartbeat', (req, res) => {
  const vehicle = db.get('vehicles').find({ id: req.params.vehicleId }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const { balanceText } = req.body || {};
  const lowBalanceFlag = detectLowBalance(balanceText);
  const existing = db.get('simStatuses').find({ vehicleId: req.params.vehicleId }).value();
  const now = new Date().toISOString();

  if (existing) {
    db.get('simStatuses')
      .find({ vehicleId: req.params.vehicleId })
      .assign({
        lastHeartbeatAt: now,
        lastKnownBalanceText: balanceText !== undefined ? balanceText : existing.lastKnownBalanceText,
        lowBalanceFlag,
        lastCheckedAt: now
      })
      .write();

    const updated = db.get('simStatuses').find({ vehicleId: req.params.vehicleId }).value();
    return res.json(updated);
  }

  const created = {
    id: uuidv4(),
    vehicleId: req.params.vehicleId,
    lastHeartbeatAt: now,
    lastKnownBalanceText: balanceText || '',
    lowBalanceFlag,
    lastCheckedAt: now
  };

  db.get('simStatuses').push(created).write();

  return res.status(201).json(created);
});

router.post('/:vehicleId/mark-topped-up', (req, res) => {
  const existing = db.get('simStatuses').find({ vehicleId: req.params.vehicleId }).value();

  if (!existing) {
    return res.status(404).json({ error: 'No sim status recorded for this vehicle yet' });
  }

  db.get('simStatuses')
    .find({ vehicleId: req.params.vehicleId })
    .assign({ lowBalanceFlag: false, lastCheckedAt: new Date().toISOString() })
    .write();

  const updated = db.get('simStatuses').find({ vehicleId: req.params.vehicleId }).value();
  return res.json(updated);
});

module.exports = router;
