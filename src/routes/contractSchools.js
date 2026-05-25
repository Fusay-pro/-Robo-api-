const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

const SchoolBody = z.object({
  name:                     z.string().min(1).optional(),
  address:                  z.string().optional(),
  contact_name:             z.string().optional(),
  contact_phone:            z.string().optional(),
  contract_start_date:      z.string().optional(),     // 'YYYY-MM-DD'
  contract_end_date:        z.string().optional(),
  sessions_per_week:        z.number().int().nonnegative().optional(),
  session_duration_minutes: z.number().int().positive().optional(),
  notes:                    z.string().optional(),
});

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT cs.*,
       (SELECT COUNT(*)::int FROM schedules s
          WHERE s.contract_school_id = cs.contract_school_id
            AND s.deleted_at IS NULL) AS scheduled_sessions,
       (SELECT COALESCE(SUM(amount),0) FROM contract_school_payments p
          WHERE p.contract_school_id = cs.contract_school_id) AS total_paid
     FROM contract_schools cs
     WHERE cs.branch_id = $1 AND cs.deleted_at IS NULL
     ORDER BY cs.name`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(SchoolBody.required({ name: true })),
  async (req, res) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO contract_schools
         (branch_id, name, address, contact_name, contact_phone,
          contract_start_date, contract_end_date,
          sessions_per_week, session_duration_minutes, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.branch_id, b.name, b.address, b.contact_name, b.contact_phone,
       b.contract_start_date || null, b.contract_end_date || null,
       b.sessions_per_week || null, b.session_duration_minutes || null, b.notes || null]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(SchoolBody),
  async (req, res) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE contract_schools SET
         name                     = COALESCE($1,  name),
         address                  = COALESCE($2,  address),
         contact_name             = COALESCE($3,  contact_name),
         contact_phone            = COALESCE($4,  contact_phone),
         contract_start_date      = COALESCE($5,  contract_start_date),
         contract_end_date        = COALESCE($6,  contract_end_date),
         sessions_per_week        = COALESCE($7,  sessions_per_week),
         session_duration_minutes = COALESCE($8,  session_duration_minutes),
         notes                    = COALESCE($9,  notes)
       WHERE contract_school_id = $10 AND deleted_at IS NULL RETURNING *`,
      [b.name, b.address, b.contact_name, b.contact_phone,
       b.contract_start_date, b.contract_end_date,
       b.sessions_per_week, b.session_duration_minutes, b.notes,
       req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Contract school not found' });
    res.json(rows[0]);
  }
);

router.post('/:id/payments',
  roleGuard(['owner']),
  validate(z.object({
    amount:  z.number().positive(),
    paid_at: z.string(),
    notes:   z.string().optional(),
  })),
  async (req, res) => {
    const { rows } = await query(
      `INSERT INTO contract_school_payments (contract_school_id, amount, paid_at, notes, recorded_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.body.amount, req.body.paid_at, req.body.notes, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
