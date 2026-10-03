const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');

function detectLowBalance(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return config.lowBalanceKeywords.some((keyword) => lower.includes(keyword));
}

// Shared by the admin route and the device route. A check in without balance text keeps the last known
// balance and low balance flag, instead of wrongly clearing the flag.
async function recordHeartbeat(vehicleId, balanceText) {
  const now = new Date().toISOString();
  const existing = await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [vehicleId]);

  if (existing) {
    const low = balanceText === undefined ? Number(existing.low_balance_flag) : detectLowBalance(balanceText) ? 1 : 0;
    await db.run(
      'UPDATE sim_statuses SET last_heartbeat_at = ?, last_known_balance_text = ?, low_balance_flag = ?, last_checked_at = ? WHERE vehicle_id = ?',
      [now, balanceText !== undefined ? balanceText : existing.last_known_balance_text, low, now, vehicleId]
    );
    return { row: await db.get('SELECT * FROM sim_statuses WHERE vehicle_id = ?', [vehicleId]), created: false };
  }

  const row = {
    id: uuidv4(),
    vehicle_id: vehicleId,
    last_heartbeat_at: now,
    last_known_balance_text: balanceText || '',
    low_balance_flag: detectLowBalance(balanceText) ? 1 : 0,
    last_checked_at: now
  };
  await db.run(
    'INSERT INTO sim_statuses (id, vehicle_id, last_heartbeat_at, last_known_balance_text, low_balance_flag, last_checked_at) VALUES (?, ?, ?, ?, ?, ?)',
    [row.id, row.vehicle_id, row.last_heartbeat_at, row.last_known_balance_text, row.low_balance_flag, row.last_checked_at]
  );
  return { row, created: true };
}

module.exports = { recordHeartbeat, detectLowBalance };
