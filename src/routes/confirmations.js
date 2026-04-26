const router = require('express').Router();
const { query } = require('../config/db');
const { roleGuard } = require('../middleware/roleGuard');
const { sendToUser } = require('../services/pushNotify');
const { notFound, badRequest } = require('../utils/errors');

router.get('/pending', roleGuard(['owner', 'staff']), async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.name AS parent_name, u.phone AS parent_phone
     FROM students s
     JOIN users u ON s.parent_user_id = u.user_id
     WHERE s.branch_id = $1 AND s.approval_status = 'pending' AND s.deleted_at IS NULL`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.patch('/:studentId', roleGuard(['owner', 'staff']), async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return badRequest(res, 'status must be approved or rejected');
  }
  const { rows } = await query(
    `UPDATE students SET
       approval_status = $1, confirmed_by_user_id = $2, confirmed_at = NOW()
     WHERE student_id = $3 AND deleted_at IS NULL RETURNING *`,
    [status, req.user.user_id, req.params.studentId]
  );
  if (!rows[0]) return notFound(res);
  await sendToUser(rows[0].parent_user_id, {
    title: status === 'approved' ? 'Child account approved!' : 'Child account not approved',
    body:  status === 'approved'
      ? `${rows[0].name} can now be enrolled in courses.`
      : 'Please contact the branch for more information.',
  });
  res.json(rows[0]);
});

module.exports = router;
