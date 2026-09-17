import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';

export default function Verify() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff'].includes(user?.role);
  const [number, setNumber] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!number.trim()) {
      setError('Enter a receipt number');
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/receipts/verify/${encodeURIComponent(number.trim())}`);
      setResult(res.data);
    } catch (err) {
      if (err.response?.status === 404) setError('No record found for this receipt number.');
      else setError(err.response?.data?.error || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const recorderLabel = (r) => {
    if (r.record_type === 'rep') return 'Class Rep';
    return r.recorded_by_name || 'Admin';
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Verify Receipt</h1>
          <p className="subtitle">
            {schoolSide
              ? 'Confirm any payment with a receipt number.'
              : `Confirm a receipt issued in ${user?.department_name}.`}
          </p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <form onSubmit={verify}>
          <div className="field">
            <label>Receipt Number</label>
            <input
              className="input"
              placeholder="e.g. SOS-DUES-SCH-UEB3227523-1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary" disabled={loading}>
            <MagnifyingGlass size={18} /> {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        {result && (
          <div className="mt-md">
            <div className="alert alert-success">
              <CheckCircle size={18} /> This receipt is valid and recorded.
            </div>

            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <td>
                      <strong>Receipt Number</strong>
                    </td>
                    <td>
                      <span className="code-cell">{result.receipt_number}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Student</strong>
                    </td>
                    <td>
                      {result.student_name}{' '}
                      <span className="muted text-sm">({result.student_no || 'no number'})</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Department</strong>
                    </td>
                    <td>{result.department_name || '—'}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Class</strong>
                    </td>
                    <td>{result.class_name || '—'}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Method</strong>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>
                      {result.method === 'momo' ? 'Mobile Money' : result.method}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Paid On</strong>
                    </td>
                    <td>{new Date(result.paid_at).toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Recorded By</strong>
                    </td>
                    <td>
                      <span className="badge badge-gray">{recorderLabel(result)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card" style={{ background: 'var(--cream-light)', marginTop: 12 }}>
              <h3 className="mb">Payment Breakdown</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.id || l.type}>
                      <td>
                        {l.type === 'school_dues' ? 'School Dues' : 'Department Dues'}
                        <span className="muted text-xs" style={{ marginLeft: 6 }}>
                          (
                          {l.type === 'school_dues'
                            ? 'School'
                            : l.department_name || result.department_name || ''}
                          )
                        </span>
                      </td>
                      <td className="fw-600">GHS {Number(l.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total Paid</strong>
                    </td>
                    <td className="fw-800">GHS {Number(result.total_amount).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {result.souvenirs?.length > 0 && (
              <div className="mt-sm">
                <strong className="text-sm">Souvenirs received:</strong>{' '}
                {result.souvenirs.map((s) => (
                  <span key={s.name} className="badge badge-green" style={{ marginRight: 6 }}>
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
