const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const { ensureJwtSecret, flagDefaultPasswords } = require('./utils/security');
const { ensureSeedAdmin } = require('./utils/seed');

async function main() {
  await db.init();
  await ensureJwtSecret();
  await ensureSeedAdmin({ onlyIfEmpty: true });
  await flagDefaultPasswords();

  if (db.dialect === 'sqlite' && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
    console.warn('WARNING: DATABASE_URL is not set, so data is kept in a local file that is erased on every redeploy. Set DATABASE_URL to a PostgreSQL database.');
  }

  const server = createApp().listen(config.port, () => {
    console.log('Admin API listening on port ' + config.port + ' (' + db.dialect + ')');
  });

  const stop = () => server.close(() => db.close().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
