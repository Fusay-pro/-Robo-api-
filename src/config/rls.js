const { withRLS } = require('./db');

function rlsMiddleware(req, res, next) {
  if (!req.user) return next();
  req.withRLS = (fn) => withRLS({
    role:     req.user.role,
    branchId: req.user.branch_id,
    userId:   req.user.user_id,
  }, fn);
  next();
}

module.exports = { rlsMiddleware };
