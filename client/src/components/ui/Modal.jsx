import { useEffect } from 'react';
import { X } from '@phosphor-icons/react';

/**
 * Shared modal chrome — navy header band with gold icon chip, scrollable
 * body (visible custom scrollbar), optional sticky footer.
 *
 * Props:
 *   open      - boolean
 *   onClose   - () => void   (Escape key or backdrop click)
 *   title     - string
 *   subtitle  - optional string shown under the title
 *   icon      - optional <Icon size={20} />
 *   size      - 'md' (default) | 'wide' | 'lg'
 *   footer    - optional element rendered below the body, above the card edge
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  size = 'md',
  children,
  footer,
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal-card${size === 'wide' ? ' modal-card-wide' : ''}${size === 'lg' ? ' modal-card-lg' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          {icon && <div className="modal-header-icon">{icon}</div>}
          <div className="modal-header-text">
            <h3>{title}</h3>
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
