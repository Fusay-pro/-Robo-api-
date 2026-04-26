const router = require('express').Router();
const { z } = require('zod');
const { createEnrollment } = require('../services/bookingGate');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT e.*, s.name AS student_name, sc.starts_at, c.name AS course_name
     FROM enrollments e
     JOIN students s ON e.student_id = s.student_id
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     LEFT JOIN courses c ON sc.course_id = c.course_id
     WHERE sc.branch_id = $1 AND e.deleted_at IS NULL
     ORDER BY sc.starts_at DESC LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM enrollments e
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     WHERE sc.branch_id = $1 AND e.deleted_at IS NULL`,
    [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  validate(z.object({
    student_id:          z.number().int(),
    schedule_id:         z.number().int(),
    customer_package_id: z.number().int(),
  })),
  async (req, res) => {
    try {
      const enrollment = await createEnrollment({
        studentId:    req.body.student_id,
        scheduleId:   req.body.schedule_id,
        packageId:    req.body.customer_package_id,
        parentUserId: req.user.role === 'parent' ? req.user.user_id : null,
      });
      res.status(201).json(enrollment);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

module.exports = router;
