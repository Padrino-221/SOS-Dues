const { AppError } = require('./errors');

// ─── "Other Dues" check/uncheck reconciliation ───
// Admins correct already-issued receipts by TOGGLING dues items (checkbox
// model) instead of adding/removing lines by hand. Unchecking VOIDs the active
// line (the codebase never deletes financial rows); checking INSERTs a new
// line stamped exactly like resolveExtraLines does — `label` = the item's name
// and `department_id` = the collecting receipt's department — because that
// label/department pair is what reports use to split school-wide vs
// department "Other Dues" (SCHOOL_ITEM in routes/reports.js). Amounts of
// already-charged lines are never mutated: changing money on record means
// uncheck + re-check, leaving the original line as a voided audit row.

// What "Other Dues" a given account may check/uncheck — the money-scope rule
// in one place, shared by both extra-dues endpoints and the ?toggleable=1
// item catalog so they can never disagree. Staff mirror their admin
// counterparts: the school verification desk manages school-wide items,
// department staff manage their own department's items.
//   'any'   → every item (super_admin)
//   null    → school-wide items only (school_admin, school_staff)
//   number  → that department's items (dept_admin, dept_staff with a dept)
//   'none'  → may not toggle anything (students, unscoped dept accounts, ...)
function extrasScopeForRole(user) {
  if (!user) return 'none';
  switch (user.role) {
    case 'super_admin':
      return 'any';
    case 'school_admin':
    case 'school_staff':
      return null;
    case 'dept_admin':
    case 'dept_staff':
      return user.department_id == null ? 'none' : Number(user.department_id);
    default:
      return 'none';
  }
}

// Round to pesewas, matching resolveExtraLines / normalizeLines.
function roundAmount(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Resolve a client's checked-box payload `[{ dues_item_id, amount }]` into
// canonical target items. The SERVER looks up every name/amount from
// dues_items — it never trusts a client-supplied label, because that label is
// what reports use to attribute school vs department money. Amounts are
// editable (item.amount is only the default) but must be positive; item scope
// (school-wide vs department) is enforced by the caller via `allowedDeptId`
// (null = may toggle school-wide items only; a number = that department's
// items; 'any' = every item, super-admin).
async function resolveTargetItems(client, rawItems, { allowedDeptId }) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const ids = rawItems
    .map((r) => Number(r && r.dues_item_id))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    'SELECT id, name, amount, gender, department_id FROM dues_items WHERE id = ANY($1::int[]) AND active',
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const targets = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const id = Number(raw && raw.dues_item_id);
    const item = byId.get(id);
    if (!item) {
      throw new AppError(
        'One of the selected dues items no longer exists or is inactive — refresh and try again',
        400
      );
    }
    const isSchoolWide = item.department_id == null;
    if (allowedDeptId !== 'any') {
      // Scope gate: school-wide items are toggleable by the school side;
      // department items only by that department's admin.
      if (isSchoolWide && allowedDeptId !== null) {
        throw new AppError(`"${item.name}" is a school-wide item — school accounts only`, 403);
      }
      if (
        !isSchoolWide &&
        (allowedDeptId == null || Number(item.department_id) !== Number(allowedDeptId))
      ) {
        throw new AppError(
          `"${item.name}" belongs to another department and cannot be edited here`,
          403
        );
      }
    }
    if (seen.has(item.name.toLowerCase())) continue;
    seen.add(item.name.toLowerCase());
    let amount = item.amount;
    if (raw.amount !== undefined && raw.amount !== null && String(raw.amount).trim() !== '') {
      amount = roundAmount(raw.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(`"${item.name}" needs an amount above 0`, 400);
      }
    }
    // `gender` rides along so the endpoints can refuse a newly-checked item
    // that doesn't match the student's gender (genderMismatch in extraDues).
    targets.push({
      id: item.id,
      name: item.name,
      amount,
      department_id: item.department_id,
      gender: item.gender,
    });
  }
  return targets;
}

// Split a receipt's (or student's) active extra lines into those the checkbox
// editor can represent and those it cannot. A line is MANAGEABLE only when its
// label matches one of the ACTIVE dues items this actor may toggle (by name,
// case-insensitively) — an inactive item, a renamed label, or an item outside
// the actor's money-scope (e.g. a department item seen by a school admin) is
// NOT manageable and must never be voided by an "Other Dues" save. Those lines
// stay untouched; the UI offers the per-line Void button for them instead.
// toggleableNames: iterable of item names (the actor's ?toggleable=1 catalog).
function partitionManageableLines(activeLines, toggleableNames) {
  const known = new Set(
    [...(toggleableNames || [])]
      .map((n) =>
        String(n ?? '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
  const candidates = [];
  const skipped = [];
  for (const line of Array.isArray(activeLines) ? activeLines : []) {
    const label = String(line.label ?? '').trim();
    if (label && known.has(label.toLowerCase())) candidates.push(line);
    else skipped.push(line);
  }
  return { candidates, skipped };
}

// Pure diff. activeLines: [{ id, receipt_id, label }] — only NON-VOIDed
// extra_dues lines (across one receipt, or across a student's receipts).
// targetItems: [{ id, name }] — the checked boxes. Matching is by the line's
// label against the item name, case-insensitively.
// Returns { toVoid, toAdd, unchanged } where toAdd are the targetItems with no
// matching active line and toVoid are active lines no longer checked.
function planExtraDuesReconcile(activeLines, targetItems) {
  const targets = [];
  const seenNames = new Set();
  for (const raw of Array.isArray(targetItems) ? targetItems : []) {
    const name = String(raw?.name ?? '').trim();
    if (!name) continue;
    // Labels are name snapshots; two items sharing a name (across scopes) would
    // collide on the same label, so one checkbox per name.
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    const amount = roundAmount(raw.amount);
    // Spread keeps server-resolved fields (gender, department_id) riding along
    // on toAdd — the endpoints run their gender guard against what the plan
    // hands back, never against client input.
    targets.push({ ...raw, id: Number(raw.id), name, amount });
  }

  const targetByLower = new Map(targets.map((t) => [t.name.toLowerCase(), t]));
  const lines = Array.isArray(activeLines) ? activeLines : [];
  const activeLabels = new Set(lines.map((l) => String(l.label ?? '').toLowerCase()));

  // Void every active line whose label is no longer checked. Duplicates of a
  // STILL-checked label all survive — a checkbox save must never quietly move
  // money by dropping a line as a side effect. The way to clean up a duplicate
  // is uncheck + re-check, which voids them and reinserts exactly one.
  const toVoid = lines.filter((line) => !targetByLower.has(String(line.label ?? '').toLowerCase()));

  // Add target items that have no active line at all.
  const toAdd = targets.filter((t) => !activeLabels.has(t.name.toLowerCase()));

  const unchanged = targets
    .filter((t) => activeLabels.has(t.name.toLowerCase()))
    .map((t) => t.name);

  return { toVoid, toAdd, unchanged };
}

// Which receipt a newly-checked item attaches to on the student-scoped
// editor. `receipts` must be newest-first. The caller builds the preferred set
// PER SCOPE — school-wide items get the receipts carrying an active school_dues
// line, department items the receipts carrying an active department_dues line —
// because "school items belong on the school receipt" is what admins expect
// and keeps each receipt's item list/amount coherent. Preference:
//   1. the most recent receipt in the preferred (matching-scope) set,
//   2. else the most recent receipt carrying any active line (an extras-only
//      receipt is still a payment receipt),
//   3. else none — the caller must refuse ("record a payment first").
// A line-less $0 receipt (the souvenir recording, stamped paid_at NOW and
// therefore usually the NEWEST receipt) can never match either set, so it can
// never receive a charge and leave the real receipt stale.
function pickAttachReceipt(receipts, preferredReceiptIds, anyLineReceiptIds) {
  const preferred = new Set(preferredReceiptIds || []);
  const anyLine = new Set(anyLineReceiptIds || []);
  const list = Array.isArray(receipts) ? receipts : [];
  return (
    list.find((r) => preferred.has(Number(r.id))) ||
    list.find((r) => anyLine.has(Number(r.id))) ||
    null
  );
}

// Apply a reconcile decision inside an open transaction on `client`:
//   - void each line in toVoid (reason recorded on the row),
//   - insert one extra_dues line per addItems entry onto ITS batch's receipt
//     (`additions`: [{ receipt, items }] — the student-scoped editor routes
//     each item to the receipt of its own scope; the receipt-level editor
//     passes its single receipt as one batch),
//   - recompute total_amount for every receipt whose lines changed.
// `client` must already be BEGIN-transactional. Returns counts + the affected
// receipt ids so the caller can audit-log and emit realtime per receipt.
async function applyExtraDuesChange(client, { toVoid = [], additions = [], reason, userId }) {
  const batches = Array.isArray(additions) ? additions : [];
  for (const line of toVoid) {
    await client.query(
      `UPDATE payments
       SET voided_at = NOW(), voided_by = $1, void_reason = $2
       WHERE id = $3 AND voided_at IS NULL`,
      [userId, reason, line.id]
    );
  }

  for (const batch of batches) {
    for (const item of batch.items || []) {
      // department_id = the collecting receipt's department (not the item's
      // own scope) — identical to how resolveExtraLines stamps school-wide
      // items with the student's department, so the line matches what a
      // desk-collected charge would look like in every bucket.
      await client.query(
        `INSERT INTO payments (receipt_id, type, label, amount, department_id)
         VALUES ($1, 'extra_dues', $2, $3, $4)`,
        [
          batch.receipt.id,
          item.name,
          item.amount,
          batch.receipt.department_id == null ? null : Number(batch.receipt.department_id),
        ]
      );
    }
  }

  const affected = new Set(toVoid.map((l) => Number(l.receipt_id)));
  let addedCount = 0;
  for (const batch of batches) {
    const items = batch.items || [];
    addedCount += items.length;
    if (items.length && batch.receipt) affected.add(Number(batch.receipt.id));
  }
  const totals = {};
  for (const rid of affected) {
    const t = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments WHERE receipt_id = $1 AND voided_at IS NULL`,
      [rid]
    );
    const newTotal = roundAmount(t.rows[0].total);
    await client.query('UPDATE receipts SET total_amount = $1 WHERE id = $2', [newTotal, rid]);
    totals[rid] = newTotal;
  }

  return {
    voidedCount: toVoid.length,
    addedCount,
    affectedReceiptIds: [...affected],
    totals,
  };
}

module.exports = {
  planExtraDuesReconcile,
  partitionManageableLines,
  applyExtraDuesChange,
  resolveTargetItems,
  extrasScopeForRole,
  pickAttachReceipt,
  roundAmount,
  AppError,
};
