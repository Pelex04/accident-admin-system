const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');

// Without a JWT_SECRET the old code used a public default, so anyone could forge a login token.
// Now a random secret is generated once and kept in the database.
async function ensureJwtSecret() {
  if (config.jwtSecret) return;
  const row = await db.get("SELECT value FROM settings WHERE key = 'jwt_secret'");
  if (row) { config.jwtSecret = row.value; return; }
  const secret = crypto.randomBytes(48).toString('hex');
  await db.run("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)", [secret]);
  config.jwtSecret = secret;
  console.warn('JWT_SECRET is not set. A random secret was generated and stored in the database. Set JWT_SECRET in your environment to manage it yourself.');
}

// Any admin still using the published default password must change it at next sign in.
async function flagDefaultPasswords() {
  const rows = await db.all('SELECT id, password_hash FROM admin_users WHERE must_change_password = 0 AND active = 1');
  for (const row of rows) {
    if (await bcrypt.compare(config.defaultSeedPassword, row.password_hash)) {
      await db.run('UPDATE admin_users SET must_change_password = 1, token_version = token_version + 1 WHERE id = ?', [row.id]);
      console.warn('An admin account was still using the default password and must now change it at next sign in.');
    }
  }
}

module.exports = { ensureJwtSecret, flagDefaultPasswords };
