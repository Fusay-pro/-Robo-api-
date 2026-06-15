const router = require('express').Router();
const { z } = require('zod');
const { query, pool } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound, conflict } = require('../utils/errors');
const { sendToUser } = require('../services/pushNotify');

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

// Resolve the capacity for a session: explicit value → course's robot-type
// quantity → branch default → 10. Shared by single and bulk create.
async function resolveCapacity(branchId, courseId, maxCapacity) {
  if (maxCapacity) return maxCapacity;
  if (courseId) {
    const { rows } = await query(
      `SELECT rt.quantity FROM courses c
       LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
       WHERE c.course_id = $1`,
      [courseId]
    );
    if (rows[0]?.quantity) return rows[0].quantity;
  }
  const { rows } = await query('SELECT capacity_per_teacher FROM branches WHERE branch_id = $1', [branchId]);
  return rows[0]?.capacity_per_teacher || 10;
}

// Insert one schedule row. `exec` is either the pool `query` or a transaction
// client's `query`, so this works inside or outside a transaction.
function insertSchedule(exec, branchId, s) {
  return exec(
    `INSERT INTO schedules (branch_id, course_id, teacher_user_id, schedule_type, contract_school_id, starts_at, ends_at, max_capacity, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [branchId, s.course_id, s.teacher_user_id, s.schedule_type, s.contract_school_id, s.starts_at, s.ends_at, s.max_capacity, s.notes ?? null]
  ).then(r => r.rows[0]);
}

// GET /schedules/activity — bookings + hotspots + top kids (owner/staff)
router.get('/activity', roleGuard(['owner', 'super_owner', 'staff']), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  // Recent bookings (last 30 days)
  const { rows: bookings } = await query(
    `SELECT e.enrollment_id, e.student_id, e.status, e.created_at, e.booking_note,
            st.name AS student_name,
            u.name AS parent_name, u.phone AS parent_phone,
            s.schedule_id, s.starts_at,
            COALESCE(c.name, cs.name, 'Session') AS session_name
     FROM enrollments e
     JOIN students st ON st.student_id = e.student_id
     LEFT JOIN users u ON u.user_id = st.parent_user_id
     JOIN schedules s ON s.schedule_id = e.schedule_id
     LEFT JOIN courses c ON c.course_id = s.course_id
     LEFT JOIN contract_schools cs ON cs.contract_school_id = s.contract_school_id
     WHERE s.branch_id = $1
       AND e.deleted_at IS NULL
       AND e.created_at > NOW() - INTERVAL '30 days'
     ORDER BY e.created_at DESC LIMIT $2`,
    [req.user.branch_id, limit]
  );

  // Capacity hotspots — ≥80% full in the next 14 days
  const { rows: hotspots } = await query(
    `SELECT s.schedule_id, s.starts_at, s.max_capacity,
            COALESCE(c.name, cs.name, 'Session') AS session_name,
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.schedule_id = s.schedule_id
                AND e.deleted_at IS NULL AND e.status != 'cancelled') AS enrolled_count
     FROM schedules s
     LEFT JOIN courses c ON c.course_id = s.course_id
     LEFT JOIN contract_schools cs ON cs.contract_school_id = s.contract_school_id
     WHERE s.branch_id = $1
       AND s.deleted_at IS NULL AND s.cancelled_at IS NULL
       AND s.starts_at BETWEEN NOW() AND NOW() + INTERVAL '14 days'
       AND s.max_capacity > 0
     ORDER BY s.starts_at LIMIT 100`,
    [req.user.branch_id]
  );
  const hotFiltered = hotspots
    .map(h => ({ ...h, fill_pct: h.max_capacity ? Math.round(h.enrolled_count / h.max_capacity * 100) : 0 }))
    .filter(h => h.fill_pct >= 80);

  // Top kids — most bookings in the last 30 days
  const { rows: topKids } = await query(
    `SELECT st.student_id, st.name AS student_name,
            COUNT(e.enrollment_id)::int AS bookings_30d,
            MAX(e.created_at) AS last_booked
     FROM enrollments e
     JOIN students st ON st.student_id = e.student_id
     WHERE st.branch_id = $1
       AND e.deleted_at IS NULL
       AND e.created_at > NOW() - INTERVAL '30 days'
     GROUP BY st.student_id, st.name
     ORDER BY bookings_30d DESC LIMIT 20`,
    [req.user.branch_id]
  );

  res.json({ bookings, hotspots: hotFiltered, top_kids: topKids });
});

// GET /schedules/alerts — staff/owner notification feed
router.get('/alerts', async (req, res) => {
  const isParent = req.user.role === 'parent';
  if (isParent) return res.json({ next_session: null, low_class_students: [], pending_approvals: 0 });

  const isStaff = req.user.role === 'staff';
  const teacherFilter = isStaff ? 'AND s.teacher_user_id = $2' : '';
  const teacherParams = isStaff ? [req.user.branch_id, req.user.user_id] : [req.user.branch_id];

  // Next upcoming session (within 24h)
  const { rows: nextRows } = await query(
    `SELECT s.schedule_id, s.starts_at, s.ends_at,
            c.name AS course_name,
            cs.name AS contract_school_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.schedule_id = s.schedule_id AND e.deleted_at IS NULL) AS enrolled_count
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.branch_id = $1
       AND s.deleted_at IS NULL
       AND s.cancelled_at IS NULL
       AND s.starts_at >= NOW()
       AND s.starts_at < NOW() + INTERVAL '24 hours'
       ${teacherFilter}
     ORDER BY s.starts_at LIMIT 1`,
    teacherParams
  );

  // Students with low classes (≤2) attending today's sessions
  const { rows: lowRows } = await query(
    `SELECT DISTINCT
       st.student_id, st.name AS student_name,
       s.schedule_id, s.starts_at,
       COALESCE(c.name, cs.name, 'Session') AS session_name,
       (SELECT COALESCE(SUM(COALESCE(cp2.custom_class_count, p2.class_count) - used.cnt), 0)::int
        FROM customer_packages cp2
        JOIN packages p2 ON cp2.package_id = p2.package_id
        LEFT JOIN (
          SELECT customer_package_id, COUNT(*)::int AS cnt
          FROM package_redemptions
          GROUP BY customer_package_id
        ) used ON used.customer_package_id = cp2.customer_package_id
        WHERE cp2.student_id = st.student_id AND cp2.is_active = true
       ) AS classes_remaining
     FROM schedules s
     JOIN enrollments e ON e.schedule_id = s.schedule_id AND e.deleted_at IS NULL
     JOIN students st ON e.student_id = st.student_id
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.branch_id = $1
       AND s.deleted_at IS NULL
       AND s.cancelled_at IS NULL
       AND s.starts_at::date = CURRENT_DATE
       ${teacherFilter}
     ORDER BY s.starts_at`,
    teacherParams
  );
  const low_class_students = lowRows.filter(r => r.classes_remaining !== null && r.classes_remaining <= 2);

  // Pending approvals + cancellation requests (owner only)
  let pending_approvals = 0;
  let pending_cancellations = 0;
  if (req.user.role === 'owner' || req.user.role === 'super_owner') {
    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*)::int FROM students WHERE branch_id = $1 AND approval_status = 'pending' AND deleted_at IS NULL`,
      [req.user.branch_id]
    );
    pending_approvals = count;

    const { rows: [{ count: cancelCount }] } = await query(
      `SELECT COUNT(DISTINCT r.request_id)::int AS count
       FROM requests r
       WHERE r.status = 'pending'
         AND EXISTS (
           SELECT 1 FROM students s
           WHERE s.parent_user_id = r.parent_id
             AND s.branch_id = $1
             AND s.deleted_at IS NULL
         )`,
      [req.user.branch_id]
    );
    pending_cancellations = cancelCount;
  }

  res.json({
    next_session: nextRows[0] || null,
    low_class_students,
    pending_approvals,
    pending_cancellations,
  });
});

// GET /schedules/my-today — must be before /:id
router.get('/my-today', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*,
       c.name AS course_name,
       rt.name AS robot_type_name,
       CASE WHEN s.contract_school_id IS NOT NULL THEN cs.name ELSE b.name END AS location_name,
       cs.address AS school_address,
       cs.name AS contract_school_name,
       (SELECT COUNT(*)::int FROM enrollments e
          WHERE e.schedule_id = s.schedule_id
            AND e.status = 'confirmed'
            AND e.deleted_at IS NULL) AS booked
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN branches b ON s.branch_id = b.branch_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.teacher_user_id = $1
       AND s.starts_at::date = CURRENT_DATE
       AND s.deleted_at IS NULL
       AND s.cancelled_at IS NULL
     ORDER BY s.starts_at`,
    [req.user.user_id]
  );
  res.json(rows);
});

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { date, from, to, course } = req.query;

  const conditions = ['s.branch_id = $1', 's.deleted_at IS NULL', 's.cancelled_at IS NULL'];
  const params = [req.user.branch_id];

  if (date) {
    params.push(date);
    conditions.push(`s.starts_at::date = $${params.length}::date`);
  } else if (from || to) {
    if (from) { params.push(from); conditions.push(`s.ends_at >= $${params.length}::date`); }
    if (to)   { params.push(to);   conditions.push(`s.starts_at < ($${params.length}::date + interval '1 day')`); }
  } else {
    // default: only show ongoing or future sessions
    conditions.push(`s.ends_at >= NOW()`);
  }
  if (course) {
    params.push(`%${course}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR cs.name ILIKE $${params.length})`);
  }
  if (req.query.course_id) {
    params.push(parseInt(req.query.course_id));
    conditions.push(`s.course_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const dataParams = [...params, limit, offset];
  const { rows } = await query(
    `SELECT s.*,
            c.name AS course_name,
            u.name AS teacher_name,
            rt.name AS robot_type_name,
            rt.quantity AS robot_quantity,
            cs.name AS contract_school_name,
            cs.address AS school_address,
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.schedule_id = s.schedule_id
                AND e.status = 'confirmed'
                AND e.deleted_at IS NULL) AS enrolled_count
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN users u ON s.teacher_user_id = u.user_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE ${where}
     ORDER BY s.starts_at LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE ${where}`,
    params
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.get('/:id', async (req, res) => {
  const { rows: [s] } = await query(
    `SELECT s.*,
            c.name AS course_name,
            u.name AS teacher_name,
            rt.name AS robot_type_name,
            rt.quantity AS robot_quantity,
            cs.name AS contract_school_name,
            cs.address AS school_address,
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.schedule_id = s.schedule_id
                AND e.status = 'confirmed'
                AND e.deleted_at IS NULL) AS enrolled_count
     FROM schedules s
     LEFT JOIN courses c ON s.course_id = c.course_id
     LEFT JOIN users u ON s.teacher_user_id = u.user_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN contract_schools cs ON s.contract_school_id = cs.contract_school_id
     WHERE s.schedule_id = $1 AND s.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.post('/',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    course_id:          z.number().int().optional(),
    teacher_user_id:    z.number().int().optional(),
    schedule_type:      z.enum(['branch', 'contract_school']).default('branch'),
    contract_school_id: z.number().int().optional(),
    starts_at:          z.string(),
    ends_at:            z.string(),
    max_capacity:       z.number().int().positive().optional(),
    notes:              z.string().max(1000).optional(),
    force:              z.boolean().default(false),
  })),
  async (req, res) => {
    const { teacher_user_id, starts_at, ends_at, force, max_capacity, notes, ...fields } = req.body;
    if (teacher_user_id && !force) {
      const hasConflict = await checkTeacherConflict(teacher_user_id, null, starts_at, ends_at);
      if (hasConflict) return conflict(res, 'Teacher already assigned to another session at this time. Pass force:true to override.');
    }
    const cap = await resolveCapacity(req.user.branch_id, fields.course_id, max_capacity);
    const row = await insertSchedule(query, req.user.branch_id, {
      ...fields, teacher_user_id, starts_at, ends_at, max_capacity: cap, notes,
    });
    res.status(201).json(row);
  }
);

// POST /schedules/bulk — create many sessions in one atomic transaction.
// Shared fields apply to every session; `sessions` carries the per-date times.
router.post('/bulk',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    course_id:          z.number().int().optional(),
    teacher_user_id:    z.number().int().optional(),
    schedule_type:      z.enum(['branch', 'contract_school']).default('branch'),
    contract_school_id: z.number().int().optional(),
    max_capacity:       z.number().int().positive().optional(),
    notes:              z.string().max(1000).optional(),
    force:              z.boolean().default(false),
    sessions: z.array(z.object({
      starts_at: z.string(),
      ends_at:   z.string(),
    })).min(1).max(500),
  })),
  async (req, res) => {
    const {
      course_id, teacher_user_id, schedule_type, contract_school_id,
      max_capacity, notes, force, sessions,
    } = req.body;

    if (teacher_user_id && !force) {
      // Reject overlaps *within* this payload (two new sessions clashing),
      // not just against existing DB rows. Sorted-by-start, an overlap exists
      // iff some session starts before its predecessor ends.
      const ordered = [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].starts_at < ordered[i - 1].ends_at) {
          return conflict(res, `Two sessions in this request overlap for the same teacher at ${ordered[i].starts_at}.`);
        }
      }
      // Then check each requested session against existing DB schedules.
      for (const s of sessions) {
        const hasConflict = await checkTeacherConflict(teacher_user_id, null, s.starts_at, s.ends_at);
        if (hasConflict) return conflict(res, `Teacher already assigned to another session at ${s.starts_at}. Pass force:true to override.`);
      }
    }

    // Resolve default capacity once — it's shared across all sessions.
    const cap = await resolveCapacity(req.user.branch_id, course_id, max_capacity);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = [];
      for (const s of sessions) {
        created.push(await insertSchedule(client.query.bind(client), req.user.branch_id, {
          course_id, teacher_user_id, schedule_type, contract_school_id,
          starts_at: s.starts_at, ends_at: s.ends_at, max_capacity: cap, notes,
        }));
      }
      await client.query('COMMIT');
      res.status(201).json({ created: created.length, schedules: created });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
);

router.patch('/:id',
  roleGuard(['owner', 'super_owner']),
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

    // Notify enrolled parents if the time changed
    const timeChanged = (starts_at && starts_at !== String(existing.starts_at)) ||
                       (ends_at   && ends_at   !== String(existing.ends_at));
    if (timeChanged) {
      try {
        const { rows: affected } = await query(
          `SELECT DISTINCT st.parent_user_id, st.name AS student_name
           FROM enrollments e
           JOIN students st ON st.student_id = e.student_id
           WHERE e.schedule_id = $1
             AND e.deleted_at IS NULL
             AND e.status != 'cancelled'
             AND st.parent_user_id IS NOT NULL`,
          [req.params.id]
        );
        const newStarts = new Date(rows[0].starts_at);
        const when = newStarts.toLocaleString('en', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        for (const a of affected) {
          await sendToUser(a.parent_user_id, {
            title: 'Class time changed',
            body:  `${a.student_name}'s class has been rescheduled to ${when}.`,
            data:  { schedule_id: String(req.params.id), type: 'session_rescheduled' },
          });
        }
      } catch (e) {
        console.error('[schedules/patch] notify parents failed:', e.message);
      }
    }

    res.json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner', 'super_owner']), async (req, res) => {
  await query('UPDATE schedules SET deleted_at = NOW() WHERE schedule_id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
