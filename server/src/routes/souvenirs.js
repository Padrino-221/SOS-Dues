const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

// ─── List souvenirs ───
// School Admin: sees ALL souvenirs
// Dept Admin: sees department-category souvenirs only (for their dept's distribution)
router.get('/', async (req, res, next) => {
  try {
    let query = 'SELECT * FROM souvenirs';
    const params = [];

    if (req.user.role === 'dept_admin') {
      query += ' WHERE category = $1';
      params.push('department');
    }

    query += ' ORDER BY category, name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Create souvenir ───
// School Admin: can create any souvenir
// Dept Admin: can create department-category souvenirs only
router.post('/', async (req, res, next) => {
  try {
    const { name, category, cost } = req.body;
    if (!name) throw new AppError('Souvenir name is required', 400);

    const souvenirCategory = category || 'school';

    // Dept Admins can only create department souvenirs
    if (req.user.role === 'dept_admin' && souvenirCategory !== 'department') {
      throw new AppError('Department Admins can only create department-category souvenirs', 403);
    }

    const { rows } = await pool.query(
      'INSERT INTO souvenirs (name, category, cost) VALUES ($1, $2, $3) RETURNING *',
      [name, souvenirCategory, cost ?? 0]
    );

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_create',
      description: `Created ${souvenirCategory} souvenir "${name}"`,
      meta: { souvenir_id: rows[0].id, name, category: souvenirCategory, cost: cost ?? 0 },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Update souvenir ───
// School Admin: can update any souvenir
// Dept Admin: can update department-category souvenirs only
router.put('/:id', async (req, res, next) => {
  try {
    const { name, category, cost } = req.body;

    // Dept Admins can only modify department souvenirs
    if (req.user.role === 'dept_admin') {
      const existing = await pool.query('SELECT category FROM souvenirs WHERE id = $1', [req.params.id]);
      if (existing.rows.length === 0) throw new AppError('Souvenir not found', 404);
      if (existing.rows[0].category !== 'department') {
        throw new AppError('Department Admins can only modify department-category souvenirs', 403);
      }
    }

    const { rows } = await pool.query(
      'UPDATE souvenirs SET name=$1, category=$2, cost=$3 WHERE id=$4 RETURNING *',
      [name, category, cost ?? 0, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Souvenir not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_update',
      description: `Updated ${category} souvenir "${name}"`,
      meta: { souvenir_id: Number(req.params.id), name, category, cost: cost ?? 0 },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Delete souvenir ───
// School Admin: can delete any souvenir
// Dept Admin: can delete department-category souvenirs only
router.delete('/:id', async (req, res, next) => {
  try {
    // Dept Admins can only delete department souvenirs
    if (req.user.role === 'dept_admin') {
      const existing = await pool.query('SELECT category, name FROM souvenirs WHERE id = $1', [req.params.id]);
      if (existing.rows.length === 0) throw new AppError('Souvenir not found', 404);
      if (existing.rows[0].category !== 'department') {
        throw new AppError('Department Admins can only delete department-category souvenirs', 403);
      }
    }

    const { rows } = await pool.query('DELETE FROM souvenirs WHERE id=$1 RETURNING id, name, category', [req.params.id]);
    if (rows.length === 0) throw new AppError('Souvenir not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'souvenir_delete',
      description: `Deleted ${rows[0].category} souvenir "${rows[0].name}"`,
      meta: { souvenir_id: rows[0].id, name: rows[0].name, category: rows[0].category },
    });

    res.json({ message: 'Souvenir deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
