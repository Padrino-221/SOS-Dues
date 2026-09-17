import { useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

/** Input with a show/hide toggle for passwords. */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  disabled,
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pwd-wrap">
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      <button
        type="button"
        className="pwd-toggle"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
