import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { CheckCircle, CurrencyCircleDollar, ArrowClockwise } from '@phosphor-icons/react';
import Select from '../components/ui/Select';

export default function RepPage() {
  const { code } = useParams();
  const [dept, setDept] = useState(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [classId, setClassId] = useState('');
  const [name, setName] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  useEffect(() => {
    api.get(`/public/departments/${encodeURIComponent(code)}`)
      .then((res) => {
        setDept(res.data);
        setAmount(String(res.data.dues_amount || ''));
      })
      .catch(() => setError('Invalid access code. Please check with your department admin.'));
  }, [code]);

  const classOptions = (dept?.classes || []).map((c) => ({
    value: c.id,
    label: c.name + (c.level ? ` (${c.level})` : ''),
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!classId) { setError('Please select your class'); return; }
    setRecording(true);
    setReceipt(null);
    try {
      const res = await api.post(`/public/departments/${encodeURIComponent(code)}/classes/${classId}/payments`, {
        student_no: studentNo,
        name,
        amount: Number(amount),
        method,
      });
      setReceipt(res.data);
      setName('');
      setStudentNo('');
      setAmount(String(dept.dues_amount || ''));
      setMethod('cash');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally {
      setRecording(false);
    }
  };

  if (error && !dept) {
    return (
      <div className="rep-wrap">
        <div className="rep-card">
          <img src="/school-logo.jpg" alt="School of Sciences" className="rep-logo" />
          <h2>Access Code Not Found</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!dept) {
    return (
      <div className="rep-wrap">
        <div className="rep-card">
          <div className="rep-spinner"></div>
          <p className="muted mt">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rep-wrap">
      <div className="rep-card">
        <div className="rep-header">
          <img src="/school-logo.jpg" alt="School of Sciences" className="rep-logo" />
          <h1>Class Dues Collection</h1>
          <div className="rep-class-info">{dept.name}</div>
          <div className="rep-dues-badge">Department Dues: GHS {Number(dept.dues_amount).toFixed(2)}</div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {receipt && (
          <div className="rep-receipt">
            <div className="rep-receipt-header">
              <CheckCircle size={22} color="var(--green)" weight="fill" />
              <span>Payment Recorded</span>
            </div>
            <div className="rep-receipt-number">{receipt.receipt_number}</div>
            <div className="rep-receipt-details">
              {receipt.student} &mdash; GHS {Number(receipt.amount).toFixed(2)} ({receipt.method})
            </div>
            <button
              className="btn btn-outline btn-sm w-full mt-sm"
              onClick={() => { setReceipt(null); setError(''); }}
            >
              <ArrowClockwise size={16} /> Record Another Payment
            </button>
          </div>
        )}

        {!receipt && (
          <form onSubmit={submit}>
            <div className="field">
              <label>Select Your Class *</label>
              <Select
                value={classId}
                onChange={(v) => { setClassId(v); setError(''); }}
                options={classOptions}
                placeholder="Choose your class..."
              />
            </div>
            <div className="field">
              <label>Student Full Name *</label>
              <input
                className="input"
                placeholder="e.g. Kwame Asante"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Student Number *</label>
              <input
                className="input"
                placeholder="e.g. SCS-1001"
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>Amount Paid (GHS) *</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Payment Method *</label>
                <Select
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'momo', label: 'Mobile Money' },
                    { value: 'bank', label: 'Bank Transfer' },
                  ]}
                />
              </div>
            </div>
            <button className="btn btn-green btn-lg w-full" disabled={recording}>
              <CurrencyCircleDollar size={20} />
              {recording ? 'Recording...' : 'Record Payment & Issue Receipt'}
            </button>
          </form>
        )}

        <div className="rep-footer">
          Payments are verified by admins using the receipt number above.
        </div>
      </div>
    </div>
  );
}
