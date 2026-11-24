const { AppError } = require('./errors');

// Receipt numbers follow the client's agreed format:
//   SOS-DUES-<TAG>-<studentNo>-<n>
// where TAG is:
//   SCH  - school dues only
//   DEPT - department dues only
//   FULL - combined (school + department)
// studentNo is the payer's university-issued index number (never generated),
// and n is a lifetime counter for that index number shared across every
// receipt type — whether the receipt is linked to a student row (fresher
// registration/admission) or recorded free-flow with no student record at all.
const RECEIPT_TAGS = new Set(['SCH', 'DEPT', 'FULL']);

function buildReceiptNumber({ tag, studentNo, seq }) {
  const normalizedTag = String(tag || '').toUpperCase();
  if (!RECEIPT_TAGS.has(normalizedTag)) {
    throw new Error(`Unknown receipt tag "${tag}"`);
  }
  const no = String(studentNo || '')
    .trim()
    .toUpperCase();
  if (!no) {
    throw new AppError('Add a student number before recording a receipt', 400);
  }
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('Receipt sequence must be a positive integer');
  }
  return `SOS-DUES-${normalizedTag}-${no}-${n}`;
}

// Derive the tag from a set of payment lines. Combined when the school side
// (school_dues) and the department side (department_dues or extra_dues) are
// both present in the same receipt. Extra dues are department money: alone
// they tag DEPT, riding along with School dues they make it FULL.
function tagForLines(lines) {
  const types = new Set((lines || []).map((l) => l.type));
  const hasSchool = types.has('school_dues');
  const hasDeptSide = types.has('department_dues') || types.has('extra_dues');
  if (hasSchool && hasDeptSide) return 'FULL';
  if (hasSchool) return 'SCH';
  if (hasDeptSide) return 'DEPT';
  return 'FULL';
}

// Atomically reserve the next receipt number for an index number. Must be
// called with a connected client inside an open transaction.
//
// The count spans both receipt kinds so one lifetime counter serves the index
// number: free-flow receipts carry the number on the receipt row itself
// (r.student_no), student-linked receipts resolve it through the student row.
// The advisory lock serializes concurrent collections so two receipts can
// never share a counter value.
async function reserveReceiptNumber(client, studentNo, tag) {
  const no = String(studentNo || '')
    .trim()
    .toUpperCase();
  if (!no) {
    throw new AppError('Add a student number before recording a receipt', 400);
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`receipt:${no}`]);
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM receipts r
     LEFT JOIN students s ON s.id = r.student_id
     WHERE UPPER(COALESCE(r.student_no, s.student_no)) = $1`,
    [no]
  );
  // The lifetime counter resolves each receipt through the student row's
  // CURRENT number, so receipts issued before a student was renumbered stay
  // taken (receipt_number is unique) but are no longer counted — the counter
  // can propose a sequence that already exists. The counter is one lifetime
  // sequence per index number across every tag, so a sequence is spent if
  // ANY tag already carries it (e.g. DEPT-2 blocks a future FULL-2). Skip
  // spent sequences while still holding the per-number advisory lock;
  // otherwise the collision escapes to the database as a unique violation,
  // which callers surface with a misleading "student number already exists"
  // message.
  let seq = rows[0].n + 1;
  const MAX_SKIPS = 1000;
  for (let skips = 0; skips <= MAX_SKIPS; skips += 1) {
    const candidates = Array.from(RECEIPT_TAGS, (t) =>
      buildReceiptNumber({ tag: t, studentNo: no, seq })
    );
    const taken = await client.query(
      'SELECT 1 FROM receipts WHERE receipt_number = ANY($1::text[])',
      [candidates]
    );
    if (taken.rows.length === 0) return buildReceiptNumber({ tag, studentNo: no, seq });
    seq += 1;
  }
  throw new AppError('Receipt numbering conflict — please try again', 409);
}

// Atomically reserve the next receipt number for a student row (fresher
// registration / admission and other student-linked receipts).
async function nextReceiptNumber(client, studentId, tag) {
  const { rows } = await client.query('SELECT student_no FROM students WHERE id = $1', [studentId]);
  if (rows.length === 0) throw new AppError('Student not found', 404);
  return reserveReceiptNumber(client, rows[0].student_no, tag);
}

// Reserve the next receipt number for a free-flow payment recorded straight
// from the form, with no student record involved.
async function nextStandaloneReceiptNumber(client, studentNo, tag) {
  return reserveReceiptNumber(client, studentNo, tag);
}

module.exports = {
  buildReceiptNumber,
  tagForLines,
  nextReceiptNumber,
  nextStandaloneReceiptNumber,
  RECEIPT_TAGS,
};
