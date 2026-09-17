const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireAnyAdmin, isAnySchool } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { normalizeLevel } = require('../utils/levels');

const router = express.Router();
router.use(requireAuth);

function assertCanManageClasses(req, departmentId) {
  if (!['school_admin', 'dept_admin'].includes(req.user.role)) {
    throw new AppError('Only School or Department Admins can manage classes', 403);
  }
  if (req.user.role === 'dept_admin' && req.user.department_id !== Number(departmentId)) {
    throw new AppError('You can only manage classes in your own department', 403);
  }
}

// ─── List classes ───
// School Admin: all classes
// Dept Admin:   only their department's classes
router.get('/', async (req, res, next) => {
  try {
    const schoolSide = isAnySchool(req.user);
    const where = schoolSide ? '' : 'WHERE c.department_id = $1';
    const params = schoolSide ? [] : [req.user.department_id];
    const { rows } = await pool.query(
      `SELECT c.*, d.name AS department_name
       FROM classes c JOIN departments d ON d.id = c.department_id
       ${where} ORDER BY d.name, c.level, c.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Create a class / level within a department ───
// Dept Admin: only within their own department
// School Admin: can create classes for any department
router.post('/', requireAnyAdmin, async (req, res, next) => {
  try {
    const { department_id, level, name } = req.body;
    if (!department_id || !name) throw new AppError('Department and class name are required', 400);

    assertCanManageClasses(req, department_id);

    const rawLevel = level || name;
    const normLevel = normalizeLevel(rawLevel);
    const storedLevel = normLevel ? `Level ${normLevel}` : rawLevel;
    const { rows } = await pool.query(
      'INSERT INTO classes (department_id, level, name) VALUES ($1, $2, $3) RETURNING *',
      [department_id, storedLevel, name]
    );

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'class_create',
      description: `Created class "${name}"${level ? ` (${level})` : ''}`,
      meta: { class_id: rows[0].id, department_id, level, name },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return next(new AppError('Class already exists in this department', 409));
    next(err);
  }
});

// ─── Update a class ───
router.put('/:id', requireAnyAdmin, async (req, res, next) => {
  try {
    const { level, name } = req.body;
    if (!name) throw new AppError('Class name is required', 400);

    const cls = await pool.query('SELECT department_id, level FROM classes WHERE id = $1', [
      req.params.id,
    ]);
    if (cls.rows.length === 0) throw new AppError('Class not found', 404);
    assertCanManageClasses(req, cls.rows[0].department_id);

    // Keep the existing level when one isn't supplied — never re-derive the
    // level from the new name, which would corrupt grouping for digit-less names.
    const rawLevel = level || cls.rows[0].level;
    const normLevel = normalizeLevel(rawLevel);
    const storedLevel = normLevel ? `Level ${normLevel}` : rawLevel;
    const { rows } = await pool.query(
      'UPDATE classes SET level = $1, name = $2 WHERE id = $3 RETURNING *',
      [storedLevel, name, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return next(new AppError('Class already exists in this department', 409));
    next(err);
  }
});

// ─── Delete a class ───
router.delete('/:id', requireAnyAdmin, async (req, res, next) => {
  try {
    const cls = await pool.query('SELECT department_id FROM classes WHERE id = $1', [
      req.params.id,
    ]);
    if (cls.rows.length === 0) throw new AppError('Class not found', 404);
    assertCanManageClasses(req, cls.rows[0].department_id);

    await pool.query('DELETE FROM classes WHERE id = $1 RETURNING id', [req.params.id]);
    res.json({ message: 'Class deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
