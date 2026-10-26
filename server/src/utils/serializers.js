// Database rows use snake_case. The API keeps the camelCase shapes it always had.
const num = (v) => (v === null || v === undefined ? null : Number(v));

exports.vehicle = (r) => ({ id: r.id, name: r.name, arduinoSimNumber: r.arduino_sim_number, status: r.status, registeredAt: r.registered_at });

exports.contact = (r) => ({ id: r.id, vehicleId: r.vehicle_id, name: r.name, phoneNumber: r.phone_number, priority: Number(r.priority), role: r.role || 'next_of_kin' });

exports.event = (r) => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  detectedAt: r.detected_at,
  latitude: num(r.latitude),
  longitude: num(r.longitude),
  status: r.status,
  cancelledBy: r.cancelled_by === undefined ? null : r.cancelled_by,
  notes: r.notes,
  ref: r.ref || null,
  updatedAt: r.updated_at || null,
  acknowledgedAt: r.acknowledged_at || null,
  acknowledgedBy: r.acknowledged_by || null
});

exports.sim = (r) => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  lastHeartbeatAt: r.last_heartbeat_at,
  lastKnownBalanceText: r.last_known_balance_text,
  lowBalanceFlag: !!Number(r.low_balance_flag),
  lastCheckedAt: r.last_checked_at
});

exports.admin = (r) => ({
  id: r.id,
  email: r.email,
  role: r.role,
  active: !!Number(r.active),
  mustChangePassword: !!Number(r.must_change_password),
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at || null
});

exports.audit = (r) => ({
  id: r.id,
  at: r.at,
  adminId: r.admin_id,
  adminEmail: r.admin_email,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  summary: r.summary,
  ip: r.ip
});
