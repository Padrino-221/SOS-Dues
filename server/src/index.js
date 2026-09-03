const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { notFound, errorHandler } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const classRoutes = require('./routes/classes');
const userRoutes = require('./routes/users');
const souvenirRoutes = require('./routes/souvenirs');
const studentRoutes = require('./routes/students');
const paymentRoutes = require('./routes/payments');
const repRoutes = require('./routes/rep');
const reportRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/users', userRoutes);
app.use('/api/souvenirs', souvenirRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/public', repRoutes); // public class rep routes
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Dues Management API running on port ${PORT}`);
});
