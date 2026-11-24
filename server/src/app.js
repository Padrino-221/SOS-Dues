const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { notFound, errorHandler } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const userRoutes = require('./routes/users');
const souvenirRoutes = require('./routes/souvenirs');
const studentRoutes = require('./routes/students');
const fresherRoutes = require('./routes/freshers');
const receiptRoutes = require('./routes/receipts');
const repRoutes = require('./routes/rep');
const reportRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');
const settingRoutes = require('./routes/settings');
const duesItemRoutes = require('./routes/dues-items');

// The Express application, exported with no server/port so it can run either as
// a normal Node server (see index.js) or as a single Vercel Function.
const app = express();

// ── Startup: shout when receipt emails cannot be delivered ─────────────────
// utils/email.js has no SMTP configured → it quietly logs "sent" receipts to
// the console (dev mode), which in production means students never receive
// them while the API still reports success. Never let that pass silently.
function smtpLooksUnset(value) {
  const v = (value || '').trim();
  return !v || /CHANGE_ME/i.test(v);
}

function warnIfEmailUndeliverable() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems = [];
  if (smtpLooksUnset(process.env.SMTP_HOST)) {
    problems.push('SMTP_HOST is missing or still set to CHANGE_ME');
  }
  const authRequired = process.env.SMTP_AUTH !== 'false';
  if (
    authRequired &&
    (smtpLooksUnset(process.env.SMTP_USER) || smtpLooksUnset(process.env.SMTP_PASS))
  ) {
    problems.push('SMTP_USER / SMTP_PASS are missing or still set to CHANGE_ME');
  }
  if (problems.length === 0) return;
  console.warn(
    '\n' +
      '====================================================================\n' +
      '  !!!   RECEIPT EMAILS WILL NOT BE DELIVERED   !!!\n' +
      '====================================================================\n' +
      '  NODE_ENV=production, but SMTP is not configured:\n' +
      problems.map((p) => `    - ${p}`).join('\n') +
      '\n' +
      '\n' +
      '  email.js falls back to DEV MODE: every "sent" receipt is only\n' +
      '  printed to this log. No student or admin will receive an email,\n' +
      '  and the API still reports success.\n' +
      '\n' +
      '  Fix: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM\n' +
      '  in server/.env, then restart the API.\n' +
      '====================================================================\n'
  );
}
warnIfEmailUndeliverable();

// Behind Vercel's proxy the client IP arrives in X-Forwarded-For; trust the
// first hop so express-rate-limit reads the real client address.
app.set('trust proxy', 1);

// CORS: fail closed — only allow the configured client origin(s). When the
// frontend and API are served from the same deployment (Vercel Services), the
// requests are same-origin and not subject to CORS, so this works regardless.
const clientUrl = (process.env.CLIENT_URL || '').trim();
app.use(
  cors({
    origin: clientUrl ? clientUrl.split(',').map((u) => u.trim()) : false,
    credentials: true,
  })
);

// Secure HTTP headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet());

app.use(express.json({ limit: '100kb' }));

// ── Rate limits are always JSON ────────────────────────────────────────────
// express-rate-limit's default handler (and every `message: '…'` string in the
// routes) answers with text/html, which the client cannot branch on. Wrap
// res.send once per request so ANY limiter that hasn't installed its own
// res.json() handler emits the same machine-readable 429. Custom handlers that
// already set an application/json Content-Type are passed through untouched.
app.use((req, res, next) => {
  const send = res.send.bind(res);
  res.send = (body) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (res.statusCode === 429 && typeof body === 'string' && contentType.indexOf('json') === -1) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return send(
        JSON.stringify({
          error: 'Too many requests — please wait a moment and try again.',
          code: 'RATE_LIMITED',
        })
      );
    }
    return send(body);
  };
  next();
});

// API data is dynamic — never let browsers/proxies serve a stale cached copy.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
// /api/classes is intentionally NOT mounted: classes were replaced by levels
// (Phase C). The route file stays until the schema drop, then goes away.
app.use('/api/users', userRoutes);
app.use('/api/souvenirs', souvenirRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/freshers', fresherRoutes); // fresher pre-registration applications (School Admin)
app.use('/api/receipts', receiptRoutes);
app.use('/api/public', repRoutes); // public class rep routes (department-code based)
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/dues-items', duesItemRoutes); // additional dues items (freshers "Other Dues")

app.use(notFound);
app.use(errorHandler);

module.exports = app;
