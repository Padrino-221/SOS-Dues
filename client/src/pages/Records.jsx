import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import {
  IconSearch as MagnifyingGlass,
  IconReceipt as ReceiptIcon,
  IconAlertTriangle as Warning,
  IconArrowLeft as ArrowLeft,
  IconCurrencyDollar as CurrencyCircleDollar,
} from '@tabler/icons-react';

const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
  // extra_dues lines carry their own snapshot label — this is the fallback.
  extra_dues: 'Other Dues',
};

// Institution timezone (GMT+0) — keeps the printed day stable on any device.
const ACCRA_TZ = 'Africa/Accra';

function formatShortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { timeZone: ACCRA_TZ });
}

// A payment line shows as reversed once the public records feed includes the
// voided receipts: either the line itself or its receipt carries voided_at.
const isReversed = (p) => Boolean(p.voided_at || p.receipt_voided_at || p.receipt_voided);
const reversalReason = (p) =>
  p.void_reason || p.receipt_void_reason || 'voided by the administration';

export default function Records() {
  const [studentNo, setStudentNo] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

  const search = async (e) => {
    e.preventDefault();
    const no = studentNo.trim();
    if (!no) {
      setError('Enter your student number.');
      return;
    }
    setError('');
    setSearching(true);
    setResults(null);
    try {
      const res = await api.get(`/public/records/${encodeURIComponent(no)}`);
      setResults(res.data == null ? null : asArray(res.data));
    } catch (err) {
      setError(
        err.response?.data?.error || 'We could not find a record for that student number.'
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="records-wrap">
      <style>{`
        .records-reversed td { color: var(--text-muted); }
        .records-reversed td:first-child,
        .records-reversed td.fw-600,
        .records-reversed .records-receipt { text-decoration: line-through; }
        .records-reversed-note {
          display: block;
          color: var(--danger);
          font-size: 0.72rem;
          font-weight: 700;
          margin-top: 2px;
        }
        .records-totals {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 14px;
          align-items: center;
          justify-content: flex-end;
          margin-top: 10px;
          font-size: 0.82rem;
        }
        @media (max-width: 640px) { .hide-sm { display: none; } }
      `}</style>
      <div className="records-card">
        <div className="apply-header">
          <img src="/school-logo.jpg" alt="School of Sciences" className="apply-logo" />
          <h1>Payment Records</h1>
          <p className="subtitle">School of Sciences · UENR Sunyani</p>
        </div>

        <form onSubmit={search}>
          <div className="field">
            <label>Student Number</label>
            <div className="flex gap-sm">
              <input
                className="input"
                style={{ flex: 1 }}
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                placeholder="Enter your student number"
                autoComplete="off"
              />
              <button className="btn btn-primary" disabled={searching}>
                <MagnifyingGlass size={18} /> {searching ? 'Searching' : 'Search'}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="alert alert-error">
            <Warning size={16} style={{ marginRight: 6, verticalAlign: -3 }} /> {error}
          </div>
        )}

        {results &&
          results.map((s0) => {
            const s = { ...s0, payments: asArray(s0.payments) };
            const live = s.payments.filter((p) => !isReversed(p));
            const reversed = s.payments.filter(isReversed);
            const liveTotal = live.reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const reversedTotal = reversed.reduce((sum, p) => sum + Number(p.amount || 0), 0);
            return (
            <div key={s.id} className="card" style={{ marginBottom: 16 }}>
              <div className="flex between align-center mb-md">
                <div>
                  <h3 style={{ marginBottom: 2 }}>{s.name}</h3>
                  <p className="muted text-sm">
                    {s.student_no || '—'} · {s.department_name || 'No department'}
                  </p>
                </div>
                <span className="badge badge-navy">{s.level ? `Level ${s.level}` : '—'}</span>
              </div>

              {s.payments.length === 0 ? (
                <p className="muted text-sm">No payments recorded yet.</p>
              ) : (
                <>
                <div className="table-wrap">
                  <table className="table records-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="hide-sm">Academic Year</th>
                        <th>Item</th>
                        <th>Payment level</th>
                        <th>Amount</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.payments.map((p, i) => {
                        const reversedRow = isReversed(p);
                        return (
                          <tr
                            key={`${p.receipt_number}-${p.type}-${i}`}
                            className={reversedRow ? 'records-reversed' : undefined}
                          >
                            <td>{formatShortDate(p.paid_at)}</td>
                            <td className="hide-sm">{p.academic_year || '—'}</td>
                            <td>
                              {p.label || TYPE_LABEL[p.type] || p.type}
                              {reversedRow && (
                                <span className="records-reversed-note">
                                  Reversed — {reversalReason(p)}
                                </span>
                              )}
                            </td>
                            <td>{p.payment_level ? `Level ${p.payment_level}` : p.receipt_level ? `Level ${p.receipt_level}` : '—'}</td>
                            <td className="fw-600">GHS {Number(p.amount).toFixed(2)}</td>
                            <td className="records-receipt">{p.receipt_number}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="records-totals">
                  <span>
                    Live payments total:{' '}
                    <strong>GHS {liveTotal.toFixed(2)}</strong>
                  </span>
                  {reversedTotal > 0 && (
                    <span className="muted">
                      (Reversed: GHS {reversedTotal.toFixed(2)} — excluded from the total)
                    </span>
                  )}
                </div>
                </>
              )}
            </div>
            );
          })}

        <div className="flex align-center gap-sm" style={{ marginTop: 18 }}>
          <CurrencyCircleDollar size={16} />
          <span className="muted text-sm">
            Receipts can also be verified on the school&apos;s Verify page.
          </span>
        </div>

        <p style={{ textAlign: 'center', marginTop: 22 }}>
          <Link className="btn btn-outline" to="/">
            <ArrowLeft size={16} /> Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
