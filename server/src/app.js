const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');

function createApp() {
  const app = express();

  // Behind a hosting proxy (Render and similar) the real client address is in X-Forwarded-For.
  // Without this every visitor would share one address and the sign in limiter would lock everyone out.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  app.use(
    config.allowedOrigins.length
      ? cors({ origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)) })
      : cors()
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api/vehicles', require('./routes/vehicles.routes'));
  app.use('/api/contacts', require('./routes/contacts.routes'));
  app.use('/api/events', require('./routes/events.routes'));
  app.use('/api/sim', require('./routes/sim.routes'));
  app.use('/api/alerts', require('./routes/alerts.routes'));
  app.use('/api/device', require('./routes/device.routes'));
  app.use('/api/admins', require('./routes/admins.routes'));
  app.use('/api/audit', require('./routes/audit.routes'));

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
