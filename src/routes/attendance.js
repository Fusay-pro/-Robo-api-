const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/:scheduleId', async (req, res) => {
  const { rows } = await query(
    `SELECT e.enrollment_id, e.customer_package_id,
            s.student_id, s.name, s.nickname, s.pre_existing_conditions,
            a.status AS attendance_status, a.attendance_id, a.notes AS attendance_notes,
            p.name AS package_name,
            (SELECT COALESCE(SUM(p2.class_count - used.cnt), 0)::int
             FROM customer_packages cp2
             JOIN packages p2 ON cp2.package_id = p2.package_id
             LEFT JOIN (
               SELECT customer_package_id, COUNT(*)::int AS cnt
               FROM package_redemptions
               GROUP BY customer_package_id
             ) used ON used.customer_package_id = cp2.customer_package_id
             WHERE cp2.student_id = s.student_id AND cp2.is_active = true
            ) AS classes_remaining
     FROM enrollments e
     JOIN students s ON e.student_id = s.student_id
     LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
     LEFT JOIN customer_packages cp ON e.customer_package_id = cp.customer_package_id
     LEFT JOIN packages p ON cp.package_id = p.package_id
     WHERE e.schedule_id = $1 AND e.deleted_at IS NULL
     ORDER BY s.name`,
    [req.params.scheduleId]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['staff', 'owner']),
  validate(z.object({
    enrollment_id: z.number().int(),
    schedule_id:   z.number().int(),
    student_id:    z.number().int(),
    status:        z.enum(['present', 'absent', 'excused']),
    notes:         z.string().max(500).optional(),
  })),
  async (req, res) => {
    const { enrollment_id, schedule_id, student_id, status, notes } = req.body;
    const { rows } = await query(
      `INSERT INTO attendance (enrollment_id, schedule_id, student_id, status, notes, marked_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (enrollment_id)
       DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, marked_by_user_id = EXCLUDED.marked_by_user_id, marked_at = NOW()
       RETURNING *`,
      [enrollment_id, schedule_id, student_id, status, notes ?? null, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
