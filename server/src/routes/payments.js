const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { generateReceiptNumber } = require('../utils/receipt');
const { requireAuth, requireAnyAdmin, requireDeptAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { sendSchoolReceipt, sendDepartmentReceipt } = require('../utils/email');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

// ─── Record payment for a student ───
// RBAC:
//   School Admin  → can ONLY record 'school_dues'
//   Dept Admin    → can ONLY record 'department_dues' (for students in their dept)
router.post('/students/:id/pay', async (req, res, next) => {
  try {
    const { type, amount, method, souvenir_ids, paid_at } = req.body;
    if (!['school_dues', 'department_dues'].includes(type)) {
      throw new AppError('Valid payment type required (school_dues or department_dues)', 400);
    }
    if (!amount || isNaN(amount) || Number(amount) <= 0) throw new AppError('Valid amount is required', 400);
    if (!['cash', 'momo', 'bank'].includes(method)) throw new AppError('Valid payment method required', 400);

    // ── RBAC ENFORCEMENT ──
    if (req.user.role === 'school_admin' && type === 'department_dues') {
      throw new AppError('School Admins cannot record Department Dues. Only Department Admins can do this.', 403);
    }
    if (req.user.role === 'dept_admin' && type === 'school_dues') {
      throw new AppError('Department Admins cannot record School Dues. Only School Admins can do this.', 403);
    }

    const studentId = Number(req.params.id);
    const student = await pool.query('SELECT * FROM students WHERE id=$1', [studentId]);
    if (student.rows.length === 0) throw new AppError('Student not found', 404);
    const stu = student.rows[0];

    // Dept admins can only record payments for students in their department
    if (req.user.role === 'dept_admin') {
      if (stu.department_id && stu.department_id !== req.user.department_id) {
        throw new AppError('You can only record payments for students in your department', 403);
      }
    }

    let departmentId = stu.department_id;

    if (type === 'department_dues') {
      if (req.user.role === 'dept_admin') {
        departmentId = req.user.department_id;
      }
      if (!departmentId) throw new AppError('Student has no department', 400);

      // Sequential validation: school dues must be paid first
      const schoolDuesCheck = await pool.query(
        'SELECT id FROM payments WHERE student_id = $1 AND type = $2',
        [studentId, 'school_dues']
      );
      if (schoolDuesCheck.rows.length === 0) {
        throw new AppError('School Dues Unpaid. Student must clear School Dues first.', 400);
      }

      // Assign department/class if not set
      if (!stu.department_id) {
        await pool.query('UPDATE students SET department_id=$1 WHERE id=$2', [departmentId, studentId]);
      }
    }

    // For school_dues, department is null (school-level payment)
    if (type === 'school_dues') {
      departmentId = null;
    }

    const receipt_number = generateReceiptNumber(type === 'school_dues' ? 'SCH' : 'DEPT');
    const paidAtDate = paid_at ? new Date(paid_at) : new Date();
    const adminRole = req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN';

    const { rows } = await pool.query(
      `INSERT INTO payments
         (student_id, type, amount, method, department_id, record_type, recorded_by, admin_role, paid_at, receipt_number)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8, $9)
       RETURNING *`,
      [studentId, type, amount, method, departmentId, req.user.id, adminRole, paidAtDate, receipt_number]
    );
    const payment = rows[0];

    // ── SOUVENIRS ──
    let souvenirNames = [];
    if (Array.isArray(souvenir_ids) && souvenir_ids.length > 0 && type === 'school_dues') {
      await pool.query(
        `INSERT INTO student_souvenirs (student_id, souvenir_id, level, given_by)
         SELECT $1, id, 'school', $2 FROM souvenirs WHERE id = ANY($3::int[])`,
        [studentId, req.user.id, souvenir_ids]
      );
      // Fetch souvenir names for email
      const svRes = await pool.query('SELECT name FROM souvenirs WHERE id = ANY($1::int[])', [souvenir_ids]);
      souvenirNames = svRes.rows.map(s => s.name);
    }

    // ── AUDIT LOG ──
    const receiptAmount = Number(amount).toFixed(2);
    logTransaction({
      admin_id: req.user.id,
      admin_role: adminRole,
      transaction_type: 'payment',
      description: `Recorded ${type === 'school_dues' ? 'School' : 'Department'} Dues of GHS ${receiptAmount} for ${stu.name} (${receipt_number})`,
      meta: {
        payment_id: payment.id,
        student_id: studentId,
        student_name: stu.name,
        type,
        amount: Number(amount),
        method,
        receipt_number,
        department_id: departmentId,
      },
    });

    // ── EMAIL RECEIPT ──
    const emailPayload = {
      studentName: stu.name,
      studentNo: stu.student_no,
      amount,
      receiptNumber: receipt_number,
      paidAt: paidAtDate,
    };

    if (type === 'school_dues') {
      sendSchoolReceipt({ ...emailPayload, souvenirs: souvenirNames }).catch(() => {});
    } else {
      // Fetch department name for the email
      const deptRes = await pool.query('SELECT name FROM departments WHERE id = $1', [departmentId]);
      sendDepartmentReceipt({ ...emailPayload, departmentName: deptRes.rows[0]?.name, souvenirs: souvenirNames }).catch(() => {});
    }

    res.status(201).json({ ...payment });
  } catch (err) {
    next(err);
  }
});

// ─── Record department souvenirs for a student ───
// Only Dept Admin can record department souvenirs
router.post('/students/:id/souvenirs/department', async (req, res, next) => {
  try {
    // RBAC: Only Dept Admin can distribute department souvenirs
    if (req.user.role !== 'dept_admin') {
      throw new AppError('Only Department Admins can record department souvenirs', 403);
    }

    const { souvenir_ids } = req.body;
    const studentId = Number(req.params.id);
    const student = await pool.query('SELECT * FROM students WHERE id=$1', [studentId]);
    if (student.rows.length === 0) throw new AppError('Student not found', 404);
    if (!student.rows[0].department_id) throw new AppError('Student has no department', 400);

    // Dept admins can only record souvenirs for students in their department
    if (student.rows[0].department_id !== req.user.department_id) {
      throw new AppError('You can only record souvenirs for students in your department', 403);
    }

    if (!Array.isArray(souvenir_ids) || souvenir_ids.length === 0) {
      throw new AppError('Select at least one souvenir', 400);
    }

    await pool.query(
      `INSERT INTO student_souvenirs (student_id, souvenir_id, level, given_by)
       SELECT $1, id, 'department', $2 FROM souvenirs WHERE id = ANY($3::int[])`,
      [studentId, req.user.id, souvenir_ids]
    );

    // Fetch souvenir names for email
    const svRes = await pool.query('SELECT name FROM souvenirs WHERE id = ANY($1::int[])', [souvenir_ids]);
    const souvenirNames = svRes.rows.map(s => s.name);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'DEPT_ADMIN',
      transaction_type: 'souvenir_distribution',
      description: `Distributed ${souvenir_ids.length} department souvenir(s) to ${student.rows[0].name}`,
      meta: {
        student_id: studentId,
        student_name: student.rows[0].name,
        souvenir_ids,
        souvenir_names: souvenirNames,
        level: 'department',
      },
    });

    res.status(201).json({ message: 'Department souvenirs recorded', count: souvenir_ids.length });
  } catch (err) {
    next(err);
  }
});

// ─── Verify receipt by number ───
router.get('/receipts/:number', async (req, res, next) => {
  try {
    let where = 'p.receipt_number = $1';
    const params = [req.params.number];

    // Dept admins can only see receipts for their department
    if (req.user.role === 'dept_admin') {
      where += ' AND p.department_id = $2';
      params.push(req.user.department_id);
    }

    const { rows } = await pool.query(
      `SELECT p.*, s.name AS student_name, s.student_no, d.name AS department_name,
              c.name AS class_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       LEFT JOIN departments d ON d.id = p.department_id
       LEFT JOIN classes c ON c.id = p.class_id
       WHERE ${where}`,
      params
    );
    if (rows.length === 0) throw new AppError('Receipt not found', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Update payment (amount, method, paid_at) ───
router.put('/:id', async (req, res, next) => {
  try {
    const { amount, method, paid_at } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) throw new AppError('Valid amount is required', 400);
    if (!['cash', 'momo', 'bank'].includes(method)) throw new AppError('Valid payment method required', 400);

    let where = 'id = $4';
    const params = [amount, method, paid_at ? new Date(paid_at) : new Date(), req.params.id];
    if (req.user.role === 'dept_admin') {
      where += ' AND department_id = $5';
      params.push(req.user.department_id);
    }

    const { rows } = await pool.query(
      `UPDATE payments SET amount=$1, method=$2, paid_at=$3 WHERE ${where} RETURNING *`,
      params
    );
    if (rows.length === 0) throw new AppError('Payment not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'payment_update',
      description: `Updated payment ${rows[0].receipt_number} — GHS ${Number(amount).toFixed(2)}`,
      meta: { payment_id: rows[0].id, receipt_number: rows[0].receipt_number, amount: Number(amount), method },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── List payments ───
router.get('/', async (req, res, next) => {
  try {
    const { type, department_id, student_id } = req.query;
    const params = [];
    let where = [];
    if (req.user.role === 'dept_admin') {
      params.push(req.user.department_id);
      where.push(`p.department_id = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`p.type = $${params.length}`);
    }
    if (department_id && req.user.role === 'school_admin') {
      params.push(department_id);
      where.push(`p.department_id = $${params.length}`);
    }
    if (student_id) {
      params.push(student_id);
      where.push(`p.student_id = $${params.length}`);
    }
    const qs = `SELECT p.*, s.name AS student_name, s.student_no, d.name AS department_name, c.name AS class_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       LEFT JOIN departments d ON d.id = p.department_id
       LEFT JOIN classes c ON c.id = p.class_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.created_at DESC LIMIT 500`;
    const { rows } = await pool.query(qs, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
