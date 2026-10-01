const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');

// The server calls this with onlyIfEmpty, so a brand new database always has a first super admin.
// `npm run seed` calls it without, which creates the SEED_ADMIN_EMAIL account if it is missing.
async function ensureSeedAdmin(options) {
  if (options && options.onlyIfEmpty) {
    const count = Number((await db.get('SELECT COUNT(*) AS n FROM admin_users')).n);
    if (count > 0) return false;
  } else if (await db.get('SELECT id FROM admin_users WHERE email = ?', [config.seedAdminEmail])) {
    console.log('Seed admin already exists, skipping: ' + config.seedAdminEmail);
    return false;
  }

  const usingDefault = config.seedAdminPassword === config.defaultSeedPassword;
  await db.run(
    'INSERT INTO admin_users (id, email, password_hash, role, active, must_change_password, token_version, created_at) VALUES (?, ?, ?, ?, 1, ?, 0, ?)',
    [uuidv4(), config.seedAdminEmail, await bcrypt.hash(config.seedAdminPassword, 10), 'super_admin', usingDefault ? 1 : 0, new Date().toISOString()]
  );

  console.log('Seed admin created: ' + config.seedAdminEmail);
  if (usingDefault) console.log('It uses the default password, which must be changed at first sign in. Set SEED_ADMIN_PASSWORD to choose your own.');
  return true;
}

async function seedDemoData() {
  const count = Number((await db.get('SELECT COUNT(*) AS n FROM vehicles')).n);
  if (count > 0) {
    console.log('Vehicles already exist, skipping demo data seed.');
    return;
  }

  const vehicleId = uuidv4();
  const now = new Date().toISOString();

  await db.run('INSERT INTO vehicles (id, name, arduino_sim_number, status, registered_at) VALUES (?, ?, ?, ?, ?)',
    [vehicleId, 'Demo Vehicle - Toyota Corolla', '+265991000001', 'active', now]);
  await db.run('INSERT INTO contacts (id, vehicle_id, name, phone_number, priority) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), vehicleId, 'Demo Emergency Contact', '+265888000001', 1]);
  await db.run(
    'INSERT INTO sim_statuses (id, vehicle_id, last_heartbeat_at, last_known_balance_text, low_balance_flag, last_checked_at) VALUES (?, ?, ?, ?, 0, ?)',
    [uuidv4(), vehicleId, now, 'Main balance MWK 500, valid until end of month', now]
  );

  console.log('Demo vehicle, contact, and sim status created.');
}

module.exports = { ensureSeedAdmin, seedDemoData };

if (require.main === module) {
  (async () => {
    await db.init();
    await ensureSeedAdmin();
    await seedDemoData();
    await db.close();
  })().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
