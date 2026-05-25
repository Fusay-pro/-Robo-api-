const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

router.post('/',
  validate(z.object({
    fcm_token: z.string().min(1),
    platform:  z.enum(['ios', 'android', 'web']),
  })),
  async (req, res) => {
    const { fcm_token, platform } = req.body;
    await query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, fcm_token) DO NOTHING`,
      [req.user.user_id, fcm_token, platform]
    );
    res.status(201).json({ ok: true });
  }
);

router.delete('/', async (req, res) => {
  const { fcm_token } = req.body || {};
  if (fcm_token) {
    await query('DELETE FROM device_tokens WHERE user_id = $1 AND fcm_token = $2', [req.user.user_id, fcm_token]);
  } else {
    await query('DELETE FROM device_tokens WHERE user_id = $1', [req.user.user_id]);
  }
  res.status(204).send();
});

module.exports = router;
