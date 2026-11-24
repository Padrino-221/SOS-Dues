const { AppError } = require('./errors');
const { normalizeLevel } = require('./levels');

function continuingPayer(body) {
  const name = String(body.student_name ?? '').trim();
  const no = String(body.student_no ?? '').trim().toUpperCase();
  const email = String(body.email ?? '').trim();
  const className = String(body.class_name ?? '').trim();
  const level = normalizeLevel(body.level);
  const paymentLevel = normalizeLevel(body.payment_level);
  if (!name || name.length > 200) throw new AppError('Enter a student name (up to 200 characters)', 400);
  if (!no || no.length > 80) throw new AppError('Enter an index number (up to 80 characters)', 400);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('Enter a valid student email address', 400);
  }
  if (!className || className.length > 120) throw new AppError('Enter the class (up to 120 characters)', 400);
  if (!['200', '300', '400'].includes(level)) {
    throw new AppError('Select the current level (200, 300 or 400)', 400);
  }
  if (!paymentLevel) throw new AppError('Select the level being paid for', 400);
  return { name, no, email, className, level, paymentLevel };
}

module.exports = { continuingPayer };
