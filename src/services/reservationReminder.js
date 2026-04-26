const cron = require('node-cron');
const { query } = require('../config/db');
const { sendToUser } = require('./pushNotify');

async function sendReminders() {
  const { rows } = await query(
    `SELECT sr.reservation_id, s.parent_user_id, s.name AS student_name, sc.starts_at
     FROM schedule_reservations sr
     JOIN students s ON sr.student_id = s.student_id
     JOIN schedules sc ON sr.schedule_id = sc.schedule_id
     WHERE sr.status = 'pending_confirmation'
       AND sr.confirm_deadline BETWEEN NOW() AND NOW() + interval '2 hours'`
  );
  for (const r of rows) {
    if (!r.parent_user_id) continue;
    await sendToUser(r.parent_user_id, {
      title: 'Confirm tomorrow\'s class',
      body:  `${r.student_name} has class tomorrow. Confirm now or lose your spot.`,
      data:  { reservation_id: String(r.reservation_id) },
    });
  }
}

// Daily at 4PM
cron.schedule('0 16 * * *', () => sendReminders().catch(console.error));

module.exports = { sendReminders };
