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
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}
const admin = (token) => ({ Authorization: 'Bearer ' + token });
const dev = (key) => ({ 'X-Device-Key': key });

before(async () => {
  await db.init();
  await ensureJwtSecret();
  await ensureSeedAdmin({ onlyIfEmpty: true });
  server = createApp().listen(0);
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;

  const login = await call('POST', '/api/auth/login', { email: 'root@test.local', password: 'change_this_password' });
  const changed = await call('POST', '/api/auth/change-password', { currentPassword: 'change_this_password', newPassword: STRONG }, admin(login.body.token));
  ctx.root = changed.body.token;

  const viewer = await call('POST', '/api/admins', { email: 'viewer@test.local', role: 'viewer' }, admin(ctx.root));
  const vl = await call('POST', '/api/auth/login', { email: 'viewer@test.local', password: viewer.body.temporaryPassword });
  ctx.viewer = (await call('POST', '/api/auth/change-password', { currentPassword: viewer.body.temporaryPassword, newPassword: STRONG }, admin(vl.body.token))).body.token;

  const v1 = await call('POST', '/api/vehicles', { name: 'Truck 1', arduinoSimNumber: '+265991111111' }, admin(ctx.root));
  const v2 = await call('POST', '/api/vehicles', { name: 'Truck 2', arduinoSimNumber: '+265992222222' }, admin(ctx.root));
  ctx.v1 = v1.body.id; ctx.v2 = v2.body.id;
  await call('POST', `/api/vehicles/${ctx.v1}/contacts`, { name: 'Mum', phoneNumber: '+265888111222', priority: 2 }, admin(ctx.root));
  await call('POST', `/api/vehicles/${ctx.v1}/contacts`, { name: 'Dad', phoneNumber: '+265888333444', priority: 1 }, admin(ctx.root));
});

after(async () => {
  server.close();
  await db.close();
});

test('device keys: created by admins, shown once, never stored in the clear', async () => {
  const none = await call('GET', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.viewer));
  assert.deepEqual(none.body, { exists: false });

  assert.equal((await call('POST', `/api/vehicles/${ctx.v1}/device-key`, {}, admin(ctx.viewer))).status, 403, 'viewers cannot create keys');
  assert.equal((await call('POST', '/api/vehicles/nope/device-key', {}, admin(ctx.root))).status, 404);

  const made = await call('POST', `/api/vehicles/${ctx.v1}/device-key`, {}, admin(ctx.root));
  assert.equal(made.status, 201);
  assert.match(made.body.deviceKey, /^dk_[A-Za-z0-9_-]{43}$/);
  assert.equal(made.body.prefix, made.body.deviceKey.slice(0, 7));
  assert.equal(made.headers.get('cache-control'), 'no-store');
  ctx.key1 = made.body.deviceKey;

  const info = await call('GET', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.viewer));
  assert.equal(info.body.exists, true);
  assert.equal(info.body.prefix, ctx.key1.slice(0, 7));
  assert.equal(info.body.lastUsedAt, null);
  assert.ok(!JSON.stringify(info.body).includes(ctx.key1), 'the key is not returned again');

  const stored = await db.all('SELECT * FROM device_keys');
  assert.ok(!JSON.stringify(stored).includes(ctx.key1), 'the database does not hold the key');
  assert.equal(stored[0].key_hash.length, 64);

  const v2 = await call('POST', `/api/vehicles/${ctx.v2}/device-key`, {}, admin(ctx.root));
  ctx.key2 = v2.body.deviceKey;
  assert.notEqual(ctx.key1, ctx.key2);
});

test('device auth: only a valid device key opens device routes, and device keys open nothing else', async () => {
  const none = await call('GET', '/api/device/me');
  assert.equal(none.status, 401);
  assert.equal(none.body.code, 'invalid_device_key');
  assert.equal((await call('GET', '/api/device/me', undefined, dev('dk_wrong'))).status, 401);
  assert.equal((await call('GET', '/api/device/me', undefined, dev('not-a-key'))).status, 401);
  assert.equal((await call('GET', '/api/device/me', undefined, admin(ctx.root))).status, 401, 'an admin login is not a device key');
  assert.equal((await call('GET', '/api/device/me', undefined, dev(ctx.root))).status, 401);

  assert.equal((await call('GET', '/api/device/me', undefined, dev(ctx.key1))).status, 200);
  assert.equal((await call('GET', '/api/device/me', undefined, { Authorization: 'Device ' + ctx.key1 })).status, 200, 'Authorization: Device <key> works too');

  for (const path of ['/api/vehicles', '/api/events', '/api/admins', '/api/audit', '/api/sim']) {
    assert.equal((await call('GET', path, undefined, dev(ctx.key1))).status, 401, path + ' must not accept a device key');
    assert.equal((await call('GET', path, undefined, { Authorization: 'Bearer ' + ctx.key1 })).status, 401);
  }
});

test('device me: the vehicle, its contacts in priority order and settings', async () => {
  const me = await call('GET', '/api/device/me', undefined, dev(ctx.key1));
  assert.equal(me.body.vehicle.id, ctx.v1);
  assert.equal(me.body.vehicle.name, 'Truck 1');
  assert.deepEqual(me.body.contacts.map((c) => c.name), ['Dad', 'Mum']);
  assert.equal(me.body.settings.recommendedHeartbeatMinutes, 60);
  assert.ok(!Number.isNaN(Date.parse(me.body.serverTime)));
  const other = await call('GET', '/api/device/me', undefined, dev(ctx.key2));
  assert.equal(other.body.vehicle.id, ctx.v2);
  assert.equal(other.body.contacts.length, 0, 'a device never sees another vehicle\'s contacts');
});

test('device heartbeat: records the check in and keeps the low balance flag when no text is sent', async () => {
  const hb = await call('POST', '/api/device/heartbeat', { balanceText: 'Low balance, please top up' }, dev(ctx.key1));
  assert.equal(hb.status, 200);
  assert.equal(hb.body.ok, true);
  assert.equal(hb.body.lowBalance, true);

  const plain = await call('POST', '/api/device/heartbeat', {}, dev(ctx.key1));
  assert.equal(plain.body.lowBalance, true, 'a plain check in must not clear the flag');
  assert.equal((await call('POST', '/api/device/heartbeat', undefined, dev(ctx.key1))).status, 200, 'an empty body is fine');

  const ok = await call('POST', '/api/device/heartbeat', { balanceText: 'Main balance MWK 900' }, dev(ctx.key1));
  assert.equal(ok.body.lowBalance, false);

  assert.equal((await call('POST', '/api/device/heartbeat', { balanceText: 42 }, dev(ctx.key1))).status, 400);
  assert.equal((await call('POST', '/api/device/heartbeat', '[]', dev(ctx.key1))).status, 400);

  const sim = await call('GET', `/api/sim/${ctx.v1}`, undefined, admin(ctx.viewer));
  assert.equal(sim.status, 200);
  assert.equal(sim.body.lastKnownBalanceText, 'Main balance MWK 900');
});

test('device crash: create, retry safely, and never lose a report over a bad optional field', async () => {
  const first = await call('POST', '/api/device/crash', { clientEventId: 'phone-1', latitude: -15.78, longitude: 35.0, status: 'countdown', notes: 'Sensor trigger' }, dev(ctx.key1));
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.deepEqual(first.body.warnings, []);
  assert.equal(first.body.event.status, 'countdown');
  assert.equal(first.body.event.vehicleId, ctx.v1);
  assert.equal(first.body.event.latitude, -15.78);
  ctx.eventId = first.body.event.id;

  const retry = await call('POST', '/api/device/crash', { clientEventId: 'phone-1', latitude: 1, longitude: 1 }, dev(ctx.key1));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.event.id, ctx.eventId);
  assert.equal(retry.body.event.latitude, -15.78, 'a retry does not change the saved report');
  assert.equal((await db.all('SELECT id FROM crash_events WHERE vehicle_id = ?', [ctx.v1])).length, 1);

  const sameIdOtherVehicle = await call('POST', '/api/device/crash', { clientEventId: 'phone-1' }, dev(ctx.key2));
  assert.equal(sameIdOtherVehicle.status, 201, 'client ids are separate per vehicle');
  assert.notEqual(sameIdOtherVehicle.body.event.id, ctx.eventId);

  const messy = await call('POST', '/api/device/crash', { clientEventId: 'phone-2', latitude: 999, longitude: 35, detectedAt: 'yesterday-ish', notes: 12345 }, dev(ctx.key1));
  assert.equal(messy.status, 201, 'the crash is saved anyway');
  assert.equal(messy.body.event.latitude, null);
  assert.equal(messy.body.event.longitude, null);
  assert.equal(messy.body.event.notes, '');
  assert.ok(messy.body.warnings.length >= 3);
  assert.ok(Date.now() - Date.parse(messy.body.event.detectedAt) < 60_000, 'server time was used');

  const strings = await call('POST', '/api/device/crash', { latitude: '-13.9626', longitude: '33.7741' }, dev(ctx.key1));
  assert.equal(strings.body.event.latitude, -13.9626, 'numeric strings are accepted');
  assert.equal(strings.body.event.status, 'detected');

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const late = await call('POST', '/api/device/crash', { detectedAt: hourAgo, status: 'alert_sent' }, dev(ctx.key1));
  assert.equal(late.body.event.detectedAt, hourAgo, 'a report sent later keeps the time of the crash');
  assert.equal(late.body.event.status, 'alert_sent');
  const ancient = await call('POST', '/api/device/crash', { detectedAt: '2001-01-01T00:00:00Z' }, dev(ctx.key1));
  assert.ok(ancient.body.warnings.some((w) => w.includes('detectedAt')));
  const half = await call('POST', '/api/device/crash', { latitude: -15.7 }, dev(ctx.key1));
  assert.equal(half.body.event.latitude, null, 'half a location is dropped');

  assert.equal((await call('POST', '/api/device/crash', { status: 'exploded' }, dev(ctx.key1))).status, 400);
  assert.equal((await call('POST', '/api/device/crash', { clientEventId: 'has spaces!' }, dev(ctx.key1))).status, 400);
  assert.equal((await call('POST', '/api/device/crash', { clientEventId: 'x'.repeat(65) }, dev(ctx.key1))).status, 400);
  assert.equal((await call('POST', '/api/device/crash', '[]', dev(ctx.key1))).status, 400);
  assert.equal((await call('POST', '/api/device/crash', '{bad json', dev(ctx.key1))).status, 400);
});

test('device crash: update its own reports by server id or by its own id, never another vehicle\'s', async () => {
  const done = await call('PATCH', `/api/device/crash/${ctx.eventId}`, { status: 'alert_sent', notes: 'SMS sent to 2 contacts' }, dev(ctx.key1));
  assert.equal(done.status, 200);
  assert.equal(done.body.event.status, 'alert_sent');
  assert.equal(done.body.event.notes, 'SMS sent to 2 contacts');

  const byClientId = await call('PATCH', '/api/device/crash/phone-2', { status: 'cancelled', cancelledBy: 'user' }, dev(ctx.key1));
  assert.equal(byClientId.status, 200);
  assert.equal(byClientId.body.event.status, 'cancelled');
  assert.equal(byClientId.body.event.cancelledBy, 'user');

  const located = await call('PATCH', `/api/device/crash/${ctx.eventId}`, { latitude: -15.5, longitude: 35.1 }, dev(ctx.key1));
  assert.equal(located.body.event.latitude, -15.5);
  assert.equal(located.body.event.status, 'alert_sent', 'fields that are not sent stay as they were');

  assert.equal((await call('PATCH', `/api/device/crash/${ctx.eventId}`, { status: 'nope' }, dev(ctx.key1))).status, 400);
  assert.equal((await call('PATCH', `/api/device/crash/${ctx.eventId}`, { status: 'cancelled' }, dev(ctx.key2))).status, 404, 'another vehicle cannot touch it');
  assert.equal((await call('GET', `/api/device/crash/${ctx.eventId}`, undefined, dev(ctx.key2))).status, 404);
  assert.equal((await call('PATCH', '/api/device/crash/does-not-exist', { status: 'cancelled' }, dev(ctx.key1))).status, 404);

  assert.equal((await call('GET', `/api/device/crash/${ctx.eventId}`, undefined, dev(ctx.key1))).body.event.status, 'alert_sent');
  const list = await call('GET', '/api/device/crashes?limit=3', undefined, dev(ctx.key1));
  assert.equal(list.body.events.length, 3);
  assert.ok(list.body.events.every((e) => e.vehicleId === ctx.v1));
  const stillOne = await call('GET', `/api/device/crash/${ctx.eventId}`, undefined, dev(ctx.key2));
  assert.equal(stillOne.status, 404);
});

test('admins see what devices report, and the audit log names the device', async () => {
  const events = await call('GET', '/api/events?vehicleId=' + ctx.v1, undefined, admin(ctx.viewer));
  assert.ok(events.body.some((e) => e.id === ctx.eventId && e.status === 'alert_sent'));

  const audit = await call('GET', '/api/audit?limit=500', undefined, admin(ctx.root));
  const fromDevice = audit.body.filter((e) => e.adminEmail === 'device:' + ctx.key1.slice(0, 7));
  assert.ok(fromDevice.some((e) => e.action === 'event.create'));
  assert.ok(fromDevice.some((e) => e.action === 'event.update'));
  assert.ok(audit.body.some((e) => e.action === 'device_key.create' && e.adminEmail === 'root@test.local'));

  const info = await call('GET', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.root));
  assert.ok(info.body.lastUsedAt, 'last used is tracked');
});

test('an inactive vehicle can still report, because a crash must never be refused', async () => {
  await call('PUT', `/api/vehicles/${ctx.v2}`, { status: 'inactive' }, admin(ctx.root));
  const me = await call('GET', '/api/device/me', undefined, dev(ctx.key2));
  assert.equal(me.body.vehicle.status, 'inactive');
  assert.equal((await call('POST', '/api/device/heartbeat', {}, dev(ctx.key2))).status, 200);
  assert.equal((await call('POST', '/api/device/crash', { clientEventId: 'late-1' }, dev(ctx.key2))).status, 201);
});

test('regenerating a key ends the old one at once, revoking ends access', async () => {
  const again = await call('POST', `/api/vehicles/${ctx.v1}/device-key`, {}, admin(ctx.root));
  assert.equal(again.status, 201);
  const oldKey = ctx.key1;
  ctx.key1 = again.body.deviceKey;
  assert.equal((await call('GET', '/api/device/me', undefined, dev(oldKey))).status, 401);
  assert.equal((await call('GET', '/api/device/me', undefined, dev(ctx.key1))).status, 200);
  assert.equal((await call('GET', `/api/device/crash/${ctx.eventId}`, undefined, dev(ctx.key1))).status, 200, 'history carries over to the new key');

  assert.equal((await call('DELETE', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.viewer))).status, 403);
  assert.equal((await call('DELETE', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.root))).status, 204);
  assert.equal((await call('GET', '/api/device/me', undefined, dev(ctx.key1))).status, 401);
  assert.equal((await call('DELETE', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.root))).status, 404);
  assert.deepEqual((await call('GET', `/api/vehicles/${ctx.v1}/device-key`, undefined, admin(ctx.root))).body, { exists: false });
});

test('deleting a vehicle removes its key', async () => {
  assert.equal((await call('DELETE', `/api/vehicles/${ctx.v2}`, undefined, admin(ctx.root))).status, 204);
  assert.equal((await call('GET', '/api/device/me', undefined, dev(ctx.key2))).status, 401);
  assert.equal((await db.all('SELECT * FROM device_keys')).length, 0);
  assert.equal((await db.all('SELECT * FROM device_event_ids WHERE vehicle_id = ?', [ctx.v2])).length, 0);
});

test('a device that sends too many requests is slowed down, and guessing keys is limited', async () => {
  require('../src/config').deviceMaxPer10Min = 12; // only this test uses a low cap
  const v3 = await call('POST', '/api/vehicles', { name: 'Truck 3', arduinoSimNumber: '+265993333333' }, admin(ctx.root));
  const key3 = (await call('POST', `/api/vehicles/${v3.body.id}/device-key`, {}, admin(ctx.root))).body.deviceKey;

  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await call('GET', '/api/device/me', undefined, dev(key3))).status);
  assert.deepEqual(statuses.slice(0, 12), Array(12).fill(200));
  const limited = await call('GET', '/api/device/me', undefined, dev(key3));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    const r = await call('GET', '/api/device/me', undefined, dev('dk_guess' + i));
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked > 0, 'repeated wrong keys from one address get blocked');
});
