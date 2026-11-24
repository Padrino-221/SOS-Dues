const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCohort, receiptCohortFilter, rosterCohortFilter } = require('../src/utils/reportCohort');
test('existing reports remain unfiltered unless continuing is explicitly selected', () => {
  assert.equal(parseCohort(undefined), 'all');
  assert.equal(receiptCohortFilter('r','s','all'), '');
  assert.equal(parseCohort('continuing'), 'continuing');
  assert.throws(() => parseCohort('unknown'), e => e.statusCode === 400);
});
test('continuing membership uses payer level, not the level of arrears being paid', () => {
  const sql = receiptCohortFilter('r','s','continuing');
  assert.match(sql, /COALESCE\(r.level, s.level\)/);
  assert.match(sql, /'200','300','400'/);
  assert.doesNotMatch(sql, /payment_level/);
  assert.match(rosterCohortFilter('s','continuing'), /s.level IN/);
});
