const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
const file = path.join(dir, 'db.json');
process.env.DB_PATH = ':memory:';
process.env.LEGACY_DB_FILE = file;

fs.writeFileSync(file, JSON.stringify({
  adminUsers: [{ id: 'a1', email: 'Old@Admin.test', passwordHash: bcrypt.hashSync('Legacy-pass-123', 10), role: 'super_admin', createdAt: '2025-01-01T00:00:00.000Z' }],
  vehicles: [{ id: 'v1', name: 'Old car', arduinoSimNumber: '+265991000009', status: 'active', registeredAt: '2025-01-02T00:00:00.000Z' }],
  contacts: [
    { id: 'c1', vehicleId: 'v1', name: 'A', phoneNumber: '+265888000009', priority: 1 },
    { id: 'c2', vehicleId: 'gone', name: 'Orphan', phoneNumber: '+265888000010', priority: 1 }
  ],
  crashEvents: [{ id: 'e1', vehicleId: 'v1', detectedAt: '2025-02-01T10:00:00.000Z', latitude: -15.7, longitude: 35.0, status: 'alert_sent', cancelledBy: null, notes: 'x' }],
  simStatuses: [{ id: 's1', vehicleId: 'v1', lastHeartbeatAt: '2025-02-01T10:00:00.000Z', lastKnownBalanceText: 'ok', lowBalanceFlag: false, lastCheckedAt: '2025-02-01T10:00:00.000Z' }]
}));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

test('old JSON data is imported once and the file is set aside', async () => {
  await db.init();
  const count = async (t) => Number((await db.get('SELECT COUNT(*) AS n FROM ' + t)).n);

  assert.equal(await count('admin_users'), 1);
  assert.equal(await count('vehicles'), 1);
  assert.equal(await count('contacts'), 1, 'orphan contact is skipped');
  assert.equal(await count('crash_events'), 1);
  assert.equal(await count('sim_statuses'), 1);

  const admin = await db.get('SELECT * FROM admin_users');
  assert.equal(admin.email, 'old@admin.test');
  assert.equal(admin.role, 'super_admin');
  assert.ok(await bcrypt.compare('Legacy-pass-123', admin.password_hash), 'password hash survives the move');

  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(file + '.imported'), true);

  await db.init();
  assert.equal(await count('vehicles'), 1, 'second start does not import again');
  await db.close();
});
