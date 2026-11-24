import { useState } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { useAuth } from '../context/AuthContext';
import { IconCircleCheck as CheckCircle, IconSearch as MagnifyingGlass, IconBan as Prohibit, IconAlertTriangle as Warning } from '@tabler/icons-react';

// Institution timezone (GMT+0) so the displayed day never shifts on devices
// set to another zone.
const ACCRA_TZ = 'Africa/Accra';

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(undefined, { timeZone: ACCRA_TZ });
  const time = d.toLocaleTimeString(undefined, {
    timeZone: ACCRA_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} ${time}`;
}

// Each failure kind gets its own message: a cross-department receipt, a
// missing receipt and a dropped connection should not read the same.
function verifyErrorMessage(err) {
  const data = err.response?.data;
  if (err.response?.status === 404) return 'No record found for this receipt number.';
  if (err.response?.status === 403 && data?.code === 'WRONG_DEPARTMENT') {
    return (
      data.error ||
      'That receipt belongs to a different department and cannot be verified here.'
    );
  }
  if (!err.response) return 'Could not reach the server. Check your connection and try again.';
  if (err.response.status >= 500) {
    return 'The server could not verify this receipt right now. Please try again shortly.';
  }
  return data?.error || 'Verification failed.';
}

// How many payment lines on this receipt were voided. The verify endpoint
// reports a count directly; fall back to counting voided lines inside the
// breakdown so responses with or without that count both render correctly.
function countVoidedLines(result) {
  const fromLines = Array.isArray(result.lines)
    ? result.lines.filter((l) => l.voided_at).length
    : 0;
  const declared =
    result.voided_line_count ?? result.voided_lines_count ?? result.voided_count ?? 0;
  const n = Array.isArray(declared) ? declared.length : Number(declared);
  return Number.isFinite(n) ? Math.max(n, fromLines) : fromLines;
}

export default function Verify() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff', 'super_admin'].includes(user?.role);
  const [number, setNumber] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Editing the number invalidates whatever was verified before it — never
  // leave a stale "valid" result on screen next to a different number.
  const onNumberChange = (e) => {
    setNumber(e.target.value);
    if (result) setResult(null);
    if (error) setError('');
  };

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
      setError(verifyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const recorderLabel = (r) => {
    if (r.record_type === 'rep') return 'Class Rep';
    return r.recorded_by_name || 'Admin';
  };

  const fullyVoided = Boolean(result?.voided_at);
  const voidedLines = result ? countVoidedLines(result) : 0;
  const partiallyVoided = Boolean(result) && !fullyVoided && voidedLines > 0;

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
              onChange={onNumberChange}
            />
          </div>
          {error && (
            <div className="alert alert-error">
              <Warning size={16} /> {error}
            </div>
          )}
          <button className="btn btn-primary" disabled={loading}>
            <MagnifyingGlass size={18} /> {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        {result && (
          <div className="mt-md">
            {fullyVoided ? (
              <div className="alert alert-error" style={{ alignItems: 'flex-start' }}>
                <Prohibit size={24} />
                <span>
                  <strong style={{ letterSpacing: '0.08em', fontSize: '1.02em' }}>VOIDED</strong>{' '}
                  — this receipt has been voided and is no longer valid.
                  {result.void_reason ? <> Reason: {result.void_reason}</> : ''}
                </span>
              </div>
            ) : (
              <div className="alert alert-success">
                <CheckCircle size={18} /> This receipt is valid and recorded.
              </div>
            )}

            <div className="table-wrap" style={fullyVoided ? { opacity: 0.6 } : undefined}>
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
                      <strong>Level</strong>
                    </td>
                    <td>
                      {result.payment_level || result.level ? `Level ${result.payment_level || result.level}` : '—'}
                    </td>
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
                    <td>{formatDateTime(result.paid_at)}</td>
                  </tr>
                  {fullyVoided && (
                    <tr>
                      <td>
                        <strong>Status</strong>
                      </td>
                      <td>
                        <span className="badge badge-red">
                          Voided
                          {result.voided_at ? ` · ${formatDateTime(result.voided_at)}` : ''}
                        </span>
                        {result.void_reason && (
                          <span className="muted text-sm" style={{ marginLeft: 8 }}>
                            {result.void_reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
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

            <div
              className="card"
              style={{
                background: 'var(--cream-light)',
                marginTop: 12,
                ...(fullyVoided ? { opacity: 0.55, filter: 'grayscale(1)' } : {}),
              }}
            >
              <h3 className="mb">Payment Breakdown</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.lines || []).map((l) => {
                    const lineVoided = Boolean(l.voided_at);
                    return (
                      <tr key={l.id || `${l.type}-${l.department_name || ''}`}>
                        <td style={lineVoided ? { color: 'var(--text-muted)' } : undefined}>
                          {l.label || (l.type === 'school_dues' ? 'School Dues' : 'Department Dues')}
                          <span className="muted text-xs" style={{ marginLeft: 6 }}>
                            (
                            {l.type === 'school_dues'
                              ? 'School'
                              : l.department_name || result.department_name || ''}
                            )
                          </span>
                          {lineVoided && (
                            <span className="badge badge-red" style={{ marginLeft: 6 }}>
                              Voided
                            </span>
                          )}
                        </td>
                        <td
                          className="fw-600"
                          style={
                            lineVoided
                              ? { textDecoration: 'line-through', color: 'var(--text-muted)' }
                              : undefined
                          }
                        >
                          GHS {Number(l.amount).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>
                      <strong>Total Paid</strong>
                    </td>
                    <td className="fw-800">
                      GHS {Number(result.total_amount).toFixed(2)}
                      {partiallyVoided && (
                        <span
                          className="muted text-xs"
                          style={{ marginLeft: 8, fontWeight: 700 }}
                        >
                          {voidedLines} line{voidedLines === 1 ? '' : 's'} voided
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {result.souvenirs?.length > 0 && (
              <div className="mt-sm">
                <strong className="text-sm">Souvenirs received:</strong>{' '}
                {result.souvenirs && asArray(result.souvenirs).map((s) => (
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
