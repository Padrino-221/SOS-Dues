const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireSchoolAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.department_id, d.name AS department_name, u.created_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role = 'dept_admin' ORDER BY u.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, department_id } = req.body;
    if (!name || !email || !password || !department_id) {
      throw new AppError('Name, email, password and department are required', 400);
    }
    const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (dept.rows.length === 0) throw new AppError('Department not found', 404);

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ($1, LOWER($2), $3, 'dept_admin', $4) RETURNING id, name, email, department_id`,
      [name, email, hash, department_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Email already in use', 409));
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, email, password, department_id } = req.body;
    if (!name || !email || !department_id) throw new AppError('Name, email and department required', 400);

    let result;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users SET name=$1, email=LOWER($2), password_hash=$3, department_id=$4
         WHERE id=$5 AND role='dept_admin' RETURNING id, name, email, department_id`,
        [name, email, hash, department_id, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET name=$1, email=LOWER($2), department_id=$3
         WHERE id=$4 AND role='dept_admin' RETURNING id, name, email, department_id`,
        [name, email, department_id, req.params.id]
      );
    }
    if (result.rows.length === 0) throw new AppError('Department admin not found', 404);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Email already in use', 409));
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='dept_admin' RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) throw new AppError('Department admin not found', 404);
    res.json({ message: 'Department admin deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
