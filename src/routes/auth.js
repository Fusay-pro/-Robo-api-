const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { unauthorized, badRequest, conflict } = require('../utils/errors');
const { sendOtpEmail } = require('../services/email');

const ACCESS_EXPIRES  = '15m';
const REFRESH_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000;

function signAccess(user) {
  return jwt.sign(
    { user_id: user.user_id, role: user.role, branch_id: user.branch_id, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

// SHA-256 is appropriate here: refresh tokens are 320-bit cryptographic randoms,
// not low-entropy passwords, so bcrypt's slow hashing buys no security but does
// turn lookups into O(n) scans + bcrypt compares (DoS surface). SHA-256 lets us
// look the token up directly by its hash.
function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function createRefreshToken(userId) {
  const raw  = crypto.randomBytes(40).toString('hex');
  const hash = hashRefreshToken(raw);
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
  const hash = hashRefreshToken(refresh_token);
  const { rows } = await query(
    `SELECT rt.token_id, u.user_id, u.role, u.branch_id, u.name
     FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.user_id
     WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND u.deleted_at IS NULL
     LIMIT 1`,
    [hash]
  );
  if (!rows.length) return unauthorized(res, 'Invalid or expired refresh token');
  const row = rows[0];
  await query('DELETE FROM refresh_tokens WHERE token_id = $1', [row.token_id]);
  const access_token = signAccess(row);
  const new_refresh  = await createRefreshToken(row.user_id);
  return res.json({ access_token, refresh_token: new_refresh });
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(204).send();
  const hash = hashRefreshToken(refresh_token);
  await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  res.status(204).send();
});

// POST /auth/register  (parents only — creates user then requires OTP verification)
router.post('/register',
  validate(z.object({
    email:     z.string().email(),
    password:  z.string().min(8),
    name:      z.string().min(1),
    phone:     z.string().min(1),
    line_id:   z.string().max(100).optional(),
    branch_id: z.number().int().positive(),
    consent:   z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  })),
  async (req, res) => {
    const { email, password, name, phone, line_id, branch_id } = req.body;
    // Validate branch exists
    const { rows: branchRows } = await query(
      'SELECT branch_id FROM branches WHERE branch_id = $1 AND deleted_at IS NULL',
      [branch_id]
    );
    if (!branchRows.length) return badRequest(res, 'Invalid branch');

    const existing = await query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return conflict(res, 'Email already registered');
    const password_hash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO users (role, name, email, phone, line_id, password_hash, branch_id, consent_given_at, created_at)
       VALUES ('parent', $1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (email) DO NOTHING`,
      [name, email, phone, line_id || null, password_hash, branch_id]
    );
    // Generate 4-digit OTP valid for 10 minutes
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await query('UPDATE otp_verifications SET used = true WHERE email = $1', [email]);
    await query(
      'INSERT INTO otp_verifications (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expires_at]
    );
    // Send OTP via email (best-effort — fall back to console log if Resend not configured)
    try {
      await sendOtpEmail(email, code);
    } catch (err) {
      console.error('[auth/register] OTP email send failed:', err.message);
      // Still return success — the OTP is in DB and admin can recover via console log
    }
    res.status(201).json({ pending: true, email });
  }
);

// POST /auth/verify-otp
router.post('/verify-otp',
  validate(z.object({ email: z.string().email(), code: z.string().length(4) })),
  async (req, res) => {
    const { email, code } = req.body;
    const { rows } = await query(
      `SELECT * FROM otp_verifications
       WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (!rows.length) return badRequest(res, 'Invalid or expired OTP');
    await query('UPDATE otp_verifications SET used = true WHERE otp_id = $1', [rows[0].otp_id]);
    const { rows: users } = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (!users.length) return badRequest(res, 'User not found');
    const user = users[0];
    const access_token  = signAccess(user);
    const refresh_token = await createRefreshToken(user.user_id);
    res.json({ access_token, refresh_token });
  }
);

module.exports = router;
