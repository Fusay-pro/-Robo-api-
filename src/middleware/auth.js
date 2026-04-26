const jwt = require('jsonwebtoken');
const { unauthorized } = require('../utils/errors');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res);
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return unauthorized(res, 'Invalid or expired token');
  }
}

module.exports = { auth: authMiddleware, authMiddleware };
