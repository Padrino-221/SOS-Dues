const { AppError } = require('../utils/errors');

// A transfer reason is what the audit trail has to stand on months later when
// someone asks "why did this student move from Chemistry to Computer Science?"
// so it is mandatory and length-capped.
const TRANSFER_MAX_REASON = 300;

/**
 * Validate a department transfer request.
 *
 * Pure function (no DB access) so the rules are unit-testable and enforced in
 * exactly one place. Throws AppError with the right HTTP status; returns the
 * normalized transfer plan on success.
 *
 * @param {object}   opts
 * @param {object}   opts.student       - the students row being moved
 * @param {object|null} opts.department - the target departments row (or null)
 * @param {*}        opts.toDepartmentId - raw requested target id
 * @param {string}   opts.reason        - raw reason from the request
 * @returns {{ toDepartmentId: number, reason: string, fromDepartmentId: number|null, admittedFresher: boolean }}
 */
function validateTransfer({ student, department, toDepartmentId, reason }) {
  const targetId = Number(toDepartmentId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new AppError('Choose the department to transfer this student to', 400);
  }
  if (!department || Number(department.id) !== targetId) {
    throw new AppError('Department not found', 404);
  }

  const fromId = student.department_id == null ? null : Number(student.department_id);
  if (fromId === targetId) {
    throw new AppError('This student is already in that department', 400);
  }

  const cleanReason = String(reason == null ? '' : reason).trim();
  if (!cleanReason) {
    throw new AppError('A reason is required to transfer a student', 400);
  }
  if (cleanReason.length > TRANSFER_MAX_REASON) {
    throw new AppError(`Reason must be ${TRANSFER_MAX_REASON} characters or fewer`, 400);
  }

  return {
    toDepartmentId: targetId,
    reason: cleanReason,
    fromDepartmentId: fromId,
    // An admitted fresher is a Level 100 student who has already been admitted
    // by their (now wrong) department. We surface this so the audit log can be
    // explicit about it — the transfer never touches the admission record or
    // any money, it only moves roster membership.
    admittedFresher: Boolean(student.is_fresher && student.admitted_at),
  };
}

/**
 * Human-readable audit description for a transfer. Kept factual and free of
 * any money figures — a transfer moves roster membership only.
 */
function describeTransfer({ studentName, fromName, toName, admittedFresher }) {
  const from = fromName || 'Unassigned';
  const base = `Transferred "${studentName}" from ${from} to ${toName}`;
  return admittedFresher ? `${base} (admitted fresher — admission record kept)` : base;
}

module.exports = { validateTransfer, describeTransfer, TRANSFER_MAX_REASON };
