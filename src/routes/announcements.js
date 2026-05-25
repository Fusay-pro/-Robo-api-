const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { roleGuard } = require('../middleware/roleGuard');

const UPLOAD_DIR = path.join(__dirname, '../../uploads/announcements/');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.name AS created_by_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.user_id
       WHERE a.branch_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.created_at DESC LIMIT 50`,
      [req.user.branch_id]
    );
    res.json(rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]); // table not yet created
    throw err;
  }
});

router.post('/',
  roleGuard(['owner']),
  validate(z.object({
    title:     z.string().min(1),
    body:      z.string().optional(),
    image_url: z.string().optional(),
    send_to:   z.string().default('all'),
  })),
  async (req, res) => {
    const { title, body, image_url, send_to } = req.body;
    const { rows } = await query(
      `INSERT INTO announcements (branch_id, title, body, image_url, send_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.branch_id, title, body || null, image_url || null, send_to || 'all', req.user.user_id]
    );
    res.status(201).json(rows[0]);
  }
);

// Upload image, return URL string to store in image_url
router.post('/upload-image',
  roleGuard(['owner', 'super_owner']),
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/announcements/${req.file.filename}` });
  }
);

// GET /announcements/:id/views — who has and hasn't seen this announcement
router.get('/:id/views', roleGuard(['owner', 'super_owner']), async (req, res) => {
  // Parents who have a child in this owner's branch
  const { rows: parents } = await query(
    `SELECT DISTINCT u.user_id, u.name, u.phone, u.email,
            v.viewed_at
     FROM users u
     JOIN students s ON s.parent_user_id = u.user_id
     LEFT JOIN notification_views v
       ON v.user_id = u.user_id
       AND v.notification_type = 'announcement'
       AND v.notification_ref_id = $1
     WHERE u.role = 'parent'
       AND u.deleted_at IS NULL
       AND s.branch_id = $2
       AND s.deleted_at IS NULL
     ORDER BY (v.viewed_at IS NULL) DESC, u.name`,
    [req.params.id, req.user.branch_id]
  );

  const seen = parents.filter(p => p.viewed_at);
  const unseen = parents.filter(p => !p.viewed_at);

  res.json({
    total: parents.length,
    seen_count: seen.length,
    unseen_count: unseen.length,
    seen,
    unseen,
  });
});

router.delete('/:id', roleGuard(['owner']), async (req, res) => {
  // Best-effort cleanup of the uploaded image file before soft-delete
  const { rows: [row] } = await query(
    'SELECT image_url FROM announcements WHERE announcement_id = $1 AND branch_id = $2',
    [req.params.id, req.user.branch_id]
  );
  if (row?.image_url && row.image_url.startsWith('/uploads/announcements/')) {
    const filename = row.image_url.split('/').pop();
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.unlink(filePath, () => { /* ignore ENOENT */ });
  }
  await query('UPDATE announcements SET deleted_at = NOW() WHERE announcement_id = $1 AND branch_id = $2', [req.params.id, req.user.branch_id]);
  res.status(204).send();
});

module.exports = router;
