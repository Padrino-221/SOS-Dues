import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, LockKey, UserCircle, Receipt } from '@phosphor-icons/react';

export default function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const goToRep = (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Enter the department access code.');
      return;
    }
    navigate(`/rep/${encodeURIComponent(code.trim())}`);
  };

  return (
    <div className="pub-app">
      {/* App bar */}
      <header className="pub-top">
        <div className="pub-top-in">
          <img src="/school-logo.jpg" alt="School of Sciences" className="pub-crest" />
          <div className="pub-brand">
            <strong>School of Sciences</strong>
            <span>UENR · Sunyani</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="pub-main">
        <section className="pub-hero">
          <div className="pub-copy">
            <p className="pub-eyebrow">Dues Management</p>
            <h1>Collect dues in seconds.</h1>
            <p className="pub-lead">
              Class reps collect school and department dues, and every payment gets a receipt.
            </p>
            <ol className="pub-how">
              <li>
                <span className="pub-step-num">1</span>
                <div>
                  <strong>Enter the department code</strong>
                  <p>Ask your department admin for it.</p>
                </div>
              </li>
              <li>
                <span className="pub-step-num">2</span>
                <div>
                  <strong>Choose the class and student</strong>
                  <p>See what they still owe.</p>
                </div>
              </li>
              <li>
                <span className="pub-step-num">3</span>
                <div>
                  <strong>Record the payment</strong>
                  <p>A receipt is issued right away.</p>
                </div>
              </li>
            </ol>
          </div>

          {/* Access panel */}
          <aside className="pub-panel">
            <div className="pub-panel-head">
              <span className="pub-panel-icon">
                <UserCircle size={26} weight="regular" />
              </span>
              <div>
                <h2>Class Representative</h2>
                <p>Collect dues for your class</p>
              </div>
            </div>

            <form onSubmit={goToRep}>
              <div className="field">
                <label>Department access code</label>
                <input
                  className="input pub-code-input"
                  placeholder="e.g. CS"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary btn-lg w-full pub-cta">
                Continue <ArrowRight size={20} weight="bold" />
              </button>
            </form>

            <p className="pub-panel-note">
              <LockKey size={13} weight="regular" />
              PIN-protected recording.
            </p>

            <p className="pub-panel-note" style={{ marginTop: 12 }}>
              <Receipt size={13} weight="regular" />
              <Link to="/records">Student? View your payment records</Link>
            </p>
          </aside>
        </section>
      </main>

      <footer className="pub-foot">
        School of Sciences · UENR Sunyani — Dues Management System
      </footer>
    </div>
  );
}
