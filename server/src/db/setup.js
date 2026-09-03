const { Pool } = require('pg');
require('dotenv').config();

async function ensureDatabase() {
  const config = {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: 'postgres',
  };
  const adminPool = new Pool(config);

  const dbName = process.env.PGDATABASE || 'dues_management';
  const res = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (res.rowCount === 0) {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database "${dbName}"`);
  } else {
    console.log(`Database "${dbName}" already exists`);
  }
  await adminPool.end();
}

const SCHEMA_VERSION = 2;

const schema = `
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  dues_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('school_admin', 'dept_admin')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  student_no TEXT UNIQUE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  is_fresher BOOLEAN NOT NULL DEFAULT false,
  admission_year TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS souvenirs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'school',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('school_dues', 'department_dues')),
  amount NUMERIC(12,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'momo', 'bank')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL DEFAULT 'admin' CHECK (record_type IN ('admin', 'rep')),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_role TEXT NOT NULL DEFAULT 'SCHOOL_ADMIN',
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_souvenirs (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  souvenir_id INTEGER NOT NULL REFERENCES souvenirs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('school', 'department')),
  given_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  given_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_role TEXT NOT NULL DEFAULT 'SYSTEM',
  transaction_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_log_admin ON transaction_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_transaction_log_type ON transaction_log(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transaction_log_created ON transaction_log(created_at);
`;

async function runSchema() {
  await ensureDatabase();
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'dues_management',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });
  await pool.query(schema);
  console.log('Schema applied successfully');
  await pool.end();
}

if (require.main === module) {
  runSchema().catch((err) => {
    console.error('Schema setup failed:', err);
    process.exit(1);
  });
}

module.exports = { runSchema, ensureDatabase };
