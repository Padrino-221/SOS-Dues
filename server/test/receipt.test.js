const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReceiptNumber,
  tagForLines,
  nextStandaloneReceiptNumber,
} = require('../src/utils/receipt');

// Minimal stand-in for a pool client, answering the three queries
// reserveReceiptNumber issues: the advisory lock, the lifetime-counter
// COUNT, and the receipt_number existence check.
function mockClient({ count, taken = [] }) {
  const takenSet = new Set(taken);
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push(text);
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('COUNT(*)')) return { rows: [{ n: count }] };
      if (text.includes('FROM receipts WHERE receipt_number')) {
        const list = Array.isArray(params[0]) ? params[0] : [params[0]];
        return { rows: list.some((c) => takenSet.has(c)) ? [{ exists: true }] : [] };
      }
      throw new Error(`unexpected query in test: ${text}`);
    },
  };
}

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
    buildReceiptNumber({ tag: 'FULL', studentNo: 'UEB3227523', seq: 12 }),
    'SOS-DUES-FULL-UEB3227523-12'
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

test('tagForLines derives SCH, DEPT and combined FULL', () => {
  assert.equal(tagForLines([{ type: 'school_dues' }]), 'SCH');
  assert.equal(tagForLines([{ type: 'department_dues' }]), 'DEPT');
  assert.equal(
    tagForLines([{ type: 'school_dues' }, { type: 'department_dues' }]),
    'FULL'
  );
  // Additional dues (extra_dues) are department money: alone they tag DEPT,
  // riding along with School dues they make it FULL.
  assert.equal(
    tagForLines([{ type: 'extra_dues', label: 'Lab Levy', amount: 50 }]),
    'DEPT'
  );
  assert.equal(
    tagForLines([
      { type: 'school_dues' },
      { type: 'extra_dues', label: 'Lab Levy', amount: 50 },
    ]),
    'FULL'
  );
  assert.equal(
    tagForLines([
      { type: 'department_dues' },
      { type: 'extra_dues', label: 'Dept T-shirt', amount: 30 },
    ]),
    'DEPT'
  );
});

// ─── receipt sequencing: collision-proof reservation ───
// Exercised through nextStandaloneReceiptNumber, the exported wrapper that
// delegates straight to the shared reserveReceiptNumber helper.

test('receipt sequencing mints the next sequence for a fresh number', async () => {
  const client = mockClient({ count: 0 });
  assert.equal(
    await nextStandaloneReceiptNumber(client, 'UA2623084', 'FULL'),
    'SOS-DUES-FULL-UA2623084-1'
  );
});

test('receipt sequencing skips numbers minted but no longer counted after a renumber', async () => {
  // The incident: Rosina's receipts -1/-2 were issued under UA2623084, then
  // her student row was renumbered — the counter reports 0 while the
  // numbers stay taken. The next mint must land on -3, not collide on -1.
  const client = mockClient({
    count: 0,
    taken: ['SOS-DUES-FULL-UA2623084-1', 'SOS-DUES-DEPT-UA2623084-2'],
  });
  assert.equal(
    await nextStandaloneReceiptNumber(client, 'UA2623084', 'FULL'),
    'SOS-DUES-FULL-UA2623084-3'
  );
});

test('receipt sequencing trusts the counter once it already exceeds taken numbers', async () => {
  // After the payer-number backfill the counter sees the old receipts (2),
  // so the first existence check is enough.
  const client = mockClient({
    count: 2,
    taken: ['SOS-DUES-FULL-UA2623084-1', 'SOS-DUES-DEPT-UA2623084-2'],
  });
  assert.equal(
    await nextStandaloneReceiptNumber(client, 'UA2623084', 'FULL'),
    'SOS-DUES-FULL-UA2623084-3'
  );
});

test('receipt sequencing takes the per-number advisory lock before checking receipts', async () => {
  const client = mockClient({ count: 1 });
  await nextStandaloneReceiptNumber(client, 'UA2623084', 'FULL');
  assert.match(client.queries[0], /pg_advisory_xact_lock/);
  assert.match(client.queries[1], /COUNT\(\*\)/);
});

test('receipt sequencing gives up with an honest error instead of looping forever', async () => {
  const taken = [];
  for (let i = 1; i <= 1001; i += 1) taken.push(`SOS-DUES-FULL-UA2623084-${i}`);
  const client = mockClient({ count: 0, taken });
  await assert.rejects(
    () => nextStandaloneReceiptNumber(client, 'UA2623084', 'FULL'),
    /receipt numbering conflict/i
  );
});
