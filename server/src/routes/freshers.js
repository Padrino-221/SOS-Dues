const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { assertMainDues } = require('../utils/duesLimits');
const {
  requireAuth,
  requireAnySchool,
  requireSchoolAdmin,
  requireSuperAdmin,
} = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { nextReceiptNumber, tagForLines } = require('../utils/receipt');
const { resolveExtraLines } = require('../utils/extraDues');
const { getSouvenirNames } = require('../utils/souvenirs');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { cleanText } = require('../utils/clean');
const { isValidName, isValidPhone } = require('../utils/inputRules');
const {
  normalizeStudentNo,
  assertStudentNoShape,
  STUDENT_NO_STRICT_RE,
} = require('../utils/studentNo');
const { getActiveAcademicYear } = require('../utils/academicYear');

const schoolActorRole = (user) =>
  user.role === 'super_admin'
    ? 'SUPER_ADMIN'
    : user.role === 'school_staff'
      ? 'SCHOOL_STAFF'
      : 'SCHOOL_ADMIN';

const router = express.Router();
router.use(requireAuth, requireAnySchool);

const APP_SELECT = `
  SELECT a.*, u.name AS verified_by_name
  FROM fresher_applications a
  LEFT JOIN users u ON u.id = a.verified_by
`;

// ─── List fresher applications (School Admin) ───
// ?status=pending|verified|rejected|cancelled (default: all), ?search=
// Server-side pagination: ?paged=1&limit=&offset= returns
// { items, total, limit, offset } so the client can show a true total
// instead of silently truncating at 500. Legacy callers (no paged param)
// keep the plain-array shape for backward compatibility.
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const conds = [];
    if (req.query.status) {
      params.push(req.query.status);
      conds.push(`a.status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conds.push(`(a.full_name ILIKE $${params.length} OR a.student_no ILIKE $${params.length})`);
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const wantsPaged = ['1', 'true', 'yes'].includes(String(req.query.paged || '').toLowerCase());
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    limit = Math.min(limit, 500);
    let offset = parseInt(req.query.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const { rows } = await pool.query(
      `${APP_SELECT} ${where}
       ORDER BY (a.status = 'pending') DESC, a.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    if (!wantsPaged) return res.json(rows);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fresher_applications a ${where}`,
      params
    );
    res.json({ items: rows, total: countRes.rows[0].total, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── Verify a pre-registration on the reporting day ───
// Checks the student's details, corrects them if needed, assigns a department
// and records School dues + School souvenirs (payment step, as with manual
// registration). Creates the real student row and marks the application verified.
// Body: { full_name?, student_no?, phone?, email?, programme?, gender?, hometown?,
//         department_id, admission_year?,
//         payment?: { amount, method, paid_at?, extras?: [{ dues_item_id, amount }] },
//         souvenir_ids?: [] }
// payment.amount is the School dues part; payment.extras are additional dues
// items (school-wide + the assigned department's) charged alongside it. The
// receipt total covers School dues + extras; each line is itemized.
router.post('/:id/verify', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const appId = Number(req.params.id);
    const {
      full_name,
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
    } = req.body;

    await client.query('BEGIN');
    const appRes = await client.query(
      'SELECT * FROM fresher_applications WHERE id = $1 FOR UPDATE',
      [appId]
    );
    if (appRes.rows.length === 0) throw new AppError('Application not found', 404);
    const app = appRes.rows[0];
    if (app.status !== 'pending')
      throw new AppError('This application has already been handled', 400);

    if (!department_id) throw new AppError('Assign the fresher to a department', 400);
    const name = String(full_name ?? app.full_name ?? '').trim();
    const no = normalizeStudentNo(student_no ?? app.student_no);
    if (!name) throw new AppError('Full name is required', 400);
    // Shape always: junk stored on the application (a phone number, stray
    // punctuation) is corrected here at the desk, never carried into a real
    // student record. The strict UA format stays change-only, below.
    assertStudentNoShape(no);
    // Same character rules as the public apply form. The stored application
    // may predate validation (e.g. an emoji slipped in) — correcting the
    // name here is part of verifying it.
    if (!isValidName(name)) {
      throw new AppError(
        'Full name should contain letters only — no numbers, emoji or symbols',
        400
      );
    }
    if (!isValidPhone(cleanText(phone ?? app.phone))) {
      throw new AppError('Phone number should contain numbers only', 400);
    }
    // Reference numbers look like UA2309264: "UA" + 7 digits. Only enforced
    // when the number is newly entered — pre-existing applications filed
    // under older formats (SMK/2021/045) must still verify unchanged.
    const storedNo = normalizeStudentNo(app.student_no);
    if (no !== storedNo && !STUDENT_NO_STRICT_RE.test(no)) {
      throw new AppError('Enter a valid reference number (e.g. UA2309264)', 400);
    }

    const dept = await pool.query('SELECT id, name FROM departments WHERE id = $1', [
      department_id,
    ]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);

    // Duplicate student number among real students in the assigned department
    // (numbers are only required to be unique within a department),
    // or another pending application using the same number.
    const dupStu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [no]);
    if (dupStu.rows.length > 0)
      throw new AppError('A student with this number already exists in this department', 409);
    const dupApp = await pool.query(
      'SELECT 1 FROM fresher_applications WHERE UPPER(student_no) = $1 AND id <> $2 AND status = $3',
      [no, appId, 'pending']
    );
    if (dupApp.rows.length > 0)
      throw new AppError('Another pending application uses this student number', 409);

    // Validate payment lines if a payment is given: School dues plus any
    // additional dues items (school-wide + this department's) the fresher is
    // paying at verification.
    let amount = 0;
    let method = null;
    let paidAt = null;
    const requestedExtras = Array.isArray(payment?.extras) ? payment.extras : [];
    if (payment && (Number(payment.amount) > 0 || requestedExtras.length > 0)) {
      amount = Number(payment.amount) || 0;
      // Only the School dues part is capped; extra dues items are not.
      assertMainDues(amount, 'School dues');
      method = payment.method;
      if (!method || !['cash', 'momo'].includes(method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAt.getTime()))
        throw new AppError('A valid payment date is required', 400);
    }
    // Keep the profile details the fresher filled in at home (corrected if
    // needed). Computed before the extras resolve — the gender feeds the
    // gender-scoped item guard.
    const clean = (v) => cleanText(v);
    const fPhone = clean(phone ?? app.phone);
    const fEmail = clean(email ?? app.email);
    const fProgramme = clean(programme ?? app.programme);
    const fGender = clean(gender ?? app.gender);
    const fHometown = clean(hometown ?? app.hometown);

    // The desk collects school-wide items only — a department's own items are
    // refused (the department collects them at admission). Names are
    // snapshotted onto the lines. Gender-scoped items only charge a matching
    // fresher (genderMismatch).
    const extraLines = await resolveExtraLines(client, {
      department_id,
      extras: requestedExtras,
      scope: 'school',
      gender: fGender,
    });
    const extrasTotal = extraLines.reduce((sum, l) => sum + l.amount, 0);
    const receiptTotal = amount + extrasTotal;
    const paymentLines = [...(amount > 0 ? [{ type: 'school_dues', amount }] : []), ...extraLines];

    const activeYear = await getActiveAcademicYear(client);
    const year = cleanText(admission_year ?? app.admission_year) || activeYear.split('/')[0];

    // 1) Create the real fresher (registered by the School, assigned to a department)
    const stu = await client.query(
      `INSERT INTO students (name, student_no, is_fresher, department_id, admission_year,
                             phone, email, programme, gender, hometown, created_by)
       VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, no, department_id, year, fPhone, fEmail, fProgramme, fGender, fHometown, req.user.id]
    );
    const student = stu.rows[0];

    // 2) Record School dues + School souvenirs if paid now (same as manual registration)
    // If souvenirs are being given, we MUST have a receipt to attach them to.
    // This means either a payment receipt exists, or we create a $0 souvenir-only receipt.
    let receiptNumber = null;
    let receiptId = null;
    let hasSouvenirs = Array.isArray(souvenir_ids) && souvenir_ids.length > 0;

    if (receiptTotal > 0) {
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, student.id, tagForLines(paymentLines));
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8) RETURNING *`,
        [
          receipt_number,
          student.id,
          method,
          paidAt,
          academicYear,
          req.user.id,
          student.department_id,
          receiptTotal,
        ]
      );
      for (const line of paymentLines) {
        await client.query(
          `INSERT INTO payments (receipt_id, type, label, amount, department_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [rc.rows[0].id, line.type, line.label || null, line.amount, line.department_id ?? null]
        );
      }
      receiptNumber = receipt_number;
      receiptId = rc.rows[0].id;

      if (hasSouvenirs) {
        await client.query(
          `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           SELECT $1, id, $2, 'school', $3 FROM souvenirs
           WHERE id = ANY($4::int[]) AND category = 'school'`,
          [student.id, rc.rows[0].id, req.user.id, souvenir_ids]
        );
      }

      await logTransaction({
        admin_id: req.user.id,
        admin_role: schoolActorRole(req.user),
        transaction_type: 'payment',
        description: `Recorded GHS ${receiptTotal.toFixed(2)} for ${name} (${receipt_number}) at verification${
          extraLines.length
            ? ` — School Dues${amount > 0 ? '' : ' not taken'} + ${extraLines.length} additional dues item(s)`
            : ''
        }`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: student.id,
          receipt_number,
          type: 'school_dues',
          lines: paymentLines.map((l) => ({
            type: l.type,
            label: l.label || null,
            amount: l.amount,
          })),
        },
      });
    } else if (hasSouvenirs) {
      // No payment, but souvenirs are being given — create a $0 souvenir-only receipt
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, student.id, 'SCH');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, 0) RETURNING *`,
        [receipt_number, student.id, new Date(), academicYear, req.user.id, student.department_id]
      );
      receiptNumber = receipt_number;
      receiptId = rc.rows[0].id;
      await logTransaction({
        admin_id: req.user.id,
        admin_role: schoolActorRole(req.user),
        transaction_type: 'souvenir_distribution',
        description: `Issued school souvenirs to ${name} (${receipt_number}) at verification`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: student.id,
          receipt_number,
        },
      });
    }

    // 3) Mark the application verified
    await client.query(
      `UPDATE fresher_applications SET status = 'verified', verified_at = NOW(), verified_by = $1 WHERE id = $2`,
      [req.user.id, appId]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'fresher_verify',
      description: `Verified fresher pre-registration for ${name} (${no}) and assigned to ${dept.rows[0].name}`,
      meta: {
        application_id: appId,
        student_id: student.id,
        student_no: no,
        department_id,
        receipt_number: receiptNumber,
      },
    });
    await client.query('COMMIT');

    emitEvent('fresher:verified', {
      department_id: Number(department_id),
      student_id: student.id,
      student_no: no,
    });
    if (receiptNumber && receiptTotal > 0) {
      emitEvent('payment:new', {
        department_id: Number(department_id),
        student_id: student.id,
        receipt_number: receiptNumber,
        total: receiptTotal,
        source: 'verify',
      });
    }

    // Email the student a copy of the receipt if an address is available
    // (either for a payment receipt or a souvenir-only receipt).
    // Send to the address the admin confirmed/corrected NOW (fEmail) — not
    // the stale one the fresher typed at home (app.email). Awaited so the
    // response carries the email status for the verify toast.
    let emailStatus = { sent: false, mode: 'skipped', to: null };
    if (receiptNumber && fEmail) {
      const emailTotal = receiptTotal;
      const emailLines = paymentLines;
      const souvenirs = receiptId ? await getSouvenirNames(client, receiptId) : [];
      try {
        // Bounded wait: the client's request timeout (~20s) must not be eaten
        // by a slow SMTP server. sendReceiptEmail never throws; if SMTP hangs,
        // report the email as failed — the receipt is already committed.
        const EMAIL_WAIT_MS = 12000;
        const sendPromise = sendReceiptEmail({
          to: fEmail,
          studentName: name,
          studentNo: no,
          receiptNumber,
          paidAt: paidAt || new Date(),
          method: method || 'cash',
          total: emailTotal,
          lines: emailLines,
          souvenirs,
        });
        const result = await Promise.race([
          sendPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), EMAIL_WAIT_MS)),
        ]);
        if (!result) {
          emailStatus = { sent: false, mode: 'error', to: fEmail, error: 'Email send timed out' };
        } else {
          emailStatus = {
            sent: Boolean(result?.sent),
            mode: result?.mode || (result?.sent ? 'sent' : 'error'),
            to: result?.to || fEmail,
            ...(result?.error ? { error: result.error } : {}),
          };
        }
      } catch (err) {
        console.error('Receipt email error:', err.message);
        emailStatus = { sent: false, mode: 'error', to: fEmail, error: err.message };
      }
    }

    res.status(201).json({ student, receipt_number: receiptNumber, email: emailStatus });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      // A receipt-number clash inside this transaction used to surface as
      // the student-number message, sending the desk hunting for a duplicate
      // student that did not exist. Name the real conflict.
      if (err.table === 'receipts' || err.constraint === 'receipts_receipt_number_key')
        return next(new AppError('Receipt numbering conflict — please try again', 409));
      return next(new AppError('A student with this number already exists', 409));
    }
    next(err);
  } finally {
    client.release();
  }
});

// ─── Reject a pre-registration (keeps the record + reason) ───
// The proper exit for applications the school turns away: status flips to
// 'rejected' and the reason is kept on the record (unlike delete, which is
// only for spam). Uses the existing rejection_reason column.
router.post('/:id/reject', requireSchoolAdmin, async (req, res, next) => {
  try {
    const reason = cleanText(req.body?.reason);
    if (!reason) throw new AppError('A reason is required to reject an application', 400);

    const { rows } = await pool.query(
      `UPDATE fresher_applications
          SET status = 'rejected', rejection_reason = $1
        WHERE id = $2 AND status = 'pending'
        RETURNING id, full_name, student_no, rejection_reason`,
      [reason, Number(req.params.id)]
    );
    if (rows.length === 0) throw new AppError('Application not found or no longer pending', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'fresher_application_reject',
      description: `Rejected fresher pre-registration for ${rows[0].full_name} (${rows[0].student_no}): ${reason}`,
      meta: { application_id: rows[0].id, student_no: rows[0].student_no, reason },
    });

    emitEvent('fresher_application:removed', {});
    res.json({ message: 'Application rejected', application: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Remove an application (spam only) ───
// Hard delete so the student number can be submitted again. Only allowed
// while no real student exists for it: once verified, the application has
// produced a student row (with any receipts) and must never be deleted —
// use Reject to turn a real applicant away instead.
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const appId = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM fresher_applications WHERE id = $1', [appId]);
    if (rows.length === 0) throw new AppError('Application not found', 404);
    const app = rows[0];

    if (app.status === 'verified') {
      throw new AppError(
        'This application was already verified — the student record exists and cannot be deleted.',
        409
      );
    }
    // Belt-and-braces: any real student row for this number means deleting
    // the application would orphan (or hide) a student with receipts.
    if (app.student_no) {
      const stu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [
        String(app.student_no).trim().toUpperCase(),
      ]);
      if (stu.rows.length > 0)
        throw new AppError(
          'A student record already exists for this application — it cannot be deleted.',
          409
        );
    }

    await pool.query('DELETE FROM fresher_applications WHERE id = $1', [appId]);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'fresher_application_delete',
      description: `Removed fresher pre-registration for ${app.full_name} (${app.student_no})`,
      meta: { application_id: app.id, student_no: app.student_no },
    });

    emitEvent('fresher_application:removed', {});
    res.json({ message: 'Application removed' });
  } catch (err) {
    next(err);
  }
});

// ─── Edit a pending application (super admin only) ───
// Corrects fresher-supplied details before verification (e.g. emoji in the
// name, a +233 phone). Same validation as verify; the student number keeps
// the UA-format rule only when it is being changed.
router.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const appId = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM fresher_applications WHERE id = $1', [appId]);
    if (rows.length === 0) throw new AppError('Application not found', 404);
    const app = rows[0];
    if (app.status !== 'pending')
      throw new AppError('Only pending applications can be edited', 409);

    const name =
      req.body?.full_name !== undefined ? String(req.body.full_name).trim() : app.full_name;
    const no =
      req.body?.student_no !== undefined
        ? normalizeStudentNo(req.body.student_no)
        : normalizeStudentNo(app.student_no);
    if (!name) throw new AppError('Full name is required', 400);
    // Same shape guard as apply/verify: an edit may not persist phone numbers
    // or stray characters as a reference number.
    assertStudentNoShape(no);
    if (!isValidName(name)) {
      throw new AppError(
        'Full name should contain letters only — no numbers, emoji or symbols',
        400
      );
    }
    const phone = req.body?.phone !== undefined ? cleanText(req.body.phone) : app.phone;
    if (!isValidPhone(cleanText(phone))) {
      throw new AppError('Phone number should contain numbers only', 400);
    }
    const storedNo = String(app.student_no ?? '')
      .trim()
      .toUpperCase();
    if (no !== storedNo && !/^UA\d{7}$/.test(no)) {
      throw new AppError('Enter a valid reference number (e.g. UA2309264)', 400);
    }
    if (no !== storedNo) {
      const dup = await pool.query(
        "SELECT 1 FROM fresher_applications WHERE UPPER(student_no) = $1 AND id <> $2 AND status = 'pending'",
        [no, appId]
      );
      if (dup.rows.length > 0)
        throw new AppError('Another pending application uses this student number', 409);
      const dupStu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [no]);
      if (dupStu.rows.length > 0)
        throw new AppError('A student with this number already exists', 409);
    }

    const { rows: updated } = await pool.query(
      `UPDATE fresher_applications
          SET full_name = $1, student_no = $2, phone = $3, email = $4,
              programme = $5, gender = $6, hometown = $7
        WHERE id = $8 RETURNING *`,
      [
        name,
        no,
        phone,
        req.body?.email !== undefined ? cleanText(req.body.email) : app.email,
        req.body?.programme !== undefined ? cleanText(req.body.programme) : app.programme,
        req.body?.gender !== undefined ? cleanText(req.body.gender) : app.gender,
        req.body?.hometown !== undefined ? cleanText(req.body.hometown) : app.hometown,
        appId,
      ]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SUPER_ADMIN',
      transaction_type: 'fresher_application_edit',
      description: `Edited fresher pre-registration for ${name} (${no})`,
      meta: { application_id: appId, student_no: no },
    });

    emitEvent('fresher_application:changed', {});
    res.json({ message: 'Application updated', application: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Reopen a verified/rejected application (super admin only) ───
// Sends the application back to pending so it can be corrected and
// re-handled. Verified applications cannot be reopened once a student row
// exists for the number — delete/recreate the student instead.
router.post('/:id/reopen', requireSuperAdmin, async (req, res, next) => {
  try {
    const appId = Number(req.params.id);
    const reason = cleanText(req.body?.reason);
    if (!reason) throw new AppError('A reason is required to reopen an application', 400);

    const { rows } = await pool.query('SELECT * FROM fresher_applications WHERE id = $1', [appId]);
    if (rows.length === 0) throw new AppError('Application not found', 404);
    const app = rows[0];
    if (app.status === 'pending') throw new AppError('This application is already pending', 409);
    if (app.status === 'verified' && app.student_no) {
      const stu = await pool.query('SELECT 1 FROM students WHERE UPPER(student_no) = $1', [
        String(app.student_no).trim().toUpperCase(),
      ]);
      if (stu.rows.length > 0)
        throw new AppError(
          'This application already produced a student record — remove the student first',
          409
        );
    }

    const { rows: updated } = await pool.query(
      `UPDATE fresher_applications
          SET status = 'pending', rejection_reason = NULL, verified_at = NULL, verified_by = NULL
        WHERE id = $1 RETURNING *`,
      [appId]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SUPER_ADMIN',
      transaction_type: 'fresher_application_reopen',
      description: `Reopened fresher pre-registration for ${app.full_name} (${app.student_no}): ${reason}`,
      meta: { application_id: appId, student_no: app.student_no, from_status: app.status, reason },
    });

    emitEvent('fresher_application:changed', {});
    res.json({ message: 'Application reopened', application: updated[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
