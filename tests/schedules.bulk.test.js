require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createApp } = require('../src/app');

const app = createApp();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Seeded fixture ids, filled in beforeAll and torn down in afterAll.
const seeded = { branches: [], courses: [], robotTypes: [], users: [] };

function ownerToken(branchId) {
  return jwt.sign(
    { user_id: 999001, role: 'owner', branch_id: branchId, name: 'Test Owner' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// Two non-overlapping sessions a week apart — the happy-path body for capacity tests.
function twoSessions() {
  return [
    { starts_at: '2099-01-05T09:00:00', ends_at: '2099-01-05T10:30:00' },
    { starts_at: '2099-01-12T09:00:00', ends_at: '2099-01-12T10:30:00' },
  ];
}

let branchMain;   // capacity_per_teacher = 15
let branchZero;   // capacity_per_teacher = 0  → exercises the literal `|| 10` fallback
let courseRobot;  // linked to a robot_type with quantity 6
let courseNoRobot; // robot_type_id NULL → falls through to branch capacity
let teacherId;

beforeAll(async () => {
  const b1 = await pool.query(
    `INSERT INTO branches (name, capacity_per_teacher) VALUES ('Bulk Test Branch', 15) RETURNING branch_id`
  );
  branchMain = b1.rows[0].branch_id;
  seeded.branches.push(branchMain);

  const b2 = await pool.query(
    `INSERT INTO branches (name, capacity_per_teacher) VALUES ('Bulk Zero Branch', 0) RETURNING branch_id`
  );
  branchZero = b2.rows[0].branch_id;
  seeded.branches.push(branchZero);

  const rt = await pool.query(
    `INSERT INTO robot_types (branch_id, name, quantity) VALUES ($1, 'Test Robot', 6) RETURNING robot_type_id`,
    [branchMain]
  );
  const robotTypeId = rt.rows[0].robot_type_id;
  seeded.robotTypes.push(robotTypeId);

  const c1 = await pool.query(
    `INSERT INTO courses (branch_id, name, robot_type_id) VALUES ($1, 'Course With Robot', $2) RETURNING course_id`,
    [branchMain, robotTypeId]
  );
  courseRobot = c1.rows[0].course_id;
  seeded.courses.push(courseRobot);

  const c2 = await pool.query(
    `INSERT INTO courses (branch_id, name, robot_type_id) VALUES ($1, 'Course No Robot', NULL) RETURNING course_id`,
    [branchMain]
  );
  courseNoRobot = c2.rows[0].course_id;
  seeded.courses.push(courseNoRobot);

  const u = await pool.query(
    `INSERT INTO users (branch_id, role, name, email) VALUES ($1, 'staff', 'Test Teacher', $2) RETURNING user_id`,
    [branchMain, `teacher.bulk.${Date.now()}@test.local`]
  );
  teacherId = u.rows[0].user_id;
  seeded.users.push(teacherId);
});

afterAll(async () => {
  // Remove anything created during the tests, then the fixtures (FK-safe order).
  await pool.query('DELETE FROM schedules WHERE branch_id = ANY($1)', [seeded.branches]);
  if (seeded.courses.length)    await pool.query('DELETE FROM courses WHERE course_id = ANY($1)', [seeded.courses]);
  if (seeded.robotTypes.length) await pool.query('DELETE FROM robot_types WHERE robot_type_id = ANY($1)', [seeded.robotTypes]);
  if (seeded.users.length)      await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [seeded.users]);
  if (seeded.branches.length)   await pool.query('DELETE FROM branches WHERE branch_id = ANY($1)', [seeded.branches]);
  await pool.end();
});

describe('POST /schedules/bulk — capacity resolution', () => {
  test('explicit max_capacity wins over course/branch defaults', async () => {
    const res = await request(app)
      .post('/schedules/bulk')
      .set(bearer(ownerToken(branchMain)))
      .send({ course_id: courseRobot, max_capacity: 20, sessions: twoSessions() });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.schedules.every(s => s.max_capacity === 20)).toBe(true);
  });

  test("course's robot-type quantity is used when no explicit capacity", async () => {
    const res = await request(app)
      .post('/schedules/bulk')
      .set(bearer(ownerToken(branchMain)))
      .send({ course_id: courseRobot, sessions: twoSessions() });

    expect(res.status).toBe(201);
    expect(res.body.schedules.every(s => s.max_capacity === 6)).toBe(true);
  });

  test('branch capacity is used when course has no robot quantity', async () => {
    const res = await request(app)
      .post('/schedules/bulk')
      .set(bearer(ownerToken(branchMain)))
      .send({ course_id: courseNoRobot, sessions: twoSessions() });

    expect(res.status).toBe(201);
    expect(res.body.schedules.every(s => s.max_capacity === 15)).toBe(true);
  });

  test('falls back to 10 when neither course nor branch provides capacity', async () => {
    const res = await request(app)
      .post('/schedules/bulk')
      .set(bearer(ownerToken(branchZero)))
      .send({ sessions: twoSessions() });

    expect(res.status).toBe(201);
    expect(res.body.schedules.every(s => s.max_capacity === 10)).toBe(true);
  });
});

describe('POST /schedules/bulk — teacher overlap within payload', () => {
  test('rejects overlapping sessions for the same teacher and inserts nothing', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM schedules WHERE teacher_user_id = $1',
      [teacherId]
    );

    const res = await request(app)
      .post('/schedules/bulk')
      .set(bearer(ownerToken(branchMain)))
      .send({
        teacher_user_id: teacherId,
        sessions: [
          { starts_at: '2099-02-01T09:00:00', ends_at: '2099-02-01T11:00:00' },
          { starts_at: '2099-02-01T10:00:00', ends_at: '2099-02-01T12:00:00' }, // overlaps the first
        ],
      });

    expect(res.status).toBe(409);

    const after = await pool.query(
      'SELECT count(*)::int AS n FROM schedules WHERE teacher_user_id = $1',
      [teacherId]
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
