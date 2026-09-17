const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { notFound, errorHandler } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const classRoutes = require('./routes/classes');
const userRoutes = require('./routes/users');
const souvenirRoutes = require('./routes/souvenirs');
const studentRoutes = require('./routes/students');
const fresherRoutes = require('./routes/freshers');
const receiptRoutes = require('./routes/receipts');
const repRoutes = require('./routes/rep');
const reportRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');
const settingRoutes = require('./routes/settings');

// The Express application, exported with no server/port so it can run either as
// a normal Node server (see index.js) or as a single Vercel Function.
const app = express();

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

// API data is dynamic — never let browsers/proxies serve a stale cached copy.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/users', userRoutes);
app.use('/api/souvenirs', souvenirRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/freshers', fresherRoutes); // fresher pre-registration applications (School Admin)
app.use('/api/receipts', receiptRoutes);
app.use('/api/public', repRoutes); // public class rep routes (department-code based)
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
