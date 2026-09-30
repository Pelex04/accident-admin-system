require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'change_this_secret_before_deploying',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  seedAdminEmail: (process.env.SEED_ADMIN_EMAIL || 'admin@accidentdetection.local').trim().toLowerCase(),
  seedAdminPassword: (process.env.SEED_ADMIN_PASSWORD || 'change_this_password').trim(),
  lowBalanceKeywords: ['low balance', 'insufficient', 'expired', 'recharge now', 'top up'],
  heartbeatStaleMinutes: 60 * 12
};
