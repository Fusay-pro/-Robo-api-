// Records every error response the API sends, so a failure can be explained
// later without a terminal and a database session.
//
// It works by wrapping `res.json` rather than by asking routes to report their
// own failures: routes keep returning `res.status(400).json({ error })` exactly
// as they do now, there is nothing to remember for routes added later, and the
// recorder sees the status and the message the client actually received.
//
// Failure is contained. The write is fire-and-forget and swallows its own
// errors: a broken log must never turn a working request into a broken one.

const crypto = require('crypto');
const { query } = require('../config/db');

// Marker for a 401 the auth middleware raised (missing, invalid or expired
// token). Those are routine churn — access tokens last 15 minutes and every
// client discovers expiry by getting a 401 on an ordinary route — so they are
// skipped, while a 401 a route raises deliberately is kept.
const AUTH_FAILURE = 'auth';

// Keep the console line readable; the full text is in the row.
const CONSOLE_MESSAGE_MAX = 120;

function shouldRecord({ status, routed, reason }) {
  if (!(status >= 400)) return false;
  if (status === 429) return false;                        // rate limiter; visible as a pattern
  if (status === 401 && reason === AUTH_FAILURE) return false;
  if (status === 404 && !routed) return false;             // static files, scanners, typos
  return true;
}

// The route as Express matched it — `/students/:id`, not `/students/41`. Ids
// never reach the log this way. An unmatched path has no pattern to report, so
// it is stored as called; the skip rules mean that is only ever a 5xx.
function routePattern(req) {
  const base = req.baseUrl || '';
  const routePath = req.route && req.route.path;
  if (!routePath) return `${base}${req.path || ''}` || '/';
  const joined = routePath === '/' ? base : `${base}${routePath}`;
  return joined || '/';
}

// Writes one row. Returns the row, or null when the write failed — the caller
// is a response that has already been sent and has nothing to do about it.
async function recordError({ status, method, path, message, stack, user, requestId }) {
  try {
    const { rows: [row] } = await query(
      `INSERT INTO error_log (status, method, path, message, stack, user_id, role, branch_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        status,
        method,
        path,
        message ?? null,
        stack ?? null,
        user ? user.user_id ?? null : null,
        user ? user.role ?? null : null,
        user ? user.branch_id ?? null : null,
        requestId ?? null,
      ]
    );
    return row || null;
  } catch (e) {
    // Reported to the console only, deliberately: see the note at the top.
    console.error(`[err-log] could not record ${status} ${method} ${path}: ${e.message}`);
    return null;
  }
}

function consoleLine({ status, method, path, user, requestId, message }) {
  const who = user && user.user_id ? `user=${user.user_id}` : 'user=-';
  const text = (message || '').slice(0, CONSOLE_MESSAGE_MAX);
  return `[err] ${status} ${method} ${path} ${who} req=${requestId} ${text}`;
}

function errorLogMiddleware(req, res, next) {
  const requestId = crypto.randomBytes(4).toString('hex');
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const sendJson = res.json.bind(res);
  res.json = (body) => {
    // Nothing here may throw into the response path.
    try {
      notice(req, res, body);
    } catch (e) {
      console.error(`[err-log] recorder threw: ${e.message}`);
    }
    return sendJson(body);
  };

  next();
}

function notice(req, res, body) {
  const status = res.statusCode;
  const reason = res.locals && res.locals.authFailure ? AUTH_FAILURE : undefined;
  const routed = Boolean(req.route);
  if (!shouldRecord({ status, routed, reason })) return;

  const entry = {
    status,
    method: req.method,
    path: routePattern(req),
    // The body is what the client was told. For a 500 that is the masked
    // sentence, which is why the stack is carried separately.
    message: body && typeof body.error === 'string' ? body.error : null,
    stack: status >= 500 && res.locals ? res.locals.errorStack || null : null,
    user: req.user || null,
    requestId: req.requestId,
  };

  // PM2 keeps a copy, so `pm2 logs` stays useful on its own.
  console.error(consoleLine(entry));

  // The test suite runs against the live database, so a test run must not
  // write into the log the owner reads. `recordError` stays directly callable
  // and is tested that way.
  if (process.env.NODE_ENV === 'test') return;

  recordError(entry).catch(() => {});
}

module.exports = { errorLogMiddleware, recordError, shouldRecord, routePattern, AUTH_FAILURE };
