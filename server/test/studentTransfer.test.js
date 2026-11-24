const { test } = require('node:test');
const assert = require('node:assert');
const {
  validateTransfer,
  describeTransfer,
  TRANSFER_MAX_REASON,
} = require('../src/utils/studentTransfer');

// Minimal student/department rows shaped like the DB returns them.
const student = (over = {}) => ({
  id: 42,
  name: 'Daniel Kpaare',
  is_fresher: false,
  admitted_at: null,
  department_id: 1,
  ...over,
});
const chem = { id: 1, name: 'Chemistry' };
const cs = { id: 2, name: 'Computer Science' };

test('transfer: a plain department change passes and reports the move', () => {
  const plan = validateTransfer({
    student: student(),
    department: cs,
    toDepartmentId: 2,
    reason: 'Wrong department on registration',
  });
  assert.deepStrictEqual(plan, {
    toDepartmentId: 2,
    reason: 'Wrong department on registration',
    fromDepartmentId: 1,
    admittedFresher: false,
  });
});

test('transfer: accepts numeric-string ids (HTML form input)', () => {
  const plan = validateTransfer({
    student: student(),
    department: cs,
    toDepartmentId: '2',
    reason: '  Corrected at the desk  ',
  });
  assert.strictEqual(plan.toDepartmentId, 2);
  assert.strictEqual(plan.reason, 'Corrected at the desk'); // trimmed
});

test('transfer: a student with no department can be assigned one', () => {
  const plan = validateTransfer({
    student: student({ department_id: null }),
    department: cs,
    toDepartmentId: 2,
    reason: 'Fresh registration had no department',
  });
  assert.strictEqual(plan.fromDepartmentId, null);
});

test('transfer: target missing, unknown, non-numeric or non-positive is refused', () => {
  const base = { student: student(), reason: 'x' };
  for (const to_department_id of [undefined, null, 'abc', 0, -3, 1.5]) {
    assert.throws(
      () => validateTransfer({ ...base, department: null, toDepartmentId: to_department_id }),
      (err) => err.statusCode === 400,
      `expected 400 for ${String(to_department_id)}`
    );
  }
});

test('transfer: a valid id with no matching department row is a 404', () => {
  assert.throws(
    () =>
      validateTransfer({
        student: student(),
        department: null, // lookup found nothing
        toDepartmentId: 99,
        reason: 'x',
      }),
    (err) => err.statusCode === 404
  );
});

test('transfer: same department is refused', () => {
  assert.throws(
    () =>
      validateTransfer({
        student: student(),
        department: chem,
        toDepartmentId: 1,
        reason: 'x',
      }),
    (err) => err.statusCode === 400 && /already in that department/.test(err.message)
  );
});

test('transfer: an empty or whitespace-only reason is refused', () => {
  for (const reason of ['', '   ', null, undefined]) {
    assert.throws(
      () =>
        validateTransfer({
          student: student(),
          department: cs,
          toDepartmentId: 2,
          reason,
        }),
      (err) => err.statusCode === 400 && /reason is required/.test(err.message)
    );
  }
});

test('transfer: an over-long reason is refused', () => {
  assert.throws(
    () =>
      validateTransfer({
        student: student(),
        department: cs,
        toDepartmentId: 2,
        reason: 'x'.repeat(TRANSFER_MAX_REASON + 1),
      }),
    (err) => err.statusCode === 400 && /characters or fewer/.test(err.message)
  );
});

test('transfer: an admitted fresher transfers, and is flagged for the audit log', () => {
  const plan = validateTransfer({
    student: student({ is_fresher: true, admitted_at: new Date(), department_id: 1 }),
    department: cs,
    toDepartmentId: 2,
    reason: 'Registered under the wrong department',
  });
  assert.strictEqual(plan.admittedFresher, true);
  assert.strictEqual(plan.toDepartmentId, 2);
});

test('transfer: a pending (never admitted) fresher is not flagged as admitted', () => {
  const plan = validateTransfer({
    student: student({ is_fresher: true, admitted_at: null }),
    department: cs,
    toDepartmentId: 2,
    reason: 'Wrong pick corrected before admission',
  });
  assert.strictEqual(plan.admittedFresher, false);
});

test('describeTransfer: names both departments', () => {
  const d = describeTransfer({
    studentName: 'Daniel Kpaare',
    fromName: 'Chemistry',
    toName: 'Computer Science',
    admittedFresher: false,
  });
  assert.strictEqual(d, 'Transferred "Daniel Kpaare" from Chemistry to Computer Science');
});

test('describeTransfer: an unassigned student reads as Unassigned', () => {
  const d = describeTransfer({
    studentName: 'Ama Mensah',
    fromName: null,
    toName: 'Chemistry',
    admittedFresher: false,
  });
  assert.strictEqual(d, 'Transferred "Ama Mensah" from Unassigned to Chemistry');
});

test('describeTransfer: admitted freshers are called out in the audit text', () => {
  const d = describeTransfer({
    studentName: 'Kojo Boateng',
    fromName: 'Physics',
    toName: 'Computer Science',
    admittedFresher: true,
  });
  assert.match(d, /admitted fresher — admission record kept/);
});
