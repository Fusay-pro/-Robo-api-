/**
 * Wipe all demo data — keeps branch (phetgasem 69) and your owner account.
 *
 * Run:   node clear_demo.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('Wiping demo data ...');

  // delete in FK-safe order
  await pool.query('DELETE FROM customer_warnings');
  await pool.query('DELETE FROM contract_school_payments');
  await pool.query('DELETE FROM reinstatement_requests');
  await pool.query('DELETE FROM attendance');
  await pool.query('DELETE FROM package_redemptions');
  await pool.query('DELETE FROM contract_sessions');
  await pool.query('DELETE FROM contracts');
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM expenses');
  await pool.query('DELETE FROM schedule_reservations');
  await pool.query('DELETE FROM enrollments');
  await pool.query('DELETE FROM customer_packages');
  await pool.query('DELETE FROM schedules');
  await pool.query('DELETE FROM contract_schools');
  await pool.query('DELETE FROM promotions');
  await pool.query('DELETE FROM packages');
  await pool.query('DELETE FROM courses');
  await pool.query('DELETE FROM course_levels');
  await pool.query('DELETE FROM robot_types');
  await pool.query('DELETE FROM students');
  await pool.query("DELETE FROM users WHERE role IN ('staff','parent') AND email LIKE '%@demo.local'");

  // Show what's left
  const branches = await pool.query('SELECT branch_id, name FROM branches');
  const users    = await pool.query('SELECT user_id, role, name, email FROM users');

  console.log('\n✓ Demo data cleared.\n');
  console.log('Remaining branches:', branches.rows);
  console.log('Remaining users:   ', users.rows);
}

main()
  .catch(e => { console.error('CLEAR FAILED:', e); process.exit(1); })
  .finally(() => pool.end());
