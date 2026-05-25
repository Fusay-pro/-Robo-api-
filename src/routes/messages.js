const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

// GET /messages — conversations list (one entry per parent, latest message + unread count)
// Filter to this branch via the students table
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT
       u.user_id          AS parent_id,
       u.name             AS parent_name,
       u.email            AS parent_email,
       latest.body        AS last_message,
       latest.created_at  AS last_at,
       latest.sender_role AS last_sender_role,
       COALESCE(unread.cnt, 0)::int AS unread_count
     FROM users u
     -- only parents who have a student in this branch
     JOIN students st ON st.parent_user_id = u.user_id AND st.branch_id = $1 AND st.deleted_at IS NULL
     JOIN (
       SELECT DISTINCT ON (parent_id)
         parent_id, body, created_at, sender_role
       FROM messages
       ORDER BY parent_id, created_at DESC
     ) latest ON latest.parent_id = u.user_id
     LEFT JOIN (
       SELECT parent_id, COUNT(*) AS cnt
       FROM messages
       WHERE sender_role = 'parent' AND is_read = false
       GROUP BY parent_id
     ) unread ON unread.parent_id = u.user_id
     ORDER BY latest.created_at DESC`,
    [req.user.branch_id]
  );
  res.json(rows);
});

// GET /messages/:parentId — full thread
router.get('/:parentId', async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, u.name AS sender_name
     FROM messages m
     JOIN users u ON m.sender_id = u.user_id
     WHERE m.parent_id = $1
     ORDER BY m.created_at ASC`,
    [req.params.parentId]
  );
  // Mark inbound (parent) messages as read
  await query(
    `UPDATE messages SET is_read = true
     WHERE parent_id = $1 AND sender_role = 'parent' AND is_read = false`,
    [req.params.parentId]
  );
  res.json(rows);
});

// POST /messages/:parentId — staff sends a message to a parent
router.post('/:parentId',
  validate(z.object({ body: z.string().min(1) })),
  async (req, res) => {
    const { rows } = await query(
      `INSERT INTO messages (parent_id, sender_role, sender_id, body, is_read)
       VALUES ($1, 'staff', $2, $3, true) RETURNING *`,
      [req.params.parentId, req.user.user_id, req.body.body]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
