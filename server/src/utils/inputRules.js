// Character rules for person-entered fields (public apply form and the
// reporting-day verify step). Background: a public applicant once submitted
// an emoji inside their full name.
//   - Names: Unicode letters plus normal name punctuation only (spaces,
//     hyphens, apostrophes, periods) — no digits, emoji or other symbols.
//     Digits are rejected on purpose: "John42" is never a real name here.
//   - Contacts: digits only; spaces are allowed because the apply form's
//     own placeholder shows "0244 000 000".
// The client mirrors these in Apply.jsx for instant feedback — the server
// copy is the actual gate.
const NAME_RE = /^[\p{L}][\p{L}\s'.-]*$/u;
const PHONE_RE = /^[0-9\s]+$/;

function isValidName(value) {
  return NAME_RE.test(String(value ?? '').trim());
}

// Phone is optional on both paths — empty/null passes untouched.
function isValidPhone(value) {
  const s = String(value ?? '').trim();
  return s === '' || PHONE_RE.test(s);
}

module.exports = { NAME_RE, PHONE_RE, isValidName, isValidPhone };
