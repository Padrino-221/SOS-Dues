import { useState, useRef, useEffect } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export default function Select({ value, onChange, options, placeholder = 'Select...', disabled, required }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => String(o.value) === String(value));

  return (
    <div className={`cs-select ${disabled ? 'cs-disabled' : ''}`} ref={ref}>
      <button
        type="button"
        className={`cs-select-trigger ${open ? 'cs-open' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
      >
        <span className={selected ? 'cs-selected' : 'cs-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown size={16} className={`cs-caret ${open ? 'cs-caret-open' : ''}`} />
      </button>
      {open && (
        <div className="cs-select-dropdown">
          {options.map((o) => (
            <div
              key={o.value}
              className={`cs-select-item ${String(o.value) === String(value) ? 'cs-active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {String(o.value) === String(value) && <Check size={14} weight="bold" />}
            </div>
          ))}
        </div>
      )}
      <input type="hidden" value={value || ''} required={required} />
    </div>
  );
}
