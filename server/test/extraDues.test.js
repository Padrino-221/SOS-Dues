const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveExtraLines,
  genderMismatch,
  genderRefusal,
  applicableItemsFor,
} = require('../src/utils/extraDues');

// Mocked DB client: resolveExtraLines only reads the active dues_items
// catalog — rows mirror the route's SELECT, which aliases department_id to
// item_department_id.
const mockClient = (items) => ({ query: async () => ({ rows: items }) });

const CATALOG = [
  { id: 1, name: 'School Cloth', amount: 150, gender: 'any', item_department_id: null },
  { id: 2, name: 'Female Cloth', amount: 150, gender: 'female', item_department_id: null },
  { id: 3, name: 'Male Tie', amount: 20, gender: 'male', item_department_id: null },
  { id: 4, name: 'Legacy Item', amount: 5, gender: null, item_department_id: null },
  { id: 5, name: 'Dept Scrubs', amount: 40, gender: 'female', item_department_id: 9 },
];

// ─── genderMismatch: the shared guard matrix ───

test('gendered item vs opposite-gender student is a mismatch', () => {
  assert.equal(genderMismatch('female', 'Male'), true);
  assert.equal(genderMismatch('male', 'Female'), true);
});

test('gendered item vs matching student is never a mismatch (case-insensitive)', () => {
  assert.equal(genderMismatch('female', 'Female'), false);
  assert.equal(genderMismatch('FEMALE', 'female'), false);
  assert.equal(genderMismatch('male', 'Male'), false);
});

test("'any'/NULL item scope never mismatches", () => {
  assert.equal(genderMismatch('any', 'Male'), false);
  assert.equal(genderMismatch(null, 'Female'), false);
  assert.equal(genderMismatch(undefined, 'Male'), false);
});

test("unknown person gender ('Other', blank, old record) never blocks", () => {
  assert.equal(genderMismatch('female', 'Other'), false);
  assert.equal(genderMismatch('male', ''), false);
  assert.equal(genderMismatch('male', null), false);
  assert.equal(genderMismatch('male', undefined), false);
});

test('genderRefusal names the item scope and the student gender', () => {
  const err = genderRefusal({ name: 'Female Cloth', gender: 'female' }, 'Male');
  assert.equal(err.statusCode, 400);
  assert.match(err.message, /Female Cloth/);
  assert.match(err.message, /female students only/);
  assert.match(err.message, /male/);
});

// ─── resolveExtraLines: gender enforced at the charge choke point ───

test('resolves matching-gender items normally', async () => {
  const lines = await resolveExtraLines(mockClient(CATALOG), {
    department_id: 9,
    extras: [
      { dues_item_id: 1, amount: 150 },
      { dues_item_id: 2, amount: 150 },
    ],
    scope: 'school',
    gender: 'Female',
  });
  assert.deepEqual(
    lines.map((l) => l.label),
    ['School Cloth', 'Female Cloth']
  );
});

test('refuses a female-only item for a male fresher', async () => {
  await assert.rejects(
    resolveExtraLines(mockClient(CATALOG), {
      department_id: 9,
      extras: [{ dues_item_id: 2, amount: 150 }],
      scope: 'school',
      gender: 'Male',
    }),
    /female students only/
  );
});

test('refuses a male-only item for a female fresher', async () => {
  await assert.rejects(
    resolveExtraLines(mockClient(CATALOG), {
      department_id: 9,
      extras: [{ dues_item_id: 3, amount: 20 }],
      scope: 'school',
      gender: 'Female',
    }),
    /male students only/
  );
});

test("charges gendered items when the person's gender is unknown ('Other')", async () => {
  const lines = await resolveExtraLines(mockClient(CATALOG), {
    department_id: 9,
    extras: [{ dues_item_id: 2, amount: 150 }],
    scope: 'school',
    gender: 'Other',
  });
  assert.equal(lines.length, 1);
});

test('legacy NULL gender column never blocks', async () => {
  const lines = await resolveExtraLines(mockClient(CATALOG), {
    department_id: 9,
    extras: [{ dues_item_id: 4, amount: 5 }],
    scope: 'school',
    gender: 'Male',
  });
  assert.equal(lines.length, 1);
});

test('no gender option passed (legacy caller) enforces nothing extra', async () => {
  const lines = await resolveExtraLines(mockClient(CATALOG), {
    department_id: 9,
    extras: [{ dues_item_id: 2, amount: 150 }],
    scope: 'school',
  });
  assert.equal(lines.length, 1);
});

test('empty extras short-circuit without touching the catalog', async () => {
  const client = {
    query: async () => {
      throw new Error('should not query');
    },
  };
  assert.deepEqual(
    await resolveExtraLines(client, { department_id: 9, extras: [], scope: 'school' }),
    []
  );
});

test('scope rules still hold alongside the gender guard', async () => {
  await assert.rejects(
    resolveExtraLines(mockClient(CATALOG), {
      department_id: 9,
      extras: [{ dues_item_id: 5, amount: 40 }],
      scope: 'school',
      gender: 'Female',
    }),
    /department charge/
  );
});

// ─── applicableItemsFor: what a student is EXPECTED to have paid ───
// Drives the Data Health incomplete-dues sweep — gendered items (e.g. a
// female-only Wocum charge) only count as expected for matching students.

const SCOPE_ITEMS = [
  { name: 'School Cloth', gender: 'any' },
  { name: 'Wocum Programs', gender: 'female' },
  { name: 'Male Tie', gender: 'male' },
  { name: 'Legacy Item', gender: null },
];

const names = (items) => items.map((i) => i.name);

test('a female student expects any + female items, never the male ones', () => {
  assert.deepEqual(names(applicableItemsFor(SCOPE_ITEMS, 'Female')), [
    'School Cloth',
    'Wocum Programs',
    'Legacy Item',
  ]);
});

test('a male student expects any + male items — the female-only item drops out', () => {
  assert.deepEqual(names(applicableItemsFor(SCOPE_ITEMS, 'Male')), [
    'School Cloth',
    'Male Tie',
    'Legacy Item',
  ]);
});

test('an unknown person gender expects only the any-scoped items', () => {
  assert.deepEqual(names(applicableItemsFor(SCOPE_ITEMS, 'Other')), [
    'School Cloth',
    'Legacy Item',
  ]);
  assert.deepEqual(names(applicableItemsFor(SCOPE_ITEMS, '')), ['School Cloth', 'Legacy Item']);
  assert.deepEqual(names(applicableItemsFor(SCOPE_ITEMS, null)), ['School Cloth', 'Legacy Item']);
});

test('scope matching is case-insensitive both ways', () => {
  assert.ok(names(applicableItemsFor(SCOPE_ITEMS, 'female')).includes('Wocum Programs'));
  assert.deepEqual(names(applicableItemsFor([{ name: 'X', gender: 'FEMALE' }], 'Female')), ['X']);
});

test('applicableItemsFor tolerates empty input', () => {
  assert.deepEqual(applicableItemsFor([], 'Male'), []);
  assert.deepEqual(applicableItemsFor(null, 'Male'), []);
  assert.deepEqual(applicableItemsFor(undefined, null), []);
});
