const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { unauthorized, badRequest, serverError } = require('../utils/errors');

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

// POST /auth/line
router.post('/line', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code) return badRequest(res, 'code required');
  try {
    const tokenRes = await axios.post('https://api.line.me/oauth2/v2.1/token', null, {
      params: {
        grant_type:    'authorization_code',
        code,
        redirect_uri,
        client_id:     process.env.LINE_CHANNEL_ID,
        client_secret: process.env.LINE_CHANNEL_SECRET,
      },
    });
    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const { userId: lineUserId, displayName } = profileRes.data;
    let { rows } = await query('SELECT * FROM users WHERE line_user_id = $1', [lineUserId]);
    let user = rows[0];
    let profile_incomplete = false;
    if (!user) {
      const ins = await query(
        `INSERT INTO users (role, name, line_user_id, created_at)
         VALUES ('parent', $1, $2, NOW()) RETURNING *`,
        [displayName, lineUserId]
      );
      user = ins.rows[0];
      profile_incomplete = true;
    }
    const access_token  = signAccess(user);
    const refresh_token = await createRefreshToken(user.user_id);
    res.json({ access_token, refresh_token, profile_incomplete });
  } catch (err) {
    console.error('LINE OAuth error:', err.message);
    return serverError(res, 'LINE authentication failed');
  }
});

module.exports = router;
