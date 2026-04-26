const router = require('express').Router();
const { z } = require('zod');
const path = require('path');
const multer = require('multer');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { sendToUser, sendToRole } = require('../services/pushNotify');

const upload = multer({ dest: path.join(__dirname, '../../uploads/reinstatements/') });

router.post('/',
  roleGuard(['parent']),
  upload.single('evidence'),
  async (req, res) => {
    const schema = z.object({
      attendance_id:       z.string().transform(Number),
      student_id:          z.string().transform(Number),
      customer_package_id: z.string().transform(Number),
      reason_category:     z.enum(['medical', 'bereavement', 'accident']),
      reason_detail:       z.string().min(50, 'reason_detail must be at least 50 characters'),
    });
    const result = schema.safeParse(req.body);
    if (!result.success) return badRequest(res, result.error.errors[0].message);
    const { attendance_id, student_id, customer_package_id, reason_category, reason_detail } = result.data;
    if (!req.file) return badRequest(res, 'evidence file required');
    const { rows: [student] } = await query(
      'SELECT * FROM students WHERE student_id = $1 AND parent_user_id = $2',
      [student_id, req.user.user_id]
    );
    if (!student) return forbidden(res);
    const { rows: [att] } = await query(
      "SELECT * FROM attendance WHERE attendance_id = $1 AND status = 'absent'", [attendance_id]
    );
    if (!att) return badRequest(res, 'No absent attendance record found for this session');
    const { rows: [{ count }] } = await query(
      "SELECT COUNT(*) FROM reinstatement_requests WHERE customer_package_id = $1 AND status != 'rejected'",
      [customer_package_id]
    );
    if (parseInt(count) >= 2) return res.status(403).json({ error: 'Maximum reinstatements reached for this package' });
    const evidenceUrl = `/uploads/reinstatements/${req.file.filename}`;
    const { rows } = await query(
      `INSERT INTO reinstatement_requests
         (attendance_id, student_id, customer_package_id, reason_category, reason_detail, evidence_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [attendance_id, student_id, customer_package_id, reason_category, reason_detail, evidenceUrl]
    );
    await sendToRole(student.branch_id, 'owner', {
      title: 'Emergency reinstatement request',
      body: `${student.name}: ${reason_category} — review required`,
    });
    res.status(201).json(rows[0]);
  }
);

router.get('/', async (req, res) => {
  let rows;
  if (req.user.role === 'parent') {
    ({ rows } = await query(
      `SELECT rr.*, s.name AS student_name FROM reinstatement_requests rr
       JOIN students s ON rr.student_id = s.student_id
       WHERE s.parent_user_id = $1 ORDER BY rr.created_at DESC`,
      [req.user.user_id]
    ));
  } else {
    ({ rows } = await query(
      `SELECT rr.*, s.name AS student_name FROM reinstatement_requests rr
       JOIN students s ON rr.student_id = s.student_id
       WHERE s.branch_id = $1 ORDER BY rr.created_at DESC`,
      [req.user.branch_id]
    ));
  }
  res.json(rows);
});

router.patch('/:id',
  roleGuard(['owner']),
  validate(z.object({
    status:        z.enum(['approved', 'rejected']),
    reviewer_note: z.string().optional(),
  })),
  async (req, res) => {
    const { status, reviewer_note } = req.body;
    if (status === 'rejected' && !reviewer_note) return badRequest(res, 'reviewer_note required when rejecting');
    const { rows: [rr] } = await query('SELECT * FROM reinstatement_requests WHERE request_id = $1', [req.params.id]);
    if (!rr) return notFound(res);
    if (rr.status !== 'pending') return badRequest(res, 'Already reviewed');
    const { rows } = await query(
      `UPDATE reinstatement_requests SET
         status = $1, reviewer_note = $2, reviewed_by_user_id = $3, reviewed_at = NOW()
       WHERE request_id = $4 RETURNING *`,
      [status, reviewer_note, req.user.user_id, req.params.id]
    );
    if (status === 'approved') {
      await query(
        `DELETE FROM package_redemptions WHERE redemption_id = (
           SELECT redemption_id FROM package_redemptions
           WHERE customer_package_id = $1
           ORDER BY created_at DESC LIMIT 1
         )`,
        [rr.customer_package_id]
      );
    }
    const { rows: [student] } = await query('SELECT * FROM students WHERE student_id = $1', [rr.student_id]);
    await sendToUser(student.parent_user_id, {
      title: status === 'approved' ? 'Reinstatement Approved' : 'Reinstatement Rejected',
      body:  status === 'approved' ? 'Your class credit has been restored.' : `Not approved: ${reviewer_note}`,
    });
    res.json(rows[0]);
  }
);

module.exports = router;
