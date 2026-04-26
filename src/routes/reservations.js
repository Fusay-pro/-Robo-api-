const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { badRequest, forbidden, notFound } = require('../utils/errors');

router.post('/',
  roleGuard(['parent']),
  validate(z.object({
    student_id:  z.number().int(),
    schedule_id: z.number().int(),
  })),
  async (req, res) => {
    const { student_id, schedule_id } = req.body;
    const { rows: [student] } = await query(
      'SELECT * FROM students WHERE student_id = $1 AND parent_user_id = $2',
      [student_id, req.user.user_id]
    );
    if (!student) return forbidden(res, 'Student not found or not yours');
    if (student.approval_status !== 'approved') return badRequest(res, 'Student not yet approved');
    const { rows: [schedule] } = await query(
      'SELECT * FROM schedules WHERE schedule_id = $1 AND deleted_at IS NULL', [schedule_id]
    );
    if (!schedule) return notFound(res, 'Schedule not found');
    const deadline = new Date(schedule.starts_at);
    deadline.setHours(deadline.getHours() - 24);
    const { rows } = await query(
      `INSERT INTO schedule_reservations (student_id, schedule_id, day_of_week, confirm_deadline, status)
       VALUES ($1, $2, $3, $4, 'pending_confirmation') RETURNING *`,
      [student_id, schedule_id, new Date(schedule.starts_at).getDay(), deadline]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id/confirm', roleGuard(['parent']), async (req, res) => {
  const { rows: [reservation] } = await query(
    `SELECT sr.*, sc.starts_at FROM schedule_reservations sr
     JOIN schedules sc ON sr.schedule_id = sc.schedule_id
     WHERE sr.reservation_id = $1`, [req.params.id]
  );
  if (!reservation) return notFound(res);
  const { rows: [student] } = await query(
    'SELECT * FROM students WHERE student_id = $1 AND parent_user_id = $2',
    [reservation.student_id, req.user.user_id]
  );
  if (!student) return forbidden(res);
  if (reservation.status !== 'pending_confirmation') return badRequest(res, `Reservation is already ${reservation.status}`);
  if (new Date() > new Date(reservation.confirm_deadline)) return badRequest(res, 'Confirmation deadline has passed');
  const { rows } = await query(
    "UPDATE schedule_reservations SET status = 'confirmed' WHERE reservation_id = $1 RETURNING *",
    [req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', roleGuard(['parent']), async (req, res) => {
  const { rows: [reservation] } = await query(
    'SELECT * FROM schedule_reservations WHERE reservation_id = $1', [req.params.id]
  );
  if (!reservation) return notFound(res);
  const { rows: [student] } = await query(
    'SELECT * FROM students WHERE student_id = $1 AND parent_user_id = $2',
    [reservation.student_id, req.user.user_id]
  );
  if (!student) return forbidden(res);
  await query(
    "UPDATE schedule_reservations SET recurrence_active = false, status = 'released' WHERE reservation_id = $1",
    [req.params.id]
  );
  res.status(204).send();
});

module.exports = router;
