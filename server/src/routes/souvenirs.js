const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireAnyAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth, requireAnyAdmin);

function assertCanManageSouvenirs(req) {
  if (!['school_admin', 'dept_admin'].includes(req.user.role)) {
    throw new AppError('Only School or Department Admins can manage souvenirs', 403);
  }
}

// ─── List souvenirs ───
// School Admin: supervision — sees school souvenirs and every department's
//                souvenirs (read-only for department-owned items).
// Dept Admin:   only their own department's souvenirs (the ones they hand out
//                when admitting freshers).
router.get('/', async (req, res, next) => {
  try {
    if (['dept_admin', 'dept_staff'].includes(req.user.role)) {
      const { rows } = await pool.query(
        `SELECT s.*, d.name AS department_name
         FROM souvenirs s
         LEFT JOIN departments d ON d.id = s.department_id
         WHERE s.department_id = $1
         ORDER BY s.name`,
        [req.user.department_id]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT s.*, d.name AS department_name
       FROM souvenirs s
       LEFT JOIN departments d ON d.id = s.department_id
       ORDER BY s.category, s.department_id NULLS FIRST, s.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Create souvenir ───
// School Admin: school souvenirs only (category = 'school').
// Dept Admin:   department souvenirs for their own department only.
router.post('/', async (req, res, next) => {
  try {
    assertCanManageSouvenirs(req);
    const { name, category, cost } = req.body;
    if (!name) throw new AppError('Souvenir name is required', 400);

    let cat = category === 'department' ? 'department' : 'school';
    let departmentId = null;

    if (req.user.role === 'dept_admin') {
      // Dept admins may only add souvenirs for their own department
      cat = 'department';
      departmentId = req.user.department_id;
    } else {
      // School Admin manages the school-level souvenir catalogue only.
      // Department souvenirs are configured by each department admin.
      if (cat === 'department') {
        throw new AppError(
          'Department souvenirs are configured by each Department Admin. School Admin manages School souvenirs only.',
          403
        );
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO souvenirs (name, category, department_id, cost)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, cat, departmentId, cost ?? 0]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_create',
      description: `Created ${cat} souvenir "${name}"`,
      meta: {
        souvenir_id: rows[0].id,
        name,
        category: cat,
        department_id: departmentId,
        cost: cost ?? 0,
      },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Update souvenir ───
router.put('/:id', async (req, res, next) => {
  try {
    assertCanManageSouvenirs(req);
    const { name, category, cost } = req.body;
    const existing = await pool.query('SELECT * FROM souvenirs WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) throw new AppError('Souvenir not found', 404);
    const row = existing.rows[0];

    // Ownership rules mirror create
    if (req.user.role === 'dept_admin') {
      if (row.department_id !== req.user.department_id) {
        throw new AppError('You can only manage your own department souvenirs', 403);
      }
      if (category && category !== 'department') {
        throw new AppError('Dept Admins can only keep souvenirs as department souvenirs', 403);
      }
    } else {
      if (row.category !== 'school') {
        throw new AppError(
          'School Admin only manages School souvenirs. Department souvenirs are managed by each department.',
          403
        );
      }
      if (category && category !== 'school') {
        throw new AppError('School Admin can only create School souvenirs', 403);
      }
    }

    const cat = row.category;
    const { rows } = await pool.query(
      'UPDATE souvenirs SET name = $1, category = $2, cost = $3 WHERE id = $4 RETURNING *',
      [name, cat, cost ?? row.cost, req.params.id]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_update',
      description: `Updated ${cat} souvenir "${name}"`,
      meta: { souvenir_id: Number(req.params.id), name, category: cat, cost: cost ?? row.cost },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Delete souvenir ───
router.delete('/:id', async (req, res, next) => {
  try {
    assertCanManageSouvenirs(req);
    const existing = await pool.query('SELECT * FROM souvenirs WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) throw new AppError('Souvenir not found', 404);
    const row = existing.rows[0];

    if (req.user.role === 'dept_admin') {
      if (row.department_id !== req.user.department_id) {
        throw new AppError('You can only manage your own department souvenirs', 403);
      }
    } else if (row.category !== 'school') {
      throw new AppError(
        'School Admin only manages School souvenirs. Department souvenirs are managed by each department.',
        403
      );
    }

    const { rows } = await pool.query(
      'DELETE FROM souvenirs WHERE id = $1 RETURNING id, name, category',
      [req.params.id]
    );

    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_delete',
      description: `Deleted ${rows[0].category} souvenir "${rows[0].name}"`,
      meta: { souvenir_id: rows[0].id },
    });

    res.json({ message: 'Souvenir deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
