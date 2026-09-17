const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReceiptNumber, tagForLines } = require('../src/utils/receipt');

test('buildReceiptNumber formats SOS-DUES-<TAG>-<studentNo>-<n>', () => {
  assert.equal(
    buildReceiptNumber({ tag: 'SCH', studentNo: 'UEB3227523', seq: 1 }),
    'SOS-DUES-SCH-UEB3227523-1'
  );
  assert.equal(
    buildReceiptNumber({ tag: 'DEPT', studentNo: 'UEB3227523', seq: 2 }),
    'SOS-DUES-DEPT-UEB3227523-2'
  );
  assert.equal(
    buildReceiptNumber({ tag: 'DUES', studentNo: 'UEB3227523', seq: 12 }),
    'SOS-DUES-DUES-UEB3227523-12'
  );
});

test('buildReceiptNumber normalizes the tag and student number case', () => {
  assert.equal(
    buildReceiptNumber({ tag: 'sch', studentNo: 'ueb3227523', seq: 3 }),
    'SOS-DUES-SCH-UEB3227523-3'
  );
});

test('buildReceiptNumber rejects unknown tags and invalid sequences', () => {
  assert.throws(() => buildReceiptNumber({ tag: 'XYZ', studentNo: 'UEB3227523', seq: 1 }));
  assert.throws(() => buildReceiptNumber({ tag: 'SCH', studentNo: 'UEB3227523', seq: 0 }));
});

test('buildReceiptNumber requires a student number', () => {
  assert.throws(
    () => buildReceiptNumber({ tag: 'SCH', studentNo: '', seq: 1 }),
    /student number/i
  );
});

test('tagForLines derives SCH, DEPT and combined DUES', () => {
  assert.equal(tagForLines([{ type: 'school_dues' }]), 'SCH');
  assert.equal(tagForLines([{ type: 'department_dues' }]), 'DEPT');
  assert.equal(
    tagForLines([{ type: 'school_dues' }, { type: 'department_dues' }]),
    'DUES'
  );
});
