const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

// GET /my/profile
router.get('/profile', async (req, res) => {
  const { rows } = await query(
    'SELECT user_id, name, phone, email, consent_given_at FROM users WHERE user_id = $1',
    [req.user.user_id]
  );
  res.json(rows[0] || {});
});

// PATCH /my/profile
router.patch('/profile',
  validate(z.object({
    name:             z.string().min(1).optional(),
    phone:            z.string().optional(),
    consent_given_at: z.string().datetime().optional(),
  })),
  async (req, res) => {
    const { name, phone, consent_given_at } = req.body;
    const { rows } = await query(
      `UPDATE users SET
         name             = COALESCE($1, name),
         phone            = COALESCE($2, phone),
         consent_given_at = COALESCE($3::timestamptz, consent_given_at)
       WHERE user_id = $4
       RETURNING user_id, name, phone, consent_given_at`,
      [name, phone, consent_given_at, req.user.user_id]
    );
    res.json(rows[0]);
  }
);

// GET /my/children
router.get('/children', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM students WHERE parent_user_id = $1 AND deleted_at IS NULL',
    [req.user.user_id]
  );
  res.json(rows);
});

// GET /my/packages
router.get('/packages', async (req, res) => {
  const { rows } = await query(
    `SELECT cp.*, p.class_count, p.name AS package_name,
       (p.class_count - COUNT(pr.redemption_id)::int) AS classes_remaining
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     JOIN students s ON cp.student_id = s.student_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE s.parent_user_id = $1 AND cp.is_active = true
     GROUP BY cp.customer_package_id, p.class_count, p.name`,
    [req.user.user_id]
  );
  res.json(rows);
});

// GET /my/schedule
router.get('/schedule', async (req, res) => {
  const { rows } = await query(
    `SELECT e.*, sc.starts_at, sc.ends_at, c.name AS course_name, st.name AS student_name
     FROM enrollments e
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     LEFT JOIN courses c ON sc.course_id = c.course_id
     JOIN students st ON e.student_id = st.student_id
     WHERE st.parent_user_id = $1
       AND e.status = 'confirmed'
       AND sc.starts_at > NOW()
       AND e.deleted_at IS NULL
     ORDER BY sc.starts_at`,
    [req.user.user_id]
  );
  res.json(rows);
});

module.exports = router;
