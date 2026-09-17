const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin, isAnySchool } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');

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

const router = express.Router();
router.use(requireAuth);

// ─── List departments ───
// School Admin: all departments with stats
// Dept Admin:   only their own department (includes the public rep code)
router.get('/', async (req, res, next) => {
  try {
    const query =
      isAnySchool(req.user)
        ? `SELECT d.*,
           COUNT(DISTINCT c.id) AS class_count,
           COUNT(DISTINCT s.id) AS student_count,
           COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher) AS fresher_count
         FROM departments d
         LEFT JOIN classes c ON c.department_id = d.id
         LEFT JOIN students s ON s.department_id = d.id
         GROUP BY d.id ORDER BY d.name`
        : `SELECT d.*,
           COUNT(DISTINCT c.id) AS class_count,
           COUNT(DISTINCT s.id) AS student_count,
           COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher) AS fresher_count
         FROM departments d
         LEFT JOIN classes c ON c.department_id = d.id
         LEFT JOIN students s ON s.department_id = d.id
         WHERE d.id = $1
         GROUP BY d.id`;
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
    const amount = dues_amount ?? 0;
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
    const { rows } = await pool.query(
      'UPDATE departments SET name = $1, dues_amount = $2 WHERE id = $3 RETURNING *',
      [name, dues_amount ?? 0, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_update',
      description: `Updated department "${name}"`,
      meta: { department_id: Number(req.params.id), name, dues_amount },
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
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
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
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
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
    const amount = Number(req.body.dues_amount);
    if (isNaN(amount) || amount < 0) throw new AppError('A valid dues amount is required', 400);

    const { rows } = await pool.query(
      'UPDATE departments SET dues_amount = $1 WHERE id = $2 RETURNING *',
      [amount, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
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
        const r = await pool.query(
          'UPDATE departments SET code = $1 WHERE id = $2 RETURNING *',
          [makeCode(dept.rows[0].name), req.params.id]
        );
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
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING id, name', [
      req.params.id,
    ]);
    if (rows.length === 0) throw new AppError('Department not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_delete',
      description: `Deleted department "${rows[0].name}"`,
      meta: { department_id: rows[0].id, name: rows[0].name },
    });

    res.json({ message: 'Department deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
