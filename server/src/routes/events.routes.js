const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['detected', 'countdown', 'cancelled', 'alert_sent', 'alert_failed'];

router.use(requireAuth);

router.get('/', (req, res) => {
  const { vehicleId, status } = req.query;
  let events = db.get('crashEvents').value();

  if (vehicleId) {
    events = events.filter((event) => event.vehicleId === vehicleId);
  }

  if (status) {
    events = events.filter((event) => event.status === status);
  }

  const sorted = [...events].sort(
    (a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)
  );

  return res.json(sorted);
});

router.get('/:id', (req, res) => {
  const event = db.get('crashEvents').find({ id: req.params.id }).value();

  if (!event) {
    return res.status(404).json({ error: 'Crash event not found' });
  }

  return res.json(event);
});

router.post('/', (req, res) => {
  const { vehicleId, latitude, longitude, status, notes } = req.body || {};

  if (!vehicleId) {
    return res.status(400).json({ error: 'vehicleId is required' });
  }

  const vehicle = db.get('vehicles').find({ id: vehicleId }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const event = {
    id: uuidv4(),
    vehicleId,
    detectedAt: new Date().toISOString(),
    latitude: latitude !== undefined ? latitude : null,
    longitude: longitude !== undefined ? longitude : null,
    status: VALID_STATUSES.includes(status) ? status : 'detected',
    cancelledBy: null,
    notes: notes || ''
  };

  db.get('crashEvents').push(event).write();

  return res.status(201).json(event);
});

router.put('/:id', (req, res) => {
  const event = db.get('crashEvents').find({ id: req.params.id }).value();

  if (!event) {
    return res.status(404).json({ error: 'Crash event not found' });
  }

  const { status, cancelledBy, notes, latitude, longitude } = req.body || {};

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  db.get('crashEvents')
    .find({ id: req.params.id })
    .assign({
      status: status !== undefined ? status : event.status,
      cancelledBy: cancelledBy !== undefined ? cancelledBy : event.cancelledBy,
      notes: notes !== undefined ? notes : event.notes,
      latitude: latitude !== undefined ? latitude : event.latitude,
      longitude: longitude !== undefined ? longitude : event.longitude
    })
    .write();

  const updated = db.get('crashEvents').find({ id: req.params.id }).value();
  return res.json(updated);
});

module.exports = router;
