const router = require('express').Router();
const { query } = require('../config/db');
const { roleGuard } = require('../middleware/roleGuard');
const { badRequest } = require('../utils/errors');

const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;

// Which rows a status filter means. Classes rather than codes, because that is
// how the question gets asked: "was anything failing on the server" (5xx) as
// against "was someone being refused" (4xx). `client` is a crash in a browser,
// recorded with status 0.
function statusCondition(raw, params) {
  if (raw === '4xx')    return 'l.status BETWEEN 400 AND 499';
  if (raw === '5xx')    return 'l.status >= 500';
  if (raw === 'client') return 'l.status = 0';
  if (/^\d{3}$/.test(raw)) {
    params.push(parseInt(raw, 10));
    return `l.status = $${params.length}`;
  }
  return null;
}

// GET /admin/logs — the error log, newest first, owner-only.
//
// A super_owner sees every branch. An owner sees their own branch's rows plus
// rows with no branch on them: a failure that happened before a session
// existed still has to be readable by someone.
router.get('/', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || LIMIT_DEFAULT, LIMIT_MAX);
  const offset = parseInt(req.query.offset) || 0;

  const conditions = [];
  const params = [];

  if (req.user.role !== 'super_owner') {
    params.push(req.user.branch_id);
    conditions.push(`(l.branch_id = $${params.length} OR l.branch_id IS NULL)`);
  }

  const status = (req.query.status || '').trim();
  if (status) {
    const condition = statusCondition(status, params);
    // A filter the API cannot read is an error, not an empty result: silently
    // ignoring it would show the viewer rows it did not ask for.
    if (!condition) return badRequest(res, 'status must be 4xx, 5xx, client, or a three-digit status code');
    conditions.push(condition);
  }

  const since = (req.query.since || '').trim();
  if (since) {
    const at = new Date(since);
    if (Number.isNaN(at.getTime())) return badRequest(res, 'since must be an ISO 8601 timestamp');
    params.push(at.toISOString());
    conditions.push(`l.occurred_at >= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // The name is joined for display and never stored on the row. A row whose
  // user has since been removed keeps its user_id and comes back with a null
  // name, which the viewer renders as "user #<id>".
  const { rows } = await query(
    `SELECT l.*, u.name AS user_name
     FROM error_log l
     LEFT JOIN users u ON u.user_id = l.user_id
     ${where}
     ORDER BY l.occurred_at DESC, l.log_id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM error_log l ${where}`,
    params
  );

  res.json({ data: rows, total: parseInt(count), limit, offset });
});

module.exports = router;
