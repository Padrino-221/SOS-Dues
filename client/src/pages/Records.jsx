import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import {
  MagnifyingGlass,
  Receipt as ReceiptIcon,
  Warning,
  ArrowLeft,
  CurrencyCircleDollar,
} from '@phosphor-icons/react';

const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
};

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
      setResults(res.data);
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
          results.map((s) => (
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
                <div className="table-wrap">
                  <table className="table records-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Academic Year</th>
                        <th>Item</th>
                        <th>Amount</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.payments.map((p, i) => (
                        <tr key={`${p.receipt_number}-${p.type}-${i}`}>
                          <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                          <td>{p.academic_year || '—'}</td>
                          <td>{TYPE_LABEL[p.type] || p.type}</td>
                          <td className="fw-600">GHS {Number(p.amount).toFixed(2)}</td>
                          <td className="records-receipt">{p.receipt_number}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

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
