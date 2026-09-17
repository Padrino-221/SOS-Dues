const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText } = require('../src/utils/clean');

test('cleanText safely trims strings and converts numeric values', () => {
  assert.equal(cleanText('  Jane Doe  '), 'Jane Doe');
  assert.equal(cleanText(2024), '2024');
  assert.equal(cleanText(0), '0');
  assert.equal(cleanText(null), null);
  assert.equal(cleanText(undefined), null);
  assert.equal(cleanText('   '), null);
});
