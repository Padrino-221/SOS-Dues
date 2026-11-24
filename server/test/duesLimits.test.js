const { test } = require('node:test');
const assert = require('node:assert');
const { MAIN_DUES_MAX, assertMainDues } = require('../src/utils/duesLimits');

test('main-dues cap: amounts within the cap pass', () => {
  assert.doesNotThrow(() => assertMainDues(0, 'School dues'));
  assert.doesNotThrow(() => assertMainDues(40, 'School dues'));
  assert.doesNotThrow(() => assertMainDues(MAIN_DUES_MAX, 'School dues'));
  assert.doesNotThrow(() => assertMainDues('59.99', 'Department dues'));
});

test('main-dues cap: amounts above the cap throw a 400 that never states the number', () => {
  assert.throws(
    () => assertMainDues(60.01, 'School dues'),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /School dues amount exceeds the allowed maximum/);
      assert.ok(!/\d/.test(err.message), 'error message must not contain the cap value');
      return true;
    }
  );
  assert.throws(
    () => assertMainDues(61, 'Department dues'),
    /Department dues amount exceeds the allowed maximum/
  );
});
