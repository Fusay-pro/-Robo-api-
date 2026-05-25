const { pool } = require('../config/db');
const { getClassesRemaining } = require('./classesRemaining');
const { checkCapacity } = require('./capacityCheck');
const { sendToUser } = require('./pushNotify');

async function createEnrollment({ studentId, scheduleId, packageId, parentUserId, bookingNote }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const capacity = await checkCapacity(client, scheduleId);
    if (!capacity) {
      await client.query('ROLLBACK');
      const err = new Error('Schedule not found'); err.status = 404; throw err;
    }
    if (capacity.spots_left <= 0) {
      await client.query('ROLLBACK');
      const err = new Error('Session is full'); err.status = 400; throw err;
    }

    const remaining = await getClassesRemaining(studentId);
    const pkg = remaining.find(r => r.customer_package_id === Number(packageId));
    if (!pkg || pkg.remaining <= 0) {
      await client.query('ROLLBACK');
      const err = new Error('No classes remaining'); err.status = 400; throw err;
    }

    const lowWarning = pkg.remaining <= 3;

    const { rows: [enrollment] } = await client.query(
      `INSERT INTO enrollments (student_id, schedule_id, customer_package_id, status, low_class_warning, booking_note)
       VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING *`,
      [studentId, scheduleId, packageId, lowWarning, bookingNote || null]
    );

    await client.query(
      'INSERT INTO package_redemptions (customer_package_id, enrollment_id) VALUES ($1, $2)',
      [packageId, enrollment.enrollment_id]
    );

    await client.query('COMMIT');

    // Outside transaction
    if (parentUserId) {
      await sendToUser(parentUserId, {
        title: 'Booking Confirmed',
        body: 'Your child\'s class has been booked successfully.',
      });
      if (lowWarning) {
        await sendToUser(parentUserId, {
          title: pkg.remaining <= 2 ? `Only ${pkg.remaining} classes left!` : '3 classes remaining',
          body: 'Consider buying a new package before slots fill up.',
        });
      }
    }

    return enrollment;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createEnrollment };
