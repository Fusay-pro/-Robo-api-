require('dotenv').config();
const { Pool } = require('pg');
const {
  shouldRecord,
  routePattern,
  recordError,
  AUTH_FAILURE,
} = require('../src/middleware/errorLog');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// `shouldRecord` is the whole skip policy from the design, in one place:
// anything 400+ is kept, except token-expiry 401s (routine churn), 429s from
// the rate limiter (already visible as a pattern), and 404s where no route
// matched (static files, scanners).
describe('what gets recorded', () => {
  test('a successful response is not an error', () => {
    expect(shouldRecord({ status: 200, routed: true })).toBe(false);
    expect(shouldRecord({ status: 201, routed: true })).toBe(false);
    expect(shouldRecord({ status: 304, routed: true })).toBe(false);
  });

  test('4xx and 5xx from a real route are recorded', () => {
    expect(shouldRecord({ status: 400, routed: true })).toBe(true);
    expect(shouldRecord({ status: 403, routed: true })).toBe(true);
    expect(shouldRecord({ status: 404, routed: true })).toBe(true);
    expect(shouldRecord({ status: 409, routed: true })).toBe(true);
    expect(shouldRecord({ status: 500, routed: true })).toBe(true);
  });

  test('a token-expiry 401 is skipped, a 401 a route raised is kept', () => {
    // Access tokens last 15 minutes and every client discovers expiry by
    // getting a 401 on an ordinary route. Recording those would make
    // "Invalid or expired token" the biggest thing in the table.
    expect(shouldRecord({ status: 401, routed: true, reason: AUTH_FAILURE })).toBe(false);
    expect(shouldRecord({ status: 401, routed: true })).toBe(true);
  });

  test('rate-limit 429s are skipped', () => {
    expect(shouldRecord({ status: 429, routed: true })).toBe(false);
  });

  test('a 404 for a path with no route behind it is skipped', () => {
    expect(shouldRecord({ status: 404, routed: false })).toBe(false);
    // A 5xx still matters even when no route matched — that is a real failure.
    expect(shouldRecord({ status: 500, routed: false })).toBe(true);
  });
});

// The log stores the route pattern, never the URL as called, so student and
// user ids never land in it.
describe('the path that gets stored', () => {
  const req = (baseUrl, routePath, path) => ({
    baseUrl,
    route: routePath === null ? undefined : { path: routePath },
    path,
  });

  test('mounted router plus route pattern, with ids left out', () => {
    expect(routePattern(req('/students', '/:id', '/41'))).toBe('/students/:id');
    expect(routePattern(req('/students', '/bulk-delete', '/bulk-delete'))).toBe('/students/bulk-delete');
    expect(routePattern(req('/students', '/:id/notes', '/41/notes'))).toBe('/students/:id/notes');
  });

  test("a router's own root does not end in a stray slash", () => {
    expect(routePattern(req('/students', '/', '/'))).toBe('/students');
    expect(routePattern(req('', '/', '/'))).toBe('/');
  });

  test('an unmatched path is stored as called, since there is no pattern', () => {
    expect(routePattern(req('', null, '/favicon.ico'))).toBe('/favicon.ico');
  });

  test('a numeric id is never left in a stored pattern', () => {
    expect(routePattern(req('/students', '/:id', '/41'))).not.toMatch(/\d/);
  });
});

// The write path. Logging is off under NODE_ENV=test so a test run cannot
// litter the log the owner reads, which is exactly why this calls the
// recorder directly instead of going through supertest.
describe('recording a row', () => {
  const written = [];

  afterAll(async () => {
    if (written.length) {
      await pool.query('DELETE FROM error_log WHERE log_id = ANY($1::int[])', [written]);
    }
    await pool.end();
  });

  test('stores the context needed to explain the failure later', async () => {
    const requestId = `test-${Date.now()}`;
    const row = await recordError({
      status: 400,
      method: 'POST',
      path: '/students/bulk-delete',
      message: 'Too big: expected array to have <=50 items',
      stack: null,
      user: { user_id: 1, role: 'owner', branch_id: 1 },
      requestId,
    });
    expect(row).toBeTruthy();
    written.push(row.log_id);

    const { rows: [stored] } = await pool.query('SELECT * FROM error_log WHERE log_id = $1', [row.log_id]);
    expect(stored.status).toBe(400);
    expect(stored.method).toBe('POST');
    expect(stored.path).toBe('/students/bulk-delete');
    expect(stored.message).toMatch(/Too big/);
    expect(stored.request_id).toBe(requestId);
    expect(stored.role).toBe('owner');
    expect(stored.occurred_at).toBeInstanceOf(Date);
    expect(stored.stack).toBeNull();
  });

  test('a stack is kept for a 500 and the message is not the internal one', async () => {
    const row = await recordError({
      status: 500,
      method: 'GET',
      path: '/students',
      message: 'Internal server error',
      stack: 'Error: relation "studnets" does not exist\n    at Query.handleError',
      user: null,
      requestId: `test-${Date.now()}-2`,
    });
    written.push(row.log_id);
    const { rows: [stored] } = await pool.query('SELECT * FROM error_log WHERE log_id = $1', [row.log_id]);
    expect(stored.stack).toMatch(/studnets/);
    expect(stored.user_id).toBeNull();
    expect(stored.role).toBeNull();
    expect(stored.branch_id).toBeNull();
  });

  test('a failure to write the log never throws at the caller', async () => {
    // A broken log must not break a working request: the recorder swallows
    // its own failure and answers null. 999 is not a status the column takes
    // -- any write error has to come back as null, not as an exception.
    const row = await recordError({
      status: 400,
      method: 'GET',
      path: '/students',
      message: 'x'.repeat(200),
      user: { user_id: 'not-an-int', role: 'owner', branch_id: 1 },
      requestId: 'test-bad-row',
    });
    expect(row).toBeNull();
  });
});
