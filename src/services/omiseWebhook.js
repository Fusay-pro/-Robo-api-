const crypto = require('crypto');
const { query } = require('../config/db');

function verifySignature(rawBody, signature) {
  if (!process.env.OMISE_WEBHOOK_SECRET) return true; // skip in dev
  const expected = crypto
    .createHmac('sha256', process.env.OMISE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function handleChargeComplete(charge) {
  const { rows } = await query(
    "SELECT * FROM transactions WHERE omise_charge_id = $1 AND status = 'pending'",
    [charge.id]
  );
  if (!rows[0]) return;
  await query(
    "UPDATE transactions SET status = 'confirmed', confirmed_at = NOW() WHERE transaction_id = $1",
    [rows[0].transaction_id]
  );
  await query(
    'UPDATE customer_packages SET is_active = true WHERE customer_package_id = $1',
    [rows[0].customer_package_id]
  );
}

module.exports = { verifySignature, handleChargeComplete };
