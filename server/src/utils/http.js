// Express 4 does not catch errors from async handlers, so wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { wrap };
