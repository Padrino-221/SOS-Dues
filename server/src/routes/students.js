const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const {
  requireAuth,
  requireSchoolAdmin,
  requireAnySchool,
  requireAnyAdmin,
  isAnySchool,
  isAnyDept,
} = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { emitEvent } = require('../utils/realtime');
const { cleanText } = require('../utils/clean');
const { getActiveAcademicYear, normalizeAcademicYear } = require('../utils/academicYear');
const { nextReceiptNumber } = require('../utils/receipt');
const { getSouvenirNames } = require('../utils/souvenirs');
const { sendReceiptEmail } = require('../utils/email');
const { normalizeLevel, nextLevel } = require('../utils/levels');

// Audit label for the acting admin.
const actorRole = (user) =>
  user.role === 'school_admin'
    ? 'SCHOOL_ADMIN'
    : user.role === 'school_staff'
      ? 'SCHOOL_STAFF'
      : 'DEPT_ADMIN';
const schoolActorRole = (user) => (user.role === 'school_staff' ? 'SCHOOL_STAFF' : 'SCHOOL_ADMIN');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

const STUDENT_SELECT = `
  SELECT s.*, d.name AS department_name, c.name AS class_name, c.level AS class_level,
    COALESCE(
      CASE s.level
        WHEN '100' THEN 'Level 100'
        WHEN '200' THEN 'Level 200'
        WHEN '300' THEN 'Level 300'
        WHEN '400' THEN 'Level 400'
        ELSE NULL
      END, c.level
    ) AS level_label,
    COALESCE((SELECT r.academic_year FROM receipts r WHERE r.student_id = s.id ORDER BY r.paid_at DESC LIMIT 1), NULL) AS last_paid_academic_year,
    (s.admitted_at IS NOT NULL) AS is_admitted,
    (SELECT value FROM settings WHERE key = 'active_academic_year') AS active_academic_year,
    COALESCE((
      SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
      WHERE r.student_id = s.id AND r.academic_year = (SELECT value FROM settings WHERE key = 'active_academic_year')
        AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'school_dues'
    ), 0) AS school_dues_paid_amount,
    COALESCE((
      SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
      WHERE r.student_id = s.id AND r.academic_year = (SELECT value FROM settings WHERE key = 'active_academic_year')
        AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'department_dues'
    ), 0) AS dept_dues_paid_amount,
    (SELECT COALESCE(value, '0')::numeric FROM settings WHERE key = 'school_dues_amount') AS school_dues_required,
    COALESCE(d.dues_amount, 0) AS dept_dues_required,
    (
      COALESCE((
        SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
        WHERE r.student_id = s.id AND r.academic_year = (SELECT value FROM settings WHERE key = 'active_academic_year')
          AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'school_dues'
      ), 0) >= (SELECT COALESCE(value, '0')::numeric FROM settings WHERE key = 'school_dues_amount')
    ) AS school_dues_paid,
    (
      COALESCE((
        SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
        WHERE r.student_id = s.id AND r.academic_year = (SELECT value FROM settings WHERE key = 'active_academic_year')
          AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'department_dues'
      ), 0) >= COALESCE(d.dues_amount, 0)
    ) AS dept_dues_paid
  FROM students s
  LEFT JOIN departments d ON d.id = s.department_id
  LEFT JOIN classes c ON c.id = s.class_id
`;

function deptScope(req, params) {
  // Dept admins only ever see their own department's students
  let where = '';
  if (isAnyDept(req.user)) {
    params.push(req.user.department_id);
    where += `s.department_id = $${params.length}`;
  }
  return where;
}

// Fetch a class's numeric level ("Level 200 A" -> '200'), or null if not found.
async function classLevel(db, classId, deptId) {
  const { rows } = await db.query(
    `SELECT SUBSTRING(level FROM '[0-9]+') AS lvl
       FROM classes WHERE id = $1 AND department_id = $2`,
    [classId, deptId]
  );
  return rows[0]?.lvl || null;
}

// Ensure a class (if given) belongs to the department AND matches the student's
// level. Returns the class id on success, throws on mismatch.
async function ensureClassLevelMatches(db, classId, deptId, level) {
  if (!classId) return null;
  const lvl = await classLevel(db, classId, deptId);
  if (!lvl) throw new AppError('Class does not belong to the selected department', 400);
  if (lvl !== level) {
    throw new AppError(
      `Class must be for the student's level. Select a level ${level} class.`,
      400
    );
  }
  return Number(classId);
}

// If a department has exactly one class at the given level, return its id;
// otherwise return null (ambiguous or absent — leave it to the dept admin).
async function singleClassForLevel(db, deptId, level) {
  const { rows } = await db.query(
    `SELECT id FROM classes
     WHERE department_id = $1 AND SUBSTRING(level FROM '[0-9]+') = $2`,
    [deptId, level]
  );
  return rows.length === 1 ? rows[0].id : null;
}

// ─── List students ───
// School Admin: all; Dept Admin: own department.
// ?search=, ?is_fresher=true|false, ?status=pending|admitted, ?class_id=
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const conds = [];
    const scope = deptScope(req, params);
    if (scope) conds.push(scope);

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(
        `(s.name ILIKE $${params.length} OR COALESCE(s.student_no,'') ILIKE $${params.length})`
      );
    }
    if (req.query.is_fresher !== undefined) {
      params.push(req.query.is_fresher === 'true');
      conds.push(`s.is_fresher = $${params.length}`);
    }
    if (req.query.status === 'pending') conds.push(`s.is_fresher = true AND s.admitted_at IS NULL`);
    if (req.query.status === 'admitted') conds.push(`s.admitted_at IS NOT NULL`);
    if (req.query.class_id) {
      params.push(req.query.class_id);
      conds.push(`s.class_id = $${params.length}`);
    }
    if (req.query.level) {
      params.push(normalizeLevel(req.query.level));
      conds.push(`s.level = $${params.length}`);
    }
    if (req.query.graduated !== undefined) {
      params.push(req.query.graduated === 'true');
      conds.push(`s.is_graduated = $${params.length}`);
    }
    if (req.query.archived === 'true') {
      conds.push(`s.is_archived = true`);
    } else if (req.query.archived === 'false') {
      conds.push(`s.is_archived = false`);
    } else {
      conds.push(`s.is_archived = false`); // hide archived by default
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    // Cap results high enough that large departments are not silently truncated;
    // an explicit ?limit= is honoured up to the same ceiling.
    const limit = Math.min(Math.max(Number(req.query.limit) || 10000, 1), 10000);
    const { rows } = await pool.query(
      `${STUDENT_SELECT} ${where} ORDER BY s.created_at DESC LIMIT ${limit}`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Get single student ───
router.get('/:id', async (req, res, next) => {
  try {
    const params = [req.params.id];
    let where = `s.id = $1`;
    if (isAnyDept(req.user)) {
      params.push(req.user.department_id);
      where += ` AND s.department_id = $${params.length}`;
    }
    const { rows } = await pool.query(`${STUDENT_SELECT} WHERE ${where}`, params);
    if (rows.length === 0) throw new AppError('Student not found', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── School: register a fresher and assign them to a department ───
// Main and secondary school accounts can register; Dept Admins cannot.
// Body: { name, student_no?, phone?, email?, programme?, gender?, hometown?,
//         department_id, admission_year?, level? }
router.post('/freshers', requireAnySchool, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      name,
      student_no,
      phone,
      email,
      programme,
      gender,
      hometown,
      department_id,
      admission_year,
      payment,
      souvenir_ids,
      level,
    } = req.body;
    if (!name) throw new AppError('Student name is required', 400);
    if (!department_id) throw new AppError('Assign the fresher to a department', 400);

    const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);

    const clean = (v) => cleanText(v);
    // Freshers always start at Level 100 — ignore any supplied level that is not 100
    if (level !== undefined && level !== null && String(level).trim() !== '') {
      const supplied = normalizeLevel(level);
      if (supplied && supplied !== '100') {
        throw new AppError('Freshers are always registered at Level 100', 400);
      }
    }
    const normLevel = '100';
    const normStudentNo = String(student_no ?? '')
      .trim()
      .toUpperCase();
    if (!normStudentNo) throw new AppError('Student number is required', 400);
    if (admission_year && String(admission_year).trim() !== '') {
      const { normalizeAcademicYear } = require('../utils/academicYear');
      const raw = String(admission_year).trim();
      if (!normalizeAcademicYear(raw) && !/^\d{4}$/.test(raw)) {
        throw new AppError('Admission year must be YYYY or YYYY/YYYY', 400);
      }
    }
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO students (name, student_no, is_fresher, level, department_id, admission_year,
                             phone, email, programme, gender, hometown, created_by)
       VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name,
        normStudentNo,
        normLevel,
        department_id,
        admission_year || null,
        clean(phone),
        clean(email),
        clean(programme),
        clean(gender),
        clean(hometown),
        req.user.id,
      ]
    );
    const student = rows[0];
    let receiptNumber = null;
    let receiptForEmail = null;

    // Souvenirs require a payment OR a $0 souvenir-only receipt will be created
    let hasSouvenirs = Array.isArray(souvenir_ids) && souvenir_ids.length > 0;
    let hasPayment = payment && Number(payment.amount) > 0;
    
    // If souvenirs are given without payment, create a $0 souvenir-only receipt
    if (hasSouvenirs && !hasPayment) {
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, student.id, 'SCH');
      const receipt = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, NULL, 0) RETURNING *`,
        [receiptNumber, student.id, new Date(), academicYear, req.user.id, department_id]
      );
      receiptForEmail = receipt.rows[0];
      await client.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           SELECT $1, id, $2, 'school', $3 FROM souvenirs
           WHERE id = ANY($4::int[]) AND category = 'school'`,
          [student.id, receipt.rows[0].id, req.user.id, souvenir_ids]
        );
      await logTransaction({
        admin_id: req.user.id,
        admin_role: schoolActorRole(req.user),
        transaction_type: 'souvenir_distribution',
        description: `Issued school souvenirs to ${name} (${receiptNumber}) - no payment`,
        meta: {
          receipt_id: receipt.rows[0].id,
          student_id: student.id,
          receipt_number: receiptNumber,
        },
      });
    }
    
    if (hasPayment) {
      if (!payment.method || !['cash', 'momo'].includes(payment.method))
        throw new AppError('Valid payment method required (cash, momo)', 400);
      const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAt.getTime()))
        throw new AppError('A valid payment date is required', 400);
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, student.id, 'SCH');
      const receipt = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, NULL, $8) RETURNING *`,
        [
          receiptNumber,
          student.id,
          payment.method,
          paidAt,
          academicYear,
          req.user.id,
          department_id,
          Number(payment.amount),
        ]
      );
      await client.query(
        `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, 'school_dues', $2, NULL, NULL)`,
        [receipt.rows[0].id, Number(payment.amount)]
      );
      receiptForEmail = receipt.rows[0];

      if (hasSouvenirs) {
        await client.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           SELECT $1, id, $2, 'school', $3 FROM souvenirs
           WHERE id = ANY($4::int[]) AND category = 'school'`,
          [student.id, receipt.rows[0].id, req.user.id, souvenir_ids]
        );
      }
    }

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'fresher_register',
      description: `Registered fresher "${name}" and assigned to department #${department_id}`,
      meta: { student_id: student.id, name, student_no: student_no || null, department_id },
    });
    await client.query('COMMIT');

    emitEvent('fresher:registered', {
      department_id: Number(department_id),
      student_id: student.id,
    });
    if (receiptForEmail) {
      // For souvenir-only receipts, send email with empty lines
      const lines = receiptForEmail.total_amount > 0 
        ? [{ type: 'school_dues', amount: receiptForEmail.total_amount }]
        : [];
      const souvenirs = await getSouvenirNames(client, receiptForEmail.id);
      sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber,
        paidAt: receiptForEmail.paid_at,
        method: receiptForEmail.method,
        total: receiptForEmail.total_amount,
        lines,
        souvenirs,
      }).catch((err) => console.error('Receipt email error:', err.message));
    }
    res.status(201).json({ ...student, receipt_number: receiptNumber });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return next(new AppError('Student number already exists', 409));
    next(err);
  } finally {
    client.release();
  }
});

// ─── Dept Admin: admit a fresher assigned to their department ───
// Body: { class_id?, payment?: { amount, method }, souvenir_ids?: [] }
// Sets admitted_at/admitted_by; optionally records the department-dues
// collection (receipt) and department souvenirs at the same time.
router.post('/:id/admit', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const studentId = Number(req.params.id);
    const { class_id, payment, souvenir_ids } = req.body;

    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    if (!['dept_admin', 'dept_staff'].includes(req.user.role))
      throw new AppError('Only the Department Admin or Staff can admit freshers', 403);

    // Only freshers can be admitted, only by the department they're assigned to
    if (!student.is_fresher) throw new AppError('Only freshers are admitted', 400);
    if (student.department_id !== req.user.department_id) {
      throw new AppError('You can only admit freshers assigned to your department', 403);
    }
    if (student.admitted_at) throw new AppError('This fresher has already been admitted', 400);

    const actorRole = req.user.role === 'dept_staff' ? 'DEPT_STAFF' : 'DEPT_ADMIN';

    // Class (if given) must belong to the student's department and match the
    // fresher's level (freshers are admitted at Level 100).
    if (!class_id) throw new AppError('Assign the fresher to a class before admission', 400);
    const fresherLevel = normalizeLevel(student.level) || '100';
    await ensureClassLevelMatches(pool, class_id, student.department_id, fresherLevel);

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admission:${studentId}`]);
    const { rows } = await client.query(
      `UPDATE students SET admitted_at = NOW(), admitted_by = $1, class_id = COALESCE($2, class_id)
       WHERE id = $3 AND admitted_at IS NULL RETURNING *`,
      [req.user.id, class_id || null, studentId]
    );
    if (rows.length === 0) throw new AppError('This fresher has already been admitted', 409);

    // Optional: department-dues collection + department souvenirs
    // If souvenirs are being given, we MUST have a receipt to attach them to.
    // This means either a payment receipt exists, or we create a $0 souvenir-only receipt.
    let receiptNumber = null;
    let receiptForEmail = null;
    let hasSouvenirs = Array.isArray(souvenir_ids) && souvenir_ids.length > 0;
    
    if (payment && Number(payment.amount) > 0) {
      if (!payment.method || !['cash', 'momo'].includes(payment.method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      const paidAtDate = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAtDate.getTime())) throw new AppError('A valid payment date is required', 400);
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, studentId, 'DEPT');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8, $9) RETURNING *`,
        [
          receipt_number,
          studentId,
          payment.method,
          paidAtDate,
          academicYear,
          req.user.id,
          student.department_id,
          class_id || student.class_id || null,
          Number(payment.amount),
        ]
      );
      await client.query(
        `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, 'department_dues', $2, $3, $4)`,
        [
          rc.rows[0].id,
          Number(payment.amount),
          student.department_id,
          class_id || student.class_id || null,
        ]
      );
      receiptNumber = receipt_number;
      receiptForEmail = rc.rows[0];

      await logTransaction({
        admin_id: req.user.id,
        admin_role: actorRole,
        transaction_type: 'payment',
        description: `Recorded Department Dues of GHS ${Number(payment.amount).toFixed(2)} for ${student.name} (${receipt_number})`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: studentId,
          receipt_number,
          type: 'department_dues',
        },
      });
    } else if (hasSouvenirs) {
      // No payment, but souvenirs are being given — create a $0 souvenir-only receipt
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, studentId, 'DEPT');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, $7, 0) RETURNING *`,
        [
          receiptNumber,
          studentId,
          new Date(),
          academicYear,
          req.user.id,
          student.department_id,
          class_id || student.class_id || null,
        ]
      );
      receiptForEmail = rc.rows[0];
      await logTransaction({
        admin_id: req.user.id,
        admin_role: actorRole,
        transaction_type: 'souvenir_distribution',
        description: `Issued department souvenirs to ${student.name} (${receiptNumber})`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: studentId,
          receipt_number: receiptNumber,
        },
      });
    }

    if (hasSouvenirs && receiptForEmail) {
      // Only souvenirs configured by this department can be given at admission
      await client.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
         SELECT $1, id, $2, 'department', $3 FROM souvenirs
          WHERE id = ANY($4::int[]) AND category = 'department'
            AND department_id = $5`,
        [studentId, receiptForEmail.id, req.user.id, souvenir_ids, student.department_id]
      );
    }

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole,
      transaction_type: 'fresher_admit',
      description: `Admitted fresher "${student.name}" into the department`,
      meta: { student_id: studentId, class_id: class_id || null, receipt_number: receiptNumber },
    });
    await client.query('COMMIT');

    emitEvent('fresher:admitted', { department_id: student.department_id, student_id: studentId });
    if (receiptNumber && receiptForEmail) {
      const hasPaymentAmount = Number(receiptForEmail.total_amount) > 0;
      if (hasPaymentAmount) {
        emitEvent('payment:new', {
          department_id: student.department_id,
          class_id: class_id || student.class_id || null,
          student_id: studentId,
          receipt_number: receiptNumber,
          total: Number(receiptForEmail.total_amount),
          source: 'admit',
        });
      }
      const souvenirs = await getSouvenirNames(client, receiptForEmail.id);
      sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber,
        paidAt: receiptForEmail.paid_at,
        method: receiptForEmail.method,
        total: receiptForEmail.total_amount,
        lines: hasPaymentAmount
          ? [{ type: 'department_dues', amount: receiptForEmail.total_amount }]
          : [],
        souvenirs,
      }).catch((err) => console.error('Receipt email error:', err.message));
    }
    res.json({ ...rows[0], receipt_number: receiptNumber });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── Dept side: add a continuing student to their department ───
// Body: { name, student_no, level, class_id?, phone?, email?, programme?, gender?,
//         hometown?, admission_year? } — same profile fields as freshers.
router.post('/', async (req, res, next) => {
  if (!isAnyDept(req.user) || req.user.role === 'dept_staff')
    return next(new (require('../utils/errors').AppError)('Department admin access required', 403));
  try {
    const {
      name,
      student_no,
      level,
      class_id,
      phone,
      email,
      programme,
      gender,
      hometown,
      admission_year,
    } = req.body;
    if (!name || !student_no) throw new AppError('Name and student number are required', 400);
    const normLevel = normalizeLevel(level);
    if (!normLevel) throw new AppError('Select a valid level (100, 200, 300 or 400)', 400);
    if (!class_id) throw new AppError('Assign the student to a class', 400);
    if (admission_year && String(admission_year).trim() !== '') {
      const { normalizeAcademicYear } = require('../utils/academicYear');
      const raw = String(admission_year).trim();
      if (!normalizeAcademicYear(raw) && !/^\d{4}$/.test(raw)) {
        throw new AppError('Admission year must be YYYY or YYYY/YYYY', 400);
      }
    }

    await ensureClassLevelMatches(pool, class_id, req.user.department_id, normLevel);

    const clean = (v) => cleanText(v);
    const normStudentNo = String(student_no).trim().toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO students (name, student_no, is_fresher, level, department_id, class_id, created_by,
                             phone, email, programme, gender, hometown, admission_year)
       VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name,
        normStudentNo,
        normLevel,
        req.user.department_id,
        class_id,
        req.user.id,
        clean(phone),
        clean(email),
        clean(programme),
        clean(gender),
        clean(hometown),
        admission_year || null,
      ]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'DEPT_ADMIN',
      transaction_type: 'student_create',
      description: `Added continuing student "${name}" (${student_no})`,
      meta: { student_id: rows[0].id, name, student_no, department_id: req.user.department_id },
    });

    emitEvent('student:changed', { department_id: req.user.department_id });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Student number already exists', 409));
    next(err);
  }
});

// ─── Bulk import of continuing students (Dept Admin only) ───
// Body: { rows: [{ name, student_no, level?, class_name?, admission_year?, phone?, email?, programme?, gender?, hometown? }], default_class_id? }
// Validates against existing student numbers, then inserts in one go.
// class_name (if present) must match one of the department's classes;
// otherwise the default_class_id is used. level (if omitted) is derived from
// the resolved class.
router.post('/import', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!isAnyDept(req.user) || req.user.role === 'dept_staff') {
      throw new AppError('Only Department Admins can bulk import students', 403);
    }
    const { rows: rawRows, default_class_id } = req.body;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      throw new AppError('No rows to import', 400);
    }

    const deptId = req.user.department_id;

    // Resolve classes: by name (case-insensitive) or default class
    const classRes = await pool.query(
      'SELECT id, name, level FROM classes WHERE department_id = $1',
      [deptId]
    );
    const classByName = new Map(classRes.rows.map((c) => [c.name.toLowerCase(), c.id]));
    const classLevelById = new Map(classRes.rows.map((c) => [c.id, c.level]));

    let defaultClass = null;
    if (default_class_id) {
      const chk = await pool.query('SELECT id FROM classes WHERE id = $1 AND department_id = $2', [
        default_class_id,
        deptId,
      ]);
      if (chk.rows.length === 0)
        throw new AppError('Default class does not belong to your department', 400);
      defaultClass = Number(default_class_id);
    }

    // Check duplicates among existing students (case-insensitive, matching the
    // UPPER() lookups used by the rep page and transfer endpoint).
    const numbers = rawRows.map((r) => cleanText(r.student_no)).filter(Boolean);
    const upNumbers = [...new Set(numbers.map((n) => n.toUpperCase()))];
    const dupRes = upNumbers.length
      ? await pool.query(
          'SELECT UPPER(student_no) AS student_no FROM students WHERE UPPER(student_no) = ANY($1::text[])',
          [upNumbers]
        )
      : { rows: [] };
    const existing = new Set(dupRes.rows.map((r) => r.student_no));

    const seen = new Set();
    const results = [];
    const toInsert = [];

    for (const raw of rawRows) {
      const name = cleanText(raw.name) || '';
      const student_no = (cleanText(raw.student_no) || '').toUpperCase();
      const rawClassName = cleanText(raw.class_name) || '';
      const class_name = rawClassName.toLowerCase();

      let error = null;
      const normLevel = normalizeLevel(raw.level);
      if (!name) error = 'Name is required';
      else if (!student_no) error = 'Student number is required';
      else if (existing.has(student_no)) error = `Student number ${student_no} already exists`;
      else if (seen.has(student_no)) error = `Duplicate row: ${student_no}`;
      else if (class_name && !classByName.has(class_name)) {
        error = `Unknown class "${raw.class_name}". Check the class name (it must be one of your department's classes).`;
      } else if (!class_name && !defaultClass) {
        error = 'No class given and no default class selected';
      } else {
        const resolvedClassId = class_name ? classByName.get(class_name) : defaultClass;
        const resolvedClassLevel = normalizeLevel(classLevelById.get(resolvedClassId));
        if (!normLevel && !resolvedClassLevel) {
          error = 'Provide a level or a class that has one';
        } else if (normLevel && resolvedClassLevel && normLevel !== resolvedClassLevel) {
          error = `Level ${normLevel} does not match the class "${
            rawClassName || 'default class'
          }". Use a class at Level ${normLevel}.`;
        }
      }

      if (!error) {
        seen.add(student_no);
        let classId = classByName.get(class_name) || defaultClass;
        const classLevel = classLevelById.get(classId);
        toInsert.push({
          name,
          student_no,
          level: normLevel || normalizeLevel(classLevel),
          class_id: classId,
          admission_year: cleanText(raw.admission_year),
          phone: cleanText(raw.phone),
          email: cleanText(raw.email),
          programme: cleanText(raw.programme),
          gender: cleanText(raw.gender),
          hometown: cleanText(raw.hometown),
        });
        results.push({ name, student_no, class_name: rawClassName || null, status: 'ok' });
      } else {
        results.push({
          name,
          student_no,
          class_name: rawClassName || null,
          status: 'error',
          error,
        });
      }
    }

    await client.query('BEGIN');
    let inserted = 0;
    for (const row of toInsert) {
      await client.query(
        `INSERT INTO students (name, student_no, is_fresher, level, department_id, class_id, admission_year, phone, email, programme, gender, hometown, created_by)
         VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.name,
          row.student_no,
          row.level,
          deptId,
          row.class_id,
          row.admission_year,
          row.phone,
          row.email,
          row.programme,
          row.gender,
          row.hometown,
          req.user.id,
        ]
      );
      inserted++;
    }
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'DEPT_ADMIN',
      transaction_type: 'student_bulk_import',
      description: `Bulk imported ${inserted} continuing student(s) (${results.length - inserted} skipped)`,
      meta: { department_id: deptId, attempted: rawRows.length, inserted },
    });
    await client.query('COMMIT');

    emitEvent('student:changed', { department_id: deptId });
    res.status(201).json({ inserted, skipped: results.length - inserted, rows: results });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505')
      return next(new AppError('One or more student numbers already exist', 409));
    next(err);
  } finally {
    client.release();
  }
});

// ─── Souvenirs received by a student ───
router.get('/:id/souvenirs', async (req, res, next) => {
  try {
    if (isAnyDept(req.user)) {
      const chk = await pool.query('SELECT id FROM students WHERE id = $1 AND department_id = $2', [
        req.params.id,
        req.user.department_id,
      ]);
      if (chk.rows.length === 0) throw new AppError('Student not found', 404);
    }
    const { rows } = await pool.query(
      `SELECT ss.souvenir_id, ss.level, sou.name AS souvenir_name, sou.category
       FROM student_souvenirs ss
       JOIN souvenirs sou ON sou.id = ss.souvenir_id
       WHERE ss.student_id = $1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Payment history for a student (itemized lines) ───
router.get('/:id/payments', async (req, res, next) => {
  try {
    if (isAnyDept(req.user)) {
      const chk = await pool.query('SELECT id FROM students WHERE id = $1 AND department_id = $2', [
        req.params.id,
        req.user.department_id,
      ]);
      if (chk.rows.length === 0) throw new AppError('Student not found', 404);
    }
    const { rows } = await pool.query(
      `SELECT r.id AS receipt_id, r.receipt_number, r.paid_at, r.academic_year,
              r.method, r.record_type, r.total_amount, p.type, p.amount
       FROM receipts r
       JOIN payments p ON p.receipt_id = r.id
       WHERE r.student_id = $1 AND r.voided_at IS NULL AND p.voided_at IS NULL
       ORDER BY r.paid_at DESC, p.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Record souvenirs for a student (fills in incomplete records) ───
// Body: { souvenir_ids: [] } — already-given souvenirs are ignored. Creates a
// $0 souvenir-only receipt so every souvenir stays receipt-specific.
router.post('/:id/souvenirs', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.user.role === 'dept_staff') {
      throw new AppError('Staff accounts cannot edit students', 403);
    }
    const studentId = Number(req.params.id);
    const { souvenir_ids } = req.body;
    if (!Array.isArray(souvenir_ids) || souvenir_ids.length === 0)
      throw new AppError('Select at least one souvenir', 400);

    const stu = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];
    if (isAnyDept(req.user) && student.department_id !== req.user.department_id) {
      throw new AppError('You can only manage students in your department', 403);
    }
    if (isAnyDept(req.user) && student.is_fresher && !student.admitted_at) {
      throw new AppError('Admit the fresher before recording souvenirs', 400);
    }

    await client.query('BEGIN');
    // Only school souvenirs or the student's own department's souvenirs are valid.
    const { rows: souvRows } = await client.query(
      `SELECT id, category FROM souvenirs
       WHERE id = ANY($1::int[])
         AND (category = 'school' OR (category = 'department' AND department_id = $2))`,
      [souvenir_ids, student.department_id]
    );
    if (souvRows.length === 0) throw new AppError('No valid souvenirs selected', 400);

    const { rows: existing } = await client.query(
      'SELECT souvenir_id FROM student_souvenirs WHERE student_id = $1',
      [studentId]
    );
    const already = new Set(existing.map((r) => r.souvenir_id));
    const toGive = souvRows.filter((s) => !already.has(s.id));
    if (toGive.length === 0) {
      await client.query('COMMIT');
      return res.json({ message: 'Souvenirs already recorded', added: 0 });
    }

    const schoolIds = toGive.filter((s) => s.category === 'school').map((s) => s.id);
    const deptIds = toGive.filter((s) => s.category === 'department').map((s) => s.id);
    const tag = schoolIds.length && deptIds.length ? 'DUES' : deptIds.length ? 'DEPT' : 'SCH';

    const academicYear = await getActiveAcademicYear(client);
    const receiptNumber = await nextReceiptNumber(client, studentId, tag);
    const rc = await client.query(
      `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
           VALUES ($1, $2, 'cash', NOW(), $3, 'admin', $4, $5, $6, 0) RETURNING *`,
      [
        receiptNumber,
        studentId,
        academicYear,
        req.user.id,
        student.department_id,
        student.class_id,
      ]
    );

    if (schoolIds.length) {
      await client.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
         SELECT $1, id, $2, 'school', $3 FROM souvenirs WHERE id = ANY($4::int[])`,
        [studentId, rc.rows[0].id, req.user.id, schoolIds]
      );
    }
    if (deptIds.length) {
      await client.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
         SELECT $1, id, $2, 'department', $3 FROM souvenirs WHERE id = ANY($4::int[])`,
        [studentId, rc.rows[0].id, req.user.id, deptIds]
      );
    }

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'souvenir_distribution',
      description: `Recorded ${toGive.length} souvenir(s) for ${student.name} (${receiptNumber})`,
      meta: {
        student_id: studentId,
        receipt_number: receiptNumber,
        souvenir_ids: toGive.map((s) => s.id),
      },
    });
    await client.query('COMMIT');
    emitEvent('student:changed', { department_id: student.department_id });
    res.json({ message: 'Souvenirs recorded', added: toGive.length, receipt_number: receiptNumber });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return next(
        new AppError('One or more of those souvenirs were already given to this student', 409)
      );
    }
    next(err);
  } finally {
    client.release();
  }
});

// ─── Update student (School Admin any; Dept Admin only own continuing students) ───
router.put('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'dept_staff') {
      throw new AppError('Staff accounts cannot edit students', 403);
    }
    const {
      name,
      student_no,
      department_id,
      class_id,
      admission_year,
      phone,
      email,
      programme,
      gender,
      hometown,
      level,
      is_graduated,
      is_archived,
    } = req.body;

    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    const isSchool = isAnySchool(req.user);
    if (isSchool && student.is_fresher && student.admitted_at) {
      if (department_id !== undefined && Number(department_id) !== student.department_id) {
        throw new AppError(
          'An admitted fresher cannot be moved via edit. Use POST /students/:id/transfer.',
          409
        );
      }
      if (class_id !== undefined)
        throw new AppError('The Department Admin owns class assignment after admission', 403);
    }
    if (isSchool && student.is_fresher && class_id !== undefined) {
      throw new AppError('The Department Admin assigns the fresher class during admission', 403);
    }
    if (
      isSchool &&
      !student.is_fresher &&
      department_id !== undefined &&
      Number(department_id) !== student.department_id
    ) {
      throw new AppError(
        'Continuing students are owned by their Department Admin. Use the transfer endpoint to move them.',
        403
      );
    }
    // Freshers are always Level 100 until admitted — prevent accidental level drift
    if (student.is_fresher && level !== undefined) {
      const normFreshLevel = normalizeLevel(level);
      if (normFreshLevel && normFreshLevel !== '100') {
        throw new AppError(
          'Freshers are always Level 100. Their level changes to 200 at admission.',
          400
        );
      }
    }
    // Admission year validation
    if (
      admission_year !== undefined &&
      admission_year !== null &&
      String(admission_year).trim() !== ''
    ) {
      const { normalizeAcademicYear } = require('../utils/academicYear');
      const raw = String(admission_year).trim();
      // Accept YYYY, YYYY/YYYY, or YYYY-YYYY
      if (!normalizeAcademicYear(raw) && !/^\d{4}$/.test(raw)) {
        throw new AppError('Admission year must be YYYY or YYYY/YYYY', 400);
      }
    }
    // Class must belong to the target department and match the student's level.
    // When both class_id and level are changed they must agree; when only one is
    // sent it must agree with the other's current value.
    if (class_id !== undefined && class_id) {
      const targetDept =
        isAnySchool(req.user) && department_id ? Number(department_id) : student.department_id;
      const targetLevel = level !== undefined ? normalizeLevel(level) : student.level;
      if (level !== undefined && !targetLevel)
        throw new AppError('Select a valid level (100, 200, 300 or 400)', 400);
      await ensureClassLevelMatches(pool, class_id, targetDept, targetLevel);
    } else if (level !== undefined && student.class_id) {
      // Level changed without changing the class — the existing class must fit.
      const targetLevel = normalizeLevel(level);
      if (!targetLevel) throw new AppError('Select a valid level (100, 200, 300 or 400)', 400);
      await ensureClassLevelMatches(pool, student.class_id, student.department_id, targetLevel);
    }

    // Dept side can only edit continuing students in their own department
    if (isAnyDept(req.user)) {
      if (student.is_fresher) throw new AppError('Only the School can edit freshers', 403);
      if (student.department_id !== req.user.department_id) {
        throw new AppError('You can only edit students in your department', 403);
      }
      if (class_id) {
        const cls = await pool.query(
          'SELECT id FROM classes WHERE id = $1 AND department_id = $2',
          [class_id, req.user.department_id]
        );
        if (cls.rows.length === 0)
          throw new AppError('Class does not belong to your department', 400);
      }
    }

    const clean = (v) => cleanText(v);
    const has = (v) => v !== undefined;

    // Set exactly what the request carries. A key sent with an empty string
    // clears the field (e.g. removing a phone number); an absent key leaves
    // the stored value untouched.
    const sets = ['name = $1', 'student_no = $2'];
    if (student_no !== undefined && !String(student_no).trim()) {
      throw new AppError('Student number is required', 400);
    }
    const vals = [
      name || student.name,
      student_no !== undefined ? String(student_no).trim().toUpperCase() : student.student_no,
    ];
    const put = (col, raw) => {
      if (has(raw)) {
        sets.push(`${col} = $${vals.length + 1}`);
        vals.push(raw === null ? null : clean(raw));
      }
    };
    // Department only moves via an explicit department_id (School side). If the
    // School Admin does not send department_id, leave the stored department
    // untouched — never silently null it.
    put(
      'department_id',
      req.user.role === 'school_admin' && has(department_id) ? department_id : undefined
    );
    put('class_id', has(class_id) ? class_id || null : undefined);
    put('admission_year', has(admission_year) ? admission_year || null : undefined);
    if (has(level)) {
      const normLevel = normalizeLevel(level);
      if (!normLevel) throw new AppError('Select a valid level (100, 200, 300 or 400)', 400);
      sets.push(`level = $${vals.length + 1}`);
      vals.push(normLevel);
    }
    if (req.user.role === 'school_admin' && has(is_graduated)) {
      sets.push(`is_graduated = $${vals.length + 1}`);
      vals.push(!!is_graduated);
    }
    if (req.user.role === 'school_admin' && has(is_archived)) {
      sets.push(`is_archived = $${vals.length + 1}`);
      vals.push(!!is_archived);
    }
    if (req.user.role === 'school_staff' && (has(is_graduated) || has(is_archived))) {
      throw new AppError('Only the main School Admin can change graduated/archived status', 403);
    }
    put('phone', phone);
    put('email', email);
    put('programme', programme);
    put('gender', gender);
    put('hometown', hometown);
    vals.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE students SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'student_update',
      description: `Updated student "${rows[0].name}"`,
      meta: { student_id: Number(req.params.id) },
    });

    emitEvent('student:changed', { department_id: student.department_id });
    if (department_id !== undefined && Number(department_id) !== student.department_id) {
      emitEvent('student:changed', { department_id: Number(department_id) });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Student number already exists', 409));
    next(err);
  }
});

// ─── Delete student ───
// School Admin: any student. Dept Admin: only their own continuing students.
router.delete('/:id', async (req, res, next) => {
  try {
    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    if (student.admitted_at)
      throw new AppError('Admitted students cannot be deleted. Archive them instead.', 409);
    const receiptCheck = await pool.query('SELECT 1 FROM receipts WHERE student_id = $1 LIMIT 1', [
      req.params.id,
    ]);
    if (receiptCheck.rows.length > 0)
      throw new AppError(
        'Students with payment history cannot be deleted. Archive them instead.',
        409
      );

    if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
      throw new AppError('Only the main School Admin can delete students', 403);
    }
    if (isAnyDept(req.user)) {
      if (student.is_fresher) throw new AppError('Only the School Admin can delete freshers', 403);
      if (student.department_id !== req.user.department_id) {
        throw new AppError('You can only delete students in your department', 403);
      }
    }

    const { rows } = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id, name', [
      req.params.id,
    ]);
    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'student_delete',
      description: `Deleted student "${rows[0].name}"`,
      meta: { student_id: rows[0].id },
    });

    emitEvent('student:changed', { department_id: student.department_id });
    res.json({ message: 'Student deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Transfer a student to another department (School Admin only) ───
// Used when a student switches departments part-way through their studies. The
// student's department_id moves to the target department; their class is set to
// the target department's class at the student's level when unambiguous
// (otherwise left unassigned for the new dept admin). Rejects when the target
// department already has a student with the same number (per-department unique).
// Body: { department_id, class_id? }
router.post('/:id/transfer', requireSchoolAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const studentId = Number(req.params.id);
    const toDeptId = Number(req.body.department_id);
    if (!toDeptId) throw new AppError('Select a target department', 400);

    const stu = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    if (student.department_id === toDeptId) {
      throw new AppError('The student is already in that department', 400);
    }

    const dept = await client.query('SELECT id, name FROM departments WHERE id = $1', [toDeptId]);
    if (dept.rows.length === 0) throw new AppError('Target department not found', 404);

    // Student numbers are university-wide unique; a transfer keeps the same
    // number, so a duplicate elsewhere is the only collision risk.
    if (student.student_no) {
      const dup = await client.query(
        'SELECT 1 FROM students WHERE UPPER(student_no) = $1 AND id <> $2',
        [String(student.student_no).toUpperCase(), studentId]
      );
      if (dup.rows.length > 0) {
        throw new AppError('Another student already uses this number', 409);
      }
    }

    await client.query('BEGIN');

    // Resolve a class in the target department at the student's level.
    let newClassId = student.class_id;
    const reqClass = req.body.class_id ? Number(req.body.class_id) : null;
    if (reqClass) {
      newClassId = await ensureClassLevelMatches(client, reqClass, toDeptId, student.level);
    } else {
      newClassId = await singleClassForLevel(client, toDeptId, student.level);
    }

    const { rows } = await client.query(
      `UPDATE students SET department_id = $1, class_id = $2 WHERE id = $3 RETURNING *`,
      [toDeptId, newClassId, studentId]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'student_transfer',
      description: `Transferred "${rows[0].name}" (${rows[0].student_no}) from department #${student.department_id} to #${toDeptId}`,
      meta: {
        student_id: studentId,
        from_department_id: student.department_id,
        to_department_id: toDeptId,
        level: student.level,
      },
    });
    await client.query('COMMIT');

    emitEvent('student:changed', { department_id: student.department_id });
    emitEvent('student:changed', { department_id: toDeptId });
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505')
      return next(
        new AppError('The target department already has a student with this number', 409)
      );
    next(err);
  } finally {
    client.release();
  }
});

// ─── Archive a student (School Admin only) ───
// Soft delete for students with payment history or who have been admitted — they
// can't be hard-deleted, so they are archived instead (hidden from active lists
// and rep collection). Set { archived: true|false } to archive/un-archive.
router.post('/:id/archive', requireSchoolAdmin, async (req, res, next) => {
  try {
    const studentId = Number(req.params.id);
    const archived = req.body.archived !== false;
    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    const { rows } = await pool.query(
      'UPDATE students SET is_archived = $1 WHERE id = $2 RETURNING *',
      [archived, studentId]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'student_archive',
      description: `${archived ? 'Archived' : 'Un-archived'} "${rows[0].name}" (${rows[0].student_no})`,
      meta: { student_id: studentId, archived },
    });

    emitEvent('student:changed', { department_id: student.department_id });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Start a new academic year (School Admin only) ───
// Advances every admitted student one level (100 -> 200 -> 300 -> 400),
// converts admitted freshers into continuing students at Level 200, graduates
// Level 400 students, sets the active academic year to the next year, and
// nudges each promoted student's class to the department's class for their new
// level (left unchanged when that is ambiguous or absent).
//
// Body: { confirm: true, to_year?: "2027/2028", hold_levels?: [id1, id2] }
// - confirm: required — protects against accidental execution.
// - to_year: optional — must match the computed next year; rejected otherwise.
// - hold_levels: optional array of student IDs to hold at their current level
//   (repeaters who failed and should not advance). Pending freshers are
//   automatically held; only admitted students need to be explicitly held.
router.post('/rollover', requireSchoolAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.body.confirm !== true) {
      throw new AppError('Confirm the year change by sending confirm: true.', 400);
    }

    const active = await getActiveAcademicYear(client);
    const [startY] = active.split('/').map(Number);
    const nextStart = startY + 1;
    const nextYear = `${nextStart}/${nextStart + 1}`;

    // Idempotency guard: a completed rollover records the year it established
    // in `last_rollover_to`. If that year is still the active year, this exact
    // transition has already been applied — refuse so an accidental re-run can
    // never double-advance everyone. The School advances the active academic
    // year via Settings before running the next year's rollover, which clears
    // this block.
    const marker = await client.query("SELECT value FROM settings WHERE key = 'last_rollover_to'");
    const lastRolloverTo = marker.rows[0]?.value || null;
    if (lastRolloverTo && normalizeAcademicYear(lastRolloverTo) === active) {
      throw new AppError(
        `A rollover to ${active} has already been applied (${active} is the active year). ` +
          `If this was a mistake, use Settings to set the active year back, then re-run.`,
        409
      );
    }

    const requested = req.body.to_year ? String(req.body.to_year).trim() : null;
    if (requested && requested !== nextYear) {
      throw new AppError(
        `Expected the next academic year to be ${nextYear}, got ${requested}.`,
        400
      );
    }

    // Per-student level hold (repeaters). ID-validated against live rows below.
    const holdRaw = req.body.hold_levels;
    const holdIds = Array.isArray(holdRaw)
      ? new Set(holdRaw.map(Number).filter(Boolean))
      : new Set();

    const current = await client.query(
      `SELECT s.id, s.level, s.is_fresher, s.admitted_at, s.department_id, s.class_id
       FROM students s WHERE s.is_graduated = false AND s.is_archived = false`
    );

    // Validate every requested hold ID exists in the current set.
    const currentIds = new Set(current.rows.map((s) => s.id));
    const invalidHolds = [...holdIds].filter((id) => !currentIds.has(id));
    if (invalidHolds.length > 0) {
      throw new AppError(`Invalid hold_levels IDs: ${invalidHolds.join(', ')}`, 400);
    }

    const counts = {
      freshers_admitted: 0,
      promoted: 0,
      held: 0,
      graduated: 0,
      pending_freshers_kept: 0,
    };

    await client.query('BEGIN');
    for (const st of current.rows) {
      let promotedTo = null;

      if (st.is_fresher) {
        if (!st.admitted_at) {
          counts.pending_freshers_kept++;
          continue; // hasn't reported yet — stays a pending fresher for the new intake
        }
        // Admitted fresher (Level 100) advances to Level 200 as a continuing
        // student, unless explicitly held (repeater).
        if (holdIds.has(st.id)) {
          counts.held++;
          continue;
        }
        promotedTo = '200';
        await client.query(`UPDATE students SET level = '200', is_fresher = false WHERE id = $1`, [
          st.id,
        ]);
        counts.freshers_admitted++;
      } else {
        if (holdIds.has(st.id)) {
          counts.held++;
          continue;
        }
        promotedTo = nextLevel(st.level);
        if (!promotedTo) {
          await client.query(`UPDATE students SET is_graduated = true WHERE id = $1`, [st.id]);
          counts.graduated++;
        } else {
          await client.query(`UPDATE students SET level = $1 WHERE id = $2`, [promotedTo, st.id]);
          counts.promoted++;
        }
      }

      // Promote the class to the department's class at the new level when it is
      // unambiguous (exactly one class for that level); otherwise leave it for
      // the dept admin to reassign.
      if (promotedTo) {
        await setClassForLevel(client, st.id, st.department_id, promotedTo);
      }
    }

    await client.query(
      `INSERT INTO settings (key, value) VALUES ('active_academic_year', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [nextYear]
    );
    // Record this transition so a re-run is refused until the School advances
    // the active year via Settings (which clears the idempotency block).
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('last_rollover_to', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [nextYear]
    );
    await client.query('COMMIT');

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'academic_year_rollover',
      description: `Started academic year ${nextYear}`,
      meta: { from_year: active, to_year: nextYear, ...counts },
    });

    emitEvent('student:changed', {});
    res.json({
      message: `Academic year advanced to ${nextYear}`,
      from_year: active,
      to_year: nextYear,
      ...counts,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Point a student at their department's class for a given level when there is
// exactly one such class. Clear the class when there is none or more than one,
// rather than retaining a class from the previous level.
async function setClassForLevel(client, studentId, deptId, level) {
  const { rows } = await client.query(
    `SELECT id FROM classes WHERE department_id = $1 AND SUBSTRING(level FROM '[0-9]+') = $2
     ORDER BY id LIMIT 2`,
    [deptId, level]
  );
  if (rows.length === 1) {
    await client.query('UPDATE students SET class_id = $1 WHERE id = $2', [rows[0].id, studentId]);
  } else {
    await client.query('UPDATE students SET class_id = NULL WHERE id = $1', [studentId]);
  }
}

module.exports = router;
