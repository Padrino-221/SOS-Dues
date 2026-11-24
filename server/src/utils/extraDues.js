const { AppError } = require('./errors');

// Resolve requested "extra dues" lines against the active dues items,
// enforcing WHO collects each scope:
//   scope 'school'     — the verify / manual-registration desks: school-wide
//                        items only. A department's own items are refused —
//                        the department collects them when it admits the
//                        fresher.
//   scope 'department' — the admission flow: that department's own items only.
//                        School-wide items are refused — the School collects
//                        those at verification.
//
// Each requested line must reference a valid active item; the amount is
// editable on the form (the item's amount is only the default) but must be
// positive. The item's CURRENT name is snapshotted onto the returned line so
// the payment/receipt keeps its meaning if the item is renamed later.
// Gender-scoped items: an item marked 'female' may only be charged to a
// female student, 'male' likewise; 'any' (and legacy NULL) to everyone. An
// unknown person gender ('Other', blank, an old record) never blocks — the
// item's scope is the guard, not the person's record. Case-insensitive: the
// app stores 'Female'/'Male' on people and 'female'/'male' on items.
function genderMismatch(itemGender, personGender) {
  const ig = String(itemGender || '').toLowerCase();
  if (ig !== 'male' && ig !== 'female') return false;
  const pg = String(personGender || '').toLowerCase();
  if (pg !== 'male' && pg !== 'female') return false;
  return ig !== pg;
}

// The refusal every charge/edit surface shares, so the wording (and the
// item's scope) reads the same wherever a mismatch is caught.
function genderRefusal(item, personGender) {
  return new AppError(
    `"${item.name}" is for ${item.gender === 'female' ? 'female' : 'male'} students only — ` +
      `this student is ${String(personGender || '').toLowerCase()}`,
    400
  );
}

// Which catalog items a given student is EXPECTED to have paid: 'any'-scoped
// (and legacy NULL) always, gendered items only for a matching student. An
// unknown person gender ('Other', blank, old record) expects only the 'any'
// items — never flag what the data can't support. Case-insensitive. Used by
// the Data Health incomplete-dues sweep so a male fresher is never flagged
// for a female-only item (and vice versa).
function applicableItemsFor(items, personGender) {
  const pg = String(personGender || '').toLowerCase();
  return (items || []).filter((item) => {
    const ig = String(item.gender || '').toLowerCase();
    return ig !== 'male' && ig !== 'female' ? true : ig === pg;
  });
}

async function resolveExtraLines(client, { department_id, extras, scope, gender }) {
  if (!Array.isArray(extras) || extras.length === 0) return [];

  const { rows: items } = await client.query(
    `SELECT id, name, amount, gender, department_id AS item_department_id
       FROM dues_items WHERE active`
  );
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines = [];
  for (const raw of extras) {
    const id = Number(raw && raw.dues_item_id);
    const item = byId.get(id);
    if (!item) {
      throw new AppError(
        'One of the selected dues items no longer exists or is inactive — refresh and try again',
        400
      );
    }
    const isSchoolWide = item.item_department_id == null;
    if (scope === 'school' && !isSchoolWide) {
      throw new AppError(
        `"${item.name}" is a department charge — it is collected by the department when the fresher is admitted`,
        400
      );
    }
    if (
      scope === 'department' &&
      (isSchoolWide || Number(item.item_department_id) !== Number(department_id))
    ) {
      throw new AppError(
        `"${item.name}" is not a charge of this department — school-wide items are collected by the School at verification`,
        400
      );
    }
    // Gender-scoped items only ever charge a matching student — the female-
    // cloth-on-male-students incident class, refused here at the choke point
    // every verify/register/admit flow funnels through.
    if (genderMismatch(item.gender, gender)) throw genderRefusal(item, gender);
    const amount = Math.round(Number(raw && raw.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(`"${item.name}" needs an amount above 0`, 400);
    }
    lines.push({
      type: 'extra_dues',
      label: item.name,
      amount,
      department_id: Number(department_id),
    });
  }
  return lines;
}

module.exports = { resolveExtraLines, genderMismatch, genderRefusal, applicableItemsFor };
