const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound, conflict } = require('../utils/errors');

async function checkTeacherConflict(teacherId, scheduleId, startsAt, endsAt) {
  const { rows } = await query(
    `SELECT schedule_id FROM schedules
     WHERE teacher_user_id = $1
       AND schedule_id != $2
       AND deleted_at IS NULL
       AND (starts_at, ends_at) OVERLAPS ($3::timestamptz, $4::timestamptz)`,
    [teacherId, scheduleId || 0, startsAt, endsAt]
  );
  return rows.length > 0;
}

// GET /schedules/my-today — must be before /:id
router.get('/my-today', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*,
       c.name AS course_name,
       CASE WHEN s.contract_school_id IS NOT NULL THEN cs.name ELSE b.name END AS location_name,
       cs.address AS school_address
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN branches b ON s.branch_id = b.branch_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.teacher_user_id = $1
       AND s.starts_at::date = CURRENT_DATE
       AND s.deleted_at IS NULL
     ORDER BY s.starts_at`,
    [req.user.user_id]
  );
  res.json(rows);
});

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT s.*, c.name AS course_name, u.name AS teacher_name
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN users u ON s.teacher_user_id = u.user_id
     WHERE s.branch_id = $1 AND s.deleted_at IS NULL
     ORDER BY s.starts_at LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM schedules WHERE branch_id = $1 AND deleted_at IS NULL',
    [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    course_id:          z.number().int().optional(),
    teacher_user_id:    z.number().int().optional(),
    schedule_type:      z.enum(['branch', 'contract_school']).default('branch'),
    contract_school_id: z.number().int().optional(),
    starts_at:          z.string(),
    ends_at:            z.string(),
    max_capacity:       z.number().int().positive().optional(),
    force:              z.boolean().default(false),
  })),
  async (req, res) => {
    const { teacher_user_id, starts_at, ends_at, force, max_capacity, ...fields } = req.body;
    if (teacher_user_id && !force) {
      const hasConflict = await checkTeacherConflict(teacher_user_id, null, starts_at, ends_at);
      if (hasConflict) return conflict(res, 'Teacher already assigned to another session at this time. Pass force:true to override.');
    }
    let cap = max_capacity;
    if (!cap) {
      const { rows } = await query('SELECT capacity_per_teacher FROM branches WHERE branch_id = $1', [req.user.branch_id]);
      cap = rows[0]?.capacity_per_teacher || 10;
    }
    const { rows } = await query(
      `INSERT INTO schedules (branch_id, course_id, teacher_user_id, schedule_type, contract_school_id, starts_at, ends_at, max_capacity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.branch_id, fields.course_id, teacher_user_id, fields.schedule_type, fields.contract_school_id, starts_at, ends_at, cap]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    teacher_user_id: z.number().int().optional(),
    max_capacity:    z.number().int().positive().optional(),
    starts_at:       z.string().optional(),
    ends_at:         z.string().optional(),
    force:           z.boolean().default(false),
  })),
  async (req, res) => {
    const { teacher_user_id, max_capacity, starts_at, ends_at, force } = req.body;
    const { rows: [existing] } = await query('SELECT * FROM schedules WHERE schedule_id = $1', [req.params.id]);
    if (!existing) return notFound(res);
    const newStart   = starts_at       || existing.starts_at;
    const newEnd     = ends_at         || existing.ends_at;
    const newTeacher = teacher_user_id || existing.teacher_user_id;
    if (newTeacher && !force) {
      const hasConflict = await checkTeacherConflict(newTeacher, req.params.id, newStart, newEnd);
      if (hasConflict) return conflict(res, 'Teacher already assigned to another session at this time. Pass force:true to override.');
    }
    const { rows } = await query(
      `UPDATE schedules SET
         teacher_user_id = COALESCE($1, teacher_user_id),
         max_capacity    = COALESCE($2, max_capacity),
         starts_at       = COALESCE($3::timestamptz, starts_at),
         ends_at         = COALESCE($4::timestamptz, ends_at)
       WHERE schedule_id = $5 RETURNING *`,
      [teacher_user_id, max_capacity, starts_at, ends_at, req.params.id]
    );
    res.json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query('UPDATE schedules SET deleted_at = NOW() WHERE schedule_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
