import { useEffect } from 'react';
import { Warning, X } from '@phosphor-icons/react';

export default function Confirm({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  danger = false,
}) {
  useEffect(() => {
    if (open) {
      const handler = (e) => {
        if (e.key === 'Escape') onCancel();
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="cs-confirm" onClick={(e) => e.stopPropagation()}>
        <div className={`cs-confirm-icon ${danger ? 'cs-confirm-danger' : ''}`}>
          <Warning size={28} />
        </div>
        <h3>{title}</h3>
        <p className="muted text-sm">{message}</p>
        <div className="cs-confirm-actions">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
