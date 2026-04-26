async function checkCapacity(client, scheduleId) {
  const { rows } = await client.query(
    `SELECT
       s.schedule_id,
       s.max_capacity,
       COUNT(e.enrollment_id)::int AS booked,
       (s.max_capacity - COUNT(e.enrollment_id)::int) AS spots_left
     FROM schedules s
     LEFT JOIN enrollments e
       ON s.schedule_id = e.schedule_id AND e.status = 'confirmed'
     WHERE s.schedule_id = $1
     GROUP BY s.schedule_id, s.max_capacity
     FOR UPDATE OF s`,
    [scheduleId]
  );
  return rows[0] || null;
}

module.exports = { checkCapacity };
