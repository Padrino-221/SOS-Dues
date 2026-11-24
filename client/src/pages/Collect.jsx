import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { MAIN_DUES_MAX, mainDuesIssue } from '../utils/duesLimits';
import { useAuth } from '../context/AuthContext';
import {
  IconCash as HandCoins,
  IconCircleCheck as CheckCircle,
  IconAlertTriangle as Warning,
  IconCurrencyDollar as CurrencyCircleDollar,
  IconRefresh as ArrowClockwise,
  IconCalendar as CalendarBlank,
  IconCreditCard as CreditCard,
  IconArrowRight as ArrowRight,
  IconArrowLeft as ArrowLeft,
  IconSearch as MagnifyingGlass,
  IconRosetteDiscountCheck as SealCheck,
} from '@tabler/icons-react';
import Select from '../components/ui/Select';
import DatePicker from '../components/ui/DatePicker';

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <CheckCircle size={18} /> : <Warning size={18} />}
      {message}
    </div>
  );
}

const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'momo', label: 'Mobile Money' },
];

const LEVELS = ['100', '200', '300', '400'];
const LEVEL_OPTIONS = LEVELS.map((l) => ({ value: l, label: `Level ${l}` }));

// Money rule: quantize to pesewas (2 decimals) so the totals shown match what
// the server stores.
const round2 = (x) => Math.round(Number(x) * 100) / 100;

// Format today's date in the institution's time zone (Africa/Accra). Seeding
// with toISOString().slice(0, 10) uses UTC, which around 22:00 GMT already
// shows TOMORROW's date to a collector in Ghana.
function todayInAccra() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── Draft recovery ───
// The whole collection draft (payer fields, lines, idempotency key) lives in
// sessionStorage across refreshes/crashes and is cleared only after a
// confirmed success. Restored synchronously via state initializers so mount
// effects cannot clobber it with empty values.
const DRAFT_KEY = 'collect_draft';
function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

// Build academic-year choices around the active year (e.g. 2026/2027).
function yearOptions(active) {
  const base = Number(String(active || '').split('/')[0]);
  const start = Number.isFinite(base) && base ? base : new Date().getFullYear();
  const opts = [];
  for (let y = start + 1; y >= start - 3; y--) {
    opts.push({ value: `${y}/${y + 1}`, label: `${y}/${y + 1}` });
  }
  return opts;
}

export default function Collect() {
  const { user } = useAuth();

  // A restored draft wins over the default empty form.
  const [draft] = useState(readDraft);

  const [activeYear, setActiveYear] = useState('');
  const [academicYear, setAcademicYear] = useState(() => draft?.academicYear || '');
  const [schoolDues, setSchoolDues] = useState('');
  const [deptDues, setDeptDues] = useState('');
  const [loadIssues, setLoadIssues] = useState([]);

  // Free-flow payer details — typed in, never looked up.
  const [payer, setPayer] = useState(
    () => draft?.payer || { name: '', no: '', email: '', level: '' }
  );
  const [picked, setPicked] = useState(() => draft?.picked || { school_dues: true, department_dues: true });
  const [payment, setPayment] = useState(
    () => draft?.payment || { school_dues: '', department_dues: '', method: 'cash', paid_at: todayInAccra() }
  );
  const [view, setView] = useState(() => (draft?.view === 'confirm' ? 'confirm' : 'form')); // form → confirm → done
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [toasts, setToasts] = useState([]);

  // One idempotency key per form fill: a retried submit with the same key
  // returns the existing receipt instead of recording the cash twice.
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => draft?.idempotencyKey || crypto.randomUUID()
  );

  // "Couldn't confirm — was it recorded?" recovery state after an ambiguous
  // failure (timeout / network drop / 5xx).
  const [recovery, setRecovery] = useState(null);
  const [checking, setChecking] = useState(false);

  const noteIssue = (msg) =>
    setLoadIssues((prev) => (prev.includes(msg) ? prev : [...prev, msg]));

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  useEffect(() => {
    api
      .get('/settings')
      .then((res) => {
        const ay = res.data?.active_academic_year || '';
        setActiveYear(ay);
        setAcademicYear((v) => v || ay);
        setSchoolDues(String(res.data?.school_dues_amount || ''));
        // A restored draft keeps its own amounts; only a fresh form is pre-filled.
        if (!draft) {
          setPayment((p) => ({
            ...p,
            school_dues: String(res.data?.school_dues_amount || ''),
          }));
        }
      })
      .catch(() =>
        noteIssue('School dues settings could not be loaded — dues amounts may be missing. Check your connection and refresh.')
      );
    api
      .get('/departments')
      .then((res) => {
        const mine = res.data?.[0];
        setDeptDues(String(mine?.dues_amount || ''));
        if (!draft) {
          setPayment((p) => ({
            ...p,
            department_dues: String(mine?.dues_amount || ''),
          }));
        }
      })
      .catch(() =>
        noteIssue('Department dues could not be loaded — the amount may be missing. Check your connection and refresh.')
      );
  }, []);

  // Persist the whole draft on every change; clear it only on success so a
  // crash or refresh mid-flow never loses the collection.
  useEffect(() => {
    try {
      if (view === 'done') {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          payer,
          picked,
          payment,
          academicYear,
          idempotencyKey,
          view: view === 'confirm' ? 'confirm' : 'form',
        })
      );
    } catch {
      /* storage unavailable — draft persistence is best-effort */
    }
  }, [view, payer, picked, payment, academicYear, idempotencyKey]);

  // Classes are gone: the collection is recorded against the payer's level.
  const lines = () => {
    const items = [];
    if (picked.school_dues && round2(payment.school_dues) > 0)
      items.push({ type: 'school_dues', amount: round2(payment.school_dues) });
    if (picked.department_dues && round2(payment.department_dues) > 0)
      items.push({ type: 'department_dues', amount: round2(payment.department_dues) });
    return items;
  };
  const total = lines().reduce((sum, l) => sum + l.amount, 0);

  // A ticked dues with a blank/0 amount is not silently dropped — it surfaces
  // as an explicit inline error so the collector knows it will NOT be saved.
  const lineIssue = (pickedFlag, rawAmount, label) =>
    pickedFlag && round2(rawAmount) <= 0
      ? `${label} has no amount — it will NOT be recorded.`
      : null;
  const schoolIssue = lineIssue(picked.school_dues, payment.school_dues, 'School dues');
  const deptIssue = lineIssue(picked.department_dues, payment.department_dues, 'Department dues');
  const lineIssues = [schoolIssue, deptIssue].filter(Boolean);

  // Non-blocking overpayment warning: an amount above the configured dues
  // usually means a stray extra zero. Warn, never block.
  const overpayWarnings = [];
  if (
    picked.school_dues &&
    Number(schoolDues || 0) > 0 &&
    round2(payment.school_dues) > Number(schoolDues)
  ) {
    overpayWarnings.push(
      `School dues is normally GHS ${Number(schoolDues).toFixed(2)} — GHS ${round2(payment.school_dues).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} looks high. Confirm with the student.`
    );
  }
  if (
    picked.department_dues &&
    Number(deptDues || 0) > 0 &&
    round2(payment.department_dues) > Number(deptDues)
  ) {
    overpayWarnings.push(
      `Department dues is normally GHS ${Number(deptDues).toFixed(2)} — GHS ${round2(payment.department_dues).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} looks high. Confirm with the student.`
    );
  }

  // Hard cap on the main dues (school + department): over the limit the line
  // is refused outright. Extra dues lines have no limit.
  const capIssue = () => {
    const over = lines().find((l) => Number(l.amount) > MAIN_DUES_MAX);
    return over
      ? mainDuesIssue(over.amount, over.type === 'school_dues' ? 'School dues' : 'Department dues')
      : null;
  };

  const review = () => {
    if (!payer.name.trim()) return addToast("Enter the student's name.", 'error');
    if (!payer.no.trim()) return addToast("Enter the student's index number.", 'error');
    if (!payer.email.trim()) return addToast("Enter the student's email address.", 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email.trim()))
      return addToast('Enter a valid email address.', 'error');
    if (!payer.level) return addToast('Select the level.', 'error');
    if (lines().length === 0)
      return addToast('Select at least one dues and enter an amount.', 'error');
    const reviewCapIssue = capIssue();
    if (reviewCapIssue) return addToast(reviewCapIssue, 'error');
    setRecovery(null);
    setView('confirm');
  };

  const submit = async () => {
    setSaving(true);
    setReceipt(null);
    setDuplicate(false);
    try {
      const items = lines();
      if (items.length === 0) {
        addToast('Select at least one dues and enter an amount.', 'error');
        setSaving(false);
        return;
      }
      const submitCapIssue = capIssue();
      if (submitCapIssue) {
        addToast(submitCapIssue, 'error');
        setSaving(false);
        return;
      }
      const res = await api.post('/receipts', {
        student_name: payer.name.trim(),
        student_no: payer.no.trim().toUpperCase(),
        email: payer.email.trim(),
        level: payer.level,
        method: payment.method,
        paid_at: payment.paid_at || undefined,
        academic_year: academicYear || undefined,
        items,
        idempotency_key: idempotencyKey,
      });
      setReceipt(res.data);
      setDuplicate(Boolean(res.data.duplicate));
      setRecovery(null);
      setView('done');
      addToast(
        res.data.duplicate
          ? `Payment already recorded — Receipt ${res.data.receipt_number}`
          : `Payment recorded — Receipt ${res.data.receipt_number}`
      );
    } catch (err) {
      const status = err.response?.status;
      // Ambiguous failures (timeout, network drop, 5xx) MAY have recorded the
      // payment — offer a recovery check before inviting a re-record.
      const ambiguous =
        ['ECONNABORTED', 'ETIMEDOUT'].includes(err.code) || !err.response || status >= 500;
      if (ambiguous) {
        setRecovery({ status: 'idle' });
        addToast(
          err.response?.data?.error ||
            "Couldn't confirm whether the payment was recorded — check before recording again.",
          'error'
        );
      } else {
        addToast(err.response?.data?.error || 'Failed to record payment', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  // Recovery check: look up this payer's recent receipts. If the payment
  // already exists, show it instead of inviting a second record.
  const checkRecording = async () => {
    setChecking(true);
    setRecovery((r) => ({ ...(r || { status: 'idle' }), status: 'checking' }));
    try {
      const res = await api.get('/receipts', {
        params: { student_no: payer.no.trim().toUpperCase(), limit: 20 },
      });
      const rows = res.data?.receipts || [];
      const expectedTotal = total;
      const match = rows.find(
        (r) =>
          !r.voided_at &&
          Number(r.total_amount) === expectedTotal &&
          Date.now() - new Date(r.paid_at).getTime() < 24 * 60 * 60 * 1000
      );
      setRecovery(
        match
          ? { status: 'found', receipt_number: match.receipt_number, paid_at: match.paid_at }
          : { status: 'not_found' }
      );
    } catch {
      setRecovery({ status: 'idle' });
      addToast('Could not check the records — check your connection and try again.', 'error');
    } finally {
      setChecking(false);
    }
  };

  // Re-submitting is only offered after the check came back "not found".
  const resubmitBlocked = Boolean(recovery) && recovery.status !== 'not_found';

  const resetFlow = () => {
    setPayer({ name: '', no: '', email: '', level: '' });
    setPicked({ school_dues: true, department_dues: true });
    setPayment({
      school_dues: schoolDues,
      department_dues: deptDues,
      method: 'cash',
      paid_at: todayInAccra(),
    });
    setReceipt(null);
    setDuplicate(false);
    setRecovery(null);
    // A fresh form fill gets a fresh idempotency key.
    setIdempotencyKey(crypto.randomUUID());
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable — draft persistence is best-effort */
    }
    setView('form');
  };

  const payerLine = [payer.no.toUpperCase(), payer.level && `Level ${payer.level}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="collect-page">
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      <div className="page-head collect-head">
        <div>
          <div className="collect-eyebrow">
            <HandCoins size={14} /> Payment desk
          </div>
          <h1>Collect Dues</h1>
          <p className="subtitle">
            Enter the payer&apos;s details and the dues — the payment goes straight to the records.
          </p>
        </div>
        <div className="collect-dept-chip">
          <span className="collect-chip-mark">
            <CurrencyCircleDollar size={17} />
          </span>
          <span>
            <small>Collecting for</small>
            <strong>{user?.department_name}</strong>
          </span>
        </div>
      </div>

      {view === 'form' && (
        <>
          {loadIssues.map((m) => (
            <div className="alert alert-error" key={m}>
              <Warning size={16} /> {m}
            </div>
          ))}
          <div className="collect-layout">
          {/* ─── Payer details ─── */}
          <section className="collect-search-panel">
            <div className="collect-step">
              <span>01</span>
              <span>Student details</span>
            </div>
            <h2>Who is paying?</h2>
            <p className="muted text-sm">
              Type the details exactly as they are — no need for the student to exist in the
              system first. The receipt is emailed to the address you enter, so use a real one.
            </p>

            <div className="field">
              <label>Student name</label>
              <input
                className="input"
                placeholder="e.g. Ama Mensah"
                value={payer.name}
                onChange={(e) => setPayer({ ...payer, name: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Index number</label>
              <input
                className="input"
                placeholder="e.g. UEB3227523"
                value={payer.no}
                onChange={(e) => setPayer({ ...payer, no: e.target.value.toUpperCase() })}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label>Student email</label>
              <input
                className="input"
                type="email"
                inputMode="email"
                placeholder="e.g. ama.mensah@example.com"
                value={payer.email}
                onChange={(e) => setPayer({ ...payer, email: e.target.value })}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label>Level</label>
              <Select
                value={payer.level}
                onChange={(v) => setPayer({ ...payer, level: v })}
                options={LEVEL_OPTIONS}
                placeholder="Select the level..."
              />
            </div>
          </section>

          {/* ─── Dues + method ─── */}
          <section className="collect-payment-panel">
            <div className="collect-step">
              <span>02</span>
              <span>Payment details</span>
            </div>
            <h2>Select the dues being paid</h2>

            <div className="collect-form-note">
              <CalendarBlank size={18} />
              <span>
                Pick the dues being paid and edit the amounts if needed. Partial payments
                (installments) are allowed — every payment is recorded on its own receipt.
              </span>
            </div>

            <div className="field">
              <label className="flex align-center gap-sm">
                <input
                  type="checkbox"
                  checked={picked.school_dues}
                  onChange={(e) => setPicked({ ...picked, school_dues: e.target.checked })}
                />
                School dues <span className="muted text-xs">School-wide collection</span>
              </label>
              {picked.school_dues && (
                <div className="collect-amount-row">
                  <span className="collect-amount-icon gold">
                    <CurrencyCircleDollar size={18} />
                  </span>
                  <span className="collect-amount-label">
                    <strong>School dues</strong>
                    <small>School-wide collection</small>
                  </span>
                  <span className="collect-currency">GHS</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={payment.school_dues || ''}
                    onChange={(e) => setPayment({ ...payment, school_dues: e.target.value })}
                  />
                </div>
              )}
              {schoolIssue && (
                <p className="alert alert-error" style={{ marginTop: 8, marginBottom: 0 }}>
                  <Warning size={15} /> {schoolIssue}
                </p>
              )}
            </div>

            <div className="field">
              <label className="flex align-center gap-sm">
                <input
                  type="checkbox"
                  checked={picked.department_dues}
                  onChange={(e) => setPicked({ ...picked, department_dues: e.target.checked })}
                />
                Department dues <span className="muted text-xs">{user?.department_name}</span>
              </label>
              {picked.department_dues && (
                <div className="collect-amount-row">
                  <span className="collect-amount-icon">
                    <HandCoins size={18} />
                  </span>
                  <span className="collect-amount-label">
                    <strong>Department dues</strong>
                    <small>{user?.department_name}</small>
                  </span>
                  <span className="collect-currency">GHS</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={payment.department_dues || ''}
                    onChange={(e) => setPayment({ ...payment, department_dues: e.target.value })}
                  />
                </div>
              )}
              {deptIssue && (
                <p className="alert alert-error" style={{ marginTop: 8, marginBottom: 0 }}>
                  <Warning size={15} /> {deptIssue}
                </p>
              )}
            </div>

            {overpayWarnings.map((w) => (
              <div className="alert alert-info" key={w}>
                <Warning size={16} /> {w}
              </div>
            ))}

            <div className="field">
              <label>
                <CalendarBlank size={15} /> Academic year
              </label>
              <Select
                value={academicYear}
                onChange={setAcademicYear}
                options={yearOptions(activeYear)}
                placeholder="Select academic year"
              />
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label>
                  <CreditCard size={15} /> Payment method
                </label>
                <Select
                  value={payment.method}
                  onChange={(v) => setPayment({ ...payment, method: v })}
                  options={METHOD_OPTIONS}
                />
              </div>
              <div className="field">
                <label>
                  <CalendarBlank size={15} /> Collection date
                </label>
                <DatePicker
                  value={payment.paid_at}
                  onChange={(v) => setPayment({ ...payment, paid_at: v })}
                  max={todayInAccra()}
                />
              </div>
            </div>

            <div className="collect-receipt-note">
              <SealCheck size={18} />
              <span>
                One itemized receipt will be issued and can be verified by both the School and{' '}
                {user?.department_name}.
              </span>
            </div>

            <button className="btn btn-green w-full mt" onClick={review}>
              Review &amp; Confirm <ArrowRight size={18} />
            </button>
          </section>
          </div>
        </>
      )}

      {/* ─── Confirm on its own page ─── */}
      {view === 'confirm' && (
        <div className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
          <div className="collect-step">
            <span>03</span>
            <span>Confirm</span>
          </div>
          <h2>Confirm payment</h2>
          <p className="muted text-sm">Check the details before the receipt is issued.</p>

          <table className="table" style={{ marginTop: 12 }}>
            <tbody>
              <tr>
                <td className="muted">Student</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {payer.name.trim()}
                </td>
              </tr>
              <tr>
                <td className="muted">Index number</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {payer.no.toUpperCase()}
                </td>
              </tr>
              <tr>
                <td className="muted">Receipt email</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {payer.email}
                </td>
              </tr>
              <tr>
                <td className="muted">Level</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {payerLine || '—'}
                </td>
              </tr>
              <tr>
                <td className="muted">Academic year</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {academicYear || 'Current academic year'}
                </td>
              </tr>
              <tr>
                <td className="muted">Method · date</td>
                <td className="fw-600" style={{ textAlign: 'right' }}>
                  {payment.method === 'momo' ? 'Mobile Money' : 'Cash'} · {payment.paid_at}
                </td>
              </tr>
              {lines().map((l) => (
                <tr key={l.type}>
                  <td className="muted">
                    {l.label || (l.type === 'school_dues' ? 'School dues' : 'Department dues')}
                  </td>
                  <td className="fw-600" style={{ textAlign: 'right' }}>
                    GHS {l.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 800 }}>
                  GHS {total.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {overpayWarnings.map((w) => (
            <div className="alert alert-info" key={w}>
              <Warning size={16} /> {w}
            </div>
          ))}
          {lineIssues.map((m) => (
            <div className="alert alert-error" key={m}>
              <Warning size={16} /> {m}
            </div>
          ))}

          {/* ─── "Did it save?" recovery after an ambiguous failure ─── */}
          {recovery && (
            <div
              className="alert alert-info"
              style={{ flexDirection: 'column', alignItems: 'stretch' }}
            >
              <strong>Couldn&apos;t confirm — was it recorded?</strong>
              {recovery.status === 'idle' && (
                <>
                  <span className="text-sm">
                    The connection dropped while recording. Check the records before trying again,
                    so the student is never charged twice.
                  </span>
                  <button
                    className="btn btn-outline btn-sm mt-sm"
                    onClick={checkRecording}
                    disabled={checking}
                  >
                    <MagnifyingGlass size={15} /> Check if it was recorded
                  </button>
                </>
              )}
              {recovery.status === 'checking' && (
                <span className="text-sm">Checking the records…</span>
              )}
              {recovery.status === 'found' && (
                <span className="text-sm">
                  Already recorded at {new Date(recovery.paid_at).toLocaleString()} — receipt{' '}
                  <strong>{recovery.receipt_number}</strong>. No new receipt was created; there is
                  nothing more to do.
                </span>
              )}
              {recovery.status === 'not_found' && (
                <>
                  <span className="text-sm">Not recorded — it is safe to record this payment now.</span>
                  <button
                    className="btn btn-green btn-sm mt-sm"
                    onClick={submit}
                    disabled={saving}
                  >
                    <HandCoins size={15} /> Record it now
                  </button>
                </>
              )}
            </div>
          )}

          <div className="grid grid-2 mt">
            <button className="btn btn-outline" onClick={() => setView('form')} disabled={saving}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="btn btn-green"
              onClick={submit}
              disabled={saving || resubmitBlocked}
            >
              <HandCoins size={18} /> {saving ? 'Recording...' : 'Confirm & Record'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Receipt ─── */}
      {view === 'done' && receipt && (
        <div className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
          <div className="collect-success">
            <div className="collect-success-icon">
              <SealCheck size={34} />
            </div>
            <span className="collect-kicker">
              {duplicate ? 'Payment already recorded' : 'Payment recorded'}
            </span>
            <h3>{duplicate ? 'Already recorded' : 'Receipt ready'}</h3>
            {duplicate && (
              <div className="alert alert-info" style={{ justifyContent: 'center' }}>
                This payment was already recorded — no new receipt was created.
              </div>
            )}
            <div className="receipt-box">
              <div className="receipt-label">One combined receipt</div>
              <div className="receipt-number">{receipt.receipt_number}</div>
              <div className="receipt-amount">GHS {Number(receipt.total_amount).toFixed(2)}</div>
            </div>
            <div className="collect-lines">
              <table className="table">
                <tbody>
                  {asArray(receipt.lines).map((l) => (
                    <tr key={l.type}>
                      <td>{l.label || (l.type === 'school_dues' ? 'School Dues' : 'Department Dues')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        GHS {Number(l.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800 }}>
                      GHS {Number(receipt.total_amount).toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Truthful email status — matches what the server actually did. */}
            {receipt.email?.mode === 'sent' && (
              <p className="muted text-sm mt" style={{ textAlign: 'center' }}>
                Receipt emailed to <strong>{receipt.email.to || receipt.payer_email}</strong>
              </p>
            )}
            {receipt.email?.mode === 'dev' && (
              <p className="muted text-sm mt" style={{ textAlign: 'center' }}>
                Receipt recorded — email not configured
              </p>
            )}
            {(receipt.email?.mode === 'error' || receipt.email?.mode === 'skipped') && (
              <p className="alert alert-error" style={{ justifyContent: 'center' }}>
                Receipt RECORDED, but the email failed
                {receipt.email.error ? ` (${receipt.email.error})` : ''} — the student was NOT
                emailed.
              </p>
            )}
            <p className="muted text-sm mt">
              This receipt can be verified by the School or your department using the number
              above.
            </p>
            <button className="btn btn-outline w-full mt" onClick={resetFlow}>
              <ArrowClockwise size={16} /> Record Another Payment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
