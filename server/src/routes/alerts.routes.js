const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { wrap } = require('../utils/http');
const { sim: toSim, event: toEvent } = require('../utils/serializers');

const router = express.Router();
router.use(requireAuth);

function minutesSince(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / 60000;
}

router.get('/', wrap(async (req, res) => {
  const [vehicleRows, simRows, eventRows] = await Promise.all([
    db.all('SELECT id, name FROM vehicles'),
    db.all('SELECT * FROM sim_statuses'),
    db.all("SELECT * FROM crash_events WHERE status IN ('alert_sent', 'alert_failed')")
  ]);
  const names = new Map(vehicleRows.map((v) => [v.id, v.name]));
  const nameOf = (id) => names.get(id) || 'Unknown vehicle';
  const alerts = [];

  simRows.map(toSim).forEach((status) => {
    const vehicleName = nameOf(status.vehicleId);

    if (status.lowBalanceFlag) {
      alerts.push({
        type: 'low_balance',
        vehicleId: status.vehicleId,
        vehicleName,
        message: 'Low SIM balance reported for ' + vehicleName,
        at: status.lastCheckedAt
      });
    }

    if (minutesSince(status.lastHeartbeatAt) > config.heartbeatStaleMinutes) {
      alerts.push({
        type: 'stale_heartbeat',
        vehicleId: status.vehicleId,
        vehicleName,
        message: vehicleName + ' has not checked in recently',
        at: status.lastHeartbeatAt
      });
    }
  });

  eventRows.map(toEvent).forEach((event) => {
    const vehicleName = nameOf(event.vehicleId);
    alerts.push({
      type: event.status === 'alert_failed' ? 'crash_alert_failed' : 'crash_alert_sent',
      vehicleId: event.vehicleId,
      vehicleName,
      message: 'Crash event ' + event.status.replace('_', ' ') + ' for ' + vehicleName,
      at: event.detectedAt
    });
  });

  return res.json(alerts.sort((a, b) => new Date(b.at) - new Date(a.at)));
}));

module.exports = router;
