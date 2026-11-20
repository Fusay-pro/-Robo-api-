require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { createApp } = require('../src/app');

const app = createApp();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const seeded = { branches: [], users: [] };   // students are cleaned up by branch

// The route re-checks the caller's password against the `users` row matching the
// token's user_id, so the owner has to be a real row with a real hash — a made-up
// user_id answers 403 and every assertion below would look like a cap failure.
const OWNER_PASSWORD = 'bulk-delete-test-pw';

let branchMain, branchOther, ownerUserId;
let liveIds = [];          // 51 approved students in branchMain
let alreadyDeletedId;      // soft-deleted before the request
let otherBranchId;         // student in branchOther, outside the caller's scope

function ownerToken(branchId) {
  return jwt.sign(
    { user_id: ownerUserId, role: 'owner', branch_id: branchId, name: 'Test Owner' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function makeStudent(branchId, { deleted = false } = {}) {
  const s = await pool.query(
    `INSERT INTO students (branch_id, name, approval_status, deleted_at)
     VALUES ($1, 'Bulk Delete Kid', 'approved', $2) RETURNING student_id`,
    [branchId, deleted ? new Date() : null]
  );
  return s.rows[0].student_id;
}

// 51 rows in one statement: inserting them one await at a time blows the hook
// timeout against a remote database.
async function makeStudents(branchId, count) {
  const s = await pool.query(
    `INSERT INTO students (branch_id, name, approval_status)
     SELECT $1, 'Bulk Delete Kid ' || i, 'approved'
     FROM generate_series(1, $2) AS i
     RETURNING student_id`,
    [branchId, count]
  );
  return s.rows.map(r => r.student_id);
}

beforeAll(async () => {
  const b1 = await pool.query(
    `INSERT INTO branches (name) VALUES ('Bulk Delete Branch') RETURNING branch_id`
  );
  branchMain = b1.rows[0].branch_id;
  seeded.branches.push(branchMain);

  const b2 = await pool.query(
    `INSERT INTO branches (name) VALUES ('Bulk Delete Other Branch') RETURNING branch_id`
  );
  branchOther = b2.rows[0].branch_id;
  seeded.branches.push(branchOther);

  const hash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const u = await pool.query(
    `INSERT INTO users (branch_id, role, name, email, password_hash)
     VALUES ($1, 'owner', 'Bulk Delete Owner', $2, $3) RETURNING user_id`,
    [branchMain, `bulk-delete-owner-${Date.now()}@test.local`, hash]
  );
  ownerUserId = u.rows[0].user_id;
  seeded.users.push(ownerUserId);

  liveIds = await makeStudents(branchMain, 51);
  alreadyDeletedId = await makeStudent(branchMain, { deleted: true });
  otherBranchId    = await makeStudent(branchOther);
}, 60_000);

afterAll(async () => {
  await pool.query('DELETE FROM students WHERE branch_id = ANY($1)', [seeded.branches]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [seeded.users]);
  await pool.query('DELETE FROM branches WHERE branch_id = ANY($1)', [seeded.branches]);
  await pool.end();
}, 60_000);

test('rejects 51 ids', async () => {
  const res = await request(app)
    .post('/students/bulk-delete')
    .set(bearer(ownerToken(branchMain)))
    .send({ password: OWNER_PASSWORD, student_ids: liveIds });
  expect(res.status).toBe(400);
});

// Review Focus 5: a batch can hold ids that are already gone or belong to
// another branch; those are reported, not counted as deleted.
test('counts already-deleted and other-branch ids as skipped', async () => {
  const res = await request(app)
    .post('/students/bulk-delete')
    .set(bearer(ownerToken(branchMain)))
    .send({
      password: OWNER_PASSWORD,
      student_ids: [liveIds[50], alreadyDeletedId, otherBranchId],
    });
  expect(res.status).toBe(200);
  expect(res.body.deleted).toBe(1);
  expect(res.body.skipped).toBe(2);
});

test('accepts a full page of 50 ids', async () => {
  const fiftyIds = liveIds.slice(0, 50);
  const res = await request(app)
    .post('/students/bulk-delete')
    .set(bearer(ownerToken(branchMain)))
    .send({ password: OWNER_PASSWORD, student_ids: fiftyIds });
  expect(res.status).toBe(200);
  expect(res.body.deleted).toBe(50);
  expect(res.body.skipped).toBe(0);
});
