const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound } = require('../utils/errors');

router.get('/', async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY name"
  );
  res.json(rows);
});

// Owner-facing per-branch settings (current user's branch)
router.get('/settings', async (req, res) => {
  const { rows } = await query(
    `SELECT branch_id, name, address, phone, capacity_per_teacher, low_credit_threshold
     FROM branches WHERE branch_id = $1 AND deleted_at IS NULL`,
    [req.user.branch_id]
  );
  res.json(rows[0] || { low_credit_threshold: 3 });
});

router.patch('/settings',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    name:                 z.string().min(1).optional(),
    address:              z.string().optional(),
    phone:                z.string().optional(),
    capacity_per_teacher: z.number().int().positive().optional(),
    low_credit_threshold: z.number().int().min(1).max(20).optional(),
  })),
  async (req, res) => {
    const { name, address, phone, capacity_per_teacher, low_credit_threshold } = req.body;
    const { rows } = await query(
      `UPDATE branches SET
         name                 = COALESCE($1, name),
         address              = COALESCE($2, address),
         phone                = COALESCE($3, phone),
         capacity_per_teacher = COALESCE($4, capacity_per_teacher),
         low_credit_threshold = COALESCE($5, low_credit_threshold)
       WHERE branch_id = $6 AND deleted_at IS NULL
       RETURNING branch_id, name, address, phone, capacity_per_teacher, low_credit_threshold`,
      [name, address, phone, capacity_per_teacher, low_credit_threshold, req.user.branch_id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

router.post('/',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    name:                 z.string().min(1),
    address:              z.string().optional(),
    phone:                z.string().optional(),
    capacity_per_teacher: z.number().int().positive().default(10),
  })),
  async (req, res) => {
    const { name, address, phone, capacity_per_teacher } = req.body;
    const { rows } = await query(
      'INSERT INTO branches (name, address, phone, capacity_per_teacher) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, address, phone, capacity_per_teacher]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    name:                 z.string().min(1).optional(),
    address:              z.string().optional(),
    phone:                z.string().optional(),
    capacity_per_teacher: z.number().int().positive().optional(),
  })),
  async (req, res) => {
    const { name, address, phone, capacity_per_teacher } = req.body;
    const { rows } = await query(
      `UPDATE branches SET
         name                 = COALESCE($1, name),
         address              = COALESCE($2, address),
         phone                = COALESCE($3, phone),
         capacity_per_teacher = COALESCE($4, capacity_per_teacher)
       WHERE branch_id = $5 AND deleted_at IS NULL RETURNING *`,
      [name, address, phone, capacity_per_teacher, req.params.id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

module.exports = router;
