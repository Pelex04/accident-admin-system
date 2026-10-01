const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireWrite } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { event: toEvent } = require('../utils/serializers');
const { validCoord } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth, requireWrite);

const VALID_STATUSES = ['detected', 'countdown', 'cancelled', 'alert_sent', 'alert_failed'];

router.get('/', wrap(async (req, res) => {
  const { vehicleId, status } = req.query;
  const where = [];
  const params = [];
  if (vehicleId) { where.push('vehicle_id = ?'); params.push(String(vehicleId)); }
  if (status) { where.push('status = ?'); params.push(String(status)); }

  const rows = await db.all(
    'SELECT * FROM crash_events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY detected_at DESC',
    params
  );
  return res.json(rows.map(toEvent));
}));

router.get('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM crash_events WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Crash event not found' });
  return res.json(toEvent(row));
}));

router.post('/', wrap(async (req, res) => {
  const { vehicleId, latitude, longitude, status, notes } = req.body || {};

  if (!vehicleId) {
    return res.status(400).json({ error: 'vehicleId is required' });
  }

  const vehicle = await db.get('SELECT id, name FROM vehicles WHERE id = ?', [String(vehicleId)]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const lat = latitude !== undefined ? latitude : null;
  const lon = longitude !== undefined ? longitude : null;
  if (!validCoord(lat, 90) || !validCoord(lon, 180)) {
    return res.status(400).json({ error: 'latitude must be between -90 and 90 and longitude between -180 and 180' });
  }
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'notes must be text of 2000 characters or fewer' });
  }

  const event = {
    id: uuidv4(),
    vehicle_id: vehicle.id,
    detected_at: new Date().toISOString(),
    latitude: lat,
    longitude: lon,
    status: VALID_STATUSES.includes(status) ? status : 'detected',
    cancelled_by: null,
    notes: notes || ''
  };

  await db.run(
    'INSERT INTO crash_events (id, vehicle_id, detected_at, latitude, longitude, status, cancelled_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [event.id, event.vehicle_id, event.detected_at, event.latitude, event.longitude, event.status, event.cancelled_by, event.notes]
  );
  await audit(req, 'event.create', 'event', event.id, 'Crash reported for ' + vehicle.name);

  return res.status(201).json(toEvent(event));
}));

router.put('/:id', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM crash_events WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Crash event not found' });

  const { status, cancelledBy, notes, latitude, longitude } = req.body || {};

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if ((latitude !== undefined && !validCoord(latitude, 90)) || (longitude !== undefined && !validCoord(longitude, 180))) {
    return res.status(400).json({ error: 'latitude must be between -90 and 90 and longitude between -180 and 180' });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'notes must be text of 2000 characters or fewer' });
  }
  if (cancelledBy !== undefined && cancelledBy !== null && (typeof cancelledBy !== 'string' || cancelledBy.length > 120)) {
    return res.status(400).json({ error: 'cancelledBy must be text of 120 characters or fewer' });
  }

  await db.run(
    'UPDATE crash_events SET status = ?, cancelled_by = ?, notes = ?, latitude = ?, longitude = ? WHERE id = ?',
    [
      status !== undefined ? status : row.status,
      cancelledBy !== undefined ? cancelledBy : row.cancelled_by,
      notes !== undefined ? notes : row.notes,
      latitude !== undefined ? latitude : row.latitude,
      longitude !== undefined ? longitude : row.longitude,
      row.id
    ]
  );

  const changed = [];
  if (status !== undefined && status !== row.status) changed.push('status ' + row.status + ' to ' + status);
  if (notes !== undefined && notes !== row.notes) changed.push('notes');
  if (cancelledBy !== undefined && cancelledBy !== row.cancelled_by) changed.push('cancelled by');
  if (latitude !== undefined || longitude !== undefined) changed.push('location');
  await audit(req, 'event.update', 'event', row.id, 'Crash event: changed ' + (changed.join(', ') || 'nothing'));

  return res.json(toEvent(await db.get('SELECT * FROM crash_events WHERE id = ?', [row.id])));
}));

module.exports = router;
