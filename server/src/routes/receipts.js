const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { assertMainDues } = require('../utils/duesLimits');
const { nextReceiptNumber, nextStandaloneReceiptNumber, tagForLines } = require('../utils/receipt');
const {
  planExtraDuesReconcile,
  partitionManageableLines,
  applyExtraDuesChange,
  resolveTargetItems,
  extrasScopeForRole,
} = require('../utils/extraDuesEdit');
const { genderMismatch, genderRefusal } = require('../utils/extraDues');
const { getSouvenirNames } = require('../utils/souvenirs');
const {
  requireAuth,
  requireAnyAdmin,
  isAnyDept,
  requireSuperAdmin,
} = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { getActiveAcademicYear, normalizeAcademicYear } = require('../utils/academicYear');
const { normalizeLevel } = require('../utils/levels');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

// Audit label for the acting school-side user.
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

// Receipts read their payer identity from the snapshot columns first (free-flow
// payments) and fall back to the linked student row (fresher registration /
// admission), so both kinds of receipt come back with a name and number.
const RECEIPT_FROM = `
  FROM receipts r
  LEFT JOIN students s ON s.id = r.student_id
  LEFT JOIN departments d ON d.id = r.department_id
`;
const RECEIPT_SELECT = `
  SELECT r.*, COALESCE(r.student_name, s.name) AS student_name,
         COALESCE(r.student_no, s.student_no) AS student_no,
         COALESCE(r.level, s.level) AS level,
         s.email AS student_email,
         s.gender AS student_gender,
         s.is_fresher,
         d.name AS department_name
  ${RECEIPT_FROM}
`;

// Normalize and validate payment lines: at most one of each dues type. Every
// amount is quantized to pesewas (2 decimals) so float dust from the form
// never reaches the database; totals are computed from these rounded values.
function normalizeLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Select at least one dues to record', 400);
  }
  const lines = [];
  for (const it of items) {
    const type = it.type;
    const amount = Math.round(Number(it.amount) * 100) / 100;
    if (!['school_dues', 'department_dues'].includes(type)) {
      throw new AppError(`Invalid payment type "${type}"`, 400);
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      throw new AppError('Each payment line needs a valid amount', 400);
    }
    // Only school/department dues reach this point — both are main dues and
    // carry the cap (extra dues resolve separately, uncapped).
    assertMainDues(amount, type === 'school_dues' ? 'School dues' : 'Department dues');
    if (lines.find((l) => l.type === type)) {
      throw new AppError(`Duplicate ${type} line`, 400);
    }
    lines.push({ type, amount });
  }
  return lines;
}

// ─── Admin collection: create a receipt with one or two itemized lines ───
// Two shapes are accepted:
//
//   Student-linked (fresher registration / admission):
//     { student_id, method, items, ... }
//
//   Free-flow (Collect page — no student lookup):
//     { student_name, student_no, level, department_id?, method,
//       items, paid_at?, academic_year? }
//   The payer's details are snapshotted on the receipt and student_id stays
//   NULL — the payment goes straight into the records whether or not any
//   student row exists for that index number.
//
// RBAC:
//   School Admin → student-linked: may only record school_dues lines (fresher
//                  registration). Free-flow: must name the department.
//   Dept Admin   → student-linked: student must be in their department;
//                  department_dues always allowed; school_dues only together
//                  with department_dues (combined continuing collection).
//                  Free-flow: recorded against their own department, any
//                  selection of dues.
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  let idempotencyKey = null;
  try {
    if (['dept_staff', 'school_staff'].includes(req.user.role)) {
      throw new AppError('Staff accounts cannot record payments', 403);
    }
    const {
      student_id,
      student_name,
      student_no,
      email,
      level,
      department_id,
      method,
      paid_at,
      items,
      souvenir_ids,
      academic_year,
    } = req.body;

    // Client-generated idempotency key: a retried collection (timeout, double
    // tap, flaky network) returns the already-recorded receipt instead of
    // recording the cash twice. Stored on the receipt under a unique partial
    // index (idx_receipts_idempotency_key).
    const rawKey = req.body.idempotency_key;
    if (rawKey !== undefined && rawKey !== null && String(rawKey).trim() !== '') {
      idempotencyKey = String(rawKey).trim().slice(0, 128);
    }
    if (!student_id && !student_name && !student_no) {
      throw new AppError('A student or the payer name and index number are required', 400);
    }
    if (!method || !['cash', 'momo'].includes(method)) {
      throw new AppError('Valid payment method required (cash, momo)', 400);
    }
    const lines = normalizeLines(items);

    const paidAtDate = paid_at ? new Date(paid_at) : new Date();
    if (Number.isNaN(paidAtDate.getTime()))
      throw new AppError('A valid payment date is required', 400);
    const academicYear =
      normalizeAcademicYear(academic_year) || (await getActiveAcademicYear(pool));

    const standalone = !student_id;
    let student = null;
    let deptId;
    let payerName;
    let payerNo;
    let payerLevel = null;
    let payerEmail = null;

    if (standalone) {
      // ── Free-flow: typed payer details, no lookup ──
      payerName = String(student_name ?? '')
        .trim()
        .slice(0, 120);
      payerNo = String(student_no ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 40);
      if (!payerName) throw new AppError("Enter the student's name", 400);
      if (!payerNo) throw new AppError("Enter the student's index number", 400);
      payerLevel = normalizeLevel(level);
      if (!payerLevel) throw new AppError('Select a level (100, 200, 300 or 400)', 400);
      // The receipt is emailed as it is recorded — a free-flow payer has no
      // student row to fall back to, so their email must be captured here.
      payerEmail = String(email ?? '')
        .trim()
        .slice(0, 254);
      if (!payerEmail) throw new AppError("Enter the student's email address", 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
        throw new AppError('Enter a valid email address', 400);
      }
      if (Array.isArray(souvenir_ids) && souvenir_ids.length > 0) {
        throw new AppError('Souvenirs can only be recorded against a student record', 400);
      }

      if (isAnyDept(req.user)) {
        deptId = req.user.department_id;
      } else {
        if (!department_id) throw new AppError('Choose the department collecting the dues', 400);
        const deptRes = await pool.query('SELECT id FROM departments WHERE id = $1', [
          Number(department_id),
        ]);
        if (deptRes.rows.length === 0) throw new AppError('Department not found', 404);
        deptId = Number(department_id);
      }
    } else {
      // ── Student-linked path (unchanged behaviour) ──
      const studentRes = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
      if (studentRes.rows.length === 0) throw new AppError('Student not found', 404);
      student = studentRes.rows[0];

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

      deptId = student.department_id;
      payerName = student.name;
      payerNo = student.student_no;
    }

    // Serialize concurrent collections for the same payer/year/type. Multiple
    // partial (installment) payments per dues type are allowed, so there is no
    // duplicate guard — balances are derived from the sum of payments.
    await client.query('BEGIN');
    for (const line of lines) {
      const key = standalone
        ? `payment:${payerNo}:${academicYear}:${line.type}`
        : `payment:${student.id}:${academicYear}:${line.type}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    }

    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    const receipt_number = standalone
      ? await nextStandaloneReceiptNumber(client, payerNo, tagForLines(lines))
      : await nextReceiptNumber(client, student.id, tagForLines(lines));

    const rc = await client.query(
      `INSERT INTO receipts (receipt_number, student_id, student_name, student_no, payer_email, level, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin', $10, $11, $12, $13) RETURNING *`,
      [
        receipt_number,
        standalone ? null : student.id,
        standalone ? payerName : null,
        standalone ? payerNo : null,
        standalone ? payerEmail : null,
        standalone ? payerLevel : null,
        method,
        paidAtDate,
        academicYear,
        req.user.id,
        deptId,
        total,
        idempotencyKey,
      ]
    );
    const receipt = rc.rows[0];

    for (const line of lines) {
      await client.query(
        `INSERT INTO payments (receipt_id, type, amount, department_id)
         VALUES ($1, $2, $3, $4)`,
        [receipt.id, line.type, line.amount, line.type === 'department_dues' ? deptId : null]
      );
    }

    // Optional souvenirs (student-linked only): validate every id exists AND
    // belongs to the right category BEFORE inserting — school_dues line →
    // school souvenirs, department_dues line → department souvenirs from the
    // student's department — so invalid ids get a clear 400 naming them
    // instead of being silently dropped by the INSERT ... SELECT filter.
    if (student && Array.isArray(souvenir_ids) && souvenir_ids.length > 0) {
      const hasSchool = lines.some((l) => l.type === 'school_dues');
      const hasDept = lines.some((l) => l.type === 'department_dues');
      const souvLevel =
        hasSchool && !hasDept ? 'school' : hasDept && !hasSchool ? 'department' : null;
      if (!souvLevel) {
        throw new AppError(
          'Souvenirs can only be recorded with a single dues type (School Dues or Department Dues, not both on one receipt)',
          400
        );
      }

      const ids = souvenir_ids.map((id) => Number(id));
      const { rows: souvRows } = await client.query(
        'SELECT id, category, department_id FROM souvenirs WHERE id = ANY($1::int[])',
        [ids]
      );
      const byId = new Map(souvRows.map((s) => [s.id, s]));
      const invalid = [];
      for (const id of ids) {
        const s = Number.isInteger(id) && id > 0 ? byId.get(id) : undefined;
        if (!s) {
          invalid.push(id || 'blank');
        } else if (s.category !== souvLevel) {
          invalid.push(`${id} (${s.category})`);
        } else if (souvLevel === 'department' && s.department_id !== student.department_id) {
          invalid.push(`${id} (another department)`);
        }
      }
      if (invalid.length) {
        throw new AppError(
          `These souvenirs cannot be recorded on this receipt: ${invalid.join(', ')}. ${
            souvLevel === 'school'
              ? 'School Dues take school-category souvenirs only.'
              : 'Department Dues take souvenirs from the student’s own department only.'
          }`,
          400
        );
      }

      const params = [student.id, receipt.id, souvLevel, req.user.id, ids, souvLevel];
      let scope = '';
      if (souvLevel === 'department') {
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

    const levelSuffix = standalone ? ` · Level ${payerLevel}` : '';
    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'payment',
      description: `Recorded ${lines.map((l) => `${l.type} GHS ${l.amount.toFixed(2)}`).join(' + ')} for ${payerName} (${payerNo})${levelSuffix} (${receipt_number})`,
      meta: {
        receipt_id: receipt.id,
        student_id: standalone ? null : student.id,
        student_name: payerName,
        student_no: payerNo,
        level: standalone ? payerLevel : null,
        receipt_number,
        lines,
        method,
        department_id: deptId,
      },
      client,
    });
    await client.query('COMMIT');

    emitEvent('payment:new', {
      department_id: deptId,
      level: standalone ? payerLevel : undefined,
      student_id: standalone ? null : student.id,
      receipt_number,
      total,
      source: ['school_admin', 'school_staff'].includes(req.user.role) ? 'school' : 'admin',
    });

    // Email receipt (logs in dev mode when no SMTP configured). Awaited so the
    // response reports the REAL delivery status instead of the UI claiming
    // "Receipt emailed to X" unconditionally.
    const souvenirs = student ? await getSouvenirNames(client, receipt.id) : [];
    const emailResult = await sendReceiptEmail({
      to: payerEmail || student?.email || undefined,
      studentName: payerName,
      studentNo: payerNo,
      receiptNumber: receipt_number,
      paidAt: receipt.paid_at,
      method,
      total,
      lines,
      souvenirs,
    });

    res.status(201).json({
      ...receipt,
      lines,
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
    // the existing receipt with 200 instead of recording the cash twice.
    if (err.code === '23505' && idempotencyKey) {
      try {
        const { rows } = await pool.query(`${RECEIPT_SELECT} WHERE r.idempotency_key = $1`, [
          idempotencyKey,
        ]);
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
    // A repeated souvenir hand-out (student+souvenir unique) is a conflict,
    // not a server error — and must not roll back the money via a generic 500.
    if (err.code === '23505' && err.table === 'student_souvenirs') {
      return next(new AppError('These souvenirs were already recorded for this student.', 409));
    }
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
      `SELECT r.*, COALESCE(r.student_name, s.name) AS student_name, s.email AS student_email
       FROM receipts r LEFT JOIN students s ON s.id = r.student_id
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

    // Tell the payer their receipt was reversed. Awaited so the response can
    // report the real email status instead of guessing.
    const emailResult = await sendReceiptEmail({
      to: receipt.payer_email || receipt.student_email || undefined,
      studentName: receipt.student_name,
      studentNo: receipt.student_no,
      receiptNumber: receipt.receipt_number,
      reversalReason: reason,
    }).catch((err) => {
      console.error('Reversal email error:', err.message);
      return { sent: false, mode: 'error', to: null, error: err.message };
    });

    res.json({
      ...rows[0],
      email: {
        sent: emailResult.sent,
        mode: emailResult.mode,
        to: emailResult.to,
        ...(emailResult.error ? { error: emailResult.error } : {}),
      },
    });
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
      `SELECT r.*, COALESCE(r.student_name, s.name) AS student_name
       FROM receipts r LEFT JOIN students s ON s.id = r.student_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (receiptRes.rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = receiptRes.rows[0];

    if (req.user.role === 'dept_admin' && receipt.department_id !== req.user.department_id) {
      throw new AppError('You can only void payments from your department', 403);
    }
    if (receipt.voided_at)
      throw new AppError('Cannot void a payment on an already-voided receipt', 409);

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
    await client.query('UPDATE receipts SET total_amount = $1 WHERE id = $2', [
      newTotal,
      receipt.id,
    ]);
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

// ─── Toggle "Other Dues" items on a receipt (checkbox model) ───
// The account is shown every dues item its role may toggle, with the ones
// already charged on this receipt pre-checked. Saving sends the full checked
// set; the server reconciles: newly-checked items become extra_dues lines,
// unchecked ones get their active line voided. Amounts of already-charged
// lines are never mutated in place — uncheck + re-check to change money, so
// the original line survives as a voided audit row. Reason is required.
// Staff may toggle too (the verification desk fixes its own mischarges):
// school_staff → school-wide items, dept_staff → their own department's items,
// exactly mirroring the admin money-scope (see extrasScopeForRole).
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

    const receiptRes = await client.query(
      `SELECT r.*, COALESCE(r.student_name, s.name) AS student_name, s.gender AS student_gender
       FROM receipts r LEFT JOIN students s ON s.id = r.student_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (receiptRes.rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = receiptRes.rows[0];
    if (isAnyDept(req.user) && receipt.department_id !== req.user.department_id) {
      throw new AppError('You can only edit receipts from your department', 403);
    }
    if (receipt.voided_at) throw new AppError('Cannot edit Other Dues on a voided receipt', 409);

    const targets = await resolveTargetItems(client, req.body.items, { allowedDeptId });

    // The actor's toggleable catalog (same scope filter the picker uses via
    // ?toggleable=1). Lines whose label matches no active toggleable item — a
    // renamed or deactivated item, or an item outside this actor's money-scope
    // — are NOT representable as a checkbox and must never be voided by this
    // save; they stay untouched (use per-line Void for those).
    const { rows: toggleable } = await client.query(
      allowedDeptId === 'any'
        ? 'SELECT name FROM dues_items WHERE active'
        : allowedDeptId === null
          ? 'SELECT name FROM dues_items WHERE active AND department_id IS NULL'
          : 'SELECT name FROM dues_items WHERE active AND department_id = $1',
      allowedDeptId === 'any' || allowedDeptId === null ? [] : [allowedDeptId]
    );
    const { rows: allActiveLines } = await client.query(
      `SELECT id, receipt_id, label FROM payments
       WHERE receipt_id = $1 AND type = 'extra_dues' AND voided_at IS NULL`,
      [receipt.id]
    );
    const { candidates, skipped } = partitionManageableLines(
      allActiveLines,
      toggleable.map((t) => t.name)
    );

    const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(candidates, targets);
    const skippedLabels = skipped.map((l) => l.label);

    // Gender-scoped items may not be NEWLY charged to a mismatched student.
    // Already-charged lines stay manageable so a wrong charge can always be
    // unchecked — the guard never locks the correction path. Free-flow
    // receipts have no student gender, so the guard passes there.
    for (const item of toAdd) {
      if (genderMismatch(item.gender, receipt.student_gender)) {
        throw genderRefusal(item, receipt.student_gender);
      }
    }

    if (toVoid.length === 0 && toAdd.length === 0) {
      return res.json({
        message: 'No changes to Other Dues.',
        total_amount: Number(receipt.total_amount),
        added: 0,
        removed: 0,
        unchanged,
        skipped: skippedLabels,
      });
    }

    await client.query('BEGIN');
    const result = await applyExtraDuesChange(client, {
      toVoid,
      // The admin picked THIS receipt explicitly — one batch, this receipt.
      additions: toAdd.length ? [{ receipt, items: toAdd }] : [],
      reason: `Other Dues edited: ${reason}`,
      userId: req.user.id,
    });
    await client.query('COMMIT');

    await logTransaction({
      admin_id: req.user.id,
      admin_role: actorRole(req.user),
      transaction_type: 'other_dues_edit',
      description:
        `Edited Other Dues on receipt ${receipt.receipt_number} for ${receipt.student_name}: ` +
        `${toAdd.length} added, ${toVoid.length} removed (${reason})`,
      meta: {
        receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        student_name: receipt.student_name,
        added: toAdd.map((i) => ({ name: i.name, amount: i.amount })),
        removed: toVoid.map((l) => ({ label: l.label })),
        unchanged,
        skipped: skippedLabels,
        reason,
        new_total: result.totals[receipt.id] ?? Number(receipt.total_amount),
      },
    });
    emitEvent('payment:new', {
      department_id: receipt.department_id,
      student_id: receipt.student_id,
      receipt_number: receipt.receipt_number,
      total: result.totals[receipt.id] ?? Number(receipt.total_amount),
      source: 'admin',
    });

    res.json({
      message: 'Other Dues updated.',
      total_amount: result.totals[receipt.id] ?? Number(receipt.total_amount),
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

// ─── List receipts ───
// Department accounts: only receipts in their department; school accounts: all.
// Server-side pagination: ?page=, ?limit=, plus ?student_id=, ?student_no=
// (payer index number), ?search= (receipt number), ?academic_year=,
// ?voided=only|exclude. Returns { receipts, total, page, pageSize }.
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
    // Match the payer's index number — works for free-flow receipts (typed on
    // the receipt) and student-linked ones (through the student row). Used by
    // the "did it save?" recovery check.
    if (req.query.student_no) {
      params.push(String(req.query.student_no).trim().toUpperCase());
      conds.push(`UPPER(COALESCE(r.student_no, s.student_no)) = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(`r.receipt_number ILIKE $${params.length}`);
    }
    if (req.query.academic_year) {
      params.push(req.query.academic_year);
      conds.push(`r.academic_year = $${params.length}`);
    }
    if (req.query.voided === 'only') {
      conds.push('r.voided_at IS NOT NULL');
    } else if (req.query.voided === 'exclude') {
      conds.push('r.voided_at IS NULL');
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 12), 100);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total ${RECEIPT_FROM} ${where}`,
      params
    );
    const total = countRows[0].total;

    const { rows } = await pool.query(
      `${RECEIPT_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    res.json({ receipts: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// ─── Verify a receipt by number (with itemized lines) ───
// The response carries the receipt's voided_at/void_reason plus a count of
// individually voided payment lines (voided_line_count), so a caller can show
// "Reversed" and how many lines were reversed.
router.get('/verify/:number', async (req, res, next) => {
  try {
    // Fetch without the department filter first: a dept admin who scans a
    // receipt from ANOTHER department must get a clear 403, not a 404 that
    // pretends the receipt does not exist.
    const { rows } = await pool.query(`${RECEIPT_SELECT} WHERE r.receipt_number = $1`, [
      req.params.number,
    ]);
    if (rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = rows[0];

    if (isAnyDept(req.user) && receipt.department_id !== req.user.department_id) {
      return res.status(403).json({
        error: 'This receipt was issued by another department.',
        code: 'WRONG_DEPARTMENT',
      });
    }

    const payRes = await pool.query(
      `SELECT p.*, COALESCE(d.name, 'School') AS department_name
       FROM payments p
       LEFT JOIN departments d ON d.id = p.department_id
       WHERE p.receipt_id = $1 AND p.voided_at IS NULL ORDER BY p.id`,
      [receipt.id]
    );

    const voidedCountRes = await pool.query(
      'SELECT COUNT(*)::int AS n FROM payments WHERE receipt_id = $1 AND voided_at IS NOT NULL',
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
      voided_line_count: voidedCountRes.rows[0].n,
      souvenirs: souvRes.rows,
      recorded_by_name: recorder.rows[0]?.name || 'Class Rep',
    });
  } catch (err) {
    next(err);
  }
});

// ─── Resend a receipt email (super admin only) ───
// Re-sends the receipt to the payer's address on file, or to an explicit
// `to` address supplied in the body. Voided receipts cannot be re-sent —
// they already triggered a reversal email at void time.
router.post('/:id/resend-email', requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${RECEIPT_SELECT} WHERE r.id = $1`, [req.params.id]);
    if (rows.length === 0) throw new AppError('Receipt not found', 404);
    const receipt = rows[0];
    if (receipt.voided_at) throw new AppError('Voided receipts cannot be re-sent', 409);

    const explicitTo = String(req.body?.to || '').trim() || undefined;
    const to = explicitTo || receipt.payer_email || receipt.student_email || undefined;
    if (!to) throw new AppError('No email address on file for this receipt — supply one', 400);

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

    const emailResult = await sendReceiptEmail({
      to,
      studentName: receipt.student_name,
      studentNo: receipt.student_no,
      receiptNumber: receipt.receipt_number,
      paidAt: receipt.paid_at,
      method: receipt.method,
      total: Number(receipt.total_amount),
      lines,
      souvenirs,
    });

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SUPER_ADMIN',
      transaction_type: 'receipt_resend',
      description: `Re-sent receipt ${receipt.receipt_number} to ${emailResult.to || to}`,
      meta: {
        receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        to: emailResult.to || to,
      },
    });

    res.json({
      email: {
        sent: emailResult.sent,
        mode: emailResult.mode,
        to: emailResult.to,
        ...(emailResult.error ? { error: emailResult.error } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
