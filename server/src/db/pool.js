const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'dues_management',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
});

module.exports = pool;
