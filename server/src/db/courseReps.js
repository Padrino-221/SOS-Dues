const pool = require('./pool');

const schema = `CREATE TABLE IF NOT EXISTS course_reps (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  disabled_at TIMESTAMPTZ
)`;

module.exports = async () => {
  await pool.query(schema);
  await pool.query(`ALTER TABLE course_reps
    ADD COLUMN IF NOT EXISTS invite_hash TEXT,
    ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ`);
};
