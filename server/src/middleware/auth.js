const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    // Env-tunable so a deployment can tighten the window without a code
    // change; one day by default (was a hardcoded 7d). JWT_EXPIRES_IN — the
    // old variable — is deliberately no longer read.
    { expiresIn: process.env.JWT_TTL || '24h' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('Not authenticated', 401);

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if(payload.sso_sid){const user=await require('../services/staff-sso').authenticate(payload.sso_sid);if(!user)throw new AppError('Staff Access permission has ended. Sign in again.',401);req.user=user;return next();}
    const { rows } = await pool.query(
      'SELECT id, name, email, role, department_id FROM users WHERE id = $1',
      [payload.id]
    );
    if (rows.length === 0) throw new AppError('User no longer exists', 401);

    if(process.env.STAFF_SSO_ENABLED==='true'&&await require('../services/staff-sso').linked(rows[0].id))throw new AppError('Use Staff Access to sign in.',401);
    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      // One clean, client-facing message: the SPA treats any 401 as "session
      // ended" and shows this in the fallback path.
      return next(new AppError('Session expired. Please sign in again.', 401));
    }
    next(err);
  }
}

function requireSchoolAdmin(req, res, next) {
  // Super admin inherits every school-admin ability.
  if (!req.user || !['school_admin', 'super_admin'].includes(req.user.role)) {
    return next(new AppError('School admin access required', 403));
  }
  next();
}

function requireSchoolStaff(req, res, next) {
  if (!req.user || req.user.role !== 'school_staff') {
    return next(new AppError('School staff access required', 403));
  }
  next();
}

function requireAnySchool(req, res, next) {
  if (!req.user || !['school_admin', 'school_staff', 'super_admin'].includes(req.user.role)) {
    return next(new AppError('School access required', 403));
  }
  next();
}

function isAnySchool(user) {
  return user && ['school_admin', 'school_staff', 'super_admin'].includes(user.role);
}

function requireDeptAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'dept_admin') {
    return next(new AppError('Department admin access required', 403));
  }
  next();
}

function requireDeptStaff(req, res, next) {
  if (!req.user || req.user.role !== 'dept_staff') {
    return next(new AppError('Department staff access required', 403));
  }
  next();
}

function requireAnyDept(req, res, next) {
  if (!req.user || !['dept_admin', 'dept_staff'].includes(req.user.role)) {
    return next(new AppError('Department access required', 403));
  }
  next();
}

function isAnyDept(user) {
  return user && ['dept_admin', 'dept_staff'].includes(user.role);
}

function requireAnyAdmin(req, res, next) {
  if (
    !req.user ||
    !['school_admin', 'school_staff', 'dept_admin', 'dept_staff', 'super_admin'].includes(req.user.role)
  ) {
    return next(new AppError('Admin access required', 403));
  }
  next();
}

// Gate for the super-admin-only powers (resend email, edit/reopen
// applications, guarded student delete, admin account management).
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return next(new AppError('Super admin access required', 403));
  }
  next();
}

module.exports = {
  signToken,
  requireAuth,
  requireSchoolAdmin,
  requireSchoolStaff,
  requireAnySchool,
  isAnySchool,
  requireDeptAdmin,
  requireDeptStaff,
  requireAnyDept,
  isAnyDept,
  requireAnyAdmin,
  requireSuperAdmin,
};
