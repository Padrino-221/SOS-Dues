const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { nextReceiptNumber, tagForLines } = require('../utils/receipt');
const { getSouvenirNames } = require('../utils/souvenirs');
const { requireAuth, requireAnyAdmin, isAnyDept } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { getActiveAcademicYear, normalizeAcademicYear } = require('../utils/academicYear');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

// Audit label for the acting school-side user.
const actorRole = (user) =>
  user.role === 'school_admin' ? 'SCHOOL_ADMIN' : user.role === 'school_staff' ? 'SCHOOL_STAFF' : 'DEPT_ADMIN';

const RECEIPT_SELECT = `
  SELECT r.*, s.name AS student_name, s.student_no, s.is_fresher,
         d.name AS department_name, c.name AS class_name
  FROM receipts r
  JOIN students s ON s.id = r.student_id
  LEFT JOIN departments d ON d.id = r.department_id
  LEFT JOIN classes c ON c.id = r.class_id
`;

// ─── Admin collection: create a receipt with one or two itemized lines ───
// Body: { student_id, method, paid_at?, items: [{ type, amount }], souvenir_ids? }
//
// RBAC:
//   School Admin → may only record school_dues lines (fresher registration).
//   Dept Admin   → student must be in their department; department_dues always
//                  allowed; school_dues only together with department_dues
//                  (the combined continuing-student collection).
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (['dept_staff', 'school_staff'].includes(req.user.role)) {
      throw new AppError('Staff accounts cannot record payments', 403);
    }
    const { student_id, method, paid_at, items, souvenir_ids, academic_year } = req.body;
    if (!student_id) throw new AppError('Student is required', 400);
    if (!method || !['cash', 'momo'].includes(method)) {
      throw new AppError('Valid payment method required (cash, momo)', 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('At least one payment line is required', 400);
    }

    // Normalize lines: at most one school_dues and one department_dues line
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
      if (lines.find((l) => l.type === type)) {
        throw new AppError(`Duplicate ${type} line`, 400);
      }
      lines.push({ type, amount });
    }

    const studentRes = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (studentRes.rows.length === 0) throw new AppError('Student not found', 404);
    const student = studentRes.rows[0];
    const paidAtDate = paid_at ? new Date(paid_at) : new Date();
    if (Number.isNaN(paidAtDate.getTime()))
      throw new AppError('A valid payment date is required', 400);
    const academicYear =
      normalizeAcademicYear(academic_year) || (await getActiveAcademicYear(pool));

    // ── RBAC ──
    const hasSchool = lines.some((l) => l.type === 'school_dues');
    const hasDept = lines.some((l) => l.type === 'department_dues');

    if (['school_admin', 'school_staff'].includes(req.user.role)) {
      // School side records school dues only (fresher registration / top-ups)
      if (hasDept) throw new AppError('School accounts cannot record Department Dues', 403);
    } else {
      // Dept admin: student must belong to their department
      if (student.department_id !== req.user.department_id) {
        throw new AppError('You can only collect from students in your department', 403);
      }
      if (hasDept && student.is_fresher && !student.admitted_at) {
        throw new AppError(
          'Admit the fresher first — Department Dues are recorded at admission',
          400
        );
      }
      if (hasSchool && !hasDept) {
        throw new AppError(
          'Department Admins can only record School Dues together with Department Dues (combined collection)',
          403
        );
      }
    }

    // Serialize concurrent collections for the same student/year/type. Multiple
    // partial (installment) payments per dues type are allowed, so there is no
    // duplicate guard — balances are derived from the sum of payments.
    await client.query('BEGIN');
    for (const line of lines) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payment:${student.id}:${academicYear}:${line.type}`,
      ]);
    }

    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    const deptId = ['school_admin', 'school_staff'].includes(req.user.role)
      ? student.department_id
      : req.user.department_id;

    const receipt_number = await nextReceiptNumber(client, student_id, tagForLines(lines));
    const rc = await client.query(
      `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8, $9) RETURNING *`,
      [
        receipt_number,
        student_id,
        method,
        paidAtDate,
        academicYear,
        req.user.id,
        deptId,
        student.class_id,
        total,
      ]
    );
    const receipt = rc.rows[0];

    for (const line of lines) {
      await client.query(
        `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          receipt.id,
          line.type,
          line.amount,
          line.type === 'department_dues' ? deptId : null,
          line.type === 'department_dues' ? student.class_id : null,
        ]
      );
    }

    // Optional souvenirs: with a school_dues line → school level,
    // with a department_dues line → department level (must belong to the
    // student's department).
    if (Array.isArray(souvenir_ids) && souvenir_ids.length > 0) {
      const level = hasSchool && !hasDept ? 'school' : hasDept && !hasSchool ? 'department' : null;
      if (level) {
        const params = [
          student_id,
          receipt.id,
          level,
          req.user.id,
          souvenir_ids,
          level === 'school' ? 'school' : 'department',
        ];
        let scope = '';
        if (level === 'department') {
          params.push(student.department_id);
          scope = ` AND department_id = $${params.length}`;
        }
        await client.query(
          `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           SELECT $1, id, $2, $3, $4 FROM souvenirs
           WHERE id = ANY($5::int[]) AND category = $6${scope}`,
          params
        );
      }
    }

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'payment',
      description: `Recorded ${lines.map((l) => `${l.type} GHS ${l.amount.toFixed(2)}`).join(' + ')} for ${student.name} (${receipt_number})`,
      meta: {
        receipt_id: receipt.id,
        student_id,
        receipt_number,
        lines,
        method,
        department_id: deptId,
      },
    });
    await client.query('COMMIT');

    emitEvent('payment:new', {
      department_id: student.department_id,
      class_id: student.class_id,
      student_id,
      receipt_number,
      total,
        source: ['school_admin', 'school_staff'].includes(req.user.role) ? 'school' : 'admin',
    });

    // Email receipt (logs in dev mode when no SMTP configured)
    const souvenirs = await getSouvenirNames(client, receipt.id);
    sendReceiptEmail({
      to: student.email || undefined,
      studentName: student.name,
      studentNo: student.student_no,
      receiptNumber: receipt_number,
      paidAt: receipt.paid_at,
      method,
      total,
      lines,
      souvenirs,
    }).catch((err) => console.error('Receipt email error:', err.message));

    res.status(201).json({ ...receipt, lines });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Void a receipt instead of deleting it, preserving the original financial and
// audit record while allowing the affected dues type to be collected again.
router.post('/:id/void', async (req, res, next) => {
  try {
    if (!['school_admin', 'dept_admin'].includes(req.user.role)) {
      throw new AppError('Only School or Department Admins can void receipts', 403);
    }
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) throw new AppError('Provide a reason for voiding this receipt', 400);

    const receiptRes = await pool.query(
      `SELECT r.*, s.name AS student_name
       FROM receipts r JOIN students s ON s.id = r.student_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (receiptRes.rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = receiptRes.rows[0];
    if (req.user.role === 'dept_admin' && receipt.department_id !== req.user.department_id) {
      throw new AppError('You can only void receipts from your department', 403);
    }
    if (receipt.voided_at) throw new AppError('This receipt has already been voided', 409);

    const { rows } = await pool.query(
      `UPDATE receipts
       SET voided_at = NOW(), voided_by = $1, void_reason = $2
       WHERE id = $3 AND voided_at IS NULL
       RETURNING *`,
      [req.user.id, reason, receipt.id]
    );
    if (rows.length === 0) throw new AppError('This receipt has already been voided', 409);

    // Also void all payment lines on this receipt
    await pool.query(
      `UPDATE payments SET voided_at = NOW(), voided_by = $1, void_reason = $2
       WHERE receipt_id = $3 AND voided_at IS NULL`,
      [req.user.id, `Receipt voided: ${reason}`, receipt.id]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'receipt_void',
      description: `Voided receipt ${receipt.receipt_number} for ${receipt.student_name}: ${reason}`,
      meta: { receipt_id: receipt.id, receipt_number: receipt.receipt_number, reason },
    });
    emitEvent('payment:voided', {
      department_id: receipt.department_id,
      student_id: receipt.student_id,
      receipt_number: receipt.receipt_number,
    });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Void an individual payment line within a receipt ───
// Allows correcting a single payment line (e.g., wrong amount or method)
// without voiding the entire receipt. The line is marked as voided with
// an audit trail, and the affected dues type can be collected again.
// Body: { payment_id, reason }
router.post('/:id/void-payment', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!['school_admin', 'dept_admin'].includes(req.user.role)) {
      throw new AppError('Only School or Department Admins can void payment lines', 403);
    }
    const { payment_id, reason } = req.body;
    if (!payment_id) throw new AppError('Payment ID is required', 400);
    const reasonStr = String(reason || '').trim();
    if (reasonStr.length < 3) throw new AppError('Provide a reason for voiding this payment', 400);

    // Get the receipt and payment
    const receiptRes = await client.query(
      `SELECT r.*, s.name AS student_name
       FROM receipts r JOIN students s ON s.id = r.student_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (receiptRes.rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = receiptRes.rows[0];

    if (req.user.role === 'dept_admin' && receipt.department_id !== req.user.department_id) {
      throw new AppError('You can only void payments from your department', 403);
    }
    if (receipt.voided_at) throw new AppError('Cannot void a payment on an already-voided receipt', 409);

    // Get the payment line
    const payRes = await client.query(
      `SELECT p.*
       FROM payments p
       WHERE p.id = $1 AND p.receipt_id = $2`,
      [payment_id, receipt.id]
    );
    if (payRes.rows.length === 0) throw new AppError('Payment line not found', 404);
    const payment = payRes.rows[0];
    if (payment.voided_at) throw new AppError('This payment line has already been voided', 409);

    await client.query('BEGIN');
    // Void the payment line
    const { rows } = await client.query(
      `UPDATE payments
       SET voided_at = NOW(), voided_by = $1, void_reason = $2
       WHERE id = $3 AND voided_at IS NULL
       RETURNING *`,
      [req.user.id, reasonStr, payment.id]
    );
    if (rows.length === 0) throw new AppError('This payment line has already been voided', 409);

    // Recompute the receipt total from its remaining (non-voided) lines so the
    // receipt header always matches the sum shown on the verify page.
    const totalRes = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE receipt_id = $1 AND voided_at IS NULL',
      [receipt.id]
    );
    const newTotal = Number(totalRes.rows[0].total);
    await client.query('UPDATE receipts SET total_amount = $1 WHERE id = $2', [newTotal, receipt.id]);
    await client.query('COMMIT');

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'payment_void',
      description: `Voided payment line ${payment.type} (GHS ${Number(payment.amount).toFixed(2)}) from receipt ${receipt.receipt_number} for ${receipt.student_name}: ${reasonStr}`,
      meta: {
        receipt_id: receipt.id,
        payment_id: payment.id,
        receipt_number: receipt.receipt_number,
        payment_type: payment.type,
        amount: Number(payment.amount),
        reason: reasonStr,
        new_total: newTotal,
      },
    });
    emitEvent('payment:voided', {
      department_id: receipt.department_id,
      student_id: receipt.student_id,
      receipt_number: receipt.receipt_number,
      payment_id: payment.id,
      payment_type: payment.type,
    });
    res.json({
      message: `Payment line voided successfully`,
      receipt_number: receipt.receipt_number,
      total_amount: newTotal,
      payment: {
        id: payment.id,
        type: payment.type,
        amount: Number(payment.amount),
        voided_at: rows[0].voided_at,
        voided_by: req.user.id,
        void_reason: reasonStr,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── List receipts ───
// Department accounts: only receipts in their department; school accounts: all.
// ?student_id=, ?search= (receipt number), ?limit=
router.get('/', async (req, res, next) => {
  try {
    // School staff have no receipts page — only the main school account and
    // department accounts can browse receipts.
    if (req.user.role === 'school_staff') {
      throw new AppError('Receipts are not available to school staff', 403);
    }
    const params = [];
    const conds = [];
    if (isAnyDept(req.user)) {
      params.push(req.user.department_id);
      conds.push(`r.department_id = $${params.length}`);
    }
    if (req.query.student_id) {
      params.push(req.query.student_id);
      conds.push(`r.student_id = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(`r.receipt_number ILIKE $${params.length}`);
    }
    if (req.query.academic_year) {
      params.push(req.query.academic_year);
      conds.push(`r.academic_year = $${params.length}`);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `${RECEIPT_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ${limit}`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Verify a receipt by number (with itemized lines) ───
router.get('/verify/:number', async (req, res, next) => {
  try {
    const params = [req.params.number];
    let where = `r.receipt_number = $1`;

    // Dept admins can verify receipts issued in their department
    if (isAnyDept(req.user)) {
      params.push(req.user.department_id);
      where += ` AND r.department_id = $${params.length}`;
    }

    const { rows } = await pool.query(`${RECEIPT_SELECT} WHERE ${where}`, params);
    if (rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = rows[0];

    const payRes = await pool.query(
      `SELECT p.*, COALESCE(d.name, 'School') AS department_name
       FROM payments p
       LEFT JOIN departments d ON d.id = p.department_id
       WHERE p.receipt_id = $1 AND p.voided_at IS NULL ORDER BY p.id`,
      [receipt.id]
    );

    // Souvenirs given at the same level
    const souvRes = await pool.query(
      `SELECT sou.name FROM student_souvenirs ss
       JOIN souvenirs sou ON sou.id = ss.souvenir_id
       WHERE ss.receipt_id = $1 ORDER BY ss.given_at DESC`,
      [receipt.id]
    );

    const recorder = await pool.query('SELECT name, email FROM users WHERE id = $1', [
      receipt.recorded_by,
    ]);

    res.json({
      ...receipt,
      lines: payRes.rows,
      souvenirs: souvRes.rows,
      recorded_by_name: recorder.rows[0]?.name || 'Class Rep',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
