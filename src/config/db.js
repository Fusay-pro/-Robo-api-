const { Pool } = require('pg');

// Enable SSL for any non-localhost Postgres (Supabase, Railway, Neon, RDS, etc.).
// Managed providers serve certs that aren't in Node's default trust store,
// so we disable strict cert verification (still encrypted in transit).
const url = process.env.DATABASE_URL || '';
const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withRLS({ role, branchId, userId }, fn) {
  const client = await pool.connect();
  try {
    // SET LOCAL only takes effect inside a transaction, and set_config()
    // parameterizes the values (no string interpolation into SQL).
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.role', $1, true),
              set_config('app.branch_id', $2, true),
              set_config('app.user_id', $3, true)`,
      [String(role), String(branchId ?? 0), String(userId ?? 0)]
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withRLS };
