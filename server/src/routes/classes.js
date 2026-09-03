const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin, requireAnyAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const where = req.user.role === 'school_admin' ? '' : 'WHERE c.department_id = $1';
    const params = req.user.role === 'school_admin' ? [] : [req.user.department_id];
    const { rows } = await pool.query(
      `SELECT c.*, d.name AS department_name
       FROM classes c JOIN departments d ON d.id = c.department_id
       ${where} ORDER BY d.name, c.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAnyAdmin, async (req, res, next) => {
  try {
    const { department_id, name, level } = req.body;
    if (!department_id || !name) throw new AppError('Department and class name required', 400);

    // Dept admins can only create classes in their own department
    if (req.user.role === 'dept_admin' && req.user.department_id !== Number(department_id)) {
      throw new AppError('You can only create classes in your own department', 403);
    }

    const { rows } = await pool.query(
      'INSERT INTO classes (department_id, name, level) VALUES ($1, $2, $3) RETURNING *',
      [department_id, name, level || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Class already exists in this department', 409));
    next(err);
  }
});

router.put('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { name, level } = req.body;
    const { rows } = await pool.query(
      'UPDATE classes SET name = $1, level = $2 WHERE id = $3 RETURNING *',
      [name, level || '', req.params.id]
    );
    if (rows.length === 0) throw new AppError('Class not found', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) throw new AppError('Class not found', 404);
    res.json({ message: 'Class deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
