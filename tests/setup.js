require('dotenv').config();

module.exports = async function globalSetup() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('SELECT 1');
    console.log('Test DB connection OK');
  } finally {
    await pool.end();
  }
};
