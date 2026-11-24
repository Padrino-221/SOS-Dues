import Checkbox from './Checkbox';

// Checkbox list of "Other Dues" items for editing an already-issued receipt's
// itemization (check/uncheck model). Each row is a checkbox; the amount input
// only shows for items that are checked AND whose amount may still change.
// Once a line is already charged on the receipt, its amount is read-only here
// — changing money on record is done by unchecking + re-checking, so the
// original line survives as a voided audit row.
//   items      — [{ id, name, amount, department_name }]
//   selected   — { [id]: amount } for the checked boxes
//   lockedIds  — Set of item ids whose line is already charged (amount fixed)
//   onToggle   — (item) => void
//   onAmount   — (item, value) => void
//   warnNote   — (item) => string|null — a warning shown beside the item
//                (gender-scoped mismatch, e.g. 'female-only'). Mismatched
//                items stay VISIBLE so a wrong charge can be unchecked — the
//                surface warns, it never hides the correction path.
export default function ExtrasEditPicker({
  items,
  selected,
  lockedIds,
  onToggle,
  onAmount,
  warnNote,
}) {
  if (!items.length) {
    return <p className="muted text-sm">No dues items are available for you to assign.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((item) => {
        const amount = selected[item.id];
        const checked = amount !== undefined;
        const locked = lockedIds ? lockedIds.has(item.id) : false;
        const warning = warnNote ? warnNote(item) : null;
        return (
          <div
            key={item.id}
            className="flex gap-sm"
            style={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <div style={{ flex: '1 1 210px' }}>
              <Checkbox
                checked={checked}
                onChange={() => onToggle(item)}
                label={item.department_name ? `${item.name} · ${item.department_name}` : item.name}
              />
            </div>
            {warning && (
              <span className="badge badge-red" title="Does not match this student's gender">
                {warning}
              </span>
            )}
            {checked &&
              (locked ? (
                <span className="muted text-sm" style={{ minWidth: 150 }}>
                  GHS {Number(amount).toFixed(2)}
                </span>
              ) : (
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ maxWidth: 150 }}
                  value={amount}
                  onChange={(e) => onAmount(item, e.target.value)}
                  aria-label={`${item.name} amount (GHS)`}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
