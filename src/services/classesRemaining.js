const { query } = require('../config/db');

async function getClassesRemaining(studentId) {
  const { rows } = await query(
    `SELECT
       cp.customer_package_id,
       p.class_count AS total,
       COUNT(pr.redemption_id)::int AS used,
       (p.class_count - COUNT(pr.redemption_id)::int) AS remaining
     FROM customer_packages cp
     JOIN packages p ON cp.package_id = p.package_id
     LEFT JOIN package_redemptions pr ON cp.customer_package_id = pr.customer_package_id
     WHERE cp.student_id = $1 AND cp.is_active = true
     GROUP BY cp.customer_package_id, p.class_count`,
    [studentId]
  );
  return rows;
}

module.exports = { getClassesRemaining };
