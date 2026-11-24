import { useEffect, useId, useRef } from 'react';
import { IconX as X } from '@tabler/icons-react';

/**
 * Shared modal chrome — navy header band with gold icon chip, scrollable
 * body (visible custom scrollbar), optional sticky footer.
 *
 * Props:
 *   open             - boolean
 *   onClose          - () => void   (Escape key or backdrop click)
 *   title            - string       (wired to aria-labelledby on the dialog)
 *   subtitle         - optional string shown under the title
 *   icon             - optional <Icon size={20} />
 *   size             - 'md' (default) | 'wide' | 'lg'
 *   footer           - optional element rendered below the body, above the card edge
 *   closeOnBackdrop  - optional boolean (default true); pass false to keep the
 *                      dialog open until an explicit action closes it.
 */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const isVisible = (el) =>
  Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

// Portals are appended to <body>, so the last aria-modal dialog in document
// order is the one on top — the only one allowed to trap focus / close on Esc.
function isTopmostDialog(el) {
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  return dialogs.length === 0 || dialogs[dialogs.length - 1] === el;
}

// A Select/DatePicker popup rendered through its own portal must swallow the
// Escape/Tab meant for it, not for the dialog underneath.
function innerPopupHasFocus() {
  const popup = document.querySelector('.cs-select-dropdown, .cs-calendar');
  return Boolean(popup && popup.contains(document.activeElement));
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
}) {
  const titleId = useId();
  const cardRef = useRef(null);

  // Initial focus: first focusable element (or the dialog itself), restored to
  // whatever opened the modal once it closes.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      const first = Array.from(card.querySelectorAll(FOCUSABLE)).find(isVisible);
      (first || card).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (opener && opener !== document.body && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  // Body scroll lock. Nested dialogs capture the value their parent set, so
  // the background stays locked until the outermost one closes.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape closes (topmost dialog only); Tab cycles inside the dialog.
  // Focusables are re-queried on every Tab so dynamically added fields,
  // nested portals and re-renders are all picked up.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      const card = cardRef.current;
      if (!card || !isTopmostDialog(card)) return;
      if (e.key === 'Escape') {
        if (innerPopupHasFocus()) return;
        e.preventDefault();
        onClose();
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`modal-card${size === 'wide' ? ' modal-card-wide' : ''}${size === 'lg' ? ' modal-card-lg' : ''}`}
        onMouseDown={closeOnBackdrop ? (e) => e.stopPropagation() : undefined}
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          {icon && <div className="modal-header-icon">{icon}</div>}
          <div className="modal-header-text">
            <h3 id={titleId}>{title}</h3>
            {subtitle && <p className="modal-header-sub">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="modal-body">{children}</div>

        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
