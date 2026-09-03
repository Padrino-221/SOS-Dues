const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('Not authenticated', 401);

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, name, email, role, department_id FROM users WHERE id = $1',
      [payload.id]
    );
    if (rows.length === 0) throw new AppError('User no longer exists', 401);

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401));
    }
    next(err);
  }
}

function requireSchoolAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'school_admin') {
    return next(new AppError('School admin access required', 403));
  }
  next();
}

function requireDeptAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'dept_admin') {
    return next(new AppError('Department admin access required', 403));
  }
  next();
}

function requireAnyAdmin(req, res, next) {
  if (!req.user || !['school_admin', 'dept_admin'].includes(req.user.role)) {
    return next(new AppError('Admin access required', 403));
  }
  next();
}

module.exports = { signToken, requireAuth, requireSchoolAdmin, requireDeptAdmin, requireAnyAdmin };
