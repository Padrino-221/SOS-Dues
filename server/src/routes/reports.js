const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAnyAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin, (req, res, next) => {
  if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
    return next(new (require('../utils/errors').AppError)('Access denied', 403));
  }
  next();
});

function dateFilter(alias, params, from, to) {
  let clause = ` AND ${alias}.voided_at IS NULL`;
  if (from) {
    params.push(from);
    clause += ` AND ${alias}.paid_at >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    clause += ` AND ${alias}.paid_at < ($${params.length}::date + INTERVAL '1 day')`;
  }
  return clause;
}

function academicYearFilter(alias, params, academicYear) {
  if (!academicYear) return '';
  params.push(academicYear);
  return ` AND ${alias}.academic_year = $${params.length}`;
}

// ─── Summary: departments, classes, totals ───
router.get('/summary', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to, academic_year } = req.query;

    // ── Departments (dept-dues revenue + student counts) ──
    const dp = [];
    let deptScope = '';
    if (isDept) {
      dp.push(req.user.department_id);
      deptScope = ` AND d.id = $${dp.length}`;
    }
    // paid_at lives on receipts — always join so the date filter can use it
    const deptDate = dateFilter('r', dp, from, to);
    const deptAcademic = academicYearFilter('r', dp, academic_year);

    const departments = await pool.query(
      `
      SELECT d.id, d.name, d.dues_amount,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_archived = false AND s.is_graduated = false) AS student_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher AND s.is_archived = false) AS fresher_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher AND s.admitted_at IS NOT NULL AND s.is_archived = false) AS admitted_fresher_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher AND s.admitted_at IS NULL AND s.is_archived = false) AS pending_fresher_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_graduated = true) AS graduated_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_archived = true) AS archived_count,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          JOIN receipts r ON r.id = p.receipt_id
          WHERE p.department_id = d.id AND p.type = 'department_dues' AND p.voided_at IS NULL ${deptDate} ${deptAcademic}
        ), 0) AS department_dues_collected,
        COALESCE((
          SELECT SUM(p.amount) FROM receipts r
          JOIN payments p ON p.receipt_id = r.id
          WHERE r.department_id = d.id AND p.type = 'school_dues' AND p.voided_at IS NULL ${deptDate} ${deptAcademic}
        ), 0) AS school_dues_through_dept
      FROM departments d
      LEFT JOIN students s ON s.department_id = d.id
      WHERE 1=1 ${deptScope}
      GROUP BY d.id ORDER BY d.name`,
      dp
    );

    // ── Classes ──
    const cp = [];
    let classScope = '';
    if (isDept) {
      cp.push(req.user.department_id);
      classScope = ` AND c.department_id = $${cp.length}`;
    }
    const classDate = dateFilter('r', cp, from, to);
    const classAcademic = academicYearFilter('r', cp, academic_year);

    const classes = await pool.query(
      `
      SELECT c.id, c.name, c.level, c.department_id, d.name AS department_name,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_archived = false AND s.is_graduated = false) AS student_count,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          JOIN receipts r ON r.id = p.receipt_id
          WHERE r.class_id = c.id AND p.type = 'department_dues' AND p.voided_at IS NULL ${classDate} ${classAcademic}
        ), 0) AS dept_dues_collected,
        COUNT(DISTINCT s2.sid) AS paid_students
      FROM classes c
      JOIN departments d ON d.id = c.department_id
      LEFT JOIN students s ON s.class_id = c.id AND s.is_archived = false AND s.is_graduated = false
      LEFT JOIN (
        SELECT DISTINCT r.class_id AS cid, r.student_id AS sid
        FROM receipts r JOIN payments p ON p.receipt_id = r.id
        WHERE p.type = 'department_dues' AND p.voided_at IS NULL ${classDate} ${classAcademic}
      ) s2 ON s2.cid = c.id AND s2.sid = s.id
      WHERE 1=1 ${classScope}
      GROUP BY c.id, c.department_id, d.name ORDER BY d.name, c.level, c.name`,
      cp
    );

    // ── Totals (money) ──
    // School dues are school-wide; department dues are per department.
    let totals;
    if (isDept) {
      const tp = [req.user.department_id];
      const tDate = dateFilter('r', tp, from, to);
      const tAcademic = academicYearFilter('r', tp, academic_year);
      const r1 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS department_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE p.type = 'department_dues' AND p.department_id = $1 AND p.voided_at IS NULL ${tDate} ${tAcademic}`,
        tp
      );
      const r2 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS school_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE p.type = 'school_dues' AND r.department_id = $1 AND p.voided_at IS NULL ${tDate} ${tAcademic}`,
        tp
      );
      totals = {
        department_dues: Number(r1.rows[0].department_dues),
        school_dues_through_dept: Number(r2.rows[0].school_dues),
      };
    } else {
      const tp = [];
      const tDate = dateFilter('r', tp, from, to);
      const tAcademic = academicYearFilter('r', tp, academic_year);
      const r1 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0) AS department_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE p.voided_at IS NULL ${tDate} ${tAcademic}`,
        tp
      );
      totals = {
        department_dues: Number(r1.rows[0].department_dues),
        school_dues: Number(r1.rows[0].school_dues),
      };
    }

    res.json({ departments: departments.rows, classes: classes.rows, totals });
  } catch (err) {
    next(err);
  }
});

// ─── Monthly collections (by receipt paid_at) ───
router.get('/monthly', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to, academic_year } = req.query;
    const dp = [];
    let deptF = '';
    if (isDept) {
      dp.push(req.user.department_id);
      deptF = `AND r.department_id = $${dp.length}`;
    }
    const dDate = dateFilter('r', dp, from, to);
    const dAcademic = academicYearFilter('r', dp, academic_year);

    const { rows } = await pool.query(
      `
      SELECT TO_CHAR(r.paid_at, 'YYYY-MM') AS month,
             TO_CHAR(r.paid_at, 'Mon YYYY') AS label,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0) AS dept_dues
      FROM receipts r
      JOIN payments p ON p.receipt_id = r.id
      WHERE 1=1 ${deptF} AND p.voided_at IS NULL ${dDate} ${dAcademic}
      GROUP BY TO_CHAR(r.paid_at, 'YYYY-MM'), TO_CHAR(r.paid_at, 'Mon YYYY')
      ORDER BY month`,
      dp
    );

    res.json({ monthly: rows, is_dept: isDept });
  } catch (err) {
    next(err);
  }
});

// ─── CSV export of receipts ───
router.get('/export', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to, academic_year } = req.query;
    const p = [];
    let deptF = '';
    if (isDept) {
      p.push(req.user.department_id);
      deptF = `AND r.department_id = $${p.length}`;
    }
    const dDate = dateFilter('r', p, from, to);
    const dAcademic = academicYearFilter('r', p, academic_year);

    const { rows } = await pool.query(
      `
      SELECT r.receipt_number, r.method, r.paid_at, r.total_amount,
             s.name AS student_name, s.student_no,
             d.name AS department_name, c.name AS class_name,
             r.record_type,
             (SELECT string_agg(p.type || ':' || p.amount, ' | ' ORDER BY p.id) FROM payments p WHERE p.receipt_id = r.id AND p.voided_at IS NULL) AS lines
      FROM receipts r
      JOIN students s ON s.id = r.student_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN classes c ON c.id = r.class_id
      WHERE 1=1 ${deptF} ${dDate} ${dAcademic}
      ORDER BY r.paid_at`,
      p
    );

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const header =
      'Receipt Number,Student Name,Student No,Department,Class,Method,Total,Paid At,Recorded By,Lines';
    const lines = rows.map((r) =>
      [
        r.receipt_number,
        r.student_name,
        r.student_no,
        r.department_name,
        r.class_name,
        r.method,
        r.total_amount,
        r.paid_at,
        r.record_type,
        r.lines,
      ]
        .map(esc)
        .join(',')
    );
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dues-report.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
