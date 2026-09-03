const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── List audit log entries ───
// School Admin: sees ALL entries
// Dept Admin: sees only entries related to their department
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    const { where, params } = buildWhere(req);

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Count total
    const countQuery = `SELECT COUNT(*) AS total FROM transaction_log tl ${whereClause}`;
    const countRes = await pool.query(countQuery, params);
    const total = Number(countRes.rows[0].total);

    // Fetch page
    params.push(Number(limit));
    params.push(offset);
    const dataQuery = `
      SELECT tl.id, tl.admin_id, tl.admin_role, tl.transaction_type,
             tl.description, tl.meta, tl.created_at,
             u.name AS admin_name, u.email AS admin_email
      FROM transaction_log tl
      LEFT JOIN users u ON u.id = tl.admin_id
      ${whereClause}
      ORDER BY tl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await pool.query(dataQuery, params);

    res.json({
      entries: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Build WHERE clause from query params (shared by list + export) ───
function buildWhere(req) {
  const params = [];
  let where = [];

  if (req.user.role === 'dept_admin') {
    params.push(req.user.id);
    params.push(req.user.department_id);
    where.push(`(
      tl.admin_id = $1
      OR (tl.meta->>'department_id')::int = $2
      OR tl.admin_role = 'REP'
    )`);
  }

  if (req.query.type) {
    params.push(req.query.type);
    where.push(`tl.transaction_type = $${params.length}`);
  }

  if (req.query.admin_role) {
    params.push(req.query.admin_role);
    where.push(`tl.admin_role = $${params.length}`);
  }

  return { where, params };
}

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ─── Export audit log as CSV ───
router.get('/export', async (req, res, next) => {
  try {
    const { where, params } = buildWhere(req);
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT tl.id, tl.transaction_type, tl.description, tl.admin_role,
             tl.meta, tl.created_at,
             u.name AS admin_name, u.email AS admin_email
       FROM transaction_log tl
       LEFT JOIN users u ON u.id = tl.admin_id
       ${whereClause}
       ORDER BY tl.created_at DESC`,
      params
    );

    const header = 'ID,Timestamp,Type,Description,Admin Name,Admin Email,Admin Role,Meta';
    const lines = rows.map((r) =>
      [
        r.id,
        r.created_at,
        r.transaction_type,
        r.description,
        r.admin_name || '',
        r.admin_email || '',
        r.admin_role,
        r.meta ? JSON.stringify(r.meta) : '',
      ].map(escCsv).join(',')
    );
    const csv = [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── Get audit log summary stats (School Admin only) ───
router.get('/stats', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        transaction_type,
        COUNT(*) AS count,
        MAX(created_at) AS last_occurrence
      FROM transaction_log
      GROUP BY transaction_type
      ORDER BY count DESC
    `);

    const totalRes = await pool.query('SELECT COUNT(*) AS total FROM transaction_log');

    res.json({
      total: Number(totalRes.rows[0].total),
      byType: rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
