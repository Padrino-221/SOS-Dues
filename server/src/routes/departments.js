const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');

function makeCode(name) {
  const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${clean}-${rand}`;
}

const router = express.Router();
router.use(requireAuth);

// ─── List departments ───
router.get('/', async (req, res, next) => {
  try {
    const query = req.user.role === 'school_admin'
      ? `SELECT d.*, COUNT(DISTINCT c.id) AS class_count, COUNT(DISTINCT s.id) AS student_count
         FROM departments d
         LEFT JOIN classes c ON c.department_id = d.id
         LEFT JOIN students s ON s.department_id = d.id
         GROUP BY d.id ORDER BY d.name`
      : `SELECT d.*, COUNT(DISTINCT c.id) AS class_count, COUNT(DISTINCT s.id) AS student_count
         FROM departments d
         LEFT JOIN classes c ON c.department_id = d.id
         LEFT JOIN students s ON s.department_id = d.id
         WHERE d.id = $1
         GROUP BY d.id ORDER BY d.name`;
    const params = req.user.role === 'school_admin' ? [] : [req.user.department_id];
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Get single department ───
router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'school_admin' && req.user.department_id !== Number(req.params.id)) {
      throw new AppError('Access denied', 403);
    }
    const { rows } = await pool.query('SELECT * FROM departments WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Department not found', 404);
    res.json(rows[0]);
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
    const code = makeCode(name);
    const { rows } = await pool.query(
      'INSERT INTO departments (name, dues_amount, code) VALUES ($1, $2, $3) RETURNING *',
      [name, amount, code]
    );

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'department_create',
      description: `Created department "${name}" with dues GHS ${amount}`,
      meta: { department_id: rows[0].id, name, dues_amount: amount },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Department already exists', 409));
    next(err);
  }
});

// ─── Update department dues amount ───
// School Admin: can update ANY department
// Dept Admin: can update ONLY their own department
router.put('/:id/dues', async (req, res, next) => {
  try {
    const { dues_amount } = req.body;
    if (dues_amount === undefined || dues_amount === null || isNaN(dues_amount)) {
      throw new AppError('Valid dues amount is required', 400);
    }

    const deptId = Number(req.params.id);

    // Enforce RBAC: Dept Admin can only modify their own department
    if (req.user.role === 'dept_admin' && req.user.department_id !== deptId) {
      throw new AppError('You can only configure your own department', 403);
    }

    const { rows } = await pool.query(
      'UPDATE departments SET dues_amount = $1 WHERE id = $2 RETURNING *',
      [dues_amount, deptId]
    );
    if (rows.length === 0) throw new AppError('Department not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'department_dues_update',
      description: `Updated dues for "${rows[0].name}" to GHS ${dues_amount}`,
      meta: { department_id: deptId, old_amount: rows[0].dues_amount, new_amount: dues_amount },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Full department update (School Admin only) ───
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

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Department already exists', 409));
    next(err);
  }
});

// ─── Delete department (School Admin only) ───
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING id, name', [req.params.id]);
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
