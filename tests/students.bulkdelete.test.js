require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createApp } = require('../src/app');

const app = createApp();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const seeded = { branches: [], users: [] };   // students are cleaned up by branch

// The route re-checks the caller's password against the `users` row matching the
// token's user_id, so the owner has to be a real row with a real hash — a made-up
// user_id answers 403 and every assertion below would look like a cap failure.
//
// The password is random per run and never written down: this row is a working
// owner login for as long as it exists, and a run killed between the seed and
// the teardown would otherwise leave a credential in the database that anyone
// reading this file could use. The seed is wrapped so the user row goes away
// even when a later fixture throws.
const OWNER_PASSWORD = crypto.randomBytes(24).toString('hex');

let branchMain, branchOther, branchTie, ownerUserId;
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

  const b3 = await pool.query(
    `INSERT INTO branches (name) VALUES ('Bulk Delete Tie Branch') RETURNING branch_id`
  );
  branchTie = b3.rows[0].branch_id;
  seeded.branches.push(branchTie);

  const hash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const u = await pool.query(
    `INSERT INTO users (branch_id, role, name, email, password_hash)
     VALUES ($1, 'owner', 'Bulk Delete Owner', $2, $3) RETURNING user_id`,
    [branchMain, `bulk-delete-owner-${Date.now()}@test.local`, hash]
  );
  ownerUserId = u.rows[0].user_id;
  seeded.users.push(ownerUserId);

  try {
    // 52: ids 0-49 for the full-page test, 50 for the skip test, 51 to push the
    // oversized batch past the cap. Each test owns its own slice, so the file
    // does not depend on declaration order.
    liveIds = await makeStudents(branchMain, 52);
    alreadyDeletedId = await makeStudent(branchMain, { deleted: true });
    otherBranchId    = await makeStudent(branchOther);

    // Three students sharing one name, in a branch of their own: the list is
    // ordered by name, so without a unique tiebreaker these three rows have no
    // defined order between pages.
    await pool.query(
      `INSERT INTO students (branch_id, name, approval_status)
       SELECT $1, 'Same Name', 'approved' FROM generate_series(1, 3)`,
      [branchTie]
    );
  } catch (err) {
    await cleanup();
    throw err;
  }
}, 60_000);

async function cleanup() {
  await pool.query('DELETE FROM students WHERE branch_id = ANY($1)', [seeded.branches]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [seeded.users]);
  await pool.query('DELETE FROM branches WHERE branch_id = ANY($1)', [seeded.branches]);
}

afterAll(async () => {
  await cleanup();
  await pool.end();
}, 60_000);

test('rejects 51 ids', async () => {
  const res = await request(app)
    .post('/students/bulk-delete')
    .set(bearer(ownerToken(branchMain)))
    .send({ password: OWNER_PASSWORD, student_ids: liveIds.slice(0, 51) });
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
      student_ids: [liveIds[50], alreadyDeletedId, otherBranchId],   // id 50 is this test's own
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

// Offset pagination over a non-unique ORDER BY can show a row twice, or never,
// because the database is free to order the tied rows differently per query.
// Walking the pages one row at a time must still visit all three exactly once.
test('paging through students with identical names visits each exactly once', async () => {
  const seen = [];
  for (let offset = 0; offset < 3; offset++) {
    const res = await request(app)
      .get(`/students?limit=1&offset=${offset}`)
      .set(bearer(ownerToken(branchTie)));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(1);
    seen.push(res.body.data[0].student_id);
  }
  expect(new Set(seen).size).toBe(3);
});
