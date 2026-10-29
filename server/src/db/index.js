// One small data layer for two engines: PostgreSQL when DATABASE_URL is set (use this in
// production, the data survives redeploys), otherwise a local SQLite file for development.
// SQL is written with ? placeholders and converted for PostgreSQL.
const fs = require('fs');
const path = require('path');

const dialect = process.env.DATABASE_URL ? 'postgres' : 'sqlite';

const clean = (params) =>
  (params || []).map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

function makePostgres() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const local = /(localhost|127\.0\.0\.1)/.test(url) || /sslmode=disable/.test(url) || process.env.PGSSL === 'disable';
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 10 });
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  const toPg = (sql) => { let n = 0; return sql.replace(/\?/g, () => '$' + ++n); };
  const bind = (target) => ({
    all: async (sql, params) => (await target.query(toPg(sql), clean(params))).rows,
    run: async (sql, params) => ({ changes: (await target.query(toPg(sql), clean(params))).rowCount })
  });
  return {
    ...bind(pool),
    exec: async (sql) => { await pool.query(sql); },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(bind(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

function makeSqlite() {
  const Database = require('better-sqlite3');
  const file = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('foreign_keys = ON');
  if (file !== ':memory:') conn.pragma('journal_mode = WAL');
  const base = {
    all: async (sql, params) => conn.prepare(sql).all(...clean(params)),
    run: async (sql, params) => ({ changes: conn.prepare(sql).run(...clean(params)).changes })
  };
  let chain = Promise.resolve(); // transactions run one at a time on the single connection
  return {
    ...base,
    exec: async (sql) => { conn.exec(sql); },
    transaction: (fn) => {
      const next = chain.then(async () => {
        conn.exec('BEGIN');
        try {
          const out = await fn(base);
          conn.exec('COMMIT');
          return out;
        } catch (err) {
          conn.exec('ROLLBACK');
          throw err;
        }
      });
      chain = next.catch(() => {});
      return next;
    },
    close: async () => conn.close()
  };
}

const driver = dialect === 'postgres' ? makePostgres() : makeSqlite();

const SEQ_COLUMN = dialect === 'postgres' ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    arduino_sim_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    registered_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS crash_events (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status TEXT NOT NULL,
    cancelled_by TEXT,
    notes TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS sim_statuses (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
    last_heartbeat_at TEXT,
    last_checked_at TEXT,
    last_known_balance_text TEXT NOT NULL DEFAULT '',
    low_balance_flag INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    admin_id TEXT,
    admin_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    summary TEXT,
    ip TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS device_keys (
    vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT,
    last_used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS device_event_ids (
    vehicle_id TEXT NOT NULL,
    client_event_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    PRIMARY KEY (vehicle_id, client_event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  // Who was told about a crash and whether the message got through (one row per recipient number).
  `CREATE TABLE IF NOT EXISTS alert_deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    role TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (event_id, phone_number)
  )`,
  // Append-only list of "this crash changed". The live dashboard stream reads it, so a screen that
  // lost its connection can catch up on what it missed instead of silently showing old data.
  `CREATE TABLE IF NOT EXISTS change_log (
    seq ${SEQ_COLUMN},
    at TEXT NOT NULL,
    event_id TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_event ON alert_deliveries (event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rate_expires ON rate_limits (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_vehicle ON crash_events (vehicle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_detected ON crash_events (detected_at)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_vehicle ON contacts (vehicle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at)`
];

const db = {
  dialect,
  all: (sql, params) => driver.all(sql, params),
  get: async (sql, params) => (await driver.all(sql, params))[0] || null,
  run: (sql, params) => driver.run(sql, params),
  transaction: (fn) => driver.transaction(async (tx) => fn({ ...tx, get: async (s, p) => (await tx.all(s, p))[0] || null })),
  close: () => driver.close(),

  async init() {
    for (const statement of SCHEMA) await driver.exec(statement);
    // Columns added after the first release. Safe to run on every start.
    await addColumn('contacts', 'role', "TEXT NOT NULL DEFAULT 'next_of_kin'");
    await addColumn('crash_events', 'ref', 'TEXT');
    await addColumn('crash_events', 'updated_at', 'TEXT');
    await addColumn('crash_events', 'acknowledged_at', 'TEXT');
    await addColumn('crash_events', 'acknowledged_by', 'TEXT');
    // Where each dispatcher's distances are measured from.
    await addColumn('admin_users', 'base_label', 'TEXT');
    await addColumn('admin_users', 'base_lat', 'DOUBLE PRECISION');
    await addColumn('admin_users', 'base_lng', 'DOUBLE PRECISION');
    await importLegacyJson();
  }
};

async function addColumn(table, column, definition) {
  if (dialect === 'postgres') {
    await driver.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    return;
  }
  const columns = await driver.all(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) await driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// One time import of the old data/db.json file (used before the database existed).
async function importLegacyJson() {
  const file = process.env.LEGACY_DB_FILE || path.join(__dirname, '..', '..', 'data', 'db.json');
  if (!fs.existsSync(file)) return;

  const counts = await db.get('SELECT (SELECT COUNT(*) FROM admin_users) AS a, (SELECT COUNT(*) FROM vehicles) AS v');
  if (Number(counts.a) > 0 || Number(counts.v) > 0) return;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf-8').trim() || '{}');
  } catch (err) {
    console.error('Could not read the legacy data file, skipping import: ' + err.message);
    return;
  }

  const now = new Date().toISOString();
  const list = (k) => (Array.isArray(state[k]) ? state[k] : []);
  const vehicleIds = new Set(list('vehicles').map((v) => v.id));

  await db.transaction(async (tx) => {
    for (const a of list('adminUsers')) {
      if (!a.id || !a.email || !a.passwordHash) continue;
      await tx.run(
        'INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
        [a.id, String(a.email).toLowerCase(), a.passwordHash, a.role === 'super_admin' ? 'super_admin' : 'admin', a.createdAt || now]
      );
    }
    for (const v of list('vehicles')) {
      await tx.run(
        'INSERT INTO vehicles (id, name, arduino_sim_number, status, registered_at) VALUES (?, ?, ?, ?, ?)',
        [v.id, v.name, v.arduinoSimNumber, v.status || 'active', v.registeredAt || now]
      );
    }
    for (const c of list('contacts')) {
      if (!vehicleIds.has(c.vehicleId)) continue;
      await tx.run(
        'INSERT INTO contacts (id, vehicle_id, name, phone_number, priority) VALUES (?, ?, ?, ?, ?)',
        [c.id, c.vehicleId, c.name, c.phoneNumber, Number(c.priority) || 1]
      );
    }
    for (const e of list('crashEvents')) {
      await tx.run(
        'INSERT INTO crash_events (id, vehicle_id, detected_at, latitude, longitude, status, cancelled_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.vehicleId, e.detectedAt || now, e.latitude, e.longitude, e.status || 'detected', e.cancelledBy, e.notes || '']
      );
    }
    for (const s of list('simStatuses')) {
      if (!vehicleIds.has(s.vehicleId)) continue;
      await tx.run(
        'INSERT INTO sim_statuses (id, vehicle_id, last_heartbeat_at, last_checked_at, last_known_balance_text, low_balance_flag) VALUES (?, ?, ?, ?, ?, ?)',
        [s.id, s.vehicleId, s.lastHeartbeatAt, s.lastCheckedAt, s.lastKnownBalanceText || '', s.lowBalanceFlag ? 1 : 0]
      );
    }
  });

  fs.renameSync(file, file + '.imported');
  console.log('Imported the legacy JSON data into the database (old file renamed to db.json.imported).');
}

module.exports = db;
