const { test } = require('node:test');
const assert = require('node:assert');
const { reportTitle, slugify, csvEscape, buildCsvReport } = require('../src/utils/reportFormat');

test('reportTitle: unfiltered report names every axis', () => {
  assert.strictEqual(reportTitle({}), 'All Departments — All Levels — All Methods');
});

test('reportTitle: composes the active filters into the name', () => {
  assert.strictEqual(
    reportTitle({
      departmentName: 'Computer Science',
      level: '200',
      method: 'cash',
      academicYear: '2026/2027',
    }),
    'Computer Science — Level 200 — Cash — 2026/2027'
  );
  assert.strictEqual(reportTitle({ method: 'momo' }), 'All Departments — All Levels — Mobile Money');
});

test('reportTitle: date range is appended when present', () => {
  assert.strictEqual(
    reportTitle({ from: '2026-10-01', to: '2026-10-31' }),
    'All Departments — All Levels — All Methods — 2026-10-01 to 2026-10-31'
  );
  assert.ok(reportTitle({ from: '2026-10-01' }).endsWith('from 2026-10-01'));
  assert.ok(reportTitle({ to: '2026-10-31' }).endsWith('to 2026-10-31'));
});

test('slugify: filename-safe title', () => {
  assert.strictEqual(slugify('Computer Science — Level 200 — Cash'), 'computer-science-level-200-cash');
  assert.strictEqual(slugify('  Ünïcode?  //  '), 'n-code');
  assert.strictEqual(slugify('---'), '');
});

test('csvEscape: quotes commas, quotes and newlines; passes plain text', () => {
  assert.strictEqual(csvEscape('plain'), 'plain');
  assert.strictEqual(csvEscape('Ghana, Accra'), '"Ghana, Accra"');
  assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvEscape('line\nbreak'), '"line\nbreak"');
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(0), '0');
});

test('buildCsvReport: starts with UTF-8 BOM and includes report title and columns', () => {
  const csv = buildCsvReport('All Departments — Level 200', [
    { name: 'Abigail Boateng', reference: 'UB34001', programme: 'Computer Science', amount: 50, date: '2026-10-18' },
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.strictEqual(
    csv.slice(1),
    'All Departments — Level 200\nName,Reference,Programme,Amount,Date\nAbigail Boateng,UB34001,Computer Science,50,2026-10-18'
  );
});
