import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { IconArrowRight as ArrowRight, IconUserCircle as UserCircle, IconBackpack as Student, IconLock as Lock } from '@tabler/icons-react';

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

      {/* Hero + journey doors */}
      <main className="pub-main">
        <section className="pub-hero" style={{ gridTemplateColumns: '1fr', gap: 32 }}>
          <div className="pub-copy" style={{ maxWidth: 640 }}>
            <p className="pub-eyebrow">Dues Management</p>
            <h1>Everything in one place.</h1>
            <p className="pub-lead">
              Fresher pre-registration, class-rep dues collection with instant receipts, and the
              school admin workspace — pick the door that fits you.
            </p>
          </div>

          {/* Three journey cards — stack cleanly on phones */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: 20,
              alignItems: 'stretch',
            }}
          >
            {/* Door 1: fresher pre-registration */}
            <aside
              className="pub-panel"
              style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column' }}
            >
              <div className="pub-panel-head">
                <span className="pub-panel-icon">
                  <Student size={26} />
                </span>
                <div>
                  <h2>I'm a fresher</h2>
                  <p>Pre-register before reporting day</p>
                </div>
              </div>
              <p className="muted text-sm" style={{ flex: 1, lineHeight: 1.6 }}>
                Fill in your details once from home. On reporting day, bring your admission
                documents — we verify you and assign your department.
              </p>
              <button
                className="btn btn-primary btn-lg w-full pub-cta"
                onClick={() => navigate('/apply')}
              >
                Pre-register <ArrowRight size={20} stroke={2.5} />
              </button>
              <p className="pub-panel-note">No payment needed now.</p>
            </aside>

            {/* Door 2: class representative (existing code panel) */}
            <aside
              className="pub-panel"
              style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column' }}
            >
              <div className="pub-panel-head">
                <span className="pub-panel-icon">
                  <UserCircle size={26} />
                </span>
                <div>
                  <h2>I'm a class representative</h2>
                  <p>Collect dues for your class</p>
                </div>
              </div>

              <form onSubmit={goToRep} style={{ flex: 1 }}>
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
                    maxLength={24}
                  />
                </div>
                {error && <div className="alert alert-error">{error}</div>}
                <button className="btn btn-primary btn-lg w-full pub-cta">
                  Continue <ArrowRight size={20} stroke={2.5} />
                </button>
              </form>

              <p className="pub-panel-note">PIN-protected recording.</p>
            </aside>

            {/* Door 3: school admin */}
            <aside
              className="pub-panel"
              style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column' }}
            >
              <div className="pub-panel-head">
                <span className="pub-panel-icon">
                  <Lock size={26} />
                </span>
                <div>
                  <h2>School admin</h2>
                  <p>Manage freshers, receipts & reports</p>
                </div>
              </div>
              <p className="muted text-sm" style={{ flex: 1, lineHeight: 1.6 }}>
                Verify freshers at reporting day, record school & department dues, and keep every
                payment on record.
              </p>
              <button
                className="btn btn-outline btn-lg w-full pub-cta"
                onClick={() => navigate('/login')}
              >
                Sign in <ArrowRight size={20} stroke={2.5} />
              </button>
              <p className="pub-panel-note">Admin access only.</p>
            </aside>
          </div>

          <p className="pub-panel-note" style={{ marginTop: 20 }}>
            <Link to="/records">Student? View your payment records</Link>
          </p>
        </section>
      </main>

      <footer className="pub-foot">
        School of Sciences · UENR Sunyani — Dues Management System
      </footer>
    </div>
  );
}
