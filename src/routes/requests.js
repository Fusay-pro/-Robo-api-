const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');
const { notFound, badRequest } = require('../utils/errors');
const { sendToUser } = require('../services/pushNotify');

// GET /requests?type=cancellation&status=pending  — staff/owner facing list
router.get('/',
  roleGuard(['owner', 'super_owner', 'staff']),
  async (req, res) => {
    const type   = req.query.type   || null;
    const status = req.query.status || 'pending';
    const params = [];
    const conditions = [];
    if (type)   { params.push(type);   conditions.push(`r.type = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT r.*, u.name AS parent_name, u.phone AS parent_phone
       FROM requests r
       JOIN users u ON u.user_id = r.parent_id
       ${where}
       ORDER BY r.created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  }
);

// PATCH /requests/:id  — approve / reject (owner only for cancellation)
router.patch('/:id',
  validate(z.object({
    action: z.enum(['approve', 'reject']),
    note:   z.string().max(500).optional(),
  })),
  async (req, res) => {
    const { action, note } = req.body;
    const { rows: [reqRow] } = await query(
      'SELECT * FROM requests WHERE request_id = $1',
      [req.params.id]
    );
    if (!reqRow) return notFound(res);
    if (reqRow.status !== 'pending') return badRequest(res, 'Request already reviewed');

    // Only owners can approve cancellations; staff blocked
    if (reqRow.type === 'cancellation' && req.user.role !== 'owner' && req.user.role !== 'super_owner') {
      return res.status(403).json({ error: 'Only owners can decide on cancellation requests' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Side-effect: if cancellation approved, mark enrollment as cancelled
    if (reqRow.type === 'cancellation' && action === 'approve') {
      const enrollmentId = reqRow.details?.enrollment_id;
      if (enrollmentId) {
        await query(
          `UPDATE enrollments SET status = 'cancelled' WHERE enrollment_id = $1`,
          [enrollmentId]
        );
      }
    }

    const { rows: [updated] } = await query(
      `UPDATE requests SET status = $1, updated_at = NOW() WHERE request_id = $2 RETURNING *`,
      [newStatus, req.params.id]
    );

    // Send a message + push to the parent
    const labels = { approve: 'approved', reject: 'rejected' };
    const body = note
      ? `Your ${reqRow.type} request was ${labels[action]}: ${note}`
      : `Your ${reqRow.type} request was ${labels[action]}`;
    await query(
      `INSERT INTO messages (parent_id, sender_role, sender_id, body, request_id)
       VALUES ($1, 'staff', $2, $3, $4)`,
      [reqRow.parent_id, req.user.user_id, body, reqRow.request_id]
    );
    try {
      await sendToUser(reqRow.parent_id, {
        title: `Request ${labels[action]}`,
        body,
        data: { request_id: String(reqRow.request_id), type: reqRow.type },
      });
    } catch (_) { /* push is best-effort */ }

    res.json(updated);
  }
);

module.exports = router;
