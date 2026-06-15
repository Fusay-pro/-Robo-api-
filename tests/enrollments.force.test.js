require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createApp } = require('../src/app');

const app = createApp();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const seeded = { branches: [], users: [], students: [], packages: [], customerPackages: [], schedules: [], courses: [] };

let branchId, courseId, packageId, parentUserId;
let fillerStudentId;

function token({ role, userId }) {
  return jwt.sign(
    { user_id: userId, role, branch_id: branchId, name: `Test ${role}` },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// A student (approved, owned by `parentId`) with an active package holding `classes` credits.
async function makeStudent(parentId, classes) {
  const s = await pool.query(
    `INSERT INTO students (parent_user_id, branch_id, name, approval_status)
     VALUES ($1, $2, 'Test Kid', 'approved') RETURNING student_id`,
    [parentId, branchId]
  );
  const studentId = s.rows[0].student_id;
  seeded.students.push(studentId);
  const cp = await pool.query(
    `INSERT INTO customer_packages (student_id, package_id, is_active, custom_class_count)
     VALUES ($1, $2, true, $3) RETURNING customer_package_id`,
    [studentId, packageId, classes]
  );
  const customerPackageId = cp.rows[0].customer_package_id;
  seeded.customerPackages.push(customerPackageId);
  return { studentId, customerPackageId };
}

// A schedule with max_capacity=1 already filled by one confirmed enrollment.
async function makeFullSchedule() {
  const sc = await pool.query(
    `INSERT INTO schedules (branch_id, course_id, schedule_type, starts_at, ends_at, max_capacity)
     VALUES ($1, $2, 'branch', '2099-03-01T09:00:00', '2099-03-01T10:30:00', 1) RETURNING schedule_id`,
    [branchId, courseId]
  );
  const scheduleId = sc.rows[0].schedule_id;
  seeded.schedules.push(scheduleId);
  await pool.query(
    `INSERT INTO enrollments (student_id, schedule_id, status) VALUES ($1, $2, 'confirmed')`,
    [fillerStudentId, scheduleId]
  );
  return scheduleId;
}

beforeAll(async () => {
  const b = await pool.query(`INSERT INTO branches (name) VALUES ('Force Test Branch') RETURNING branch_id`);
  branchId = b.rows[0].branch_id;
  seeded.branches.push(branchId);

  const c = await pool.query(`INSERT INTO courses (branch_id, name) VALUES ($1, 'Force Course') RETURNING course_id`, [branchId]);
  courseId = c.rows[0].course_id;
  seeded.courses.push(courseId);

  const p = await pool.query(
    `INSERT INTO packages (course_id, name, class_count, price) VALUES ($1, 'Pkg', 10, 0) RETURNING package_id`,
    [courseId]
  );
  packageId = p.rows[0].package_id;
  seeded.packages.push(packageId);

  const parent = await pool.query(
    `INSERT INTO users (branch_id, role, name, email) VALUES ($1, 'parent', 'Test Parent', $2) RETURNING user_id`,
    [branchId, `parent.force.${Date.now()}@test.local`]
  );
  parentUserId = parent.rows[0].user_id;
  seeded.users.push(parentUserId);

  fillerStudentId = (await makeStudent(parentUserId, 10)).studentId; // occupies capacity in full schedules
});

afterAll(async () => {
  await pool.query('DELETE FROM package_redemptions WHERE customer_package_id = ANY($1)', [seeded.customerPackages]);
  await pool.query('DELETE FROM enrollments WHERE schedule_id = ANY($1)', [seeded.schedules]);
  await pool.query('DELETE FROM customer_packages WHERE customer_package_id = ANY($1)', [seeded.customerPackages]);
  await pool.query('DELETE FROM schedules WHERE schedule_id = ANY($1)', [seeded.schedules]);
  await pool.query('DELETE FROM packages WHERE package_id = ANY($1)', [seeded.packages]);
  await pool.query('DELETE FROM courses WHERE course_id = ANY($1)', [seeded.courses]);
  await pool.query('DELETE FROM students WHERE student_id = ANY($1)', [seeded.students]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [seeded.users]);
  await pool.query('DELETE FROM branches WHERE branch_id = ANY($1)', [seeded.branches]);
  await pool.end();
});

describe('POST /enrollments — owner capacity override (force)', () => {
  test('owner with force:true can add a kid to a full session', async () => {
    const scheduleId = await makeFullSchedule();
    const { studentId, customerPackageId } = await makeStudent(parentUserId, 5);

    const res = await request(app)
      .post('/enrollments')
      .set(bearer(token({ role: 'owner', userId: 999100 })))
      .send({ student_id: studentId, schedule_id: scheduleId, customer_package_id: customerPackageId, force: true });

    expect(res.status).toBe(201);
    expect(res.body.schedule_id).toBe(scheduleId);
  });

  test('owner without force is still blocked on a full session', async () => {
    const scheduleId = await makeFullSchedule();
    const { studentId, customerPackageId } = await makeStudent(parentUserId, 5);

    const res = await request(app)
      .post('/enrollments')
      .set(bearer(token({ role: 'owner', userId: 999100 })))
      .send({ student_id: studentId, schedule_id: scheduleId, customer_package_id: customerPackageId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/full/i);
  });

  test('parent cannot use force to overfill a session', async () => {
    const scheduleId = await makeFullSchedule();
    const { studentId, customerPackageId } = await makeStudent(parentUserId, 5);

    const res = await request(app)
      .post('/enrollments')
      .set(bearer(token({ role: 'parent', userId: parentUserId })))
      .send({ student_id: studentId, schedule_id: scheduleId, customer_package_id: customerPackageId, force: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/full/i);
  });

  test('force still respects package balance (no classes remaining)', async () => {
    const scheduleId = await makeFullSchedule();
    const { studentId, customerPackageId } = await makeStudent(parentUserId, 0); // 0 credits

    const res = await request(app)
      .post('/enrollments')
      .set(bearer(token({ role: 'owner', userId: 999100 })))
      .send({ student_id: studentId, schedule_id: scheduleId, customer_package_id: customerPackageId, force: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no classes remaining/i);
  });
});
