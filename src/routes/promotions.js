const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT pr.*, p.name AS package_name FROM promotions pr
     JOIN packages p ON pr.package_id = p.package_id
     WHERE pr.branch_id = $1 AND pr.deleted_at IS NULL
     ORDER BY pr.valid_until`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    package_id:       z.number().int(),
    discount_percent: z.number().int().min(1).max(100),
    valid_from:       z.string(),
    valid_until:      z.string(),
    max_uses:         z.number().int().positive().optional(),
  })),
  async (req, res) => {
    const { package_id, discount_percent, valid_from, valid_until, max_uses } = req.body;
    const { rows } = await query(
      `INSERT INTO promotions (branch_id, package_id, discount_percent, valid_from, valid_until, max_uses, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.branch_id, package_id, discount_percent, valid_from, valid_until, max_uses, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id', roleGuard(['owner']), async (req, res) => {
  const { deactivate, discount_percent, valid_until } = req.body;
  const { rows } = await query(
    `UPDATE promotions SET
       deleted_at       = CASE WHEN $1 THEN NOW() ELSE deleted_at END,
       discount_percent = COALESCE($2, discount_percent),
       valid_until      = COALESCE($3::timestamptz, valid_until)
     WHERE promo_id = $4 RETURNING *`,
    [deactivate === true, discount_percent, valid_until, req.params.id]
  );
  res.json(rows[0]);
});

module.exports = router;
