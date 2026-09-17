import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import Pagination from '../components/ui/Pagination';
import Modal from '../components/ui/Modal';
import { Receipt as ReceiptIcon, CheckCircle, Warning, Prohibit } from '@phosphor-icons/react';

const TYPE_LABEL = { school_dues: 'School Dues', department_dues: 'Department Dues' };

export default function Receipts() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff'].includes(user?.role);
  const [receipts, setReceipts] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [savingVoid, setSavingVoid] = useState(false);
  const PAGE_SIZE = 12;

  const loadReceipts = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api
      .get('/receipts', { params: search ? { search } : { limit: 300 } })
      .then((res) => setReceipts(res.data))
      .catch(() =>
        setLoadError('Receipts could not be loaded. Check your connection and try again.')
      )
      .finally(() => setLoading(false));
  }, [search]);

  const openReceipt = async (receipt) => {
    try {
      const res = await api.get(`/receipts/verify/${encodeURIComponent(receipt.receipt_number)}`);
      setSelected(res.data);
    } catch {
      setLoadError('Receipt details could not be loaded.');
    }
  };

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  // Live: a new payment anywhere adds its receipt to this list immediately.
  useRealtime({
    'payment:new': loadReceipts,
    'payment:voided': loadReceipts,
    'student:changed': loadReceipts,
  });

  useEffect(() => {
    setPage(1);
  }, [search]);

  const recorderLabel = (r) => {
    if (r.record_type === 'rep') return 'Class Rep';
    return schoolSide && !r.recorded_by ? 'System' : 'Admin';
  };

  const canVoid = (receipt) =>
    Boolean(receipt) &&
    !receipt.voided_at &&
    ['school_admin', 'school_staff', 'dept_admin'].includes(user?.role);

  const voidReceipt = async () => {
    if (!voiding) return;
    setVoidError('');
    if (voidReason.trim().length < 3) {
      setVoidError('Enter a brief reason for voiding this receipt.');
      return;
    }
    setSavingVoid(true);
    try {
      await api.post(`/receipts/${voiding.id}/void`, { reason: voidReason.trim() });
      setVoiding(null);
      setVoidReason('');
      setSelected(null);
      loadReceipts();
    } catch (err) {
      setVoidError(err.response?.data?.error || 'Receipt could not be voided.');
    } finally {
      setSavingVoid(false);
    }
  };

  return (
    <div>
      <Modal
        open={Boolean(voiding)}
        icon={<Prohibit size={20} />}
        title="Void receipt"
        subtitle={voiding ? `${voiding.receipt_number} will remain in the audit trail.` : ''}
        onClose={() => !savingVoid && setVoiding(null)}
      >
        <div className="alert alert-error">
          Voiding reverses this collection for reporting and allows the affected dues to be recorded again.
        </div>
        <div className="field">
          <label>Reason *</label>
          <textarea
            className="input"
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="e.g. Wrong amount entered"
          />
        </div>
        {voidError && <div className="alert alert-error">{voidError}</div>}
        <div className="modal-actions">
          <button className="btn btn-outline" disabled={savingVoid} onClick={() => setVoiding(null)}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={savingVoid} onClick={voidReceipt}>
            <Prohibit size={17} /> {savingVoid ? 'Voiding...' : 'Void receipt'}
          </button>
        </div>
      </Modal>
      <Modal
        open={Boolean(selected)}
        icon={<ReceiptIcon size={20} />}
        title="Receipt details"
        subtitle={selected ? `${selected.receipt_number} · ${selected.student_name}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="receipt-detail-modal">
            <div className={`alert ${selected.voided_at ? 'alert-error' : 'alert-success'}`}>
              {selected.voided_at ? <Prohibit size={17} /> : <CheckCircle size={17} />}{' '}
              {selected.voided_at
                ? `This receipt was voided${selected.void_reason ? `: ${selected.void_reason}` : '.'}`
                : 'This receipt is valid and recorded.'}
            </div>
            <div className="receipt-detail-grid">
              <div>
                <span>Student</span>
                <strong>{selected.student_name}</strong>
                <small>{selected.student_no || 'No student number'}</small>
              </div>
              <div>
                <span>Department</span>
                <strong>{selected.department_name || 'School'}</strong>
                <small>{selected.class_name || 'No class'}</small>
              </div>
              <div>
                <span>Paid on</span>
                <strong>{new Date(selected.paid_at).toLocaleString()}</strong>
                <small>{selected.method === 'momo' ? 'Mobile Money' : selected.method}</small>
              </div>
              <div>
                <span>Total</span>
                <strong>GHS {Number(selected.total_amount).toFixed(2)}</strong>
                <small>{selected.record_type === 'rep' ? 'Class Rep' : 'Admin'}</small>
              </div>
            </div>
            <h4 className="receipt-detail-heading">Payment breakdown</h4>
            <div className="receipt-detail-lines">
              {selected.lines.map((line) => (
                <div key={line.id || line.type}>
                  <span>{TYPE_LABEL[line.type]}</span>
                  <strong>GHS {Number(line.amount).toFixed(2)}</strong>
                </div>
              ))}
            </div>
            {canVoid(selected) && (
              <div className="modal-actions">
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setVoiding(selected);
                    setVoidReason('');
                    setVoidError('');
                  }}
                >
                  <Prohibit size={17} /> Void receipt
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
      <div className="page-head">
        <div>
          <h1>Receipts</h1>
          <p className="subtitle">
            {schoolSide
              ? 'All collections across the School.'
              : `Receipts issued for ${user?.department_name}.`}
          </p>
        </div>
      </div>

      <div className="card">
        {loadError && (
          <div className="alert alert-error">
            <Warning size={16} /> {loadError}{' '}
            <button className="btn btn-outline btn-xs" onClick={loadReceipts}>
              Retry
            </button>
          </div>
        )}
        <div className="field" style={{ maxWidth: 420 }}>
          <input
            className="input search-input"
            placeholder="Search by receipt number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt Number</th>
                <th>Student</th>
                <th>Student No</th>
                {schoolSide && <th>Department</th>}
                <th>Total</th>
                <th>Method</th>
                <th>Paid On</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {!loading && receipts.length === 0 && (
                <tr>
                  <td colSpan={schoolSide ? 8 : 7} className="muted">
                    No receipts found.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={schoolSide ? 8 : 7}>
                    <div className="table-state">
                      <span className="spin-dot" /> Loading receipts...
                    </div>
                  </td>
                </tr>
              )}
              {receipts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                <tr
                  key={r.id}
                  className="row-click"
                  onClick={() => openReceipt(r)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openReceipt(r);
                    }
                  }}
                >
                  <td>
                    <span className="code-cell" style={{ fontSize: 12 }}>
                      {r.receipt_number}
                    </span>
                  </td>
                  <td className="fw-600">{r.student_name}</td>
                  <td>{r.student_no || '-'}</td>
                  {schoolSide && <td>{r.department_name || <span className="muted">—</span>}</td>}
                  <td className="fw-700">GHS {Number(r.total_amount).toFixed(2)}</td>
                  <td style={{ textTransform: 'capitalize' }}>
                    {r.method === 'momo' ? 'Mobile Money' : r.method}
                  </td>
                  <td>{new Date(r.paid_at).toLocaleString()}</td>
                  <td>
                    <span className="badge badge-gray">{recorderLabel(r)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.ceil(receipts.length / PAGE_SIZE)}
          onPageChange={setPage}
          totalItems={receipts.length}
          pageSize={PAGE_SIZE}
        />
      </div>
    </div>
  );
}
