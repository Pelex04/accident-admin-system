const PHONE_RE = /^\+?\d[\d\s()-]{6,18}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (value) => String(value).replace(/[\s()-]/g, '');
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const validCoord = (value, limit) => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit);

module.exports = { PHONE_RE, EMAIL_RE, digits, validText, validCoord };
