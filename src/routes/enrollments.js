const router = require('express').Router();
const { z } = require('zod');
const { createEnrollment } = require('../services/bookingGate');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', async (req, res) => {
  const limit      = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset     = parseInt(req.query.offset) || 0;
  const scheduleId = req.query.schedule_id ? parseInt(req.query.schedule_id) : null;

  const scheduleClause = scheduleId ? 'AND e.schedule_id = $4' : '';
  const params = scheduleId
    ? [req.user.branch_id, limit, offset, scheduleId]
    : [req.user.branch_id, limit, offset];

  const { rows } = await query(
    `SELECT e.*, s.name AS student_name, s.student_id,
            sc.starts_at, c.name AS course_name
     FROM enrollments e
     JOIN students s ON e.student_id = s.student_id
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     LEFT JOIN courses c ON sc.course_id = c.course_id
     WHERE sc.branch_id = $1 AND e.deleted_at IS NULL ${scheduleClause}
     ORDER BY sc.starts_at DESC LIMIT $2 OFFSET $3`,
    params
  );
  const countParams = scheduleId ? [req.user.branch_id, scheduleId] : [req.user.branch_id];
  const countClause = scheduleId ? 'AND e.schedule_id = $2' : '';
  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM enrollments e
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     WHERE sc.branch_id = $1 AND e.deleted_at IS NULL ${countClause}`,
    countParams
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'pending', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  // Cancellation is owner-only. Other status changes allowed for owner+staff.
  if (status === 'cancelled') {
    if (req.user.role !== 'owner' && req.user.role !== 'super_owner') {
      return res.status(403).json({ error: 'Only owners can cancel enrollments. Parents must submit a cancellation request.' });
    }
  } else if (!['owner', 'super_owner', 'staff'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { rows } = await query(
    `UPDATE enrollments SET status = $1 WHERE enrollment_id = $2 AND deleted_at IS NULL RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query(
    `UPDATE enrollments SET deleted_at = NOW() WHERE enrollment_id = $1`,
    [req.params.id]
  );
  res.status(204).send();
});

router.post('/',
  validate(z.object({
    student_id:          z.number().int(),
    schedule_id:         z.number().int(),
    customer_package_id: z.number().int(),
    booking_note:        z.string().max(500).optional(),
    force:               z.boolean().default(false),
  })),
  async (req, res) => {
    try {
      // Parents can only book their own approved kids using their kid's active package
      if (req.user.role === 'parent') {
        const { rows: [own] } = await query(
          `SELECT 1
           FROM students s
           JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
           WHERE s.student_id = $1
             AND s.parent_user_id = $2
             AND s.deleted_at IS NULL
             AND s.approval_status = 'approved'
             AND cp.customer_package_id = $3`,
          [req.body.student_id, req.user.user_id, req.body.customer_package_id]
        );
        if (!own) return res.status(403).json({ error: 'Student or package does not belong to you' });
      }

      // Prevent re-booking the same kid in the same session
      const { rows: [dup] } = await query(
        `SELECT 1 FROM enrollments
         WHERE student_id = $1 AND schedule_id = $2
           AND deleted_at IS NULL AND status != 'cancelled'`,
        [req.body.student_id, req.body.schedule_id]
      );
      if (dup) return res.status(409).json({ error: 'Already booked for this session' });

      // Only owners/staff may overfill a session; parents can never bypass capacity.
      const force = req.body.force && req.user.role !== 'parent';

      const enrollment = await createEnrollment({
        studentId:    req.body.student_id,
        scheduleId:   req.body.schedule_id,
        packageId:    req.body.customer_package_id,
        parentUserId: req.user.role === 'parent' ? req.user.user_id : null,
        bookingNote:  req.body.booking_note,
        force,
      });
      res.status(201).json(enrollment);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

module.exports = router;
