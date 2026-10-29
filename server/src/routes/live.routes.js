const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { bus, touch, latestSeq, recentIncidents, incidentsByIds } = require('../utils/incidents');
const { route } = require('../utils/routing');

// Only dispatcher accounts acknowledge. Admins and super admins watch the board but do not take crashes,
// so "acknowledged by" always names someone whose job it is to respond.
const onlyDispatchers = (req, res, next) =>
  req.admin.role === 'dispatcher'
    ? next()
    : res.status(403).json({ error: 'Only dispatcher accounts can acknowledge a crash', code: 'forbidden' });

// The live board for dispatchers and admins: what is happening now, pushed as it changes.
const router = express.Router();
router.use(requireAuth);

const MAX_STREAMS_PER_ADMIN = 5;
const PING_MS = 20 * 1000;      // keeps proxies from closing a quiet stream
const SAFETY_POLL_MS = 5 * 1000; // catches changes made by another server instance
const RECHECK_MS = 60 * 1000;    // ends the stream if the account is disabled or its password is reset
const open = new Map();

router.get('/', wrap(async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
  // Read the position first. A change that lands between the two reads then shows up twice (harmless)
  // instead of being missed by a screen that carries on from this position.
  const seq = await latestSeq();
  const incidents = await recentIncidents(new Date(Date.now() - hours * 3600 * 1000).toISOString());
  return res.json({ incidents, seq, serverTime: new Date().toISOString() });
}));

// A dispatcher taps Acknowledge so everyone watching the board knows someone has taken it.
// ---- Where this person's distances are measured from (a station, a base, wherever they usually leave from) ----
// Every signed in account can keep its own, whatever its role. It is a personal setting, not a record.

const number = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

function baseOf(row) {
  return row && row.base_lat !== null && row.base_lat !== undefined && row.base_lng !== null && row.base_lng !== undefined
    ? { label: row.base_label || 'My starting point', latitude: Number(row.base_lat), longitude: Number(row.base_lng) }
    : null;
}

router.get('/base', wrap(async (req, res) => {
  const row = await db.get('SELECT base_label, base_lat, base_lng FROM admin_users WHERE id = ?', [req.admin.id]);
  res.json({ base: baseOf(row) });
}));

router.put('/base', wrap(async (req, res) => {
  const lat = number(req.body && req.body.latitude);
  const lng = number(req.body && req.body.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return res.status(400).json({ error: 'Latitude must be a number from -90 to 90' });
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return res.status(400).json({ error: 'Longitude must be a number from -180 to 180' });
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60) || 'My starting point';
  await db.run('UPDATE admin_users SET base_label = ?, base_lat = ?, base_lng = ? WHERE id = ?', [label, lat, lng, req.admin.id]);
  res.json({ base: { label, latitude: lat, longitude: lng } });
}));

router.delete('/base', wrap(async (req, res) => {
  await db.run('UPDATE admin_users SET base_label = NULL, base_lat = NULL, base_lng = NULL WHERE id = ?', [req.admin.id]);
  res.json({ base: null });
}));

// Distance and drive time from this person's starting point to one crash.
router.get('/:id/route', wrap(async (req, res) => {
  const event = await db.get('SELECT id, latitude, longitude FROM crash_events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Crash not found' });
  if (event.latitude === null || event.latitude === undefined || event.longitude === null || event.longitude === undefined) {
    return res.status(404).json({ error: 'This crash has no location yet', code: 'no_location' });
  }
  const row = await db.get('SELECT base_label, base_lat, base_lng FROM admin_users WHERE id = ?', [req.admin.id]);
  const base = baseOf(row);
  if (!base) return res.json({ needsBase: true });
  const found = await route({ lat: base.latitude, lng: base.longitude }, { lat: Number(event.latitude), lng: Number(event.longitude) });
  res.json({ needsBase: false, from: base.label, distanceKm: found.distanceKm, minutes: found.minutes, source: found.source });
}));

router.post('/:id/ack', onlyDispatchers, wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM crash_events WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Crash event not found' });
  if (row.acknowledged_at) return res.json((await incidentsByIds([row.id]))[0]);

  await db.run('UPDATE crash_events SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL', [new Date().toISOString(), req.admin.email, row.id]);
  await audit(req, 'event.acknowledge', 'event', row.id, 'Crash acknowledged on the live board');
  await touch(row.id);
  return res.json((await incidentsByIds([row.id]))[0]);
}));

// Server-Sent Events. The browser reads it with fetch (not EventSource) so the normal Authorization header
// can be used and no login token ever ends up in a URL. Each message carries an id; a client that reconnects
// sends the last one (Last-Event-ID) and receives everything it missed.
router.get('/stream', async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    if ((open.get(adminId) || 0) >= MAX_STREAMS_PER_ADMIN) {
      return res.status(429).json({ error: 'Too many live screens open for this account', code: 'too_many_streams' });
    }
    open.set(adminId, (open.get(adminId) || 0) + 1);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 5000\n\n');

    const current = await latestSeq();
    const asked = parseInt(req.headers['last-event-id'] || req.query.since, 10);
    let last = Number.isFinite(asked) && asked >= 0 ? asked : current;
    // The client remembers a position from a database that has since been reset: tell it to reload.
    if (last > current) {
      res.write('event: reset\ndata: {}\n\n');
      last = current;
    }
    res.write('event: hello\ndata: ' + JSON.stringify({ seq: last }) + '\n\n');

    let busy = false;
    let again = false;
    let closed = false;

    async function flush() {
      if (closed) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const rows = await db.all('SELECT seq, event_id FROM change_log WHERE seq > ? ORDER BY seq LIMIT 200', [last]);
          if (!rows.length) break;
          const top = Number(rows[rows.length - 1].seq);
          const ids = [...new Set(rows.map((r) => r.event_id))];
          for (const incident of await incidentsByIds(ids)) {
            res.write('id: ' + top + '\nevent: incident\ndata: ' + JSON.stringify(incident) + '\n\n');
          }
          last = top;
          if (rows.length === 200) again = true;
        } while (again && !closed);
      } catch (err) {
        console.error('Live stream read failed:', err.message);
      }
      busy = false;
    }

    async function stillAllowed() {
      const row = await db.get('SELECT active, token_version FROM admin_users WHERE id = ?', [adminId]);
      return row && Number(row.active) && Number(row.token_version) === Number(req.tokenVersion);
    }

    const onChange = () => { flush(); };
    bus.on('change', onChange);
    const poll = setInterval(flush, SAFETY_POLL_MS);
    const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, PING_MS);
    const recheck = setInterval(async () => {
      try {
        if (!(await stillAllowed())) { cleanup(); res.end(); }
      } catch (err) { /* try again next time */ }
    }, RECHECK_MS);

    function cleanup() {
      if (closed) return;
      closed = true;
      bus.off('change', onChange);
      clearInterval(poll);
      clearInterval(ping);
      clearInterval(recheck);
      open.set(adminId, Math.max((open.get(adminId) || 1) - 1, 0));
      if (!open.get(adminId)) open.delete(adminId);
    }
    req.on('close', cleanup);

    await flush();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
