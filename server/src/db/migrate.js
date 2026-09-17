const pool = require('./pool');
const { resolveAcademicYear } = require('../utils/academicYear');

async function migrate() {
  await pool.query(
    'ALTER TABLE departments ADD COLUMN IF NOT EXISTS pin_version INTEGER NOT NULL DEFAULT 0'
  );
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS academic_year TEXT');
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ');
  await pool.query(
    'ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS void_reason TEXT');
  await pool.query(
    'ALTER TABLE student_souvenirs ADD COLUMN IF NOT EXISTS receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE'
  );
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('active_academic_year', $1)
     ON CONFLICT (key) DO NOTHING`,
    [resolveAcademicYear()]
  );
  await pool.query(
    `UPDATE receipts
     SET academic_year = CASE
       WHEN EXTRACT(MONTH FROM paid_at) >= 9
         THEN EXTRACT(YEAR FROM paid_at)::int || '/' || (EXTRACT(YEAR FROM paid_at)::int + 1)
       ELSE (EXTRACT(YEAR FROM paid_at)::int - 1) || '/' || EXTRACT(YEAR FROM paid_at)::int
     END
     WHERE academic_year IS NULL`
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_receipts_academic_year ON receipts(academic_year)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_receipts_voided ON receipts(voided_at) WHERE voided_at IS NOT NULL'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_student_souvenirs_receipt ON student_souvenirs(receipt_id)'
  );

  // ├── Student numbers are university-issued and unique across the whole
  // │   university (format: UE + programme letter + department id + sequence
  // │   + enrollment year). Drop the legacy per-department index and enforce a
  // │   single global partial unique index. Multiple NULL numbers stay allowed.
  await pool.query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_student_no_key');
  await pool.query('DROP INDEX IF EXISTS students_student_no_key');
  await pool.query('DROP INDEX IF EXISTS idx_students_unique_dept_no');
  const dupStudentNos = await pool.query(
    `SELECT UPPER(student_no) AS no, COUNT(*) AS n
     FROM students
     WHERE student_no IS NOT NULL
     GROUP BY UPPER(student_no)
     HAVING COUNT(*) > 1`
  );
  if (dupStudentNos.rowCount > 0) {
    const list = dupStudentNos.rows.map((r) => r.no).join(', ');
    throw new Error(
      `Cannot enforce global student-number uniqueness — duplicate number(s) found: ${list}`
    );
  }
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_no
    ON students (UPPER(student_no))
    WHERE student_no IS NOT NULL
  `);

  // ├── Per-student lifetime receipt counter (SOS-DUES-<TAG>-<studentNo>-<n>).
  await pool.query(
    'ALTER TABLE students ADD COLUMN IF NOT EXISTS receipt_seq INTEGER NOT NULL DEFAULT 0'
  );

  // ├── Levels: mandatory, durable progression axis (100/200/300/400).
  // │   Backfill existing students' level from their class's level where
  // │   possible (class "Level 200 A" -> '200'). Fresh rows default to '100'.
  await pool.query(
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT '100'
     CHECK (level IN ('100', '200', '300', '400'))`
  );
  await pool.query(
    'ALTER TABLE students ADD COLUMN IF NOT EXISTS is_graduated BOOLEAN NOT NULL DEFAULT false'
  );
  await pool.query(
    'ALTER TABLE students ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false'
  );
  await pool.query(
    `UPDATE students s
     SET level = SUBSTRING(c.level FROM '[0-9]+')
     FROM classes c
     WHERE c.id = s.class_id
       AND SUBSTRING(c.level FROM '[0-9]+') IN ('100', '200', '300', '400')`
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_students_level ON students(level)');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_students_graduated ON students(is_graduated) WHERE is_graduated = true'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_students_archived ON students(is_archived) WHERE is_archived = true'
  );

  // ├── Fresher applications: scope the student_no uniqueness to OPEN (pending)
  // │   applications only. This lets a student re-apply once an earlier
  // │   application is verified/cancelled, while still blocking duplicate
  // │   simultaneous submissions. (Department scoping is impossible at apply
  // │   time — the school assigns the department on reporting day.)
  await pool.query(
    'ALTER TABLE fresher_applications DROP CONSTRAINT IF EXISTS fresher_applications_student_no_key'
  );
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fresher_apps_open_no
    ON fresher_applications(student_no)
    WHERE status = 'pending'
  `);

  // ├── Roles: allow secondary staff alongside main admins (both school and dept).
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('school_admin','school_staff','dept_admin','dept_staff'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // ISSUE 2 FIX: Make student_souvenirs.receipt_id NOT NULL
  // ═══════════════════════════════════════════════════════════════════════════
  // First, handle any existing souvenirs with NULL receipt_id by creating
  // a $0 "souvenir-only" receipt for them.
  await pool.query(`
    INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, total_amount, voided_at)
    SELECT
      'SOS-UENR-SOUV-' || ss.id::text || '-' || EXTRACT(EPOCH FROM NOW())::int::text,
      ss.student_id,
      'cash',
      NOW(),
      (SELECT value FROM settings WHERE key = 'active_academic_year'),
      'admin',
      NULL,
      0,
      NOW()
    FROM student_souvenirs ss
    WHERE ss.receipt_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM receipts r WHERE r.id = ss.receipt_id
      )
  `);

  // Now update the NULL receipt_ids to point to the newly created receipts
  await pool.query(`
    UPDATE student_souvenirs ss
    SET receipt_id = sub.receipt_id
    FROM (
      SELECT ss2.id AS ss_id, r.id AS receipt_id
      FROM student_souvenirs ss2
      JOIN receipts r ON r.student_id = ss2.student_id
      WHERE ss2.receipt_id IS NULL
        AND r.total_amount = 0
        AND r.voided_at IS NOT NULL
      ORDER BY r.id
    ) sub
    WHERE ss.id = sub.ss_id
  `);

  // Now make receipt_id NOT NULL
  await pool.query(`
    ALTER TABLE student_souvenirs
    ALTER COLUMN receipt_id SET NOT NULL
  `);

  // Align the FK with NOT NULL: a deleted receipt must cascade (never try to
  // SET NULL, which would violate the NOT NULL constraint).
  await pool.query(
    'ALTER TABLE student_souvenirs DROP CONSTRAINT IF EXISTS student_souvenirs_receipt_id_fkey'
  );
  await pool.query(
    'ALTER TABLE student_souvenirs ADD CONSTRAINT student_souvenirs_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE'
  );

  // A souvenir is handed to a student once in their lifetime (at the fresher
  // stage). Enforce it with a unique index, after reporting any duplicates.
  const dupSouvenirs = await pool.query(
    `SELECT student_id, souvenir_id, COUNT(*) AS n
     FROM student_souvenirs
     GROUP BY student_id, souvenir_id
     HAVING COUNT(*) > 1`
  );
  if (dupSouvenirs.rowCount > 0) {
    const list = dupSouvenirs.rows
      .map((r) => `student ${r.student_id}/souvenir ${r.souvenir_id}`)
      .join(', ');
    throw new Error(`Cannot enforce one-souvenir-per-student — duplicate rows found: ${list}`);
  }
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_student_souvenirs_once ON student_souvenirs(student_id, souvenir_id)'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ISSUE 6 FIX: Add voided_at to payments table for individual payment voiding
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ'
  );
  await pool.query(
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );
  await pool.query(
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_payments_voided ON payments(voided_at) WHERE voided_at IS NOT NULL'
  );

  console.log('Non-destructive migration applied successfully.');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
