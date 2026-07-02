const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound } = require('../utils/errors');

const LIMIT_MAX = 200;

// Change own password — any authenticated user
router.patch('/me/password',
  validate(z.object({
    current_password: z.string().min(1),
    new_password:     z.string().min(8),
  })),
  async (req, res) => {
    const { current_password, new_password } = req.body;
    const { rows } = await query('SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL', [req.user.user_id]);
    const user = rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'User not found' });
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, req.user.user_id]);
    res.status(204).send();
  }
);

router.get('/', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, LIMIT_MAX);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT user_id, branch_id, role, name, email, phone, monthly_salary, active_from, active_until, created_at
     FROM users WHERE branch_id = $1 AND deleted_at IS NULL AND role != 'parent'
     ORDER BY name LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    "SELECT COUNT(*) FROM users WHERE branch_id = $1 AND deleted_at IS NULL AND role != 'parent'",
    [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    name:           z.string().min(1),
    email:          z.string().email(),
    password:       z.string().min(8),
    phone:          z.string().optional(),
    role:           z.enum(['owner', 'staff', 'parent']),
    monthly_salary: z.number().positive().optional(),
    active_from:    z.string().optional(),
    active_until:   z.string().optional(),
  })),
  async (req, res) => {
    const { password, ...fields } = req.body;
    const hash = await bcrypt.hash(password, 10);
    let user_code = null;
    if (fields.role === 'parent') {
      const { rows: [{ next_num }] } = await query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(user_code FROM 5) AS INT)), 0) + 1 AS next_num
         FROM users WHERE user_code LIKE 'RCP-%'`
      );
      user_code = `RCP-${String(next_num).padStart(4, '0')}`;
    }
    const { rows } = await query(
      `INSERT INTO users (branch_id, role, name, email, password_hash, phone, monthly_salary, active_from, active_until, user_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING user_id, branch_id, role, name, email, phone, user_code`,
      [req.user.branch_id, fields.role, fields.name, fields.email, hash, fields.phone,
       fields.monthly_salary, fields.active_from, fields.active_until, user_code]
    );
    res.status(201).json(rows[0]);
  }
);

router.get('/parents', roleGuard(['owner', 'staff']), async (req, res) => {
  const search = (req.query.search || '').trim();
  const { rows } = await query(
    `SELECT user_id, name, email, phone FROM users
     WHERE role = 'parent' AND deleted_at IS NULL
       AND ($1 = '' OR name ILIKE $2 OR email ILIKE $2)
     ORDER BY name LIMIT 30`,
    [search, `%${search}%`]
  );
  res.json({ data: rows });
});

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    name:           z.string().min(1).optional(),
    phone:          z.string().optional(),
    monthly_salary: z.number().positive().optional(),
    active_from:    z.string().optional(),
    active_until:   z.string().optional(),
  })),
  async (req, res) => {
    const { name, phone, monthly_salary, active_from, active_until } = req.body;
    const { rows } = await query(
      `UPDATE users SET
         name           = COALESCE($1, name),
         phone          = COALESCE($2, phone),
         monthly_salary = COALESCE($3, monthly_salary),
         active_from    = COALESCE($4::date, active_from),
         active_until   = COALESCE($5::date, active_until)
       WHERE user_id = $6 AND branch_id = $7 AND deleted_at IS NULL
       RETURNING user_id, branch_id, role, name, email, phone, monthly_salary, active_from, active_until`,
      [name, phone, monthly_salary, active_from, active_until, req.params.id, req.user.branch_id]
    );
    if (!rows[0]) return notFound(res);
    res.json(rows[0]);
  }
);

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  await query(
    'UPDATE users SET deleted_at = NOW() WHERE user_id = $1 AND branch_id = $2',
    [req.params.id, req.user.branch_id]
  );
  res.status(204).send();
});

module.exports = router;
