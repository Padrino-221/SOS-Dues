const pool = require('./pool');
const { buildReceiptNumber } = require('../utils/receipt');

// One-off migration: rewrite every receipt number to the agreed format
//   SOS-DUES-<TAG>-<studentNo>-<n>
// where n is a per-student lifetime counter (ordered by paid_at, then id) and
// TAG is SCH / DEPT / DUES derived from the receipt's payment lines (or, for
// souvenir-only receipts, from the souvenirs' level). Students who have no
// student number cannot be renumbered and are reported and skipped.
async function renumber() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const skipped = await client.query(
      `SELECT r.id, r.receipt_number, s.name
       FROM receipts r
       JOIN students s ON s.id = r.student_id
       WHERE s.student_no IS NULL OR BTRIM(s.student_no) = ''
       ORDER BY r.id`
    );

    const payFlags = await client.query(
      `SELECT receipt_id,
              BOOL_OR(type = 'school_dues') AS has_school,
              BOOL_OR(type = 'department_dues') AS has_dept
       FROM payments
       GROUP BY receipt_id`
    );
    const flagByReceipt = new Map(payFlags.rows.map((r) => [r.receipt_id, r]));

    const souvLevels = await client.query(
      `SELECT receipt_id,
              BOOL_OR(level = 'department') AS has_dept,
              BOOL_OR(level = 'school') AS has_school
       FROM student_souvenirs
       GROUP BY receipt_id`
    );
    const souvByReceipt = new Map(souvLevels.rows.map((r) => [r.receipt_id, r]));

    const { rows: receipts } = await client.query(
      `SELECT r.id, r.student_id, s.student_no
       FROM receipts r
       JOIN students s ON s.id = r.student_id
       WHERE s.student_no IS NOT NULL AND BTRIM(s.student_no) <> ''
       ORDER BY r.student_id, r.paid_at, r.id`
    );

    let currentStudent = null;
    let seq = 0;
    let updated = 0;
    const seqByStudent = new Map();

    for (const r of receipts) {
      if (r.student_id !== currentStudent) {
        currentStudent = r.student_id;
        seq = 0;
      }
      seq += 1;
      seqByStudent.set(r.student_id, seq);

      const flags = flagByReceipt.get(r.id);
      let tag;
      if (flags && (flags.has_school || flags.has_dept)) {
        tag = flags.has_school && flags.has_dept ? 'DUES' : flags.has_dept ? 'DEPT' : 'SCH';
      } else {
        const sv = souvByReceipt.get(r.id);
        tag = sv && sv.has_dept && !sv.has_school ? 'DEPT' : 'SCH';
      }

      const number = buildReceiptNumber({ tag, studentNo: r.student_no, seq });
      await client.query('UPDATE receipts SET receipt_number = $1 WHERE id = $2', [number, r.id]);
      updated += 1;
    }

    for (const [studentId, n] of seqByStudent) {
      await client.query('UPDATE students SET receipt_seq = $1 WHERE id = $2', [n, studentId]);
    }

    await client.query('COMMIT');
    console.log(`Renumbered ${updated} receipt(s).`);
    if (skipped.rowCount > 0) {
      console.log(
        `Skipped ${skipped.rowCount} receipt(s) whose student has no student number:`
      );
      for (const r of skipped.rows) {
        console.log(`  - ${r.name}: ${r.receipt_number}`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

renumber()
  .catch((err) => {
    console.error('Renumber failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
