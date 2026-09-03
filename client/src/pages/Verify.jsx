import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';

export default function Verify() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
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
      const res = await api.get(`/payments/receipts/${encodeURIComponent(number.trim())}`);
      setResult(res.data);
    } catch (err) {
      if (err.response?.status === 404) setError('No record found for this receipt number.');
      else setError(err.response?.data?.error || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-md">
        <h1>Verify Receipt</h1>
        <p className="subtitle">
          {isSchool
            ? 'Enter a receipt number to confirm a student\'s payment record across all departments.'
            : `Enter a receipt number to confirm a payment record for ${user.department_name}.`}
        </p>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={verify}>
          <div className="field">
            <label>Receipt Number</label>
            <input
              className="input"
              placeholder="UENR-DUES-..."
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
            <div className="alert alert-success"><CheckCircle size={18} /> Payment is valid and recorded.</div>
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr><td><strong>Receipt Number</strong></td><td><span className="code-cell">{result.receipt_number}</span></td></tr>
                    <tr><td><strong>Student</strong></td><td>{result.student_name}</td></tr>
                    <tr><td><strong>Student No</strong></td><td>{result.student_no || '-'}</td></tr>
                    <tr><td><strong>Type</strong></td><td><span className={`badge ${result.type === 'school_dues' ? 'badge-navy' : 'badge-green'}`}>{result.type === 'school_dues' ? 'School Dues' : 'Department Dues'}</span></td></tr>
                    <tr><td><strong>Amount</strong></td><td>GHS {Number(result.amount).toFixed(2)}</td></tr>
                    <tr><td><strong>Method</strong></td><td style={{ textTransform: 'capitalize' }}>{result.method === 'momo' ? 'Mobile Money' : result.method}</td></tr>
                    <tr><td><strong>Department</strong></td><td>{result.department_name || '-'}</td></tr>
                    <tr><td><strong>Class</strong></td><td>{result.class_name || '-'}</td></tr>
                    <tr><td><strong>Recorded By</strong></td><td><span className="badge badge-gray">{result.admin_role === 'SCHOOL_ADMIN' ? 'School Admin' : result.admin_role === 'DEPT_ADMIN' ? 'Dept Admin' : result.record_type}</span></td></tr>
                    <tr><td><strong>Paid On</strong></td><td>{new Date(result.paid_at).toLocaleString()}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
