const { query } = require('../config/db');

async function contractGenerator() {
  const { rows: contracts } = await query(
    "SELECT * FROM contracts WHERE status = 'active' AND deleted_at IS NULL"
  );
  for (const contract of contracts) {
    const { rows: schedules } = await query(
      `SELECT s.* FROM schedules s
       JOIN courses c ON s.course_id = c.course_id
       JOIN packages p ON p.course_id = c.course_id
       WHERE p.package_id = $1 AND s.branch_id = $2 AND s.deleted_at IS NULL`,
      [contract.package_id, contract.branch_id]
    );
    for (const sched of schedules) {
      for (let week = 0; week < 4; week++) {
        const d = new Date(sched.starts_at);
        d.setDate(d.getDate() + week * 7);
        const dateStr = d.toISOString().slice(0, 10);
        await query(
          `INSERT INTO contract_sessions (contract_id, schedule_id, scheduled_date)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [contract.contract_id, sched.schedule_id, dateStr]
        );
      }
    }
  }
}

module.exports = { contractGenerator };
