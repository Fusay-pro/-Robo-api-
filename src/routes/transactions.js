const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT t.*, s.name AS student_name FROM transactions t
     JOIN students s ON t.student_id = s.student_id
     WHERE t.branch_id = $1
     ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM transactions WHERE branch_id = $1', [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({ status: z.enum(['confirmed', 'refunded']) })),
  async (req, res) => {
    const { rows } = await query(
      `UPDATE transactions SET status = $1, confirmed_by_user_id = $2, confirmed_at = NOW()
       WHERE transaction_id = $3 RETURNING *`,
      [req.body.status, req.user.user_id, req.params.id]
    );
    if (req.body.status === 'confirmed' && rows[0]) {
      await query(
        'UPDATE customer_packages SET is_active = true WHERE customer_package_id = $1',
        [rows[0].customer_package_id]
      );
    }
    res.json(rows[0]);
  }
);

module.exports = router;
