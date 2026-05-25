const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT robot_type_id, branch_id, name, quantity
     FROM robot_types
     WHERE branch_id = $1 AND deleted_at IS NULL
     ORDER BY name`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    name:     z.string().min(1),
    quantity: z.number().int().positive().default(8),
  })),
  async (req, res) => {
    const { rows } = await query(
      `INSERT INTO robot_types (branch_id, name, quantity)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.branch_id, req.body.name, req.body.quantity]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    name:     z.string().min(1).optional(),
    quantity: z.number().int().positive().optional(),
  })),
  async (req, res) => {
    const { name, quantity } = req.body;
    const { rows } = await query(
      `UPDATE robot_types SET
         name     = COALESCE($1, name),
         quantity = COALESCE($2, quantity)
       WHERE robot_type_id = $3
         AND branch_id = $4
         AND deleted_at IS NULL
       RETURNING *`,
      [name, quantity, req.params.id, req.user.branch_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Robot type not found' });
    res.json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query('UPDATE robot_types SET deleted_at = NOW() WHERE robot_type_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
