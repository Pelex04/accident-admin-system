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
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const [vehicleRows, simRows, eventRows, activeRows, missedRows] = await Promise.all([
    db.all('SELECT id, name FROM vehicles'),
    db.all('SELECT * FROM sim_statuses'),
    db.all("SELECT * FROM crash_events WHERE status IN ('alert_sent', 'alert_failed')"),
    // A crash that is still counting down. Only recent ones, so a phone that died mid-countdown does not stay here forever.
    db.all("SELECT * FROM crash_events WHERE status IN ('detected', 'countdown') AND detected_at >= ?", [twoHoursAgo]),
    db.all("SELECT d.event_id, d.updated_at, e.vehicle_id FROM alert_deliveries d JOIN crash_events e ON e.id = d.event_id WHERE d.role = 'dispatcher' AND d.status = 'failed'")
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

  activeRows.map(toEvent).forEach((event) => {
    const vehicleName = nameOf(event.vehicleId);
    alerts.push({
      type: 'crash_in_progress',
      vehicleId: event.vehicleId,
      vehicleName,
      message: 'Possible crash for ' + vehicleName + ', the driver may still cancel',
      at: event.detectedAt
    });
  });

  missedRows.forEach((row) => {
    const vehicleName = nameOf(row.vehicle_id);
    alerts.push({
      type: 'dispatcher_unreached',
      vehicleId: row.vehicle_id,
      vehicleName,
      message: 'The dispatcher SMS for ' + vehicleName + ' failed to send',
      at: row.updated_at
    });
  });

  return res.json(alerts.sort((a, b) => new Date(b.at) - new Date(a.at)));
}));

module.exports = router;
