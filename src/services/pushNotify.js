const { query } = require('../config/db');

let admin;
function getAdmin() {
  if (!admin) admin = require('../config/firebase');
  return admin;
}

async function sendToUser(userId, { title, body, data = {} }) {
  if (!userId) return;
  const { rows } = await query(
    'SELECT fcm_token FROM device_tokens WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) return;

  const tokens = rows.map(r => r.fcm_token);
  try {
    await getAdmin().messaging().sendEachForMulticast({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      tokens,
    });
  } catch (err) {
    console.error('FCM sendToUser error:', err.message);
  }
}

async function sendToRole(branchId, role, { title, body }) {
  if (!branchId) return;
  const { rows } = await query(
    `SELECT dt.fcm_token
     FROM device_tokens dt
     JOIN users u ON dt.user_id = u.user_id
     WHERE u.branch_id = $1 AND u.role = $2 AND u.deleted_at IS NULL`,
    [branchId, role]
  );
  if (!rows.length) return;
  try {
    await getAdmin().messaging().sendEachForMulticast({
      notification: { title, body },
      tokens: rows.map(r => r.fcm_token),
    });
  } catch (err) {
    console.error('FCM sendToRole error:', err.message);
  }
}

module.exports = { sendToUser, sendToRole };
