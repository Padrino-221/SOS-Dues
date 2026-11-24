import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { IconDownload as DownloadSimple, IconX as X, IconBuildings as Buildings, IconChartBar as ChartBar, IconFilter as Funnel, IconBackpack as Student, IconTrendingUp as TrendUp, IconCircleCheck as CheckCircle, IconAlertTriangle as Warning, IconChevronDown as CaretDown, IconChevronRight as CaretRight, IconReceipt as Receipt, IconCoins as Coins, IconCashBanknote as Money, IconDeviceMobile as DeviceMobile } from '@tabler/icons-react';
import DatePicker from '../components/ui/DatePicker';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';
import CourseRepCollections from '../components/CourseRepCollections';

const PAYMENTS_PAGE_SIZE = 10;
// Valid levels are fixed server-side too — the options stay stable even when a
// level currently has no data.
const LEVEL_OPTIONS = ['100', '200', '300', '400'];

// "for 19 Oct 2026", "for 19–23 Oct 2026", "for 19 Oct – 2 Nov 2026",
// "from …", "up to …" or "for all recorded collections" — states the exact
// period the totals cover, so a day-specific filter reads as a day.
function periodLabel(from, to) {
  const fmt = (s) =>
    new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (from && to) {
    if (from === to) return `for ${fmt(from)}`;
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    const sameMonth = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
    if (sameMonth) return `for ${f.getDate()}–${t.getDate()} ${fmt(to).replace(/^\d+\s/, '')}`;
    return `for ${fmt(from)} – ${fmt(to)}`;
  }
  if (from) return `from ${fmt(from)}`;
  if (to) return `up to ${fmt(to)}`;
  return 'for all recorded collections';
}

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <CheckCircle size={18} /> : <Warning size={18} />}
      {message}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const isSchool = user?.role === 'school_admin' || isSuper;
  // Department-collected amounts are hidden from the school admin only — the
  // super admin oversees both sides.
  const showDeptStats = !isSchool || isSuper;
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showUpdating, setShowUpdating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState([]);
  const loadSeq = useRef(0);
  const slowTimer = useRef(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [method, setMethod] = useState('');
  const [continuingOnly, setContinuingOnly] = useState(false);
  const [paymentsData, setPaymentsData] = useState({
    payments: [],
    total: 0,
    page: 1,
    pageSize: PAYMENTS_PAGE_SIZE,
  });
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [otherItems, setOtherItems] = useState(null);
  // Row-click breakdown popover: { title, rows: [{ label, value }], total }.
  const [detail, setDetail] = useState(null);
  // Item row click → department breakdown, fetched on open under the same
  // filters: itemDrill = the clicked row, itemDepts = null (loading) | rows,
  // itemDeptsError = fetch failure message.
  const [itemDrill, setItemDrill] = useState(null);
  const [itemDepts, setItemDepts] = useState(null);
  const [itemDeptsError, setItemDeptsError] = useState('');
  const itemDrillSeq = useRef(0);
  const [dlOpen, setDlOpen] = useState(false);
  const dlRef = useRef(null);
  const deptPager = usePagination(data?.departments || [], 10);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  // The server applies the level / department / method filters, so the level
  // rows arrive already scoped — no client-side filtering needed any more.
  const filteredLevels = data?.levels || [];
  const levelPager = usePagination(filteredLevels, 10);

  const [academicYear, setAcademicYear] = useState('');
  const [activeAcademicYear, setActiveAcademicYear] = useState('');
  const buildParams = useCallback(() => {
    const params = {};
    if (continuingOnly) params.cohort = 'continuing';
    if (from) params.from = from;
    if (to) params.to = to;
    if (academicYear) params.academic_year = academicYear;
    if (selectedLevel) params.level = selectedLevel;
    if (method) params.method = method;
    // Only the school admin may pick a department — the server force-scopes a
    // department admin to their own department regardless of this parameter.
    if (isSchool && selectedDeptId) params.department_id = selectedDeptId;
    return params;
  }, [from, to, academicYear, selectedLevel, method, selectedDeptId, isSchool, continuingOnly]);

  // A reversed date range can never match anything — surface it clearly and
  // skip the request rather than showing silent zeros.
  const rangeError =
    from && to && from > to ? 'The "from" date must be on or before the "to" date.' : '';

  const loadAll = useCallback(async () => {
    if (from && to && from > to) return;
    const params = buildParams();
    const run = ++loadSeq.current;
    setRefreshing(true);
    setLoadError('');
    try {
      // Keep showing the current data while refetching (no page blink).
      const [s, pay, oi] = await Promise.all([
        api.get('/reports/summary', { params }),
        api.get(continuingOnly ? '/reports/course-reps' : '/reports/payments', {
          params: { ...params, page: paymentsPage, limit: PAYMENTS_PAGE_SIZE },
        }),
        api.get('/reports/other-items', { params }),
      ]);
      if (run === loadSeq.current) {
        setData(s.data);
        setPaymentsData(pay.data);
        setOtherItems(oi.data);
      }
    } catch (err) {
      setLoadError('Reports could not be updated. Check your connection and try again.');
    } finally {
      if (run === loadSeq.current) setRefreshing(false);
    }
  }, [buildParams, from, to, paymentsPage, continuingOnly]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // A new filter set restarts the payment list at page 1.
  useEffect(() => {
    setPaymentsPage(1);
  }, [from, to, academicYear, selectedLevel, method, selectedDeptId, continuingOnly]);

  useEffect(() => {
    api
      .get('/settings')
      .then((res) => {
        const activeYear = res.data?.active_academic_year || '';
        setActiveAcademicYear(activeYear);
        setAcademicYear((current) => current || activeYear);
      })
      .catch(() => {});
  }, []);

  // Close the "Download report" menu when clicking anywhere outside it.
  useEffect(() => {
    if (!dlOpen) return undefined;
    const onDown = (e) => {
      if (dlRef.current && !dlRef.current.contains(e.target)) setDlOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dlOpen]);

  // Only surface the "Updating…" notice when a refresh is genuinely slow —
  // fast local refetches should swap data silently with no flicker.
  useEffect(() => {
    if (refreshing) {
      slowTimer.current = setTimeout(() => setShowUpdating(true), 350);
    } else {
      setShowUpdating(false);
    }
    return () => clearTimeout(slowTimer.current);
  }, [refreshing]);

  const clearDates = () => {
    setFrom('');
    setTo('');
  };

  const clearAcademicYear = () => setAcademicYear('');

  // One download menu: CSV or PDF, both generated server-side from the same
  // filters — the server's filename carries the filtered report's name.
  const downloadReport = async (format) => {
    if (exporting) return;
    if (rangeError) {
      addToast(rangeError, 'error');
      setDlOpen(false);
      return;
    }
    setExporting(true);
    try {
      const params = buildParams();
      const res = await api.get(format === 'pdf' ? '/reports/export.pdf' : '/reports/export', {
        params,
        responseType: 'arraybuffer',
      });
      const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8';
      const blob = new Blob([res.data], { type: contentType });
      if (blob.size === 0) {
        throw new Error(
          `The report response was empty (HTTP ${res.status}, ${res.headers?.['content-type'] || 'unknown content type'}).`
        );
      }
      const cd = res.headers?.['content-disposition'] || '';
      const match = cd.match(/filename="?([^";]+)"?/);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : `dues-report.${format}`;
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        a.remove();
        window.URL.revokeObjectURL(url);
      }, 60000);
    } catch (err) {
      console.error('Report download failed', {
        message: err.message,
        code: err.code,
        status: err.response?.status,
        url: err.config?.url,
      });
      let message = `Report download failed: ${err.message || err.code || 'unknown browser or network error'}`;
      const responseData = err.response?.data;
      if (responseData instanceof Blob) {
        const text = await responseData.text();
        try {
          const body = JSON.parse(text);
          message = body.error || body.message || message;
        } catch {
          if (text.trim()) message = text.trim().slice(0, 180);
        }
      } else if (responseData?.error) {
        message = responseData.error;
      } else if (err.code === 'ECONNABORTED') {
        message = 'Report download timed out (20 seconds).';
      } else if (err.response?.status) {
        message = `Report download failed (HTTP ${err.response.status}${err.response.statusText ? ` ${err.response.statusText}` : ''}).`;
      }
      addToast(message, 'error');
    } finally {
      setExporting(false);
      setDlOpen(false);
    }
  };

  if (!data)
    return (
      <div className="page-state">
        <span className="spin-dot" /> {loadError || 'Loading reports…'}{' '}
        {loadError && (
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        )}
      </div>
    );
  const t = data.totals;
  const hasFilter = Boolean(
    from || to || academicYear || selectedLevel || method || selectedDeptId || continuingOnly
  );
  // The school admin's totals cover school money only — department-collected
  // amounts (dept dues + dept items) stay with the department admin.
  const totalCollected = showDeptStats
    ? Number(t.department_dues || 0) +
      Number(t.school_dues || 0) +
      Number(t.school_dues_through_dept || 0) +
      Number(t.other_dues || 0)
    : Number(t.school_dues || 0) + Number(t.school_other_dues || 0);
  const paymentsRows = paymentsData?.payments || [];
  // Department totals span every department in the filtered set — not just the
  // rows on the current pagination page.
  const deptRows = data?.departments || [];
  const deptTotals = deptRows.reduce(
    (acc, d) => ({
      deptDues: acc.deptDues + Number(d.department_dues_collected || 0),
      schoolDues: acc.schoolDues + Number(d.school_dues_through_dept || 0),
      otherSchool: acc.otherSchool + Number(d.school_other_dues_collected || 0),
      otherDept: acc.otherDept + Number(d.dept_other_dues_collected || 0),
    }),
    { deptDues: 0, schoolDues: 0, otherSchool: 0, otherDept: 0 }
  );
  // The Total column's money: the same four buckets every row click breaks
  // down in the modal.
  const deptGrandTotal =
    deptTotals.deptDues + deptTotals.schoolDues + deptTotals.otherSchool + deptTotals.otherDept;
  // The school admin sees only school-wide items here — department-item
  // collections belong to the department admin.
  const otherItemRows = (otherItems?.items || []).filter(
    (it) => showDeptStats || it.scope === 'school'
  );
  // The categories that add up to a row's Total, shown in the click-through
  // breakdown modal — all four, for every role.
  const deptBreakdown = (d) => [
    { label: 'School Dues', value: Number(d.school_dues_through_dept || 0) },
    { label: 'School Other Dues', value: Number(d.school_other_dues_collected || 0) },
    { label: 'Department Dues', value: Number(d.department_dues_collected || 0) },
    { label: 'Department Other Dues', value: Number(d.dept_other_dues_collected || 0) },
  ];
  const levelBreakdown = (lv) => [
    { label: 'School Dues', value: Number(lv.school_dues_collected || 0) },
    { label: 'School Other Dues', value: Number(lv.school_other_dues_collected || 0) },
    { label: 'Department Dues', value: Number(lv.dept_dues_collected || 0) },
    { label: 'Department Other Dues', value: Number(lv.dept_other_dues_collected || 0) },
  ];
  const openBreakdown = (title, rows) =>
    setDetail({ title, rows, total: rows.reduce((s, r) => s + r.value, 0) });
  // Each item row drills into its department breakdown — fetched fresh when
  // the modal opens so it always matches the filters on screen. The seq guard
  // drops a response that arrives after the modal was closed or re-opened.
  const openItemDrill = (it) => {
    const run = ++itemDrillSeq.current;
    setItemDrill(it);
    setItemDepts(null);
    setItemDeptsError('');
    api
      .get('/reports/other-items/departments', { params: { ...buildParams(), item: it.item } })
      .then((res) => {
        if (run === itemDrillSeq.current) setItemDepts(res.data?.departments || []);
      })
      .catch(() => {
        if (run === itemDrillSeq.current) {
          setItemDeptsError('The department breakdown could not be loaded. Close and try again.');
        }
      });
  };
  const closeItemDrill = () => {
    itemDrillSeq.current += 1; // drop any in-flight fetch
    setItemDrill(null);
    setItemDepts(null);
    setItemDeptsError('');
  };
  // Filters are active and nothing survived them — say so instead of showing
  // an all-zero table that reads like a permanent "no data" state.
  const noMatches = hasFilter && totalCollected === 0 && paymentsRows.length === 0;

  const academicYearOptions = activeAcademicYear
    ? [{ value: activeAcademicYear, label: activeAcademicYear }]
    : [];

  return (
    <div className="reports-page">
      <style>{`
        @media (max-width: 640px) { .hide-sm { display: none; } }
      `}</style>
      <div className="toast-container">
        {toasts.map((item) => (
          <Toast
            key={item.id}
            message={item.message}
            type={item.type}
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== item.id))}
          />
        ))}
      </div>
      {loadError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {loadError}{' '}
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        </div>
      )}

      {showUpdating && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <span className="spin-dot" /> Updating…
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>{continuingOnly ? 'Continuing Student Reports' : isSchool ? 'Reports' : 'Department Reports'}</h1>
          <p className="subtitle">
            {continuingOnly ? 'Collections from students at Levels 200–400, including payments for earlier levels.' : isSchool
              ? 'Collection overview across all departments.'
              : `Collection overview for ${user?.department_name}.`}
          </p>
        </div>
        <div className="reports-actions">
          <button type="button" className={`btn ${continuingOnly ? 'btn-primary' : 'btn-outline'}`} aria-pressed={continuingOnly}
            onClick={() => {
              setContinuingOnly(current => !current);
              setData(null);
              setLoadError('');
              setPaymentsPage(1);
              setDetail(null);
              closeItemDrill();
              setDlOpen(false);
            }}>
            <Student size={18} /> {continuingOnly ? 'Show all students' : 'Continuing students'}
          </button>
        <div ref={dlRef} style={{ position: 'relative' }}>
          <button
            className="btn btn-primary"
            onClick={() => setDlOpen((o) => !o)}
            disabled={exporting}
          >
            <DownloadSimple size={18} />
            {exporting ? 'Preparing…' : 'Download report'}
            <CaretDown size={14} />
          </button>
          {dlOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 6,
                zIndex: 70,
                minWidth: 200,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
              }}
            >
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', borderRadius: 0, justifyContent: 'flex-start' }}
                onClick={() => downloadReport('csv')}
              >
                CSV (Excel)
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', borderRadius: 0, justifyContent: 'flex-start' }}
                onClick={() => downloadReport('pdf')}
              >
                PDF
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="flex gap align-center" style={{ flexWrap: 'wrap' }}>
          <Funnel size={16} style={{ color: 'var(--gold)' }} />
          <div className="field" style={{ marginBottom: 0, width: 180 }}>
            <Select
              value={academicYear}
              onChange={setAcademicYear}
              options={[{ value: '', label: 'All academic years' }, ...academicYearOptions]}
              placeholder="All years"
            />
          </div>
          {academicYear && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearAcademicYear}
              title="Clear the academic year filter only"
            >
              <X size={14} /> Clear year
            </button>
          )}
          {isSchool && (data?.departments || []).length > 0 && (
            <div className="field" style={{ marginBottom: 0, width: 180 }}>
              <Select
                value={selectedDeptId}
                onChange={(val) => {
                  setSelectedDeptId(val);
                  levelPager.setPage(1);
                }}
                options={[
                  { value: '', label: 'All departments' },
                  ...(data?.departments || []).map((d) => ({
                    value: String(d.id),
                    label: d.name,
                  })),
                ]}
                placeholder="All departments"
              />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0, width: 150 }}>
            <Select
              value={selectedLevel}
              onChange={(val) => {
                setSelectedLevel(val);
                levelPager.setPage(1);
              }}
              options={[
                { value: '', label: 'All levels' },
                ...LEVEL_OPTIONS.map((l) => ({ value: l, label: `Level ${l}` })),
              ]}
              placeholder="All levels"
            />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 175 }}>
            <Select
              value={method}
              onChange={(val) => {
                setMethod(val);
                levelPager.setPage(1);
              }}
              options={[
                { value: '', label: 'All methods' },
                { value: 'cash', label: 'Cash' },
                { value: 'momo', label: 'Mobile Money' },
              ]}
              placeholder="All methods"
            />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 155 }}>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <span style={{ color: 'var(--gray-400)', fontWeight: 700, fontSize: 11 }}>to</span>
          <div className="field" style={{ marginBottom: 0, width: 155 }}>
            <DatePicker value={to} onChange={setTo} />
          </div>
          {(from || to) && (
            <button className="btn btn-ghost btn-sm" onClick={clearDates}>
              <X size={14} /> Clear dates
            </button>
          )}
        </div>
      </div>

      {rangeError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <Warning size={16} /> {rangeError}
        </div>
      )}

      {noMatches && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Funnel size={16} /> No payments match these filters. Try clearing a filter or widening
          the date range.
        </div>
      )}

      {/* ─── Collection Summary: exact totals for the selected from/to period ─── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>
            <Money size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Collection Summary
          </h3>
          <span className="muted text-sm">{periodLabel(from, to)}</span>
        </div>
        <div className="rc-stats">
          {/* Continuing-student view: the school only cares about School Dues —
              dept dues, other-dues buckets and the grand total are hidden. */}
          {showDeptStats && !continuingOnly && (
            <div className="rc-stat-card rc-stat-card--navy">
              <div className="rc-stat-icon">
                <ChartBar size={20} />
              </div>
              <div className="rc-stat-body">
                <div className="rc-stat-value">GHS {Number(t.department_dues || 0).toFixed(2)}</div>
                <div className="rc-stat-label">Dept Dues</div>
              </div>
            </div>
          )}
          <div className="rc-stat-card rc-stat-card--gold">
            <div className="rc-stat-icon">
              <ChartBar size={20} />
            </div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS{' '}
                {(Number(t.school_dues || 0) + Number(t.school_dues_through_dept || 0)).toFixed(2)}
              </div>
              <div className="rc-stat-label">
                {isSchool ? 'School Dues' : 'School Dues (via dept)'}
              </div>
            </div>
          </div>
          {!continuingOnly && (
            <div className="rc-stat-card rc-stat-card--violet">
              <div className="rc-stat-icon">
                <Coins size={20} />
              </div>
              <div className="rc-stat-body">
                <div className="rc-stat-value">GHS {Number(t.school_other_dues || 0).toFixed(2)}</div>
                <div className="rc-stat-label">School Other Dues</div>
              </div>
            </div>
          )}
          {showDeptStats && !continuingOnly && (
            <div className="rc-stat-card rc-stat-card--violet">
              <div className="rc-stat-icon">
                <Coins size={20} />
              </div>
              <div className="rc-stat-body">
                <div className="rc-stat-value">GHS {Number(t.dept_other_dues || 0).toFixed(2)}</div>
                <div className="rc-stat-label">Dept Other Dues</div>
              </div>
            </div>
          )}
          {!continuingOnly && (
            <div className="rc-stat-card rc-stat-card--green">
              <div className="rc-stat-icon">
                <TrendUp size={20} />
              </div>
              <div className="rc-stat-body">
                <div className="rc-stat-value">GHS {totalCollected.toFixed(2)}</div>
                <div className="rc-stat-label">Total Collected</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Other Dues by Item: school-wide vs department charges ─── */}
      {!continuingOnly && (
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>
            <Coins size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Other Dues by Item
          </h3>
        </div>
        {otherItems === null ? (
          <div className="muted" style={{ padding: '10px 20px 16px' }}>
            Loading…
          </div>
        ) : otherItemRows.length === 0 ? (
          <div className="muted" style={{ padding: '10px 20px 16px' }}>
            {showDeptStats
              ? 'No other-dues collections match these filters.'
              : 'No school-wide other-dues collections match these filters.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Scope</th>
                  <th>Times</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {otherItemRows.map((it) => (
                  <tr
                    key={`${it.scope}-${it.item}`}
                    className="row-click"
                    title="View department breakdown"
                    onClick={() => openItemDrill(it)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openItemDrill(it);
                      }
                    }}
                  >
                    <td className="fw-600">{it.item}</td>
                    <td>
                      <span
                        className={`badge ${it.scope === 'school' ? 'badge-gold' : 'badge-navy'}`}
                      >
                        {it.scope === 'school' ? 'School-Wide' : 'Department'}
                      </span>
                    </td>
                    <td>{Number(it.times)}</td>
                    <td className="fw-600">
                      GHS {Number(it.amount).toFixed(2)}
                      <CaretRight
                        size={11}
                        className="muted"
                        style={{ marginLeft: 4, verticalAlign: 'middle' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-600">
                  <td>Total</td>
                  <td />
                  <td>{otherItemRows.reduce((s, it) => s + Number(it.times || 0), 0)}</td>
                  <td>
                    GHS {otherItemRows.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ─── Payment Channels: cash vs mobile money for the current filters ─── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>
            <Coins size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Payment Channels
          </h3>
        </div>
        <div className="rc-stats">
          <div className="rc-stat-card rc-stat-card--green">
            <div className="rc-stat-icon">
              <Money size={20} />
            </div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS {Number(data.by_method?.cash || 0).toFixed(2)}
              </div>
              <div className="rc-stat-label">Cash</div>
            </div>
          </div>
          <div className="rc-stat-card rc-stat-card--navy">
            <div className="rc-stat-icon">
              <DeviceMobile size={20} />
            </div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS {Number(data.by_method?.momo || 0).toFixed(2)}
              </div>
              <div className="rc-stat-label">Mobile Money</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Department Breakdown ─── */}
      <div className="card">
        <div className="card-header">
          <h3>
            <Buildings size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            {isSuper
              ? 'Dues by Department'
              : isSchool
                ? 'School Collections by Department'
                : 'Department Detail'}
          </h3>
        </div>
        {data?.headcounts && (
          <p className="muted">
            Current roster: <strong>{data.headcounts.registered}</strong>
            {' · '}Students with a payment: <strong>{data.headcounts.payers}</strong>
            {' · '}Students who paid school dues: <strong>{data.headcounts.school_dues_payers}</strong>
            {data.headcounts.unmatched_receipts > 0 && (
              <> · Receipts to match to the roster: <strong>{data.headcounts.unmatched_receipts}</strong></>
            )}
            <br />
            Payment filters apply to payer counts. Students are counted under their current roster
            department. Amounts are grouped by the department credited on the transaction.
          </p>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Roster payers</th>
                <th>Amount collected</th>
              </tr>
            </thead>
            <tbody>
              {deptRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No departments yet.
                  </td>
                </tr>
              )}
              {deptPager.slice.map((d) => {
                const rows = deptBreakdown(d);
                const total = rows.reduce((s, r) => s + r.value, 0);
                return (
                  <tr
                    key={d.id}
                    className="row-click"
                    title="Click for the full breakdown"
                    onClick={() => openBreakdown(d.name, rows)}
                  >
                    <td className="fw-600">{d.name}</td>
                    <td>{d.payers}</td>
                    <td className="fw-600">
                      GHS {total.toFixed(2)}
                      <CaretRight
                        size={11}
                        className="muted"
                        style={{ marginLeft: 4, verticalAlign: 'middle' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {deptRows.length > 0 && (
              <tfoot>
                <tr className="fw-600">
                  <td style={{ borderTop: '2px solid var(--gray-200)' }}>
                    Total ({deptRows.length} department{deptRows.length === 1 ? '' : 's'})
                  </td>
                  <td style={{ borderTop: '2px solid var(--gray-200)' }}>{data?.headcounts?.payers ?? '—'}</td>
                  <td style={{ borderTop: '2px solid var(--gray-200)' }}>
                    GHS {deptGrandTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination
          page={deptPager.page}
          totalPages={deptPager.totalPages}
          onPageChange={deptPager.setPage}
          totalItems={deptPager.totalItems}
          pageSize={deptPager.perPage}
        />
      </div>

      {/* ─── Level Breakdown (filters live in the top bar above) ─── */}
      <div className="card">
        <div className="card-header">
          <h3>
            <Student size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Level Breakdown
          </h3>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Department</th>
                <th>Receipt payers</th>
                <th>Total amount</th>
              </tr>
            </thead>
            <tbody>
              {levelPager.slice.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {selectedLevel
                      ? 'No dues collections found for the selected level.'
                      : selectedDeptId
                        ? 'No dues collections found for the selected department.'
                        : 'No dues collections yet.'}
                  </td>
                </tr>
              )}
              {levelPager.slice.map((lv) => {
                const rows = levelBreakdown(lv);
                const total = rows.reduce((s, r) => s + r.value, 0);
                return (
                  <tr
                    key={`${lv.department_id}-${lv.level}`}
                    className="row-click"
                    title="Click for the full breakdown"
                    onClick={() =>
                      openBreakdown(`Level ${lv.level || '-'} · ${lv.department_name}`, rows)
                    }
                  >
                    <td className="fw-600">Level {lv.level || '-'}</td>
                    <td>{lv.department_name}</td>
                    <td>{lv.payers}</td>
                    <td className="fw-600">
                      GHS {total.toFixed(2)}
                      <CaretRight
                        size={11}
                        className="muted"
                        style={{ marginLeft: 4, verticalAlign: 'middle' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={levelPager.page}
          totalPages={levelPager.totalPages}
          onPageChange={levelPager.setPage}
          totalItems={levelPager.totalItems}
          pageSize={levelPager.perPage}
        />
      </div>

      {/* ─── Payments: one row per receipt — same five columns as the downloads ─── */}
      {continuingOnly ? <CourseRepCollections data={paymentsData} onPageChange={setPaymentsPage}/> : <div className="card" style={{ marginTop: 24 }}>
        <div
          className="card-header flex align-center justify-between"
          style={{ flexWrap: 'wrap', gap: 12 }}
        >
          <h3>
            <Receipt size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Payments
          </h3>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Reference</th>
                <th>Programme</th>
                <th>Amount</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {paymentsRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No payments match these filters.
                  </td>
                </tr>
              )}
              {paymentsRows.map((p, i) => (
                <tr key={`${p.reference || 'row'}-${i}`}>
                  <td className="fw-600">{p.name || '—'}</td>
                  <td>{p.reference || '—'}</td>
                  <td>{p.programme || '—'}</td>
                  <td className="fw-600">GHS {Number(p.amount || 0).toFixed(2)}</td>
                  <td>{p.date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={paymentsData?.page || 1}
          totalPages={Math.max(
            1,
            Math.ceil((paymentsData?.total || 0) / (paymentsData?.pageSize || PAYMENTS_PAGE_SIZE))
          )}
          onPageChange={setPaymentsPage}
          totalItems={paymentsData?.total || 0}
          pageSize={paymentsData?.pageSize || PAYMENTS_PAGE_SIZE}
        />
      </div>

      }
      {/* ─── Breakdown modal: the categories behind a clicked row's total ─── */}
      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={detail.title}
          subtitle="Collection breakdown"
          icon={<Coins size={20} />}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {detail.rows.map((r) => (
              <div key={r.label} className="flex" style={{ justifyContent: 'space-between' }}>
                <span>{r.label}</span>
                <span className="fw-600">GHS {r.value.toFixed(2)}</span>
              </div>
            ))}
            <div
              className="flex"
              style={{
                justifyContent: 'space-between',
                borderTop: '2px solid var(--gray-200)',
                paddingTop: 12,
              }}
            >
              <span className="fw-600">Total</span>
              <span className="fw-600">GHS {detail.total.toFixed(2)}</span>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Item drill-down: one item's money by collecting department ─── */}
      {itemDrill && (
        <Modal
          open
          onClose={closeItemDrill}
          title={`${itemDrill.item} — by department`}
          subtitle={`${itemDrill.scope === 'school' ? 'School-Wide' : 'Department'} · ${
            Number(itemDrill.times) || 0
          } times · GHS ${(Number(itemDrill.amount) || 0).toFixed(2)} · under the current filters`}
          icon={<Coins size={20} />}
        >
          {itemDeptsError ? (
            <div className="muted">{itemDeptsError}</div>
          ) : itemDepts === null ? (
            <div className="muted">Loading department breakdown…</div>
          ) : itemDepts.length === 0 ? (
            <div className="muted">No collections for this item match the current filters.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Times</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {itemDepts.map((d) => (
                    <tr key={d.department}>
                      <td className="fw-600">{d.department}</td>
                      <td>{Number(d.times)}</td>
                      <td className="fw-600">GHS {Number(d.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="fw-600">
                    <td>Total</td>
                    <td>{itemDepts.reduce((s, d) => s + Number(d.times || 0), 0)}</td>
                    <td>
                      GHS {itemDepts.reduce((s, d) => s + Number(d.amount || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
