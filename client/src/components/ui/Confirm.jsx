import { useEffect, useId, useRef, useState } from 'react';
import { IconAlertTriangle as Warning } from '@tabler/icons-react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const isVisible = (el) =>
  Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

function isTopmostDialog(el) {
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  return dialogs.length === 0 || dialogs[dialogs.length - 1] === el;
}

function innerPopupHasFocus() {
  const popup = document.querySelector('.cs-select-dropdown, .cs-calendar');
  return Boolean(popup && popup.contains(document.activeElement));
}

// Prefer the server's own wording; fall back to a fixed, human message so a
// stack trace or parser dump can never reach the user through here.
function errorMessage(err) {
  const serverMessage = err && err.response && err.response.data && err.response.data.error;
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
  if (err && err.response) return 'Something went wrong. Please try again.';
  if (err && err.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (err && !err.response) return "Can't reach the server. Check your connection and try again.";
  return 'Something went wrong. Please try again.';
}

export default function Confirm({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  danger = false,
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const messageId = useId();
  const cardRef = useRef(null);

  // Fresh dialog every time it opens.
  useEffect(() => {
    if (open) {
      setPending(false);
      setError('');
    }
  }, [open]);

  // Initial focus lands on the dialog itself (never straight on the destructive
  // action); focus returns to the opener when it closes.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const frame = requestAnimationFrame(() => cardRef.current && cardRef.current.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (opener && opener !== document.body && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  // Body scroll lock (no-op when stacked under a Modal, which locked it first).
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape cancels (but never while the confirm action is in flight); Tab is
  // trapped inside the dialog while it is the topmost one.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      const card = cardRef.current;
      if (!card || !isTopmostDialog(card)) return;
      if (e.key === 'Escape') {
        if (pending || innerPopupHasFocus()) return;
        e.preventDefault();
        if (onCancel) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      if (innerPopupHasFocus()) return;
      const items = Array.from(card.querySelectorAll(FOCUSABLE)).filter(isVisible);
      if (items.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = card.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel, pending]);

  if (!open) return null;

  const handleConfirm = () => {
    // Double-tap guard: a second click while the first is still running is
    // ignored instead of firing the delete twice.
    if (pending) return;
    setError('');
    let result;
    try {
      result = onConfirm();
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    // Plain synchronous handlers keep their old contract (the page closes the
    // dialog itself once it is done).
    if (!result || typeof result.then !== 'function') return;
    setPending(true);
    result
      .then(() => {
        setPending(false);
        // Only a resolved promise closes the dialog.
        if (onCancel) onCancel();
      })
      .catch((err) => {
        setPending(false);
        setError(errorMessage(err));
      });
  };

  return (
    <div className="modal-backdrop" onClick={pending ? undefined : onCancel}>
      <div
        className="cs-confirm"
        ref={cardRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`cs-confirm-icon ${danger ? 'cs-confirm-danger' : ''}`}>
          <Warning size={28} />
        </div>
        <h3 id={titleId}>{title}</h3>
        <p className="muted text-sm" id={messageId}>
          {message}
        </p>
        {error && (
          <div
            className="alert alert-error"
            role="alert"
            style={{ marginTop: 16, marginBottom: 0, textAlign: 'left' }}
          >
            {error}
          </div>
        )}
        <div className="cs-confirm-actions">
          <button className="btn btn-outline" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending && <span className="spin-dot" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
