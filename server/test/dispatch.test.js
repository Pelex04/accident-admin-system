process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.LOGIN_MAX_PER_IP = '1000';
process.env.SEED_ADMIN_EMAIL = 'root@test.local';
process.env.LEGACY_DB_FILE = '/nonexistent/db.json';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const db = require('../src/db');
const { createApp } = require('../src/app');
const { ensureJwtSecret } = require('../src/utils/security');
const { ensureSeedAdmin } = require('../src/utils/seed');

const STRONG = 'Sturdy-pass-2026';
const ctx = {};
let base, server;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { status: res.status, body: json };
}
const admin = (token) => ({ Authorization: 'Bearer ' + token });
const dev = (key) => ({ 'X-Device-Key': key });

async function makeAdmin(email, role) {
  const made = await call('POST', '/api/admins', { email, role }, admin(ctx.root));
  assert.equal(made.status, 201, 'creating ' + role);
  const login = await call('POST', '/api/auth/login', { email, password: made.body.temporaryPassword });
  return (await call('POST', '/api/auth/change-password', { currentPassword: made.body.temporaryPassword, newPassword: STRONG }, admin(login.body.token))).body.token;
}

// Reads a live stream and lets a test wait for a particular message.
async function openStream(token, lastEventId) {
  const abort = new AbortController();
  const headers = { ...admin(token) };
  if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId);
  const res = await fetch(base + '/api/live/stream', { headers, signal: abort.signal });
  if (res.status !== 200) { abort.abort(); return { status: res.status, close() {} }; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames = [];
  const parse = () => {
    let at;
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const frame = { event: 'message', id: null, data: null };
      raw.split('\n').forEach((line) => {
        if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('id: ')) frame.id = line.slice(4);
        else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
      });
      if (frame.data !== null || frame.event !== 'message') frames.push(frame);
    }
  };
  return {
    status: 200,
    frames,
    async waitFor(test, ms = 4000) {
      const until = Date.now() + ms;
      for (;;) {
        const hit = frames.find(test);
        if (hit) return hit;
        if (Date.now() > until) throw new Error('Timed out waiting for a stream message. Got: ' + JSON.stringify(frames));
        const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r(null), 200))]);
        if (chunk && chunk.value) { buffer += decoder.decode(chunk.value, { stream: true }); parse(); }
        if (chunk && chunk.done) throw new Error('Stream ended');
      }
    },
    close() { abort.abort(); }
  };
}

before(async () => {
  await db.init();
  await ensureJwtSecret();
  await ensureSeedAdmin({ onlyIfEmpty: true });
  server = createApp().listen(0);
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;

  const login = await call('POST', '/api/auth/login', { email: 'root@test.local', password: 'change_this_password' });
  ctx.root = (await call('POST', '/api/auth/change-password', { currentPassword: 'change_this_password', newPassword: STRONG }, admin(login.body.token))).body.token;
  ctx.viewer = await makeAdmin('viewer@test.local', 'viewer');
  ctx.dispatcher = await makeAdmin('dispatch@test.local', 'dispatcher');

  const v = await call('POST', '/api/vehicles', { name: 'BX9047', arduinoSimNumber: '+265991111111' }, admin(ctx.root));
  ctx.vehicle = v.body.id;
  ctx.key = (await call('POST', `/api/vehicles/${ctx.vehicle}/device-key`, {}, admin(ctx.root))).body.deviceKey;
});

after(async () => {
  server.close();
  await db.close();
});

test('contacts have a role: next of kin by default, dispatcher when set, anything else refused', async () => {
  const kin = await call('POST', `/api/vehicles/${ctx.vehicle}/contacts`, { name: 'Mum', phoneNumber: '+265888111222' }, admin(ctx.root));
  assert.equal(kin.status, 201);
  assert.equal(kin.body.role, 'next_of_kin');

  const disp = await call('POST', `/api/vehicles/${ctx.vehicle}/contacts`, { name: 'Control room', phoneNumber: '+265999000111', role: 'dispatcher' }, admin(ctx.root));
  assert.equal(disp.body.role, 'dispatcher');
  assert.equal((await call('POST', `/api/vehicles/${ctx.vehicle}/contacts`, { name: 'X', phoneNumber: '+265999000112', role: 'boss' }, admin(ctx.root))).status, 400);

  const flipped = await call('PUT', `/api/contacts/${kin.body.id}`, { role: 'dispatcher' }, admin(ctx.root));
  assert.equal(flipped.body.role, 'dispatcher');
  assert.equal((await call('PUT', `/api/contacts/${kin.body.id}`, { role: 'nope' }, admin(ctx.root))).status, 400);
  await call('PUT', `/api/contacts/${kin.body.id}`, { role: 'next_of_kin' }, admin(ctx.root));

  const me = await call('GET', '/api/device/me', undefined, dev(ctx.key));
  assert.deepEqual(me.body.contacts.map((c) => c.role).sort(), ['dispatcher', 'next_of_kin']);
});

test('the phone can supply the reference code; a bad one is replaced and reported', async () => {
  const good = await call('POST', '/api/device/crash', { clientEventId: 'ref-1', ref: 'K7Q2', status: 'detected' }, dev(ctx.key));
  assert.equal(good.status, 201);
  assert.equal(good.body.event.ref, 'K7Q2');

  const bad = await call('POST', '/api/device/crash', { clientEventId: 'ref-2', ref: 'o0o0', status: 'detected' }, dev(ctx.key));
  assert.match(bad.body.event.ref, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(bad.body.warnings.some((w) => w.startsWith('ref ignored')));

  const none = await call('POST', '/api/device/crash', { clientEventId: 'ref-3' }, dev(ctx.key));
  assert.match(none.body.event.ref, /^[A-HJ-NP-Z2-9]{4}$/);

  const again = await call('POST', '/api/device/crash', { clientEventId: 'ref-1', ref: 'ZZZZ' }, dev(ctx.key));
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.event.ref, 'K7Q2', 'a retry returns the original');
});

test('delivery results are stored, never go backwards, and bad lines are dropped with a warning', async () => {
  await call('POST', '/api/device/crash', { clientEventId: 'del-1', ref: 'D3L9', status: 'countdown' }, dev(ctx.key));
  const sent = await call('PATCH', '/api/device/crash/del-1', {
    status: 'alert_sent',
    deliveries: [
      { role: 'dispatcher', phoneNumber: '+265999000111', status: 'sent' },
      { role: 'next_of_kin', phoneNumber: '+265888111222', status: 'failed' },
      { role: 'janitor', phoneNumber: '+265888000000', status: 'sent' },
      { role: 'dispatcher', status: 'sent' }
    ]
  }, dev(ctx.key));
  assert.equal(sent.status, 200);
  assert.equal(sent.body.warnings.length, 2);

  await call('PATCH', '/api/device/crash/del-1', { deliveries: [{ role: 'dispatcher', phoneNumber: '+265999000111', status: 'delivered' }] }, dev(ctx.key));
  await call('PATCH', '/api/device/crash/del-1', { deliveries: [{ role: 'dispatcher', phoneNumber: '+265999000111', status: 'sent' }] }, dev(ctx.key));

  const board = await call('GET', '/api/live', undefined, admin(ctx.dispatcher));
  const incident = board.body.incidents.find((i) => i.ref === 'D3L9');
  assert.equal(incident.vehicleName, 'BX9047');
  assert.equal(incident.status, 'alert_sent');
  const byRole = Object.fromEntries(incident.deliveries.map((d) => [d.role, d.status]));
  assert.deepEqual(byRole, { dispatcher: 'delivered', next_of_kin: 'failed' });
});

test('acknowledge: only dispatcher accounts can, admins and viewers only watch, and it only counts once', async () => {
  const board = await call('GET', '/api/live', undefined, admin(ctx.viewer));
  assert.equal(board.status, 200, 'viewers can watch the board');
  const id = board.body.incidents.find((i) => i.ref === 'D3L9').id;

  assert.equal((await call('POST', `/api/live/${id}/ack`, {}, admin(ctx.viewer))).status, 403);
  assert.equal((await call('POST', `/api/live/${id}/ack`, {}, admin(ctx.root))).status, 403, 'a super admin watches, does not acknowledge');
  assert.equal((await call('GET', '/api/live', undefined, admin(ctx.root))).status, 200, 'but can see the board');
  assert.equal((await call('POST', '/api/live/nope/ack', {}, admin(ctx.dispatcher))).status, 404);
  assert.equal((await call('POST', `/api/live/${id}/ack`, {})).status, 401);

  const first = await call('POST', `/api/live/${id}/ack`, {}, admin(ctx.dispatcher));
  assert.equal(first.status, 200);
  assert.equal(first.body.acknowledgedBy, 'dispatch@test.local');
  const second = await call('POST', `/api/live/${id}/ack`, {}, admin(ctx.dispatcher));
  assert.equal(second.body.acknowledgedBy, 'dispatch@test.local', 'a repeat changes nothing');
});

test('a dispatcher is read only apart from acknowledging', async () => {
  assert.equal((await call('POST', '/api/vehicles', { name: 'Nope', arduinoSimNumber: '+265993333333' }, admin(ctx.dispatcher))).status, 403);
  assert.equal((await call('GET', '/api/vehicles', undefined, admin(ctx.dispatcher))).status, 200);
  assert.equal((await call('GET', '/api/admins', undefined, admin(ctx.dispatcher))).status, 403);
  assert.equal((await call('GET', '/api/audit', undefined, admin(ctx.dispatcher))).status, 403);
});

test('alerts feed shows crashes still counting down and dispatcher messages that failed', async () => {
  await call('POST', '/api/device/crash', { clientEventId: 'live-1', status: 'countdown' }, dev(ctx.key));
  await call('PATCH', '/api/device/crash/del-1', { deliveries: [{ role: 'dispatcher', phoneNumber: '+265999000222', status: 'failed' }] }, dev(ctx.key));
  const alerts = await call('GET', '/api/alerts', undefined, admin(ctx.viewer));
  const types = alerts.body.map((a) => a.type);
  assert.ok(types.includes('crash_in_progress'));
  assert.ok(types.includes('dispatcher_unreached'));
});

test('the live stream needs a login and pushes changes as they happen', async () => {
  const noAuth = await fetch(base + '/api/live/stream');
  assert.equal(noAuth.status, 401);

  const stream = await openStream(ctx.dispatcher);
  try {
    await stream.waitFor((f) => f.event === 'hello');
    await call('POST', '/api/device/crash', { clientEventId: 'stream-1', ref: 'ST4R', status: 'countdown' }, dev(ctx.key));
    const first = await stream.waitFor((f) => f.event === 'incident' && f.data.ref === 'ST4R');
    assert.equal(first.data.status, 'countdown');
    assert.equal(first.data.vehicleName, 'BX9047');

    await call('PATCH', '/api/device/crash/stream-1', { status: 'cancelled', cancelledBy: 'driver' }, dev(ctx.key));
    const cancelled = await stream.waitFor((f) => f.event === 'incident' && f.data.ref === 'ST4R' && f.data.status === 'cancelled');
    assert.equal(cancelled.data.cancelledBy, 'driver');
  } finally {
    stream.close();
  }
});

test('a screen that reconnects with its last id receives what it missed', async () => {
  const first = await openStream(ctx.viewer);
  await first.waitFor((f) => f.event === 'hello');
  await call('POST', '/api/device/crash', { clientEventId: 'gap-0', ref: 'GAP2', status: 'countdown' }, dev(ctx.key));
  const seen = await first.waitFor((f) => f.event === 'incident' && f.data.ref === 'GAP2');
  first.close();

  // The connection is down while two more things happen.
  await call('PATCH', '/api/device/crash/gap-0', { status: 'alert_sent' }, dev(ctx.key));
  await call('POST', '/api/device/crash', { clientEventId: 'gap-1', ref: 'GAP3', status: 'detected' }, dev(ctx.key));

  const second = await openStream(ctx.viewer, seen.id);
  try {
    const caughtUp = await second.waitFor((f) => f.event === 'incident' && f.data.ref === 'GAP2' && f.data.status === 'alert_sent');
    assert.equal(caughtUp.data.status, 'alert_sent');
    await second.waitFor((f) => f.event === 'incident' && f.data.ref === 'GAP3');
  } finally {
    second.close();
  }
});

test('a client position from a wiped database is told to reload', async () => {
  const stream = await openStream(ctx.viewer, 999999999);
  try {
    await stream.waitFor((f) => f.event === 'reset');
  } finally {
    stream.close();
  }
});

test('one account cannot hold unlimited streams open', async () => {
  const held = [];
  try {
    for (let i = 0; i < 5; i++) {
      const s = await openStream(ctx.viewer);
      assert.equal(s.status, 200);
      held.push(s);
    }
    const sixth = await openStream(ctx.viewer);
    assert.equal(sixth.status, 429);
  } finally {
    held.forEach((s) => s.close());
  }
});

test('a database made before this change gets the new columns without losing data', async () => {
  const old = new (require('better-sqlite3'))(':memory:');
  old.exec("CREATE TABLE contacts (id TEXT PRIMARY KEY, vehicle_id TEXT, name TEXT, phone_number TEXT, priority INTEGER DEFAULT 1)");
  old.exec("INSERT INTO contacts VALUES ('c1','v1','Old contact','+265888000111',1)");
  // Same statement the migration uses.
  old.exec("ALTER TABLE contacts ADD COLUMN role TEXT NOT NULL DEFAULT 'next_of_kin'");
  const row = old.prepare('SELECT * FROM contacts').all()[0];
  assert.equal(row.role, 'next_of_kin');
  old.close();
});

// ---- starting point, distance and drive time ----

const http = require('node:http');
const routing = require('../src/utils/routing');

async function withRoutingServer(handler, fn) {
  let hits = 0;
  const srv = http.createServer((req, res) => { hits += 1; handler(req, res); });
  srv.listen(0);
  await once(srv, 'listening');
  const before = process.env.ROUTING_URL;
  process.env.ROUTING_URL = 'http://127.0.0.1:' + srv.address().port;
  routing._cache.clear();
  try { return await fn(() => hits); } finally {
    if (before === undefined) delete process.env.ROUTING_URL; else process.env.ROUTING_URL = before;
    srv.close();
  }
}
const okRoute = (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 12345, duration: 1080 }] })); };

test('every account keeps its own starting point, it is checked, and it can be removed', async () => {
  const adminTok = await makeAdmin('station-admin@test.local', 'admin');
  assert.deepEqual((await call('GET', '/api/live/base', undefined, admin(ctx.dispatcher))).body, { base: null });
  assert.equal((await call('GET', '/api/live/base')).status, 401);

  const set = await call('PUT', '/api/live/base', { label: 'Chilomoni station', latitude: -15.79, longitude: '35.02' }, admin(ctx.dispatcher));
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.base, { label: 'Chilomoni station', latitude: -15.79, longitude: 35.02 });
  assert.equal((await call('GET', '/api/live/base', undefined, admin(ctx.dispatcher))).body.base.label, 'Chilomoni station');

  // Another account is not affected, and even a viewer can keep one (it is a personal setting)
  assert.equal((await call('GET', '/api/live/base', undefined, admin(adminTok))).body.base, null);
  assert.equal((await call('PUT', '/api/live/base', { latitude: -15.4, longitude: 35.3 }, admin(ctx.viewer))).body.base.label, 'My starting point');

  for (const bad of [{ latitude: 91, longitude: 35 }, { latitude: -15, longitude: 181 }, { latitude: 'abc', longitude: 35 }, { longitude: 35 }, { latitude: '', longitude: 35 }]) {
    assert.equal((await call('PUT', '/api/live/base', bad, admin(ctx.dispatcher))).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('GET', '/api/live/base', undefined, admin(ctx.dispatcher))).body.base.label, 'Chilomoni station', 'a refused change leaves it as it was');

  assert.deepEqual((await call('DELETE', '/api/live/base', undefined, admin(ctx.dispatcher))).body, { base: null });
  assert.equal((await call('GET', '/api/live/base', undefined, admin(ctx.dispatcher))).body.base, null);
  await call('DELETE', '/api/live/base', undefined, admin(ctx.viewer));
});

test('route: asks for a starting point first, then gives road distance and time, and reuses the answer', async () => {
  const made = await call('POST', '/api/device/crash', { clientEventId: 'route-1', status: 'alert_sent', latitude: -15.7861, longitude: 35.0058 }, dev(ctx.key));
  const id = made.body.event.id;
  const nothing = await call('POST', '/api/device/crash', { clientEventId: 'route-none', status: 'countdown' }, dev(ctx.key));

  assert.equal((await call('GET', `/api/live/${id}/route`)).status, 401);
  assert.equal((await call('GET', '/api/live/nope/route', undefined, admin(ctx.dispatcher))).status, 404);
  assert.equal((await call('GET', `/api/live/${id}/route`, undefined, admin(ctx.dispatcher))).body.needsBase, true);

  await call('PUT', '/api/live/base', { label: 'Chilomoni station', latitude: -15.79, longitude: 35.02 }, admin(ctx.dispatcher));
  assert.equal((await call('GET', `/api/live/${nothing.body.event.id}/route`, undefined, admin(ctx.dispatcher))).status, 404, 'no location yet');

  await withRoutingServer(okRoute, async (hits) => {
    const first = await call('GET', `/api/live/${id}/route`, undefined, admin(ctx.dispatcher));
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { needsBase: false, from: 'Chilomoni station', distanceKm: 12.3, minutes: 18, source: 'road' });
    await call('GET', `/api/live/${id}/route`, undefined, admin(ctx.dispatcher));
    assert.equal(hits(), 1, 'the second request came from memory');
  });
  await call('DELETE', '/api/live/base', undefined, admin(ctx.dispatcher));
});

test('route: when the routing service fails, gives a labelled straight line estimate instead of an error, and tries again next time', async () => {
  const made = await call('POST', '/api/device/crash', { clientEventId: 'route-2', status: 'alert_sent', latitude: -15.80, longitude: 35.05 }, dev(ctx.key));
  const id = made.body.event.id;
  await call('PUT', '/api/live/base', { label: 'Base', latitude: -15.79, longitude: 35.02 }, admin(ctx.dispatcher));
  const ask = async () => (await call('GET', `/api/live/${id}/route`, undefined, admin(ctx.dispatcher))).body;

  const failures = [
    (req, res) => { res.statusCode = 500; res.end('boom'); },
    (req, res) => { res.end('this is not json'); },
    (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 'NoRoute', routes: [] })); },
    (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 'far', duration: null }] })); }
  ];
  for (const bad of failures) {
    await withRoutingServer(bad, async () => {
      const r = await ask();
      assert.equal(r.source, 'estimate');
      assert.ok(r.distanceKm > 0 && r.minutes >= 1, 'an estimate has numbers');
      assert.ok(r.distanceKm < 15, 'a few kilometres apart, not nonsense: ' + r.distanceKm);
    });
  }

  // an estimate is not kept: as soon as the service answers, the road figure is used
  await withRoutingServer(okRoute, async () => assert.equal((await ask()).source, 'road'));

  // routing switched off on purpose
  routing._cache.clear();
  const before = process.env.ROUTING_URL; process.env.ROUTING_URL = 'off';
  assert.equal((await ask()).source, 'estimate');
  if (before === undefined) delete process.env.ROUTING_URL; else process.env.ROUTING_URL = before;
  await call('DELETE', '/api/live/base', undefined, admin(ctx.dispatcher));
});

test('the straight line estimate is sensible', () => {
  // Blantyre to Lilongwe is about 240 km as the crow flies and about 310 to 340 km by road
  const e = routing.estimate({ lat: -15.7861, lng: 35.0058 }, { lat: -13.9626, lng: 33.7741 });
  assert.ok(e.distanceKm > 300 && e.distanceKm < 380, String(e.distanceKm));
  assert.ok(e.minutes > 440 && e.minutes < 580, String(e.minutes));
  assert.deepEqual(routing.estimate({ lat: -15.7, lng: 35 }, { lat: -15.7, lng: 35 }), { distanceKm: 0, minutes: 1, source: 'estimate' });
});
