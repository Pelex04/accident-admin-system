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
const { ensureJwtSecret, flagDefaultPasswords } = require('../src/utils/security');
const { ensureSeedAdmin } = require('../src/utils/seed');

const STRONG = 'Sturdy-pass-2026';
const ctx = {};
let base, server;

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

before(async () => {
  await db.init();
  await ensureJwtSecret();
  await ensureSeedAdmin({ onlyIfEmpty: true });
  await flagDefaultPasswords();
  server = createApp().listen(0);
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  server.close();
  await db.close();
});

async function signInAndSetPassword(email, password) {
  const login = await call('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.admin.mustChangePassword, true);
  const changed = await call('POST', '/api/auth/change-password', { currentPassword: password, newPassword: STRONG }, login.body.token);
  assert.equal(changed.status, 200);
  return { token: changed.body.token, id: changed.body.admin.id };
}

test('health check works', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('the default password has to be changed before anything else', async () => {
  const login = await call('POST', '/api/auth/login', { email: 'root@test.local', password: 'change_this_password' });
  assert.equal(login.status, 200);
  assert.equal(login.body.admin.mustChangePassword, true);
  assert.equal(login.body.admin.role, 'super_admin');
  const oldToken = login.body.token;

  const blocked = await call('GET', '/api/vehicles', undefined, oldToken);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'password_change_required');

  assert.equal((await call('POST', '/api/auth/change-password', { currentPassword: 'change_this_password', newPassword: 'short' }, oldToken)).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { currentPassword: 'change_this_password', newPassword: 'password123' }, oldToken)).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { currentPassword: 'wrong-current-1', newPassword: STRONG }, oldToken)).status, 400);

  const changed = await call('POST', '/api/auth/change-password', { currentPassword: 'change_this_password', newPassword: STRONG }, oldToken);
  assert.equal(changed.status, 200);
  ctx.root = changed.body.token;
  ctx.rootId = changed.body.admin.id;

  assert.equal((await call('GET', '/api/vehicles', undefined, oldToken)).status, 401, 'old token must stop working');
  const ok = await call('GET', '/api/vehicles', undefined, ctx.root);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, []);
});

test('sign in errors do not reveal which emails exist', async () => {
  const a = await call('POST', '/api/auth/login', { email: 'nobody@test.local', password: STRONG });
  const b = await call('POST', '/api/auth/login', { email: 'root@test.local', password: 'wrong-password-1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
  assert.equal((await call('POST', '/api/auth/login', { email: '', password: '' })).status, 400);
});

test('a super admin can create a viewer and an admin', async () => {
  const v = await call('POST', '/api/admins', { email: 'Viewer@Test.local', role: 'viewer' }, ctx.root);
  assert.equal(v.status, 201);
  assert.equal(v.body.admin.email, 'viewer@test.local');
  assert.equal(typeof v.body.temporaryPassword, 'string');
  const a = await call('POST', '/api/admins', { email: 'admin@test.local', role: 'admin' }, ctx.root);
  assert.equal(a.status, 201);

  assert.equal((await call('POST', '/api/admins', { email: 'admin@test.local', role: 'admin' }, ctx.root)).status, 409);
  assert.equal((await call('POST', '/api/admins', { email: 'x@test.local', role: 'boss' }, ctx.root)).status, 400);
  assert.equal((await call('POST', '/api/admins', { email: 'not-an-email', role: 'viewer' }, ctx.root)).status, 400);

  const viewer = await signInAndSetPassword('viewer@test.local', v.body.temporaryPassword);
  const admin = await signInAndSetPassword('admin@test.local', a.body.temporaryPassword);
  ctx.viewer = viewer.token; ctx.viewerId = viewer.id;
  ctx.admin = admin.token;
});

test('roles are enforced', async () => {
  assert.equal((await call('GET', '/api/vehicles', undefined, ctx.viewer)).status, 200);
  const denied = await call('POST', '/api/vehicles', { name: 'Truck', arduinoSimNumber: '+265991234567' }, ctx.viewer);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'forbidden');

  const made = await call('POST', '/api/vehicles', { name: '  Truck 1  ', arduinoSimNumber: '+265991234567' }, ctx.admin);
  assert.equal(made.status, 201);
  assert.equal(made.body.name, 'Truck 1');
  assert.equal(made.body.arduinoSimNumber, '+265991234567');
  assert.equal(made.body.status, 'active');
  assert.ok(made.body.registeredAt);
  ctx.vehicleId = made.body.id;

  assert.equal((await call('GET', '/api/admins', undefined, ctx.admin)).status, 403);
  assert.equal((await call('GET', '/api/audit', undefined, ctx.admin)).status, 403);
  assert.equal((await call('GET', '/api/admins', undefined, ctx.viewer)).status, 403);
  assert.equal((await call('GET', '/api/alerts', undefined, ctx.viewer)).status, 200);
  assert.equal((await call('GET', '/api/vehicles')).status, 401);
});

test('vehicle input is validated', async () => {
  assert.equal((await call('POST', '/api/vehicles', { name: 'No sim' }, ctx.admin)).status, 400);
  assert.equal((await call('POST', '/api/vehicles', { name: 'Bad', arduinoSimNumber: 'abc' }, ctx.admin)).status, 400);
  assert.equal((await call('POST', '/api/vehicles', { name: 'x'.repeat(121), arduinoSimNumber: '+265991111111' }, ctx.admin)).status, 400);
  assert.equal((await call('POST', '/api/vehicles', { name: 'Dup', arduinoSimNumber: '+265 991 234567' }, ctx.admin)).status, 409);

  assert.equal((await call('PUT', '/api/vehicles/' + ctx.vehicleId, { status: 'broken' }, ctx.admin)).status, 400);
  const off = await call('PUT', '/api/vehicles/' + ctx.vehicleId, { status: 'inactive' }, ctx.admin);
  assert.equal(off.status, 200);
  assert.equal(off.body.status, 'inactive');
  assert.equal((await call('GET', '/api/vehicles/' + ctx.vehicleId, undefined, ctx.viewer)).body.name, 'Truck 1');
  assert.equal((await call('GET', '/api/vehicles/nope', undefined, ctx.viewer)).status, 404);
});

test('contacts can be added, ordered, edited and removed', async () => {
  const path = '/api/vehicles/' + ctx.vehicleId + '/contacts';
  const mum = await call('POST', path, { name: 'Mum', phoneNumber: '+265888111222', priority: 2 }, ctx.admin);
  assert.equal(mum.status, 201);
  assert.equal(mum.body.vehicleId, ctx.vehicleId);
  assert.equal(mum.body.priority, 2);
  const dad = await call('POST', path, { name: 'Dad', phoneNumber: '+265888333444' }, ctx.admin);
  assert.equal(dad.body.priority, 1);
  assert.equal((await call('POST', path, { name: 'Bad', phoneNumber: '+265888555666', priority: 0 }, ctx.admin)).status, 400);
  assert.equal((await call('POST', path, { name: 'Bad', phoneNumber: 'nope' }, ctx.admin)).status, 400);

  const list = await call('GET', path, undefined, ctx.viewer);
  assert.deepEqual(list.body.map((c) => c.name), ['Dad', 'Mum']);

  const edited = await call('PUT', '/api/contacts/' + mum.body.id, { priority: 1 }, ctx.admin);
  assert.equal(edited.body.priority, 1);
  assert.equal((await call('DELETE', '/api/contacts/' + dad.body.id, undefined, ctx.admin)).status, 204);
  assert.equal((await call('GET', path, undefined, ctx.viewer)).body.length, 1);
  assert.equal((await call('DELETE', '/api/contacts/nope', undefined, ctx.admin)).status, 404);
});

test('crash events: create, validate, update, filter', async () => {
  const made = await call('POST', '/api/events', { vehicleId: ctx.vehicleId, latitude: -15.78, longitude: 35.0, notes: 'Heavy impact' }, ctx.admin);
  assert.equal(made.status, 201);
  assert.equal(made.body.status, 'detected');
  assert.equal(made.body.latitude, -15.78);
  assert.equal(made.body.cancelledBy, null);
  ctx.eventId = made.body.id;

  assert.equal((await call('POST', '/api/events', { vehicleId: ctx.vehicleId, latitude: 123, longitude: 0 }, ctx.admin)).status, 400);
  assert.equal((await call('POST', '/api/events', { vehicleId: 'missing' }, ctx.admin)).status, 404);
  assert.equal((await call('POST', '/api/events', {}, ctx.admin)).status, 400);
  assert.equal((await call('PUT', '/api/events/' + ctx.eventId, { status: 'nonsense' }, ctx.admin)).status, 400);

  const failed = await call('PUT', '/api/events/' + ctx.eventId, { status: 'alert_failed', notes: 'Carrier error' }, ctx.admin);
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, 'alert_failed');
  assert.equal(failed.body.notes, 'Carrier error');

  const filtered = await call('GET', '/api/events?status=alert_failed&vehicleId=' + ctx.vehicleId, undefined, ctx.viewer);
  assert.equal(filtered.body.length, 1);
  assert.equal((await call('GET', '/api/events?status=cancelled', undefined, ctx.viewer)).body.length, 0);
  assert.equal((await call('GET', '/api/events/' + ctx.eventId, undefined, ctx.viewer)).body.id, ctx.eventId);
  assert.equal((await call('GET', '/api/events/nope', undefined, ctx.viewer)).status, 404);
});

test('SIM heartbeats and alerts', async () => {
  const path = '/api/sim/' + ctx.vehicleId;
  const first = await call('POST', path + '/heartbeat', { balanceText: 'Low balance, please top up' }, ctx.admin);
  assert.equal(first.status, 201);
  assert.equal(first.body.lowBalanceFlag, true);
  assert.equal(first.body.vehicleId, ctx.vehicleId);

  const ok = await call('POST', path + '/heartbeat', { balanceText: 'Main balance MWK 500' }, ctx.admin);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lowBalanceFlag, false);
  assert.equal((await call('POST', path + '/heartbeat', { balanceText: 'recharge now' }, ctx.admin)).body.lowBalanceFlag, true);
  assert.equal((await call('POST', '/api/sim/missing/heartbeat', {}, ctx.admin)).status, 404);

  const alerts = (await call('GET', '/api/alerts', undefined, ctx.viewer)).body.map((a) => a.type);
  assert.ok(alerts.includes('low_balance'));
  assert.ok(alerts.includes('crash_alert_failed'));

  assert.equal((await call('POST', path + '/mark-topped-up', {}, ctx.viewer)).status, 403);
  const topped = await call('POST', path + '/mark-topped-up', {}, ctx.admin);
  assert.equal(topped.body.lowBalanceFlag, false);
  assert.equal((await call('GET', '/api/sim', undefined, ctx.viewer)).body.length, 1);
});

test('deleting a vehicle removes its contacts and SIM status but keeps crash history', async () => {
  assert.equal((await call('DELETE', '/api/vehicles/' + ctx.vehicleId, undefined, ctx.viewer)).status, 403);
  assert.equal((await call('DELETE', '/api/vehicles/' + ctx.vehicleId, undefined, ctx.admin)).status, 204);
  assert.equal((await call('GET', '/api/sim/' + ctx.vehicleId, undefined, ctx.viewer)).status, 404);
  assert.equal((await call('GET', '/api/vehicles/' + ctx.vehicleId + '/contacts', undefined, ctx.viewer)).body.length, 0);
  assert.equal((await call('GET', '/api/events', undefined, ctx.viewer)).body.length, 1);
});

test('the audit log records who did what, for super admins only', async () => {
  const all = await call('GET', '/api/audit?limit=500', undefined, ctx.root);
  assert.equal(all.status, 200);
  const actions = all.body.map((e) => e.action);
  for (const wanted of ['auth.login', 'auth.password_changed', 'admin.create', 'vehicle.create', 'vehicle.delete', 'event.update', 'contact.create', 'sim.topped_up']) {
    assert.ok(actions.includes(wanted), 'missing audit action ' + wanted);
  }
  const created = all.body.find((e) => e.action === 'vehicle.create');
  assert.equal(created.adminEmail, 'admin@test.local');
  assert.ok(created.at && created.entityId);

  const onlyVehicle = await call('GET', '/api/audit?action=vehicle', undefined, ctx.root);
  assert.ok(onlyVehicle.body.length >= 2 && onlyVehicle.body.every((e) => e.action.startsWith('vehicle')));
});

test('repeated failed sign ins for one email are rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await call('POST', '/api/auth/login', { email: 'ghost@test.local', password: 'wrong-password-1' })).status);
  }
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
  assert.equal(statuses[8], 429);
  assert.equal(statuses[9], 429);
});

test('super admin safeguards and session invalidation', async () => {
  assert.equal((await call('PUT', '/api/admins/' + ctx.rootId, { role: 'viewer' }, ctx.root)).status, 400);
  assert.equal((await call('DELETE', '/api/admins/' + ctx.rootId, undefined, ctx.root)).status, 400);

  const reset = await call('POST', '/api/admins/' + ctx.viewerId + '/reset-password', {}, ctx.root);
  assert.equal(reset.status, 200);
  assert.equal((await call('GET', '/api/vehicles', undefined, ctx.viewer)).status, 401, 'reset must end the old session');

  const login = await call('POST', '/api/auth/login', { email: 'viewer@test.local', password: reset.body.temporaryPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.admin.mustChangePassword, true);

  const off = await call('PUT', '/api/admins/' + ctx.viewerId, { active: false }, ctx.root);
  assert.equal(off.body.active, false);
  assert.equal((await call('GET', '/api/auth/me', undefined, login.body.token)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'viewer@test.local', password: reset.body.temporaryPassword })).status, 401);

  assert.equal((await call('DELETE', '/api/admins/' + ctx.viewerId, undefined, ctx.root)).status, 204);
  const list = await call('GET', '/api/admins', undefined, ctx.root);
  assert.deepEqual(list.body.map((a) => a.email).sort(), ['admin@test.local', 'root@test.local']);
});

test('malformed JSON gets a clear 400', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});
