const express = require('express');
const db = require('../db/database');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

function minutesSince(isoString) {
  if (!isoString) {
    return Infinity;
  }
  return (Date.now() - new Date(isoString).getTime()) / 60000;
}

router.get('/', (req, res) => {
  const vehicles = db.get('vehicles').value();
  const simStatuses = db.get('simStatuses').value();
  const crashEvents = db.get('crashEvents').value();

  const alerts = [];

  simStatuses.forEach((status) => {
    const vehicle = vehicles.find((item) => item.id === status.vehicleId);
    const vehicleName = vehicle ? vehicle.name : 'Unknown vehicle';

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

  crashEvents
    .filter((event) => event.status === 'alert_sent' || event.status === 'alert_failed')
    .forEach((event) => {
      const vehicle = vehicles.find((item) => item.id === event.vehicleId);
      const vehicleName = vehicle ? vehicle.name : 'Unknown vehicle';

      alerts.push({
        type: event.status === 'alert_failed' ? 'crash_alert_failed' : 'crash_alert_sent',
        vehicleId: event.vehicleId,
        vehicleName,
        message: 'Crash event ' + event.status.replace('_', ' ') + ' for ' + vehicleName,
        at: event.detectedAt
      });
    });

  const sorted = alerts.sort((a, b) => new Date(b.at) - new Date(a.at));

  return res.json(sorted);
});

module.exports = router;
