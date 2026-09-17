import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check } from '@phosphor-icons/react';

// Rough outer height of the open list (max-height 260 + padding + shadow).
const LIST_H = 290;

/**
 * Custom dropdown select. The options list is rendered through a portal with
 * fixed positioning so no scrollable ancestor (e.g. a modal body) can clip it.
 * It flips above the trigger when there is not enough room below, and stays
 * within the viewport horizontally.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  required,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { left, width, up, top, bottomGap }
  const wrapRef = useRef(null);
  const dropRef = useRef(null);

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const spaceBelow = window.innerHeight - r.bottom - 10;
    const spaceAbove = r.top - 10;

    let up;
    if (spaceBelow >= LIST_H) up = false;
    else if (spaceAbove >= LIST_H) up = true;
    else up = spaceAbove > spaceBelow;

    const width = Math.min(Math.max(r.width, 260), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    setPos({
      left,
      width,
      up,
      top: r.bottom + 6,
      bottomGap: window.innerHeight - r.top + 6,
    });
  };

  // Reposition while open (modal body / page scroll, window resize).
  useEffect(() => {
    if (!open) return;
    place();
    const scrollHost = wrapRef.current?.closest('.modal-card, .main-scroll') || null;
    const onMove = () => place();
    scrollHost?.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      scrollHost?.removeEventListener('scroll', onMove);
      window.removeEventListener('resize', onMove);
    };
  }, [open, options.length]);

  // Close on outside interaction (click/tap anywhere else, or Escape).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target) &&
        dropRef.current &&
        !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => String(o.value) === String(value));

  return (
    <div className={`cs-select ${disabled ? 'cs-disabled' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`cs-select-trigger ${open ? 'cs-open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'cs-selected' : 'cs-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown size={16} className={`cs-caret ${open ? 'cs-caret-open' : ''}`} />
      </button>
      <input type="hidden" value={value || ''} required={required} />

      {open &&
        pos &&
        createPortal(
          <div
            className="cs-select-dropdown"
            ref={dropRef}
            role="listbox"
            style={{
              position: 'fixed',
              // Explicit 'auto' overrides the stylesheet's top/left/right so a
              // flipped-up dropdown can't be collapsed by the CSS defaults.
              top: pos.up ? 'auto' : pos.top,
              bottom: pos.up ? pos.bottomGap : 'auto',
              left: pos.left,
              right: 'auto',
              width: pos.width,
              zIndex: 1200,
            }}
          >
            {options.map((o) => (
              <div
                key={o.value}
                role="option"
                aria-selected={String(o.value) === String(value)}
                className={`cs-select-item ${String(o.value) === String(value) ? 'cs-active' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {String(o.value) === String(value) && <Check size={14} weight="bold" />}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
