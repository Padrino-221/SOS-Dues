const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { assertMainDues } = require('../utils/duesLimits');
const { nextStandaloneReceiptNumber, tagForLines } = require('../utils/receipt');
const { logTransaction } = require('../utils/audit');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { getActiveAcademicYear } = require('../utils/academicYear');
const { LEVELS, normalizeLevel } = require('../utils/levels');
const { continuingPayer } = require('../utils/continuingPayer');
const { cleanText } = require('../utils/clean');
const { isValidName, isValidPhone } = require('../utils/inputRules');
const { normalizeStudentNo, assertStudentNoShape } = require('../utils/studentNo');

const router = express.Router();

// Every limiter answers with JSON so API clients (which never parse plain
// text bodies) can show the reason instead of a generic failure.
const jsonRateLimitHandler = (message) => (req, res, _next, options) =>
  res.status(429).json({
    error: message,
    code: 'RATE_LIMITED',
    retry_after: Math.ceil((options?.windowMs || 60 * 1000) / 1000),
  });

// Payments recording: generous enough for a busy collection desk, tight enough
// to stop runaway retries. The message is explicit that nothing was recorded.
const paymentsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler(
    'Too many payment requests. Your payment was NOT recorded — wait a minute and try again.'
  ),
});

// Limit repeated course rep sign-in attempts.
const repLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many sign-in attempts. Wait 15 minutes and try again.'),
});

// Dedicated limiter on the public pre-registration form. Many students may
// legitimately register from one shared network/IP, so the cap is high and
// successful submissions do not count against it.
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many attempts. Wait a few minutes and try again.'),
});

// Public student-records lookup is rate-limited to make enumeration impractical.
const recordsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many lookups. Wait 15 minutes and try again.'),
});

// As-you-type lookup on the rep form: fires after every pause in typing, so it
// gets its own generous budget — keyed on the rep session (falls back to the
// IP before a session exists) so many reps behind one school network never
// share a quota. Far above anything a human typing can reach, but it still
// bounds scripted walks of the student list.
const lookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  keyGenerator: (req) => req.get('authorization') || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler(
    'Too many student lookups. Wait a moment, then enter the student’s details manually.'
  ),
});

// ─── Public: student payment-history lookup (Records page) ───
// GET /records/:studentNo — a student checks their own payment history.
// Covers both kinds of receipt: those linked to a student row and free-flow
// receipts that only carry the typed index number. A payer with no student
// record at all still gets a profile built from their receipts.
router.get('/records/:studentNo', recordsLimiter, async (req, res, next) => {
  try {
    const no = String(req.params.studentNo || '').trim();
    if (!no) throw new AppError('Enter your student number', 400);

    const { rows: students } = await pool.query(
      `SELECT s.id, s.name, s.student_no, s.level, s.is_fresher, s.admitted_at,
              d.name AS department_name
       FROM students s
       LEFT JOIN departments d ON d.id = s.department_id
       WHERE UPPER(s.student_no) = UPPER($1)
       ORDER BY s.created_at DESC LIMIT 10`,
      [no]
    );

    // Voided receipts stay visible here (marked with voided_at/void_reason)
    // so a student sees their full history including reversals. Only
    // individually voided payment lines are excluded.
    const { rows: payments } = await pool.query(
      `SELECT r.student_id, r.receipt_number, r.paid_at, r.academic_year, r.method,
              r.level AS receipt_level, r.payment_level,
              r.record_type, r.total_amount, r.voided_at, r.void_reason,
              p.type, p.label, p.amount
       FROM receipts r
       JOIN payments p ON p.receipt_id = r.id
       LEFT JOIN students s ON s.id = r.student_id
       WHERE UPPER(COALESCE(r.student_no, s.student_no)) = UPPER($1)
         AND p.voided_at IS NULL
       ORDER BY r.paid_at DESC, p.id`,
      [no]
    );

    if (students.length === 0 && payments.length === 0) {
      throw new AppError('No record was found for that student number', 404);
    }

    // Free-flow receipts carry no student_id — attach them to the student row
    // when one exists for this index number.
    const standalone = payments.filter((p) => p.student_id === null);
    if (students.length > 0) {
      const byStudent = (sid) => payments.filter((p) => p.student_id === sid);
      return res.json(
        students.map((s, i) => ({
          ...s,
          payments: i === 0 ? [...byStudent(s.id), ...standalone] : byStudent(s.id),
        }))
      );
    }

    // No student row at all — build a profile from the free-flow receipts.
    const { rows: receipts } = await pool.query(
      `SELECT r.student_name, r.student_no, r.level, d.name AS department_name
       FROM receipts r
       LEFT JOIN departments d ON d.id = r.department_id
       WHERE r.student_id IS NULL AND UPPER(r.student_no) = UPPER($1)
         AND r.voided_at IS NULL
       ORDER BY r.paid_at DESC LIMIT 1`,
      [no]
    );
    const head = receipts[0];
    res.json([
      {
        id: null,
        name: head?.student_name || no,
        student_no: head?.student_no || no,
        level: head?.level || null,
        department_name: head?.department_name || null,
        payments: standalone,
      },
    ]);
  } catch (err) {
    next(err);
  }
});

// ─── Public: look up students by number for the rep to select ───
// Returns candidate rows (name/number/email/level/department) WITHOUT any
// payment history — reps pick a candidate and the details auto-fill, or
// proceed manually when nothing matches. Requires an unlocked rep session.
// The rep form searches as the rep types (debounced), so the limiter is
// keyed per session and sized for typing rather than for button clicks.
router.get(
  '/departments/:code/students/lookup',
  requireRepSession,
  lookupLimiter,
  async (req, res, next) => {
    try {
      const q = String(req.query.student_no ?? '')
        .trim()
        .toUpperCase();
      if (!q) throw new AppError('Enter a student number to look up', 400);
      const { rows } = await pool.query(
        `SELECT s.id, s.name, s.student_no, s.email, s.level, s.verification_status,
                d.name AS department_name
         FROM students s
         LEFT JOIN departments d ON d.id = s.department_id
         WHERE (UPPER(s.student_no) = $1 OR UPPER(s.student_no) LIKE $2 || '%')
           AND s.student_no IS NOT NULL
         ORDER BY (UPPER(s.student_no) = $1) DESC, s.name
         LIMIT 10`,
        [q, q]
      );
      res.json(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          student_no: r.student_no,
          email: r.email,
          level: r.level,
          department_name: r.department_name,
          pending: r.verification_status !== 'verified',
        }))
      );
    } catch (err) {
      next(err);
    }
  }
);

// ─── Public: resolve a department by its rep code ───
// Returns the department, its dues amount, the school-wide dues amount and
// the selectable levels. Levels are the fixed program levels and never
// depend on which students happen to exist.
router.get('/departments/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, dues_amount, code FROM departments WHERE code = $1',
      [req.params.code.toUpperCase()]
    );
    if (rows.length === 0)
      throw new AppError('Code not found. Check it with your department admin.', 404);
    const dept = rows[0];

    const settings = await pool.query(
      "SELECT value FROM settings WHERE key = 'school_dues_amount'"
    );
    const schoolDuesAmount = Number(settings.rows[0]?.value || 0);

    // The academic year reps collect under is locked to the School Admin's
    // active year — the client displays it and the collect endpoint enforces it.
    const academicYear = await getActiveAcademicYear(pool);

    res.json({
      ...dept,
      school_dues_amount: schoolDuesAmount,
      levels: LEVELS,
      academic_year: academicYear,
    });
  } catch (err) {
    next(err);
  }
});

// Course rep credentials are separate from administrator credentials.
router.post('/departments/:code/login', repLoginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || email.length > 254 ||
        typeof password !== 'string' || Buffer.byteLength(password) > 72) {
      throw new AppError('Invalid email or password', 401);
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.password_hash, c.department_id
       FROM course_reps c JOIN departments d ON d.id = c.department_id
       WHERE c.email = $1 AND d.code = $2 AND c.disabled_at IS NULL AND c.invite_hash IS NULL`,
      [email.trim().toLowerCase(), req.params.code.toUpperCase()]
    );
    const account = rows[0];
    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      throw new AppError('Invalid email or password for this department', 401);
    }
    const token = jwt.sign(
      { scope: 'course_rep', sub: String(account.id), department_id: account.department_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token });
  } catch (err) { next(err); }
});

router.post('/departments/:code/activate', repLoginLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
        typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
      throw new AppError('Use a valid invitation and a password of at least 12 characters (72 bytes maximum).', 400);
    }
    const digest = require('node:crypto').createHash('sha256').update(token).digest('hex');
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(`UPDATE course_reps c
      SET password_hash=$1, invite_hash=NULL, invite_expires_at=NULL
      FROM departments d WHERE d.id=c.department_id AND d.code=$2
        AND c.invite_hash=$3 AND c.invite_expires_at>NOW() AND c.disabled_at IS NULL`,
    [hash, req.params.code.toUpperCase(), digest]);
    if (!result.rowCount) throw new AppError('This invitation has expired or was already used. Ask your administrator for a new invitation.', 400);
    res.sendStatus(204);
  } catch (err) { next(err); }
});

async function requireRepSession(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    let payload;
    try {
      payload = jwt.verify(header.startsWith('Bearer ') ? header.slice(7) : '', process.env.JWT_SECRET);
    } catch {
      throw new AppError('Sign in to continue recording dues.', 401);
    }
    if (payload.scope !== 'course_rep' || !/^\d+$/.test(payload.sub || '')) {
      throw new AppError('Sign in with your course rep account.', 401);
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.email, c.department_id FROM course_reps c JOIN departments d ON d.id = c.department_id
       WHERE c.id = $1 AND c.department_id = $2 AND d.code = $3 AND c.disabled_at IS NULL AND c.invite_hash IS NULL`,
      [payload.sub, payload.department_id, req.params.code.toUpperCase()]
    );
    if (!rows.length) throw new AppError('This course rep session is no longer valid.', 401);
    req.repSession = rows[0];
    next();
  } catch (err) { next(err); }
}

// Normalize and validate payment lines: at most one of each dues type, each
// with a positive amount. Every amount is quantized to pesewas (2 decimals)
// so float dust from the form never reaches the database.
function normalizeLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Select at least one dues to record', 400);
  }
  const lines = [];
  for (const it of items) {
    const type = it.type;
    const amount = Math.round(Number(it.amount) * 100) / 100;
    if (type !== 'school_dues') {
      throw new AppError('Course reps can record school dues only', 400);
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      throw new AppError('Each payment line needs a valid amount', 400);
    }
    // Only school/department dues reach this point — both are main dues and
    // carry the cap.
    assertMainDues(amount, type === 'school_dues' ? 'School dues' : 'Department dues');
    if (lines.find((l) => l.type === type)) throw new AppError(`Duplicate ${type} line`, 400);
    lines.push({ type, amount });
  }
  return lines;
}

// ─── Public: record a payment free-flow (rep page) ───
// POST /departments/:code/payments
// Body: { student_name, student_no, email, class_name, level, payment_level,
//         items, method, paid_at?, idempotency_key? }
//
// Continuing students enter their details directly. The server reuses a
// same-department student with the index number or creates a pending record.
// Payment and its emailed receipt are recorded immediately; new student
// list membership waits for school-admin verification.
//
// IDEMPOTENCY: the client sends an `idempotency_key` per form fill. A retried
// request (timeout, double-tap, flaky network) with the same key returns the
// already-recorded receipt with 200 + `duplicate: true` instead of recording
// the cash payment twice.
// requireRepSession runs BEFORE the payments limiter so unauthenticated hits
// never burn the budget of an unlocked collector.
router.post(
  '/departments/:code/payments',
  requireRepSession,
  paymentsLimiter,
  async (req, res, next) => {
    const client = await pool.connect();
    let idempotencyKey = null;
    try {
      const { code } = req.params;
      const { items, method, paid_at } = req.body;
      const { name: snapName, no: snapNo, email: payerEmail, className, level: snapLevel, paymentLevel: normPaymentLevel } = continuingPayer(req.body);

      const rawKey = req.body.idempotency_key;
      if (rawKey !== undefined && rawKey !== null && String(rawKey).trim() !== '') {
        idempotencyKey = String(rawKey).trim().slice(0, 128);
      }

      if (!method || !['cash', 'momo'].includes(method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      const lines = normalizeLines(items);

      const deptRes = await pool.query('SELECT id, name FROM departments WHERE code = $1', [
        code.toUpperCase(),
      ]);
      if (deptRes.rows.length === 0) throw new AppError('Code not found', 404);
      const dept = deptRes.rows[0];

      const paidAtDate = paid_at ? new Date(paid_at) : new Date();
      if (Number.isNaN(paidAtDate.getTime()))
        throw new AppError('A valid payment date is required', 400);
      // Collections are locked to the School Admin's active academic year —
      // any client-supplied year is ignored.
      const academicYear = await getActiveAcademicYear(pool);

      // Installments allowed: no duplicate guard, just serialize concurrent writes.
      await client.query('BEGIN');
      for (const line of lines) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payment:${snapNo}:${academicYear}:${line.type}`,
        ]);
      }

      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      const receipt_number = await nextStandaloneReceiptNumber(client, snapNo, tagForLines(lines));

      // Match the index number at submission time, without requiring a lookup
      // or an existing roster. The lock also serializes first-time registrations.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rep-student:${snapNo}`]);
      const prior = await client.query(
        'SELECT id, department_id, verification_status FROM students WHERE UPPER(student_no) = $1 FOR UPDATE',
        [snapNo]
      );
      let studentId;
      let pendingStudent = false;
      if (prior.rows.length) {
        const student = prior.rows[0];
        if (Number(student.department_id) !== Number(dept.id)) {
          throw new AppError('This index number belongs to another department. Check the number or contact your administrator.', 409);
        }
        studentId = student.id;
        pendingStudent = student.verification_status === 'pending';
        // Preserve verified profiles; a rep cannot overwrite an admin's record.
        if (pendingStudent) {
          await client.query(
            'UPDATE students SET name=$1, email=$2, level=$3, class_name=$4 WHERE id=$5',
            [snapName, payerEmail, snapLevel, className, studentId]
          );
        }
      } else {
        const created = await client.query(
          `INSERT INTO students (name, student_no, is_fresher, level, department_id, email, class_name, verification_status)
           VALUES ($1, $2, false, $3, $4, $5, $6, 'pending') RETURNING id`,
          [snapName, snapNo, snapLevel, dept.id, payerEmail, className]
        );
        studentId = created.rows[0].id;
        pendingStudent = true;
      }

      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, student_name, student_no, payer_email, level, payment_level, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount, idempotency_key, class_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'rep', NULL, $11, $12, $13, $14) RETURNING *`,
        [
          receipt_number,
          studentId,
          snapName,
          snapNo,
          payerEmail,
          snapLevel,
          normPaymentLevel,
          method,
          paidAtDate,
          academicYear,
          dept.id,
          total,
          idempotencyKey,
          className,
        ]
      );

      for (const line of lines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, amount, department_id)
         VALUES ($1, $2, $3, $4)`,
          [rc.rows[0].id, line.type, line.amount, line.type === 'department_dues' ? dept.id : null]
        );
      }

      const classSuffix = ` (Level ${snapLevel})`;
      await logTransaction({
        admin_id: null,
        admin_role: 'REP',
        transaction_type: 'payment',
        description: `Class rep recorded dues (${lines.map((l) => `${l.type} GHS ${l.amount.toFixed(2)}`).join(' + ')}) for ${snapName} (${snapNo})${classSuffix} (${receipt_number})`,
        meta: {
          receipt_id: rc.rows[0].id,
          receipt_number,
          student_name: snapName,
          student_no: snapNo,
          level: snapLevel,
          payment_level: normPaymentLevel,
          class_name: className,
          pending_student: pendingStudent,
          course_rep_id: req.repSession.id,
          course_rep_name: req.repSession.name,
          course_rep_email: req.repSession.email,
          lines,
          department_id: dept.id,
        },
        client,
      });
      await client.query('COMMIT');

      emitEvent('payment:new', {
        department_id: dept.id,
        level: snapLevel,
        student_id: studentId,
        receipt_number,
        total,
        source: 'rep',
      });

      // Awaited so the response can tell the truth about the email instead of
      // the UI unconditionally claiming "Receipt emailed to X".
      const emailResult = await sendReceiptEmail({
        to: payerEmail,
        studentName: snapName,
        studentNo: snapNo,
        receiptNumber: receipt_number,
        paidAt: rc.rows[0].paid_at,
        method,
        total,
        lines,
        departmentName: dept.name,
      });

      res.status(201).json({
        ...rc.rows[0],
        lines,
        pending_verification: pendingStudent,
        email: {
          sent: emailResult.sent,
          mode: emailResult.mode,
          to: emailResult.to,
          ...(emailResult.error ? { error: emailResult.error } : {}),
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // Same idempotency key seen before → the payment already exists. Return
      // the existing receipt instead of recording the cash twice.
      if (err.code === '23505' && idempotencyKey) {
        try {
          const { rows } = await pool.query(
            `SELECT r.* FROM receipts r WHERE r.idempotency_key = $1
             AND r.record_type = 'rep' AND r.department_id = $2
             AND EXISTS (SELECT 1 FROM transaction_log tl
               WHERE tl.transaction_type = 'payment'
                 AND tl.meta->>'receipt_id' = r.id::text
                 AND tl.meta->>'course_rep_id' = $3)`,
            [idempotencyKey, req.repSession.department_id, String(req.repSession.id)]
          );
          if (rows.length > 0) {
            const existing = rows[0];
            const { rows: existingLines } = await pool.query(
              'SELECT type, label, amount FROM payments WHERE receipt_id = $1 ORDER BY id',
              [existing.id]
            );
            return res.status(200).json({
              ...existing,
              lines: existingLines.map((p) => ({
                type: p.type,
                label: p.label || null,
                amount: Number(p.amount),
              })),
              duplicate: true,
              email: {
                sent: false,
                mode: 'skipped',
                to: existing.payer_email || null,
                error: 'Duplicate payment — the original receipt was already issued and emailed.',
              },
            });
          }
        } catch (lookupErr) {
          console.error('Idempotency duplicate lookup failed:', lookupErr.message);
        }
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── Public: what a fresher pays on reporting day (apply-page breakdown) ───
// School dues + the active school-wide dues items. Department-specific items
// can't be known yet — the fresher has no department until verification —
// so the apply page shows this school part and says the department's items
// are added on assignment.
router.get('/freshers/charges', async (req, res, next) => {
  try {
    const [settingsRes, itemsRes] = await Promise.all([
      pool.query(`SELECT value FROM settings WHERE key = 'school_dues_amount'`),
      pool.query(
        `SELECT id, name, amount FROM dues_items
          WHERE active AND department_id IS NULL ORDER BY name`
      ),
    ]);
    res.json({
      school_dues_amount: Number(settingsRes.rows[0]?.value || 0),
      items: itemsRes.rows.map((r) => ({ id: r.id, name: r.name, amount: Number(r.amount) })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Public: fresher at-home pre-registration (before reporting day) ───
// Body: { full_name, student_no, phone?, email?, programme?, gender?, hometown? }
// Creates a pending fresher application the School Admin verifies on the
// reporting day. Never creates a real student row by itself.
// (The old shared access-code gate was removed per stakeholder feedback —
// volume is controlled by the rate limiter instead.)
router.post('/freshers/apply', applyLimiter, async (req, res, next) => {
  try {
    const { full_name, student_no, phone, email, programme, gender, hometown } = req.body;

    const name = String(full_name ?? '').trim();
    const no = normalizeStudentNo(student_no);
    if (!name) throw new AppError('Full name is required', 400);
    // Reference numbers are free-form — applicants type whatever their
    // admission letter shows (UA2309264, SMK/2021/045, ...). The strict UA
    // format is enforced solely when an admin retypes the number at
    // verification — but the SHAPE is checked here: phone numbers, stray
    // commas and other junk never enter the queue (normalize drops inner
    // spaces and trailing punctuation first).
    assertStudentNoShape(no);

    // Letters (+ spaces, hyphens, apostrophes, periods) only in names — no
    // digits, emoji or other symbols. Contacts are digits only. Checked
    // before the duplicate lookups so bad input fails fast, untouched.
    if (!isValidName(name)) {
      throw new AppError(
        'Full name should contain letters only — no numbers, emoji or symbols',
        400
      );
    }
    const phoneVal = cleanText(phone);
    if (!isValidPhone(phoneVal)) {
      throw new AppError('Phone number should contain numbers only', 400);
    }

    // Email is optional, but when given it must be a real address — the
    // reporting-day follow-up depends on it.
    const applicantEmail = cleanText(email);
    if (applicantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
      throw new AppError('Enter a valid email address, or leave the email field empty', 400);
    }

    const dupStu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [no]);
    if (dupStu.rows.length > 0) {
      return res.status(409).json({
        error: 'This student number is already registered — if that is you, you are all set.',
        code: 'ALREADY_APPLIED',
      });
    }
    const dupApp = await pool.query(
      "SELECT 1 FROM fresher_applications WHERE UPPER(student_no) = $1 AND status = 'pending'",
      [no]
    );
    if (dupApp.rows.length > 0) {
      return res.status(409).json({
        error: 'This student number has already been submitted.',
        code: 'ALREADY_APPLIED',
      });
    }

    const activeYear = await getActiveAcademicYear(pool);
    const year = activeYear.split('/')[0];
    let applicationId;
    try {
      const inserted = await pool.query(
        `INSERT INTO fresher_applications (full_name, student_no, phone, email, programme, gender, hometown, admission_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          name,
          no,
          phoneVal,
          applicantEmail,
          cleanText(programme),
          cleanText(gender),
          cleanText(hometown),
          year,
        ]
      );
      applicationId = inserted.rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'This student number has already been submitted.',
          code: 'ALREADY_APPLIED',
        });
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

    res.status(201).json({
      message: 'Pre-registration received',
      admission_year: year,
      reference: applicationId,
      status: 'pending',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
