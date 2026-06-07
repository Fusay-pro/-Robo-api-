const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

// GET /my/profile — enriched with branch info
router.get('/profile', async (req, res) => {
  const { rows } = await query(
    `SELECT u.user_id, u.name, u.phone, u.email, u.line_user_id, u.consent_given_at,
            b.branch_id, b.name AS branch_name,
            b.address AS branch_address, b.phone AS branch_phone
     FROM users u
     LEFT JOIN branches b ON b.branch_id = u.branch_id
     WHERE u.user_id = $1`,
    [req.user.user_id]
  );
  res.json(rows[0] || {});
});

// PATCH /my/profile
router.patch('/profile',
  validate(z.object({
    name:             z.string().min(1).optional(),
    phone:            z.string().optional(),
    line_user_id:     z.string().max(100).optional(),
    consent_given_at: z.string().datetime().optional(),
  })),
  async (req, res) => {
    const { name, phone, line_user_id, consent_given_at } = req.body;
    const { rows } = await query(
      `UPDATE users SET
         name             = COALESCE($1, name),
         phone            = COALESCE($2, phone),
         line_user_id     = COALESCE($3, line_user_id),
         consent_given_at = COALESCE($4::timestamptz, consent_given_at)
       WHERE user_id = $5
       RETURNING user_id, name, phone, line_user_id, consent_given_at`,
      [name, phone, line_user_id, consent_given_at, req.user.user_id]
    );
    res.json(rows[0]);
  }
);

// GET /my/children — enriched with active package + next sessions per kid
router.get('/children', async (req, res) => {
  const { rows: kids } = await query(
    `SELECT s.*, b.name AS branch_name,
            COALESCE(EXTRACT(YEAR FROM AGE(s.date_of_birth))::int, s.age) AS age,
            cp.customer_package_id,
            p.name AS package_name,
            COALESCE(cp.custom_class_count, p.class_count) AS class_count,
            (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS classes_remaining
     FROM students s
     LEFT JOIN branches b ON s.branch_id = b.branch_id
     LEFT JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
     LEFT JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN package_redemptions pr ON pr.customer_package_id = cp.customer_package_id
     WHERE s.parent_user_id = $1 AND s.deleted_at IS NULL
     GROUP BY s.student_id, b.name, cp.customer_package_id, p.name, p.class_count, cp.custom_class_count
     ORDER BY s.name`,
    [req.user.user_id]
  );

  if (!kids.length) return res.json([]);

  // Batch-fetch upcoming sessions for all kids in one query
  const ids = kids.map(k => k.student_id);
  const { rows: sessions } = await query(
    `SELECT e.enrollment_id, e.student_id, e.status,
            sc.schedule_id, sc.starts_at, sc.ends_at,
            c.name AS course_name
     FROM enrollments e
     JOIN schedules sc ON sc.schedule_id = e.schedule_id
     LEFT JOIN courses c ON c.course_id = sc.course_id
     WHERE e.student_id = ANY($1::int[])
       AND e.deleted_at IS NULL
       AND e.status != 'cancelled'
       AND sc.deleted_at IS NULL
       AND sc.cancelled_at IS NULL
       AND sc.starts_at > NOW()
     ORDER BY sc.starts_at`,
    [ids]
  );

  // Pending cancellation requests for these kids' enrollments
  const { rows: pending } = await query(
    `SELECT (details->>'enrollment_id')::int AS enrollment_id
     FROM requests
     WHERE parent_id = $1 AND type = 'cancellation' AND status = 'pending'`,
    [req.user.user_id]
  );
  const pendingSet = new Set(pending.map(p => p.enrollment_id));

  const byKid = {};
  sessions.forEach(s => {
    (byKid[s.student_id] ??= []).push({
      enrollment_id: s.enrollment_id,
      schedule_id: s.schedule_id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      course_name: s.course_name,
      cancellation_pending: pendingSet.has(s.enrollment_id),
    });
  });

  res.json(kids.map(k => ({ ...k, upcoming_sessions: (byKid[k.student_id] || []).slice(0, 5) })));
});

// GET /my/packages
router.get('/packages', async (req, res) => {
  const { rows } = await query(
    `SELECT cp.*, COALESCE(cp.custom_class_count, p.class_count) AS class_count, p.name AS package_name,
       (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS classes_remaining
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     JOIN students s ON cp.student_id = s.student_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE s.parent_user_id = $1 AND cp.is_active = true
     GROUP BY cp.customer_package_id, p.class_count, cp.custom_class_count, p.name`,
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
       AND sc.deleted_at IS NULL
       AND sc.cancelled_at IS NULL
     ORDER BY sc.starts_at`,
    [req.user.user_id]
  );
  res.json(rows);
});

// GET /my/enrollments?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/enrollments', async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await query(
    `SELECT e.enrollment_id, e.student_id, e.schedule_id, e.status,
            sc.starts_at, sc.ends_at,
            sc.starts_at::date AS scheduled_date
     FROM enrollments e
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     JOIN students st  ON e.student_id  = st.student_id
     WHERE st.parent_user_id = $1
       AND e.deleted_at IS NULL
       AND sc.deleted_at IS NULL
       AND sc.cancelled_at IS NULL
       AND ($2::date IS NULL OR sc.starts_at::date >= $2::date)
       AND ($3::date IS NULL OR sc.starts_at::date <= $3::date)
     ORDER BY sc.starts_at`,
    [req.user.user_id, from || null, to || null]
  );
  res.json(rows);
});

// GET /my/children/:student_id — kid detail with pooled credits + per-package list
router.get('/children/:student_id', async (req, res) => {
  const studentId = parseInt(req.params.student_id);

  // Kid info — one row, with SUM totals across all active packages
  const { rows: kidRows } = await query(
    `SELECT s.student_id, s.name, s.nickname, s.pre_existing_conditions,
            s.approval_status, s.created_at, s.date_of_birth,
            COALESCE(EXTRACT(YEAR FROM AGE(s.date_of_birth))::int, s.age) AS age,
            b.name AS branch_name,
            COALESCE(SUM(COALESCE(cp.custom_class_count, p.class_count)), 0)::int AS class_count,
            COALESCE(SUM(COALESCE(cp.custom_class_count, p.class_count) - COALESCE(used.cnt, 0)), 0)::int AS classes_remaining,
            COUNT(DISTINCT cp.customer_package_id)::int AS active_package_count,
            (CASE
               WHEN COUNT(DISTINCT cp.customer_package_id) = 1 THEN MAX(p.name)
               WHEN COUNT(DISTINCT cp.customer_package_id) > 1 THEN
                 CONCAT(COUNT(DISTINCT cp.customer_package_id)::text, ' active packages')
               ELSE NULL
             END) AS package_name,
            MAX(c.name) AS course_name,
            MAX(rt.name) AS robot_model
     FROM students s
     LEFT JOIN branches b ON b.branch_id = s.branch_id
     LEFT JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
     LEFT JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN courses c ON c.course_id = p.course_id
     LEFT JOIN robot_types rt ON rt.robot_type_id = c.robot_type_id
     LEFT JOIN (
       SELECT customer_package_id, COUNT(*)::int AS cnt
       FROM package_redemptions
       GROUP BY customer_package_id
     ) used ON used.customer_package_id = cp.customer_package_id
     WHERE s.student_id = $1 AND s.parent_user_id = $2 AND s.deleted_at IS NULL
     GROUP BY s.student_id, b.name`,
    [studentId, req.user.user_id]
  );
  if (!kidRows.length) return res.status(404).json({ error: 'Not found' });

  // Upcoming sessions (excluding holiday-cancelled and parent-cancelled)
  const { rows: sessions } = await query(
    `SELECT e.enrollment_id, e.status, sc.schedule_id, sc.starts_at, sc.ends_at, c.name AS course_name
     FROM enrollments e
     JOIN schedules sc ON sc.schedule_id = e.schedule_id
     LEFT JOIN courses c ON c.course_id = sc.course_id
     WHERE e.student_id = $1
       AND e.deleted_at IS NULL
       AND e.status != 'cancelled'
       AND sc.deleted_at IS NULL
       AND sc.cancelled_at IS NULL
       AND sc.starts_at > NOW()
     ORDER BY sc.starts_at
     LIMIT 5`,
    [studentId]
  );

  // Pending cancellation requests for this kid's enrollments
  const { rows: pending } = await query(
    `SELECT (details->>'enrollment_id')::int AS enrollment_id
     FROM requests
     WHERE parent_id = $1 AND type = 'cancellation' AND status = 'pending'`,
    [req.user.user_id]
  );
  const pendingSet = new Set(pending.map(p => p.enrollment_id));
  const sessionsWithFlag = sessions.map(s => ({ ...s, cancellation_pending: pendingSet.has(s.enrollment_id) }));

  res.json({ ...kidRows[0], upcoming_sessions: sessionsWithFlag });
});

// GET /my/available-sessions — upcoming sessions at parent's branch with seat info
router.get('/available-sessions', async (req, res) => {
  const { rows: [first] } = await query(
    `SELECT branch_id FROM students
     WHERE parent_user_id = $1 AND deleted_at IS NULL AND approval_status = 'approved'
     LIMIT 1`,
    [req.user.user_id]
  );
  if (!first) return res.json([]);

  const { rows } = await query(
    `SELECT s.schedule_id, s.starts_at, s.ends_at, s.max_capacity,
            c.name AS course_name, rt.name AS robot_type_name,
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.schedule_id = s.schedule_id
                AND e.deleted_at IS NULL AND e.status != 'cancelled') AS enrolled_count,
            (SELECT array_agg(e.student_id) FROM enrollments e
              JOIN students st ON st.student_id = e.student_id
              WHERE e.schedule_id = s.schedule_id
                AND e.deleted_at IS NULL AND e.status != 'cancelled'
                AND st.parent_user_id = $1) AS my_kids_booked
     FROM schedules s
     LEFT JOIN courses c ON c.course_id = s.course_id
     LEFT JOIN robot_types rt ON rt.robot_type_id = c.robot_type_id
     WHERE s.branch_id = $2
       AND s.deleted_at IS NULL
       AND s.cancelled_at IS NULL
       AND s.starts_at > NOW()
     ORDER BY s.starts_at
     LIMIT 200`,
    [req.user.user_id, first.branch_id]
  );
  res.json(rows);
});

// POST /my/notifications/seen — parent marks a notification as viewed/dismissed
router.post('/notifications/seen',
  validate(z.object({
    type:   z.enum(['announcement', 'low_credit', 'out_of_classes', 'cancellation']),
    ref_id: z.number().int().nullable().optional(),
  })),
  async (req, res) => {
    const { type, ref_id } = req.body;
    await query(
      `INSERT INTO notification_views (user_id, notification_type, notification_ref_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, notification_type, notification_ref_id) DO NOTHING`,
      [req.user.user_id, type, ref_id ?? null]
    );
    res.status(204).send();
  }
);

// GET /my/attendance/:student_id — past attendance records for a parent's kid
router.get('/attendance/:student_id', async (req, res) => {
  const sid = parseInt(req.params.student_id);
  if (!sid) return res.status(400).json({ error: 'Invalid student_id' });

  // Verify ownership
  const { rows: [own] } = await query(
    `SELECT 1 FROM students
     WHERE student_id = $1 AND parent_user_id = $2 AND deleted_at IS NULL`,
    [sid, req.user.user_id]
  );
  if (!own) return res.status(404).json({ error: 'Not found' });

  const { rows } = await query(
    `SELECT a.attendance_id, a.status, a.notes, a.marked_at,
            sc.starts_at, sc.ends_at,
            c.name AS course_name,
            cs.name AS contract_school_name
     FROM attendance a
     JOIN schedules sc ON sc.schedule_id = a.schedule_id
     LEFT JOIN courses c ON c.course_id = sc.course_id
     LEFT JOIN contract_schools cs ON cs.contract_school_id = sc.contract_school_id
     WHERE a.student_id = $1
     ORDER BY sc.starts_at DESC
     LIMIT 50`,
    [sid]
  );
  res.json(rows);
});

// GET /my/announcements — recent announcements for parent's branch
router.get('/announcements', async (req, res) => {
  try {
    // Get branch from any of the parent's children
    const { rows: branchRows } = await query(
      `SELECT DISTINCT branch_id FROM students
       WHERE parent_user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [req.user.user_id]
    );
    if (!branchRows.length) return res.json([]);
    const branchId = branchRows[0].branch_id;

    const { rows } = await query(
      `SELECT announcement_id, title, body, image_url, created_at
       FROM announcements
       WHERE branch_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 20`,
      [branchId]
    );
    res.json(rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]); // table not created
    throw err;
  }
});

// GET /my/alerts — low-credit children for the bell dropdown
router.get('/alerts', async (req, res) => {
  const { rows } = await query(
    `WITH child_remaining AS (
       SELECT s.student_id, s.name AS student_name, s.branch_id,
              COALESCE(SUM(COALESCE(cp.custom_class_count, p.class_count) - used.cnt), 0)::int AS classes_remaining,
              BOOL_OR(cp.is_active) AS has_active
       FROM students s
       LEFT JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
       LEFT JOIN packages p ON cp.package_id = p.package_id
       LEFT JOIN (
         SELECT customer_package_id, COUNT(*)::int AS cnt
         FROM package_redemptions
         GROUP BY customer_package_id
       ) used ON used.customer_package_id = cp.customer_package_id
       WHERE s.parent_user_id = $1 AND s.deleted_at IS NULL
       GROUP BY s.student_id, s.name, s.branch_id
     )
     SELECT cr.student_id, cr.student_name, cr.classes_remaining, cr.has_active,
            b.low_credit_threshold
     FROM child_remaining cr
     LEFT JOIN branches b ON b.branch_id = cr.branch_id`,
    [req.user.user_id]
  );

  const low_class_children = rows.filter(r =>
    r.has_active && r.classes_remaining > 0 && r.classes_remaining <= (r.low_credit_threshold || 3)
  );
  const out_of_classes = rows.filter(r => r.has_active && r.classes_remaining === 0);

  // Recently-cancelled bookings — sessions the parent's kids were enrolled in
  // that got cancelled in the last 14 days
  const { rows: cancelled } = await query(
    `SELECT e.enrollment_id, e.student_id,
            st.name AS student_name,
            sc.schedule_id, sc.starts_at, sc.ends_at, sc.cancelled_at,
            COALESCE(c.name, cs.name, 'Session') AS session_name,
            h.name AS holiday_name
     FROM enrollments e
     JOIN students st ON st.student_id = e.student_id
     JOIN schedules sc ON sc.schedule_id = e.schedule_id
     LEFT JOIN courses c ON c.course_id = sc.course_id
     LEFT JOIN contract_schools cs ON cs.contract_school_id = sc.contract_school_id
     LEFT JOIN holidays h ON h.holiday_id = sc.cancelled_by_holiday_id
     WHERE st.parent_user_id = $1
       AND st.deleted_at IS NULL
       AND e.deleted_at IS NULL
       AND sc.cancelled_at IS NOT NULL
       AND sc.cancelled_at > NOW() - INTERVAL '14 days'
     ORDER BY sc.cancelled_at DESC
     LIMIT 20`,
    [req.user.user_id]
  );

  res.json({ low_class_children, out_of_classes, cancelled_bookings: cancelled });
});

// GET /my/messages
router.get('/messages', async (req, res) => {
  const { rows } = await query(
    `SELECT m.message_id, m.sender_role, m.body, m.request_id, m.is_read, m.created_at,
            u.name AS sender_name,
            r.type AS req_type, r.status AS req_status, r.details AS req_details
     FROM messages m
     JOIN users u ON m.sender_id = u.user_id
     LEFT JOIN requests r ON m.request_id = r.request_id
     WHERE m.parent_id = $1
     ORDER BY m.created_at ASC`,
    [req.user.user_id]
  );
  res.json(rows);
});

// POST /my/messages  — plain text message from parent
router.post('/messages',
  validate(z.object({ body: z.string().min(1).max(2000) })),
  async (req, res) => {
    const { body } = req.body;
    const { rows } = await query(
      `INSERT INTO messages (parent_id, sender_role, sender_id, body)
       VALUES ($1, 'parent', $1, $2)
       RETURNING *`,
      [req.user.user_id, body]
    );
    res.json(rows[0]);
  }
);

// GET /my/requests?filter=pending|completed
router.get('/requests', async (req, res) => {
  const filter = req.query.filter || 'pending';
  const statusClause = filter === 'pending' ? "r.status = 'pending'" : "r.status IN ('approved', 'rejected')";
  const { rows } = await query(
    `SELECT r.*,
            (SELECT m.body FROM messages m
             WHERE m.request_id = r.request_id AND m.sender_role = 'staff'
             ORDER BY m.created_at DESC LIMIT 1) AS staff_note
     FROM requests r
     WHERE r.parent_id = $1 AND ${statusClause}
     ORDER BY r.created_at DESC`,
    [req.user.user_id]
  );
  res.json(rows);
});

// POST /my/requests  — structured request card (creates request + message)
router.post('/requests',
  validate(z.object({
    type:      z.enum(['absence', 'refund', 'reinstatement', 'cancellation']),
    kid_name:  z.string().min(1),
    reason:    z.string().min(1).max(500),
    details:   z.record(z.any()).optional(),
  })),
  async (req, res) => {
    const { type, kid_name, reason, details = {} } = req.body;
    const fullDetails = { kid_name, reason, ...details };

    // If cancellation: verify the enrollment belongs to a child of this parent
    if (type === 'cancellation') {
      const enrollmentId = fullDetails.enrollment_id;
      if (!enrollmentId) return res.status(400).json({ error: 'enrollment_id is required' });
      const { rows: [chk] } = await query(
        `SELECT e.enrollment_id FROM enrollments e
         JOIN students s ON s.student_id = e.student_id
         WHERE e.enrollment_id = $1 AND s.parent_user_id = $2
           AND e.deleted_at IS NULL`,
        [enrollmentId, req.user.user_id]
      );
      if (!chk) return res.status(403).json({ error: 'Enrollment not found or not yours' });
      // Prevent duplicate pending requests for the same enrollment
      const { rows: [dup] } = await query(
        `SELECT request_id FROM requests
         WHERE parent_id = $1 AND type = 'cancellation' AND status = 'pending'
           AND details->>'enrollment_id' = $2`,
        [req.user.user_id, String(enrollmentId)]
      );
      if (dup) return res.status(409).json({ error: 'You already have a pending cancellation request for this class' });
    }

    const labels = { absence: 'Absence Notice', refund: 'Refund Request', reinstatement: 'Reinstatement', cancellation: 'Cancellation Request' };
    const body = `${labels[type]}: ${kid_name} — ${reason}`;

    const reqRow = await query(
      `INSERT INTO requests (parent_id, type, details) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.user_id, type, JSON.stringify(fullDetails)]
    );
    const requestId = reqRow.rows[0].request_id;

    const msgRow = await query(
      `INSERT INTO messages (parent_id, sender_role, sender_id, body, request_id)
       VALUES ($1, 'parent', $1, $2, $3) RETURNING *`,
      [req.user.user_id, body, requestId]
    );

    res.json({ request: reqRow.rows[0], message: msgRow.rows[0] });
  }
);

module.exports = router;
