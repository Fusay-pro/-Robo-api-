const { badRequest } = require('../utils/errors');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // zod v4 exposes issues on `.issues`, not `.errors`
      return badRequest(res, result.error.issues[0].message);
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
