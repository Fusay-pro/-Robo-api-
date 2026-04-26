const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM robot_types WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY name',
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({ name: z.string().min(1) })),
  async (req, res) => {
    const { rows } = await query(
      'INSERT INTO robot_types (branch_id, name) VALUES ($1, $2) RETURNING *',
      [req.user.branch_id, req.body.name]
    );
    res.status(201).json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query('UPDATE robot_types SET deleted_at = NOW() WHERE robot_type_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
