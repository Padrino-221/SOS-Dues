const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { nextReceiptNumber, tagForLines } = require('../utils/receipt');
const { logTransaction } = require('../utils/audit');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { getActiveAcademicYear, normalizeAcademicYear } = require('../utils/academicYear');
const { cleanText } = require('../utils/clean');

const router = express.Router();

// Attach dues balances to a student lookup row: cumulative paid amounts vs the
// required amounts, plus the fully-paid flags the rep page relies on.
function withBalance(row, academicYear) {
  const reqS = Number(row.school_dues_required || 0);
  const reqD = Number(row.dept_dues_required || 0);
  const paidS = Number(row.school_dues_paid_amount || 0);
  const paidD = Number(row.dept_dues_paid_amount || 0);
  return {
    ...row,
    academic_year: academicYear,
    school_dues_paid: paidS >= reqS,
    dept_dues_paid: paidD >= reqD,
    school_dues_outstanding: Math.max(reqS - paidS, 0),
    dept_dues_outstanding: Math.max(reqD - paidD, 0),
  };
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter cap on PIN attempts so a 4–8 digit PIN can't be brute-forced.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many PIN attempts. Wait 15 minutes and try again.',
});

// Dedicated limit on the public pre-registration form. It guards the single
// shared access code from brute-force while still allowing many students to
// register from a shared network.
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Wait 15 minutes and try again.',
});

// Public student-records lookup is rate-limited to make enumeration impractical.
const recordsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many lookups. Wait 15 minutes and try again.',
});

// ─── Public: student payment-history lookup (Records page) ───
// GET /records/:studentNo — a student checks their own payment history.
router.get('/records/:studentNo', recordsLimiter, async (req, res, next) => {
  try {
    const no = String(req.params.studentNo || '').trim();
    if (!no) throw new AppError('Enter your student number', 400);

    const { rows: students } = await pool.query(
      `SELECT s.id, s.name, s.student_no, s.level, s.is_fresher, s.admitted_at,
              d.name AS department_name
       FROM students s
       LEFT JOIN departments d ON d.id = s.department_id
       WHERE UPPER(s.student_no) = UPPER($1) AND s.is_archived = false
       ORDER BY s.created_at DESC LIMIT 10`,
      [no]
    );
    if (students.length === 0)
      throw new AppError('No record was found for that student number', 404);

    const ids = students.map((s) => s.id);
    const { rows: payments } = await pool.query(
      `SELECT r.student_id, r.receipt_number, r.paid_at, r.academic_year, r.method,
              r.record_type, r.total_amount, p.type, p.amount
       FROM receipts r
       JOIN payments p ON p.receipt_id = r.id
       WHERE r.student_id = ANY($1::int[]) AND r.voided_at IS NULL AND p.voided_at IS NULL
       ORDER BY r.paid_at DESC, p.id`,
      [ids]
    );

    res.json(
      students.map((s) => ({
        ...s,
        payments: payments.filter((p) => p.student_id === s.id),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ─── Public: resolve a department by its rep code ───
// Returns the department, its dues amount, the school-wide dues amount,
// and the department's classes so the rep can pick their class.
router.get('/departments/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, dues_amount, code, (pin IS NOT NULL) AS pin_set FROM departments WHERE code = $1',
      [req.params.code.toUpperCase()]
    );
    if (rows.length === 0)
      throw new AppError('Code not found. Check it with your department admin.', 404);
    const dept = rows[0];

    const settings = await pool.query(
      "SELECT value FROM settings WHERE key = 'school_dues_amount'"
    );
    const schoolDuesAmount = Number(settings.rows[0]?.value || 0);

    const classes = await pool.query(
      'SELECT id, name, level FROM classes WHERE department_id = $1 ORDER BY level, name',
      [dept.id]
    );

    // The distinct levels that have admitted continuing students, so the rep can
    // collect by LEVEL even for levels with no class. Includes levels that only
    // have students without a class (class-less levels).
    const levels = await pool.query(
      `SELECT DISTINCT s.level FROM students s
       WHERE s.department_id = $1 AND s.is_graduated = false AND s.is_archived = false
         AND s.admitted_at IS NOT NULL
       ORDER BY s.level`,
      [dept.id]
    );

    res.json({
      ...dept,
      school_dues_amount: schoolDuesAmount,
      classes: classes.rows,
      levels: levels.rows.map((r) => r.level),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Public: unlock recording with the department collector PIN ───
// One successful unlock issues an 8-hour session token for THIS department.
// The PIN itself is never sent back — only the token.
router.post('/departments/:code/unlock', unlockLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, code, pin, pin_version FROM departments WHERE code = $1',
      [req.params.code.toUpperCase()]
    );
    if (rows.length === 0) throw new AppError('Invalid department code', 404);
    const dept = rows[0];

    if (!dept.pin) {
      throw new AppError(
        `Recording is locked for ${dept.name} — no PIN has been set yet. Ask the department admin to set one.`,
        403
      );
    }

    const entered = String(req.body.pin ?? '').trim();
    const ok = await bcrypt.compare(entered, dept.pin);
    if (!ok) throw new AppError('Incorrect PIN. Check it with your department admin.', 401);

    const token = jwt.sign(
      {
        scope: 'rep',
        department_id: dept.id,
        department_code: dept.code,
        pin_version: dept.pin_version,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      expires_in: 8 * 3600,
      department: { id: dept.id, name: dept.name, code: dept.code },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Gate: student lookup + payment recording need an unlocked rep session ───
// The department code alone only opens the page; recording requires a token
// obtained with the correct PIN. The token is scoped to one department.
async function requireRepSession(req, res, next) {
  try {
    const deptRes = await pool.query('SELECT id, pin_version FROM departments WHERE code = $1', [
      req.params.code.toUpperCase(),
    ]);
    if (deptRes.rows.length === 0) throw new AppError('Invalid department code', 404);
    const deptId = deptRes.rows[0].id;

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('Unlock required. Enter the department PIN to continue.', 401);

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      throw new AppError('Your recording session has expired. Enter the PIN again.', 401);
    }
    if (
      payload.scope !== 'rep' ||
      payload.department_id !== deptId ||
      payload.pin_version !== deptRes.rows[0].pin_version
    ) {
      throw new AppError(
        'This session is not valid for this department. Enter the correct PIN.',
        403
      );
    }

    req.repSession = payload;
    next();
  } catch (err) {
    next(err);
  }
}

// ─── Public: confirm an existing continuing student in a class (rep page) ───
// Reps enter a student number BEFORE recording anything; the system tells them
// whether the student exists. If not, they are directed to the dept admin.
router.get(
  '/departments/:code/classes/:classId/students/:studentNo',
  limiter,
  requireRepSession,
  async (req, res, next) => {
    try {
      const { code, classId, studentNo } = req.params;
      const deptRes = await pool.query('SELECT id FROM departments WHERE code = $1', [
        code.toUpperCase(),
      ]);
      if (deptRes.rows.length === 0) throw new AppError('Code not found', 404);

      const academicYear = await getActiveAcademicYear(pool);
      const { rows } = await pool.query(
        `SELECT s.id, s.name, s.student_no,
         COALESCE((
           SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
            WHERE r.student_id = s.id AND r.academic_year = $4 AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'school_dues'
         ), 0) AS school_dues_paid_amount,
         COALESCE((
           SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
            WHERE r.student_id = s.id AND r.academic_year = $4 AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'department_dues'
         ), 0) AS dept_dues_paid_amount,
         (SELECT COALESCE(value, '0')::numeric FROM settings WHERE key = 'school_dues_amount') AS school_dues_required,
         (SELECT dues_amount FROM departments WHERE id = s.department_id) AS dept_dues_required
        FROM students s
        WHERE UPPER(s.student_no) = UPPER($1) AND s.department_id = $2 AND s.class_id = $3 AND s.is_fresher = false AND s.is_graduated = false AND s.is_archived = false`,
        [studentNo.trim(), deptRes.rows[0].id, Number(classId), academicYear]
      );
      if (rows.length === 0) {
        throw new AppError(
          `No student with number "${studentNo}" was found in this class. Ask the department admin to add them.`,
          404
        );
      }
      res.json(withBalance(rows[0], academicYear));
    } catch (err) {
      next(err);
    }
  }
);

// ─── Public: record a continuing student's dues (rep page) ───
// POST /departments/:code/classes/:classId/payments
// Body: { student_no, items: [{ type, amount }], method, paid_at? }
//
// CRITICAL RULE: reps NEVER create students. The student number must already
// exist in the system and belong to the chosen class in this department.
// Otherwise the rep is told to ask the department admin.
router.post(
  '/departments/:code/classes/:classId/payments',
  limiter,
  requireRepSession,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { code, classId } = req.params;
      const { student_no, items, method, paid_at, academic_year } = req.body;

      if (!student_no) throw new AppError('Student number is required', 400);
      if (!method || !['cash', 'momo'].includes(method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('At least one payment line is required', 400);
      }

      // Normalize lines (at most one of each type)
      const lines = [];
      for (const it of items) {
        const type = it.type;
        const amount = Number(it.amount);
        if (!['school_dues', 'department_dues'].includes(type)) {
          throw new AppError(`Invalid payment type "${type}"`, 400);
        }
        if (!amount || isNaN(amount) || amount <= 0) {
          throw new AppError('Each payment line needs a valid amount', 400);
        }
        if (lines.find((l) => l.type === type)) throw new AppError(`Duplicate ${type} line`, 400);
        lines.push({ type, amount });
      }

      // Verify department code + class
      const deptRes = await pool.query('SELECT id, name FROM departments WHERE code = $1', [
        code.toUpperCase(),
      ]);
      if (deptRes.rows.length === 0) throw new AppError('Code not found', 404);
      const dept = deptRes.rows[0];

      const clsRes = await pool.query(
        'SELECT id, name FROM classes WHERE id = $1 AND department_id = $2',
        [classId, dept.id]
      );
      if (clsRes.rows.length === 0) throw new AppError('Class not found in this department', 404);

      // The student MUST already exist in this class of this department
      const stuRes = await pool.query(
        `SELECT s.* FROM students s
       WHERE UPPER(s.student_no) = UPPER($1) AND s.department_id = $2 AND s.class_id = $3 AND s.is_fresher = false AND s.is_graduated = false AND s.is_archived = false`,
        [student_no, dept.id, Number(classId)]
      );
      if (stuRes.rows.length === 0) {
        throw new AppError(
          `No student with number "${student_no}" was found in this class. Ask the department admin to add them.`,
          404
        );
      }
      const student = stuRes.rows[0];

      const paidAtDate = paid_at ? new Date(paid_at) : new Date();
      if (Number.isNaN(paidAtDate.getTime()))
        throw new AppError('A valid payment date is required', 400);
      const academicYear =
        normalizeAcademicYear(academic_year) || (await getActiveAcademicYear(pool));

      // Installments allowed: no duplicate guard, just serialize concurrent writes.
      await client.query('BEGIN');
      for (const line of lines) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payment:${student.id}:${academicYear}:${line.type}`,
        ]);
      }

      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      const receipt_number = await nextReceiptNumber(client, student.id, tagForLines(lines));
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
           VALUES ($1, $2, $3, $4, $5, 'rep', NULL, $6, $7, $8) RETURNING *`,
        [
          receipt_number,
          student.id,
          method,
          paidAtDate,
          academicYear,
          dept.id,
          Number(classId),
          total,
        ]
      );

      for (const line of lines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, $2, $3, $4, $5)`,
          [
            rc.rows[0].id,
            line.type,
            line.amount,
            line.type === 'department_dues' ? dept.id : null,
            line.type === 'department_dues' ? Number(classId) : null,
          ]
        );
      }

      await logTransaction({
        admin_id: null,
        admin_role: 'REP',
        transaction_type: 'payment',
        description: `Class rep recorded dues (${lines.map((l) => `${l.type} GHS ${l.amount.toFixed(2)}`).join(' + ')}) for ${student.name} (${receipt_number})`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: student.id,
          receipt_number,
          lines,
          department_id: dept.id,
          class_id: Number(classId),
        },
      });
      await client.query('COMMIT');

      emitEvent('payment:new', {
        department_id: dept.id,
        class_id: Number(classId),
        student_id: student.id,
        receipt_number,
        total,
        source: 'rep',
      });

      sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber: receipt_number,
        paidAt: rc.rows[0].paid_at,
        method,
        total,
        lines,
        departmentName: dept.name,
      }).catch((err) => console.error('Receipt email error:', err.message));

      res.status(201).json({ ...rc.rows[0], lines });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── Public: confirm a continuing student by LEVEL (rep page) ───
// Some levels have no class, so reps can also collect by level. The class-id
// dimension is simply omitted: the student must belong to the department and be
// at the given level (continuing, not graduated, not archived).
router.get(
  '/departments/:code/levels/:level/students/:studentNo',
  limiter,
  requireRepSession,
  async (req, res, next) => {
    try {
      const { code, level, studentNo } = req.params;
      const deptRes = await pool.query('SELECT id FROM departments WHERE code = $1', [
        code.toUpperCase(),
      ]);
      if (deptRes.rows.length === 0) throw new AppError('Code not found', 404);

      if (!['100', '200', '300', '400'].includes(level)) throw new AppError('Invalid level', 400);

      const academicYear = await getActiveAcademicYear(pool);
      const { rows } = await pool.query(
        `SELECT s.id, s.name, s.student_no, s.level,
         COALESCE((
           SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
            WHERE r.student_id = s.id AND r.academic_year = $4 AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'school_dues'
         ), 0) AS school_dues_paid_amount,
         COALESCE((
           SELECT SUM(p.amount) FROM receipts r JOIN payments p ON p.receipt_id = r.id
            WHERE r.student_id = s.id AND r.academic_year = $4 AND r.voided_at IS NULL AND p.voided_at IS NULL AND p.type = 'department_dues'
         ), 0) AS dept_dues_paid_amount,
         (SELECT COALESCE(value, '0')::numeric FROM settings WHERE key = 'school_dues_amount') AS school_dues_required,
         (SELECT dues_amount FROM departments WHERE id = s.department_id) AS dept_dues_required
       FROM students s
       WHERE UPPER(s.student_no) = UPPER($1) AND s.department_id = $2 AND s.level = $3
         AND s.is_fresher = false AND s.is_graduated = false AND s.is_archived = false`,
        [studentNo.trim(), deptRes.rows[0].id, level, academicYear]
      );
      if (rows.length === 0) {
        throw new AppError(
          `No student with number "${studentNo}" was found at Level ${level} in this department. Ask the department admin to add them.`,
          404
        );
      }
      res.json(withBalance(rows[0], academicYear));
    } catch (err) {
      next(err);
    }
  }
);

// ─── Public: record dues for a continuing student by LEVEL (rep page) ───
// Level-scoped counterpart to the class payment route. class_id is recorded as
// NULL because the student's level is the grouping dimension here.
// POST /departments/:code/levels/:level/payments
// Body: { student_no, items: [{ type, amount }], method, paid_at? }
router.post(
  '/departments/:code/levels/:level/payments',
  limiter,
  requireRepSession,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { code, level } = req.params;
      const { student_no, items, method, paid_at, academic_year } = req.body;

      if (!['100', '200', '300', '400'].includes(level)) throw new AppError('Invalid level', 400);
      if (!student_no) throw new AppError('Student number is required', 400);
      if (!method || !['cash', 'momo'].includes(method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('At least one payment line is required', 400);
      }

      const lines = [];
      for (const it of items) {
        const type = it.type;
        const amount = Number(it.amount);
        if (!['school_dues', 'department_dues'].includes(type)) {
          throw new AppError(`Invalid payment type "${type}"`, 400);
        }
        if (!amount || isNaN(amount) || amount <= 0) {
          throw new AppError('Each payment line needs a valid amount', 400);
        }
        if (lines.find((l) => l.type === type)) throw new AppError(`Duplicate ${type} line`, 400);
        lines.push({ type, amount });
      }

      const deptRes = await pool.query('SELECT id, name FROM departments WHERE code = $1', [
        code.toUpperCase(),
      ]);
      if (deptRes.rows.length === 0) throw new AppError('Code not found', 404);
      const dept = deptRes.rows[0];

      // The student must exist at this level in this department
      const stuRes = await pool.query(
        `SELECT s.* FROM students s
       WHERE UPPER(s.student_no) = UPPER($1) AND s.department_id = $2 AND s.level = $3
         AND s.is_fresher = false AND s.is_graduated = false AND s.is_archived = false`,
        [student_no, dept.id, level]
      );
      if (stuRes.rows.length === 0) {
        throw new AppError(
          `No student with number "${student_no}" was found at Level ${level}. Ask the department admin to add them.`,
          404
        );
      }
      const student = stuRes.rows[0];

      const paidAtDate = paid_at ? new Date(paid_at) : new Date();
      if (Number.isNaN(paidAtDate.getTime()))
        throw new AppError('A valid payment date is required', 400);
      const academicYear =
        normalizeAcademicYear(academic_year) || (await getActiveAcademicYear(pool));

      // Installments allowed: no duplicate guard, just serialize concurrent writes.
      await client.query('BEGIN');
      for (const line of lines) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payment:${student.id}:${academicYear}:${line.type}`,
        ]);
      }

      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      const receipt_number = await nextReceiptNumber(client, student.id, tagForLines(lines));
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
           VALUES ($1, $2, $3, $4, $5, 'rep', NULL, $6, NULL, $7) RETURNING *`,
        [receipt_number, student.id, method, paidAtDate, academicYear, dept.id, total]
      );

      for (const line of lines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, $2, $3, $4, NULL)`,
          [rc.rows[0].id, line.type, line.amount, line.type === 'department_dues' ? dept.id : null]
        );
      }

      await logTransaction({
        admin_id: null,
        admin_role: 'REP',
        transaction_type: 'payment',
        description: `Class rep recorded dues (${lines.map((l) => `${l.type} GHS ${l.amount.toFixed(2)}`).join(' + ')}) for ${student.name} via Level ${level} (${receipt_number})`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: student.id,
          receipt_number,
          lines,
          department_id: dept.id,
          level,
        },
      });
      await client.query('COMMIT');

      emitEvent('payment:new', {
        department_id: dept.id,
        level,
        student_id: student.id,
        receipt_number,
        total,
        source: 'rep',
      });

      sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber: receipt_number,
        paidAt: rc.rows[0].paid_at,
        method,
        total,
        lines,
        departmentName: dept.name,
      }).catch((err) => console.error('Receipt email error:', err.message));

      res.status(201).json({ ...rc.rows[0], lines });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── Public: validate the fresher access code (before showing the form) ───
// Lightweight check so the client only shows the personal-details form once the
// shared access code is correct. Does not create or return any private data.
router.post('/freshers/apply/check-code', applyLimiter, async (req, res, next) => {
  try {
    const cfg = await pool.query("SELECT value FROM settings WHERE key = 'fresher_access_code'");
    const accessCode = cfg.rows[0]?.value || '';
    const enteredCode = String(req.body.code ?? '').trim();
    if (
      !enteredCode ||
      !accessCode ||
      enteredCode.toUpperCase() !== String(accessCode).trim().toUpperCase()
    ) {
      throw new AppError('Invalid access code. Please check with the School of Sciences.', 403);
    }
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
});

// ─── Public: fresher at-home pre-registration (before reporting day) ───
// Body: { code, full_name, student_no, phone?, email?, programme?, gender?, hometown? }
// Creates a pending fresher application the School Admin verifies on the
// reporting day. Never creates a real student row by itself.
router.post('/freshers/apply', applyLimiter, async (req, res, next) => {
  try {
    const { code, full_name, student_no, phone, email, programme, gender, hometown } = req.body;

    const cfg = await pool.query("SELECT value FROM settings WHERE key = 'fresher_access_code'");
    const accessCode = cfg.rows[0]?.value || '';
    const enteredCode = String(code ?? '').trim();
    if (
      !enteredCode ||
      !accessCode ||
      enteredCode.toUpperCase() !== String(accessCode).trim().toUpperCase()
    ) {
      throw new AppError('Invalid access code. Please check with the School of Sciences.', 403);
    }

    const name = String(full_name ?? '').trim();
    const no = String(student_no ?? '')
      .trim()
      .toUpperCase();
    if (!name) throw new AppError('Full name is required', 400);
    if (!no) throw new AppError('Student number is required', 400);

    const dupStu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [no]);
    if (dupStu.rows.length > 0) {
      throw new AppError(
        'This student number is already registered — if that is you, you are all set.',
        409
      );
    }
    const dupApp = await pool.query(
      "SELECT 1 FROM fresher_applications WHERE UPPER(student_no) = $1 AND status = 'pending'",
      [no]
    );
    if (dupApp.rows.length > 0) {
      throw new AppError(
        'This student number has already been submitted. No need to fill it twice.',
        409
      );
    }

    const activeYear = await getActiveAcademicYear(pool);
    const year = activeYear.split('/')[0];
    try {
      await pool.query(
        `INSERT INTO fresher_applications (full_name, student_no, phone, email, programme, gender, hometown, admission_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          name,
          no,
          cleanText(phone),
          cleanText(email),
          cleanText(programme),
          cleanText(gender),
          cleanText(hometown),
          year,
        ]
      );
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError(
          'This student number has already been submitted. No need to fill it twice.',
          409
        );
      }
      throw err;
    }

    await logTransaction({
      admin_id: null,
      admin_role: 'SYSTEM',
      transaction_type: 'fresher_apply',
      description: `Fresher pre-registration received for ${name} (${no})`,
      meta: { student_no: no, programme: cleanText(programme), admission_year: year },
    });

    emitEvent('fresher_application:new', {});

    res.status(201).json({ message: 'Pre-registration received', admission_year: year });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
