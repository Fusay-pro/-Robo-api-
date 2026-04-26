const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound } = require('../utils/errors');

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, cl.name AS level_name, rt.name AS robot_type_name
     FROM courses c
     LEFT JOIN course_levels cl ON c.level_id = cl.level_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     WHERE c.branch_id = $1 AND c.deleted_at IS NULL ORDER BY c.name`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    name:          z.string().min(1),
    description:   z.string().optional(),
    level_id:      z.number().int().optional(),
    robot_type_id: z.number().int().optional(),
  })),
  async (req, res) => {
    const { name, description, level_id, robot_type_id } = req.body;
    const { rows } = await query(
      'INSERT INTO courses (branch_id, name, description, level_id, robot_type_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.branch_id, name, description, level_id, robot_type_id]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    name:          z.string().min(1).optional(),
    description:   z.string().optional(),
    level_id:      z.number().int().optional(),
    robot_type_id: z.number().int().optional(),
  })),
  async (req, res) => {
    const { name, description, level_id, robot_type_id } = req.body;
    const { rows } = await query(
      `UPDATE courses SET
         name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         level_id      = COALESCE($3, level_id),
         robot_type_id = COALESCE($4, robot_type_id)
       WHERE course_id = $5 AND deleted_at IS NULL RETURNING *`,
      [name, description, level_id, robot_type_id, req.params.id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query('UPDATE courses SET deleted_at = NOW() WHERE course_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
