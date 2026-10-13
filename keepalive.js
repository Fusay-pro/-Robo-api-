// Supabase free-tier pauses a project after ~7 days with no DB activity.
// This runs a trivial query on a schedule so the project stays awake.
// NOTE: only helps while this machine is powered on and able to run cron.
require('dotenv').config();
const { query } = require('./src/config/db');

(async () => {
  try {
    await query('SELECT 1');
    console.log(`${new Date().toISOString()} keepalive OK`);
  } catch (e) {
    console.error(`${new Date().toISOString()} keepalive FAILED: ${e.message}`);
  } finally {
    process.exit(0);
  }
})();
