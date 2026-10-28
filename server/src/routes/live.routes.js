const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// Only dispatcher accounts acknowledge. Admins and super admins watch the board but do not take crashes,
// so "acknowledged by" always names someone whose job it is to respond.
const onlyDispatchers = (req, res, next) =>
  req.admin.role === 'dispatcher'
    ? next()
    : res.status(403).json({ error: 'Only dispatcher accounts can acknowledge a crash', code: 'forbidden' });
const { wrap } = require('../utils/http');
const { audit } = require('../utils/audit');
const { bus, touch, latestSeq, recentIncidents, incidentsByIds } = require('../utils/incidents');

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
