import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown as CaretDown, IconCheck as Check } from '@tabler/icons-react';

// Rough outer height of the open list (max-height 260 + padding + shadow).
const LIST_H = 290;

const isEmpty = (v) => v === undefined || v === null || v === '';

/**
 * Custom dropdown select. The options list is rendered through a portal with
 * fixed positioning so no scrollable ancestor (e.g. a modal body) can clip it.
 * It flips above the trigger when there is not enough room below, and stays
 * within the viewport horizontally.
 *
 * Keyboard (trigger keeps DOM focus — WAI-ARIA "select-only combobox"):
 *   Enter/Space .... open (closed) or pick the active option (open)
 *   ArrowUp/Down ... open + move through options
 *   Home/End ....... first / last option
 *   Escape ......... close, stay on the trigger
 *
 * `required` is enforced on submit: `required` on the old hidden input never
 * validated, so an empty pick now blocks the enclosing form's submit and shows
 * an inline error instead.
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  disabled,
  required,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { left, width, up, top, bottomGap }
  const [activeIndex, setActiveIndex] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const dropRef = useRef(null);
  const baseId = useId();

  const listboxId = `${baseId}-listbox`;
  const optionId = (i) => `${baseId}-option-${i}`;

  const selectedIndex = options.findIndex((o) => String(o.value) === String(value));

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

  // Keyboard highlight stays visible in the (portal) list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const box = dropRef.current;
    const el = box && box.querySelector(`[data-idx="${activeIndex}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [open, activeIndex]);

  // `required` on a hidden input is a no-op for constraint validation, so the
  // component guards the submit itself: an empty pick blocks the form (both
  // the native submit and React's onSubmit) and flags the field.
  useEffect(() => {
    if (!required) return undefined;
    const form = wrapRef.current && wrapRef.current.closest('form');
    if (!form) return undefined;
    const onSubmit = (e) => {
      if (!isEmpty(value)) return;
      e.preventDefault();
      e.stopPropagation();
      setInvalid(true);
      if (triggerRef.current) triggerRef.current.focus();
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [required, value]);

  // An externally supplied value clears the error.
  useEffect(() => {
    if (!isEmpty(value)) setInvalid(false);
  }, [value]);

  const openList = (startIndex) => {
    if (disabled) return;
    let start = typeof startIndex === 'number' ? startIndex : selectedIndex;
    if (start < 0 || start >= options.length) start = options.length ? 0 : -1;
    setActiveIndex(start);
    setOpen(true);
  };

  const pick = (option) => {
    onChange(option.value);
    setInvalid(false);
    setActiveIndex(-1);
    setOpen(false);
    // Mouse selection otherwise leaves focus on <body>; put it back on the
    // trigger so the next Tab/Escape behaves.
    if (triggerRef.current) triggerRef.current.focus();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'Home') {
        e.preventDefault();
        openList(key === 'Home' ? 0 : undefined);
      } else if (key === 'ArrowUp' || key === 'End') {
        e.preventDefault();
        openList(options.length - 1);
      }
      return;
    }
    switch (key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min((i < 0 ? 0 : i) + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max((i < 0 ? 0 : i) - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        e.stopPropagation();
        const option = options[activeIndex];
        if (option) pick(option);
        else setOpen(false);
        break;
      }
      case 'Escape':
        // Stop here so the surrounding dialog (if any) stays open.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const selected = options.find((o) => String(o.value) === String(value));
  const active = activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;

  return (
    <div className={`cs-select ${disabled ? 'cs-disabled' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        role="combobox"
        className={`cs-select-trigger ${open ? 'cs-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
      >
        <span className={selected ? 'cs-selected' : 'cs-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown size={16} className={`cs-caret ${open ? 'cs-caret-open' : ''}`} />
      </button>
      {invalid && (
        <div className="field-error" role="alert">
          This field is required
        </div>
      )}

      {open &&
        pos &&
        createPortal(
          <div
            className="cs-select-dropdown"
            ref={dropRef}
            id={listboxId}
            role="listbox"
            aria-label={placeholder}
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
            {options.map((o, i) => (
              <div
                key={o.value}
                id={optionId(i)}
                data-idx={i}
                role="option"
                aria-selected={String(o.value) === String(value)}
                className={`cs-select-item ${String(o.value) === String(value) ? 'cs-active' : ''} ${
                  i === active ? 'cs-keyboard-active' : ''
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(o)}
              >
                <span>{o.label}</span>
                {String(o.value) === String(value) && <Check size={14} stroke={2.5} />}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
