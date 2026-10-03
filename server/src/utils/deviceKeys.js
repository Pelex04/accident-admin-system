const crypto = require('crypto');

// A device key is 256 random bits, so a plain SHA-256 is enough to store it safely: the database never
// holds the key itself, only this fingerprint, and it cannot be turned back into the key.
const generateDeviceKey = () => 'dk_' + crypto.randomBytes(32).toString('base64url');
const hashDeviceKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
// The first few characters are shown in the dashboard so people can tell keys apart.
const keyPrefix = (key) => key.slice(0, 7);

module.exports = { generateDeviceKey, hashDeviceKey, keyPrefix };
