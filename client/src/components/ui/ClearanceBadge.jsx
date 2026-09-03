import {
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';

/**
 * Displays a student's clearance status as a compact row of 4 badges.
 *
 * Props:
 *   schoolDuesPaid         - boolean
 *   schoolSouvenirCollected - boolean
 *   deptDuesPaid           - boolean
 *   deptSouvenirCollected   - boolean
 *   compact                - boolean (smaller variant, default true)
 */
export default function ClearanceBadge({
  schoolDuesPaid,
  schoolSouvenirCollected,
  deptDuesPaid,
  deptSouvenirCollected,
  compact = true,
}) {
  const items = [
    { label: 'Sch Dues', paid: schoolDuesPaid },
    { label: 'Sch Souv', paid: schoolSouvenirCollected },
    { label: 'Dept Dues', paid: deptDuesPaid },
    { label: 'Dept Souv', paid: deptSouvenirCollected },
  ];

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {items.map(({ label, paid }) => (
          <span
            key={label}
            className={`badge ${paid ? 'badge-green' : 'badge-red'}`}
            title={`${label}: ${paid ? 'Done' : 'Pending'}`}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {paid ? <CheckCircle size={11} weight="fill" /> : <XCircle size={11} />}
            {' '}{label}
          </span>
        ))}
      </div>
    );
  }

  // Full-width variant
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {items.map(({ label, paid }) => (
        <div
          key={label}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            background: paid ? 'var(--green-light)' : 'var(--red-light)',
            border: `1px solid ${paid ? '#BBF7D0' : '#FECACA'}`,
            fontSize: 13, fontWeight: 600,
            color: paid ? 'var(--green-dark)' : 'var(--red)',
          }}
        >
          {paid ? <CheckCircle size={14} weight="fill" /> : <XCircle size={14} weight="fill" />}
          {label}
        </div>
      ))}
    </div>
  );
}
