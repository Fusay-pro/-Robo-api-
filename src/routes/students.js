const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { sendToRole } = require('../services/pushNotify');
const { notFound } = require('../utils/errors');

const LIMIT_MAX = 200;

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, LIMIT_MAX);
  const offset = parseInt(req.query.offset) || 0;

  let rows, total;
  if (req.user.role === 'parent') {
    ({ rows } = await query(
      'SELECT * FROM students WHERE parent_user_id = $1 AND deleted_at IS NULL LIMIT $2 OFFSET $3',
      [req.user.user_id, limit, offset]
    ));
    ({ rows: [{ count }] } = await query(
      'SELECT COUNT(*) FROM students WHERE parent_user_id = $1 AND deleted_at IS NULL',
      [req.user.user_id]
    ));
  } else {
    ({ rows } = await query(
      'SELECT * FROM students WHERE branch_id = $1 AND deleted_at IS NULL LIMIT $2 OFFSET $3',
      [req.user.branch_id, limit, offset]
    ));
    ({ rows: [{ count }] } = await query(
      'SELECT COUNT(*) FROM students WHERE branch_id = $1 AND deleted_at IS NULL',
      [req.user.branch_id]
    ));
  }
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  validate(z.object({
    name:                    z.string().min(1),
    nickname:                z.string().optional(),
    age:                     z.number().int().positive().optional(),
    pre_existing_conditions: z.string().optional(),
    branch_id:               z.number().int(),
  })),
  async (req, res) => {
    const { name, nickname, age, pre_existing_conditions, branch_id } = req.body;
    const parentId = req.user.role === 'parent' ? req.user.user_id : null;
    const { rows } = await query(
      `INSERT INTO students (parent_user_id, branch_id, name, nickname, age, pre_existing_conditions)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [parentId, branch_id, name, nickname, age, pre_existing_conditions]
    );
    await sendToRole(branch_id, 'staff',  { title: 'New student pending', body: `${name} is waiting for confirmation.` });
    await sendToRole(branch_id, 'owner',  { title: 'New student pending', body: `${name} is waiting for confirmation.` });
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  validate(z.object({
    name:                    z.string().min(1).optional(),
    nickname:                z.string().optional(),
    age:                     z.number().int().positive().optional(),
    pre_existing_conditions: z.string().optional(),
  })),
  async (req, res) => {
    const { name, nickname, age, pre_existing_conditions } = req.body;
    const { rows } = await query(
      `UPDATE students SET
         name                    = COALESCE($1, name),
         nickname                = COALESCE($2, nickname),
         age                     = COALESCE($3, age),
         pre_existing_conditions = COALESCE($4, pre_existing_conditions)
       WHERE student_id = $5 AND deleted_at IS NULL RETURNING *`,
      [name, nickname, age, pre_existing_conditions, req.params.id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

module.exports = router;
