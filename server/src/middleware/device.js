const db = require('../db');
const config = require('../config');
const { hashDeviceKey } = require('../utils/deviceKeys');
const { hit } = require('./rateLimit');

const TEN_MINUTES = 10 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

// Devices (the phone or Arduino in a vehicle) sign in with a key that belongs to one vehicle and can only
// report for that vehicle. It is sent as the X-Device-Key header (or Authorization: Device <key>).
async function requireDevice(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const key = String(req.headers['x-device-key'] || (auth.startsWith('Device ') ? auth.slice(7) : '')).trim();

    const row =
      key && key.length <= 200 && key.startsWith('dk_')
        ? await db.get(
            'SELECT d.vehicle_id, d.key_prefix, d.last_used_at, v.name, v.status FROM device_keys d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.key_hash = ?',
            [hashDeviceKey(key)]
          )
        : null;

    if (!row) {
      const gate = await hit('device-bad-key', req.ip, 30, FIFTEEN_MINUTES);
      if (!gate.ok) {
        res.set('Retry-After', String(gate.retryAfter));
        return res.status(429).json({ error: 'Too many invalid device keys. Try again later.', code: 'rate_limited' });
      }
      return res.status(401).json({ error: 'Missing, invalid or revoked device key', code: 'invalid_device_key' });
    }

    const gate = await hit('device', row.vehicle_id, config.deviceMaxPer10Min, TEN_MINUTES);
    if (!gate.ok) {
      res.set('Retry-After', String(gate.retryAfter));
      return res.status(429).json({ error: 'Too many requests from this device. Slow down and retry later.', code: 'rate_limited' });
    }

    req.device = { vehicleId: row.vehicle_id, vehicleName: row.name, vehicleStatus: row.status, keyPrefix: row.key_prefix };

    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > TOUCH_EVERY_MS) {
      await db.run('UPDATE device_keys SET last_used_at = ? WHERE vehicle_id = ?', [new Date().toISOString(), row.vehicle_id]);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireDevice };
