async function checkCapacity(client, scheduleId) {
  // Lock the schedule row first — `FOR UPDATE` can't be combined with the
  // GROUP BY aggregate below, so it's a separate statement that still
  // serializes concurrent bookings against the same session.
  const { rows: locked } = await client.query(
    `SELECT schedule_id FROM schedules WHERE schedule_id = $1 FOR UPDATE`,
    [scheduleId]
  );
  if (!locked[0]) return null;

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
     GROUP BY s.schedule_id, s.max_capacity`,
    [scheduleId]
  );
  return rows[0] || null;
}

module.exports = { checkCapacity };
