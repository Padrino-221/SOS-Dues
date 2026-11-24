const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');
let disabled = false, failMail = false, duplicate = false, queries = [], mails = [];
require.cache[require.resolve('../src/db/pool')] = { exports: { query: async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('SELECT id FROM departments')) return { rows: [{ id: 3 }] };
  if (duplicate) throw Object.assign(new Error('duplicate'), { code: '23505' });
  return { rows: [{ id: 1 }], rowCount: 1 };
}, connect: async () => ({ query: async (sql, params) => {
  queries.push({ sql, params });
  return { rows: sql.startsWith('SELECT') ? [{ id: 1, name: 'Test Rep', email: 'rep@example.test', department: 'Computing', code: 'CS', disabled_at: disabled ? new Date() : null }] : [] };
}, release() {} }) } };
require.cache[require.resolve('../src/utils/email')] = { exports: { getTransporter: () => ({ sendMail: async mail => { if (failMail) throw Error('Mail offline'); mails.push(mail); } }) } };
const router = require('../src/routes/courseReps');
let server, origin;
test.before(async () => {
  process.env.SMTP_FROM = 'school@example.test';
  const app = express();app.use(express.json());app.use((req, res, next) => { req.user = { role: req.headers['x-test-role'] || 'super_admin' };next(); });
  app.use(router);app.use((err, req, res, next) => res.status(err.status || err.statusCode || 500).json({ error: err.message }));
  server = app.listen(0,'127.0.0.1');await new Promise(resolve => server.once('listening',resolve));origin = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(resolve => server.close(resolve)));
test.beforeEach(() => { disabled = false;failMail = false;duplicate = false;queries = [];mails = []; });
test('reset sends a one-time department-specific link and stores only its hash',async () => {
  const res = await fetch(origin+'/1/reset-password',{ method:'POST' });assert.equal(res.status,200);
  assert.equal(mails.length,1);assert.match(mails[0].subject,/Reset/);assert.match(mails[0].text,/Department code: CS/);
  const token = mails[0].text.match(/invite=([a-f0-9]{64})/)[1];
  const update = queries.find(q => q.sql.startsWith('UPDATE'));assert.equal(update.params[0],createHash('sha256').update(token).digest('hex'));assert.match(update.sql,/48 hours/);assert.equal(queries.at(-1).sql,'COMMIT');
});
test('failed delivery rolls back without replacing the current password or links',async () => {
  failMail = true;const res = await fetch(origin+'/1/reset-password',{method:'POST'});assert.equal(res.status,503);assert.equal(queries.some(q => q.sql.startsWith('UPDATE')),false);assert.equal(queries.at(-1).sql,'ROLLBACK');
});
test('disabled accounts cannot be reset',async () => { disabled = true;const res = await fetch(origin+'/1/reset-password',{method:'POST'});assert.equal(res.status,409);assert.equal(mails.length,0); });
test('only super admins can send resets',async () => { const res = await fetch(origin+'/1/reset-password',{method:'POST',headers:{'x-test-role':'school_admin'}});assert.equal(res.status,403);assert.equal(queries.length,0); });
const edit = (values, role = 'super_admin') => fetch(origin+'/1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-role': role }, body: JSON.stringify(values) });
test('edit updates the same account without rewriting password, disabled status or collections',async () => {
  const res = await edit({ name: ' Updated Rep ', email: 'NEW@EXAMPLE.TEST', department: 'Computing' });assert.equal(res.status,200);
  const update = queries.find(q => q.sql.startsWith('UPDATE'));assert.deepEqual(update.params.slice(0,3),['Updated Rep','new@example.test',3]);assert.equal(update.params.at(-1),'1');assert.match(update.sql,/email<>\$2 AND invite_hash IS NOT NULL/);assert.doesNotMatch(update.sql,/password_hash|disabled_at|receipts|payments/);assert.equal(mails.length,0);
});
test('edit rejects duplicate emails without exposing database errors',async () => { duplicate = true;const res = await edit({ name: 'Rep', email: 'rep@example.test', department: 'Computing' });assert.equal(res.status,409);assert.match((await res.json()).error,/already belongs/); });
test('edit validates required fields before writing',async () => { const res = await edit({ name: '', email: 'invalid', department: 'Computing' });assert.equal(res.status,400);assert.equal(queries.length,0); });
test('edit remains restricted to super admins',async () => { const res = await edit({ name: 'Rep', email: 'rep@example.test', department: 'Computing' },'school_admin');assert.equal(res.status,403);assert.equal(queries.length,0); });
