const jwt = require('jsonwebtoken');
const { unauthorized } = require('../utils/errors');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.locals.authFailure = true;
    return unauthorized(res);
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    // Marked so the error log skips it: tokens last 15 minutes and every
    // client learns they expired by getting this on an ordinary route, so
    // recording them would bury everything else. See middleware/errorLog.
    res.locals.authFailure = true;
    return unauthorized(res, 'Invalid or expired token');
  }
}

module.exports = { auth: authMiddleware, authMiddleware };
