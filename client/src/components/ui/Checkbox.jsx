import { Check } from '@phosphor-icons/react';

export default function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label className={`cs-checkbox ${disabled ? 'cs-disabled' : ''}`}>
      <div className={`cs-checkbox-box ${checked ? 'cs-checked' : ''}`}>
        {checked && <Check size={12} weight="bold" />}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="cs-checkbox-input"
      />
      {label && <span className="cs-checkbox-label">{label}</span>}
    </label>
  );
}
