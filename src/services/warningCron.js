const cron = require('node-cron');
const { query } = require('../config/db');
const { sendToUser } = require('./pushNotify');

async function runWarningCron() {
  await query("DELETE FROM customer_warnings WHERE generated_date = CURRENT_DATE");

  // Pool credits across ALL active packages per kid — one row per kid
  const { rows } = await query(
    `SELECT
       s.student_id, s.branch_id, s.parent_user_id, s.name AS student_name,
       b.low_credit_threshold,
       SUM(p.class_count - COALESCE(used.cnt, 0))::int AS remaining
     FROM students s
     JOIN branches b ON b.branch_id = s.branch_id
     JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
     JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN (
       SELECT customer_package_id, COUNT(*)::int AS cnt
       FROM package_redemptions
       GROUP BY customer_package_id
     ) used ON used.customer_package_id = cp.customer_package_id
     WHERE s.deleted_at IS NULL
     GROUP BY s.student_id, s.branch_id, s.parent_user_id, s.name, b.low_credit_threshold
     HAVING SUM(p.class_count - COALESCE(used.cnt, 0)) <= b.low_credit_threshold
        AND SUM(p.class_count - COALESCE(used.cnt, 0)) >= 0`
  );

  for (const row of rows) {
    await query(
      'INSERT INTO customer_warnings (student_id, branch_id, classes_remaining) VALUES ($1,$2,$3)',
      [row.student_id, row.branch_id, row.remaining]
    );
    if (row.parent_user_id) {
      await sendToUser(row.parent_user_id, {
        title: row.remaining === 0
          ? `${row.student_name} has no classes left`
          : row.remaining === 1
          ? `Only 1 class left for ${row.student_name}`
          : `Only ${row.remaining} classes left for ${row.student_name}`,
        body:  'Book a new package before slots fill up.',
      });
    }
  }

  // Generate next 4 weeks of contract sessions
  const { contractGenerator } = require('./contractGenerator');
  await contractGenerator();
}

// Daily at 8AM
cron.schedule('0 8 * * *', () => runWarningCron().catch(console.error));

module.exports = { runWarningCron };
