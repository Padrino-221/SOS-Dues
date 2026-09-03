import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from '@phosphor-icons/react';

export default function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const goToRep = (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter the department access code');
      return;
    }
    navigate(`/rep/${encodeURIComponent(code.trim())}`);
  };

  return (
    <div className="landing-wrap">
      <div className="landing-card">
        <img src="/school-logo.jpg" alt="School of Sciences" className="landing-logo" />
        <h1>Dues Management System</h1>
        <p className="subtitle mb-lg">School of Sciences, University of Energy and Natural Resources, Sunyani</p>

        <div className="card" style={{ background: 'var(--cream-light)', textAlign: 'left' }}>
          <h3 className="mb-sm">Class Representative — Collect Dues</h3>
          <p className="muted text-sm mb">
            Enter your department access code to collect dues for your class.
          </p>
          <form onSubmit={goToRep}>
            <div className="field">
              <label>Access Code</label>
              <input
                className="input"
                placeholder="e.g. COMPUT-8BC360"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary w-full">
              <ArrowRight size={18} /> Open Collection Page
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
