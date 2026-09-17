import { useEffect, useState } from 'react';
import {
  User,
  IdentificationBadge,
  Buildings,
  GraduationCap,
  Phone,
  Envelope,
  MapPin,
  CalendarBlank,
  Receipt as ReceiptIcon,
  Gift,
} from '@phosphor-icons/react';
import Modal from './Modal';
import api from '../../api/client';

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
};

export default function StudentDetailsModal({ student, onClose }) {
  const [payments, setPayments] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!student?.id) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/students/${student.id}/payments`),
      api.get(`/students/${student.id}/souvenirs`),
    ])
      .then(([p, s]) => {
        setPayments(p.data);
        setSouvenirs(s.data);
      })
      .catch(() => setError('Student data could not be loaded.'))
      .finally(() => setLoading(false));
  }, [student?.id]);

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
            {student.level_label && !student.is_graduated && <span className="badge badge-blue">{student.level_label}</span>}
            {student.class_name && !student.is_graduated && <span className="badge badge-gray">{student.class_name}</span>}
            {student.is_graduated && <span className="badge badge-red">Graduated</span>}
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
          <Detail icon={<Buildings size={13} />} label="Class" value={student.class_name} />
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
                    <td>{TYPE_LABEL[p.type] || p.type}</td>
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
    </Modal>
  );
}
