const { Pool } = require('pg');

const cs = (process.env.DATABASE_URL || '').replace(/[?&]channel_binding=[^&]*/, '');
const pool = new Pool({
  connectionString: cs,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

(async () => {
  const r = await pool.query('SELECT current_database() AS db');
  console.log('CONNECT OK ->', r.rows[0].db);
  const t = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  console.log('existing tables:', t.rows.map((x) => x.tablename).join(', ') || '(none)');
  await pool.end();
})().catch((e) => {
  console.error('CONNECT ERR:', e.message);
  process.exit(1);
});
