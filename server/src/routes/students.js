const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const {
  requireAuth,
  requireAnySchool,
  requireSchoolAdmin,
  requireAnyAdmin,
  requireSuperAdmin,
  isAnySchool,
  isAnyDept,
} = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { emitEvent } = require('../utils/realtime');
const { cleanText } = require('../utils/clean');
const { getActiveAcademicYear } = require('../utils/academicYear');
const { nextReceiptNumber, tagForLines } = require('../utils/receipt');
const { resolveExtraLines, genderMismatch, genderRefusal } = require('../utils/extraDues');
const { normalizeStudentNo, STUDENT_NO_STRICT_RE } = require('../utils/studentNo');
const {
  planExtraDuesReconcile,
  partitionManageableLines,
  applyExtraDuesChange,
  resolveTargetItems,
  extrasScopeForRole,
  pickAttachReceipt,
} = require('../utils/extraDuesEdit');
const { getSouvenirNames } = require('../utils/souvenirs');
const { validateTransfer, describeTransfer } = require('../utils/studentTransfer');
const { sendReceiptEmail } = require('../utils/email');
const { normalizeLevel } = require('../utils/levels');
const { assertMainDues } = require('../utils/duesLimits');

// Audit label for the acting admin.
const actorRole = (user) =>
  user.role === 'super_admin'
    ? 'SUPER_ADMIN'
    : user.role === 'school_admin'
      ? 'SCHOOL_ADMIN'
      : user.role === 'school_staff'
        ? 'SCHOOL_STAFF'
        : user.role === 'dept_staff'
          ? 'DEPT_STAFF'
          : 'DEPT_ADMIN';
const schoolActorRole = (user) =>
  user.role === 'super_admin'
    ? 'SUPER_ADMIN'
    : user.role === 'school_staff'
      ? 'SCHOOL_STAFF'
      : 'SCHOOL_ADMIN';

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

// Payment status is never derived per student row — the students table only
// carries the fresher registration/admission workflow now. Whether somebody
// paid lives in the receipts/payments tables, keyed by the payer's index
// number (free-flow receipts) or the linked student row (fresher receipts).
const STUDENT_SELECT = `
  SELECT s.*, d.name AS department_name,
    (SELECT COUNT(*) FROM receipts r WHERE r.student_id = s.id)::int AS receipt_count,
    CASE s.level
      WHEN '100' THEN 'Level 100'
      WHEN '200' THEN 'Level 200'
      WHEN '300' THEN 'Level 300'
      WHEN '400' THEN 'Level 400'
      ELSE NULL
    END AS level_label
  FROM students s
  LEFT JOIN departments d ON d.id = s.department_id
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

// ─── List students ───
// Default roster: registered freshers — school side sees pending and
// admitted, dept side narrows to own department with ?status=pending|admitted.
// ?type=continuing switches the roster to students (continuing students plus
// admitted freshers — an admitted fresher is a Level 100 student now), and
// ?verification=pending switches to the school-side queue of manually entered
// records awaiting verification.
// ?search= matches the name or index number.
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    // Pending-verification rows stay out of every list until a school admin
    // verifies them (?verification=pending switches to the queue view, which
    // spans freshers and continuing students alike).
    // ?type=continuing flips the roster view to students: continuing students
    // (is_fresher = false — the rows reps and bulk imports create) plus
    // admitted freshers, who join the students list at Level 100;
    // the default stays the fresher roster.
    const pendingView = req.query.verification === 'pending';
    const conds = [];
    if (pendingView) conds.push(`s.verification_status = 'pending'`);
    else {
      conds.push(
        req.query.type === 'continuing'
          ? '(s.is_fresher = false OR s.admitted_at IS NOT NULL)'
          : 's.is_fresher = true'
      );
      conds.push(`s.verification_status = 'verified'`);
    }
    const scope = deptScope(req, params);
    if (scope) conds.push(scope);

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(
        `(s.name ILIKE $${params.length} OR COALESCE(s.student_no,'') ILIKE $${params.length})`
      );
    }
    if (req.query.status === 'pending') conds.push(`s.admitted_at IS NULL`);
    else if (req.query.status === 'admitted') conds.push(`s.admitted_at IS NOT NULL`);

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

// ─── Export fresher registrations as CSV ───
// Same scope + filters as the list endpoint: dept admins get their own
// department, school accounts get every fresher. Must sit above '/:id'
// so 'export' is not mistaken for a student id.
router.get('/export', async (req, res, next) => {
  try {
    const params = [];
    const conds = ['s.is_fresher = true'];
    const scope = deptScope(req, params);
    if (scope) conds.push(scope);

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(
        `(s.name ILIKE $${params.length} OR COALESCE(s.student_no,'') ILIKE $${params.length})`
      );
    }
    if (req.query.status === 'pending') conds.push(`s.admitted_at IS NULL`);
    else if (req.query.status === 'admitted') conds.push(`s.admitted_at IS NOT NULL`);

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT s.name, s.student_no, s.phone, s.email, s.programme, s.gender,
              s.hometown, s.level, s.admission_year, s.admitted_at, s.created_at,
              d.name AS department_name
       FROM students s
       LEFT JOIN departments d ON d.id = s.department_id
       ${where} ORDER BY s.created_at DESC`,
      params
    );

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
    const header =
      'Name,Student No,Phone,Email,Programme,Gender,Hometown,Department,Level,Admission Year,Status,Registered At';
    const lines = rows.map((r) =>
      [
        r.name,
        r.student_no,
        r.phone,
        r.email,
        r.programme,
        r.gender,
        r.hometown,
        r.department_name,
        r.level,
        r.admission_year,
        r.admitted_at ? 'Admitted' : 'Pending',
        fmtDate(r.created_at),
      ]
        .map(esc)
        .join(',')
    );
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="freshers.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── School Admin: verify a manually entered student record ───
// Flips a pending row to verified so it joins the student list. Refuses when
// a verified row already carries the number (the admin resolves that
// collision by hand instead of forking a duplicate identity).
router.post('/:id/verify-record', requireSchoolAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
    if (cur.rows.length === 0) throw new AppError('Student record not found', 404);
    const row = cur.rows[0];
    if (row.verification_status === 'verified') {
      return res.json({ student: row, already: true });
    }
    const dup = await pool.query(
      "SELECT id, name FROM students WHERE UPPER(student_no) = $1 AND verification_status = 'verified' AND id <> $2",
      [
        String(row.student_no || '')
          .trim()
          .toUpperCase(),
        id,
      ]
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        `A verified record already uses this number (${dup.rows[0].name}). Resolve the duplicate before verifying.`,
        409
      );
    }
    const { rows } = await pool.query(
      "UPDATE students SET verification_status = 'verified' WHERE id = $1 RETURNING *",
      [id]
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'student_verify',
      description: `Verified manually entered student ${rows[0].name} (${rows[0].student_no}) into the student list`,
      meta: { student_id: id, student_no: rows[0].student_no },
    });
    res.json({ student: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Add a single continuing student ───
// Body: { department_id, name, student_no, email, level? }
// Manual counterpart to /bulk for one student at a time. Inserted verified
// (admin-supplied data is trusted, same as an import row).
router.post('/', async (req, res, next) => {
  try {
    const { department_id, name, student_no, email, level } = req.body || {};
    const cleanName = String(name ?? '').trim();
    const no = String(student_no ?? '')
      .trim()
      .toUpperCase();
    if (!cleanName || !no) throw new AppError('Name and student number are required', 400);
    if (!department_id) throw new AppError('Choose the department this student belongs to', 400);
    if (
      req.user.role !== 'school_admin' &&
      Number(department_id) !== Number(req.user.department_id)
    ) {
      throw new AppError('You can only add students to your own department', 403);
    }
    const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);
    const cleanEmail = String(email ?? '').trim();
    if (!cleanEmail) throw new AppError('Email is required', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new AppError('Invalid email address', 400);
    }
    if (
      level !== undefined &&
      level !== null &&
      String(level).trim() !== '' &&
      !normalizeLevel(level)
    ) {
      throw new AppError('Level must be 100, 200, 300 or 400', 400);
    }
    // A duplicate number may be a verified roster row OR a pending record
    // awaiting verification — reject both so the queue stays authoritative.
    const dup = await pool.query(
      'SELECT verification_status FROM students WHERE UPPER(student_no) = $1',
      [no]
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        dup.rows[0].verification_status === 'pending'
          ? 'A record with this student number is already awaiting verification'
          : 'This student number is already on the student list',
        409
      );
    }
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO students (name, student_no, is_fresher, level, department_id, email, verification_status, created_by)
         VALUES ($1, $2, false, $3, $4, $5, 'verified', $6)
         RETURNING *`,
        [cleanName, no, normalizeLevel(level) || '100', department_id, cleanEmail, req.user.id]
      ));
    } catch (insErr) {
      // 23505 = unique violation (number registered between the check and insert).
      if (insErr.code === '23505')
        throw new AppError('This student number is already registered', 409);
      throw insErr;
    }
    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'student_add',
      description: `Added student ${no} (${cleanName}) to department ${department_id}`,
      meta: { student_id: rows[0].id, department_id: Number(department_id), student_no: no },
    });
    emitEvent('student:changed', { department_id: rows[0].department_id });
    res.status(201).json({ student: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── School Admin: bulk import the student list ───
// Body: { department_id, rows: [{ name, student_no, email, level? }] }
// department_id is required (dept admins are locked to their own). Rows are
// inserted verified (admin-supplied data is trusted); per-row problems are
// reported, never fatal to the batch.
router.post('/bulk', async (req, res, next) => {
  try {
    const { department_id, rows } = req.body || {};
    if (!department_id) throw new AppError('Choose the department this list belongs to', 400);
    if (
      req.user.role !== 'school_admin' &&
      Number(department_id) !== Number(req.user.department_id)
    ) {
      throw new AppError('You can only import into your own department', 403);
    }
    const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError('No rows to import', 400);
    }
    if (rows.length > 5000) throw new AppError('Import at most 5000 rows at a time', 400);

    const added = [];
    const skipped = [];
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const name = String(r.name ?? '').trim();
      const no = String(r.student_no ?? '')
        .trim()
        .toUpperCase();
      const email = String(r.email ?? '').trim();
      const level = ['100', '200', '300', '400'].includes(String(r.level ?? '').trim())
        ? String(r.level).trim()
        : '100';
      if (!name || !no) {
        errors.push({ row: i + 1, error: 'Name and student number are required.' });
        continue;
      }
      if (!email) {
        errors.push({ row: i + 1, student_no: no, error: 'Email is required.' });
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: i + 1, student_no: no, error: 'Invalid email address.' });
        continue;
      }
      if (seen.has(no)) {
        skipped.push({ row: i + 1, student_no: no, reason: 'Duplicate in file.' });
        continue;
      }
      seen.add(no);
      try {
        const ins = await pool.query(
          `INSERT INTO students (name, student_no, is_fresher, level, department_id, email, verification_status, created_by)
           VALUES ($1, $2, false, $3, $4, $5, 'verified', $6)
           ON CONFLICT DO NOTHING RETURNING *`,
          [name, no, level, department_id, email, req.user.id]
        );
        if (ins.rows.length > 0) added.push(ins.rows[0]);
        else skipped.push({ row: i + 1, student_no: no, reason: 'Already registered.' });
      } catch (err) {
        errors.push({ row: i + 1, student_no: no, error: 'Could not save this row.' });
      }
    }
    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'student_bulk_import',
      description: `Bulk-imported student list into department ${department_id}: ${added.length} added, ${skipped.length} skipped, ${errors.length} errors`,
      meta: { department_id, added: added.length, skipped: skipped.length, errors: errors.length },
    });
    res.status(201).json({ added: added.length, skipped, errors, students: added });
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
//         department_id, admission_year?, level?,
//         payment?: { amount, method, paid_at?, extras?: [{ dues_item_id, amount }] },
//         souvenir_ids?: [] }
// payment.amount is School dues; payment.extras add the fresher's applicable
// additional dues items (school-wide + the department's) to the same receipt.
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
    const normStudentNo = normalizeStudentNo(student_no);
    if (!normStudentNo) throw new AppError('Student number is required', 400);
    // Reference numbers look like UA2309264: "UA" + 7 digits.
    if (!STUDENT_NO_STRICT_RE.test(normStudentNo)) {
      throw new AppError('Enter a valid reference number (e.g. UA2309264)', 400);
    }
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
    const requestedExtras = Array.isArray(payment?.extras) ? payment.extras : [];
    let hasPayment = payment && (Number(payment.amount) > 0 || requestedExtras.length > 0);
    // Resolve additional dues lines — the registration desk collects
    // school-wide items only (a department's own items are collected by that
    // department at admission), snapshotting names for the receipt. Gender-
    // scoped items only charge a matching student.
    const extraLines = await resolveExtraLines(client, {
      department_id,
      extras: requestedExtras,
      scope: 'school',
      gender: clean(gender),
    });
    const extrasTotal = extraLines.reduce((sum, l) => sum + l.amount, 0);
    const schoolAmount = hasPayment ? Number(payment.amount) || 0 : 0;
    // Only the School dues part is capped; extra dues items are not.
    assertMainDues(schoolAmount, 'School dues');
    const receiptTotal = schoolAmount + extrasTotal;
    const paymentLines = [
      ...(schoolAmount > 0 ? [{ type: 'school_dues', amount: schoolAmount }] : []),
      ...extraLines,
    ];
    // Itemized lines for the receipt email (filled when a payment receipt is created).
    let emailLinesForReceipt = [];

    // If souvenirs are given without payment, create a $0 souvenir-only receipt
    if (hasSouvenirs && !hasPayment) {
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, student.id, 'SCH');
      const receipt = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, 0) RETURNING *`,
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
        client,
      });
    }

    if (hasPayment) {
      if (!payment.method || !['cash', 'momo'].includes(payment.method))
        throw new AppError('Valid payment method required (cash, momo)', 400);
      const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAt.getTime()))
        throw new AppError('A valid payment date is required', 400);
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, student.id, tagForLines(paymentLines));
      const receipt = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8) RETURNING *`,
        [
          receiptNumber,
          student.id,
          payment.method,
          paidAt,
          academicYear,
          req.user.id,
          department_id,
          receiptTotal,
        ]
      );
      for (const line of paymentLines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, label, amount, department_id)
             VALUES ($1, $2, $3, $4, $5)`,
          [
            receipt.rows[0].id,
            line.type,
            line.label || null,
            line.amount,
            line.department_id ?? null,
          ]
        );
      }
      receiptForEmail = receipt.rows[0];
      emailLinesForReceipt = paymentLines;

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
      client,
    });
    await client.query('COMMIT');

    emitEvent('fresher:registered', {
      department_id: Number(department_id),
      student_id: student.id,
    });
    // Await the receipt email so the response can report its outcome
    // (email: { sent, mode, to, error? }) instead of failing silently.
    let emailResult = null;
    if (receiptForEmail) {
      // Itemized lines captured at receipt creation (empty for souvenir-only)
      const lines = emailLinesForReceipt;
      const souvenirs = await getSouvenirNames(client, receiptForEmail.id);
      emailResult = await sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber,
        paidAt: receiptForEmail.paid_at,
        method: receiptForEmail.method,
        total: receiptForEmail.total_amount,
        lines,
        souvenirs,
      }).catch((err) => {
        console.error('Receipt email error:', err.message);
        return { sent: false, mode: 'error', to: null, error: err.message };
      });
    }
    res.status(201).json({ ...student, receipt_number: receiptNumber, email: emailResult });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      // Receipt-number clash vs a real student-number duplicate — don't send
      // the desk hunting for a duplicate student that does not exist.
      if (err.table === 'receipts' || err.constraint === 'receipts_receipt_number_key')
        return next(new AppError('Receipt numbering conflict — please try again', 409));
      return next(new AppError('Student number already exists', 409));
    }
    next(err);
  } finally {
    client.release();
  }
});

// ─── Dept Admin: admit a fresher assigned to their department ───
// Body: { payment?: { amount, method, extras?: [{ dues_item_id, amount }] },
//         souvenir_ids?: [] }
// Sets admitted_at/admitted_by; optionally records the department-dues
// collection (plus the department's own dues items, itemized by name) and
// department souvenirs at the same time.
router.post('/:id/admit', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const studentId = Number(req.params.id);
    const { payment, souvenir_ids } = req.body;

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

    // Classes are gone from admission — freshers always enter at Level 100
    // with no class assignment.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admission:${studentId}`]);
    const { rows } = await client.query(
      `UPDATE students SET admitted_at = NOW(), admitted_by = $1, level = '100'
       WHERE id = $2 AND admitted_at IS NULL RETURNING *`,
      [req.user.id, studentId]
    );
    if (rows.length === 0) throw new AppError('This fresher has already been admitted', 409);

    // Optional: department-dues collection (plus the department's own dues
    // items) + department souvenirs. If souvenirs are being given, we MUST
    // have a receipt to attach them to — either a payment receipt exists, or
    // we create a $0 souvenir-only receipt.
    let receiptNumber = null;
    let receiptForEmail = null;
    let hasSouvenirs = Array.isArray(souvenir_ids) && souvenir_ids.length > 0;
    const requestedAdmitExtras = Array.isArray(payment?.extras) ? payment.extras : [];
    const hasDeptPayment =
      Boolean(payment) && (Number(payment.amount) > 0 || requestedAdmitExtras.length > 0);
    // Itemized lines for the receipt email (department dues + labeled extras).
    let admitEmailLines = [];

    if (hasDeptPayment) {
      if (!payment.method || !['cash', 'momo'].includes(payment.method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      const paidAtDate = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAtDate.getTime()))
        throw new AppError('A valid payment date is required', 400);

      // The department's own dues items are collected here — resolved against
      // this department's items only (school-wide items are the School's
      // business at verification). Gender-scoped items only charge a matching
      // student.
      const extraLines = await resolveExtraLines(client, {
        department_id: student.department_id,
        extras: requestedAdmitExtras,
        scope: 'department',
        gender: student.gender,
      });
      // Never charge the same named item twice to one student.
      if (extraLines.length > 0) {
        const { rows: already } = await client.query(
          `SELECT DISTINCT p.label FROM payments p
             JOIN receipts r ON r.id = p.receipt_id
            WHERE r.student_id = $1 AND r.voided_at IS NULL AND p.voided_at IS NULL
              AND p.type = 'extra_dues' AND p.label = ANY($2::text[])`,
          [studentId, extraLines.map((l) => l.label)]
        );
        if (already.length > 0) {
          throw new AppError(
            `Already charged to this student: ${already
              .map((r) => r.label)
              .join(', ')} — untick and try again`,
            400
          );
        }
      }
      const extrasTotal = extraLines.reduce((sum, l) => sum + l.amount, 0);
      const deptDuesAmount = Number(payment.amount) || 0;
      // Only the Department dues part is capped; extra dues items are not.
      assertMainDues(deptDuesAmount, 'Department dues');
      const receiptTotal = deptDuesAmount + extrasTotal;
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, studentId, 'DEPT');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8) RETURNING *`,
        [
          receipt_number,
          studentId,
          payment.method,
          paidAtDate,
          academicYear,
          req.user.id,
          student.department_id,
          receiptTotal,
        ]
      );
      admitEmailLines = [
        ...(deptDuesAmount > 0 ? [{ type: 'department_dues', amount: deptDuesAmount }] : []),
        ...extraLines.map((l) => ({ type: l.type, label: l.label, amount: l.amount })),
      ];
      for (const line of admitEmailLines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, label, amount, department_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [rc.rows[0].id, line.type, line.label ?? null, line.amount, student.department_id]
        );
      }
      receiptNumber = receipt_number;
      receiptForEmail = rc.rows[0];

      await logTransaction({
        admin_id: req.user.id,
        admin_role: actorRole,
        transaction_type: 'payment',
        description: `Recorded Department Dues of GHS ${deptDuesAmount.toFixed(2)}${
          extrasTotal > 0 ? ` + GHS ${extrasTotal.toFixed(2)} in additional dues` : ''
        } for ${student.name} (${receipt_number})`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: studentId,
          receipt_number,
          type: 'department_dues',
          ...(extrasTotal > 0 ? { extras: extraLines } : {}),
        },
        client,
      });
    } else if (hasSouvenirs) {
      // No payment, but souvenirs are being given — create a $0 souvenir-only receipt
      const academicYear = await getActiveAcademicYear(client);
      receiptNumber = await nextReceiptNumber(client, studentId, 'DEPT');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, 0) RETURNING *`,
        [receiptNumber, studentId, new Date(), academicYear, req.user.id, student.department_id]
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
        client,
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
      meta: { student_id: studentId, receipt_number: receiptNumber },
      client,
    });
    await client.query('COMMIT');

    emitEvent('fresher:admitted', { department_id: student.department_id, student_id: studentId });
    let email = null;
    if (receiptNumber && receiptForEmail) {
      const hasPaymentAmount = Number(receiptForEmail.total_amount) > 0;
      if (hasPaymentAmount) {
        emitEvent('payment:new', {
          department_id: student.department_id,
          student_id: studentId,
          receipt_number: receiptNumber,
          total: Number(receiptForEmail.total_amount),
          source: 'admit',
        });
      }
      const souvenirs = await getSouvenirNames(client, receiptForEmail.id);
      // Await the receipt email so the response reports its outcome
      // (email: { sent, mode, to, error? }) instead of failing silently.
      email = await sendReceiptEmail({
        to: student.email || undefined,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber,
        paidAt: receiptForEmail.paid_at,
        method: receiptForEmail.method,
        total: receiptForEmail.total_amount,
        lines: hasPaymentAmount ? admitEmailLines : [],
        souvenirs,
      }).catch((err) => {
        console.error('Receipt email error:', err.message);
        return { sent: false, mode: 'error', to: null, error: err.message };
      });
    }
    res.json({ ...rows[0], receipt_number: receiptNumber, email });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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
              r.method, r.record_type, r.total_amount, p.type, p.label, p.amount
       FROM receipts r
       JOIN payments p ON p.receipt_id = r.id
       WHERE (r.student_id = $1
              OR (r.student_id IS NULL
                  AND UPPER(r.student_no) = (SELECT UPPER(student_no) FROM students WHERE id = $1)))
         AND r.voided_at IS NULL AND p.voided_at IS NULL
       ORDER BY r.paid_at DESC, p.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Toggle "Other Dues" items for a student (checkbox model) ───
// A student's Other Dues can span several receipts (registration + admission).
// This reconciles the union of their ACTIVE extra lines: unchecking voids the
// line on whichever receipt holds it; checking a new item attaches it to the
// receipt OF ITS OWN SCOPE — school-wide items to the school-dues receipt,
// department items to the department-dues receipt (never a $0 souvenir-only
// receipt; there must be a home to attach to). Same audit-first rules as the
// receipt-level toggle — amounts of already-charged lines are never mutated in
// place, and a reason is required.
// Body: { items: [{ dues_item_id, amount? }], reason }
router.put('/:id/extra-dues', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const allowedDeptId = extrasScopeForRole(req.user);
    if (allowedDeptId === 'none') {
      throw new AppError('Only admin and staff accounts can edit Other Dues', 403);
    }
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) throw new AppError('Provide a reason for this change', 400);

    const stuRes = await client.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (stuRes.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stuRes.rows[0];
    if (isAnyDept(req.user) && student.department_id !== req.user.department_id) {
      throw new AppError('You can only edit students in your department', 403);
    }

    const targets = await resolveTargetItems(client, req.body.items, { allowedDeptId });

    // The student's active receipts (student-linked, or free-flow matched by
    // index number), newest first — used both to gather active lines and to
    // pick where a newly-checked item is attached.
    const { rows: receipts } = await client.query(
      `SELECT r.* FROM receipts r
       WHERE (r.student_id = $1
              OR (r.student_id IS NULL
                  AND UPPER(r.student_no) = (SELECT UPPER(student_no) FROM students WHERE id = $1)))
         AND r.voided_at IS NULL
       ORDER BY r.paid_at DESC, r.id DESC`,
      [student.id]
    );
    const activeReceiptIds = receipts.map((r) => r.id);
    const allActiveLines =
      activeReceiptIds.length === 0
        ? []
        : (
            await client.query(
              `SELECT id, receipt_id, label FROM payments
               WHERE receipt_id = ANY($1::int[]) AND type = 'extra_dues' AND voided_at IS NULL`,
              [activeReceiptIds]
            )
          ).rows;

    // Lines whose label matches no active toggleable item for this actor (a
    // renamed/deactivated item, or an item outside the actor's money-scope)
    // can't be shown as a checkbox — they are preserved untouched, never voided
    // by this save.
    const { rows: toggleable } = await client.query(
      allowedDeptId === 'any'
        ? 'SELECT name FROM dues_items WHERE active'
        : allowedDeptId === null
          ? 'SELECT name FROM dues_items WHERE active AND department_id IS NULL'
          : 'SELECT name FROM dues_items WHERE active AND department_id = $1',
      allowedDeptId === 'any' || allowedDeptId === null ? [] : [allowedDeptId]
    );
    const { candidates, skipped } = partitionManageableLines(
      allActiveLines,
      toggleable.map((t) => t.name)
    );

    const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(candidates, targets);
    const skippedLabels = skipped.map((l) => l.label);

    // Gender-scoped items may not be NEWLY charged to a mismatched student.
    // Already-charged lines stay manageable so a wrong charge can always be
    // unchecked — the guard never locks the correction path.
    for (const item of toAdd) {
      if (genderMismatch(item.gender, student.gender)) {
        throw genderRefusal(item, student.gender);
      }
    }

    // Each newly-checked item needs a home receipt — and it must be the RIGHT
    // one: school-wide items attach to the receipt carrying the school dues,
    // department items to the receipt carrying the department dues (each
    // newest-first, any active line as fallback — see pickAttachReceipt).
    // Picking the student's most recent receipt blindly would merge school
    // items into the department admission receipt (or a $0 souvenir receipt),
    // leaving the real receipt with its old items and amount.
    let additions = [];
    if (toAdd.length > 0) {
      const { rows: duesLineReceipts } =
        activeReceiptIds.length > 0
          ? await client.query(
              `SELECT DISTINCT receipt_id, type FROM payments
               WHERE receipt_id = ANY($1::int[]) AND voided_at IS NULL
                 AND type IN ('school_dues', 'department_dues')`,
              [activeReceiptIds]
            )
          : { rows: [] };
      const { rows: anyLineReceipts } =
        activeReceiptIds.length > 0
          ? await client.query(
              `SELECT DISTINCT receipt_id FROM payments
               WHERE receipt_id = ANY($1::int[]) AND voided_at IS NULL`,
              [activeReceiptIds]
            )
          : { rows: [] };
      const schoolDuesIds = duesLineReceipts
        .filter((r) => r.type === 'school_dues')
        .map((r) => r.receipt_id);
      const deptDuesIds = duesLineReceipts
        .filter((r) => r.type === 'department_dues')
        .map((r) => r.receipt_id);
      const anyLineIds = anyLineReceipts.map((r) => r.receipt_id);

      const schoolItems = toAdd.filter((i) => i.department_id == null);
      const deptItems = toAdd.filter((i) => i.department_id != null);
      const homeFor = (items, preferredIds) => {
        if (items.length === 0) return;
        const home = pickAttachReceipt(receipts, preferredIds, anyLineIds);
        if (!home) {
          throw new AppError(
            'This student has no payment receipt to attach new Other Dues to — record a payment first.',
            400
          );
        }
        const existing = additions.find((b) => Number(b.receipt.id) === Number(home.id));
        if (existing) existing.items.push(...items);
        else additions.push({ receipt: home, items });
      };
      homeFor(schoolItems, schoolDuesIds);
      homeFor(deptItems, deptDuesIds);
    }

    if (toVoid.length === 0 && toAdd.length === 0) {
      return res.json({
        message: 'No changes to Other Dues.',
        added: 0,
        removed: 0,
        unchanged,
        skipped: skippedLabels,
      });
    }

    await client.query('BEGIN');
    const result = await applyExtraDuesChange(client, {
      toVoid,
      additions,
      reason: `Other Dues edited: ${reason}`,
      userId: req.user.id,
    });
    await client.query('COMMIT');

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'other_dues_edit',
      description:
        `Edited Other Dues for ${student.name} (${student.student_no || 'no number'}): ` +
        `${toAdd.length} added, ${toVoid.length} removed (${reason})`,
      meta: {
        student_id: student.id,
        student_name: student.name,
        student_no: student.student_no,
        added: toAdd.map((i) => ({ name: i.name, amount: i.amount })),
        removed: toVoid.map((l) => ({ label: l.label })),
        unchanged,
        skipped: skippedLabels,
        reason,
        affected_receipt_ids: result.affectedReceiptIds,
      },
    });
    for (const rid of result.affectedReceiptIds) {
      emitEvent('payment:new', {
        department_id: student.department_id,
        student_id: student.id,
        total: result.totals[rid],
        source: 'admin',
      });
    }

    res.json({
      message: 'Other Dues updated.',
      added: toAdd.length,
      removed: toVoid.length,
      unchanged,
      skipped: skippedLabels,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
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
    const tag = schoolIds.length && deptIds.length ? 'FULL' : deptIds.length ? 'DEPT' : 'SCH';

    const academicYear = await getActiveAcademicYear(client);
    const receiptNumber = await nextReceiptNumber(client, studentId, tag);
    const rc = await client.query(
      `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
           VALUES ($1, $2, 'cash', NOW(), $3, 'admin', $4, $5, 0) RETURNING *`,
      [receiptNumber, studentId, academicYear, req.user.id, student.department_id]
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
      client,
    });
    await client.query('COMMIT');
    emitEvent('student:changed', { department_id: student.department_id });
    res.json({
      message: 'Souvenirs recorded',
      added: toGive.length,
      receipt_number: receiptNumber,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      // This transaction also mints a $0 souvenir receipt — a receipt-number
      // clash must not masquerade as "souvenir already given".
      if (err.table === 'receipts' || err.constraint === 'receipts_receipt_number_key')
        return next(new AppError('Receipt numbering conflict — please try again', 409));
      return next(
        new AppError('One or more of those souvenirs were already given to this student', 409)
      );
    }
    next(err);
  } finally {
    client.release();
  }
});

// ─── Update fresher profile (School side only) ───
router.put('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'dept_staff') {
      throw new AppError('Staff accounts cannot edit students', 403);
    }
    const {
      name,
      student_no,
      department_id,
      admission_year,
      phone,
      email,
      programme,
      gender,
      hometown,
      level,
    } = req.body;

    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    const isSchool = isAnySchool(req.user);
    if (isSchool && student.is_fresher && student.admitted_at) {
      if (department_id !== undefined && Number(department_id) !== student.department_id) {
        throw new AppError(
          'An admitted fresher cannot be moved via edit. Re-admit them into the right department instead.',
          409
        );
      }
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
    // Fresher registrations belong to the School — Dept Admins manage
    // admission through the admit flow instead of profile edits.
    if (isAnyDept(req.user)) {
      throw new AppError('Only the School can edit student profiles', 403);
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
    // Department moves for CONTINUING students go through the transfer endpoint
    // (audited, reason required). A fresh, not-yet-admitted fresher is the one
    // exception: assigning them a department via profile edit is how the desk
    // corrects a wrong pick before the department admits them. Never silently
    // null the stored department — an absent key leaves it untouched.
    if (
      !student.is_fresher &&
      has(department_id) &&
      Number(department_id) !== Number(student.department_id)
    ) {
      throw new AppError('Use the Transfer action to move a student between departments', 400);
    }
    put(
      'department_id',
      ['school_admin', 'super_admin'].includes(req.user.role) && has(department_id)
        ? department_id
        : undefined
    );
    put('admission_year', has(admission_year) ? admission_year || null : undefined);
    if (has(level)) {
      const normLevel = normalizeLevel(level);
      if (!normLevel) throw new AppError('Select a valid level (100, 200, 300 or 400)', 400);
      sets.push(`level = $${vals.length + 1}`);
      vals.push(normLevel);
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

// ─── Transfer a student to another department (School Admin / Super Admin) ───
// The single, audited path for moving a student between departments. It moves
// roster membership ONLY: receipts, payment lines and souvenirs stay exactly
// where they were collected, so the department that took the money keeps the
// money in its reports (the established "history never mutates" rule).
//
// Admitted freshers CAN be transferred here — that is the gap the edit path
// deliberately refuses (its 409 says "re-admit them instead", but no re-admit
// flow exists). A transfer keeps the admission stamp intact and records the
// move; it never silently resets it.
//
// A reason is required: this is exactly the kind of move someone audits later.
router.post('/:id/transfer', requireSchoolAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const studentId = Number(req.params.id);
    const { to_department_id, reason } = req.body;

    const stu = await pool.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    const targetId = Number(to_department_id);
    const deptRes = Number.isInteger(targetId)
      ? await pool.query('SELECT id, name FROM departments WHERE id = $1', [targetId])
      : { rows: [] };

    const plan = validateTransfer({
      student,
      department: deptRes.rows[0] || null,
      toDepartmentId: to_department_id,
      reason,
    });
    const toName = deptRes.rows[0].name;

    const fromName = student.department_id
      ? (await pool.query('SELECT name FROM departments WHERE id = $1', [student.department_id]))
          .rows[0]?.name || null
      : null;

    // Advisory lock keyed to the student, mirroring the admit route, so two
    // admins cannot transfer the same student at once.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `student-transfer:${studentId}`,
    ]);

    const { rows } = await client.query(
      `UPDATE students SET department_id = $1
        WHERE id = $2 AND department_id IS DISTINCT FROM $1
        RETURNING *`,
      [plan.toDepartmentId, studentId]
    );
    if (rows.length === 0) {
      // Someone else moved them between our read and our write.
      throw new AppError('This student was just moved — reload and try again', 409);
    }

    await logTransaction({
      client,
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'student_transfer',
      description: describeTransfer({
        studentName: rows[0].name,
        fromName,
        toName,
        admittedFresher: plan.admittedFresher,
      }),
      meta: {
        student_id: studentId,
        from_department_id: plan.fromDepartmentId,
        to_department_id: plan.toDepartmentId,
        reason: plan.reason,
        admitted_fresher: plan.admittedFresher,
      },
    });

    await client.query('COMMIT');

    // Both departments' dashboards refresh: the one that lost a student and
    // the one that gained one.
    if (plan.fromDepartmentId) {
      emitEvent('student:changed', { department_id: plan.fromDepartmentId });
    }
    emitEvent('student:changed', { department_id: plan.toDepartmentId });

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Shared guard for the resend preview + send: every admin and staff role may
// resend within its scope — school-side roles (school_admin / school_staff /
// super_admin) for any student, department-side roles (dept_admin /
// dept_staff) only for their own department's students.
function assertResendAllowed(user, student) {
  if (user.role === 'dept_admin' || user.role === 'dept_staff') {
    if (Number(student.department_id) !== Number(user.department_id)) {
      throw new AppError('You can only resend receipt emails for your own department', 403);
    }
  }
}

// ─── Resend preview: what would be sent, and where ───
// Backs the confirmation modal — the address on file plus every live receipt
// with its itemized payment lines and souvenirs, so the admin reviews the
// exact payment records and the recipient before anything is sent.
// Read-only: nothing is dispatched and no audit entry is written.
router.get('/:id/resend-preview', async (req, res, next) => {
  try {
    const stu = await pool.query(
      'SELECT id, name, student_no, email, department_id FROM students WHERE id = $1',
      [req.params.id]
    );
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];
    assertResendAllowed(req.user, student);

    const { rows: receipts } = await pool.query(
      `SELECT id, receipt_number, paid_at, method, total_amount
         FROM receipts WHERE student_id = $1 AND voided_at IS NULL ORDER BY id`,
      [req.params.id]
    );

    const detailed = [];
    for (const receipt of receipts) {
      const payRes = await pool.query(
        'SELECT type, label, amount FROM payments WHERE receipt_id = $1 AND voided_at IS NULL ORDER BY id',
        [receipt.id]
      );
      detailed.push({
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        paid_at: receipt.paid_at,
        method: receipt.method,
        total_amount: Number(receipt.total_amount),
        lines: payRes.rows.map((p) => ({
          type: p.type,
          label: p.label || null,
          amount: Number(p.amount),
        })),
        souvenirs: await getSouvenirNames(pool, receipt.id),
      });
    }

    const email = (student.email || '').trim();
    res.json({
      student: { id: student.id, name: student.name, student_no: student.student_no, email },
      can_send: Boolean(email) && detailed.length > 0,
      receipts: detailed,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Resend every live receipt email for a student ───
// The fix-up path for "verified/admitted with the wrong email": once the
// record's address has been corrected, push the receipt email(s) again to
// the address now on file. School-side roles (school admin / school staff /
// super admin) may resend for any student; department-side roles (dept
// admin / dept staff) only for their own department. Voided receipts are
// skipped — they already triggered a reversal notice at void time.
router.post('/:id/resend-receipt-emails', async (req, res, next) => {
  try {
    const stu = await pool.query(
      'SELECT id, name, student_no, email, department_id FROM students WHERE id = $1',
      [req.params.id]
    );
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];
    assertResendAllowed(req.user, student);

    const to = (student.email || '').trim();
    if (!to) {
      throw new AppError('No email address on file for this student — edit the record first', 400);
    }

    const { rows: receipts } = await pool.query(
      `SELECT id, receipt_number, total_amount, method, paid_at
         FROM receipts WHERE student_id = $1 AND voided_at IS NULL ORDER BY id`,
      [req.params.id]
    );
    if (receipts.length === 0) {
      throw new AppError('This student has no receipt emails to resend', 400);
    }

    const results = [];
    for (const receipt of receipts) {
      const payRes = await pool.query(
        'SELECT type, label, amount FROM payments WHERE receipt_id = $1 AND voided_at IS NULL ORDER BY id',
        [receipt.id]
      );
      const lines = payRes.rows.map((p) => ({
        type: p.type,
        label: p.label || null,
        amount: Number(p.amount),
      }));
      const souvenirs = await getSouvenirNames(pool, receipt.id);

      // Bounded wait (same pattern as the verify flow) so one hung SMTP
      // server cannot stall the whole request past the proxy timeout.
      const EMAIL_WAIT_MS = 15000;
      const sendPromise = sendReceiptEmail({
        to,
        studentName: student.name,
        studentNo: student.student_no,
        receiptNumber: receipt.receipt_number,
        paidAt: receipt.paid_at,
        method: receipt.method,
        total: Number(receipt.total_amount),
        lines,
        souvenirs,
      });
      const emailResult = await Promise.race([
        sendPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), EMAIL_WAIT_MS)),
      ]);
      const outcome = emailResult || {
        sent: false,
        mode: 'error',
        to,
        error: 'Email send timed out',
      };

      await logTransaction({
        admin_id: req.user.id,
        admin_role: actorRole(req.user),
        transaction_type: 'receipt_resend',
        description: `Re-sent receipt ${receipt.receipt_number} to ${outcome.to || to}`,
        meta: {
          student_id: student.id,
          receipt_id: receipt.id,
          receipt_number: receipt.receipt_number,
          to: outcome.to || to,
          sent: Boolean(outcome.sent),
        },
      });

      results.push({
        receipt_number: receipt.receipt_number,
        sent: Boolean(outcome.sent),
        mode: outcome.mode,
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    }

    const sent = results.filter((r) => r.sent).length;
    res.json({
      to,
      total: results.length,
      sent,
      failed: results.length - sent,
      results,
      message: `${sent}/${results.length} receipt email(s) resent to ${to}`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Delete a fresher registration ───
// School Admin only, and only before admission: admitted freshers and anyone
// with payment history stay on record. The guards and the DELETE run inside
// one transaction with the student row locked (SELECT ... FOR UPDATE): a
// receipt created concurrently would need a key-share lock on this row and
// wait, so it can no longer slip in between the check and the delete and get
// cascade-destroyed (receipts.student_id is ON DELETE CASCADE).
router.delete('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stu = await client.query('SELECT * FROM students WHERE id = $1 FOR UPDATE', [
      req.params.id,
    ]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    if (student.admitted_at) throw new AppError('Admitted freshers cannot be deleted.', 409);
    const receiptCheck = await client.query(
      'SELECT 1 FROM receipts WHERE student_id = $1 LIMIT 1',
      [req.params.id]
    );
    // Anyone with payment history stays on record — their receipts point at
    // them. Wording is role-neutral: this endpoint serves the freshers page
    // and the continuing-students roster alike.
    if (receiptCheck.rows.length > 0)
      throw new AppError('A student with payment history cannot be deleted.', 409);

    if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
      throw new AppError('Only the main School Admin can delete students', 403);
    }
    if (isAnyDept(req.user)) {
      throw new AppError('Only the School Admin can delete students', 403);
    }

    const { rows } = await client.query('DELETE FROM students WHERE id = $1 RETURNING id, name', [
      req.params.id,
    ]);
    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'student_delete',
      description: `Deleted student "${rows[0].name}"`,
      meta: { student_id: rows[0].id },
      client,
    });
    await client.query('COMMIT');

    emitEvent('student:changed', { department_id: student.department_id });
    res.json({ message: 'Student deleted' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── Super admin force-delete (guarded duplicate/test cleanup) ───
// Removes a student row AND its receipts/payments/souvenir links in one
// transaction. Requires a reason (audited as SUPER_ADMIN). The receipt
// sequence counter is per index number, so deleting frees nothing — a later
// re-registration continues the numbering, never reuses it.
router.delete('/:id/force', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const reason = cleanText(req.body?.reason);
    if (!reason) throw new AppError('A reason is required to force-delete a student', 400);

    await client.query('BEGIN');
    const stu = await client.query('SELECT * FROM students WHERE id = $1 FOR UPDATE', [
      req.params.id,
    ]);
    if (stu.rows.length === 0) throw new AppError('Student not found', 404);
    const student = stu.rows[0];

    const rc = await client.query('SELECT id, receipt_number FROM receipts WHERE student_id = $1', [
      req.params.id,
    ]);
    const receiptIds = rc.rows.map((r) => r.id);
    if (receiptIds.length > 0) {
      await client.query('DELETE FROM student_souvenirs WHERE receipt_id = ANY($1::int[])', [
        receiptIds,
      ]);
      await client.query('DELETE FROM payments WHERE receipt_id = ANY($1::int[])', [receiptIds]);
      await client.query('DELETE FROM receipts WHERE id = ANY($1::int[])', [receiptIds]);
    }
    await client.query('DELETE FROM student_souvenirs WHERE student_id = $1', [req.params.id]);
    await client.query('DELETE FROM students WHERE id = $1', [req.params.id]);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SUPER_ADMIN',
      transaction_type: 'student_force_delete',
      description: `Force-deleted student "${student.name}" (${student.student_no || 'no number'}) with ${receiptIds.length} receipt(s): ${reason}`,
      meta: {
        student_id: student.id,
        student_no: student.student_no,
        receipt_count: receiptIds.length,
        receipt_numbers: rc.rows.map((r) => r.receipt_number),
        reason,
      },
      client,
    });
    await client.query('COMMIT');

    emitEvent('student:changed', { department_id: student.department_id });
    res.json({
      message: 'Student and linked receipts deleted',
      receipts_removed: receiptIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
