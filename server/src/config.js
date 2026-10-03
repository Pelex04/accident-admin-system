require('dotenv').config();

const DEFAULT_SECRET = 'change_this_secret_before_deploying';
const DEFAULT_SEED_PASSWORD = 'change_this_password';
const envSecret = (process.env.JWT_SECRET || '').trim();

module.exports = {
  port: process.env.PORT || 4000,
  // null means "generate one and keep it in the database" (see utils/security.js).
  jwtSecret: envSecret && envSecret !== DEFAULT_SECRET && envSecret.length >= 16 ? envSecret : null,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  seedAdminEmail: (process.env.SEED_ADMIN_EMAIL || 'admin@accidentdetection.local').trim().toLowerCase(),
  seedAdminPassword: (process.env.SEED_ADMIN_PASSWORD || DEFAULT_SEED_PASSWORD).trim(),
  defaultSeedPassword: DEFAULT_SEED_PASSWORD,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  loginMaxPerIp: Number(process.env.LOGIN_MAX_PER_IP) || 30,
  loginMaxPerEmail: Number(process.env.LOGIN_MAX_PER_EMAIL) || 8,
  deviceMaxPer10Min: Number(process.env.DEVICE_MAX_PER_10_MIN) || 240,
  lowBalanceKeywords: ['low balance', 'insufficient', 'expired', 'recharge now', 'top up'],
  heartbeatStaleMinutes: 60 * 12
};
