const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { normalizeAcademicYear } = require('../utils/academicYear');

const router = express.Router();
router.use(requireAuth);

// ─── Get all settings ───
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  } catch (err) {
    next(err);
  }
});

// ─── Update the access code freshers need to fill the public form (School Admin) ───
router.put('/fresher_access_code', requireSchoolAdmin, async (req, res, next) => {
  try {
    const code = String(req.body.value || '').trim();
    if (code.length < 4) throw new AppError('Access code must be at least 4 characters', 400);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('fresher_access_code', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [code]
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'settings_update',
      description: 'Updated the fresher pre-registration access code',
      meta: { fresher_access_code: code },
    });
    res.json({ fresher_access_code: code });
  } catch (err) {
    next(err);
  }
});

// ─── Update the school-wide School Dues amount (School Admin only) ───
router.put('/school_dues_amount', requireSchoolAdmin, async (req, res, next) => {
  try {
    const amount = Number(req.body.value);
    if (isNaN(amount) || amount < 0) throw new AppError('A valid amount is required', 400);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('school_dues_amount', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(amount)]
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'settings_update',
      description: `Set school-wide School Dues amount to GHS ${amount}`,
      meta: { school_dues_amount: amount },
    });
    res.json({ school_dues_amount: String(amount) });
  } catch (err) {
    next(err);
  }
});

router.put('/active_academic_year', requireSchoolAdmin, async (req, res, next) => {
  try {
    const academicYear = normalizeAcademicYear(req.body.value);
    if (!academicYear) throw new AppError('Academic year must use format YYYY/YYYY', 400);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('active_academic_year', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [academicYear]
    );
    // Changing the active year (re)enables the rollover for a fresh transition,
    // so a new end-of-year rollover won't be blocked by the previous one.
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('last_rollover_to', '')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'settings_update',
      description: `Set active academic year to ${academicYear}`,
      meta: { active_academic_year: academicYear },
    });
    res.json({ active_academic_year: academicYear });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
