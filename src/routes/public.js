const router = require('express').Router();
const { query } = require('../config/db');
const { badRequest } = require('../utils/errors');

router.get('/courses', async (req, res) => {
  const { branch_id } = req.query;
  if (!branch_id) return badRequest(res, 'branch_id required');
  const { rows } = await query(
    `SELECT c.course_id, c.name, c.description,
       cl.name AS level_name,
       rt.name AS robot_type_name,
       json_agg(DISTINCT jsonb_build_object(
         'package_id',       p.package_id,
         'name',             p.name,
         'class_count',      p.class_count,
         'price',            p.price,
         'promo_discount',   pr.discount_percent
       )) FILTER (WHERE p.package_id IS NOT NULL) AS packages
     FROM courses c
     LEFT JOIN course_levels cl ON c.level_id = cl.level_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN packages p ON p.course_id = c.course_id AND p.deleted_at IS NULL
     LEFT JOIN promotions pr ON pr.package_id = p.package_id
       AND pr.deleted_at IS NULL AND NOW() BETWEEN pr.valid_from AND pr.valid_until
     WHERE c.branch_id = $1 AND c.deleted_at IS NULL
     GROUP BY c.course_id, cl.name, rt.name
     ORDER BY c.name`,
    [branch_id]
  );
  res.json(rows);
});

router.get('/branches', async (req, res) => {
  const { rows } = await query(
    'SELECT branch_id, name, address, phone FROM branches WHERE deleted_at IS NULL ORDER BY name'
  );
  res.json(rows);
});

module.exports = router;
