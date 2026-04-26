const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
