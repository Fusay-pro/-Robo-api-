const cron = require('node-cron');
const { query } = require('../config/db');

// The error log is a record to read after the fact, not an archive, and the
// database is on Supabase's free tier. Thirty days is long enough to explain
// "it broke last week" and short enough that the table cannot grow forever.
const KEEP_DAYS = 30;

async function pruneErrorLog() {
  const { rows } = await query(
    `DELETE FROM error_log
     WHERE occurred_at < NOW() - INTERVAL '${KEEP_DAYS} days'
     RETURNING log_id`
  );
  if (rows.length) console.log(`Pruned ${rows.length} error log rows older than ${KEEP_DAYS} days`);
  return rows.length;
}

// Daily at 4:10AM, away from the other crons' hours.
cron.schedule('10 4 * * *', () => pruneErrorLog().catch(console.error));

module.exports = { pruneErrorLog, KEEP_DAYS };
