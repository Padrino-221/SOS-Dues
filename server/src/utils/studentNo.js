const { AppError } = require('./errors');

// The strict desk format: "UA" + 7 digits (UA2309264) — the same pattern the
// client's register/verify forms enforce.
const STUDENT_NO_STRICT_RE = /^UA\d{7}$/;

// How a reference number is STORED: trimmed, inner spaces removed, uppercase,
// stray trailing punctuation (commas/periods) dropped. The pending queue kept
// filling up with "UA2621480," and "ua 2621480" typed through the public form —
// normalize before anything else looks at the value.
function normalizeStudentNo(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[.,;]+$/, '');
}

// Shape check for anything typed into a student-number field. Reference
// numbers stay free-form at application (UA2309264, SMK/2021/045, UAS.2610949
// — applicants type what their admission letter shows); the strict UA format
// is only enforced when the desk retypes a number at verification. But the
// shape must still be a reference number: letters and numbers, never a phone
// number or stray keystrokes. Phone digits as student_no were the single
// biggest source of junk in the pre-registration queue.
function assertStudentNoShape(no) {
  if (!no) throw new AppError('Student number is required', 400);
  if (no.length > 20) throw new AppError('Reference number is too long (max 20 characters)', 400);
  if (!/[A-Z]/.test(no)) {
    throw new AppError(
      'That looks like a phone number — enter your student reference number instead (e.g. UA2309264)',
      400
    );
  }
  if (!/^[A-Z0-9./-]+$/.test(no)) {
    throw new AppError(
      'Reference numbers only use letters, numbers, dots, slashes and dashes — remove any other characters',
      400
    );
  }
}

module.exports = { normalizeStudentNo, assertStudentNoShape, STUDENT_NO_STRICT_RE };
