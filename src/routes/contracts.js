const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', roleGuard(['owner', 'staff']), async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, s.name AS student_name, p.name AS package_name
     FROM contracts c
     JOIN students s ON c.student_id = s.student_id
     JOIN packages p ON c.package_id = p.package_id
     WHERE c.branch_id = $1 AND c.deleted_at IS NULL ORDER BY c.start_date DESC`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    student_id:  z.number().int(),
    package_id:  z.number().int(),
    start_date:  z.string(),
  })),
  async (req, res) => {
    const { student_id, package_id, start_date } = req.body;
    const { rows } = await query(
      `INSERT INTO contracts (student_id, package_id, branch_id, start_date, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [student_id, package_id, req.user.branch_id, start_date, req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({ status: z.enum(['active', 'paused', 'cancelled']) })),
  async (req, res) => {
    const { rows } = await query(
      'UPDATE contracts SET status = $1 WHERE contract_id = $2 RETURNING *',
      [req.body.status, req.params.id]
    );
    res.json(rows[0]);
  }
);

module.exports = router;
