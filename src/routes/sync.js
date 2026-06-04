const router  = require('express').Router();
const { z }   = require('zod');
const bcrypt  = require('bcrypt');
const { query }  = require('../config/db');
const { validate }   = require('../middleware/validate');
const { roleGuard }  = require('../middleware/roleGuard');
const { pushOperationalSync, previewPull, executePull } = require('../services/sheetsSync');

// GET /admin/sync/status — last successful operational sync for this branch
router.get('/status', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const { rows } = await query(
    `SELECT synced_at, triggered_by, rows_written
     FROM sheets_sync_log
     WHERE branch_id = $1 AND sync_type = 'operational' AND status = 'success'
     ORDER BY synced_at DESC LIMIT 1`,
    [req.user.branch_id]
  );
  res.json(rows[0] ?? null);
});

// POST /admin/sync/push — manually push DB → Sheets
router.post('/push', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const result = await pushOperationalSync(req.user.branch_id, 'manual');
  res.json(result);
});

// POST /admin/sync/pull/preview — show what would change
router.post('/pull/preview', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const diff = await previewPull(req.user.branch_id);
  res.json(diff);
});

// POST /admin/sync/pull/execute — apply changes after password confirm
router.post('/pull/execute',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    password:  z.string().min(1),
    confirmed: z.literal(true),
  })),
  async (req, res) => {
    const { rows: [user] } = await query(
      'SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL',
      [req.user.user_id]
    );
    if (!user?.password_hash)
      return res.status(403).json({ error: 'Password verification not available for this account' });

    const ok = await bcrypt.compare(req.body.password, user.password_hash);
    if (!ok) return res.status(403).json({ error: 'Incorrect password' });

    const result = await executePull(req.user.branch_id, req.user.user_id);
    res.json(result);
  }
);

module.exports = router;
