const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { normalizeAcademicYear } = require('../utils/academicYear');
const { assertMainDues } = require('../utils/duesLimits');

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

// ─── Update the school-wide School Dues amount (School Admin only) ───
router.put('/school_dues_amount', requireSchoolAdmin, async (req, res, next) => {
  try {
    const raw = req.body.value;
    // Reject missing/empty input explicitly: Number('') === 0 would silently
    // store GHS 0 when the field is simply cleared.
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      throw new AppError('Enter an amount', 400);
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new AppError('A valid amount is required', 400);
    }
    // Money is stored to 2 decimal places — quantize instead of letting
    // float noise (e.g. 12.345000000000001) reach the database.
    const amount = Math.round(parsed * 100) / 100;
    assertMainDues(amount, 'School dues');
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
