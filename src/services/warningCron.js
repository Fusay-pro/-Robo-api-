const cron = require('node-cron');
const { query } = require('../config/db');
const { sendToUser } = require('./pushNotify');

async function runWarningCron() {
  await query("DELETE FROM customer_warnings WHERE generated_date = CURRENT_DATE");

  const { rows } = await query(
    `SELECT
       s.student_id, s.branch_id, s.parent_user_id, s.name AS student_name,
       cp.customer_package_id,
       (p.class_count - COUNT(pr.redemption_id)::int) AS remaining
     FROM students s
     JOIN customer_packages cp ON cp.student_id = s.student_id AND cp.is_active = true
     JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN package_redemptions pr ON pr.customer_package_id = cp.customer_package_id
     WHERE s.deleted_at IS NULL
     GROUP BY s.student_id, s.branch_id, s.parent_user_id, s.name, cp.customer_package_id, p.class_count
     HAVING (p.class_count - COUNT(pr.redemption_id)::int) <= 3`
  );

  for (const row of rows) {
    await query(
      'INSERT INTO customer_warnings (student_id, branch_id, classes_remaining) VALUES ($1,$2,$3)',
      [row.student_id, row.branch_id, row.remaining]
    );
    if (row.parent_user_id) {
      await sendToUser(row.parent_user_id, {
        title: row.remaining <= 2 ? `Only ${row.remaining} classes left!` : '3 classes remaining',
        body:  `${row.student_name} is running low. Book a new package before slots fill.`,
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
