const cron = require('node-cron');
const { query } = require('../config/db');

async function releaseStale() {
  const { rows } = await query(
    `UPDATE schedule_reservations SET status = 'released'
     WHERE status = 'pending_confirmation' AND confirm_deadline < NOW()
     RETURNING reservation_id`
  );
  if (rows.length) console.log(`Released ${rows.length} stale reservations`);
}

// Every hour
cron.schedule('0 * * * *', () => releaseStale().catch(console.error));

module.exports = { releaseStale };
