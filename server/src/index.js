const express = require('express');
const cors = require('cors');
const config = require('./config');

const authRoutes = require('./routes/auth.routes');
const vehiclesRoutes = require('./routes/vehicles.routes');
const contactsRoutes = require('./routes/contacts.routes');
const eventsRoutes = require('./routes/events.routes');
const simRoutes = require('./routes/sim.routes');
const alertsRoutes = require('./routes/alerts.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/sim', simRoutes);
app.use('/api/alerts', alertsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log('Admin API listening on port ' + config.port);
});
