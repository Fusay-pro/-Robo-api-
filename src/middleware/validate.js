const { badRequest } = require('../utils/errors');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return badRequest(res, result.error.errors[0].message);
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
