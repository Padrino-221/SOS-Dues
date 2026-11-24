const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { requireAuth, requireAnyAdmin } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const { reportTitle, slugify, buildCsvReport } = require('../utils/reportFormat');
const { getActiveAcademicYear } = require('../utils/academicYear');
const { applicableItemsFor } = require('../utils/extraDues');
const { parseCohort, receiptCohortFilter, rosterCohortFilter } = require('../utils/reportCohort');
const { courseRepCollections } = require('../utils/courseRepCollections');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin, (req, res, next) => {
  if (req.user.role === 'school_staff' || req.user.role === 'dept_staff') {
    return next(new AppError('Access denied', 403));
  }
  next();
});

const LEVELS = ['100', '200', '300', '400'];
const METHODS = ['cash', 'momo'];

// Reject an impossible date range up front instead of quietly returning zeros
// for a query that can never match anything.
function validateRange(from, to) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (from && !isDate(from)) throw new AppError('Invalid "from" date — use YYYY-MM-DD', 400);
  if (to && !isDate(to)) throw new AppError('Invalid "to" date — use YYYY-MM-DD', 400);
  if (from && to && from > to) {
    throw new AppError('The "from" date must be on or before the "to" date', 400);
  }
}

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

// One place parses every report filter. department_id is honoured for the
// School Admin only — a department admin is always pinned to their own
// department whatever the query string says.
function parseFilters(req) {
  const { from, to, academic_year, level, department_id, method } = req.query;
  validateRange(from, to);

  const lvl = level === undefined || level === null ? '' : String(level).trim();
  if (lvl && !LEVELS.includes(lvl)) {
    throw new AppError('Invalid level — use 100, 200, 300 or 400', 400);
  }
  const mth = method === undefined || method === null ? '' : String(method).trim();
  if (mth && !METHODS.includes(mth)) {
    throw new AppError('Invalid method — use cash or momo', 400);
  }

  let departmentId = null;
  if (req.user.role === 'dept_admin') {
    departmentId = req.user.department_id;
  } else if (department_id !== undefined && department_id !== null && department_id !== '') {
    const n = Number(department_id);
    if (!Number.isInteger(n) || n <= 0) throw new AppError('Invalid department', 400);
    departmentId = n;
  }

  return {
    cohort: parseCohort(req.query.cohort),
    from: from || '',
    to: to || '',
    academicYear: academic_year || '',
    level: lvl,
    method: mth,
    departmentId,
  };
}

// level / method / department conditions over receipts alias `r` for a query
// with a students join alias `s` (level falls back payment_level → receipt →
// student, the same derivation the level table uses). Skip flags exist for
// queries that already scope by department through their row correlation, or
// that must see both methods (the cash/momo split).
function scopeFilter(r, s, params, f, opts = {}) {
  let clause = receiptCohortFilter(r, s, f.cohort);
  if (f.departmentId && !opts.skipDepartment) {
    params.push(f.departmentId);
    clause += ` AND ${r}.department_id = $${params.length}`;
  }
  if (f.level) {
    params.push(f.level);
    clause += ` AND COALESCE(${r}.payment_level, ${r}.level, ${s}.level) = $${params.length}`;
  }
  if (f.method && !opts.skipMethod) {
    params.push(f.method);
    clause += ` AND ${r}.method = $${params.length}`;
  }
  return clause;
}

// The selected department's display name for the report title.
async function titleDepartment(f) {
  if (!f.departmentId) return null;
  const { rows } = await pool.query('SELECT name FROM departments WHERE id = $1', [f.departmentId]);
  return rows[0] ? rows[0].name : null;
}

// Shared row shape for the on-page payments table and both downloads —
// exactly the five report columns, one row per receipt.
const PAYMENTS_SELECT = `
  SELECT COALESCE(r.student_name, s.name) AS name,
         COALESCE(r.student_no, s.student_no) AS reference,
         COALESCE(s.programme, d.name) AS programme,
         r.total_amount AS amount,
         TO_CHAR(r.paid_at, 'YYYY-MM-DD') AS date`;
const PAYMENTS_FROM = `
  FROM receipts r
  LEFT JOIN students s ON s.id = r.student_id
  LEFT JOIN departments d ON d.id = r.department_id`;

// Every report query shares the date/year/scope conditions.
function paymentsWhere(params, f) {
  const date = dateFilter('r', params, f.from, f.to);
  const academic = academicYearFilter('r', params, f.academicYear);
  const scope = scopeFilter('r', 's', params, f);
  return `WHERE 1=1${date}${academic}${scope}`;
}

// ── School-wide vs department "Other Dues" ──
// Extra-dues lines snapshot only the item's NAME — payments.department_id
// holds the STUDENT's department, not the item's scope — so an extra line
// is school-wide exactly when its label matches a school-wide dues item.
// A name existing in both scopes counts as school; deleted or renamed
// legacy items fall into the department bucket.
const SCHOOL_ITEM = `EXISTS (SELECT 1 FROM dues_items di WHERE di.department_id IS NULL AND di.name = p.label)`;

// ─── Summary: departments, levels, totals, cash/momo split ───
router.get('/summary', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const isDept = req.user.role === 'dept_admin';

    // ── Departments (dept-dues revenue, payment-derived payer counts,
    //    fresher admission counts) ──
    // Which department rows appear: the dept admin's own (departmentId is
    // always set for them), the school admin's selection, or all of them.
    const dp = [];
    let deptScope = '';
    if (f.departmentId) {
      dp.push(f.departmentId);
      deptScope = ` AND d.id = $${dp.length}`;
    }
    // paid_at lives on receipts — always join so the date filter can use it.
    // The money subqueries are already correlated to the row's department, so
    // the scope filter only layers level/method on top of them.
    const deptDate = dateFilter('r', dp, f.from, f.to);
    const deptAcademic = academicYearFilter('r', dp, f.academicYear);
    const deptLevelMethod = scopeFilter('r', 'ps', dp, f, { skipDepartment: true });

    const departments = await pool.query(
      `
      SELECT d.id, d.name, d.dues_amount,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher) AS fresher_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher AND s.admitted_at IS NOT NULL) AS admitted_fresher_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.is_fresher AND s.admitted_at IS NULL) AS pending_fresher_count,
        COALESCE((
          SELECT COUNT(*) FROM receipts r
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE r.department_id = d.id ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS receipt_count,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          JOIN receipts r ON r.id = p.receipt_id
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE p.department_id = d.id AND p.type = 'department_dues' AND p.voided_at IS NULL ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS department_dues_collected,
        COALESCE((
          SELECT SUM(p.amount) FROM receipts r
          JOIN payments p ON p.receipt_id = r.id
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE r.department_id = d.id AND p.type = 'school_dues' AND p.voided_at IS NULL ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS school_dues_through_dept,
        COALESCE((
          SELECT SUM(p.amount) FROM receipts r
          JOIN payments p ON p.receipt_id = r.id
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE r.department_id = d.id AND p.type = 'extra_dues' AND p.voided_at IS NULL ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS other_dues_collected,
        COALESCE((
          SELECT SUM(p.amount) FROM receipts r
          JOIN payments p ON p.receipt_id = r.id
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE r.department_id = d.id AND p.type = 'extra_dues' AND p.voided_at IS NULL AND ${SCHOOL_ITEM} ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS school_other_dues_collected,
        COALESCE((
          SELECT SUM(p.amount) FROM receipts r
          JOIN payments p ON p.receipt_id = r.id
          LEFT JOIN students ps ON ps.id = r.student_id
          WHERE r.department_id = d.id AND p.type = 'extra_dues' AND p.voided_at IS NULL AND NOT (${SCHOOL_ITEM}) ${deptDate} ${deptAcademic} ${deptLevelMethod}
        ), 0) AS dept_other_dues_collected
      FROM departments d
      LEFT JOIN students s ON s.department_id = d.id ${rosterCohortFilter('s', f.cohort)}
      WHERE 1=1 ${deptScope}
      GROUP BY d.id ORDER BY d.name`,
      dp
    );

    // ── Levels (collections grouped by the level paid for) ──
    // Classes are gone, so the per-level breakdown is derived from the
    // receipts themselves: payment level, then the receipt's snapshot level,
    // then the payer's current level for admin-created receipts that never
    // stamped one. Keyed off the RECEIPT's department so school-dues lines
    // (NULL payment department) still attribute to the collecting department.
    const lp = [];
    const levelDate = dateFilter('r', lp, f.from, f.to);
    const levelAcademic = academicYearFilter('r', lp, f.academicYear);
    const levelScope = scopeFilter('r', 'ps', lp, f);

    const levels = await pool.query(
      `
      SELECT d.id AS department_id, d.name AS department_name,
             COALESCE(r.payment_level, r.level, ps.level) AS level,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0) AS dept_dues_collected,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues_collected,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0) AS other_dues_collected,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND ${SCHOOL_ITEM}), 0) AS school_other_dues_collected,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND NOT (${SCHOOL_ITEM})), 0) AS dept_other_dues_collected,
             -- Every payer behind the row's total (all payment types), so the
             -- count always matches the money shown on the same row.
             COUNT(DISTINCT UPPER(COALESCE(r.student_no, ps.student_no))) AS payers
      FROM payments p
      JOIN receipts r ON r.id = p.receipt_id
      JOIN departments d ON d.id = r.department_id
      LEFT JOIN students ps ON ps.id = r.student_id
      WHERE p.type IN ('department_dues', 'school_dues', 'extra_dues') AND p.voided_at IS NULL ${levelDate} ${levelAcademic} ${levelScope}
      GROUP BY d.id, d.name, COALESCE(r.payment_level, r.level, ps.level)
      ORDER BY d.name, level`,
      lp
    );

    // ── Totals (money) ──
    // School dues are school-wide; department dues are per department. The
    // dept admin's block keeps its school_dues_through_dept key — that money
    // was collected by the department's reps for the school, so it stays
    // visible but clearly separate from the department's own dues.
    let totals;
    if (isDept) {
      const tp = [f.departmentId];
      const tDate = dateFilter('r', tp, f.from, f.to);
      const tAcademic = academicYearFilter('r', tp, f.academicYear);
      const tScope = scopeFilter('r', 's', tp, f, { skipDepartment: true });
      const r1 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS department_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        LEFT JOIN students s ON s.id = r.student_id
        WHERE p.type = 'department_dues' AND p.department_id = $1 AND p.voided_at IS NULL ${tDate} ${tAcademic} ${tScope}`,
        tp
      );
      const r2 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS school_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        LEFT JOIN students s ON s.id = r.student_id
        WHERE p.type = 'school_dues' AND r.department_id = $1 AND p.voided_at IS NULL ${tDate} ${tAcademic} ${tScope}`,
        tp
      );
      const r3 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS other_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE ${SCHOOL_ITEM}), 0) AS school_other_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE NOT (${SCHOOL_ITEM})), 0) AS dept_other_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        LEFT JOIN students s ON s.id = r.student_id
        WHERE p.type = 'extra_dues' AND p.department_id = $1 AND p.voided_at IS NULL ${tDate} ${tAcademic} ${tScope}`,
        tp
      );
      totals = {
        department_dues: Number(r1.rows[0].department_dues),
        school_dues_through_dept: Number(r2.rows[0].school_dues),
        other_dues: Number(r3.rows[0].other_dues),
        // "Other Dues" split by the scope of the item charged: school-wide
        // items collected through this department vs its own items.
        school_other_dues: Number(r3.rows[0].school_other_dues),
        dept_other_dues: Number(r3.rows[0].dept_other_dues),
      };
    } else {
      const tp = [];
      const tDate = dateFilter('r', tp, f.from, f.to);
      const tAcademic = academicYearFilter('r', tp, f.academicYear);
      const tScope = scopeFilter('r', 's', tp, f);
      const r1 = await pool.query(
        `
        SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0) AS department_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0) AS other_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND ${SCHOOL_ITEM}), 0) AS school_other_dues,
               COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND NOT (${SCHOOL_ITEM})), 0) AS dept_other_dues
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        LEFT JOIN students s ON s.id = r.student_id
        WHERE p.voided_at IS NULL ${tDate} ${tAcademic} ${tScope}`,
        tp
      );
      totals = {
        department_dues: Number(r1.rows[0].department_dues),
        school_dues: Number(r1.rows[0].school_dues),
        other_dues: Number(r1.rows[0].other_dues),
        // "Other Dues" split by the scope of the item charged: school-wide
        // items (school_other_dues) vs department items (dept_other_dues).
        school_other_dues: Number(r1.rows[0].school_other_dues),
        dept_other_dues: Number(r1.rows[0].dept_other_dues),
      };
    }

    // ── Cash / Mobile Money split ──
    // Respects every filter EXCEPT the method itself, so both figures always
    // show the split of the current scope (pick "cash" above and you still
    // see how the month's money divides between the two channels).
    // Each side sees only its OWN money: the school admin's cards cover school
    // dues + school-wide items, the department admin's cover department dues +
    // department items, and the super admin sees the full mix.
    const mp = [];
    const mDate = dateFilter('r', mp, f.from, f.to);
    const mAcademic = academicYearFilter('r', mp, f.academicYear);
    const mScope = scopeFilter('r', 's', mp, f, { skipMethod: true });
    const moneyScope =
      req.user.role === 'school_admin'
        ? ` AND (p.type = 'school_dues' OR (p.type = 'extra_dues' AND ${SCHOOL_ITEM}))`
        : req.user.role === 'dept_admin'
          ? ` AND (p.type = 'department_dues' OR (p.type = 'extra_dues' AND NOT (${SCHOOL_ITEM})))`
          : '';
    const rm = await pool.query(
      `
      SELECT COALESCE(SUM(p.amount) FILTER (WHERE r.method = 'cash'), 0) AS cash,
             COALESCE(SUM(p.amount) FILTER (WHERE r.method = 'momo'), 0) AS momo
      FROM payments p
      JOIN receipts r ON r.id = p.receipt_id
      LEFT JOIN students s ON s.id = r.student_id
      WHERE p.voided_at IS NULL ${mDate} ${mAcademic} ${mScope}${moneyScope}`,
      mp
    );
    const byMethod = {
      cash: Number(rm.rows[0].cash),
      momo: Number(rm.rows[0].momo),
    };

    const hp = [];
    const headDate = dateFilter('r', hp, f.from, f.to);
    const headYear = academicYearFilter('r', hp, f.academicYear);
    const headScope = scopeFilter('r', 's', hp, f, { skipDepartment: true });
    const departmentParam = f.departmentId ? `$${hp.push(f.departmentId)}::integer` : 'NULL::integer';
    const { rows: headcounts } = await pool.query(
      `WITH index_matches AS (
         SELECT UPPER(TRIM(student_no)) AS index_number, MIN(id) AS student_id
         FROM students
         WHERE NULLIF(TRIM(student_no), '') IS NOT NULL
         GROUP BY UPPER(TRIM(student_no))
         HAVING COUNT(*) = 1
       ), payment_students AS (
         SELECT s.id AS student_id, s.department_id, r.id AS receipt_id,
                r.department_id AS receipt_department_id, p.type
         FROM receipts r
         JOIN payments p ON p.receipt_id = r.id
         LEFT JOIN index_matches i ON r.student_id IS NULL
           AND i.index_number = UPPER(TRIM(r.student_no))
         LEFT JOIN students s ON s.id = COALESCE(r.student_id, i.student_id)
         WHERE p.voided_at IS NULL AND p.amount > 0
           AND p.type IN ('school_dues', 'department_dues', 'extra_dues')
           ${headDate} ${headYear} ${headScope}
       )
       SELECT department_id, GROUPING(department_id) AS school_total,
              COUNT(DISTINCT student_id)::int AS payers,
              (COUNT(DISTINCT student_id) FILTER (WHERE type = 'school_dues'))::int AS school_dues_payers,
              (COUNT(DISTINCT receipt_id) FILTER (WHERE student_id IS NULL))::int AS unmatched_receipts
       FROM payment_students
       WHERE ${departmentParam} IS NULL
          OR COALESCE(department_id, CASE WHEN student_id IS NULL THEN receipt_department_id END) = ${departmentParam}
       GROUP BY GROUPING SETS ((department_id), ())`,
      hp
    );
    const payerSummary = headcounts.find((row) => row.school_total === 1);
    const payersByDepartment = new Map(
      headcounts.filter((row) => row.school_total === 0).map((row) => [row.department_id, row.payers])
    );
    const roster = await pool.query(
      `SELECT COUNT(*)::int AS registered FROM students s WHERE ($1::integer IS NULL OR department_id = $1) ${rosterCohortFilter('s', f.cohort)}`,
      [f.departmentId]
    );
    res.json({
      departments: departments.rows.map((row) => ({ ...row, payers: payersByDepartment.get(row.id) ?? 0 })),
      levels: levels.rows,
      totals,
      by_method: byMethod,
      headcounts: {
        registered: roster.rows[0].registered,
        payers: payerSummary.payers,
        school_dues_payers: payerSummary.school_dues_payers,
        unmatched_receipts: payerSummary.unmatched_receipts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Monthly collections (by receipt paid_at) ───
router.get('/monthly', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const isDept = req.user.role === 'dept_admin';
    const dp = [];
    const dDate = dateFilter('r', dp, f.from, f.to);
    const dAcademic = academicYearFilter('r', dp, f.academicYear);
    const dScope = scopeFilter('r', 's', dp, f);

    const { rows } = await pool.query(
      `
      SELECT TO_CHAR(r.paid_at, 'YYYY-MM') AS month,
             TO_CHAR(r.paid_at, 'Mon YYYY') AS label,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0) AS dept_dues,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0) AS other_dues,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND ${SCHOOL_ITEM}), 0) AS school_other_dues,
             COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues' AND NOT (${SCHOOL_ITEM})), 0) AS dept_other_dues
      FROM receipts r
      JOIN payments p ON p.receipt_id = r.id
      LEFT JOIN students s ON s.id = r.student_id
      WHERE 1=1 AND p.voided_at IS NULL ${dDate} ${dAcademic} ${dScope}
      GROUP BY TO_CHAR(r.paid_at, 'YYYY-MM'), TO_CHAR(r.paid_at, 'Mon YYYY')
      ORDER BY month`,
      dp
    );

    res.json({ monthly: rows, is_dept: isDept });
  } catch (err) {
    next(err);
  }
});

// ─── Other Dues by item: the school-wide vs department separation ───
// One row per charged item within the current filters, each carrying the
// item's scope — this is the breakdown used for daily collection reports
// (School Dues / School Other Dues / Department Other Dues).
router.get('/other-items', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const params = [];
    const date = dateFilter('r', params, f.from, f.to);
    const academic = academicYearFilter('r', params, f.academicYear);
    const scope = scopeFilter('r', 's', params, f);

    const { rows } = await pool.query(
      `
      SELECT COALESCE(NULLIF(p.label, ''), '(unnamed)') AS item,
             CASE WHEN ${SCHOOL_ITEM} THEN 'school' ELSE 'dept' END AS scope,
             COUNT(*) AS times,
             SUM(p.amount) AS amount
      FROM payments p
      JOIN receipts r ON r.id = p.receipt_id
      LEFT JOIN students s ON s.id = r.student_id
      WHERE p.type = 'extra_dues' AND p.voided_at IS NULL${date}${academic}${scope}
      GROUP BY 1, 2
      ORDER BY 4 DESC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// ─── Other Dues by item → one item's department breakdown ───
// Companion to /other-items: the click-through modal on a table row. Same
// filters, grouped by the department that collected the money — the same
// r.department_id the payments table and every other grouping on the reports
// page uses, so the modal's totals tie out with the row it came from.
// Read-only; accepts the item's label exactly as /other-items returned it.
router.get('/other-items/departments', async (req, res, next) => {
  try {
    const item = String(req.query.item || '').trim();
    if (!item) throw new AppError('Missing item parameter', 400);

    const f = parseFilters(req);
    const params = [];
    const date = dateFilter('r', params, f.from, f.to);
    const academic = academicYearFilter('r', params, f.academicYear);
    const scope = scopeFilter('r', 's', params, f);
    params.push(item);

    const { rows } = await pool.query(
      `
      SELECT COALESCE(d.name, 'Unassigned') AS department,
             COUNT(*) AS times,
             SUM(p.amount) AS amount
      FROM payments p
      JOIN receipts r ON r.id = p.receipt_id
      LEFT JOIN students s ON s.id = r.student_id
      LEFT JOIN departments d ON d.id = r.department_id
      WHERE p.type = 'extra_dues' AND p.voided_at IS NULL
        AND COALESCE(NULLIF(p.label, ''), '(unnamed)') = $${params.length}${date}${academic}${scope}
      GROUP BY 1
      ORDER BY 3 DESC, 1`,
      params
    );
    res.json({ item, departments: rows });
  } catch (err) {
    next(err);
  }
});

// Continuing report: collector attribution comes from the authenticated rep audit,
// not receipts.recorded_by (which identifies administrator accounts only).
router.get('/course-reps', async (req,res,next) => {
  try {
    const f=parseFilters(req);f.cohort='continuing';
    const page=Number(req.query.page||1),pageSize=Number(req.query.limit||10);
    if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new AppError('Invalid report page',400);
    const params=[];const where=paymentsWhere(params,f);
    res.json(await courseRepCollections(pool,{where,params,departmentId:f.departmentId,page,pageSize}));
  }catch(err){next(err);}
});

// ─── Per-payment rows (the on-page payments table + both downloads) ───
router.get('/payments', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const p = [];
    const where = paymentsWhere(p, f);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 10), 100);

    const countRows = await pool.query(
      `SELECT COUNT(*)::int AS total ${PAYMENTS_FROM} ${where}`,
      p
    );
    const { rows } = await pool.query(
      `${PAYMENTS_SELECT} ${PAYMENTS_FROM} ${where} ORDER BY r.paid_at, r.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      p
    );
    res.json({ payments: rows, total: countRows.rows[0].total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// Build the five-column row list (shared by the CSV and PDF exports).
async function loadReportRows(f) {
  const p = [];
  const where = paymentsWhere(p, f);
  const { rows } = await pool.query(
    `${PAYMENTS_SELECT} ${PAYMENTS_FROM} ${where} ORDER BY r.paid_at, r.id`,
    p
  );
  const title = (f.cohort === 'continuing' ? 'Continuing Students — ' : '') + reportTitle({
    departmentName: await titleDepartment(f),
    level: f.level,
    method: f.method,
    academicYear: f.academicYear,
    from: f.from,
    to: f.to,
  });
  return { rows, title };
}

// ─── CSV export of the filtered report ───
// Row 1 is the name of the filtered report (the first excel cell), row 2 the
// column headers, then one row per payment: Name, Reference, Programme,
// Amount, Date.
router.get('/export', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const { rows, title } = await loadReportRows(f);

    const csv = buildCsvReport(title, rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dues-report-${slugify(title)}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── PDF export of the same report (five columns, repeated header, total) ───
function sendReportPdf(res, { title, rows, total }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="dues-report-${slugify(title)}.pdf"`);
  doc.pipe(res);

  const LEFT = 40;
  const COLS = [
    { key: 'name', label: 'Name', width: 140 },
    { key: 'reference', label: 'Reference', width: 90 },
    { key: 'programme', label: 'Programme', width: 130 },
    { key: 'amount', label: 'Amount', width: 75, align: 'right' },
    { key: 'date', label: 'Date', width: 80 },
  ];
  const TABLE_W = COLS.reduce((s, c) => s + c.width, 0);
  const ROW_H = 16;
  let y = 40;

  const drawTableHeader = () => {
    doc.rect(LEFT, y, TABLE_W, ROW_H).fill('#eceff3');
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9);
    let x = LEFT;
    for (const c of COLS) {
      doc.text(c.label, x + 4, y + 4.5, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    }
    y += ROW_H;
    doc.font('Helvetica').fillColor('#111111');
  };

  const ensureRoom = (h) => {
    if (y + h > doc.page.height - 40) {
      doc.addPage();
      y = 40;
      drawTableHeader();
    }
  };

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111');
  doc.text(title, LEFT, y, { width: TABLE_W });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  doc.text(
    `${rows.length} payment${rows.length === 1 ? '' : 's'} · Total GHS ${total.toFixed(2)} · Generated ${new Date()
      .toISOString()
      .slice(0, 10)}`,
    LEFT,
    y,
    { width: TABLE_W }
  );
  y = doc.y + 12;
  drawTableHeader();

  for (const r of rows) {
    ensureRoom(ROW_H);
    let x = LEFT;
    for (const c of COLS) {
      const v =
        c.key === 'amount' ? `GHS ${Number(r.amount || 0).toFixed(2)}` : String(r[c.key] ?? '');
      doc.text(v, x + 4, y + 4.5, {
        width: c.width - 8,
        align: c.align || 'left',
        ellipsis: true,
        truncate: c.width - 8,
      });
      x += c.width;
    }
    y += ROW_H;
    doc
      .moveTo(LEFT, y)
      .lineTo(LEFT + TABLE_W, y)
      .strokeColor('#e5e7eb')
      .lineWidth(0.5)
      .stroke();
  }

  // Total line under the Amount column.
  ensureRoom(ROW_H + 4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
  const amountX = LEFT + COLS.slice(0, 4).reduce((s, c) => s + c.width, 0);
  doc.text(`Total (${rows.length} payment${rows.length === 1 ? '' : 's'})`, LEFT + 4, y + 5, {
    width: amountX - LEFT - 8,
  });
  doc.text(`GHS ${total.toFixed(2)}`, amountX + 4, y + 5, {
    width: COLS[3].width - 8,
    align: 'right',
  });
  doc.end();
}

router.get('/export.pdf', async (req, res, next) => {
  try {
    const f = parseFilters(req);
    const { rows, title } = await loadReportRows(f);
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    sendReportPdf(res, { title, rows, total });
  } catch (err) {
    next(err);
  }
});

// ─── Data health checks (school side only) ───
// Three integrity sweeps desk leads run when figures look off:
//  1. students who paid SOME school-wide Other Dues items this academic year
//     but not all of them (the "cloth without exercise book" pattern,
//     generalized to whatever school-wide items exist). Gendered items only
//     count as expected for matching students — a male fresher is never
//     flagged for a female-only item;
//  2. receipts whose active payment lines don't sum to the stored total;
//  3. fresher applications sharing a student number.
// Read-only. List sizes are capped; counts are always exact. Dept accounts
// are refused — this sweeps school-wide money and the applications queue.
const HEALTH_MAX_PARTIAL = 200;
const HEALTH_MAX_MISMATCH = 200;
const HEALTH_MAX_DUP = 100;

router.get('/discrepancies', async (req, res, next) => {
  try {
    if (!['school_admin', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Data health checks are available to School Admins only', 403);
    }

    // 1) Partial school-wide itemization, active academic year. Students with
    //    ZERO school-wide items are deliberately not flagged — paying no
    //    extras at all is a collections matter, not a data discrepancy.
    //    Gendered items only count as expected for matching students
    //    (applicableItemsFor) — a male fresher is never flagged for a
    //    female-only charge, and an unknown student gender expects the
    //    'any' items only.
    const { rows: schoolItems } = await pool.query(
      `SELECT name, gender FROM dues_items WHERE active AND department_id IS NULL ORDER BY name`
    );
    const schoolNames = schoolItems.map((i) => i.name);
    let partialRows = [];
    if (schoolNames.length > 1) {
      const activeYear = await getActiveAcademicYear(pool);
      const { rows } = await pool.query(
        `SELECT s.id AS student_id, s.name, s.student_no, s.gender, d.name AS department_name,
                array_agg(DISTINCT p.label) AS has_labels
           FROM payments p
           JOIN receipts r ON r.id = p.receipt_id AND r.voided_at IS NULL
           JOIN students s ON s.id = r.student_id
           LEFT JOIN departments d ON d.id = s.department_id
          WHERE p.type = 'extra_dues' AND p.voided_at IS NULL
            AND r.academic_year = $1
            AND ${SCHOOL_ITEM}
          GROUP BY s.id, s.name, s.student_no, s.gender, d.name`,
        [activeYear]
      );
      partialRows = rows
        .map((r) => {
          const have = new Set((r.has_labels || []).map((l) => String(l).toLowerCase()));
          const expected = applicableItemsFor(schoolItems, r.gender).map((i) => i.name);
          return {
            student_id: r.student_id,
            name: r.name,
            student_no: r.student_no,
            gender: r.gender,
            department_name: r.department_name,
            has: r.has_labels,
            missing: expected.filter((n) => !have.has(n.toLowerCase())),
          };
        })
        .filter((r) => r.missing.length > 0)
        .sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
    }

    // 2) Receipt totals vs their active lines (all receipts, both sides).
    const mismatchSub = `
         SELECT r.id
           FROM receipts r
           LEFT JOIN payments p ON p.receipt_id = r.id AND p.voided_at IS NULL
          WHERE r.voided_at IS NULL
          GROUP BY r.id, r.total_amount
         HAVING COALESCE(SUM(p.amount), 0) <> r.total_amount`;
    const { rows: mmCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM (${mismatchSub}) t`
    );
    const { rows: mmRows } = await pool.query(
      `SELECT r.id, r.receipt_number, COALESCE(r.student_name, s.name) AS student_name,
              d.name AS department_name, r.total_amount,
              COALESCE(SUM(p.amount), 0) AS lines_sum, r.paid_at
         FROM receipts r
         LEFT JOIN students s ON s.id = r.student_id
         LEFT JOIN departments d ON d.id = r.department_id
         LEFT JOIN payments p ON p.receipt_id = r.id AND p.voided_at IS NULL
        WHERE r.voided_at IS NULL
        GROUP BY r.id, s.name, d.name
       HAVING COALESCE(SUM(p.amount), 0) <> r.total_amount
        ORDER BY r.paid_at DESC
        LIMIT ${HEALTH_MAX_MISMATCH}`
    );

    // 3) Duplicate application numbers. Normalized shape only (upper/trim) —
    //    the point is surfacing collisions for the desk, not validating.
    //    All statuses: a pending app colliding with a verified one is exactly
    //    what the desk needs to see.
    const dupSub = `
         SELECT UPPER(TRIM(student_no)) AS student_no
           FROM fresher_applications
          WHERE student_no IS NOT NULL AND TRIM(student_no) <> ''
          GROUP BY 1
         HAVING COUNT(*) > 1`;
    const { rows: dupCountRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${dupSub}) t`);
    const { rows: dupRows } = await pool.query(
      `SELECT UPPER(TRIM(student_no)) AS student_no, COUNT(*)::int AS applications,
              array_agg(id ORDER BY id) AS application_ids,
              array_agg(full_name ORDER BY id) AS names,
              array_agg(status ORDER BY id) AS statuses
         FROM fresher_applications
        WHERE student_no IS NOT NULL AND TRIM(student_no) <> ''
        GROUP BY 1
       HAVING COUNT(*) > 1
        ORDER BY applications DESC, student_no
        LIMIT ${HEALTH_MAX_DUP}`
    );

    res.json({
      partial_extras: {
        items: schoolNames,
        count: partialRows.length,
        rows: partialRows.slice(0, HEALTH_MAX_PARTIAL),
      },
      total_mismatch: { count: mmCountRows[0].n, rows: mmRows },
      duplicate_applications: { count: dupCountRows[0].n, rows: dupRows },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
