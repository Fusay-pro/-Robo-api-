const router  = require('express').Router();
const { z }   = require('zod');
const bcrypt  = require('bcrypt');
const { query }  = require('../config/db');
const { validate }   = require('../middleware/validate');
const { roleGuard }  = require('../middleware/roleGuard');
const { pushOperationalSync, previewPull, executePull, importStudentsFromSheet, resetBranchData } = require('../services/sheetsSync');

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

// Sheet-sync failures are operational (bad config, sheet not shared, …) — surface
// the message to the owner UI as a 400 instead of a masked 500.
const syncError = (res, err) => res.status(400).json({ error: err.message });

// Every action here mutates real data (or a live Google Sheet), so each one
// re-confirms the caller's password — same pattern as Reset/Edit Sheet Links.
// Returns true and lets the route continue, or sends the 403 itself.
const passwordSchema = validate(z.object({ password: z.string().min(1), confirmed: z.literal(true) }));
async function verifyPassword(req, res) {
  const { rows: [user] } = await query(
    'SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL',
    [req.user.user_id]
  );
  if (!user?.password_hash) {
    res.status(403).json({ error: 'Password verification not available for this account' });
    return false;
  }
  const ok = await bcrypt.compare(req.body.password, user.password_hash);
  if (!ok) { res.status(403).json({ error: 'Incorrect password' }); return false; }
  return true;
}

// POST /admin/sync/push — manually push DB → Sheets
router.post('/push', roleGuard(['owner', 'super_owner']), passwordSchema, async (req, res) => {
  if (!(await verifyPassword(req, res))) return;
  try {
    const result = await pushOperationalSync(req.user.branch_id, 'manual');
    res.json(result);
  } catch (err) { syncError(res, err); }
});

// POST /admin/sync/pull/preview — show what would change (read-only, no password needed)
router.post('/pull/preview', roleGuard(['owner', 'super_owner']), async (req, res) => {
  try {
    const diff = await previewPull(req.user.branch_id);
    res.json(diff);
  } catch (err) { syncError(res, err); }
});

// POST /admin/sync/pull/execute — apply changes after password confirm
router.post('/pull/execute', roleGuard(['owner', 'super_owner']), passwordSchema, async (req, res) => {
  if (!(await verifyPassword(req, res))) return;
  try {
    const result = await executePull(req.user.branch_id, req.user.user_id);
    res.json(result);
  } catch (err) { syncError(res, err); }
});

// GET /admin/sync/sheets — current sheet URLs for this branch
router.get('/sheets', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const { rows: [branch] } = await query(
    'SELECT sheets_operational_id, sheets_finance_id FROM branches WHERE branch_id = $1',
    [req.user.branch_id]
  );
  res.json({
    sheets_operational_id: branch?.sheets_operational_id ?? null,
    sheets_finance_id:     branch?.sheets_finance_id     ?? null,
  });
});

// POST /admin/sync/sheets/reveal — same data as GET /sheets, but the UI gates
// displaying the URLs on screen behind a password re-confirmation first.
router.post('/sheets/reveal', roleGuard(['owner', 'super_owner']), passwordSchema, async (req, res) => {
  if (!(await verifyPassword(req, res))) return;
  const { rows: [branch] } = await query(
    'SELECT sheets_operational_id, sheets_finance_id FROM branches WHERE branch_id = $1',
    [req.user.branch_id]
  );
  res.json({
    sheets_operational_id: branch?.sheets_operational_id ?? null,
    sheets_finance_id:     branch?.sheets_finance_id     ?? null,
  });
});

// PATCH /admin/sync/sheets — update sheet URLs (password required)
router.patch('/sheets',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    sheets_operational_id: z.string().nullable().optional(),
    sheets_finance_id:     z.string().nullable().optional(),
    password:              z.string().min(1),
  })),
  async (req, res) => {
    if (!(await verifyPassword(req, res))) return;
    const { sheets_operational_id, sheets_finance_id } = req.body;

    const sets = [];
    const vals = [];
    let idx = 1;
    if ('sheets_operational_id' in req.body) {
      sets.push(`sheets_operational_id = $${idx++}`);
      vals.push(sheets_operational_id ?? null);
    }
    if ('sheets_finance_id' in req.body) {
      sets.push(`sheets_finance_id = $${idx++}`);
      vals.push(sheets_finance_id ?? null);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.user.branch_id);
    const { rows: [branch] } = await query(
      `UPDATE branches SET ${sets.join(', ')} WHERE branch_id = $${idx}
       RETURNING sheets_operational_id, sheets_finance_id`,
      vals
    );
    res.json(branch);
  }
);

// POST /admin/sync/import-students — import from registration sheet into DB
router.post('/import-students', roleGuard(['owner', 'super_owner']), passwordSchema, async (req, res) => {
  if (!(await verifyPassword(req, res))) return;
  try {
    const result = await importStudentsFromSheet(req.user.branch_id, req.user.user_id);
    res.json(result);
  } catch (err) { syncError(res, err); }
});

// POST /admin/reset — full data wipe for this branch (password required)
router.post('/reset', roleGuard(['owner', 'super_owner']), passwordSchema, async (req, res) => {
  if (!(await verifyPassword(req, res))) return;
  try {
    await resetBranchData(req.user.branch_id);
    res.json({ ok: true });
  } catch (err) { syncError(res, err); }
});

module.exports = router;
