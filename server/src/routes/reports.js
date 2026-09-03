const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAnyAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

/**
 * Build a date range WHERE clause for payments.
 * Appends "AND alias.paid_at >= $N AND alias.paid_at <= $N" to an existing params array.
 * Returns { clause, params }
 */
function dateFilter(alias, params, from, to) {
  let clause = '';
  if (from) {
    params.push(from);
    clause += ` AND ${alias}.paid_at >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    clause += ` AND ${alias}.paid_at <= $${params.length}`;
  }
  return clause;
}

router.get('/summary', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to } = req.query;

    // ── Departments ──
    const dp = [];
    let deptScope = '';
    if (isDept) { dp.push(req.user.department_id); deptScope = ` AND d.id = $${dp.length}`; }
    const deptDateFilter = dateFilter('p', dp, from, to);

    const departments = await pool.query(`
      SELECT d.id, d.name, d.dues_amount,
        COUNT(DISTINCT s.id) AS student_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher) AS total_freshers,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          WHERE p.department_id = d.id AND p.type = 'department_dues' ${deptDateFilter}
        ), 0) AS amount_collected
      FROM departments d
      LEFT JOIN students s ON s.department_id = d.id
      WHERE 1=1 ${deptScope}
      GROUP BY d.id ORDER BY d.name`, dp);

    // ── Classes ──
    const cp = [];
    let classDept = '';
    if (isDept) { cp.push(req.user.department_id); classDept = ` AND c.department_id = $${cp.length}`; }
    const classDate = dateFilter('p', cp, from, to);

    const classes = await pool.query(`
      SELECT c.id, c.name, c.level, d.name AS department_name,
        COALESCE(SUM(p.amount) FILTER (WHERE p.type='department_dues' ${classDate}), 0) AS collected,
        COUNT(DISTINCT CASE WHEN p.type='department_dues' THEN p.student_id END) AS paid_count,
        COUNT(DISTINCT s.id) AS student_count
      FROM classes c
      JOIN departments d ON d.id = c.department_id
      LEFT JOIN students s ON s.class_id = c.id
      LEFT JOIN payments p ON p.class_id = c.id
      WHERE 1=1 ${classDept}
      GROUP BY c.id, d.name ORDER BY d.name, c.name`, cp);

    // ── Totals ──
    const tp = [];
    let totalDept = '';
    if (isDept) { tp.push(req.user.department_id); totalDept = ` AND department_id = $${tp.length}`; }
    const totalDate = dateFilter('p', tp, from, to);
    // Need separate param slots for subqueries using the same alias
    const tp2 = [];
    if (isDept) tp2.push(req.user.department_id);
    const totalDate2 = dateFilter('p', tp2, from, to);
    const tp3 = [];
    if (isDept) tp3.push(req.user.department_id);
    const totalDate3 = dateFilter('p', tp3, from, to);

    const totals = isDept
      ? await pool.query(`SELECT
          (SELECT COALESCE(SUM(amount),0) FROM payments WHERE type='department_dues'${totalDept}${totalDate2.replace(/p\./g, '')}) AS department_dues,
          (SELECT COUNT(DISTINCT student_id) FROM payments WHERE type='department_dues'${totalDept}${totalDate3.replace(/p\./g, '')}) AS students_paid`, tp2)
      : await pool.query(`SELECT
          (SELECT COALESCE(SUM(amount),0) FROM payments WHERE type='department_dues'${totalDate.replace(/p\./g, '')}) AS department_dues,
          (SELECT COALESCE(SUM(amount),0) FROM payments WHERE type='school_dues'${totalDate.replace(/p\./g, '')}) AS school_dues,
          (SELECT COUNT(DISTINCT student_id) FROM payments WHERE type='department_dues'${totalDate.replace(/p\./g, '')}) AS students_paid`, tp);

    res.json({
      departments: departments.rows,
      classes: classes.rows,
      totals: totals.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/monthly', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to } = req.query;

    // Monthly department dues
    const dp = [];
    let deptF = '';
    if (isDept) { dp.push(req.user.department_id); deptF = `AND p.department_id = $${dp.length}`; }
    const dDate = dateFilter('p', dp, from, to);

    const { rows: deptRows } = await pool.query(`
      SELECT TO_CHAR(p.paid_at, 'YYYY-MM') AS month,
             TO_CHAR(p.paid_at, 'Mon YYYY') AS label,
             COALESCE(SUM(p.amount), 0) AS dept_dues
      FROM payments p
      WHERE p.type = 'department_dues' ${deptF} ${dDate}
      GROUP BY TO_CHAR(p.paid_at, 'YYYY-MM'), TO_CHAR(p.paid_at, 'Mon YYYY')
      ORDER BY month`, dp);

    // Monthly school dues (School Admin only)
    let schoolRows = [];
    if (!isDept) {
      const sp = [];
      const sDate = dateFilter('p', sp, from, to);
      const res = await pool.query(`
        SELECT TO_CHAR(p.paid_at, 'YYYY-MM') AS month,
               TO_CHAR(p.paid_at, 'Mon YYYY') AS label,
               COALESCE(SUM(p.amount), 0) AS school_dues
        FROM payments p
        WHERE p.type = 'school_dues' ${sDate}
        GROUP BY TO_CHAR(p.paid_at, 'YYYY-MM'), TO_CHAR(p.paid_at, 'Mon YYYY')
        ORDER BY month`, sp);
      schoolRows = res.rows;
    }

    // Merge
    const monthMap = new Map();
    for (const r of deptRows) {
      monthMap.set(r.month, { month: r.month, label: r.label, dept_dues: Number(r.dept_dues), school_dues: 0 });
    }
    for (const r of schoolRows) {
      if (monthMap.has(r.month)) {
        monthMap.get(r.month).school_dues = Number(r.school_dues);
      } else {
        monthMap.set(r.month, { month: r.month, label: r.label, dept_dues: 0, school_dues: Number(r.school_dues) });
      }
    }

    const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
    res.json({ monthly, is_dept: isDept });
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to } = req.query;
    const p = [];
    let deptF = '';
    if (isDept) { p.push(req.user.department_id); deptF = `AND p.department_id = $${p.length}`; }
    const dDate = dateFilter('p', p, from, to);

    const { rows } = await pool.query(`
      SELECT p.receipt_number, p.type, p.amount, p.method, p.paid_at,
             s.name AS student_name, s.student_no, d.name AS department_name, c.name AS class_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN departments d ON d.id = p.department_id
      LEFT JOIN classes c ON c.id = p.class_id
      WHERE 1=1 ${deptF} ${dDate}
      ORDER BY p.paid_at`, p);

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = 'Receipt Number,Type,Amount,Method,Paid At,Student Name,Student No,Department,Class';
    const lines = rows.map((r) =>
      [r.receipt_number, r.type, r.amount, r.method, r.paid_at, r.student_name, r.student_no, r.department_name, r.class_name]
        .map(esc).join(',')
    );
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dues-report.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/charts', async (req, res, next) => {
  try {
    const isDept = req.user.role === 'dept_admin';
    const { from, to } = req.query;

    // Shared dept + date filters
    const p = [];
    let deptF = '';
    if (isDept) { p.push(req.user.department_id); deptF = `AND p.department_id = $${p.length}`; }
    const dDate = dateFilter('p', p, from, to);

    // 1. Payment method breakdown (Pie chart)
    const methods = await pool.query(`
      SELECT p.method, COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS count
      FROM payments p
      WHERE 1=1 ${deptF} ${dDate}
      GROUP BY p.method ORDER BY total DESC`, p);

    // 2. Clearance rates (horizontal bar)
    const cp = [];
    let cDept = '';
    if (isDept) { cp.push(req.user.department_id); cDept = `AND s.department_id = $${cp.length}`; }
    const cDate = dateFilter('p', cp, from, to);

    const clearance = await pool.query(`
      SELECT d.name AS department_name,
        COUNT(DISTINCT s.id) AS total_students,
        COUNT(DISTINCT s.id) FILTER (
          WHERE EXISTS (SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.type = 'school_dues' ${cDate})
        ) AS school_dues_paid,
        COUNT(DISTINCT s.id) FILTER (
          WHERE EXISTS (SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.type = 'department_dues' ${cDate})
        ) AS dept_dues_paid
      FROM students s
      JOIN departments d ON d.id = s.department_id
      WHERE 1=1 ${cDept}
      GROUP BY d.id, d.name ORDER BY d.name`, cp);

    // 3. Method × type (grouped bar)
    const methodTypes = await pool.query(`
      SELECT p.method, p.type, COUNT(*) AS count
      FROM payments p
      WHERE 1=1 ${deptF} ${dDate}
      GROUP BY p.method, p.type ORDER BY p.method`, p);

    // 4. Souvenir distribution
    const sp = [];
    let souvWhere = '';
    if (isDept) { sp.push('department'); souvWhere = `AND ss.level = $${sp.length}`; }
    const sDate = dateFilter('ss', sp, from, to);

    const souvenirs = await pool.query(`
      SELECT s.name AS souvenir_name, s.category, COUNT(ss.id) AS distributed
      FROM souvenirs s
      LEFT JOIN student_souvenirs ss ON ss.souvenir_id = s.id
      WHERE 1=1 ${souvWhere} ${sDate}
      GROUP BY s.id, s.name, s.category ORDER BY distributed DESC LIMIT 8`, sp);

    res.json({
      methods: methods.rows,
      clearance: clearance.rows,
      methodTypes: methodTypes.rows,
      souvenirs: souvenirs.rows,
      is_dept: isDept,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
