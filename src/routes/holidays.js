const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound } = require('../utils/errors');

router.get('/', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const { rows } = await query(
    `SELECT h.*,
       (SELECT COUNT(*)::int FROM schedules s
        WHERE s.cancelled_by_holiday_id = h.holiday_id) AS cancelled_count
     FROM holidays h
     WHERE h.branch_id = $1
     ORDER BY h.start_date DESC`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    name:       z.string().min(1),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
  async (req, res) => {
    const { name, start_date, end_date } = req.body;
    if (end_date < start_date) return res.status(400).json({ error: 'end_date must be >= start_date' });

    // Create holiday record
    const { rows: [holiday] } = await query(
      `INSERT INTO holidays (branch_id, name, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.branch_id, name, start_date, end_date]
    );

    // Soft-cancel all sessions in that range that aren't already cancelled/deleted
    const { rows: cancelled } = await query(
      `UPDATE schedules
       SET cancelled_at = NOW(), cancelled_by_holiday_id = $1
       WHERE branch_id = $2
         AND deleted_at IS NULL
         AND cancelled_at IS NULL
         AND starts_at::date BETWEEN $3::date AND $4::date
       RETURNING schedule_id`,
      [holiday.holiday_id, req.user.branch_id, start_date, end_date]
    );

    res.status(201).json({ ...holiday, cancelled_count: cancelled.length });
  }
);

// Preview — how many sessions fall in a date range (before creating)
router.get('/preview', roleGuard(['owner']), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  const { rows } = await query(
    `SELECT s.schedule_id, s.starts_at, s.ends_at,
            c.name AS course_name,
            cs.name AS contract_school_name
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.branch_id = $1
       AND s.deleted_at IS NULL
       AND s.cancelled_at IS NULL
       AND s.starts_at::date BETWEEN $2::date AND $3::date
     ORDER BY s.starts_at`,
    [req.user.branch_id, from, to]
  );
  res.json(rows);
});

// Restore — soft-un-cancel all sessions tied to this holiday
router.post('/:id/restore', roleGuard(['owner']), async (req, res) => {
  const { rows: [holiday] } = await query(
    'SELECT * FROM holidays WHERE holiday_id = $1 AND branch_id = $2',
    [req.params.id, req.user.branch_id]
  );
  if (!holiday) return notFound(res);

  const { rows: restored } = await query(
    `UPDATE schedules
     SET cancelled_at = NULL, cancelled_by_holiday_id = NULL
     WHERE cancelled_by_holiday_id = $1
     RETURNING schedule_id`,
    [req.params.id]
  );

  await query('DELETE FROM holidays WHERE holiday_id = $1', [req.params.id]);

  res.json({ restored_count: restored.length });
});

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  const { rows } = await query(
    'DELETE FROM holidays WHERE holiday_id = $1 AND branch_id = $2 RETURNING holiday_id',
    [req.params.id, req.user.branch_id]
  );
  if (!rows.length) return notFound(res);
  // Hard delete without restoring sessions (permanent removal of holiday record only)
  res.status(204).send();
});

module.exports = router;
