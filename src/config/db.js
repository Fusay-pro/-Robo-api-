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
    await client.query(`SET LOCAL app.role = '${role}'`);
    await client.query(`SET LOCAL app.branch_id = '${branchId ?? 0}'`);
    await client.query(`SET LOCAL app.user_id = '${userId ?? 0}'`);
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withRLS };
