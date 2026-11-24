const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { continuingPayer } = require('../src/utils/continuingPayer');
const { errorHandler } = require('../src/utils/errors');
const valid = () => ({ student_name: 'Ama Mensah', student_no: 'uenr/it/032', email: 'ama@example.test', class_name: 'IT Class A', level: '400', payment_level: '200', method: 'cash', items: [{ type: 'school_dues', amount: 60 }], idempotency_key: 'continuing-test-key' });

test('continuing collection requires every student field and a separate payment level', () => {
  for (const key of ['student_name', 'student_no', 'email', 'class_name', 'level', 'payment_level']) {
    assert.throws(() => continuingPayer({ ...valid(), [key]: '' }), e => e.statusCode === 400, key);
  }
  for (const level of ['100', '500']) assert.throws(() => continuingPayer({ ...valid(), level }));
  assert.throws(() => continuingPayer({ ...valid(), email: 'invalid' }));
  const payer = continuingPayer(valid());
  assert.equal(payer.level, '400'); assert.equal(payer.paymentLevel, '200');
  assert.equal(payer.no, 'UENR/IT/032');
});

// HTTP contract tests execute the actual route and middleware. The database
// and delivery boundaries are substituted; no real payments or email are sent.
let state, server, base;
const mock = (relative, exports) => {
  const filename = require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const client = {
  release() {},
  async query(sql, values = []) {
    state.queries.push({ sql, values });
    if (sql.includes('FROM students WHERE')) return { rows: state.student ? [state.student] : [] };
    if (sql.includes('INSERT INTO students')) { state.studentCreates++; return { rows: [{ id: 100 }] }; }
    if (sql.includes('UPDATE students')) { state.studentUpdates++; return { rows: [] }; }
    if (sql.includes('INSERT INTO receipts')) {
      if (state.duplicate) { const e = new Error('duplicate'); e.code = '23505'; throw e; }
      state.receipt = { id: 200, receipt_number: values[0], student_id: values[1], student_name: values[2], student_no: values[3], payer_email: values[4], level: values[5], payment_level: values[6], method: values[7], paid_at: new Date().toISOString(), academic_year: values[9], department_id: values[10], total_amount: values[11], class_name: values[13] };
      return { rows: [state.receipt] };
    }
    if (sql.includes('INSERT INTO payments')) state.paymentCreates++;
    return { rows: [] };
  },
};
mock('../src/db/pool', {
  connect: async () => client,
  async query(sql, values) {
    if (sql.includes('FROM course_reps')) return { rows: [{ id: 9, name: 'Test Course Rep', email: 'rep@example.test', department_id: 7 }] };
    if (sql.includes('FROM departments WHERE')) return { rows: [{ id: 7, name: 'Information Technology' }] };
    if (sql.includes('idempotency_key = $1')) {
      state.duplicateScope = values;
      assert.match(sql, /course_rep_id/);
      return { rows: [{ id: 201, payer_email: 'ama@example.test', receipt_number: 'ORIGINAL', total_amount: 60 }] };
    }
    if (sql.includes('FROM payments')) return { rows: [{ type: 'school_dues', amount: 60 }] };
    throw new Error('Unexpected pool query');
  },
});
mock('../src/utils/receipt', { nextStandaloneReceiptNumber: async () => 'SOS-TEST-1', tagForLines: () => 'SCH' });
mock('../src/utils/audit', { logTransaction: async entry => { state.audit = entry; } });
mock('../src/utils/email', { sendReceiptEmail: async mail => { state.mail = mail; return { sent: true, mode: 'sent', to: mail.to }; } });
mock('../src/utils/realtime', { emitEvent() {} });
mock('../src/utils/academicYear', { getActiveAcademicYear: async () => '2026/2027' });
process.env.JWT_SECRET = 'isolated-test-key-not-a-production-secret';
process.env.NODE_ENV = 'test';
before(async () => {
  const app = express(); app.use(express.json());
  app.use(require('../src/routes/rep')); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
beforeEach(() => { state = { queries: [], student: null, studentCreates: 0, studentUpdates: 0, paymentCreates: 0 }; });
async function post(body = valid(), authorized = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = 'Bearer ' + jwt.sign({ scope: 'course_rep', sub: '9', department_id: 7 }, process.env.JWT_SECRET);
  const response = await fetch(base + '/departments/ITDS/payments', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
test('a student absent from the roster can pay and receives a linked receipt with class and both levels', async () => {
  const res = await post({ ...valid(), academic_year: '1999/2000' });
  assert.equal(res.status, 201); assert.equal(state.studentCreates, 1);
  assert.equal(res.body.level, '400'); assert.equal(res.body.payment_level, '200');
  assert.equal(res.body.class_name, 'IT Class A'); assert.equal(res.body.academic_year, '2026/2027');
  assert.equal(res.body.pending_verification, true); assert.equal(state.paymentCreates, 1);
  assert.equal(state.mail.to, 'ama@example.test');
  assert.equal(state.audit.meta.course_rep_id, 9); assert.equal(state.audit.meta.class_name, 'IT Class A');
  assert.equal(state.audit.meta.course_rep_name, 'Test Course Rep');
  assert.ok(state.queries.some(q => q.sql === 'COMMIT'));
});
test('repeat payments reuse the pending record instead of creating another student', async () => {
  state.student = { id: 31, department_id: 7, verification_status: 'pending' };
  const res = await post(); assert.equal(res.status, 201);
  assert.equal(state.studentCreates, 0); assert.equal(state.studentUpdates, 1);
  assert.equal(res.body.student_id, 31);
});
test('a verified record is reused without overwriting its profile', async () => {
  state.student = { id: 31, department_id: 7, verification_status: 'verified' };
  const res = await post(); assert.equal(res.status, 201);
  assert.equal(state.studentCreates, 0); assert.equal(state.studentUpdates, 0);
});
test('a rep cannot attach a payment to another department student', async () => {
  state.student = { id: 31, department_id: 8, verification_status: 'pending' };
  const res = await post(); assert.equal(res.status, 409);
  assert.equal(state.paymentCreates, 0); assert.equal(state.mail, undefined);
  assert.ok(state.queries.some(q => q.sql === 'ROLLBACK'));
});
test('missing class, level 100, invalid payment level and excessive dues fail without recording money', async () => {
  for (const overrides of [{ class_name: '' }, { level: '100' }, { payment_level: '500' }, { items: [{ type: 'school_dues', amount: 600 }] }]) {
    assert.equal((await post({ ...valid(), ...overrides })).status, 400);
  }
  assert.equal(state.paymentCreates, 0);
});
test('a duplicate submission returns the original receipt without a second payment or email', async () => {
  state.duplicate = true;
  const res = await post(); assert.equal(res.status, 200); assert.equal(res.body.duplicate, true);
  assert.equal(res.body.receipt_number, 'ORIGINAL'); assert.equal(state.paymentCreates, 0);
  assert.equal(state.mail, undefined);
  assert.deepEqual(state.duplicateScope, ['continuing-test-key', 7, '9']);
});
test('the collecting endpoint still requires course rep sign-in', async () => {
  assert.equal((await post(valid(), false)).status, 401); assert.equal(state.paymentCreates, 0);
});

test('course reps enter the actual school dues amount; department and extra dues are refused', async () => {
  const res = await post({ ...valid(), items: [{ type: 'school_dues', amount: 30 }] });
  assert.equal(res.status, 201); assert.equal(res.body.total_amount, 30);
  for (const type of ['department_dues', 'extra_dues']) {
    assert.equal((await post({ ...valid(), items: [{ type, amount: 20 }] })).status, 400);
  }
  assert.equal(state.paymentCreates, 1);
});
