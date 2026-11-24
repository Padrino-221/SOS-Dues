import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { MAIN_DUES_MAX, mainDuesIssue } from '../utils/duesLimits';
import { asArray } from '../utils/asArray';
import {
  IconLock as LockKey,
  IconArrowRight as ArrowRight,
  IconRefresh as ArrowClockwise,
  IconArrowLeft as ArrowLeft,
  IconCircleCheck as CheckCircle,
  IconEye as Eye,
  IconEyeOff as EyeSlash,
  IconAlertTriangle as Warning,
} from '@tabler/icons-react';
import Select from '../components/ui/Select';

const STORAGE_PREFIX = 'course_rep_token_';
const DRAFT_PREFIX = 'rep_draft_';

// ─── Draft recovery ───
// A collection form half-filled (or even fully submitted) must survive a
// refresh, an app kill or a flaky connection: the whole draft (payer fields,
// lines, idempotency key) lives in sessionStorage and is only cleared after a
// confirmed success. Restoring synchronously (in state initializers) avoids
// clobbering the draft with empty values on mount.
function readDraft(code) {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + String(code || '').toUpperCase());
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

function clearDraft(code) {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + String(code || '').toUpperCase());
  } catch {
    /* storage unavailable — draft persistence is best-effort */
  }
}

export default function RepPage() {
  const { code } = useParams();
  const storageKey = useMemo(() => STORAGE_PREFIX + (code || '').toUpperCase(), [code]);
  const draftKey = useMemo(() => DRAFT_PREFIX + (code || '').toUpperCase(), [code]);

  // A restored draft wins over the default empty form (see readDraft above).
  const [draft] = useState(() => readDraft(code));

  const [dept, setDept] = useState(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState('loading'); // loading | bad-code | lock | flow
  const [step, setStep] = useState(() =>
    draft?.version === 3 && draft?.step && ['details', 'dues', 'confirm'].includes(draft.step) ? draft.step : 'details'
  ); // details → dues → confirm → done

  // Free-flow payer details — typed in by the rep, never looked up.
  const [payer, setPayer] = useState(() => ({ name: '', no: '', email: '', level: '', className: '', ...draft?.payer }));

  // Dues selection: which dues the student is paying, and how much.
  const [amounts, setAmounts] = useState(() => ({ school_dues: draft?.version === 3 ? draft?.amounts?.school_dues || '' : '' }));
  const [method, setMethod] = useState(() => draft?.method || 'cash');
  // The academic year is locked to the School Admin's active year (shown,
  // never chosen) — the server enforces it regardless.
  const academicYear = dept?.academic_year || '';
  // Which level the payment is FOR — may differ from the payer's own level
  // (e.g. a Level 400 student clearing Level 100 arrears). Follows the
  // payer's level until the rep picks otherwise.
  const [payLevel, setPayLevel] = useState(() => draft?.payLevel || '');
  const effectivePayLevel = payLevel || payer.level;
  const [recording, setRecording] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [duplicate, setDuplicate] = useState(false);

  // One idempotency key per form fill: a retried submit with the same key
  // returns the existing receipt instead of recording the cash twice.
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => draft?.idempotencyKey || crypto.randomUUID()
  );

  // "Couldn't confirm — was it recorded?" recovery state after an ambiguous
  // failure (timeout / network drop / 5xx).
  const [recovery, setRecovery] = useState(null); // null | { status: 'idle'|'checking'|'found'|'not_found', receipt_number?, paid_at? }
  const [checking, setChecking] = useState(false);

  // Course rep sign-in
  const [repEmail, setRepEmail] = useState('');
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'));
  const [activated, setActivated] = useState(false);
  const [pin, setPin] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [repToken, setRepToken] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const loadDept = () => {
    setScreen('loading');
    api
      .get(`/public/departments/${encodeURIComponent(code)}`)
      .then((res) => {
        setDept(res.data);
        // Reuse a live session from this device if one exists.
        const tok = sessionStorage.getItem(storageKey) || '';
        if (tok) {
          setRepToken(tok);
          setScreen('flow');
        } else {
          setScreen('lock');
        }
      })
      .catch(() => {
        setScreen('bad-code');
        setError('Invalid department code. Check with your department admin.');
      });
  };

  useEffect(() => {
    loadDept(); /* eslint-disable-next-line */
  }, [code]);

  // Persist the whole draft on every change; clear it only on success (step
  // 'done') so a crash or refresh mid-flow never loses the collection.
  useEffect(() => {
    if (screen !== 'flow') return;
    try {
      if (step === 'done') {
        sessionStorage.removeItem(draftKey);
        return;
      }
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ version: 3, payer, amounts, method, payLevel, idempotencyKey, step })
      );
    } catch {
      /* storage unavailable — draft persistence is best-effort */
    }
  }, [screen, step, payer, amounts, method, payLevel, idempotencyKey, draftKey]);

  const unlock = async (e) => {
    e.preventDefault();
    setPinError('');
    if (!pin) {
      setPinError('Enter your password.');
      return;
    }
    setUnlocking(true);
    try {
      if (inviteToken) {
        await api.post(`/public/departments/${encodeURIComponent(code)}/activate`, {
          token: inviteToken, password: pin,
        });
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
        setInviteToken(null);
        setActivated(true);
        setPin('');
        return;
      }
      const res = await api.post(`/public/departments/${encodeURIComponent(code)}/login`, {
        email: repEmail.trim(), password: pin,
      });
      const tok = res.data.token;
      sessionStorage.setItem(storageKey, tok);
      setRepToken(tok);
      setPin('');
      setScreen('flow');
    } catch (err) {
      setPinError(err.response?.data?.error || 'Could not sign in. Try again.');
    } finally {
      setUnlocking(false);
    }
  };

  const lockNow = () => {
    sessionStorage.removeItem(storageKey);
    setRepToken('');
    resetFlow();
    setPin('');
    setSessionExpired(false);
    setScreen('lock');
  };

  const authHeaders = () => ({ Authorization: `Bearer ${repToken}` });

  const handleSessionExpired = (err) => {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      sessionStorage.removeItem(storageKey);
      setRepToken('');
      setSessionExpired(true);
      setPinError(
        err.response?.data?.error || 'Your recording session has expired. Sign in again.'
      );
      setScreen('lock');
      return true;
    }
    return false;
  };

  const levelOptions = (dept?.levels || []).map((l) => ({
    value: l,
    label: `Level ${l}`,
  }));

  const currentLevelOptions = ['200', '300', '400'].map((value) => ({ value, label: `Level ${value}` }));

  // ─── Step 1: payer details ───
  const submitDetails = (e) => {
    e.preventDefault();
    setError('');
    if (!payer.name.trim()) {
      setError("Enter the student's name.");
      return;
    }
    if (!payer.no.trim()) {
      setError("Enter the student's index number.");
      return;
    }
    if (!payer.email.trim()) {
      setError("Enter the student's email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!payer.className.trim()) {
      setError('Enter the class.');
      return;
    }
    if (!['200', '300', '400'].includes(payer.level)) {
      setError('Select the current level (200, 300 or 400).');
      return;
    }
    setStep('dues');
  };

  // ─── Step 2: dues selection ───
  // Money rule: every amount is quantized to pesewas (2 decimals) client-side
  // too, so the total shown matches what the server stores.
  const round2 = (x) => Math.round(Number(x) * 100) / 100;

  const lines = () => round2(amounts.school_dues) > 0
    ? [{ type: 'school_dues', amount: round2(amounts.school_dues) }]
    : [];
  const total = lines().reduce((sum, line) => sum + line.amount, 0);

  const submitDues = (e) => {
    e.preventDefault();
    setError('');
    if (!effectivePayLevel) {
      setError('Select the level being paid for.');
      return;
    }
    if (lines().length === 0) {
      setError('Enter the school dues amount received.');
      return;
    }
    // Hard cap on the main dues — refuse before moving to confirm.
    const overCap = lines().find((l) => Number(l.amount) > MAIN_DUES_MAX);
    if (overCap) {
      setError(
        mainDuesIssue(
          overCap.amount,
          overCap.type === 'school_dues' ? 'School dues' : `${dept?.name || 'Department'} dues`
        )
      );
      return;
    }
    setStep('confirm');
  };

  // ─── Step 3: confirm → record straight into the records ───
  const submit = async () => {
    setError('');
    setSessionExpired(false);
    setRecording(true);
    setReceipt(null);
    setDuplicate(false);
    try {
      const items = lines();
      if (items.length === 0) {
        setError('Enter the school dues amount received.');
        setRecording(false);
        return;
      }
      // Same hard cap as step 2 — a restored session can land straight here.
      const overCap = items.find((l) => Number(l.amount) > MAIN_DUES_MAX);
      if (overCap) {
        setError(
          mainDuesIssue(
            overCap.amount,
            overCap.type === 'school_dues' ? 'School dues' : `${dept?.name || 'Department'} dues`
          )
        );
        setRecording(false);
        return;
      }
      const res = await api.post(
        `/public/departments/${encodeURIComponent(code)}/payments`,
        {
          student_name: payer.name.trim(),
          student_no: payer.no.trim().toUpperCase(),
          email: payer.email.trim(),
          level: payer.level,
          class_name: payer.className.trim(),
          payment_level: effectivePayLevel || undefined,
          items,
          method,
          idempotency_key: idempotencyKey,
        },
        { headers: authHeaders() }
      );
      setReceipt(res.data);
      setDuplicate(Boolean(res.data.duplicate));
      setRecovery(null);
      setStep('done');
    } catch (err) {
      if (!handleSessionExpired(err)) {
        const status = err.response?.status;
        // Ambiguous failures (timeout, network drop, 5xx) MAY have recorded
        // the payment — offer a recovery check before inviting a re-record.
        const ambiguous =
          ['ECONNABORTED', 'ETIMEDOUT'].includes(err.code) || !err.response || status >= 500;
        if (ambiguous) {
          setRecovery({ status: 'idle' });
          setError(
            err.response?.data?.error ||
              "Couldn't confirm whether the payment was recorded. Check before trying again."
          );
        } else {
          setError(err.response?.data?.error || 'Payment could not be recorded.');
        }
      }
    } finally {
      setRecording(false);
    }
  };

  // Recovery check: look up this payer's recent receipts. If the payment
  // already exists, show it instead of inviting a second record.
  const checkRecording = async () => {
    setChecking(true);
    setRecovery((r) => ({ ...(r || { status: 'idle' }), status: 'checking' }));
    try {
      const no = payer.no.trim().toUpperCase();
      const res = await api.get(`/public/records/${encodeURIComponent(no)}`);
      const payments = Array.isArray(res.data) ? res.data.flatMap((s) => s.payments || []) : [];
      const expectedTotal = total;
      const match = payments.find(
        (p) =>
          !p.voided_at &&
          Number(p.total_amount) === expectedTotal &&
          Date.now() - new Date(p.paid_at).getTime() < 24 * 60 * 60 * 1000
      );
      if (match) {
        setRecovery({
          status: 'found',
          receipt_number: match.receipt_number,
          paid_at: match.paid_at,
        });
      } else {
        setRecovery({ status: 'not_found' });
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setRecovery({ status: 'not_found' });
      } else {
        setRecovery({ status: 'idle' });
        setError('Could not check the records — check your connection and try again.');
      }
    } finally {
      setChecking(false);
    }
  };

  // Re-submitting is only offered after the check came back "not found".
  const resubmitBlocked = Boolean(recovery) && recovery.status !== 'not_found';

  const resetFlow = () => {
    setStep('details');
    setPayer({ name: '', no: '', email: '', level: '', className: '' });
    setPayLevel('');
    setReceipt(null);
    setDuplicate(false);
    setRecovery(null);
    setError('');
    setMethod('cash');
    // A fresh form fill gets a fresh idempotency key.
    setIdempotencyKey(crypto.randomUUID());
    clearDraft(code);
    setAmounts({ school_dues: '' });
  };

  const payerLevelLabel = payer.level ? `Level ${payer.level}` : '';

  const stepPills = [
    { key: 'details', n: 1, label: 'Student Details' },
    { key: 'dues', n: 2, label: 'Dues & Method' },
    { key: 'confirm', n: 3, label: 'Confirm' },
    { key: 'done', n: 4, label: 'Receipt' },
  ];
  const stepIndex = stepPills.findIndex((p) => p.key === step);

  return (
    <div className="rep-app">
      {/* ─── App bar ─── */}
      <header className="rep-top">
        <div className="rep-top-in">
          <img src="/school-logo.jpg" alt="School of Sciences" className="rep-crest" />
          <div className="rep-brand">
            <strong>School of Sciences</strong>
            <span>Dues Collection</span>
          </div>
          <div className="rep-top-right">
            <a className="rep-home" href="/">
              Home
            </a>
          </div>
        </div>
      </header>

      <main className="rep-body">
        {/* ─── Side summary (desktop companion) ─── */}
        {dept && screen !== 'bad-code' && (
          <aside className="rep-side">
            <div className="rep-dept-card">
              <span className="rep-dept-label">Collecting for</span>
              <h2>{dept.name}</h2>
              <div className="rep-dues">
                <div className="rep-dues-row">
                  <span>School Dues</span>
                  <strong>GHS {Number(dept.school_dues_amount).toFixed(2)}</strong>
                </div>

              </div>
            </div>
          </aside>
        )}

        {/* ─── Active screen ─── */}
        <section className="rep-flow">
          {screen === 'loading' && (
            <div className="rep-screen">
              <div className="rep-spinner"></div>
              <p className="muted mt-sm" style={{ textAlign: 'center' }}>
                Loading...
              </p>
            </div>
          )}

          {screen === 'bad-code' && (
            <div className="rep-screen">
              <div className="rep-state-icon rep-state-red">
                <LockKey size={26} />
              </div>
              <h2 style={{ textAlign: 'center' }}>Access Code Not Found</h2>
              <p
                className="muted"
                style={{ textAlign: 'center', maxWidth: 360, margin: '6px auto 0' }}
              >
                {error}
              </p>
              <a href="/" className="btn btn-outline w-full mt">
                <ArrowLeft size={16} /> Back to Home
              </a>
            </div>
          )}

          {(screen === 'lock' || (inviteToken && screen === 'flow')) && dept && (
            <div className="rep-screen rep-lock">
              <div className="rep-state-icon">
                <LockKey size={30} />
              </div>
              <p className="rep-eyebrow">Protected page</p>
              <h2 style={{ textAlign: 'center' }}>{inviteToken ? 'Set your course rep password' : 'Sign in to record dues'}</h2>

                <form onSubmit={unlock} className="rep-lock-form">
                  {sessionExpired && (
                    <div className="alert alert-error">
                      {pinError || 'Your recording session expired.'}
                    </div>
                  )}
                  {activated && <p role="status">Password set. Sign in with your email and new password.</p>}
                  {!inviteToken && <div className="field">
                    <label htmlFor="rep-email">Email</label>
                    <input id="rep-email" className="input" type="email" autoComplete="username" required value={repEmail} onChange={(e) => setRepEmail(e.target.value)} />
                  </div>}
                  <div className="field">
                    <label htmlFor="rep-password">Password</label>
                    <div className="rep-pin-wrap">
                      <input
                        className="input rep-pin-input"
                        type={showPin ? 'text' : 'password'}
                        id="rep-password"
                        autoComplete={inviteToken ? "new-password" : "current-password"}
                        minLength={inviteToken ? 12 : undefined}
                        required
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="rep-pin-eye"
                        onClick={() => setShowPin(!showPin)}
                        aria-label={showPin ? 'Hide password' : 'Show password'}
                      >
                        {showPin ? <EyeSlash size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  {!sessionExpired && pinError && (
                    <div className="alert alert-error">{pinError}</div>
                  )}
                  <button
                    className="btn btn-primary btn-lg w-full"
                    disabled={unlocking}
                  >
                    <LockKey size={18} stroke={2.5} />
                    {unlocking ? 'Please wait…' : inviteToken ? 'Set password' : 'Sign in'}
                  </button>
                </form>
            </div>
          )}

          {screen === 'flow' && !inviteToken && (
            <>
              {/* Step pills */}
              <div className="rep-pills" aria-label="Payment progress">
                {stepPills.map((p, i) => (
                  <div
                    key={p.key}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    className={`rep-pill ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
                  >
                    <span className="rep-pill-num">
                      {i < stepIndex ? <CheckCircle size={11} stroke={2.5} /> : p.n}
                    </span>
                    <span className="rep-pill-label">{p.label}</span>
                  </div>
                ))}
              </div>

              {error && <div role="alert" className="alert alert-error">{error}</div>}

              {/* Continuing students enter details directly; no roster is required. */}
              {step === 'details' && (
                <form onSubmit={submitDetails} className="rep-screen">
                  <p className="rep-eyebrow">Continuing students · Levels 200–400</p>
                  <h2 className="rep-screen-title">Student details</h2>
                  <p className="muted text-sm">Enter the details below. All fields are required; the student does not need to be on the system already.</p>
                  <div className="field">
                    <label htmlFor="payer-name">Student name</label>
                    <input id="payer-name" className="input" value={payer.name} maxLength={200} onChange={(e) => setPayer({ ...payer, name: e.target.value })} autoComplete="off" required autoFocus />
                  </div>
                  <div className="field">
                    <label htmlFor="payer-number">Index number</label>
                    <input id="payer-number" className="input" value={payer.no} maxLength={80} onChange={(e) => setPayer({ ...payer, no: e.target.value.toUpperCase() })} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" required />
                  </div>
                  <div className="field">
                    <label htmlFor="payer-email">Student email</label>
                    <input id="payer-email" className="input" type="email" value={payer.email} maxLength={254} onChange={(e) => setPayer({ ...payer, email: e.target.value })} autoComplete="off" required />
                    <small className="muted">The receipt will be sent to this address.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="payer-class">Class</label>
                    <input id="payer-class" className="input" placeholder="e.g. BSc Information Technology, Class A" value={payer.className} maxLength={120} onChange={(e) => setPayer({ ...payer, className: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Current level</label>
                    <Select value={payer.level} onChange={(level) => setPayer({ ...payer, level })} options={currentLevelOptions} placeholder="Choose the current level..." required />
                  </div>
                  <button className="btn btn-primary btn-lg w-full">Continue to payment <ArrowRight size={18} /></button>
                </form>
              )}

              {/* Step 2: select the dues being paid */}
              {step === 'dues' && (
                <form onSubmit={submitDues} className="rep-screen">
                  <h2 className="rep-screen-title">Payment details</h2>

                  <div className="rep-student-head">
                    <div className="rep-avatar">
                      {payer.name
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div>
                      <h2 style={{ marginBottom: 0 }}>{payer.name}</h2>
                      <span className="muted text-sm">
                        {payer.no.toUpperCase()}
                        {payerLevelLabel && ` · ${payerLevelLabel}`}
                      </span>
                    </div>
                  </div>

                  <div className="rep-method">
                    <label className="rep-method-label">Paying for level</label>
                    <Select
                      value={effectivePayLevel}
                      onChange={setPayLevel}
                      options={levelOptions}
                      required
                      placeholder="Choose the level being paid for..."
                    />
                    <p className="muted text-xs" style={{ marginTop: 6 }}>
                      Choose the level this payment covers. It can differ from the current level when clearing arrears.
                    </p>
                  </div>

                  <div className="field rep-method">
                    <label htmlFor="school-dues-amount">School dues amount received (GHS)</label>
                    <input id="school-dues-amount" className="input" type="number" inputMode="decimal" step="0.01" min="0.01" max={MAIN_DUES_MAX} placeholder="Enter amount received" value={amounts.school_dues} onChange={(e) => setAmounts({ school_dues: e.target.value })} required />
                    <small className="muted">Enter the amount actually received from this student. This form records school dues only.</small>
                  </div>

                  <div className="rep-amount" style={{ marginBottom: 14 }}>
                    <div className="rep-amount-head">
                      <label className="rep-amount-text">Academic year</label>
                      <strong>{academicYear || 'Current academic year'}</strong>
                    </div>
                  </div>

                  <div className="rep-method">
                    <label className="rep-method-label">Payment Method</label>
                    <div className="rep-method-grid">
                      <button
                        type="button"
                        className={`rep-method-btn ${method === 'cash' ? 'active' : ''}`} aria-pressed={method === 'cash'}
                        onClick={() => setMethod('cash')}
                      >
                        Cash
                      </button>
                      <button
                        type="button"
                        className={`rep-method-btn ${method === 'momo' ? 'active' : ''}`} aria-pressed={method === 'momo'}
                        onClick={() => setMethod('momo')}
                      >
                        Mobile Money
                      </button>
                    </div>
                  </div>

                  <div className="rep-total">
                    <span>Total to record</span>
                    <strong>GHS {total.toFixed(2)}</strong>
                  </div>

                  <div className="rep-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-lg w-full"
                      disabled={lines().length === 0}
                    >
                      Review & Confirm <ArrowRight size={18} />
                    </button>
                    <button
                      className="btn btn-ghost w-full"
                      type="button"
                      onClick={() => {
                        setError('');
                        setStep('details');
                      }}
                    >
                      <ArrowLeft size={16} /> Back
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: confirm on its own page before recording */}
              {step === 'confirm' && (
                <div className="rep-screen">
                  <h2 className="rep-screen-title">Confirm payment</h2>
                  <p className="muted text-sm" style={{ marginTop: -6 }}>
                    Check the details before the receipt is issued.
                  </p>

                  <div className="rep-receipt">
                    <span className="rep-receipt-label">Student</span>
                    <div className="rep-receipt-number">{payer.name}</div>
                    <div className="rep-receipt-label">
                      {payer.no.toUpperCase()}
                      {payerLevelLabel && ` · ${payerLevelLabel}`}
                    </div>
                    <div className="rep-receipt-lines">
                      <div className="rep-receipt-line"><span>Class</span><strong>{payer.className}</strong></div>
                      <div className="rep-receipt-line">
                        <span>Academic year</span>
                        <strong>{academicYear || 'Current academic year'}</strong>
                      </div>
                      <div className="rep-receipt-line">
                        <span>Paying for level</span>
                        <strong>{effectivePayLevel ? `Level ${effectivePayLevel}` : '—'}</strong>
                      </div>
                      <div className="rep-receipt-line">
                        <span>Receipt email</span>
                        <strong>{payer.email}</strong>
                      </div>
                      <div className="rep-receipt-line">
                        <span>Payment method</span>
                        <strong>{method === 'momo' ? 'Mobile Money' : 'Cash'}</strong>
                      </div>
                      {lines().map((l) => (
                        <div key={l.type} className="rep-receipt-line">
                          <span>
                            {l.label ||
                              (l.type === 'school_dues' ? 'School Dues' : `${dept.name} Dues`)}
                          </span>
                          <strong>GHS {l.amount.toFixed(2)}</strong>
                        </div>
                      ))}
                      <div className="rep-receipt-line rep-receipt-total">
                        <span>Total</span>
                        <strong>GHS {total.toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>

                  {recovery && (
                    <div className="alert alert-info" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <strong>Couldn&apos;t confirm — was it recorded?</strong>
                      {recovery.status === 'idle' && (
                        <>
                          <span className="text-sm">
                            The connection dropped while recording. Check the records before trying
                            again, so the student is never charged twice.
                          </span>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm mt-sm"
                            onClick={checkRecording}
                            disabled={checking}
                          >
                            <MagnifyingGlass size={15} /> Check if it was recorded
                          </button>
                        </>
                      )}
                      {recovery.status === 'checking' && <span className="text-sm">Checking the records…</span>}
                      {recovery.status === 'found' && (
                        <span className="text-sm">
                          Already recorded at{' '}
                          {new Date(recovery.paid_at).toLocaleString()} — receipt{' '}
                          <strong>{recovery.receipt_number}</strong>. No new receipt was created;
                          there is nothing more to do.
                        </span>
                      )}
                      {recovery.status === 'not_found' && (
                        <>
                          <span className="text-sm">
                            Not recorded — it is safe to record this payment now.
                          </span>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm mt-sm"
                            onClick={submit}
                            disabled={recording}
                          >
                            <CheckCircle size={15} /> Record it now
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="rep-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg w-full"
                      disabled={recording || resubmitBlocked}
                      onClick={submit}
                    >
                      <CheckCircle size={19} stroke={2.5} />
                      {recording ? 'Recording...' : 'Confirm & Record'}
                    </button>
                    <button
                      className="btn btn-ghost w-full"
                      type="button"
                      onClick={() => {
                        setError('');
                        setStep('dues');
                      }}
                      disabled={recording}
                    >
                      <ArrowLeft size={16} /> Back
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: receipt */}
              {step === 'done' && receipt && (
                <div className="rep-screen">
                  <div className="rep-success">
                    <div className="rep-success-icon">
                      <CheckCircle size={34} />
                    </div>
                    <h2 style={{ textAlign: 'center' }}>
                      {duplicate ? 'Payment Already Recorded' : 'Payment Recorded'}
                    </h2>
                    {duplicate && (
                      <div className="alert alert-info" style={{ justifyContent: 'center' }}>
                        This payment was already recorded — no new receipt was created.
                      </div>
                    )}
                    <p className="muted" style={{ textAlign: 'center' }}>
                      {receipt.student_name || payer.name} —{' '}
                      {receipt.academic_year || academicYear || 'Current academic year'} ·{' '}
                      {receipt.method === 'momo' ? 'Mobile Money' : 'Cash'} · GHS{' '}
                      {Number(receipt.total_amount).toFixed(2)}
                    </p>
                    {receipt.pending_verification && (
                      <p className="muted text-sm" style={{ textAlign: 'center' }}>
                        New student record created — it joins the student list after school verification.
                      </p>
                    )}
                    {/* Truthful email status — matches what the server actually did. */}
                    {receipt.email?.mode === 'sent' && (
                      <p className="muted" style={{ textAlign: 'center' }}>
                        Receipt emailed to <strong>{receipt.email.to || receipt.payer_email}</strong>
                      </p>
                    )}
                    {receipt.email?.mode === 'dev' && (
                      <p className="muted" style={{ textAlign: 'center' }}>
                        Receipt recorded — email not configured
                      </p>
                    )}
                    {(receipt.email?.mode === 'error' || receipt.email?.mode === 'skipped') && (
                      <p className="alert alert-error" style={{ justifyContent: 'center' }}>
                        Receipt RECORDED, but the email failed
                        {receipt.email.error ? ` (${receipt.email.error})` : ''} — the student was
                        NOT emailed.
                      </p>
                    )}
                  </div>

                  <div className="rep-receipt">
                    <p className="muted text-sm">{payer.name} · {payer.no} · {receipt.class_name || payer.className}</p>
                    <span className="rep-receipt-label">Receipt Number</span>
                    <div className="rep-receipt-number">{receipt.receipt_number}</div>
                    <div className="rep-receipt-label">
                      Academic year:{' '}
                      {receipt.academic_year || academicYear || 'Current academic year'}
                      {` · Paying for Level ${receipt.payment_level || effectivePayLevel || payer.level || '—'}`}
                    </div>
                    <div className="rep-receipt-lines">
                      {asArray(receipt.lines).map((l) => (
                        <div key={l.type} className="rep-receipt-line">
                          <span>
                            {l.label ||
                              (l.type === 'school_dues'
                                ? 'School Dues'
                                : `${dept.name} Dues`)}
                          </span>
                          <strong>GHS {Number(l.amount).toFixed(2)}</strong>
                        </div>
                      ))}
                      <div className="rep-receipt-line rep-receipt-total">
                        <span>Total</span>
                        <strong>GHS {Number(receipt.total_amount).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="rep-actions">
                    <button className="btn btn-primary w-full" onClick={resetFlow}>
                      <ArrowClockwise size={18} /> Record Another Payment
                    </button>
                    <button className="btn btn-ghost w-full" onClick={lockNow}>
                      <LockKey size={16} /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
