require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createApp } = require('../src/app');

const app = createApp();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Branch ids are plain ints with no foreign key, so these fixtures need no
// branches, users or students — nothing in this file touches real data, and
// every row it writes is removed in afterAll.
const BRANCH_MINE = 990001;
const BRANCH_OTHER = 990002;

const token = (role, branch_id) =>
  jwt.sign({ user_id: 990009, role, branch_id, name: 'Test' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

let written = [];

async function seed(row) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO error_log (occurred_at, status, method, path, message, stack, user_id, role, branch_id, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING log_id`,
    [row.occurred_at, row.status, row.method || 'GET', row.path || '/students',
     row.message || 'boom', row.stack || null, row.user_id ?? null, row.role || 'owner',
     row.branch_id ?? null, row.request_id || 'req-test']
  );
  written.push(r.log_id);
  return r.log_id;
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

let idNewest, idOld, idOtherBranch, idNoBranch, idServer;

beforeAll(async () => {
  idServer      = await seed({ occurred_at: hoursAgo(50),  status: 500, branch_id: BRANCH_MINE, stack: 'Error: nope\n  at x' });
  idOld         = await seed({ occurred_at: hoursAgo(26),  status: 404, branch_id: BRANCH_MINE });
  idOtherBranch = await seed({ occurred_at: hoursAgo(3),   status: 400, branch_id: BRANCH_OTHER });
  idNoBranch    = await seed({ occurred_at: hoursAgo(2),   status: 400, branch_id: null });
  idNewest      = await seed({ occurred_at: hoursAgo(1),   status: 403, branch_id: BRANCH_MINE, message: 'Forbidden' });
});

afterAll(async () => {
  if (written.length) await pool.query('DELETE FROM error_log WHERE log_id = ANY($1::int[])', [written]);
  await pool.end();
});

const mine = (body) => body.data.filter(r => written.includes(r.log_id));

describe('GET /admin/logs — who may read it', () => {
  test('staff and parents may not', async () => {
    expect((await request(app).get('/admin/logs').set(bearer(token('staff', BRANCH_MINE)))).status).toBe(403);
    expect((await request(app).get('/admin/logs').set(bearer(token('parent', BRANCH_MINE)))).status).toBe(403);
  });

  test('without a token it is a 401, not a log', async () => {
    expect((await request(app).get('/admin/logs')).status).toBe(401);
  });

  test('an owner may', async () => {
    const res = await request(app).get('/admin/logs').set(bearer(token('owner', BRANCH_MINE)));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /admin/logs — what an owner sees', () => {
  test("own branch and branch-less rows, never another branch's", async () => {
    const res = await request(app).get('/admin/logs?limit=200').set(bearer(token('owner', BRANCH_MINE)));
    const ids = mine(res.body).map(r => r.log_id);
    expect(ids).toContain(idNewest);
    expect(ids).toContain(idNoBranch);     // a failure with no session still has to be readable
    expect(ids).not.toContain(idOtherBranch);
  });

  test('a super_owner sees every branch', async () => {
    const res = await request(app).get('/admin/logs?limit=200').set(bearer(token('super_owner', BRANCH_MINE)));
    const ids = mine(res.body).map(r => r.log_id);
    expect(ids).toContain(idOtherBranch);
  });

  test('newest first', async () => {
    const res = await request(app).get('/admin/logs?limit=200').set(bearer(token('super_owner', BRANCH_MINE)));
    const times = res.body.data.map(r => new Date(r.occurred_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test('the stack comes through, for the 500s that have one', async () => {
    const res = await request(app).get('/admin/logs?limit=200&status=5xx').set(bearer(token('super_owner', BRANCH_MINE)));
    const row = res.body.data.find(r => r.log_id === idServer);
    expect(row.stack).toMatch(/at x/);
  });
});

describe('GET /admin/logs — paging and filters', () => {
  test('limit, offset and a total to page by', async () => {
    const res = await request(app).get('/admin/logs?limit=2&offset=0').set(bearer(token('super_owner', BRANCH_MINE)));
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeGreaterThanOrEqual(5);

    const page2 = await request(app).get('/admin/logs?limit=2&offset=2').set(bearer(token('super_owner', BRANCH_MINE)));
    const first = res.body.data.map(r => r.log_id);
    expect(page2.body.data.some(r => first.includes(r.log_id))).toBe(false);
  });

  test('a limit past the cap is clamped, not honoured', async () => {
    const res = await request(app).get('/admin/logs?limit=5000').set(bearer(token('super_owner', BRANCH_MINE)));
    expect(res.body.limit).toBe(200);
  });

  test('status=4xx, status=5xx and an exact status', async () => {
    const t = bearer(token('super_owner', BRANCH_MINE));
    const c4 = await request(app).get('/admin/logs?limit=200&status=4xx').set(t);
    expect(mine(c4.body).every(r => r.status >= 400 && r.status < 500)).toBe(true);
    expect(mine(c4.body).map(r => r.log_id)).toContain(idNewest);

    const c5 = await request(app).get('/admin/logs?limit=200&status=5xx').set(t);
    expect(mine(c5.body).every(r => r.status >= 500)).toBe(true);
    expect(mine(c5.body).map(r => r.log_id)).not.toContain(idNewest);

    const exact = await request(app).get('/admin/logs?limit=200&status=404').set(t);
    expect(mine(exact.body).map(r => r.log_id)).toEqual([idOld]);
  });

  test('since cuts off older rows', async () => {
    const since = hoursAgo(24).toISOString();
    const res = await request(app).get(`/admin/logs?limit=200&since=${encodeURIComponent(since)}`)
      .set(bearer(token('super_owner', BRANCH_MINE)));
    const ids = mine(res.body).map(r => r.log_id);
    expect(ids).toContain(idNewest);
    expect(ids).not.toContain(idOld);      // 26 hours ago
    expect(ids).not.toContain(idServer);   // 50 hours ago
  });

  test('a since it cannot read is a 400, not silently ignored', async () => {
    const res = await request(app).get('/admin/logs?since=last-tuesday').set(bearer(token('owner', BRANCH_MINE)));
    expect(res.status).toBe(400);
  });

  test('a status it cannot read is a 400', async () => {
    const res = await request(app).get('/admin/logs?status=bananas').set(bearer(token('owner', BRANCH_MINE)));
    expect(res.status).toBe(400);
  });
});

describe('POST /client-errors — a crash in the browser is an error too', () => {
  test('any signed-in user may report one, and it lands as status 0', async () => {
    const res = await request(app).post('/client-errors')
      .set(bearer(token('staff', BRANCH_MINE)))
      .send({ message: 'TypeError: s.name is undefined', stack: 'at StudentsPage', path: '/students/41' });
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBeTruthy();
    written.push(res.body.log_id);

    const { rows: [row] } = await pool.query('SELECT * FROM error_log WHERE log_id = $1', [res.body.log_id]);
    expect(row.status).toBe(0);
    expect(row.method).toBe('CLIENT');
    expect(row.message).toMatch(/TypeError/);
    expect(row.stack).toMatch(/StudentsPage/);
    expect(row.role).toBe('staff');
    // The id in the reported path is replaced the same way a server route
    // pattern is, so the log never collects student ids.
    expect(row.path).toBe('/students/:id');
  });

  test('a report without a message is rejected', async () => {
    const res = await request(app).post('/client-errors')
      .set(bearer(token('staff', BRANCH_MINE))).send({ stack: 'at x' });
    expect(res.status).toBe(400);
  });

  test('an unauthenticated report is refused', async () => {
    const res = await request(app).post('/client-errors').send({ message: 'boom' });
    expect(res.status).toBe(401);
  });

  test('an oversized stack is cut down rather than refused', async () => {
    const res = await request(app).post('/client-errors')
      .set(bearer(token('owner', BRANCH_MINE)))
      .send({ message: 'm'.repeat(5000), stack: 's'.repeat(50000), path: '/students' });
    expect(res.status).toBe(201);
    written.push(res.body.log_id);
    const { rows: [row] } = await pool.query('SELECT * FROM error_log WHERE log_id = $1', [res.body.log_id]);
    expect(row.message.length).toBeLessThanOrEqual(2000);
    expect(row.stack.length).toBeLessThanOrEqual(10000);
  });
});
