const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { unauthorized, badRequest, conflict } = require('../utils/errors');

const ACCESS_EXPIRES  = '15m';
const REFRESH_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000;

function signAccess(user) {
  return jwt.sign(
    { user_id: user.user_id, role: user.role, branch_id: user.branch_id },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

async function createRefreshToken(userId) {
  const raw  = crypto.randomBytes(40).toString('hex');
  const hash = await bcrypt.hash(raw, 10);
  const exp  = new Date(Date.now() + REFRESH_EXPIRES_MS);
  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, exp]
  );
  return raw;
}

// POST /auth/login
router.post('/login',
  validate(z.object({ email: z.string().email(), password: z.string() })),
  async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]
    );
    const user = rows[0];
    if (!user || !user.password_hash) return unauthorized(res, 'Invalid credentials');
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return unauthorized(res, 'Invalid credentials');
    const access_token  = signAccess(user);
    const refresh_token = await createRefreshToken(user.user_id);
    res.json({ access_token, refresh_token, role: user.role });
  }
);

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return badRequest(res, 'refresh_token required');
  const { rows } = await query(
    `SELECT rt.*, u.user_id, u.role, u.branch_id
     FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.user_id
     WHERE rt.expires_at > NOW() AND u.deleted_at IS NULL`
  );
  for (const row of rows) {
    const match = await bcrypt.compare(refresh_token, row.token_hash);
    if (match) {
      await query('DELETE FROM refresh_tokens WHERE token_id = $1', [row.token_id]);
      const access_token = signAccess(row);
      const new_refresh  = await createRefreshToken(row.user_id);
      return res.json({ access_token, refresh_token: new_refresh });
    }
  }
  return unauthorized(res, 'Invalid or expired refresh token');
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(204).send();
  const { rows } = await query('SELECT * FROM refresh_tokens');
  for (const row of rows) {
    const match = await bcrypt.compare(refresh_token, row.token_hash);
    if (match) {
      await query('DELETE FROM refresh_tokens WHERE token_id = $1', [row.token_id]);
      break;
    }
  }
  res.status(204).send();
});

// POST /auth/register  (parents only)
router.post('/register',
  validate(z.object({
    email:    z.string().email(),
    password: z.string().min(8),
    name:     z.string().min(1),
    phone:    z.string().min(1),
    consent:  z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  })),
  async (req, res) => {
    const { email, password, name, phone } = req.body;
    const existing = await query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return conflict(res, 'Email already registered');
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (role, name, email, phone, password_hash, consent_given_at, created_at)
       VALUES ('parent', $1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
      [name, email, phone, password_hash]
    );
    const user = rows[0];
    const access_token  = signAccess(user);
    const refresh_token = await createRefreshToken(user.user_id);
    res.status(201).json({ access_token, refresh_token });
  }
);

module.exports = router;
