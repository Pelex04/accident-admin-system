const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { requireDevice } = require('../middleware/device');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { event: toEvent, contact: toContact } = require('../utils/serializers');
const { recordHeartbeat } = require('../utils/heartbeat');
const { ROLES, DELIVERY_STATUSES, DELIVERY_RANK, makeRef, validRef, touch } = require('../utils/incidents');

// The API for the phone or device in a vehicle. Every route here belongs to the one vehicle the key was
// created for. A device can report and update its own crash reports and check in, and nothing else.
const router = express.Router();
router.use(requireDevice);

const STATUSES = ['detected', 'countdown', 'cancelled', 'alert_sent', 'alert_failed'];
const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const DAY = 24 * 60 * 60 * 1000;

const bad = (res, error, extra) => res.status(400).json({ error, code: 'invalid_request', ...extra });
const notFound = (res) => res.status(404).json({ error: 'Crash report not found for this vehicle', code: 'not_found' });
const actor = (req) => ({ id: null, email: 'device:' + req.device.keyPrefix });
const isUniqueViolation = (err) => err && (err.code === '23505' || (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')));
const objectBody = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null);

// A crash report must never be thrown away over a bad optional field (a GPS glitch, a phone with the wrong
// clock). Bad optional fields are dropped and listed in `warnings`. The shape of the request, the status and the
// ids are strict.
function number(value, limit, name, warnings) {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (Number.isFinite(n) && Math.abs(n) <= limit) return n;
  warnings.push(`${name} ignored: must be a number between -${limit} and ${limit}`);
  return undefined;
}

function location(body, warnings) {
  let lat = number(body.latitude, 90, 'latitude', warnings);
  let lon = number(body.longitude, 180, 'longitude', warnings);
  if ((lat === undefined) !== (lon === undefined)) {
    if (lat !== undefined || lon !== undefined) warnings.push('location ignored: send latitude and longitude together');
    lat = undefined;
    lon = undefined;
  }
  return { lat, lon };
}

function text(value, max, name, warnings) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    warnings.push(`${name} ignored: must be text`);
    return undefined;
  }
  if (value.length > max) warnings.push(`${name} was cut to ${max} characters`);
  return value.slice(0, max);
}

async function findOwn(req, key) {
  const vehicleId = req.device.vehicleId;
  let row = await db.get('SELECT * FROM crash_events WHERE id = ? AND vehicle_id = ?', [key, vehicleId]);
  if (!row) {
    const mapped = await db.get('SELECT event_id FROM device_event_ids WHERE vehicle_id = ? AND client_event_id = ?', [vehicleId, key]);
    if (mapped) row = await db.get('SELECT * FROM crash_events WHERE id = ?', [mapped.event_id]);
  }
  return row;
}

// Who the phone texted and whether it got through. Bad entries are dropped with a warning, like the other
// optional fields, so a crash update is never refused over one odd line.
async function saveDeliveries(eventId, input, warnings) {
  if (input === undefined || input === null) return 0;
  if (!Array.isArray(input)) {
    warnings.push('deliveries ignored: must be a list');
    return 0;
  }
  let saved = 0;
  for (const item of input.slice(0, 20)) {
    const phone = item && typeof item.phoneNumber === 'string' ? item.phoneNumber.trim() : '';
    if (!item || !ROLES.includes(item.role) || !DELIVERY_STATUSES.includes(item.status) || !phone || phone.length > 32) {
      warnings.push('a delivery entry was ignored: it needs role, phoneNumber and status');
      continue;
    }
    const now = new Date().toISOString();
    const existing = await db.get('SELECT id, status FROM alert_deliveries WHERE event_id = ? AND phone_number = ?', [eventId, phone]);
    if (!existing) {
      await db.run('INSERT INTO alert_deliveries (id, event_id, role, phone_number, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uuidv4(), eventId, item.role, phone, item.status, now]);
      saved++;
    } else if (DELIVERY_RANK[item.status] >= DELIVERY_RANK[existing.status]) {
      await db.run('UPDATE alert_deliveries SET role = ?, status = ?, updated_at = ? WHERE id = ?', [item.role, item.status, now, existing.id]);
      saved++;
    }
  }
  if (input.length > 20) warnings.push('only the first 20 deliveries were used');
  return saved;
}

router.get('/me', wrap(async (req, res) => {
  const contacts = await db.all('SELECT * FROM contacts WHERE vehicle_id = ? ORDER BY priority, name', [req.device.vehicleId]);
  return res.json({
    vehicle: { id: req.device.vehicleId, name: req.device.vehicleName, status: req.device.vehicleStatus },
    contacts: contacts.map(toContact),
    settings: { recommendedHeartbeatMinutes: 60, staleAfterMinutes: config.heartbeatStaleMinutes },
    serverTime: new Date().toISOString()
  });
}));

router.post('/heartbeat', wrap(async (req, res) => {
  const body = req.body === undefined || req.body === null || (typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body || {} : null;
  if (!body) return bad(res, 'Send a JSON object, for example {} or { "balanceText": "..." }');

  const { balanceText } = body;
  if (balanceText !== undefined && balanceText !== null && (typeof balanceText !== 'string' || balanceText.length > 500)) {
    return bad(res, 'balanceText must be text of 500 characters or fewer');
  }

  const { row } = await recordHeartbeat(req.device.vehicleId, balanceText === null ? undefined : balanceText);
  return res.json({ ok: true, lowBalance: !!Number(row.low_balance_flag), serverTime: new Date().toISOString() });
}));

router.post('/crash', wrap(async (req, res) => {
  const body = objectBody(req);
  if (!body) return bad(res, 'Send a JSON object');

  const { clientEventId, status } = body;
  if (clientEventId !== undefined && !(typeof clientEventId === 'string' && CLIENT_ID_RE.test(clientEventId))) {
    return bad(res, 'clientEventId must be 1 to 64 characters: letters, digits, dot, dash, colon or underscore');
  }
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'status must be one of: ' + STATUSES.join(', '));
  if (body.cancelledBy !== undefined && body.cancelledBy !== null && (typeof body.cancelledBy !== 'string' || body.cancelledBy.length > 120)) {
    return bad(res, 'cancelledBy must be text of 120 characters or fewer');
  }

  // The same report sent twice (a retry after a dropped connection) comes back as the original, not a copy.
  if (clientEventId) {
    const existing = await findOwn(req, clientEventId);
    if (existing) return res.status(200).json({ event: toEvent(existing), duplicate: true, warnings: [] });
  }

  const warnings = [];
  const { lat, lon } = location(body, warnings);
  const notes = text(body.notes, 2000, 'notes', warnings);

  let detectedAt = new Date().toISOString();
  if (body.detectedAt !== undefined && body.detectedAt !== null) {
    const t = typeof body.detectedAt === 'string' ? Date.parse(body.detectedAt) : NaN;
    if (Number.isFinite(t) && t <= Date.now() + 5 * 60 * 1000 && t >= Date.now() - 30 * DAY) detectedAt = new Date(t).toISOString();
    else warnings.push('detectedAt ignored: must be an ISO 8601 time within the last 30 days. The server time was used');
  }

  const event = {
    id: uuidv4(),
    vehicle_id: req.device.vehicleId,
    detected_at: detectedAt,
    latitude: lat === undefined ? null : lat,
    longitude: lon === undefined ? null : lon,
    status: status || 'detected',
    cancelled_by: body.cancelledBy || null,
    notes: notes || '',
    // The phone makes the code so it can put it in the SMS even when it cannot reach this server.
    ref: validRef(body.ref) ? body.ref : makeRef()
  };
  if (body.ref !== undefined && body.ref !== null && !validRef(body.ref)) warnings.push('ref ignored: use 4 to 6 letters and digits (no 0, 1, I or O). The server made one');

  try {
    await db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO crash_events (id, vehicle_id, detected_at, latitude, longitude, status, cancelled_by, notes, ref, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [event.id, event.vehicle_id, event.detected_at, event.latitude, event.longitude, event.status, event.cancelled_by, event.notes, event.ref, new Date().toISOString()]
      );
      if (clientEventId) {
        await tx.run('INSERT INTO device_event_ids (vehicle_id, client_event_id, event_id) VALUES (?, ?, ?)', [event.vehicle_id, clientEventId, event.id]);
      }
    });
  } catch (err) {
    if (clientEventId && isUniqueViolation(err)) {
      const existing = await findOwn(req, clientEventId);
      if (existing) return res.status(200).json({ event: toEvent(existing), duplicate: true, warnings: [] });
    }
    throw err;
  }

  await audit(req, 'event.create', 'event', event.id, 'Crash reported by device for ' + req.device.vehicleName, actor(req));
  await touch(event.id);
  return res.status(201).json({ event: toEvent(await db.get('SELECT * FROM crash_events WHERE id = ?', [event.id])), duplicate: false, warnings });
}));

router.patch('/crash/:id', wrap(async (req, res) => {
  const body = objectBody(req);
  if (!body) return bad(res, 'Send a JSON object');
  if (body.status !== undefined && !STATUSES.includes(body.status)) return bad(res, 'status must be one of: ' + STATUSES.join(', '));
  if (body.cancelledBy !== undefined && body.cancelledBy !== null && (typeof body.cancelledBy !== 'string' || body.cancelledBy.length > 120)) {
    return bad(res, 'cancelledBy must be text of 120 characters or fewer');
  }

  const row = await findOwn(req, req.params.id);
  if (!row) return notFound(res);

  const warnings = [];
  const { lat, lon } = location(body, warnings);
  const notes = text(body.notes, 2000, 'notes', warnings);
  const nextStatus = body.status !== undefined ? body.status : row.status;

  await db.run(
    'UPDATE crash_events SET status = ?, cancelled_by = ?, notes = ?, latitude = ?, longitude = ? WHERE id = ?',
    [
      nextStatus,
      body.cancelledBy !== undefined ? body.cancelledBy : row.cancelled_by,
      notes !== undefined ? notes : row.notes,
      lat !== undefined ? lat : row.latitude,
      lon !== undefined ? lon : row.longitude,
      row.id
    ]
  );
  const deliveryCount = await saveDeliveries(row.id, body.deliveries, warnings);
  await audit(req, 'event.update', 'event', row.id, 'Crash update from device' + (nextStatus !== row.status ? ': status ' + row.status + ' to ' + nextStatus : '') + (deliveryCount ? ', ' + deliveryCount + ' delivery update(s)' : ''), actor(req));
  await touch(row.id);

  return res.json({ event: toEvent(await db.get('SELECT * FROM crash_events WHERE id = ?', [row.id])), warnings });
}));

router.get('/crash/:id', wrap(async (req, res) => {
  const row = await findOwn(req, req.params.id);
  if (!row) return notFound(res);
  return res.json({ event: toEvent(row) });
}));

router.get('/crashes', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const rows = await db.all('SELECT * FROM crash_events WHERE vehicle_id = ? ORDER BY detected_at DESC LIMIT ?', [req.device.vehicleId, limit]);
  return res.json({ events: rows.map(toEvent) });
}));

module.exports = router;
