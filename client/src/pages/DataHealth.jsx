import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import StudentDetailsModal from '../components/ui/StudentDetailsModal';
import {
  IconCircleCheck as CheckCircle,
  IconAlertTriangle as Warning,
  IconRefresh as ArrowsClockwise,
  IconPuzzle as PuzzlePiece,
  IconReceipt as Receipt,
  IconUsers as Users,
} from '@tabler/icons-react';

// School-side data integrity sweep — the desk-lead "the figures look off"
// page. Mirrors GET /api/reports/discrepancies (school_admin / super_admin
// only):
//   1. students with SOME school-wide Other Dues this academic year but not
//      all of them (the "cloth without exercise book" pattern, generalized
//      to whatever school-wide items exist);
//   2. receipts whose active payment lines don't sum to the stored total;
//   3. fresher applications sharing a student number.
// Lists are capped server-side; the counts are always exact.

function HealthCard({ Icon, color, title, desc, count, rowsShown, children }) {
  const clean = count === 0;
  return (
    <div className="card mb">
      <div className="flex gap-sm" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <div className={`stat-icon-badge ${color}`}>
          <Icon size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="fw-600">{title}</div>
          <p className="muted text-sm" style={{ marginTop: 2 }}>
            {desc}
          </p>
        </div>
        <span
          className={`badge ${clean ? 'badge-green' : 'badge-red'}`}
          style={{ fontWeight: 600 }}
        >
          {clean ? (
            <>
              <CheckCircle size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> All clear
            </>
          ) : (
            `${count} flagged`
          )}
        </span>
      </div>
      {!clean && (
        <div style={{ marginTop: 14 }}>
          {count > rowsShown && (
            <p className="muted text-xs mb-sm">
              Showing the first {rowsShown} of {count} — fix these, then re-run the check.
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export default function DataHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/discrepancies');
      setData(res.data);
      setLastRun(new Date());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run the data health checks.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Click a student: open their record with the Other Dues editor ───
  // The flagged row only carries the sweep's fields — fetch the full student
  // (GET /students/:id, school-side unrestricted) so the details modal shows
  // complete info, with the check/uncheck Other Dues editor at the bottom.
  const [details, setDetails] = useState(null);
  const [openingId, setOpeningId] = useState(null);

  const openStudent = async (id) => {
    if (openingId !== null) return; // one record at a time (was the button's disabled state)
    setOpeningId(id);
    try {
      const res = await api.get(`/students/${id}`);
      setDetails(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load that student record.');
    } finally {
      setOpeningId(null);
    }
  };

  const partial = data?.partial_extras;
  const mismatch = data?.total_mismatch;
  const dups = data?.duplicate_applications;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Data Health</h1>
          <p className="subtitle">
            Read-only integrity checks across Other Dues, receipts and pre-registrations.
            {lastRun && ` Last run ${lastRun.toLocaleTimeString()}.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => load(true)} disabled={refreshing}>
          <ArrowsClockwise size={18} /> {refreshing ? 'Running…' : 'Re-run checks'}
        </button>
      </div>

      {error && <div className="alert alert-error mb-lg">{error}</div>}

      {loading && !data && <p className="muted">Running checks…</p>}

      {data && (
        <>
          {/* ─── 1. Partial school-wide Other Dues ─── */}
          <HealthCard
            Icon={PuzzlePiece}
            color="gold"
            title="Incomplete Other Dues"
            desc={`Students who paid some school-wide items this year but not all of (${
              partial?.items?.join(', ') || 'none active'
            }) — e.g. cloth without the exercise book. Gendered items count only for the
            students they apply to. Click a student to open their record.`}
            count={partial?.count ?? 0}
            rowsShown={partial?.rows?.length ?? 0}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Index No</th>
                    <th>Department</th>
                    <th>Paid</th>
                    <th>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {(partial?.rows || []).map((r) => (
                    <tr
                      key={r.student_id}
                      className="row-click"
                      title="Open student record"
                      onClick={() => openStudent(r.student_id)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openStudent(r.student_id);
                        }
                      }}
                    >
                      <td className="fw-600">{openingId === r.student_id ? 'Opening…' : r.name}</td>
                      <td>{r.student_no || '—'}</td>
                      <td>{r.department_name || '—'}</td>
                      <td className="muted text-sm">{(r.has || []).join(', ')}</td>
                      <td>
                        <span className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                          {(r.missing || []).map((m) => (
                            <span key={m} className="badge badge-red">
                              {m}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HealthCard>

          {/* ─── 2. Receipt totals vs their active lines ─── */}
          <HealthCard
            Icon={Receipt}
            color="navy"
            title="Receipt total mismatches"
            desc="Receipts whose stored total is not the sum of their active payment lines — a figure that can never be true."
            count={mismatch?.count ?? 0}
            rowsShown={mismatch?.rows?.length ?? 0}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Student</th>
                    <th>Department</th>
                    <th>Total</th>
                    <th>Lines sum</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {(mismatch?.rows || []).map((r) => {
                    const diff = Number(r.total_amount) - Number(r.lines_sum);
                    return (
                      <tr key={r.id}>
                        <td className="fw-600">{r.receipt_number}</td>
                        <td>{r.student_name || '—'}</td>
                        <td>{r.department_name || 'School'}</td>
                        <td>GHS {Number(r.total_amount).toFixed(2)}</td>
                        <td>GHS {Number(r.lines_sum).toFixed(2)}</td>
                        <td>
                          <span className="badge badge-red">
                            {diff > 0 ? '+' : ''}GHS {diff.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HealthCard>

          {/* ─── 3. Duplicate application numbers ─── */}
          <HealthCard
            Icon={Users}
            color="red"
            title="Duplicate pre-registration numbers"
            desc="Pre-registrations sharing a reference number (any status) — verify will refuse these until the desk picks the real holder."
            count={dups?.count ?? 0}
            rowsShown={dups?.rows?.length ?? 0}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference No</th>
                    <th>Applications</th>
                    <th>Applicants</th>
                  </tr>
                </thead>
                <tbody>
                  {(dups?.rows || []).map((r) => (
                    <tr key={r.student_no}>
                      <td className="fw-600">{r.student_no}</td>
                      <td>
                        <span className="badge badge-red">{r.applications}</span>
                      </td>
                      <td>
                        <span className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                          {(r.names || []).map((n, i) => (
                            <span
                              key={`${r.application_ids?.[i] ?? i}`}
                              className="badge badge-gold"
                            >
                              {n} · {r.statuses?.[i] || '?'}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HealthCard>

          <p className="muted text-xs">
            <Warning size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            These checks never change data — they only show where figures disagree. Fix items
            straight from a student's record (Other Dues at the bottom), or use the Receipts and
            Pre-Registration pages.
          </p>
        </>
      )}

      {/* Student record with the check/uncheck Other Dues editor at the
          bottom — closing re-runs the checks, since the fix may clear the
          student's row (or change what's missing). */}
      {details && (
        <StudentDetailsModal
          student={details}
          onClose={() => {
            setDetails(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}
