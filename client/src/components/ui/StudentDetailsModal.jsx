import { useEffect, useState } from 'react';
import {
  IconUser as User,
  IconIdBadge as IdentificationBadge,
  IconSchool as GraduationCap,
  IconPhone as Phone,
  IconMail as Envelope,
  IconMapPin as MapPin,
  IconCalendar as CalendarBlank,
  IconReceipt as ReceiptIcon,
  IconGift as Gift,
  IconPencil as PencilSimple,
} from '@tabler/icons-react';
import Modal from './Modal';
import ExtrasEditPicker from './ExtrasEditPicker';
import { genderScopeNote } from '../../utils/genderScope';
import api from '../../api/client';
import { asArray } from '../../utils/asArray';
import { useAuth } from '../../context/AuthContext';

function Detail({ icon, label, value }) {
  return (
    <div className="stu-detail">
      <span className="stu-detail-label">
        {icon}
        {label}
      </span>
      <span className="stu-detail-value">{value || '—'}</span>
    </div>
  );
}

const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
  // extra_dues lines carry their own snapshot label — this is the fallback.
  extra_dues: 'Other Dues',
};

export default function StudentDetailsModal({ student, onClose }) {
  const { user } = useAuth();
  const [payments, setPayments] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // "Other Dues" checkbox editor (student-scoped: reconciles across all the
  // student's receipts; newly-checked items attach to their most recent one).
  // "Other Dues" editing is open to staff too (the verification desk fixes
  // its own mischarges) — the server scopes what each role may toggle.
  const canEditExtras = [
    'school_admin',
    'school_staff',
    'dept_admin',
    'dept_staff',
    'super_admin',
  ].includes(user?.role);
  const [editingExtras, setEditingExtras] = useState(false);
  const [extrasItems, setExtrasItems] = useState([]);
  const [extrasSelected, setExtrasSelected] = useState({});
  const [extrasLocked, setExtrasLocked] = useState(() => new Set());
  const [extrasReason, setExtrasReason] = useState('');
  const [extrasError, setExtrasError] = useState('');
  const [extrasSaving, setExtrasSaving] = useState(false);
  const [extrasNotice, setExtrasNotice] = useState('');

  const loadStudentData = () => {
    if (!student?.id) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/students/${student.id}/payments`),
      api.get(`/students/${student.id}/souvenirs`),
    ])
      .then(([p, s]) => {
        setPayments(asArray(p.data));
        setSouvenirs(asArray(s.data));
      })
      .catch(() => setError('Student data could not be loaded.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStudentData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  // Open the editor: load the toggleable catalog and pre-check the student's
  // active extra lines (matched by label snapshot = item name).
  const openExtrasEditor = async () => {
    if (!student?.id) return;
    setExtrasError('');
    setExtrasReason('');
    setExtrasNotice('');
    setEditingExtras(true);
    try {
      const res = await api.get('/dues-items', { params: { toggleable: 1, department_id: 'all' } });
      const items = asArray(res.data);
      setExtrasItems(items);
      const nameToId = new Map(items.map((i) => [String(i.name).toLowerCase(), i.id]));
      const selected = {};
      const locked = new Set();
      for (const p of payments) {
        if (p.type !== 'extra_dues' || p.voided_at) continue;
        const id = nameToId.get(String(p.label || '').toLowerCase());
        if (id == null) continue;
        selected[id] = Number(p.amount);
        locked.add(id);
      }
      setExtrasSelected(selected);
      setExtrasLocked(locked);
    } catch {
      setExtrasItems([]);
      setExtrasError('The dues items could not be loaded — close and try again.');
    }
  };

  const closeExtrasEditor = () => {
    setEditingExtras(false);
    setExtrasSelected({});
    setExtrasLocked(new Set());
    setExtrasReason('');
    setExtrasError('');
  };

  const toggleExtraItem = (item) => {
    setExtrasSelected((prev) => {
      const next = { ...prev };
      if (next[item.id] !== undefined) delete next[item.id];
      else next[item.id] = Number(item.amount);
      return next;
    });
  };

  const setExtraAmount = (item, value) => {
    setExtrasSelected((prev) => ({ ...prev, [item.id]: value }));
  };

  const saveExtras = async () => {
    if (!student?.id || extrasSaving) return;
    setExtrasError('');
    if (extrasReason.trim().length < 3) {
      setExtrasError('Enter a brief reason for this change.');
      return;
    }
    const items = Object.entries(extrasSelected).map(([id, amount]) => ({
      dues_item_id: Number(id),
      amount: Number(amount),
    }));
    setExtrasSaving(true);
    try {
      const res = await api.put(`/students/${student.id}/extra-dues`, {
        items,
        reason: extrasReason.trim(),
      });
      const data = res.data || {};
      const skippedNote =
        asArray(data.skipped).length > 0
          ? ` ${asArray(data.skipped).length} line(s) not managed here were left untouched.`
          : '';
      setExtrasNotice(
        `Other Dues updated: ${data.added} added, ${data.removed} removed.${skippedNote}`
      );
      closeExtrasEditor();
      loadStudentData(); // refresh the payment history below
    } catch (err) {
      setExtrasError(err.response?.data?.error || 'Other Dues could not be updated.');
    } finally {
      setExtrasSaving(false);
    }
  };

  if (!student) return null;

  const initials =
    (student.name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'ST';

  const statusText = student.is_fresher
    ? student.admitted_at
      ? 'Fresher · Admitted'
      : 'Fresher'
    : 'Continuing';

  return (
    <Modal
      open
      size="wide"
      icon={<User size={20} />}
      title={student.name}
      subtitle={student.student_no ? `Student No. ${student.student_no}` : 'Student'}
      onClose={onClose}
    >
      <div className="stu-hero">
        <div className="stu-hero-avatar">{initials}</div>
        <div className="stu-hero-copy">
          <div className="stu-header-row">
            <span className={`badge ${student.is_fresher ? 'badge-gold' : 'badge-navy'}`}>
              {statusText}
            </span>
            {student.level_label && <span className="badge badge-blue">{student.level_label}</span>}
          </div>
          <div className="stu-hero-subtitle">
            {student.department_name || 'Department not assigned'}
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-title">
          <IdentificationBadge size={16} /> Student Details
        </div>
        <div className="stu-grid">
          <Detail
            icon={<IdentificationBadge size={13} />}
            label="Student Number"
            value={student.student_no}
          />
          <Detail
            icon={<GraduationCap size={13} />}
            label="Level"
            value={student.level_label || student.level}
          />
          <Detail
            icon={<CalendarBlank size={13} />}
            label="Admission Year"
            value={student.admission_year}
          />
          <Detail icon={<Phone size={13} />} label="Phone" value={student.phone} />
          <Detail icon={<Envelope size={13} />} label="Email" value={student.email} />
          <Detail icon={<User size={13} />} label="Gender" value={student.gender} />
          <Detail icon={<MapPin size={13} />} label="Hometown / Region" value={student.hometown} />
          <Detail
            icon={<GraduationCap size={13} />}
            label="Department"
            value={student.department_name}
          />
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-title">
          <ReceiptIcon size={16} /> Payment History
        </div>
        {loading ? (
          <p className="muted text-sm">Loading payment history…</p>
        ) : error ? (
          <p className="muted text-sm">{error}</p>
        ) : payments.length === 0 ? (
          <p className="muted text-sm">No payments recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
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
                {payments.map((p, i) => (
                  <tr key={`${p.receipt_number}-${p.type}-${i}`}>
                    <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                    <td>{p.academic_year || '—'}</td>
                    <td>{p.label || TYPE_LABEL[p.type] || p.type}</td>
                    <td className="fw-600">GHS {Number(p.amount).toFixed(2)}</td>
                    <td className="text-sm muted">{p.receipt_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {souvenirs.length > 0 && (
        <div className="modal-section">
          <div className="modal-section-title">
            <Gift size={16} /> Souvenirs Received
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {souvenirs.map((s, i) => (
              <span
                key={`${s.souvenir_id}-${i}`}
                className="badge badge-green"
                style={{ fontWeight: 600 }}
              >
                {s.souvenir_name}
                {s.level ? ` · ${s.level}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {canEditExtras && (
        <div className="modal-section">
          <div className="modal-section-title">
            <PencilSimple size={16} /> Other Dues
          </div>
          {extrasNotice && <div className="alert alert-success">{extrasNotice}</div>}
          {extrasError && <div className="alert alert-error">{extrasError}</div>}
          {editingExtras ? (
            <>
              <p className="muted text-sm">
                Check the items this student should be charged. Unchecking voids the existing line
                (kept as an audit record). Newly-checked items attach to the receipt of their own
                scope — school items to the school-dues receipt, department items to the department
                receipt.
              </p>
              <ExtrasEditPicker
                items={extrasItems}
                selected={extrasSelected}
                lockedIds={extrasLocked}
                onToggle={toggleExtraItem}
                onAmount={setExtraAmount}
                warnNote={(item) => genderScopeNote(item.gender, student?.gender)}
              />
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="stu-extras-reason">Reason for this change</label>
                <input
                  id="stu-extras-reason"
                  className="input"
                  value={extrasReason}
                  onChange={(e) => setExtrasReason(e.target.value)}
                  placeholder="e.g. Wrong item charged at verification"
                />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button
                  className="btn btn-outline"
                  onClick={closeExtrasEditor}
                  disabled={extrasSaving}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveExtras}
                  disabled={extrasSaving || loading}
                >
                  {extrasSaving ? 'Saving…' : 'Save Other Dues'}
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-outline" onClick={openExtrasEditor} disabled={loading}>
              <PencilSimple size={16} /> Edit Other Dues
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
