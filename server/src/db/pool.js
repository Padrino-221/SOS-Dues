const { Pool } = require('pg');
require('dotenv').config();

// Neon appends `channel_binding=require`, which node-postgres (libpq is not
// used) does not understand. Drop it so the connection string parses cleanly.
function normalizeConnectionString(value) {
  if (!value) return value;
  const [base, query] = value.split('?');
  if (!query) return value;
  const params = query.split('&').filter((p) => p && !p.startsWith('channel_binding='));
  return params.length ? `${base}?${params.join('&')}` : base;
}

// Prefer a single connection string (Neon/Vercel) when provided, otherwise fall
// back to the discrete PG* variables used for local development.
const connectionString = normalizeConnectionString(process.env.DATABASE_URL);
const isLocalConnection = connectionString && /localhost|127\.0\.0\.1/.test(connectionString);

// Every receipt transaction holds a connection for its whole duration, so a
// pool of 5–10 serialises the cashiers quickly. Default to 20; deployments
// short on file descriptors (or serverless) can pull it back with PGPOOL_MAX.
const max = Number(process.env.PGPOOL_MAX) || 20;

// Pin every pooled connection to the institution's zone (Ghana, GMT+0, no DST)
// so NOW(), DATE_TRUNC and date arithmetic in reports/receipts match what the
// UI shows, no matter what TZ the process was started with. This is passed as
// a libpq startup parameter (`options`) so PostgreSQL applies it before the
// connection is handed out — no extra query, no race with the pool's own use
// of the client (an earlier pool.on('connect') query raced and warned).
const TZ_OPTION = '-c timezone=Africa/Accra';
const tzConnectionString = connectionString
  ? `${connectionString}${connectionString.includes('?') ? '&' : '?'}options=${encodeURIComponent(
      TZ_OPTION
    )}`
  : null;

const pool = tzConnectionString
  ? new Pool({
      connectionString: tzConnectionString,
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
      options: TZ_OPTION,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

module.exports = pool;
