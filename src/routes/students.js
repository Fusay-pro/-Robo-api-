const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { sendToRole } = require('../services/pushNotify');
const { notFound } = require('../utils/errors');

const LIMIT_MAX = 200;

// Stats endpoint — must be before /:id
router.get('/stats', async (req, res) => {
  if (req.user.role === 'parent') return res.json({ total: 0, with_active_package: 0, low_classes: 0 });
  const { rows: [r] } = await query(
    `WITH remaining AS (
       SELECT s.student_id,
              COALESCE(SUM(COALESCE(cp.custom_class_count, p.class_count) - used.cnt), 0)::int AS classes_left,
              BOOL_OR(cp.is_active) AS has_active
       FROM students s
       LEFT JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
       LEFT JOIN packages p ON cp.package_id = p.package_id
       LEFT JOIN (
         SELECT customer_package_id, COUNT(*)::int AS cnt
         FROM package_redemptions
         GROUP BY customer_package_id
       ) used ON used.customer_package_id = cp.customer_package_id
       WHERE s.branch_id = $1 AND s.deleted_at IS NULL
       GROUP BY s.student_id
     )
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE has_active IS TRUE)::int AS with_active_package,
       COUNT(*) FILTER (WHERE classes_left > 0 AND classes_left <= 2)::int AS low_classes
     FROM remaining`,
    [req.user.branch_id]
  );
  res.json(r);
});

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, LIMIT_MAX);
  const offset = parseInt(req.query.offset) || 0;
  const search = (req.query.search || '').trim();

  const classesRemainingSubquery = `
    (SELECT COALESCE(SUM(COALESCE(cp.custom_class_count, p.class_count) - used.cnt), 0)::int
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN (
       SELECT customer_package_id, COUNT(*)::int AS cnt
       FROM package_redemptions
       GROUP BY customer_package_id
     ) used ON used.customer_package_id = cp.customer_package_id
     WHERE cp.student_id = s.student_id AND cp.is_active = true
    ) AS classes_remaining`;

  let rows, count;
  if (req.user.role === 'parent') {
    const searchClause = search ? `AND (s.name ILIKE $4 OR s.nickname ILIKE $4)` : '';
    const params = search
      ? [req.user.user_id, limit, offset, `%${search}%`]
      : [req.user.user_id, limit, offset];
    ({ rows } = await query(
      `SELECT s.*, ${classesRemainingSubquery}
       FROM students s
       WHERE s.parent_user_id = $1 AND s.deleted_at IS NULL ${searchClause}
       ORDER BY s.name LIMIT $2 OFFSET $3`,
      params
    ));
    ({ rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM students s WHERE parent_user_id = $1 AND deleted_at IS NULL ${searchClause}`,
      search ? [req.user.user_id, `%${search}%`] : [req.user.user_id]
    ));
  } else {
    const conditions = ['s.branch_id = $1', 's.deleted_at IS NULL'];
    const params = [req.user.branch_id];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR s.nickname ILIKE $${params.length})`);
    }

    const approvalStatus = (req.query.approval_status || '').trim();
    if (approvalStatus) {
      const statuses = approvalStatus.split(',').map(s => s.trim()).filter(s => ['pending', 'approved', 'rejected'].includes(s));
      if (statuses.length === 1) {
        params.push(statuses[0]);
        conditions.push(`s.approval_status = $${params.length}`);
      } else if (statuses.length > 1) {
        params.push(statuses);
        conditions.push(`s.approval_status = ANY($${params.length})`);
      }
    }

    const where = conditions.join(' AND ');
    ({ rows } = await query(
      `SELECT s.*,
              u.name  AS parent_name,
              u.phone AS parent_phone,
              ${classesRemainingSubquery},
              (SELECT p.name FROM customer_packages cp
               JOIN packages p ON cp.package_id = p.package_id
               WHERE cp.student_id = s.student_id AND cp.is_active = true
               LIMIT 1) AS active_package_name
       FROM students s
       LEFT JOIN users u ON s.parent_user_id = u.user_id
       WHERE ${where}
       ORDER BY s.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ));
    ({ rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM students s WHERE ${where}`,
      params
    ));
  }
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  validate(z.object({
    name:                    z.string().min(1),
    nickname:                z.string().optional(),
    age:                     z.number().int().positive().optional(),
    date_of_birth:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    pre_existing_conditions: z.string().optional(),
    branch_id:               z.number().int(),
  })),
  async (req, res) => {
    const { name, nickname, age, date_of_birth, pre_existing_conditions, branch_id } = req.body;
    const parentId = req.user.role === 'parent' ? req.user.user_id : null;
    // If DOB given but no explicit age, derive age from DOB for the static column
    let computedAge = age;
    if (!computedAge && date_of_birth) {
      const dob = new Date(date_of_birth + 'T00:00:00');
      computedAge = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    const { rows } = await query(
      `INSERT INTO students (parent_user_id, branch_id, name, nickname, age, date_of_birth, pre_existing_conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [parentId, branch_id, name, nickname, computedAge, date_of_birth || null, pre_existing_conditions]
    );
    await sendToRole(branch_id, 'staff',  { title: 'New student pending', body: `${name} is waiting for confirmation.` });
    await sendToRole(branch_id, 'owner',  { title: 'New student pending', body: `${name} is waiting for confirmation.` });
    res.status(201).json(rows[0]);
  }
);

// POST /students/import — batch import students + parent accounts (owner only)
router.post('/import',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    rows: z.array(z.object({
      student_name:  z.string().min(1),
      nickname:      z.string().optional(),
      age:           z.number().int().positive().optional(),
      parent_name:   z.string().min(1),
      parent_email:  z.string().email(),
    })).min(1),
  })),
  async (req, res) => {
    const { rows: importRows } = req.body;
    const branchId = req.user.branch_id;
    const results = [];

    for (const row of importRows) {
      try {
        // Find or create parent user by email
        let { rows: [parent] } = await query(
          'SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL',
          [row.parent_email.toLowerCase()]
        );
        if (!parent) {
          const tempHash = await bcrypt.hash(Math.random().toString(36).slice(2) + Date.now(), 10);
          const { rows: [newParent] } = await query(
            `INSERT INTO users (role, name, email, password_hash) VALUES ('parent', $1, $2, $3) RETURNING user_id`,
            [row.parent_name, row.parent_email.toLowerCase(), tempHash]
          );
          parent = newParent;
        }

        // Create student
        const { rows: [student] } = await query(
          `INSERT INTO students (parent_user_id, branch_id, name, nickname, age)
           VALUES ($1, $2, $3, $4, $5) RETURNING student_id, name`,
          [parent.user_id, branchId, row.student_name, row.nickname ?? null, row.age ?? null]
        );
        results.push({ ok: true, student_name: student.name, student_id: student.student_id });
      } catch (err) {
        results.push({ ok: false, student_name: row.student_name, error: err.message });
      }
    }

    res.json({ results, imported: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  }
);

// GET /students/:id — full detail: student + active packages + most recent enrollment
router.get('/:id', async (req, res) => {
  const { rows: [student] } = await query(
    `SELECT s.*, u.name AS parent_name, u.phone AS parent_phone
     FROM students s
     LEFT JOIN users u ON s.parent_user_id = u.user_id
     WHERE s.student_id = $1 AND s.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!student) return notFound(res);

  // Active packages with classes remaining + course + level + robot type
  const { rows: packages } = await query(
    `SELECT cp.customer_package_id, cp.student_id,
            COALESCE(cp.custom_name, p.name) AS package_name,
            COALESCE(cp.custom_class_count, p.class_count) AS class_count,
            (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS classes_remaining,
            c.course_id,
            c.name AS course_name,
            cl.name AS level_name,
            rt.name AS robot_type_name
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     JOIN courses c ON p.course_id = c.course_id
     LEFT JOIN course_levels cl ON c.level_id = cl.level_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE cp.student_id = $1 AND cp.is_active = true
     GROUP BY cp.customer_package_id, p.name, p.class_count,
              cp.custom_name, cp.custom_class_count,
              c.course_id, c.name, cl.name, rt.name`,
    [req.params.id]
  );

  // Most recent enrollment
  const { rows: [latestEnrollment] } = await query(
    `SELECT e.status, sc.starts_at, c.name AS course_name,
            rt.name AS robot_type_name, cl.name AS level_name
     FROM enrollments e
     JOIN schedules sc ON e.schedule_id = sc.schedule_id
     LEFT JOIN courses c ON sc.course_id = c.course_id
     LEFT JOIN course_levels cl ON c.level_id = cl.level_id
     LEFT JOIN robot_types rt ON c.robot_type_id = rt.robot_type_id
     WHERE e.student_id = $1 AND e.deleted_at IS NULL
     ORDER BY sc.starts_at DESC LIMIT 1`,
    [req.params.id]
  );

  res.json({ ...student, packages, latestEnrollment: latestEnrollment ?? null });
});

// GET /students/:id/notes
router.get('/:id/notes', async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, u.name AS author_name
     FROM student_notes n
     JOIN users u ON n.author_id = u.user_id
     WHERE n.student_id = $1
     ORDER BY n.created_at DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// POST /students/:id/notes
router.post('/:id/notes',
  validate(z.object({ body: z.string().min(1) })),
  async (req, res) => {
    const { rows: [note] } = await query(
      `INSERT INTO student_notes (student_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.id, req.user.user_id, req.body.body]
    );
    // Return with author name
    const { rows: [full] } = await query(
      `SELECT n.*, u.name AS author_name
       FROM student_notes n JOIN users u ON n.author_id = u.user_id
       WHERE n.note_id = $1`,
      [note.note_id]
    );
    res.status(201).json(full);
  }
);

router.patch('/:id',
  validate(z.object({
    name:                    z.string().min(1).optional(),
    nickname:                z.string().optional(),
    age:                     z.number().int().positive().optional(),
    pre_existing_conditions: z.string().optional(),
  })),
  async (req, res) => {
    const { name, nickname, age, pre_existing_conditions } = req.body;
    const { rows } = await query(
      `UPDATE students SET
         name                    = COALESCE($1, name),
         nickname                = COALESCE($2, nickname),
         age                     = COALESCE($3, age),
         pre_existing_conditions = COALESCE($4, pre_existing_conditions)
       WHERE student_id = $5 AND deleted_at IS NULL RETURNING *`,
      [name, nickname, age, pre_existing_conditions, req.params.id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

module.exports = router;
