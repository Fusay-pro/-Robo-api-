const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM contract_schools WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY name',
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    name:          z.string().min(1),
    address:       z.string().optional(),
    contact_name:  z.string().optional(),
    contact_phone: z.string().optional(),
  })),
  async (req, res) => {
    const { name, address, contact_name, contact_phone } = req.body;
    const { rows } = await query(
      'INSERT INTO contract_schools (branch_id, name, address, contact_name, contact_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.branch_id, name, address, contact_name, contact_phone]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id', roleGuard(['owner']), async (req, res) => {
  const { name, address, contact_name, contact_phone } = req.body;
  const { rows } = await query(
    `UPDATE contract_schools SET
       name          = COALESCE($1, name),
       address       = COALESCE($2, address),
       contact_name  = COALESCE($3, contact_name),
       contact_phone = COALESCE($4, contact_phone)
     WHERE contract_school_id = $5 AND deleted_at IS NULL RETURNING *`,
    [name, address, contact_name, contact_phone, req.params.id]
  );
  res.json(rows[0]);
});

router.post('/:id/payments',
  roleGuard(['owner']),
  validate(z.object({
    amount:  z.number().positive(),
    paid_at: z.string(),
    notes:   z.string().optional(),
  })),
  async (req, res) => {
    const { rows } = await query(
      `INSERT INTO contract_school_payments (contract_school_id, amount, paid_at, notes, recorded_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.body.amount, req.body.paid_at, req.body.notes, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
