const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planExtraDuesReconcile,
  partitionManageableLines,
  extrasScopeForRole,
  resolveTargetItems,
  pickAttachReceipt,
  applyExtraDuesChange,
} = require('../src/utils/extraDuesEdit');

// ─── planExtraDuesReconcile: the pure check/uncheck diff ───

test('checking a new item adds it; already-charged items are unchanged', () => {
  const active = [{ id: 11, receipt_id: 5, label: 'school cloth' }];
  const target = [
    { id: 1, name: 'school cloth', amount: 150 },
    { id: 2, name: 'Sticker', amount: 5 },
  ];
  const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(active, target);
  assert.equal(toVoid.length, 0);
  assert.deepEqual(
    toAdd.map((i) => i.name),
    ['Sticker']
  );
  assert.deepEqual(unchanged, ['school cloth']);
});

test('unchecking an item voids its active line', () => {
  const active = [
    { id: 11, receipt_id: 5, label: 'school cloth' },
    { id: 12, receipt_id: 5, label: 'Sticker' },
  ];
  const target = [{ id: 2, name: 'Sticker', amount: 5 }];
  const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(active, target);
  assert.deepEqual(
    toVoid.map((l) => l.id),
    [11]
  );
  assert.equal(toAdd.length, 0);
  assert.deepEqual(unchanged, ['Sticker']);
});

test('matching is case-insensitive on the label/name snapshot', () => {
  const active = [{ id: 11, receipt_id: 5, label: 'School Cloth' }];
  const target = [{ id: 1, name: 'school cloth', amount: 150 }];
  const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(active, target);
  assert.equal(toVoid.length, 0);
  assert.equal(toAdd.length, 0);
  assert.deepEqual(unchanged, ['school cloth']);
});

test('an empty target set unchecks (voids) every active line', () => {
  const active = [
    { id: 11, receipt_id: 5, label: 'A' },
    { id: 12, receipt_id: 5, label: 'B' },
  ];
  const { toVoid, toAdd } = planExtraDuesReconcile(active, []);
  assert.equal(toVoid.length, 2);
  assert.equal(toAdd.length, 0);
});

test('duplicate target names collapse to one checkbox (labels would collide)', () => {
  const active = [];
  const target = [
    { id: 1, name: 'Sticker', amount: 5 },
    { id: 9, name: 'sticker', amount: 7 },
  ];
  const { toAdd } = planExtraDuesReconcile(active, target);
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].name, 'Sticker');
});

test('duplicate active lines for a still-checked label all survive (no silent void)', () => {
  const active = [
    { id: 21, receipt_id: 5, label: 'Sticker' },
    { id: 22, receipt_id: 5, label: 'sticker' },
  ];
  const target = [{ id: 1, name: 'Sticker', amount: 5 }];
  const { toVoid, toAdd } = planExtraDuesReconcile(active, target);
  // A checked save must never drop money as a side effect — both duplicates
  // survive. Cleaning one up is done via uncheck + re-check.
  assert.equal(toVoid.length, 0);
  assert.equal(toAdd.length, 0);
});

test('duplicate active lines DO all void when their label is unchecked', () => {
  const active = [
    { id: 21, receipt_id: 5, label: 'Sticker' },
    { id: 22, receipt_id: 5, label: 'sticker' },
  ];
  const { toVoid } = planExtraDuesReconcile(active, []);
  assert.deepEqual(toVoid.map((l) => l.id).sort(), [21, 22]);
});

test('blank or nameless target entries are ignored', () => {
  const active = [];
  const target = [{ id: 1, name: '   ', amount: 5 }, null, { id: 2, name: 'Sticker', amount: 5 }];
  const { toAdd } = planExtraDuesReconcile(active, target);
  assert.deepEqual(
    toAdd.map((i) => i.name),
    ['Sticker']
  );
});

test('rounds target amounts to pesewas', () => {
  const active = [];
  const target = [{ id: 1, name: 'Sticker', amount: 5.678 }];
  const { toAdd } = planExtraDuesReconcile(active, target);
  assert.equal(toAdd[0].amount, 5.68);
});

test('a swap (uncheck A, check B) produces one void and one add', () => {
  const active = [{ id: 31, receipt_id: 5, label: 'Female Dues' }];
  const target = [{ id: 2, name: 'Male Dues', amount: 100 }];
  const { toVoid, toAdd, unchanged } = planExtraDuesReconcile(active, target);
  assert.deepEqual(
    toVoid.map((l) => l.label),
    ['Female Dues']
  );
  assert.deepEqual(
    toAdd.map((i) => i.name),
    ['Male Dues']
  );
  assert.equal(unchanged.length, 0);
});

test('lines spanning multiple receipts are all considered (student-level view)', () => {
  const active = [
    { id: 41, receipt_id: 5, label: 'school cloth' },
    { id: 42, receipt_id: 9, label: 'Lab coat' },
  ];
  const target = [{ id: 1, name: 'school cloth', amount: 150 }];
  const { toVoid, toAdd } = planExtraDuesReconcile(active, target);
  assert.deepEqual(
    toVoid.map((l) => l.id),
    [42]
  );
  assert.equal(toAdd.length, 0);
});

// ─── partitionManageableLines: what the checkbox editor may touch ───

test('partition keeps lines matching the toggleable catalog as candidates', () => {
  const lines = [
    { id: 1, label: 'school cloth' },
    { id: 2, label: 'Sticker' },
  ];
  const { candidates, skipped } = partitionManageableLines(lines, ['school cloth', 'Sticker']);
  assert.equal(candidates.length, 2);
  assert.equal(skipped.length, 0);
});

test('partition preserves lines with no matching active item as skipped', () => {
  const lines = [
    { id: 1, label: 'school cloth' },
    { id: 2, label: 'Retired Item' }, // deactivated/renamed — not in catalog
  ];
  const { candidates, skipped } = partitionManageableLines(lines, ['school cloth']);
  assert.deepEqual(
    candidates.map((l) => l.id),
    [1]
  );
  assert.deepEqual(
    skipped.map((l) => l.id),
    [2]
  );
});

test('partition matching is case-insensitive', () => {
  const lines = [{ id: 1, label: 'School Cloth' }];
  const { candidates, skipped } = partitionManageableLines(lines, ['school cloth']);
  assert.equal(candidates.length, 1);
  assert.equal(skipped.length, 0);
});

test('partition sends blank-label lines to skipped (never candidates)', () => {
  const lines = [
    { id: 1, label: '   ' },
    { id: 2, label: null },
    { id: 3, label: 'Sticker' },
  ];
  const { candidates, skipped } = partitionManageableLines(lines, ['Sticker']);
  assert.deepEqual(
    candidates.map((l) => l.id),
    [3]
  );
  assert.deepEqual(skipped.map((l) => l.id).sort(), [1, 2]);
});

test('partition with an empty catalog skips everything (nothing is touchable)', () => {
  const lines = [
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ];
  const { candidates, skipped } = partitionManageableLines(lines, []);
  assert.equal(candidates.length, 0);
  assert.equal(skipped.length, 2);
});

test('partition tolerates non-array / empty inputs', () => {
  assert.deepEqual(partitionManageableLines(null, ['A']), { candidates: [], skipped: [] });
  assert.deepEqual(partitionManageableLines([], ['A']), { candidates: [], skipped: [] });
});

test('a skipped (out-of-catalog) line is never voided by an unchecked save', () => {
  // The realistic danger case: admin unchecks everything they can see, but a
  // line they CAN'T represent (renamed item) must survive untouched.
  const lines = [
    { id: 1, label: 'Retired Item' },
    { id: 2, label: 'school cloth' },
  ];
  const catalog = ['school cloth'];
  const { candidates, skipped } = partitionManageableLines(lines, catalog);
  const { toVoid } = planExtraDuesReconcile(candidates, []); // empty target = all unchecked
  assert.deepEqual(
    toVoid.map((l) => l.id),
    [2]
  ); // only the manageable line voids
  assert.deepEqual(
    skipped.map((l) => l.id),
    [1]
  ); // the retired line is untouched
});

// ─── extrasScopeForRole: who may toggle what (staff mirror their admins) ───

test('super_admin may toggle every item', () => {
  assert.equal(extrasScopeForRole({ role: 'super_admin', department_id: 7 }), 'any');
});

test('school side (admin and staff) toggles school-wide items only', () => {
  assert.equal(extrasScopeForRole({ role: 'school_admin' }), null);
  assert.equal(extrasScopeForRole({ role: 'school_staff' }), null);
});

test('dept side (admin and staff) toggles their own department items', () => {
  assert.equal(extrasScopeForRole({ role: 'dept_admin', department_id: 12 }), 12);
  assert.equal(extrasScopeForRole({ role: 'dept_staff', department_id: 12 }), 12);
});

test('dept accounts without a department may toggle nothing', () => {
  assert.equal(extrasScopeForRole({ role: 'dept_admin' }), 'none');
  assert.equal(extrasScopeForRole({ role: 'dept_staff', department_id: null }), 'none');
});

test('non-admin roles and missing users may toggle nothing', () => {
  assert.equal(extrasScopeForRole({ role: 'rep' }), 'none');
  assert.equal(extrasScopeForRole(null), 'none');
  assert.equal(extrasScopeForRole(undefined), 'none');
});

// ─── resolveTargetItems: server-side resolution carries gender through ───
// The endpoints run their gender guard (genderMismatch in extraDues) against
// what resolution hands back — never against client input — so the gender
// scope must survive resolution and the reconcile plan.

const mockClient = (rows) => ({ query: async () => ({ rows }) });

test('resolveTargetItems resolves from dues_items and carries gender on each target', async () => {
  const client = mockClient([
    { id: 1, name: 'School Cloth', amount: 150, department_id: null, gender: 'any' },
    { id: 2, name: 'Female Cloth', amount: 150, department_id: null, gender: 'female' },
  ]);
  const targets = await resolveTargetItems(client, [{ dues_item_id: 1 }, { dues_item_id: 2 }], {
    allowedDeptId: null,
  });
  assert.deepEqual(
    targets.map((t) => t.gender),
    ['any', 'female']
  );
});

test('resolveTargetItems defaults a missing gender column to undefined (never trusted)', async () => {
  const client = mockClient([{ id: 1, name: 'Sticker', amount: 5, department_id: null }]);
  const targets = await resolveTargetItems(client, [{ dues_item_id: 1 }], { allowedDeptId: null });
  assert.equal(targets[0].gender, undefined);
});

test('the reconcile plan keeps gender on newly-added items (endpoint guard input)', () => {
  const { toAdd } = planExtraDuesReconcile(
    [],
    [{ id: 2, name: 'Female Cloth', amount: 150, gender: 'female' }]
  );
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].gender, 'female');
});

// ─── pickAttachReceipt: which receipt a newly-checked item lands on ───
// The student-scoped editor builds the preferred set per SCOPE: school-wide
// items prefer receipts with an active school_dues line, department items
// receipts with an active department_dues line. This is what stops school
// items from merging into the (often newer) department admission receipt or a
// $0 souvenir receipt — leaving the real receipt with its old items/amount.

const R_SCHOOL = { id: 234, department_id: 3 }; // school-desk receipt
const R_DEPT = { id: 252, department_id: 3 }; // admission receipt (newer)
const R_SOUV = { id: 900, department_id: 3 }; // $0 souvenir receipt (newest)

test('school items prefer the school-dues receipt even when a newer dept receipt exists', () => {
  // Daniel Kpaare's shape: school receipt 234, dept receipt 252, souvenir 900.
  const receipts = [R_SOUV, R_DEPT, R_SCHOOL]; // newest-first
  const home = pickAttachReceipt(receipts, [234], [234, 252]);
  assert.equal(home.id, 234);
});

test('department items prefer the department-dues receipt', () => {
  const receipts = [R_SOUV, R_DEPT, R_SCHOOL];
  const home = pickAttachReceipt(receipts, [252], [234, 252]);
  assert.equal(home.id, 252);
});

test('falls back to any active-line receipt when no matching-scope receipt exists', () => {
  // Extras-only registration receipt (no dues line at all) — still a payment
  // receipt, so it receives the charge rather than erroring.
  const receipts = [{ id: 500, department_id: 3 }];
  const home = pickAttachReceipt(receipts, [], [500]);
  assert.equal(home.id, 500);
});

test('a line-less $0 receipt (souvenir recording) never receives a charge', () => {
  const receipts = [R_SOUV];
  assert.equal(pickAttachReceipt(receipts, [234], [234, 252]), null);
  assert.equal(pickAttachReceipt(receipts, [], []), null);
});

test('pickAttachReceipt tolerates empty/non-array inputs', () => {
  assert.equal(pickAttachReceipt([], [1], [1]), null);
  assert.equal(pickAttachReceipt(null, [1], [1]), null);
});

// ─── applyExtraDuesChange: batches land on their own receipts ───

function recordingClient() {
  const calls = [];
  return {
    calls,
    inserts: () => calls.filter((c) => c.sql.includes('INSERT INTO payments')),
    updates: () => calls.filter((c) => c.sql.includes('UPDATE receipts')),
    query: async (sql, params) => {
      calls.push({ sql, params });
      // The totals recompute reads SUM(amount) per affected receipt.
      if (sql.includes('SUM(amount)')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
}

test('applyExtraDuesChange inserts each batch onto its own receipt and recomputes both totals', async () => {
  const client = recordingClient();
  const result = await applyExtraDuesChange(client, {
    toVoid: [],
    additions: [
      { receipt: R_SCHOOL, items: [{ name: 'school cloth', amount: 150 }] },
      { receipt: R_DEPT, items: [{ name: 'WELFARE', amount: 50 }] },
    ],
    reason: 'Other Dues edited: test',
    userId: 1,
  });
  const inserts = client.inserts();
  assert.equal(inserts.length, 2);
  // receipt_id, label, amount, receipt-department stamp on each insert.
  assert.deepEqual(inserts[0].params.slice(0, 3), [234, 'school cloth', 150]);
  assert.deepEqual(inserts[1].params.slice(0, 3), [252, 'WELFARE', 50]);
  assert.equal(inserts[0].params[3], 3); // collecting receipt's department
  // Both receipts get their total recomputed.
  assert.deepEqual(
    client.updates().map((u) => u.params[1]),
    [234, 252]
  );
  assert.equal(result.addedCount, 2);
  assert.deepEqual(result.affectedReceiptIds.sort(), [234, 252]);
});

test('applyExtraDuesChange voids lines and still recomputes their receipts', async () => {
  const client = recordingClient();
  const result = await applyExtraDuesChange(client, {
    toVoid: [{ id: 11, receipt_id: 234, label: 'school cloth' }],
    additions: [],
    reason: 'Other Dues edited: test',
    userId: 7,
  });
  const voidUpdate = client.calls.find((c) => c.sql.includes('UPDATE payments'));
  assert.deepEqual(voidUpdate.params, [7, 'Other Dues edited: test', 11]);
  assert.deepEqual(
    client.updates().map((u) => u.params[1]),
    [234]
  );
  assert.equal(result.voidedCount, 1);
  assert.equal(result.addedCount, 0);
  assert.deepEqual(result.affectedReceiptIds, [234]);
});
