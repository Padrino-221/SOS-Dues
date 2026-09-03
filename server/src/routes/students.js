const express = require('express');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSchoolAdmin, requireAnyAdmin } = require('../middleware/auth');
const { logTransaction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

const STUDENT_SELECT = `
  SELECT s.*, d.name AS department_name, c.name AS class_name, c.level AS class_level,
    CASE WHEN EXISTS (
      SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.type = 'school_dues'
    ) THEN true ELSE false END AS school_dues_paid,
    CASE WHEN EXISTS (
      SELECT 1 FROM student_souvenirs ss WHERE ss.student_id = s.id AND ss.level = 'school'
    ) THEN true ELSE false END AS school_souvenir_collected,
    CASE WHEN EXISTS (
      SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.type = 'department_dues'
    ) THEN true ELSE false END AS dept_dues_paid,
    CASE WHEN EXISTS (
      SELECT 1 FROM student_souvenirs ss WHERE ss.student_id = s.id AND ss.level = 'department'
    ) THEN true ELSE false END AS dept_souvenir_collected
  FROM students s
  LEFT JOIN departments d ON d.id = s.department_id
  LEFT JOIN classes c ON c.id = s.class_id
`;

// ─── List students ───
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    let where = '';
    const params = [];

    // Exclude freshers without a department (they're on the "Pending Freshers" page)
    where = `NOT (s.is_fresher = true AND s.department_id IS NULL)`;

    if (req.user.role === 'dept_admin') {
      params.push(req.user.department_id);
      where += ` AND s.department_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      const searchCond = `(s.name ILIKE $${idx} OR s.student_no ILIKE $${idx})`;
      where += ` AND ${searchCond}`;
    }

    const qs = `${STUDENT_SELECT} WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`;
    const { rows } = await pool.query(qs, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Create student ───
// School Admin: can create both freshers and continuing students
// Dept Admin: cannot create students (only School Admin can)
router.post('/', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { name, student_no, department_id, class_id, is_fresher, admission_year } = req.body;
    if (!name) throw new AppError('Student name is required', 400);

    let student;
    if (is_fresher) {
      const { rows } = await pool.query(
        `INSERT INTO students (name, student_no, is_fresher, admission_year)
         VALUES ($1, $2, true, $3) RETURNING id`,
        [name, student_no || null, admission_year || null]
      );
      student = rows[0];
    } else {
      // Continuing student - must be assigned to a department and class
      if (!department_id || !class_id) throw new AppError('Department and class are required for continuing students', 400);
      const { rows } = await pool.query(
        `INSERT INTO students (name, student_no, department_id, class_id, is_fresher, admission_year)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING *`,
        [name, student_no || null, department_id, class_id, admission_year || null]
      );
      student = rows[0];
    }

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'student_create',
      description: `Registered ${is_fresher ? 'fresher' : 'continuing student'} "${name}" (${student_no || 'no number'})`,
      meta: { student_id: student.id, name, student_no, is_fresher: !!is_fresher, department_id, class_id },
    });

    res.status(201).json(student);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Student number already exists', 409));
    next(err);
  }
});

// ─── List pending freshers (no department assigned) ───
router.get('/freshers/pending', async (req, res, next) => {
  try {
    const { search } = req.query;
    let where = `s.is_fresher = true AND s.department_id IS NULL`;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (s.name ILIKE $1 OR COALESCE(s.student_no,'') ILIKE $1)`;
    }
    const { rows } = await pool.query(
      `${STUDENT_SELECT} WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Adopt fresher into a department ───
router.post('/freshers/pending/adopt', requireAnyAdmin, async (req, res, next) => {
  try {
    const { student_id, department_id, class_id } = req.body;
    if (!student_id || !department_id) throw new AppError('Student and department are required', 400);

    // Dept admins can only adopt into their own department
    if (req.user.role === 'dept_admin' && req.user.department_id !== Number(department_id)) {
      throw new AppError('You can only assign students to your own department', 403);
    }

    const student = await pool.query('SELECT id, is_fresher, name FROM students WHERE id=$1', [student_id]);
    if (student.rows.length === 0) throw new AppError('Student not found', 404);

    const { rows } = await pool.query(
      `UPDATE students SET department_id=$1, class_id=$2 WHERE id=$3 RETURNING *`,
      [department_id, class_id || null, student_id]
    );

    logTransaction({
      admin_id: req.user.id,
      admin_role: req.user.role === 'school_admin' ? 'SCHOOL_ADMIN' : 'DEPT_ADMIN',
      transaction_type: 'student_adopt',
      description: `Assigned fresher "${student.rows[0].name}" to department`,
      meta: { student_id, department_id, class_id: class_id || null },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Get single student ───
router.get('/:id', async (req, res, next) => {
  try {
    let where = 's.id = $1';
    const params = [req.params.id];

    // Dept admins can only see students in their department
    if (req.user.role === 'dept_admin') {
      where += ' AND s.department_id = $2';
      params.push(req.user.department_id);
    }

    const { rows } = await pool.query(`${STUDENT_SELECT} WHERE ${where}`, params);
    if (rows.length === 0) throw new AppError('Student not found', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── Get souvenirs for a student ───
router.get('/:id/souvenirs', async (req, res, next) => {
  try {
    // Dept admins can only see souvenirs for students in their department
    if (req.user.role === 'dept_admin') {
      const check = await pool.query(
        'SELECT id FROM students WHERE id = $1 AND department_id = $2',
        [req.params.id, req.user.department_id]
      );
      if (check.rows.length === 0) throw new AppError('Student not found', 404);
    }

    const { rows } = await pool.query(
      `SELECT ss.souvenir_id, ss.level, sou.name AS souvenir_name
       FROM student_souvenirs ss
       JOIN souvenirs sou ON sou.id = ss.souvenir_id
       WHERE ss.student_id = $1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── Update student (School Admin only) ───
router.put('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { name, student_no, department_id, class_id, admission_year, is_fresher } = req.body;
    const { rows } = await pool.query(
      `UPDATE students SET name=$1, student_no=$2, department_id=$3, class_id=$4,
         admission_year=$5, is_fresher=$6 WHERE id=$7 RETURNING *`,
      [name, student_no || null, department_id, class_id, admission_year || null, !!is_fresher, req.params.id]
    );
    if (rows.length === 0) throw new AppError('Student not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'student_update',
      description: `Updated student "${name}"`,
      meta: { student_id: Number(req.params.id), name, student_no },
    });

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Student number already exists', 409));
    next(err);
  }
});

// ─── Delete student (School Admin only) ───
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM students WHERE id=$1 RETURNING id, name', [req.params.id]);
    if (rows.length === 0) throw new AppError('Student not found', 404);

    logTransaction({
      admin_id: req.user.id,
      admin_role: 'SCHOOL_ADMIN',
      transaction_type: 'student_delete',
      description: `Deleted student "${rows[0].name}"`,
      meta: { student_id: rows[0].id, name: rows[0].name },
    });

    res.json({ message: 'Student deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
