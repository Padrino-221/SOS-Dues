const { AppError } = require('./errors');

// ─── Main-dues cap ───
// School dues and Department dues (the "main dues") are capped; extra dues
// ("Other Dues" items) deliberately have no limit. Enforced server-side only
// — the UI never displays the number, so error messages stay generic.
const MAIN_DUES_MAX = 60;

// Throws a 400 unless `amount` fits the main-dues cap. `label` names the
// kind of dues for the message; the cap itself is never stated.
function assertMainDues(amount, label = 'Dues') {
  if (Number(amount) > MAIN_DUES_MAX) {
    throw new AppError(`${label} amount exceeds the allowed maximum`, 400);
  }
}

module.exports = { MAIN_DUES_MAX, assertMainDues };
