const crypto = require('crypto');

const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'change_this_password',
  'adminadmin', 'admin12345', 'letmein123', 'welcome123', 'iloveyou123'
]);

function validatePassword(password, email) {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (password.length > 128) return 'Password must be 128 characters or fewer';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common';
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return 'Use letters and at least one number';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'Password must not contain your email name';
  return null;
}

// Letters and digits only, easy to read out, always contains a digit.
function generateTempPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const byte of crypto.randomBytes(14)) out += alphabet[byte % alphabet.length];
  return /\d/.test(out) ? out : out.slice(0, 13) + '7';
}

module.exports = { validatePassword, generateTempPassword };
