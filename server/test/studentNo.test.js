const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStudentNo,
  assertStudentNoShape,
  STUDENT_NO_STRICT_RE,
} = require('../src/utils/studentNo');

// ─── normalizeStudentNo: how a reference number is stored ───

test('normalize trims, uppercases and drops inner spaces', () => {
  assert.equal(normalizeStudentNo(' ua2621480 '), 'UA2621480');
  assert.equal(normalizeStudentNo('ua 26 21480'), 'UA2621480');
  assert.equal(normalizeStudentNo('UA\t2621480'), 'UA2621480');
});

test('normalize strips stray trailing punctuation (the queue junk)', () => {
  assert.equal(normalizeStudentNo('UA2621480,'), 'UA2621480');
  assert.equal(normalizeStudentNo('UA2621480..'), 'UA2621480');
  assert.equal(normalizeStudentNo('UAS.2610949.'), 'UAS.2610949'); // internal dot kept
});

test('normalize handles null/undefined/blank as empty string', () => {
  assert.equal(normalizeStudentNo(null), '');
  assert.equal(normalizeStudentNo(undefined), '');
  assert.equal(normalizeStudentNo('   '), '');
});

// ─── assertStudentNoShape: junk never enters the queue ───

test('shape refuses phone numbers (digits only, with or without +)', () => {
  assert.throws(() => assertStudentNoShape('555899396'), /phone number/);
  assert.throws(() => assertStudentNoShape('0245159722'), /phone number/);
  assert.throws(() => assertStudentNoShape('+233541519315'), /phone number/);
});

test('shape refuses empty and over-long numbers', () => {
  assert.throws(() => assertStudentNoShape(''), /required/);
  assert.throws(() => assertStudentNoShape('UA23456789012345678901'), /too long/);
});

test('shape refuses letters-and-digits numbers carrying stray characters', () => {
  assert.throws(() => assertStudentNoShape('UA2621480+4'), /letters, numbers/);
  assert.throws(() => assertStudentNoShape('UA26#21480'), /letters, numbers/);
});

test('shape accepts the real reference formats seen in the wild', () => {
  assertStudentNoShape('UA2309264'); // standard
  assertStudentNoShape('US2621456'); // alternate prefix
  assertStudentNoShape('SMK/2021/045'); // admission-letter format
  assertStudentNoShape('UAS.2610949'); // dotted
  assertStudentNoShape('260929UEN1096319'); // letters in the middle
});

// ─── STUDENT_NO_STRICT_RE: the desk retypes format ───

test('strict format is UA + 7 digits only', () => {
  assert.ok(STUDENT_NO_STRICT_RE.test('UA2309264'));
  assert.ok(!STUDENT_NO_STRICT_RE.test('US2621456')); // other prefix
  assert.ok(!STUDENT_NO_STRICT_RE.test('UA260583')); // truncated
  assert.ok(!STUDENT_NO_STRICT_RE.test('UA2621480,')); // stray comma
  assert.ok(!STUDENT_NO_STRICT_RE.test('2309264')); // missing prefix
});
