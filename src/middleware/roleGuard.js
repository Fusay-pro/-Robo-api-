const { forbidden } = require('../utils/errors');

function roleGuard(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return forbidden(res);
    }
    next();
  };
}

module.exports = { roleGuard };
