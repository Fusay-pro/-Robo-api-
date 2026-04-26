const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM course_levels WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY name',
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({ name: z.string().min(1) })),
  async (req, res) => {
    const { rows } = await query(
      'INSERT INTO course_levels (branch_id, name) VALUES ($1, $2) RETURNING *',
      [req.user.branch_id, req.body.name]
    );
    res.status(201).json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query('UPDATE course_levels SET deleted_at = NOW() WHERE level_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
