const { query } = require('../config/db');

// Pass a transaction client to lock the package row and prevent double-booking races.
// Falls back to the global pool when called outside a transaction.
async function getClassesRemaining(studentId, client) {
  const run = client ? (sql, p) => client.query(sql, p) : query;
  const { rows } = await run(
    `SELECT
       cp.customer_package_id,
       COALESCE(cp.custom_class_count, p.class_count) AS total,
       COUNT(pr.redemption_id)::int AS used,
       (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS remaining
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE cp.student_id = $1 AND cp.is_active = true
     GROUP BY cp.customer_package_id, p.class_count, cp.custom_class_count
     FOR UPDATE OF cp`,
    [studentId]
  );
  return rows;
}

module.exports = { getClassesRemaining };
