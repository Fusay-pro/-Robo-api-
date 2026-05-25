const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await query(
    `SELECT t.*, s.name AS student_name FROM transactions t
     JOIN students s ON t.student_id = s.student_id
     WHERE t.branch_id = $1
     ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.branch_id, limit, offset]
  );
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM transactions WHERE branch_id = $1', [req.user.branch_id]
  );
  res.json({ data: rows, total: parseInt(count), limit, offset });
});

// Staff records a cash/transfer payment for a student buying a package
router.post('/',
  validate(z.object({
    student_id:     z.number().int(),
    package_id:     z.number().int(),
    amount:         z.number().positive(),
    payment_method: z.enum(['cash', 'transfer']),
  })),
  async (req, res) => {
    const { student_id, package_id, amount, payment_method } = req.body;

    // Verify student belongs to this branch
    const { rows: [student] } = await query(
      'SELECT student_id FROM students WHERE student_id = $1 AND branch_id = $2 AND deleted_at IS NULL',
      [student_id, req.user.branch_id]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Create customer_package (inactive until payment confirmed)
    const { rows: [cp] } = await query(
      'INSERT INTO customer_packages (student_id, package_id, is_active) VALUES ($1,$2,false) RETURNING customer_package_id',
      [student_id, package_id]
    );

    // Create pending transaction
    const { rows: [tx] } = await query(
      `INSERT INTO transactions (branch_id, student_id, customer_package_id, amount, payment_method, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [req.user.branch_id, student_id, cp.customer_package_id, amount, payment_method]
    );
    res.status(201).json(tx);
  }
);

// POST /transactions/import — batch import historical payments (owner only)
router.post('/import',
  roleGuard(['owner', 'super_owner']),
  validate(z.object({
    rows: z.array(z.object({
      student_name:   z.string().min(1),
      package_name:   z.string().min(1),
      amount:         z.number().positive(),
      payment_method: z.enum(['cash', 'transfer']),
    })).min(1),
  })),
  async (req, res) => {
    const { rows: importRows } = req.body;
    const branchId = req.user.branch_id;
    const results = [];

    for (const row of importRows) {
      try {
        // Find student by name in this branch
        const { rows: [student] } = await query(
          `SELECT student_id FROM students WHERE LOWER(name) = LOWER($1) AND branch_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [row.student_name, branchId]
        );
        if (!student) throw new Error(`Student "${row.student_name}" not found in this branch`);

        // Find package by name
        const { rows: [pkg] } = await query(
          `SELECT p.package_id FROM packages p
           JOIN courses c ON p.course_id = c.course_id
           WHERE LOWER(p.name) = LOWER($1) AND c.branch_id = $2 LIMIT 1`,
          [row.package_name, branchId]
        );
        if (!pkg) throw new Error(`Package "${row.package_name}" not found`);

        const { rows: [cp] } = await query(
          'INSERT INTO customer_packages (student_id, package_id, is_active) VALUES ($1,$2,true) RETURNING customer_package_id',
          [student.student_id, pkg.package_id]
        );
        const { rows: [tx] } = await query(
          `INSERT INTO transactions (branch_id, student_id, customer_package_id, amount, payment_method, status)
           VALUES ($1,$2,$3,$4,$5,'confirmed') RETURNING transaction_id`,
          [branchId, student.student_id, cp.customer_package_id, row.amount, row.payment_method]
        );
        results.push({ ok: true, student_name: row.student_name, transaction_id: tx.transaction_id });
      } catch (err) {
        results.push({ ok: false, student_name: row.student_name, error: err.message });
      }
    }

    res.json({ results, imported: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  }
);

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({ status: z.enum(['confirmed', 'refunded']) })),
  async (req, res) => {
    const { rows } = await query(
      `UPDATE transactions SET status = $1, confirmed_by_user_id = $2, confirmed_at = NOW()
       WHERE transaction_id = $3 RETURNING *`,
      [req.body.status, req.user.user_id, req.params.id]
    );
    if (req.body.status === 'confirmed' && rows[0]) {
      await query(
        'UPDATE customer_packages SET is_active = true WHERE customer_package_id = $1',
        [rows[0].customer_package_id]
      );
    }
    res.json(rows[0]);
  }
);

module.exports = router;
