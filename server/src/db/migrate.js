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

  // ├── Free-flow payments: a receipt no longer needs a student row. Class-rep
  // │   and Collect-page payments snapshot the payer's name, index number and
  // │   level directly on the receipt (student_id stays NULL).
  await pool.query('ALTER TABLE receipts ALTER COLUMN student_id DROP NOT NULL');
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS student_name TEXT');
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS student_no TEXT');
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payer_email TEXT');
  await pool.query(
    `ALTER TABLE receipts ADD COLUMN IF NOT EXISTS level TEXT
     CHECK (level IN ('100', '200', '300', '400'))`
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_receipts_student_no ON receipts(UPPER(student_no)) WHERE student_no IS NOT NULL'
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_receipts_student_id ON receipts(student_id)');

  // Backfill the payer snapshot on receipts issued before free-flow existed,
  // so every receipt carries the name/index/level it was issued under.
  await pool.query(
    `UPDATE receipts r
     SET student_name = s.name, student_no = s.student_no, level = s.level
     FROM students s
     WHERE r.student_id = s.id AND r.student_no IS NULL`
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

  // ├── The continuing-student roster is gone (free-flow payments only) —
  // │   drop the columns that only served it, if a legacy DB still has them.
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS receipt_seq');
  await pool.query('DROP INDEX IF EXISTS idx_students_graduated');
  await pool.query('DROP INDEX IF EXISTS idx_students_archived');
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS is_graduated');
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS is_archived');

  // ├── Levels: mandatory, durable progression axis (100/200/300/400).
  // │   Backfill existing students' level from their class's level where
  // │   possible (class "Level 200 A" -> '200'). Fresh rows default to '100'.
  // │
  // │   This backfill reads the classes table / students.class_id, which the
  // │   Phase C drop (at the very end of this file) removes. So it only runs
  // │   while those still exist — once the drop has executed, this is a no-op
  // │   instead of an error on every subsequent migrate run.
  await pool.query(
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT '100'
     CHECK (level IN ('100', '200', '300', '400'))`
  );
  const classesIntact = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'classes') AS has_classes,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'students' AND column_name = 'class_id') AS has_class_id`
  );
  if (classesIntact.rows[0].has_classes && classesIntact.rows[0].has_class_id) {
    await pool.query(
      `UPDATE students s
       SET level = SUBSTRING(c.level FROM '[0-9]+')
       FROM classes c
       WHERE c.id = s.class_id
         AND SUBSTRING(c.level FROM '[0-9]+') IN ('100', '200', '300', '400')`
    );
  }
  await pool.query('CREATE INDEX IF NOT EXISTS idx_students_level ON students(level)');

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
  // │   The super admin inherits every school-admin power plus the five
  // │   privileged actions. Existing installs get the constraint widened above
  // │   and a bootstrap super-admin account below, so the role is usable
  // │   immediately after migrating.
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('school_admin','school_staff','dept_admin','dept_staff','super_admin'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  // Bootstrap a super admin on installs that predate the role.
  //
  // SECURITY: the password must come from SUPER_ADMIN_PASSWORD. A hardcoded
  // default is never acceptable here, because db:migrate runs automatically on
  // every production deploy (deployment/vultr/deploy.sh) — a built-in default
  // would silently publish a known-password super admin on the live site,
  // with force-delete and account-management powers.
  //
  // The password is generated randomly when not supplied, and only ever
  // printed once, to the deploy log, at bootstrap time.
  {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin'"
    );
    if (rows[0].n === 0) {
      const bcrypt = require('bcryptjs');
      const crypto = require('crypto');

      const supplied = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
      const generated = !supplied;
      const password = supplied || crypto.randomBytes(12).toString('base64url');

      const hash = await bcrypt.hash(password, 10);
      const email = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@sosuenr.com').trim();
      const name = (process.env.SUPER_ADMIN_NAME || 'Super Admin').trim();

      await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1,$2,$3,'super_admin')
         ON CONFLICT (email) DO NOTHING`,
        [name, email, hash]
      );
      console.log('-'.repeat(64));
      console.log('Bootstrapped super admin account');
      console.log(`  email    : ${email}`);
      if (generated) {
        console.log(`  password : ${password}`);
        console.log('  ^ generated randomly and shown ONCE. Store it in a password');
        console.log('    manager now — it is not recoverable from the database.');
      } else {
        console.log('  password : (from SUPER_ADMIN_PASSWORD)');
        console.log('  ^ change it after the first sign-in.');
      }
      console.log('-'.repeat(64));
    }
  }

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
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ');
  await pool.query(
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_payments_voided ON payments(voided_at) WHERE voided_at IS NOT NULL'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // MONEY SAFETY: client-generated idempotency keys. A retried collection
  // (flaky network double-tap) must return the existing receipt instead of
  // charging the student twice.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_idempotency_key ON receipts(idempotency_key) WHERE idempotency_key IS NOT NULL'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FRESHER WORKFLOW: rejection with a reason (previously deletion was the
  // only exit and the fresher was never told anything).
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(
    'ALTER TABLE fresher_applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT'
  );
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE fresher_applications DROP CONSTRAINT IF EXISTS fresher_applications_status_check;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE fresher_applications ADD CONSTRAINT fresher_applications_status_check CHECK (status IN ('pending', 'verified', 'cancelled', 'rejected'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT LEVEL: which academic level the payment is FOR. A Level 400
  // student may clear Level 100 arrears, so this is recorded independently
  // of the payer's own level. Backfilled from the payer level snapshot.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(
    `ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_level TEXT
     CHECK (payment_level IN ('100', '200', '300', '400'))`
  );
  await pool.query(
    `UPDATE receipts SET payment_level = level
     WHERE payment_level IS NULL AND level IN ('100', '200', '300', '400')`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // STUDENT VERIFICATION: manually entered student records (rep collection
  // for numbers with no match) start as 'pending' and only join the student
  // list once a school admin verifies them. Everything already in the table
  // is admin-registered, so it defaults to verified.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS verification_status TEXT
     NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('verified', 'pending'))`
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_students_verification ON students(verification_status) WHERE verification_status = 'pending'"
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE C — DESTRUCTIVE: classes are gone, levels are the only axis.
  //
  // Everything above already writes class_id = NULL and reads level only, so
  // these columns/table are dead weight. This runs LAST so the level backfill
  // (which reads classes) still executes on legacy data before the drop; on
  // re-runs the guard above turns that backfill into a no-op.
  //
  // Historical receipts keep their department + level — only the class-stream
  // label ("Level 100 A") is retired, and only rows that predate this change
  // ever carried one.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS class_id');
  await pool.query('ALTER TABLE receipts DROP COLUMN IF EXISTS class_id');
  await pool.query('ALTER TABLE payments DROP COLUMN IF EXISTS class_id');
  await pool.query('DROP INDEX IF EXISTS idx_students_class');
  await pool.query('DROP TABLE IF EXISTS classes');

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL DUES (freshers only): departments and the school can define
  // named extra dues items (levies/fees) that freshers pay alongside School
  // dues at verification/registration. department_id NULL = school-wide item
  // (charged to every fresher). Payment lines snapshot the item name in
  // payments.label so a later rename never rewrites historical receipts.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dues_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS label TEXT');
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE payments ADD CONSTRAINT payments_type_check
          CHECK (type IN ('school_dues','department_dues','extra_dues'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // SOUVENIRS have no cost — they are handed out, never sold. Routes, seed and
  // the Settings UI no longer reference the column; drop it from existing
  // installs (fresh setups never create it).
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query('ALTER TABLE souvenirs DROP COLUMN IF EXISTS cost');

  // ═══════════════════════════════════════════════════════════════════════════
  // Gender-scoped "Other Dues" items. 'any' (default) charges everyone;
  // 'male'/'female' items are greyed out of the opposite gender's
  // verification/registration pickers and refused server-side at charge and
  // edit time — the female-cloth-on-male-students incident class. Already
  // charged lines stay manageable (visible, uncheckable) so a wrong charge
  // can always be corrected.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.query(
    `ALTER TABLE dues_items ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'any'`
  );

  // Free-text class/stream for continuing students, snapshotted on receipts.
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS class_name TEXT');
  await pool.query('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS class_name TEXT');

  await require('./courseReps')();
  console.log('Migration applied successfully.');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
