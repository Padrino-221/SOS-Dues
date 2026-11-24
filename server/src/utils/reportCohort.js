const { AppError } = require('./errors');

function parseCohort(value) {
  if (value === undefined || value === '' || value === 'all') return 'all';
  if (value === 'continuing') return value;
  throw new AppError('Invalid student report view', 400);
}

// Use the payer's level at collection, never the level being paid FOR:
// a Level 400 student clearing Level 100 arrears is still continuing.
function receiptCohortFilter(receipt, student, cohort) {
  return cohort === 'continuing'
    ? ` AND COALESCE(${receipt}.level, ${student}.level) IN ('200','300','400')`
    : '';
}
function rosterCohortFilter(student, cohort) {
  return cohort === 'continuing' ? ` AND ${student}.level IN ('200','300','400')` : '';
}
module.exports = { parseCohort, receiptCohortFilter, rosterCohortFilter };
