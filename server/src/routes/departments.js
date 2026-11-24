const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin, isAnySchool } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { assertMainDues } = require('../utils/duesLimits');

// Never expose the pin hash to clients — only whether one is set.
function publicDept(row) {
  if (!row) return row;
  const { pin, ...rest } = row;
  return { ...rest, pin_set: Boolean(pin) };
}

function makeCode(name) {
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${clean}-${rand}`;
}

// Parse a money amount and quantize it to 2 decimal places. Empty or
// non-numeric input is rejected explicitly: Number('') === 0, which would
// silently store GHS 0 when a field is cleared by mistake.
function parseMoney(raw, label = 'amount') {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new AppError('Enter an amount', 400);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`A valid ${label} is required`, 400);
  return Math.round(n * 100) / 100;
}

const router = express.Router();
router.use(requireAuth);

// ─── List departments ───
// School Admin: all departments with stats
// Dept Admin:   only their own department (includes the public rep code)
// Counts are fresher workflow stats — payment activity lives in the
// reports summary (payers, receipts, totals).
router.get('/', async (req, res, next) => {
  try {
    const query = isAnySchool(req.user)
      ? 'SELECT d.* FROM departments d ORDER BY d.name'
      : 'SELECT d.* FROM departments d WHERE d.id = $1';
    const params = isAnySchool(req.user) ? [] : [req.user.department_id];
    const { rows } = await pool.query(query, params);
    res.json(rows.map(publicDept));
  } catch (err) {
    next(err);
  }
});

// ─── Get single department ───
router.get('/:id', async (req, res, next) => {
  try {
    if (!isAnySchool(req.user) && req.user.department_id !== Number(req.params.id)) {
      throw new AppError('Access denied', 403);
    }
    const { rows } = await pool.query('SELECT * FROM departments WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Department not found', 404);
    res.json(publicDept(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ─── Create department (School Admin only) ───
router.post('/', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { name, dues_amount } = req.body;
    if (!name) throw new AppError('Department name is required', 400);
    const amount =
      dues_amount === undefined || dues_amount === null
        ? 0
        : parseMoney(dues_amount, 'dues amount');
    assertMainDues(amount, 'Department dues');
    // Retry on a rare public-code collision (unique code). The name-unique
    // constraint still surfaces as 23505 below after exhausting retries.
    let rows;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await pool.query(
          'INSERT INTO departments (name, dues_amount, code) VALUES ($1, $2, $3) RETURNING *',
          [name, amount, makeCode(name)]
        );
        rows = r.rows;
        break;
      } catch (err) {
        if (err.code === '23505' && attempt < 4) continue;
        throw err;
      }
    }

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_create',
      description: `Created department "${name}" with dues GHS ${amount}`,
      meta: { department_id: rows[0].id, name, dues_amount: amount },
    });

    res.status(201).json(publicDept(rows[0]));
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Department already exists', 409));
    next(err);
  }
});

// ─── Update department (School Admin only) ───
router.put('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { name, dues_amount } = req.body;
    if (!name) throw new AppError('Department name is required', 400);
    const dues =
      dues_amount === undefined || dues_amount === null
        ? 0
        : parseMoney(dues_amount, 'dues amount');
    assertMainDues(dues, 'Department dues');
    const { rows } = await pool.query(
      'UPDATE departments SET name = $1, dues_amount = $2 WHERE id = $3 RETURNING *',
      [name, dues, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_update',
      description: `Updated department "${name}"`,
      meta: { department_id: Number(req.params.id), name, dues_amount: dues },
    });

    res.json(publicDept(rows[0]));
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Department already exists', 409));
    next(err);
  }
});

// ─── Permission check: owning Dept Admin, or School Admin ───
function assertCanConfigure(req, deptId) {
  if (!['school_admin', 'dept_admin'].includes(req.user.role)) {
    throw new AppError('Only School or Department Admins can configure departments', 403);
  }
  if (req.user.role === 'dept_admin' && req.user.department_id !== Number(deptId)) {
    throw new AppError('You can only configure your own department', 403);
  }
}

// ─── Set / change the collector PIN (owning Dept Admin, or School Admin) ───
// Class reps must enter this PIN once per session before they can record any
// payment. Without it, a leaked department code alone is not enough.
router.put('/:id/pin', async (req, res, next) => {
  try {
    assertCanConfigure(req, req.params.id);

    const raw = String(req.body.pin ?? '').trim();
    if (!/^\d{4,8}$/.test(raw)) {
      throw new AppError('PIN must be 4–8 digits', 400);
    }

    const hash = await bcrypt.hash(raw, 10);
    const { rows } = await pool.query(
      'UPDATE departments SET pin = $1, pin_version = pin_version + 1 WHERE id = $2 RETURNING *',
      [hash, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'super_admin' ? 'SUPER_ADMIN' : req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'department_update',
      description: `${rows[0].name}: collector PIN set`,
      meta: { department_id: Number(req.params.id) },
    });

    res.json(publicDept(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ─── Remove the collector PIN ───
router.delete('/:id/pin', async (req, res, next) => {
  try {
    assertCanConfigure(req, req.params.id);
    const { rows } = await pool.query(
      'UPDATE departments SET pin = NULL, pin_version = pin_version + 1 WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'super_admin' ? 'SUPER_ADMIN' : req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'department_update',
      description: `${rows[0].name}: collector PIN removed`,
      meta: { department_id: Number(req.params.id) },
    });

    res.json(publicDept(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ─── Set the department's dues amount (owning Dept Admin, or School Admin) ───
// Dept Admins configure the dues amount charged to students in their department.
router.put('/:id/dues', async (req, res, next) => {
  try {
    assertCanConfigure(req, req.params.id);
    const amount = parseMoney(req.body.dues_amount, 'dues amount');
    assertMainDues(amount, 'Department dues');

    const { rows } = await pool.query(
      'UPDATE departments SET dues_amount = $1 WHERE id = $2 RETURNING *',
      [amount, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'super_admin' ? 'SUPER_ADMIN' : req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'department_update',
      description: `Set ${rows[0].name} dues amount to GHS ${amount}`,
      meta: { department_id: Number(req.params.id), dues_amount: amount },
    });

    res.json(publicDept(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ─── Regenerate public rep code (School Admin only) ───
router.post('/:id/regenerate-code', requireSchoolAdmin, async (req, res, next) => {
  try {
    const dept = await pool.query('SELECT name FROM departments WHERE id = $1', [req.params.id]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);
    // Retry on a rare code collision, then log the change like every other
    // department mutation.
    let rows;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await pool.query('UPDATE departments SET code = $1 WHERE id = $2 RETURNING *', [
          makeCode(dept.rows[0].name),
          req.params.id,
        ]);
        rows = r.rows;
        break;
      } catch (err) {
        if (err.code === '23505' && attempt < 4) continue;
        throw err;
      }
    }
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_update',
      description: `Regenerated ${rows[0].name} public rep code`,
      meta: { department_id: Number(req.params.id), code: rows[0].code },
    });
    res.json(publicDept(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ─── Delete department (School Admin only) ───
// A department with payment history must NOT be deleted: receipts.department_id
// is ON DELETE SET NULL, so the receipts would survive with a blank department
// (invisible/mislabelled in reports and CSV), while students cascade
// away. Block that case with the real counts; otherwise remove the department
// together with its staff accounts so a dept_admin cannot keep logging in to a
// department that no longer exists.
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deptRes = await client.query('SELECT id, name FROM departments WHERE id = $1 FOR UPDATE', [
      req.params.id,
    ]);
    if (deptRes.rows.length === 0) throw new AppError('Department not found', 404);
    const deptName = deptRes.rows[0].name;

    // Receipts tagged with this department, plus receipts belonging to this
    // department's students (deleting the department cascades to students and
    // would cascade-destroy those receipts too).
    const receiptsRes = await client.query(
      `SELECT COUNT(*)::int AS receipts,
              COALESCE(SUM(r.total_amount) FILTER (WHERE r.voided_at IS NULL), 0) AS amount
       FROM receipts r
       LEFT JOIN students s ON s.id = r.student_id
       WHERE r.department_id = $1 OR s.department_id = $1`,
      [req.params.id]
    );
    const paymentsRes = await client.query(
      'SELECT COUNT(*)::int AS payments FROM payments WHERE department_id = $1',
      [req.params.id]
    );
    const receiptCount = receiptsRes.rows[0].receipts;
    const amount = Number(receiptsRes.rows[0].amount);
    const paymentCount = paymentsRes.rows[0].payments;

    if (receiptCount > 0) {
      throw new AppError(
        `This department has ${receiptCount} receipt${receiptCount === 1 ? '' : 's'} (GHS ${amount.toFixed(
          2
        )}). Archive it instead.`,
        409
      );
    }
    if (paymentCount > 0) {
      throw new AppError(
        `This department has ${paymentCount} recorded payment${
          paymentCount === 1 ? '' : 's'
        }. Archive it instead.`,
        409
      );
    }

    const usersRes = await client.query(
      `DELETE FROM users WHERE department_id = $1 AND role IN ('dept_admin', 'dept_staff')
       RETURNING id, name`,
      [req.params.id]
    );
    const delRes = await client.query('DELETE FROM departments WHERE id = $1 RETURNING id, name', [
      req.params.id,
    ]);
    if (delRes.rows.length === 0) throw new AppError('Department not found', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_delete',
      description: `Deleted department "${deptName}" (${
        usersRes.rows.length
      } staff account${usersRes.rows.length === 1 ? '' : 's'} removed)`,
      meta: {
        department_id: delRes.rows[0].id,
        name: deptName,
        users_removed: usersRes.rows.map((u) => ({ id: u.id, name: u.name })),
      },
      client,
    });
    await client.query('COMMIT');

    res.json({ message: 'Department deleted', users_removed: usersRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
