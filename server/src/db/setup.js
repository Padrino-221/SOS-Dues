const { Pool } = require('pg');
require('dotenv').config();

async function ensureDatabase() {
  // A hosted database (Neon/Vercel) is created and managed by the provider, so
  // there is nothing to create — just connect to DATABASE_URL.
  if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL is set — using the hosted database as-is.');
    return;
  }
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

// v2 schema — full rebuild. Drops every table first so the structure always
// matches this file exactly.
const schema = `
DROP TABLE IF EXISTS transaction_log, student_souvenirs, payments, receipts, fresher_applications, souvenirs, students, classes, users, departments, settings CASCADE;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT INTO settings (key, value)
VALUES ('active_academic_year', EXTRACT(YEAR FROM CURRENT_DATE)::int || '/' || (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  dues_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  pin TEXT,
  pin_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('school_admin', 'school_staff', 'dept_admin', 'dept_staff')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Classes belong to a department. A class can represent a whole level
-- (name = level, e.g. 'Level 200') or a group within a level
-- (e.g. level 'Level 200', name 'Level 200 A').
CREATE TABLE classes (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE TABLE souvenirs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'school' CHECK (category IN ('school', 'department')),
  -- Department souvenirs belong to one department (configured by its admin);
  -- school souvenirs are global and department_id is NULL.
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Freshers (yet to report) fill this public form while at home. On reporting
-- day the School Admin verifies the submission (assigns department + records
-- School dues/souvenirs), which creates the real student row and marks this
-- application as verified.
CREATE TABLE fresher_applications (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  programme TEXT,
  gender TEXT,
  hometown TEXT,
  admission_year TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- is_fresher: registered by School Admin (with department assigned).
-- admitted_at/admitted_by: set when the Dept Admin admits the fresher.
-- Continuing students are created by the Dept Admin (is_fresher = false).
-- Student numbers are university-issued and unique across the whole university
-- (format: UE + programme letter + department id + sequence + enrollment year,
-- e.g. UEB3227523). Enforced by a global unique index on UPPER(student_no).
-- receipt_seq is the per-student lifetime counter used to build receipt numbers.
-- LEVELS: the durable, mandatory progression axis a student moves along each
-- academic year (100 -> 200 -> 300 -> 400). Represented as numeric text so it
-- sorts and compares cleanly. class_id is optional finer grouping WITHIN a
-- level (some levels have classes, others don't) — used by reps for per-class
-- collection. is_graduated hides Level 400 alumni from active collection.
CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  student_no TEXT,
  is_fresher BOOLEAN NOT NULL DEFAULT false,
  level TEXT NOT NULL DEFAULT '100' CHECK (level IN ('100', '200', '300', '400')),
  is_graduated BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  admission_year TEXT,
  phone TEXT,
  email TEXT,
  programme TEXT,
  gender TEXT,
  hometown TEXT,
  admitted_at TIMESTAMPTZ,
  admitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receipt_seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One receipt per collection session. department_id/class_id record the
-- context in which the money was collected (null for school-admin registrations).
CREATE TABLE receipts (
  id SERIAL PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'momo')),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  academic_year TEXT,
  record_type TEXT NOT NULL DEFAULT 'admin' CHECK (record_type IN ('admin', 'rep')),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Itemized lines under a receipt. A combined continuing-student collection
-- has one school_dues line and one department_dues line sharing a receipt.
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('school_dues', 'department_dues')),
  amount NUMERIC(12,2) NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE student_souvenirs (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  souvenir_id INTEGER NOT NULL REFERENCES souvenirs(id) ON DELETE CASCADE,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('school', 'department')),
  given_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A souvenir is handed to a student once in their lifetime (at the fresher stage).
  UNIQUE (student_id, souvenir_id)
);

CREATE TABLE transaction_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_role TEXT NOT NULL DEFAULT 'SYSTEM',
  transaction_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep existing installations compatible with the academic-year report filter.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS pin_version INTEGER NOT NULL DEFAULT 0;
UPDATE receipts
SET academic_year = CASE
  WHEN EXTRACT(MONTH FROM paid_at) >= 9
    THEN EXTRACT(YEAR FROM paid_at)::int || '/' || (EXTRACT(YEAR FROM paid_at)::int + 1)
  ELSE (EXTRACT(YEAR FROM paid_at)::int - 1) || '/' || EXTRACT(YEAR FROM paid_at)::int
END
WHERE academic_year IS NULL;

CREATE INDEX idx_transaction_log_admin ON transaction_log(admin_id);
CREATE INDEX idx_transaction_log_type ON transaction_log(transaction_type);
CREATE INDEX idx_transaction_log_created ON transaction_log(created_at);
CREATE INDEX idx_fresher_apps_status ON fresher_applications(status);
CREATE INDEX idx_fresher_apps_created ON fresher_applications(created_at);
-- Prevent two OPEN (pending) applications for the same student number, while
-- allowing re-application once an earlier application is verified/cancelled.
-- Department scoping is not possible at apply time (the School assigns the
-- department on reporting day), so openness is the meaningful uniqueness axis.
CREATE UNIQUE INDEX idx_fresher_apps_open_no ON fresher_applications(student_no) WHERE status = 'pending';
CREATE INDEX idx_students_dept ON students(department_id);
CREATE INDEX idx_students_class ON students(class_id);
CREATE INDEX idx_students_level ON students(level);
CREATE UNIQUE INDEX idx_students_unique_no ON students (UPPER(student_no)) WHERE student_no IS NOT NULL;
CREATE INDEX idx_students_graduated ON students(is_graduated) WHERE is_graduated = true;
CREATE INDEX idx_students_archived ON students(is_archived) WHERE is_archived = true;
CREATE INDEX idx_students_no ON students(student_no);
CREATE INDEX idx_payments_receipt ON payments(receipt_id);
CREATE INDEX idx_payments_type ON payments(type);
CREATE INDEX idx_payments_voided ON payments(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX idx_receipts_number ON receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_receipts_academic_year ON receipts(academic_year);
CREATE INDEX idx_receipts_voided ON receipts(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX idx_student_souvenirs_receipt ON student_souvenirs(receipt_id);
`;

async function runSchema() {
  await ensureDatabase();
  // Reuse the shared pool so the schema runs against DATABASE_URL (hosted) or
  // the local PG* connection, whichever is configured.
  const pool = require('./pool');
  await pool.query(schema);
  console.log('v2 schema applied successfully');
  await pool.end();
}

if (require.main === module) {
  runSchema().catch((err) => {
    console.error('Schema setup failed:', err);
    process.exit(1);
  });
}

module.exports = { runSchema, ensureDatabase };
