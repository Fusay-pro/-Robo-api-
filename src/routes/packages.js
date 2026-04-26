const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound } = require('../utils/errors');

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, c.name AS course_name,
       pr.discount_percent AS active_promo_discount
     FROM packages p
     JOIN courses c ON p.course_id = c.course_id
     LEFT JOIN promotions pr ON pr.package_id = p.package_id
       AND pr.deleted_at IS NULL AND NOW() BETWEEN pr.valid_from AND pr.valid_until
     WHERE c.branch_id = $1 AND p.deleted_at IS NULL
     ORDER BY c.name, p.name`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    course_id:   z.number().int(),
    name:        z.string().min(1),
    class_count: z.number().int().positive(),
    price:       z.number().positive(),
  })),
  async (req, res) => {
    const { course_id, name, class_count, price } = req.body;
    const { rows } = await query(
      'INSERT INTO packages (course_id, name, class_count, price) VALUES ($1,$2,$3,$4) RETURNING *',
      [course_id, name, class_count, price]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    name:        z.string().min(1).optional(),
    class_count: z.number().int().positive().optional(),
    price:       z.number().positive().optional(),
  })),
  async (req, res) => {
    const { name, class_count, price } = req.body;
    const { rows } = await query(
      `UPDATE packages SET
         name        = COALESCE($1, name),
         class_count = COALESCE($2, class_count),
         price       = COALESCE($3, price)
       WHERE package_id = $4 AND deleted_at IS NULL RETURNING *`,
      [name, class_count, price, req.params.id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

module.exports = router;
