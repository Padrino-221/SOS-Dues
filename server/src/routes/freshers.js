const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireAnySchool } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { nextReceiptNumber } = require('../utils/receipt');
const { getSouvenirNames } = require('../utils/souvenirs');
const { sendReceiptEmail } = require('../utils/email');
const { emitEvent } = require('../utils/realtime');
const { cleanText } = require('../utils/clean');
const { getActiveAcademicYear } = require('../utils/academicYear');

const schoolActorRole = (user) => (user.role === 'school_staff' ? 'SCHOOL_STAFF' : 'SCHOOL_ADMIN');

const router = express.Router();
router.use(requireAuth, requireAnySchool);

const APP_SELECT = `
  SELECT a.*, u.name AS verified_by_name
  FROM fresher_applications a
  LEFT JOIN users u ON u.id = a.verified_by
`;

// ─── List fresher applications (School Admin) ───
// ?status=pending|verified|cancelled (default: all), ?search=
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
    const { rows } = await pool.query(
      `${APP_SELECT} ${where}
       ORDER BY (a.status = 'pending') DESC, a.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
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
//         payment?: { amount, method, paid_at? }, souvenir_ids?: [] }
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
    const no = String(student_no ?? app.student_no ?? '')
      .trim()
      .toUpperCase();
    if (!name) throw new AppError('Full name is required', 400);
    if (!no) throw new AppError('Student number is required', 400);

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

    // Validate payment lines if a payment is given (School dues only here)
    let amount = 0;
    let method = null;
    let paidAt = null;
    if (payment && Number(payment.amount) > 0) {
      amount = Number(payment.amount);
      method = payment.method;
      if (!method || !['cash', 'momo'].includes(method)) {
        throw new AppError('Valid payment method required (cash, momo)', 400);
      }
      paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
      if (Number.isNaN(paidAt.getTime())) throw new AppError('A valid payment date is required', 400);
    }

    const activeYear = await getActiveAcademicYear(client);
    const year = cleanText(admission_year ?? app.admission_year) || activeYear.split('/')[0];

    // Keep the profile details the fresher filled in at home (corrected if needed)
    const clean = (v) => cleanText(v);
    const fPhone = clean(phone ?? app.phone);
    const fEmail = clean(email ?? app.email);
    const fProgramme = clean(programme ?? app.programme);
    const fGender = clean(gender ?? app.gender);
    const fHometown = clean(hometown ?? app.hometown);

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
    
    if (amount > 0) {
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, student.id, 'SCH');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, NULL, $8) RETURNING *`,
        [
          receipt_number,
          student.id,
          method,
          paidAt,
          academicYear,
          req.user.id,
          student.department_id,
          amount,
        ]
      );
      await client.query(
        `INSERT INTO payments (receipt_id, type, amount, department_id, class_id)
         VALUES ($1, 'school_dues', $2, NULL, NULL)`,
        [rc.rows[0].id, amount]
      );
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
        description: `Recorded School Dues of GHS ${amount.toFixed(2)} for ${name} (${receipt_number}) at verification`,
        meta: {
          receipt_id: rc.rows[0].id,
          student_id: student.id,
          receipt_number,
          type: 'school_dues',
        },
      });
    } else if (hasSouvenirs) {
      // No payment, but souvenirs are being given — create a $0 souvenir-only receipt
      const academicYear = await getActiveAcademicYear(client);
      const receipt_number = await nextReceiptNumber(client, student.id, 'SCH');
      const rc = await client.query(
        `INSERT INTO receipts (receipt_number, student_id, method, paid_at, academic_year, record_type, recorded_by, department_id, class_id, total_amount)
             VALUES ($1, $2, 'cash', $3, $4, 'admin', $5, $6, NULL, 0) RETURNING *`,
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
    if (receiptNumber && amount > 0) {
      emitEvent('payment:new', {
        department_id: Number(department_id),
        student_id: student.id,
        receipt_number: receiptNumber,
        total: amount,
        source: 'verify',
      });
    }

    // Email the student a copy of the receipt if they provided an address
    // (either for a payment receipt or a souvenir-only receipt)
    if (receiptNumber && app.email) {
      const emailTotal = amount > 0 ? amount : 0;
      const emailLines = amount > 0 ? [{ type: 'school_dues', amount }] : [];
      const souvenirs = receiptId ? await getSouvenirNames(client, receiptId) : [];
      sendReceiptEmail({
        to: app.email,
        studentName: name,
        studentNo: no,
        receiptNumber,
        paidAt: paidAt || new Date(),
        method: method || 'cash',
        total: emailTotal,
        lines: emailLines,
        souvenirs,
      }).catch((err) => console.error('Receipt email error:', err.message));
    }

    res.status(201).json({ student, receipt_number: receiptNumber });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505')
      return next(new AppError('A student with this number already exists', 409));
    next(err);
  } finally {
    client.release();
  }
});

// ─── Remove an application (e.g. spam or a mistake) ───
// Hard delete so the student number can be submitted again.
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM fresher_applications WHERE id = $1 AND status <> 'verified' RETURNING id, full_name, student_no`,
      [Number(req.params.id)]
    );
    if (rows.length === 0) throw new AppError('Application not found or already verified', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: schoolActorRole(req.user),
      transaction_type: 'fresher_application_delete',
      description: `Removed fresher pre-registration for ${rows[0].full_name} (${rows[0].student_no})`,
      meta: { application_id: rows[0].id, student_no: rows[0].student_no },
    });

    emitEvent('fresher_application:removed', {});
    res.json({ message: 'Application removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
