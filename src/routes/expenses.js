const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { badRequest, notFound } = require('../utils/errors');

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT e.*, u.name AS submitted_by_name FROM expenses e
     JOIN users u ON e.submitted_by_user_id = u.user_id
     WHERE e.branch_id = $1 AND e.deleted_at IS NULL
     ORDER BY e.submitted_at DESC LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM expenses WHERE branch_id = $1 AND deleted_at IS NULL', [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  validate(z.object({
    amount:      z.number().positive(),
    category:    z.enum(['travel', 'supplies', 'other']),
    description: z.string().min(1),
    receipt_url: z.string().optional(),
  })),
  async (req, res) => {
    const { amount, category, description, receipt_url } = req.body;
    const { rows } = await query(
      `INSERT INTO expenses (branch_id, submitted_by_user_id, amount, category, description, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.branch_id, req.user.user_id, amount, category, description, receipt_url]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({ status: z.enum(['approved', 'rejected']) })),
  async (req, res) => {
    const { rows: [exp] } = await query('SELECT * FROM expenses WHERE expense_id = $1', [req.params.id]);
    if (!exp) return notFound(res);
    if (exp.submitted_by_user_id === req.user.user_id) return badRequest(res, 'Cannot approve your own expense');
    const { rows } = await query(
      `UPDATE expenses SET status = $1, approved_by_user_id = $2, approved_at = NOW()
       WHERE expense_id = $3 RETURNING *`,
      [req.body.status, req.user.user_id, req.params.id]
    );
    res.json(rows[0]);
  }
);

module.exports = router;
