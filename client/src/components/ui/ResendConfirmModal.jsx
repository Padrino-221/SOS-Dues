import { useEffect, useState } from 'react';
import { IconMail as EnvelopeSimple, IconSend as PaperPlaneTilt, IconAlertTriangle as Warning } from '@tabler/icons-react';
import api from '../../api/client';
import Modal from './Modal';

// extra_dues lines carry their own snapshot label — this is the fallback.
const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
  extra_dues: 'Other Dues',
};

/**
 * Confirmation dialog for the resend-email action. Loads the student's live
 * receipts with their itemized payment lines and the address on file, so the
 * admin reviews the exact payment records and the recipient BEFORE the POST
 * that actually sends.
 *
 * Props:
 *   student  - { id, name, student_no } for the row that was clicked,
 *              or null/undefined (closed)
 *   onClose  - () => void
 *   addToast - (message, type) => void
 */
export default function ResendConfirmModal({ student, onClose, addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const open = Boolean(student);
  const studentId = student?.id ?? null;

  useEffect(() => {
    if (!open || studentId === null) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSendError('');
    setData(null);
    api
      .get(`/students/${studentId}/resend-preview`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.response?.data?.error || 'Payment records could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, studentId]);

  if (!open) return null;

  const email = data?.student?.email || '';
  const receipts = data?.receipts || [];
  const canSend = Boolean(data?.can_send);
  const reason =
    data && !canSend
      ? !email
        ? 'No email address on file — edit the record first.'
        : 'This student has no receipt emails to resend.'
      : null;

  const send = () => {
    if (sending || studentId === null) return;
    setSending(true);
    setSendError('');
    api
      .post(`/students/${studentId}/resend-receipt-emails`, {})
      .then((res) => {
        const { message, failed } = res.data || {};
        addToast(message || 'Receipt email resent.', failed ? 'error' : 'success');
        onClose();
      })
      .catch((err) =>
        setSendError(err?.response?.data?.error || 'Could not resend the receipt email.')
      )
      .finally(() => setSending(false));
  };

  const sendLabel = sending
    ? 'Sending…'
    : receipts.length > 0
      ? `Resend ${receipts.length} Receipt Email${receipts.length === 1 ? '' : 's'}`
      : 'Resend Receipt Email';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resend receipt email"
      subtitle={
        student
          ? `${student.name}${student.student_no ? ` — ${student.student_no}` : ''}`
          : undefined
      }
      icon={<PaperPlaneTilt size={20} />}
      size="wide"
      closeOnBackdrop={!sending}
    >
      {loading && <p className="muted">Loading payment records…</p>}
      {loadError && (
        <div className="alert alert-error">
          <Warning size={16} /> {loadError}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="field">
            <label>Send to</label>
            <div className="flex gap-sm" style={{ alignItems: 'center' }}>
              <EnvelopeSimple size={18} />
              <strong>{email || 'No email address on file'}</strong>
            </div>
          </div>

          <p className="text-sm muted" style={{ marginBottom: 10 }}>
            Review the payment record{receipts.length === 1 ? '' : 's'} below — the receipt email
            {receipts.length === 1 ? '' : 's'} will be sent to the address above.
          </p>

          {reason && (
            <div className="alert alert-info">
              <Warning size={16} /> {reason}
            </div>
          )}

          {receipts.map((r) => (
            <div className="card" key={r.id} style={{ padding: 12, marginBottom: 10 }}>
              <div
                className="flex gap-sm"
                style={{ justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="fw-600">{r.receipt_number}</span>
                <span className="fw-600">GHS {Number(r.total_amount).toFixed(2)}</span>
              </div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>
                {r.paid_at ? new Date(r.paid_at).toLocaleString() : ''}
                {r.method ? ` · ${String(r.method).toUpperCase()}` : ''}
              </div>
              <div style={{ marginTop: 8 }}>
                {r.lines.map((line, i) => (
                  <div
                    className="flex gap-sm"
                    key={`${r.id}-line-${i}`}
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span className="text-sm">{line.label || TYPE_LABEL[line.type] || 'Payment'}</span>
                    <span className="text-sm fw-600">GHS {Number(line.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              {r.souvenirs?.length > 0 && (
                <div className="text-sm muted" style={{ marginTop: 6 }}>
                  Souvenirs: {r.souvenirs.join(', ')}
                </div>
              )}
            </div>
          ))}

          {sendError && (
            <div className="alert alert-error">
              <Warning size={16} /> {sendError}
            </div>
          )}
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={send}
          disabled={sending || loading || !canSend}
        >
          <PaperPlaneTilt size={18} /> {sendLabel}
        </button>
      </div>
    </Modal>
  );
}
