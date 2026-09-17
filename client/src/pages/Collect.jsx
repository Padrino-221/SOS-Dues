import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  HandCoins,
  CheckCircle,
  Warning,
  MagnifyingGlass,
  CurrencyCircleDollar,
  ArrowClockwise,
  UserCircle,
  CalendarBlank,
  CreditCard,
  ArrowRight,
  SealCheck,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import DatePicker from '../components/ui/DatePicker';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';

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

const outstanding = (paid, required) =>
  Math.max(Number(required || 0) - Number(paid || 0), 0);

export default function Collect() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const preSelected = params.get('student');

  const [schoolDues, setSchoolDues] = useState('');
  const [deptDues, setDeptDues] = useState('');
  const [activeYear, setActiveYear] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const resultsPager = usePagination(results, 8);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchRequest = useRef(0);
  const [student, setStudent] = useState(null);
  const [payment, setPayment] = useState({
    method: 'cash',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [toasts, setToasts] = useState([]);

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
        setAcademicYear(ay);
        setSchoolDues(res.data?.school_dues_amount || '');
        setPayment((p) => ({ ...p, school_dues: res.data?.school_dues_amount || '' }));
      })
      .catch(() => {});
    api
      .get('/departments')
      .then((res) => {
        const mine = res.data?.[0];
        setDeptDues(String(mine?.dues_amount || ''));
        setPayment((p) => ({ ...p, department_dues: String(mine?.dues_amount || '') }));
      })
      .catch(() => {});
  }, []);

  // Preselect student if navigated with ?student=ID
  useEffect(() => {
    if (preSelected) {
      api
        .get(`/students/${preSelected}`)
        .then((res) => setStudent(res.data))
        .catch(() => {});
    }
  }, [preSelected]);

  const doSearch = (e) => {
    if (e) e.preventDefault();
    const term = search.trim();
    if (term.length < 2) {
      setSearchError(term ? 'Type at least 2 characters to search.' : '');
      setResults([]);
      setSearched(false);
      return;
    }
    setSearchError('');
    setSearching(true);
    const requestId = ++searchRequest.current;
    api
      .get('/students', { params: { search: term, is_fresher: 'false' } })
      .then((res) => {
        if (requestId !== searchRequest.current) return;
        setResults(res.data);
        resultsPager.setPage(1);
        setSearched(true);
      })
      .catch(() => {
        if (requestId !== searchRequest.current) return;
        setResults([]);
        resultsPager.setPage(1);
        setSearched(true);
      })
      .finally(() => {
        if (requestId === searchRequest.current) setSearching(false);
      });
  };

  // Search as the collector types, with a short delay to avoid a request per keystroke.
  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setResults([]);
      setSearched(false);
      setSearchError('');
      setSearching(false);
      return undefined;
    }
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      setSearchError('Type at least 2 characters to search.');
      return undefined;
    }
    const timer = setTimeout(() => doSearch(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const pick = (s) => {
    setStudent(s);
    setResults([]);
    setSearch('');
    setReceipt(null);
    setPayment((p) => ({
      ...p,
      school_dues:
        s.school_dues_paid_amount !== undefined
          ? String(outstanding(s.school_dues_paid_amount, s.school_dues_required))
          : schoolDues,
      department_dues:
        s.dept_dues_paid_amount !== undefined
          ? String(outstanding(s.dept_dues_paid_amount, s.dept_dues_required))
          : deptDues,
      method: 'cash',
      paid_at: new Date().toISOString().slice(0, 10),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!student) return;
    setSaving(true);
    setReceipt(null);
    try {
      const items = [];
      if (Number(payment.school_dues) > 0)
        items.push({ type: 'school_dues', amount: Number(payment.school_dues) });
      if (Number(payment.department_dues) > 0)
        items.push({ type: 'department_dues', amount: Number(payment.department_dues) });
      if (items.length === 0) {
        addToast('Enter at least one amount.', 'error');
        setSaving(false);
        return;
      }
      const res = await api.post('/receipts', {
        student_id: student.id,
        method: payment.method,
        paid_at: payment.paid_at || undefined,
        academic_year: academicYear || undefined,
        items,
      });
      setReceipt(res.data);
      addToast(`Payment recorded — Receipt ${res.data.receipt_number}`);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to record payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isFresher = student?.is_fresher;

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
            Find a student, confirm their dues, and issue one verified receipt.
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

      {student && (
        <div className="collect-student-bar">
          <div className="collect-student-avatar">
            <UserCircle size={25} />
          </div>
          <div className="collect-student-copy">
            <span className="collect-kicker">Selected student</span>
            <strong>{student.name}</strong>
            <span>
              {student.student_no || 'No student number'} · {student.class_name || 'No class'} ·{' '}
              {student.department_name}
            </span>
          </div>
          <span className={`badge ${isFresher ? 'badge-gold' : 'badge-navy'}`}>
            {isFresher ? 'Fresher' : 'Continuing'}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setStudent(null);
              setReceipt(null);
            }}
          >
            <ArrowClockwise size={15} /> Change
          </button>
        </div>
      )}

      <div className="collect-layout">
        {/* ─── Pick student ─── */}
        <section className="collect-search-panel">
          <div className="collect-step">
            <span>01</span>
            <span>Student lookup</span>
          </div>
          <h2>Who is paying?</h2>
          <p className="muted text-sm">
            Search by name or student number to load the correct dues profile.
          </p>
          <form onSubmit={doSearch}>
            <div className="collect-search-box">
              <input
                className="input"
                placeholder="Search name or student number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search by student name or number"
                aria-invalid={Boolean(searchError)}
              />
              <button
                className="btn btn-primary"
                aria-label="Search students"
                disabled={searching || search.trim().length < 2}
              >
                <MagnifyingGlass size={18} /> {searching ? 'Searching' : 'Search'}
              </button>
            </div>
          </form>
          {searchError && (
            <div className="collect-search-validation">
              <Warning size={15} /> {searchError}
            </div>
          )}
          {searching && (
            <div className="collect-search-status">
              <span className="spin-dot" /> Searching student records...
            </div>
          )}

          {searched && results.length === 0 && (
            <p className="collect-empty muted text-sm">
              <Warning size={18} />
              No continuing students found. If this is a fresher, admit them under{' '}
              <strong>Admit Freshers</strong> first.
            </p>
          )}
          {results.length > 0 && (
            <>
              <div className="collect-results mt">
                <div className="collect-results-head">
                  <span>Matches</span>
                  <span>{results.length} found</span>
                </div>
                <table className="table">
                  <tbody>
                    {resultsPager.slice.map((s) => (
                      <tr key={s.id} className="collect-result-row" onClick={() => pick(s)}>
                        <td>
                          <span className="collect-result-avatar">
                            {s.name?.charAt(0)?.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <strong>{s.name}</strong>
                          <small>{s.student_no || 'No student number'}</small>
                        </td>
                        <td>{s.class_name || '-'}</td>
                        <td>
                          <ArrowRight size={17} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={resultsPager.page}
                totalPages={resultsPager.totalPages}
                onPageChange={resultsPager.setPage}
                totalItems={resultsPager.totalItems}
                pageSize={resultsPager.perPage}
              />
            </>
          )}

          {!student && !searched && results.length === 0 && (
            <div className="collect-search-empty">
              <div className="collect-empty-icon">
                <MagnifyingGlass size={26} />
              </div>
              <strong>Start with a student search</strong>
              <span>
                Results will appear here so you can select the right account before collecting.
              </span>
            </div>
          )}
        </section>

        {/* ─── Record payment ─── */}
        <section className="collect-payment-panel">
          <div className="collect-step">
            <span>02</span>
            <span>Payment details</span>
          </div>
          <h2>Record collection</h2>
          {!student ? (
            <div className="collect-payment-empty">
              <UserCircle size={34} />
              <span>Select a student to unlock the payment form.</span>
            </div>
          ) : receipt ? (
            <div className="collect-success">
              <div className="collect-success-icon">
                <SealCheck size={34} />
              </div>
              <span className="collect-kicker">Payment recorded</span>
              <h3>Receipt ready</h3>
              <div className="receipt-box">
                <div className="receipt-label">One combined receipt</div>
                <div className="receipt-number">{receipt.receipt_number}</div>
                <div className="receipt-amount">GHS {Number(receipt.total_amount).toFixed(2)}</div>
              </div>
              <div className="collect-lines">
                <table className="table">
                  <tbody>
                    {receipt.lines.map((l) => (
                      <tr key={l.type}>
                        <td>{l.type === 'school_dues' ? 'School Dues' : 'Department Dues'}</td>
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
              <p className="muted text-sm mt">
                This receipt can be verified by the School or your department using the number
                above.
              </p>
              <button
                className="btn btn-outline w-full mt"
                onClick={() => {
                  setReceipt(null);
                  setStudent(null);
                }}
              >
                <ArrowClockwise size={16} /> Record Another Payment
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="collect-form">
              <div className="collect-form-note">
                <CalendarBlank size={18} />
                <span>
                  Record School and Department dues together, or record either outstanding dues
                  separately. Partial payments (installments) are allowed — the balance updates
                  automatically.
                </span>
              </div>
              <div className="field">
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
              </div>
              <div className="field">
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
              </div>
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
              <button className="btn btn-green w-full mt" disabled={saving}>
                <HandCoins size={18} /> {saving ? 'Recording...' : 'Record Payment & Issue Receipt'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
