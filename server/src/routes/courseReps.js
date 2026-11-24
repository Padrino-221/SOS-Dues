const express = require('express');
const { randomBytes, createHash } = require('node:crypto');
const { getTransporter } = require('../utils/email');
const { courseRepInvitation } = require('../utils/courseRepInvitation');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');
const router = express.Router();

router.use((req, res, next) => {
  if (req.user.role !== 'super_admin') return next(new AppError('Access denied', 403));
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT c.id,c.name,c.email,c.disabled_at,(c.invite_hash IS NOT NULL) AS password_pending,d.name AS department
      FROM course_reps c JOIN departments d ON d.id=c.department_id ORDER BY d.name,c.name`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/import', async (req, res, next) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) {
      throw new AppError('Provide 1 to 100 accounts per import', 400);
    }
    const { rows: departments } = await pool.query('SELECT id,name,code FROM departments');
    const emails = new Set();
    const accounts = rows.map((row, index) => {
      const { name, email, department } = row || {};
      const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const matches = departments.filter(d => d.name.trim().toLowerCase() === String(department).trim().toLowerCase());
      if (typeof name !== 'string' || !name.trim() || name.length > 150 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254 ||
          matches.length !== 1 || emails.has(cleanEmail)) {
        throw new AppError(`Row ${index + 1}: check name, unique email, full department name.`, 400);
      }
      emails.add(cleanEmail);
      return { name: name.trim(), email: cleanEmail, department_id: matches[0].id, department: matches[0].name.trim(), code: matches[0].code };
    });
    const mail = getTransporter();
    if (!mail || !(process.env.SMTP_FROM || process.env.SMTP_USER)) {
      throw new AppError('Email delivery is not configured. No accounts were imported.', 503);
    }
    const invitations = accounts.map(account => {
      const token = randomBytes(32).toString('hex');
      return {
        ...account, token,
        invite_hash: createHash('sha256').update(token).digest('hex'),
        password_hash: 'pending-invitation',
      };
    });
    const { rows: saved } = await pool.query(`INSERT INTO course_reps
        (name,email,department_id,password_hash,invite_hash,invite_expires_at)
      SELECT name,email,department_id,password_hash,invite_hash,NOW()+INTERVAL '48 hours'
      FROM jsonb_to_recordset($1::jsonb)
        AS x(name text,email text,department_id integer,password_hash text,invite_hash text)
      ON CONFLICT (email) DO UPDATE SET invite_hash=EXCLUDED.invite_hash,
        invite_expires_at=EXCLUDED.invite_expires_at
      WHERE course_reps.invite_hash IS NOT NULL AND course_reps.disabled_at IS NULL
        AND course_reps.department_id=EXCLUDED.department_id
      RETURNING email`, [JSON.stringify(invitations.map(({token, code, ...row}) => row))]);
    const eligible = new Set(saved.map(row => row.email));
    const failed = [], skipped = [];
    for (const { name, email, department, code, token } of invitations) {
      if (!eligible.has(email)) { skipped.push(email); continue; }
      try {
        await mail.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          ...courseRepInvitation({ name, email, department, code, token, baseUrl: process.env.CLIENT_URL }),
        });
      } catch { failed.push(email); }
    }
    res.status(201).json({ invited: saved.length - failed.length, failed, skipped });
  } catch (err) {
    next(err.code === '23505' ? new AppError('An email already belongs to a course rep. No accounts were imported.', 409) : err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) throw new AppError('Invalid account', 400);
    const { name, email, department } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim() || name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254 || typeof department !== 'string') {
      throw new AppError('Provide a full name, valid email and department.', 400);
    }
    const { rows: departments } = await pool.query('SELECT id FROM departments WHERE lower(trim(name))=lower(trim($1))', [department]);
    if (departments.length !== 1) throw new AppError('Choose an existing department.', 400);
    const replacementHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const result = await pool.query(`UPDATE course_reps SET name=$1,
      invite_hash=CASE WHEN email<>$2 AND invite_hash IS NOT NULL THEN $4 ELSE invite_hash END,
      email=$2,department_id=$3 WHERE id=$5 RETURNING id`, [name.trim(), cleanEmail, departments[0].id, replacementHash, req.params.id]);
    if (!result.rowCount) throw new AppError('Course rep not found', 404);
    res.json({ updated: true });
  } catch (err) { next(err.code === '23505' ? new AppError('This email already belongs to another course rep.', 409) : err); }
});

router.post('/:id/reset-password', async (req, res, next) => {
  let db;
  try {
    if (!/^\d+$/.test(req.params.id)) throw new AppError('Invalid account', 400);
    const mail = getTransporter();
    if (!mail || !(process.env.SMTP_FROM || process.env.SMTP_USER)) throw new AppError('Email delivery is not configured.', 503);
    db = await pool.connect();
    await db.query('BEGIN');
    const { rows } = await db.query(`SELECT c.id,c.name,c.email,c.disabled_at,d.name AS department,d.code
      FROM course_reps c JOIN departments d ON d.id=c.department_id WHERE c.id=$1 FOR UPDATE OF c`, [req.params.id]);
    const account = rows[0];
    if (!account) throw new AppError('Course rep not found', 404);
    if (account.disabled_at) throw new AppError('Disabled accounts cannot receive a password reset.', 409);
    const token = randomBytes(32).toString('hex');
    const content = courseRepInvitation({ ...account, token, baseUrl: process.env.CLIENT_URL });
    content.subject = 'Reset your School of Sciences course rep password';
    content.text = content.text.replace('Your School of Sciences Dues Management course rep account is ready.', 'Your administrator has requested a password reset for your course rep account.');
    content.html = content.html.replace('Your course rep account</h1>', 'Reset your password</h1>').replace('Your Dues Management account is ready. Visit the link below to set your password before signing in.', 'Your administrator has requested a password reset. Use the one-time link below to choose a new password.');
    try { await mail.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: account.email, ...content }); }
    catch { throw new AppError('Could not send the reset email. The current password and links have not been changed.', 503); }
    await db.query(`UPDATE course_reps SET invite_hash=$1,invite_expires_at=NOW()+INTERVAL '48 hours' WHERE id=$2`, [createHash('sha256').update(token).digest('hex'), account.id]);
    await db.query('COMMIT');
    res.json({ sent: true });
  } catch (err) { if (db) await db.query('ROLLBACK'); next(err); }
  finally { db?.release(); }
});

router.post('/:id/disable', async (req, res, next) => {
  try {
    const result = await pool.query('UPDATE course_reps SET disabled_at=NOW() WHERE id=$1', [req.params.id]);
    if (!result.rowCount) throw new AppError('Course rep not found', 404);
    res.sendStatus(204);
  } catch (err) { next(err); }
});

module.exports = router;
