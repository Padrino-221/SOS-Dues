const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { signToken } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Throttle login attempts to blunt brute-force on admin accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Wait 15 minutes and try again.',
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError('Email and password are required', 400);

    const { rows } = await pool.query(
      `SELECT u.*, d.name AS department_name, d.code AS department_code
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );
    if (rows.length === 0) throw new AppError('Invalid credentials', 401);

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department_id: user.department_id,
        department_name: user.department_name,
        department_code: user.department_code,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.department_id,
              d.name AS department_name, d.code AS department_code
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
