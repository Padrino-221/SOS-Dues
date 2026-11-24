// Keep in sync with server/src/utils/duesLimits.js — the server is the
// source of truth and re-validates every amount; this copy only gives the
// forms instant feedback. The cap value itself is never displayed anywhere
// in the UI.
export const MAIN_DUES_MAX = 60;

// Message (without the number) when a main-dues amount is over the cap.
// Extra dues ("Other Dues" items) are deliberately not checked — unlimited.
export const mainDuesIssue = (amount, label = 'Dues') =>
  Number(amount) > MAIN_DUES_MAX ? `${label} amount exceeds the allowed maximum` : null;
