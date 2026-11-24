const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, isAnySchool } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');
const { cleanText } = require('../utils/clean');
const { extrasScopeForRole } = require('../utils/extraDuesEdit');

// ─── Additional dues items ("Other Dues") ───
// Named extra charges freshers pay alongside School dues at verification and
// manual registration. department_id NULL = school-wide (every fresher).
//
// Who manages what:
//   school_admin — school-wide items only
//   dept_admin   — their own department's items only (never school-wide)
// A department's items belong to that department's admin. School accounts can
// still READ every item — the verify desk needs the payable set for whichever
// department the fresher is being assigned — but management is per role.
// Items are deactivated, not deleted, once charged (see DELETE below).

const router = express.Router();
router.use(requireAuth);

const MANAGE_ROLES = ['school_admin', 'super_admin', 'dept_admin'];

// The scope a dept admin may touch: their own department (never school-wide).
function assertDeptScope(user, departmentId) {
  if (user.role !== 'dept_admin') return;
  if (!user.department_id) throw new AppError('Your account has no department', 403);
  if (Number(departmentId) !== Number(user.department_id)) {
    throw new AppError('Department admins can only manage their own department', 403);
  }
}

function parseAmount(raw, { required }) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required) throw new AppError('Enter an amount', 400);
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new AppError('A valid amount is required', 400);
  return Math.round(parsed * 100) / 100;
}

function parseName(raw) {
  const name = cleanText(raw);
  if (!name) throw new AppError('A name is required for the dues item', 400);
  if (name.length > 60) throw new AppError('Keep the item name under 60 characters', 400);
  return name;
}

// 'any' (default) | 'male' | 'female' — which students the item may be
// charged to. Enforced at charge and edit time by genderMismatch (extraDues);
// the pickers grey out the other gender's items to match.
function parseGender(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'any';
  const g = String(raw).trim().toLowerCase();
  if (!['any', 'male', 'female'].includes(g)) {
    throw new AppError('Applies to must be "any", "male" or "female"', 400);
  }
  return g;
}

// ─── List ───
// School accounts: everything (read-only visibility — the verify desk needs
// every applicable item), filterable (?department_id=all|school|<id>).
// Dept accounts: school-wide items + their own department's items.
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const conds = [];
    // ?toggleable=1 — restrict to items this actor may check/uncheck on a
    // receipt. The money-scope rule lives in extrasScopeForRole (shared with
    // both extra-dues endpoints): school_admin/school_staff → school-wide
    // items; dept_admin/dept_staff → their own department's items;
    // super_admin → everything. Enforced server-side so the UI can never
    // offer a toggle the server would reject.
    if (req.query.toggleable === '1') {
      const scope = extrasScopeForRole(req.user);
      if (scope === 'none') return res.json([]);
      if (scope === 'any') {
        // no scope restriction
      } else if (scope === null) {
        conds.push('di.department_id IS NULL');
      } else {
        params.push(scope);
        conds.push('di.department_id = $1');
      }
    } else if (isAnySchool(req.user)) {
      const filter = req.query.department_id ? String(req.query.department_id) : null;
      if (filter === 'school') {
        conds.push('di.department_id IS NULL');
      } else if (filter && filter !== 'all') {
        params.push(Number(filter));
        conds.push('(di.department_id IS NULL OR di.department_id = $1)');
      }
    } else {
      if (!req.user.department_id) {
        return res.json([]);
      }
      params.push(req.user.department_id);
      conds.push('(di.department_id IS NULL OR di.department_id = $1)');
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT di.id, di.name, di.amount, di.gender, di.department_id, di.active,
              d.name AS department_name, di.created_at, di.updated_at
         FROM dues_items di
         LEFT JOIN departments d ON d.id = di.department_id
         ${where}
        ORDER BY di.department_id NULLS FIRST, di.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Create ───
router.post('/', async (req, res, next) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      throw new AppError('Only admins can manage additional dues', 403);
    }
    const name = parseName(req.body?.name);
    const amount = parseAmount(req.body?.amount, { required: true });
    const gender = parseGender(req.body?.gender);
    const departmentId = req.body?.department_id ? Number(req.body.department_id) : null;
    if ((req.user.role === 'school_admin' || req.user.role === 'super_admin') && departmentId) {
      throw new AppError("A department's dues items are managed by that department's admin", 403);
    }
    assertDeptScope(req.user, departmentId);

    const dup = await pool.query(
      `SELECT 1 FROM dues_items WHERE active AND name = $1
         AND department_id IS NOT DISTINCT FROM $2`,
      [name, departmentId]
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        departmentId
          ? 'This department already has an active dues item with that name'
          : 'An active school-wide dues item with that name already exists',
        409
      );
    }

    const { rows } = await pool.query(
      `INSERT INTO dues_items (name, amount, gender, department_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, amount, gender, departmentId, req.user.id]
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role.toUpperCase(),
      transaction_type: 'dues_item_create',
      description: `Created additional dues "${name}" (GHS ${amount.toFixed(2)}, ${
        gender === 'any' ? 'all students' : gender + '-only'
      }) ${departmentId ? 'for department #' + departmentId : 'school-wide'}`,
      meta: { dues_item_id: rows[0].id, name, amount, gender, department_id: departmentId },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23503') return next(new AppError('Department not found', 404));
    next(err);
  }
});

// ─── Update (name / amount / active) ───
router.put('/:id', async (req, res, next) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      throw new AppError('Only admins can manage additional dues', 403);
    }
    const id = Number(req.params.id);
    const { rows: existing } = await pool.query('SELECT * FROM dues_items WHERE id = $1', [id]);
    if (existing.length === 0) throw new AppError('Dues item not found', 404);
    const item = existing[0];
    if (
      (req.user.role === 'school_admin' || req.user.role === 'super_admin') &&
      item.department_id
    ) {
      throw new AppError("A department's dues items are managed by that department's admin", 403);
    }
    assertDeptScope(req.user, item.department_id);

    const name = req.body?.name !== undefined ? parseName(req.body.name) : item.name;
    const amount =
      req.body?.amount !== undefined
        ? parseAmount(req.body.amount, { required: true })
        : Number(item.amount);
    const gender = req.body?.gender !== undefined ? parseGender(req.body.gender) : item.gender;
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : Boolean(item.active);

    const dup = await pool.query(
      `SELECT 1 FROM dues_items WHERE active AND name = $1
         AND department_id IS NOT DISTINCT FROM $2 AND id <> $3`,
      [name, item.department_id, id]
    );
    if (dup.rows.length > 0)
      throw new AppError('Another active item in this scope uses that name', 409);

    const { rows } = await pool.query(
      `UPDATE dues_items SET name = $1, amount = $2, gender = $3, active = $4, updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [name, amount, gender, active, id]
    );
    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role.toUpperCase(),
      transaction_type: 'dues_item_update',
      description: `Updated additional dues "${name}"${
        active === item.active ? '' : active ? ' (reactivated)' : ' (deactivated)'
      } — GHS ${amount.toFixed(2)}${
        gender === item.gender
          ? ''
          : gender === 'any'
            ? ' (now for all students)'
            : ` (now ${gender}-only)`
      }${item.department_id ? ` (department #${item.department_id})` : ' (school-wide)'}`,
      meta: {
        dues_item_id: id,
        name,
        amount,
        gender,
        active,
        previous: {
          name: item.name,
          amount: Number(item.amount),
          gender: item.gender,
          active: item.active,
        },
      },
    });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Delete ───
// Only while the item has never been charged: once any extra_dues payment
// line carries its name snapshot the record is financial history and must be
// deactivated instead.
router.delete('/:id', async (req, res, next) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      throw new AppError('Only admins can manage additional dues', 403);
    }
    const id = Number(req.params.id);
    const { rows: existing } = await pool.query('SELECT * FROM dues_items WHERE id = $1', [id]);
    if (existing.length === 0) throw new AppError('Dues item not found', 404);
    const item = existing[0];
    if (
      (req.user.role === 'school_admin' || req.user.role === 'super_admin') &&
      item.department_id
    ) {
      throw new AppError("A department's dues items are managed by that department's admin", 403);
    }
    assertDeptScope(req.user, item.department_id);

    const charged = await pool.query(
      `SELECT 1 FROM payments
        WHERE type = 'extra_dues' AND label = $1
          AND department_id IS NOT DISTINCT FROM $2
        LIMIT 1`,
      [item.name, item.department_id]
    );
    if (charged.rows.length > 0) {
      throw new AppError(
        'This item has already been charged — deactivate it instead of deleting it',
        409
      );
    }

    await pool.query('DELETE FROM dues_items WHERE id = $1', [id]);
    await logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role.toUpperCase(),
      transaction_type: 'dues_item_delete',
      description: `Deleted unused additional dues "${item.name}"${
        item.department_id ? ` (department #${item.department_id})` : ' (school-wide)'
      }`,
      meta: { dues_item_id: id, name: item.name, department_id: item.department_id },
    });
    res.json({ message: 'Dues item deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
