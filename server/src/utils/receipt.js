const { AppError } = require('./errors');

// Receipt numbers follow the client's agreed format:
//   SOS-DUES-<TAG>-<studentNo>-<n>
// where TAG is:
//   SCH  - school dues only
//   DEPT - department dues only
//   DUES - combined (school + department)
// studentNo is the student's own university-issued number (never generated),
// and n is a per-student lifetime counter shared across every receipt type.
const RECEIPT_TAGS = new Set(['SCH', 'DEPT', 'DUES']);

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

// Derive the tag from a set of payment lines. Combined when both dues types
// are present in the same receipt.
function tagForLines(lines) {
  const types = new Set((lines || []).map((l) => l.type));
  if (types.has('school_dues') && types.has('department_dues')) return 'DUES';
  if (types.has('school_dues')) return 'SCH';
  if (types.has('department_dues')) return 'DEPT';
  return 'DUES';
}

// Atomically reserve the next receipt number for a student. Must be called with
// a connected client inside an open transaction; the row update serializes
// concurrent collections so two receipts can never share a counter value.
async function nextReceiptNumber(client, studentId, tag) {
  const { rows } = await client.query(
    'UPDATE students SET receipt_seq = receipt_seq + 1 WHERE id = $1 RETURNING student_no, receipt_seq',
    [studentId]
  );
  if (rows.length === 0) throw new AppError('Student not found', 404);
  return buildReceiptNumber({
    tag,
    studentNo: rows[0].student_no,
    seq: rows[0].receipt_seq,
  });
}

module.exports = { buildReceiptNumber, tagForLines, nextReceiptNumber, RECEIPT_TAGS };
