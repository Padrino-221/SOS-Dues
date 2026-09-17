import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import {
  LockKey,
  MagnifyingGlass,
  CurrencyCircleDollar,
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  HandCoins,
  DeviceMobile,
  Eye,
  EyeSlash,
  House,
  CalendarBlank,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';

const STORAGE_PREFIX = 'rep_token_';

function yearOptions(active) {
  const base = Number(String(active || '').split('/')[0]);
  const start = Number.isFinite(base) && base ? base : new Date().getFullYear();
  const opts = [];
  for (let y = start + 1; y >= start - 3; y--) {
    opts.push({ value: `${y}/${y + 1}`, label: `${y}/${y + 1}` });
  }
  return opts;
}

export default function RepPage() {
  const { code } = useParams();
  const storageKey = useMemo(() => STORAGE_PREFIX + (code || '').toUpperCase(), [code]);

  const [dept, setDept] = useState(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState('loading'); // loading | bad-code | lock | flow
  const [step, setStep] = useState('class'); // class → confirm → done
  const [mode, setMode] = useState('class'); // class | level
  const [classId, setClassId] = useState('');
  const [level, setLevel] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [student, setStudent] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [recording, setRecording] = useState(false);
  const [method, setMethod] = useState('cash');
  const [amounts, setAmounts] = useState({ school_dues: '', department_dues: '' });
  const [receipt, setReceipt] = useState(null);
  const [academicYear, setAcademicYear] = useState('');
  const [confirming, setConfirming] = useState(false);

  // PIN unlock state
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
        setAmounts({
          school_dues: String(res.data.school_dues_amount || ''),
          department_dues: String(res.data.dues_amount || ''),
        });
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

  const unlock = async (e) => {
    e.preventDefault();
    setPinError('');
    if (!pin.trim()) {
      setPinError('Enter the department PIN.');
      return;
    }
    setUnlocking(true);
    try {
      const res = await api.post(`/public/departments/${encodeURIComponent(code)}/unlock`, {
        pin: pin.trim(),
      });
      const tok = res.data.token;
      sessionStorage.setItem(storageKey, tok);
      setRepToken(tok);
      setPin('');
      setScreen('flow');
    } catch (err) {
      setPinError(err.response?.data?.error || 'Could not unlock. Try again.');
    } finally {
      setUnlocking(false);
    }
  };

  const lockNow = () => {
    sessionStorage.removeItem(storageKey);
    setRepToken('');
    setStudent(null);
    setStep('class');
    setPin('');
    setSessionExpired(false);
    setScreen('lock');
  };

  const authHeaders = () => ({ Authorization: `Bearer ${repToken}` });

  const classOptions = (dept?.classes || []).map((c) => ({
    value: c.id,
    label: c.name + (c.level !== c.name ? ` (${c.level})` : ''),
  }));

  const levelOptions = (dept?.levels || []).map((l) => ({
    value: l,
    label: `Level ${l}`,
  }));

  const lookupStudent = async (e) => {
    e.preventDefault();
    setError('');
    setStudent(null);
    setSessionExpired(false);
    const scope = mode === 'level' ? level : classId;
    if (!scope) {
      setError(mode === 'level' ? 'Select a level first.' : 'Select a class first.');
      return;
    }
    const normalizedStudentNo = studentNo.trim().toUpperCase();
    if (!normalizedStudentNo) {
      setError("Enter the student's number.");
      return;
    }
    setLookingUp(true);
    try {
      const url =
        mode === 'level'
          ? `/public/departments/${encodeURIComponent(code)}/levels/${scope}/students/${encodeURIComponent(normalizedStudentNo)}`
          : `/public/departments/${encodeURIComponent(code)}/classes/${scope}/students/${encodeURIComponent(normalizedStudentNo)}`;
      const res = await api.get(url, { headers: authHeaders() });
      setStudent(res.data);
      setAcademicYear(res.data.academic_year || '');
      // Prefill each line with what is still outstanding (installments allowed).
      setAmounts({
        school_dues:
          res.data.school_dues_outstanding !== undefined
            ? String(res.data.school_dues_outstanding)
            : '',
        department_dues:
          res.data.dept_dues_outstanding !== undefined
            ? String(res.data.dept_dues_outstanding)
            : '',
      });
      setStep('confirm');
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        sessionStorage.removeItem(storageKey);
        setRepToken('');
        setSessionExpired(true);
        setPinError(
          err.response?.data?.error || 'Your recording session has expired. Enter the PIN again.'
        );
        setScreen('lock');
      } else {
        setError(
          err.response?.data?.error || 'Student not found. Ask the department admin to add them.'
        );
      }
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    setSessionExpired(false);
    setRecording(true);
    setReceipt(null);
    try {
      const items = [];
      if (Number(amounts.school_dues) > 0)
        items.push({ type: 'school_dues', amount: Number(amounts.school_dues) });
      if (Number(amounts.department_dues) > 0)
        items.push({ type: 'department_dues', amount: Number(amounts.department_dues) });
      if (items.length === 0) {
        setError('Enter at least one amount.');
        setRecording(false);
        return;
      }

      const url =
        mode === 'level'
          ? `/public/departments/${encodeURIComponent(code)}/levels/${level}/payments`
          : `/public/departments/${encodeURIComponent(code)}/classes/${classId}/payments`;
      const res = await api.post(
        url,
        { student_no: student.student_no, items, method, academic_year: academicYear || undefined },
        { headers: authHeaders() }
      );
      setReceipt(res.data);
      setAcademicYear(res.data.academic_year || academicYear);
      setStep('done');
      setConfirming(false);
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        sessionStorage.removeItem(storageKey);
        setRepToken('');
        setSessionExpired(true);
        setPinError(
          err.response?.data?.error || 'Your recording session has expired. Enter the PIN again.'
        );
        setScreen('lock');
      } else {
        setError(err.response?.data?.error || 'Payment could not be recorded.');
      }
    } finally {
      setRecording(false);
    }
  };

  const resetFlow = () => {
    setStep('class');
    setClassId('');
    setStudentNo('');
    setStudent(null);
    setReceipt(null);
    setAcademicYear('');
    setConfirming(false);
    setError('');
    setMethod('cash');
    if (dept)
      setAmounts({
        school_dues: String(dept.school_dues_amount || ''),
        department_dues: String(dept.dues_amount || ''),
      });
  };

  const total = Number(amounts.school_dues || 0) + Number(amounts.department_dues || 0);
  const bothPaid = student && student.school_dues_paid && student.dept_dues_paid;
  const canRecord =
    student &&
    !bothPaid &&
    (Number(amounts.school_dues) > 0 || Number(amounts.department_dues) > 0);

  const stepPills = [
    { key: 'class', n: 1, label: 'Class & Student' },
    { key: 'confirm', n: 2, label: 'Confirm & Record' },
    { key: 'done', n: 3, label: 'Receipt' },
  ];
  const stepIndex = stepPills.findIndex((p) => p.key === step);

  return (
    <div className="rep-app">
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={<CheckCircle size={20} />}
        title="Confirm payment"
        subtitle="Check the details before issuing the receipt."
      >
        <div className="rep-confirm-summary">
          <div>
            <span>Student</span>
            <strong>{student?.name}</strong>
            <small>{student?.student_no}</small>
          </div>
          <div>
            <span>Academic year</span>
            <strong>{academicYear || 'Current academic year'}</strong>
            <small>{method === 'momo' ? 'Mobile Money' : 'Cash'}</small>
          </div>
          <div>
            <span>School dues</span>
            <strong>GHS {Number(amounts.school_dues || 0).toFixed(2)}</strong>
          </div>
          <div>
            <span>Department dues</span>
            <strong>GHS {Number(amounts.department_dues || 0).toFixed(2)}</strong>
          </div>
          <div className="rep-confirm-total">
            <span>Total</span>
            <strong>GHS {total.toFixed(2)}</strong>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setConfirming(false)}>
            Go back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={recording}
            onClick={() => submit()}
          >
            <CheckCircle size={17} /> {recording ? 'Recording...' : 'Confirm & record'}
          </button>
        </div>
      </Modal>
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
              <House size={15} weight="bold" /> Home
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
                <div className="rep-dues-row">
                  <span>Department Dues</span>
                  <strong>GHS {Number(dept.dues_amount).toFixed(2)}</strong>
                </div>
              </div>
            </div>
            {screen === 'flow' && (
              <div className="rep-side-note">
                <h3>Good to know</h3>
                <ul>
                  <li>Amounts already paid are locked and can't be changed.</li>
                  <li>One receipt is issued for each payment.</li>
                </ul>
              </div>
            )}
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
                <LockKey size={26} weight="regular" />
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

          {screen === 'lock' && dept && (
            <div className="rep-screen rep-lock">
              <div className="rep-state-icon">
                <LockKey size={30} weight="regular" />
              </div>
              <p className="rep-eyebrow">Protected page</p>
              <h2 style={{ textAlign: 'center' }}>Enter the PIN to collect dues</h2>
              <p
                className="muted"
                style={{ textAlign: 'center', maxWidth: 360, margin: '4px auto 0' }}
              >
                Recording for <strong>{dept.name}</strong> is protected.
              </p>

              {dept.pin_set === false && (
                <div className="alert alert-error" style={{ marginTop: 18 }}>
                  No PIN has been set yet — recording is locked. Ask the department admin to set
                  one.
                </div>
              )}

              {dept.pin_set && (
                <form onSubmit={unlock} className="rep-lock-form">
                  {sessionExpired && (
                    <div className="alert alert-error">
                      {pinError || 'Your recording session expired.'}
                    </div>
                  )}
                  <div className="field">
                    <label>Collector PIN</label>
                    <div className="rep-pin-wrap">
                      <input
                        className="input rep-pin-input"
                        type={showPin ? 'text' : 'password'}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="••••"
                        maxLength={8}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="rep-pin-eye"
                        onClick={() => setShowPin(!showPin)}
                        aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
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
                    disabled={unlocking || pin.length < 4}
                  >
                    <LockKey size={18} weight="bold" />
                    {unlocking ? 'Unlocking...' : 'Unlock & Continue'}
                  </button>
                  <p className="muted text-xs" style={{ textAlign: 'center', marginTop: 12 }}>
                    Don't have the PIN? Ask the department admin.
                  </p>
                </form>
              )}
            </div>
          )}

          {screen === 'flow' && (
            <>
              {/* Step pills */}
              <div className="rep-pills">
                {stepPills.map((p, i) => (
                  <div
                    key={p.key}
                    className={`rep-pill ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
                  >
                    <span className="rep-pill-num">
                      {i < stepIndex ? <CheckCircle size={11} weight="bold" /> : p.n}
                    </span>
                    <span className="rep-pill-label">{p.label}</span>
                  </div>
                ))}
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              {/* Step 1: find the student */}
              {step === 'class' && (
                <form onSubmit={lookupStudent} className="rep-screen">
                  <h2 className="rep-screen-title">Select the class or level and student</h2>
                  <p className="muted text-sm" style={{ marginTop: -8, marginBottom: 20 }}>
                    Enter the student's number to see what they still owe.
                  </p>

                  <div className="rep-mode-grid">
                    <button
                      type="button"
                      className={`rep-mode-btn ${mode === 'class' ? 'active' : ''}`}
                      onClick={() => setMode('class')}
                    >
                      <span className="rep-mode-title">By Class</span>
                      <span className="rep-mode-sub">Collect from a specific class</span>
                    </button>
                    <button
                      type="button"
                      className={`rep-mode-btn ${mode === 'level' ? 'active' : ''}`}
                      onClick={() => setMode('level')}
                    >
                      <span className="rep-mode-title">By Level</span>
                      <span className="rep-mode-sub">
                        Collect from a whole level (e.g. Level 200)
                      </span>
                    </button>
                  </div>

                  {mode === 'class' ? (
                    <div className="field">
                      <label>Class</label>
                      <Select
                        value={classId}
                        onChange={(v) => {
                          setClassId(v);
                          setError('');
                        }}
                        options={classOptions}
                        placeholder="Choose the class..."
                      />
                    </div>
                  ) : (
                    <div className="field">
                      <label>Level</label>
                      <Select
                        value={level}
                        onChange={(v) => {
                          setLevel(v);
                          setError('');
                        }}
                        options={levelOptions}
                        placeholder="Choose the level..."
                      />
                    </div>
                  )}

                  <div className="field">
                    <label>Student number</label>
                    <input
                      className="input"
                      placeholder="e.g. UEB2001"
                      value={studentNo}
                      onChange={(e) => setStudentNo(e.target.value.toUpperCase())}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                    />
                  </div>
                  <button className="btn btn-primary btn-lg w-full" disabled={lookingUp}>
                    <MagnifyingGlass size={19} weight="regular" />
                    {lookingUp ? 'Checking...' : 'Find Student'}
                  </button>
                  <p className="muted text-xs" style={{ textAlign: 'center', marginTop: 12 }}>
                    Student not showing? Ask the department admin to add them.
                  </p>
                </form>
              )}

              {/* Step 2: confirm + record */}
              {step === 'confirm' && student && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (canRecord) setConfirming(true);
                  }}
                  className="rep-screen"
                >
                  <div className="rep-student-head">
                    <div className="rep-avatar">
                      {student.name
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div>
                      <h2 style={{ marginBottom: 0 }}>{student.name}</h2>
                      <span className="muted text-sm">{student.student_no}</span>
                    </div>
                  </div>

                  <div className="rep-amount" style={{ marginBottom: 14 }}>
                    <div className="rep-amount-head">
                      <span className="rep-amount-icon">
                        <CalendarBlank size={20} weight="regular" />
                      </span>
                      <div>
                        <label>Academic year</label>
                        <p className="muted text-xs">The year this payment applies to.</p>
                      </div>
                      <div className="rep-year-select">
                        <Select
                          value={academicYear}
                          onChange={setAcademicYear}
                          options={yearOptions(academicYear)}
                        />
                      </div>
                    </div>
                  </div>

                  {student.school_dues_paid ? (
                    <div className="rep-paid-note">
                      School Dues fully recorded for {academicYear || 'this year'}
                    </div>
                  ) : (
                    <div className="rep-amount">
                      <div className="rep-amount-head">
                        <span className="rep-amount-icon">
                          <CurrencyCircleDollar size={20} weight="regular" />
                        </span>
                        <div>
                          <label>School Dues</label>
                          <p className="muted text-xs">
                            {Number(student.school_dues_paid_amount || 0) > 0
                              ? `Paid GHS ${Number(student.school_dues_paid_amount).toFixed(2)} of GHS ${Number(student.school_dues_required || 0).toFixed(2)}. `
                              : ''}
                            Amount owed for {academicYear || 'this year'}.
                          </p>
                        </div>
                        <div className="rep-amount-input">
                          <span className="rep-ghs">GHS</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={amounts.school_dues}
                            onChange={(e) =>
                              setAmounts({ ...amounts, school_dues: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {student.dept_dues_paid ? (
                    <div className="rep-paid-note">
                      {dept.name} dues fully recorded for {academicYear || 'this year'}
                    </div>
                  ) : (
                    <div className="rep-amount">
                      <div className="rep-amount-head">
                        <span className="rep-amount-icon rep-amount-icon-gold">
                          <CurrencyCircleDollar size={20} weight="regular" />
                        </span>
                        <div>
                          <label>{dept.name} Dues</label>
                          <p className="muted text-xs">
                            {Number(student.dept_dues_paid_amount || 0) > 0
                              ? `Paid GHS ${Number(student.dept_dues_paid_amount).toFixed(2)} of GHS ${Number(student.dept_dues_required || 0).toFixed(2)}. `
                              : ''}
                            Amount owed for {academicYear || 'this year'}.
                          </p>
                        </div>
                        <div className="rep-amount-input">
                          <span className="rep-ghs">GHS</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={amounts.department_dues}
                            onChange={(e) =>
                              setAmounts({ ...amounts, department_dues: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rep-method">
                    <label className="rep-method-label">Payment Method</label>
                    <div className="rep-method-grid">
                      <button
                        type="button"
                        className={`rep-method-btn ${method === 'cash' ? 'active' : ''}`}
                        onClick={() => setMethod('cash')}
                      >
                        <HandCoins size={22} weight="regular" />
                        <span>Cash</span>
                      </button>
                      <button
                        type="button"
                        className={`rep-method-btn ${method === 'momo' ? 'active' : ''}`}
                        onClick={() => setMethod('momo')}
                      >
                        <DeviceMobile size={22} weight="regular" />
                        <span>Mobile Money</span>
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
                      disabled={recording || !canRecord}
                    >
                      <CheckCircle size={19} weight="bold" />
                      {recording ? 'Recording...' : 'Record Payment'}
                    </button>
                    <button
                      className="btn btn-ghost w-full"
                      type="button"
                      onClick={resetFlow}
                      disabled={recording}
                    >
                      <ArrowClockwise size={16} /> New student
                    </button>
                  </div>
                  {bothPaid && (
                    <p className="muted text-xs" style={{ textAlign: 'center' }}>
                      Both amounts are already recorded for this year — nothing left to record.
                    </p>
                  )}
                </form>
              )}

              {/* Step 3: receipt */}
              {step === 'done' && receipt && (
                <div className="rep-screen">
                  <div className="rep-success">
                    <div className="rep-success-icon">
                      <CheckCircle size={34} weight="regular" />
                    </div>
                    <h2 style={{ textAlign: 'center' }}>Payment Recorded</h2>
                    <p className="muted" style={{ textAlign: 'center' }}>
                      {student.name} —{' '}
                      {receipt.academic_year || academicYear || 'Current academic year'} ·{' '}
                      {receipt.method === 'momo' ? 'Mobile Money' : 'Cash'} · GHS{' '}
                      {Number(receipt.total_amount).toFixed(2)}
                    </p>
                  </div>

                  <div className="rep-receipt">
                    <span className="rep-receipt-label">Receipt Number</span>
                    <div className="rep-receipt-number">{receipt.receipt_number}</div>
                    <div className="rep-receipt-label">
                      Academic year:{' '}
                      {receipt.academic_year || academicYear || 'Current academic year'}
                    </div>
                    <div className="rep-receipt-lines">
                      {receipt.lines.map((l) => (
                        <div key={l.type} className="rep-receipt-line">
                          <span>
                            {l.type === 'school_dues' ? 'School Dues' : 'Department Dues'}
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

                  <p
                    className="muted text-sm"
                    style={{ textAlign: 'center', maxWidth: 400, margin: '0 auto 18px' }}
                  >
                    Give this receipt number to the student.
                  </p>

                  <div className="rep-actions">
                    <button className="btn btn-primary w-full" onClick={resetFlow}>
                      <MagnifyingGlass size={18} weight="regular" /> Record Another Payment
                    </button>
                    <button className="btn btn-ghost w-full" onClick={lockNow}>
                      <LockKey size={16} /> Lock This Page
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
