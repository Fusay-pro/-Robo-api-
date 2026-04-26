const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/:scheduleId', async (req, res) => {
  const { rows } = await query(
    `SELECT e.enrollment_id, s.student_id, s.name, s.nickname, s.pre_existing_conditions,
       a.status AS attendance_status, a.attendance_id
     FROM enrollments e
     JOIN students s ON e.student_id = s.student_id
     LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
     WHERE e.schedule_id = $1 AND e.deleted_at IS NULL`,
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
  })),
  async (req, res) => {
    const { enrollment_id, schedule_id, student_id, status } = req.body;
    const { rows } = await query(
      `INSERT INTO attendance (enrollment_id, schedule_id, student_id, status, marked_by_user_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (enrollment_id)
       DO UPDATE SET status = EXCLUDED.status, marked_by_user_id = EXCLUDED.marked_by_user_id, marked_at = NOW()
       RETURNING *`,
      [enrollment_id, schedule_id, student_id, status, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
