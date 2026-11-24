const pool = require('../db/pool');

/**
 * Log a transaction to the audit trail.
 *
 * @param {object} opts
 * @param {number}  opts.admin_id       - ID of the admin performing the action
 * @param {string}  opts.admin_role     - 'SCHOOL_ADMIN' | 'DEPT_ADMIN' | 'REP'
 * @param {string}  opts.transaction_type - e.g. 'payment', 'student_create', 'souvenir_distribution'
 * @param {string}  opts.description    - Human-readable description
 * @param {object}  [opts.meta]         - Optional JSONB metadata (receipt_number, student_id, etc.)
 * @param {object}  [opts.client]       - Optional pg transaction client. When provided the
 *                                        audit row is written through it, so it commits or
 *                                        rolls back together with the surrounding transaction.
 *                                        Old callers (no client) keep using the pool.
 */
async function logTransaction({ admin_id, admin_role, transaction_type, description, meta, client }) {
  const db = client || pool;
  try {
    await db.query(
      `INSERT INTO transaction_log (admin_id, admin_role, transaction_type, description, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        admin_id || null,
        admin_role || 'SYSTEM',
        transaction_type,
        description,
        meta ? JSON.stringify(meta) : null,
      ]
    );
  } catch (err) {
    // Audit logging should never crash the main request
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logTransaction };
