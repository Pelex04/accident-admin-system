const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('../db');
const { event: toEvent } = require('./serializers');

// Shared by the device API, the admin API and the live board. An "incident" is a crash event plus the
// vehicle name and who was alerted, in the one shape the live board needs.

const ROLES = ['next_of_kin', 'dispatcher'];
const DELIVERY_STATUSES = ['pending', 'sent', 'delivered', 'failed'];
// Delivered beats sent, so a late retry of an old "sent" report cannot undo "delivered".
const DELIVERY_RANK = { pending: 0, sent: 1, failed: 1, delivered: 2 };

// No 0/O/1/I, so a dispatcher reading the code over the phone cannot mix them up.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REF_RE = /^[A-HJ-NP-Z2-9]{4,6}$/;

const makeRef = () => Array.from({ length: 4 }, () => REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)]).join('');
const validRef = (value) => typeof value === 'string' && REF_RE.test(value);

const bus = new EventEmitter();
bus.setMaxListeners(0);
let lastPrune = 0;

// Call after any change to a crash event or its deliveries. Wakes live streams and leaves a trace for
// streams that were not connected at the time.
async function touch(eventId) {
  const now = new Date().toISOString();
  await db.run('UPDATE crash_events SET updated_at = ? WHERE id = ?', [now, eventId]);
  await db.run('INSERT INTO change_log (at, event_id) VALUES (?, ?)', [now, eventId]);
  bus.emit('change');
  if (Date.now() - lastPrune > 60 * 60 * 1000) {
    lastPrune = Date.now();
    await db.run('DELETE FROM change_log WHERE at < ?', [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()]).catch(() => {});
  }
}

async function latestSeq() {
  const row = await db.get('SELECT MAX(seq) AS seq FROM change_log');
  return row && row.seq !== null && row.seq !== undefined ? Number(row.seq) : 0;
}

function deliveryOut(r) {
  return { role: r.role, phoneNumber: r.phone_number, status: r.status, updatedAt: r.updated_at };
}

async function attach(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const [vehicles, deliveries] = await Promise.all([
    db.all('SELECT id, name FROM vehicles'),
    db.all(`SELECT * FROM alert_deliveries WHERE event_id IN (${marks}) ORDER BY role, phone_number`, ids)
  ]);
  const names = new Map(vehicles.map((v) => [v.id, v.name]));
  return rows.map((r) => ({
    ...toEvent(r),
    vehicleName: names.get(r.vehicle_id) || 'Unknown vehicle',
    deliveries: deliveries.filter((d) => d.event_id === r.id).map(deliveryOut)
  }));
}

// Newest first. `sinceIso` limits to crashes detected after that time.
async function recentIncidents(sinceIso) {
  const rows = await db.all('SELECT * FROM crash_events WHERE detected_at >= ? ORDER BY detected_at DESC LIMIT 200', [sinceIso]);
  return attach(rows);
}

async function incidentsByIds(ids) {
  if (!ids.length) return [];
  const rows = await db.all(`SELECT * FROM crash_events WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return attach(rows);
}

module.exports = { ROLES, DELIVERY_STATUSES, DELIVERY_RANK, makeRef, validRef, bus, touch, latestSeq, recentIncidents, incidentsByIds };
