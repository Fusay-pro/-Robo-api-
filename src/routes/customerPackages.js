const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

// GET /customer-packages?student_id=X&all=true
router.get('/', roleGuard(['owner', 'staff']), async (req, res) => {
  const { student_id, all } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id required' });
  const includeInactive = all === 'true' || all === '1';
  const activeClause = includeInactive ? '' : 'AND cp.is_active = true';
  const { rows } = await query(
    `SELECT cp.customer_package_id, cp.student_id, cp.package_id, cp.is_active,
            cp.custom_name, cp.custom_class_count,
            COALESCE(cp.custom_name, p.name) AS package_name,
            COALESCE(cp.custom_class_count, p.class_count) AS class_count,
            p.name AS base_package_name,
            c.course_id, c.name AS course_name,
            rt.name AS robot_type_name,
            (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS classes_remaining
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     JOIN courses c ON p.course_id = c.course_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE cp.student_id = $1 ${activeClause}
     GROUP BY cp.customer_package_id, cp.is_active, cp.custom_name, cp.custom_class_count,
              p.name, p.class_count, c.course_id, c.name, rt.name
     ORDER BY cp.is_active DESC, cp.customer_package_id DESC`,
    [student_id]
  );
  res.json(rows);
});

// PATCH /customer-packages/:id — update is_active, custom_name, custom_class_count (owner only)
router.patch('/:id',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    is_active: z.boolean().optional(),
    custom_name: z.string().nullable().optional(),
    custom_class_count: z.number().int().positive().nullable().optional(),
  })),
  async (req, res) => {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (req.body.is_active !== undefined)      { sets.push(`is_active = $${idx++}`);          vals.push(req.body.is_active); }
    if ('custom_name' in req.body)             { sets.push(`custom_name = $${idx++}`);         vals.push(req.body.custom_name); }
    if ('custom_class_count' in req.body)      { sets.push(`custom_class_count = $${idx++}`);  vals.push(req.body.custom_class_count); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await query(
      `UPDATE customer_packages SET ${sets.join(', ')} WHERE customer_package_id = $${idx} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }
);

// POST /customer-packages — assign a catalog package to a student
router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    student_id: z.number().int(),
    package_id: z.number().int(),
  })),
  async (req, res) => {
    const { student_id, package_id } = req.body;
    const { rows } = await query(
      `INSERT INTO customer_packages (student_id, package_id, is_active)
       VALUES ($1, $2, true) RETURNING *`,
      [student_id, package_id]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
