const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Enforce a minimum password strength for admin accounts.
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/\d/.test(password)) return 'Password must contain a number';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    // School admin sees all; school_staff is blocked; dept admins see only their department's dept users
    if (req.user.role === 'school_staff') throw new (require('../utils/errors').AppError)('Access denied', 403);
    if (req.user.role === 'dept_staff') throw new (require('../utils/errors').AppError)('Access denied', 403);
    if (req.user.role === 'dept_admin') {
      const role = String(req.query.role || '').toLowerCase();
      const targetRole = ['dept_admin', 'dept_staff'].includes(role) ? role : null;
      let where = 'WHERE u.department_id = $1';
      const params = [req.user.department_id];
      if (targetRole) {
        where += ` AND u.role = $${params.length + 1}`;
        params.push(targetRole);
      } else {
        where += ` AND u.role IN ('dept_admin','dept_staff')`;
      }
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.department_id, d.name AS department_name, u.created_at
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
         ${where} ORDER BY u.role, u.name`,
        params
      );
      return res.json(rows);
    }
    // school_admin
    const role = String(req.query.role || '').toLowerCase();
    let where = '';
    const params = [];
    if (['school_admin', 'school_staff', 'dept_admin', 'dept_staff'].includes(role)) {
      where = 'WHERE u.role = $1';
      params.push(role);
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.department_id, d.name AS department_name, u.created_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ${where} ORDER BY u.role, u.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, department_id, role } = req.body;
    const allowed = ['school_admin', 'school_staff', 'dept_admin', 'dept_staff'];
    const targetRole = allowed.includes(role) ? role : 'dept_admin';
    // Permission: school_admin can create any; dept_admin can only create dept_staff in own dept
    if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
      throw new (require('../utils/errors').AppError)('Access denied', 403);
    }
    if (req.user.role === 'dept_admin') {
      if (targetRole !== 'dept_staff') throw new (require('../utils/errors').AppError)('Dept admins can only create dept staff', 403);
      // force own department
      if (Number(department_id) !== req.user.department_id) {
        throw new (require('../utils/errors').AppError)('You can only create staff for your own department', 403);
      }
    }
    if (req.user.role === 'school_admin' && targetRole === 'school_admin') {
      // allowed — main creating another main
    }

    if (!name || !email || !password) {
      throw new AppError('Name, email and password are required', 400);
    }
    const passwordError = validatePassword(password);
    if (passwordError) throw new AppError(passwordError, 400);

    let deptId = null;
    if (targetRole === 'dept_admin' || targetRole === 'dept_staff') {
      const effectiveDeptId = department_id || (req.user.role === 'dept_admin' ? req.user.department_id : null);
      if (!effectiveDeptId) throw new AppError('Department is required for department accounts', 400);
      const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [effectiveDeptId]);
      if (dept.rows.length === 0) throw new AppError('Department not found', 404);
      deptId = effectiveDeptId;
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ($1, LOWER($2), $3, $4, $5) RETURNING id, name, email, role, department_id`,
      [name, email, hash, targetRole, deptId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Email already in use', 409));
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, email, password, department_id, role } = req.body;
    if (!name || !email) throw new AppError('Name and email are required', 400);

    // Permissions for updates
    if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
      throw new (require('../utils/errors').AppError)('Access denied', 403);
    }
    if (req.user.role === 'dept_admin') {
      const target = await pool.query('SELECT department_id, role FROM users WHERE id = $1', [req.params.id]);
      if (target.rows.length === 0) throw new AppError('Admin not found', 404);
      if (target.rows[0].department_id !== req.user.department_id || !['dept_admin', 'dept_staff'].includes(target.rows[0].role)) {
        throw new (require('../utils/errors').AppError)('You can only manage users in your own department', 403);
      }
      if (role && role !== 'dept_staff' && role !== 'dept_admin') {
        throw new (require('../utils/errors').AppError)('Dept admins can only set dept roles', 403);
      }
    }

    const existing = await pool.query('SELECT id, role, department_id FROM users WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) throw new AppError('Admin not found', 404);
    const currentRole = existing.rows[0].role;
    const allowedRoles = ['school_admin', 'school_staff', 'dept_admin', 'dept_staff'];
    const targetRole = role && allowedRoles.includes(role) ? role : currentRole;

    if ((targetRole === 'dept_admin' || targetRole === 'dept_staff') && !department_id && !existing.rows[0].department_id) {
      throw new AppError('Department is required for department accounts', 400);
    }

    let deptId = existing.rows[0].department_id;
    if (targetRole === 'dept_admin' || targetRole === 'dept_staff') {
      const effectiveDeptId = department_id || existing.rows[0].department_id || req.user.department_id;
      const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [effectiveDeptId]);
      if (dept.rows.length === 0) throw new AppError('Department not found', 404);
      deptId = effectiveDeptId;
    } else {
      deptId = null;
    }

    let result;
    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) throw new AppError(passwordError, 400);
      const hash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users SET name=$1, email=LOWER($2), password_hash=$3, department_id=$4, role=$5
         WHERE id=$6 RETURNING id, name, email, role, department_id`,
        [name, email, hash, deptId, targetRole, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET name=$1, email=LOWER($2), department_id=$3, role=$4
         WHERE id=$5 RETURNING id, name, email, role, department_id`,
        [name, email, deptId, targetRole, req.params.id]
      );
    }
    if (result.rows.length === 0) throw new AppError('Admin not found', 404);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Email already in use', 409));
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      throw new AppError('You cannot delete your own account', 400);
    }
    if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
      throw new (require('../utils/errors').AppError)('Access denied', 403);
    }
    if (req.user.role === 'dept_admin') {
      const target = await pool.query('SELECT department_id, role FROM users WHERE id = $1', [req.params.id]);
      if (target.rows.length === 0) throw new AppError('Admin not found', 404);
      if (target.rows[0].department_id !== req.user.department_id || target.rows[0].role !== 'dept_staff') {
        throw new (require('../utils/errors').AppError)('Dept admins can only delete dept staff in own department', 403);
      }
    }
    const { rows } = await pool.query('DELETE FROM users WHERE id=$1 RETURNING id, role', [req.params.id]);
    if (rows.length === 0) throw new AppError('Admin not found', 404);
    const label =
      rows[0].role === 'school_admin'
        ? 'School admin'
        : rows[0].role === 'school_staff'
          ? 'School staff'
          : rows[0].role === 'dept_staff'
            ? 'Department staff'
            : 'Department admin';
    res.json({ message: `${label} deleted` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
