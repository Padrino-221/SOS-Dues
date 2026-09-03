const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { generateReceiptNumber } = require('../utils/receipt');
const { logTransaction } = require('../utils/audit');
const { sendDepartmentReceipt } = require('../utils/email');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Get department info + classes by dept access code
router.get('/departments/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, dues_amount, code FROM departments WHERE code = $1`,
      [req.params.code]
    );
    if (rows.length === 0) throw new AppError('Invalid access code', 404);
    const dept = rows[0];

    const classes = await pool.query(
      `SELECT id, name, level FROM classes WHERE department_id = $1 ORDER BY name`,
      [dept.id]
    );

    res.json({ ...dept, classes: classes.rows });
  } catch (err) {
    next(err);
  }
});

// Record payment for a class within a department
router.post('/departments/:code/classes/:classId/payments', limiter, async (req, res, next) => {
  try {
    const { code, classId } = req.params;
    const { student_no, name, amount, method, paid_at } = req.body;

    if (!student_no || !name) throw new AppError('Student number and name are required', 400);
    if (!amount || isNaN(amount) || Number(amount) <= 0) throw new AppError('Valid amount is required', 400);
    if (!['cash', 'momo', 'bank'].includes(method)) throw new AppError('Valid payment method required', 400);

    // Verify dept code
    const deptResult = await pool.query('SELECT id, name FROM departments WHERE code = $1', [code]);
    if (deptResult.rows.length === 0) throw new AppError('Invalid access code', 404);
    const deptId = deptResult.rows[0].id;

    // Verify class belongs to this department
    const clsResult = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND department_id = $2',
      [classId, deptId]
    );
    if (clsResult.rows.length === 0) throw new AppError('Invalid class for this department', 404);

    // Find or create the student
    let student;
    const existing = await pool.query('SELECT id FROM students WHERE student_no = $1', [student_no]);
    if (existing.rows.length > 0) {
      student = existing.rows[0];
      await pool.query(
        'UPDATE students SET department_id=$1, class_id=$2 WHERE id=$3',
        [deptId, classId, student.id]
      );
    } else {
      const created = await pool.query(
        `INSERT INTO students (name, student_no, department_id, class_id, is_fresher, admission_year)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
        [name, student_no, deptId, classId, String(new Date().getFullYear())]
      );
      student = created.rows[0];
    }

    const receipt_number = generateReceiptNumber('DUES');
    const paidAtDate = paid_at ? new Date(paid_at) : new Date();

    const { rows } = await pool.query(
      `INSERT INTO payments
         (student_id, type, amount, method, department_id, record_type, class_id, paid_at, receipt_number)
       VALUES ($1, 'department_dues', $2, $3, $4, 'rep', $5, $6, $7)
       RETURNING *`,
      [student.id, amount, method, deptId, classId, paidAtDate, receipt_number]
    );

    // Audit log
    logTransaction({
      admin_id: null,
      admin_role: 'REP',
      transaction_type: 'payment',
      description: `Class rep recorded Dept Dues of GHS ${Number(amount).toFixed(2)} for ${name} (${receipt_number})`,
      meta: {
        payment_id: rows[0].id,
        student_id: student.id,
        student_name: name,
        type: 'department_dues',
        amount: Number(amount),
        method,
        receipt_number,
        department_id: deptId,
        class_id: Number(classId),
      },
    });

    // Email receipt
    sendDepartmentReceipt({
      studentName: name,
      studentNo: student_no,
      amount,
      receiptNumber: receipt_number,
      paidAt: paidAtDate,
      departmentName: deptResult.rows[0]?.name,
    }).catch(() => {});

    res.status(201).json({
      receipt_number,
      student: name,
      amount,
      method,
      paid_at: paidAtDate,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
