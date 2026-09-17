const { Pool } = require('pg');
require('dotenv').config();

// Prefer a single connection string (Neon/Vercel) when provided, otherwise fall
// back to the discrete PG* variables used for local development.
const connectionString = process.env.DATABASE_URL;
const isLocalConnection = connectionString && /localhost|127\.0\.0\.1/.test(connectionString);

// Serverless deployments should keep the pool small (Neon's pooled endpoint
// multiplexes connections); a long-running local server can afford more.
const max = Number(process.env.PGPOOL_MAX) || (connectionString ? 5 : 10);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: isLocalConnection ? false : { rejectUnauthorized: false },
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'dues_management',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

module.exports = pool;
