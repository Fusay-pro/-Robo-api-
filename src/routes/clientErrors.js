const router = require('express').Router();
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { recordError } = require('../middleware/errorLog');
const { serverError } = require('../utils/errors');

// A page that died in the browser never reaches a route, so nothing on the
// server would otherwise know it happened. The staff app's error boundary
// posts here and the crash lands in the same log as a server failure, with
// status 0 and method CLIENT to tell the two apart.
//
// Open to any authenticated user, not just an owner: a crash is worth
// recording whoever hit it. It has its own rate limit, applied where it is
// mounted. A crash on the login page, or with a dead token, is not recorded —
// an unauthenticated write endpoint is not worth adding for that case.

const MESSAGE_MAX = 2000;
const STACK_MAX   = 10000;
const PATH_MAX    = 200;

// Oversized text is cut down rather than refused: a report that arrives
// truncated is worth more than a report rejected for being long.
const cut = (s, max) => (typeof s === 'string' && s.length > max ? s.slice(0, max) : s);

// The same rule the server side applies to route patterns: no ids in the log.
// `/students/41` is stored as `/students/:id`.
function pathPattern(raw) {
  if (!raw) return '/';
  const path = cut(String(raw).split('?')[0], PATH_MAX);
  return path
    .split('/')
    .map(seg => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/') || '/';
}

router.post('/',
  validate(z.object({
    message: z.string().min(1),
    stack:   z.string().optional(),
    path:    z.string().optional(),
  })),
  async (req, res) => {
    const row = await recordError({
      status: 0,
      method: 'CLIENT',
      path: pathPattern(req.body.path),
      message: cut(req.body.message, MESSAGE_MAX),
      stack: cut(req.body.stack, STACK_MAX) ?? null,
      user: req.user,
      requestId: req.requestId,
    });
    // recordError answers null rather than throwing, so the caller — a page
    // that has already crashed — gets a plain failure and nothing worse.
    if (!row) return serverError(res, 'Could not record the report');
    res.status(201).json({ log_id: row.log_id });
  }
);

module.exports = { router, pathPattern };
