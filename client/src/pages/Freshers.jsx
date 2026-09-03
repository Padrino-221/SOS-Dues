import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  UserPlus, Plus, X, Users, CheckCircle, Warning,
  Pencil, Trash, CurrencyCircleDollar, Gift,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import DatePicker from '../components/ui/DatePicker';
import Confirm from '../components/ui/Confirm';
import ClearanceBadge from '../components/ui/ClearanceBadge';
import Pagination from '../components/ui/Pagination';

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <CheckCircle size={18} /> : <Warning size={18} />}
      {message}
    </div>
  );
}

const emptyStudent = { first_name: '', middle_name: '', last_name: '', student_no: '', admission_year: new Date().getFullYear() };
const emptyPayment = { amount: '', method: 'cash', paid_at: new Date().toISOString().slice(0, 10) };

export default function Freshers() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';

  const [freshers, setFreshers] = useState([]);
  const [search, setSearch] = useState('');
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [toasts, setToasts] = useState([]);

  // Register modal state (School Admin only)
  const [showRegister, setShowRegister] = useState(false);
  const [editing, setEditing] = useState(null);
  const [studentForm, setStudentForm] = useState(emptyStudent);
  const [schoolPayment, setSchoolPayment] = useState(emptyPayment);
  const [schoolSouvenirs, setSchoolSouvenirs] = useState([]);
  const [existingPaymentId, setExistingPaymentId] = useState(null);

  // Adopt modal state (Dept Admin / School Admin assigning)
  const [selected, setSelected] = useState(null);
  const [deptId, setDeptId] = useState('');
  const [classId, setClassId] = useState('');
  const [deptPayment, setDeptPayment] = useState(emptyPayment);
  const [deptSouvenirs, setDeptSouvenirs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Confirm dialog state
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null, danger: false });

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadFreshers = () => {
    const endpoint = isSchool ? '/students' : '/students/freshers/pending';
    api.get(endpoint, { params: search ? { search } : {} })
      .then((res) => {
        setFreshers(isSchool ? res.data.filter((s) => s.is_fresher) : res.data);
      })
      .catch(() => {});
  };

  useEffect(() => { setPage(1); }, [search]);
  useEffect(loadFreshers, [search, isSchool]);

  useEffect(() => {
    if (isSchool) api.get('/departments').then((res) => setDepts(res.data)).catch(() => {});
    api.get('/classes').then((res) => setClasses(res.data)).catch(() => {});
    api.get('/souvenirs').then((res) => setSouvenirs(res.data)).catch(() => {});
  }, []);

  const schoolSouvenirList = souvenirs.filter((s) => s.category === 'school');
  const deptSouvenirList = souvenirs.filter((s) => s.category === 'department');

  const methodOptions = [
    { value: 'cash', label: 'Cash' },
    { value: 'momo', label: 'Mobile Money' },
    { value: 'bank', label: 'Bank Transfer' },
  ];

  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));
  const classOptions = classes
    .filter((c) => c.department_id === Number(deptId || user?.department_id))
    .map((c) => ({ value: c.id, label: `${c.name} (${c.level})` }));

  // ─── Register / Edit Fresher (School Admin only) ───
  const openCreate = () => {
    setEditing(null);
    setStudentForm(emptyStudent);
    setSchoolPayment(emptyPayment);
    setSchoolSouvenirs([]);
    setShowRegister(true);
  };

  const openEdit = (f) => {
    setEditing(f);
    const parts = (f.name || '').split(' ');
    setStudentForm({
      first_name: parts[0] || '',
      middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
      last_name: parts.length > 1 ? parts[parts.length - 1] : '',
      student_no: f.student_no || '',
      admission_year: f.admission_year || '',
    });
    setSchoolPayment(emptyPayment);
    setSchoolSouvenirs([]);
    setExistingPaymentId(null);
    setShowRegister(true);

    // Load existing school payment and souvenirs
    Promise.all([
      api.get(`/payments`, { params: { type: 'school_dues', student_id: f.id } }).catch(() => ({ data: [] })),
      api.get(`/students/${f.id}/souvenirs`).catch(() => ({ data: [] })),
    ]).then(([paymentsRes, souvenirsRes]) => {
      const existing = paymentsRes.data.find((p) => p.student_id === f.id);
      if (existing) {
        setExistingPaymentId(existing.id);
        setSchoolPayment({
          amount: String(existing.amount),
          method: existing.method,
          paid_at: existing.paid_at ? existing.paid_at.slice(0, 10) : '',
        });
      }
      const schoolIds = souvenirsRes.data.filter((s) => s.level === 'school').map((s) => s.souvenir_id);
      setSchoolSouvenirs(schoolIds);
    }).catch(() => {});
  };

  const buildName = () => {
    const { first_name, middle_name, last_name } = studentForm;
    return [first_name, middle_name, last_name].filter(Boolean).join(' ');
  };

  const saveFresher = async (e) => {
    e.preventDefault();
    const fullName = buildName();

    if (!editing) {
      if (!schoolPayment.amount || Number(schoolPayment.amount) <= 0) {
        addToast('School dues amount is required.', 'error');
        return;
      }
      if (!schoolPayment.paid_at) {
        addToast('School dues date is required.', 'error');
        return;
      }
      if (isSchool && schoolSouvenirList.length > 0 && schoolSouvenirs.length === 0) {
        addToast('Please select at least one school souvenir.', 'error');
        return;
      }
    }

    try {
      let studentId;
      if (editing) {
        await api.put(`/students/${editing.id}`, {
          name: fullName,
          student_no: studentForm.student_no || null,
          admission_year: studentForm.admission_year || null,
          is_fresher: true,
          department_id: editing.department_id || null,
          class_id: editing.class_id || null,
        });
        studentId = editing.id;

        if (schoolPayment.amount && Number(schoolPayment.amount) > 0 && schoolPayment.paid_at) {
          if (existingPaymentId) {
            await api.put(`/payments/${existingPaymentId}`, {
              amount: Number(schoolPayment.amount),
              method: schoolPayment.method,
              paid_at: schoolPayment.paid_at,
            });
          } else {
            await api.post(`/payments/students/${studentId}/pay`, {
              type: 'school_dues',
              amount: Number(schoolPayment.amount),
              method: schoolPayment.method,
              paid_at: schoolPayment.paid_at,
              souvenir_ids: schoolSouvenirs.length > 0 ? schoolSouvenirs : undefined,
            });
          }
          addToast('Fresher updated and school dues recorded.');
        } else {
          addToast('Fresher updated.');
        }
      } else {
        const res = await api.post('/students', {
          name: fullName,
          student_no: studentForm.student_no || null,
          is_fresher: true,
          admission_year: studentForm.admission_year || null,
        });
        studentId = res.data.id;

        await api.post(`/payments/students/${studentId}/pay`, {
          type: 'school_dues',
          amount: Number(schoolPayment.amount),
          method: schoolPayment.method,
          paid_at: schoolPayment.paid_at || undefined,
          souvenir_ids: schoolSouvenirs.length > 0 ? schoolSouvenirs : undefined,
        });
        addToast('Fresher registered and school dues recorded.');
      }
      setShowRegister(false);
      loadFreshers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Operation failed', 'error');
    }
  };

  // ─── Delete Fresher (School Admin only) ───
  const deleteFresher = (f) => {
    setConfirm({
      open: true,
      title: 'Delete Fresher',
      message: `Are you sure you want to delete ${f.name}? This action cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/students/${f.id}`);
          addToast(`${f.name} deleted.`);
          loadFreshers();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed to delete', 'error');
        }
        setConfirm({ ...confirm, open: false });
      },
    });
  };

  // ─── Adopt Fresher (Dept Admin or School Admin) ───
  const openAdopt = (f) => {
    setSelected(f);
    const autoDeptId = isSchool ? '' : String(user.department_id || '');
    setDeptId(autoDeptId);
    setClassId('');
    const dept = depts.find((d) => d.id === Number(autoDeptId));
    setDeptPayment({ ...emptyPayment, amount: String(dept?.dues_amount || '') });
    setDeptSouvenirs([]);
  };

  const handleDeptChange = (id) => {
    setDeptId(id);
    setClassId('');
    const dept = depts.find((d) => d.id === Number(id));
    if (dept) setDeptPayment((p) => ({ ...p, amount: String(dept.dues_amount || '') }));
  };

  const adopt = async () => {
    setLoading(true);
    try {
      if (!deptPayment.amount || Number(deptPayment.amount) <= 0) {
        addToast('Department dues amount is required.', 'error');
        setLoading(false);
        return;
      }
      if (!deptPayment.paid_at) {
        addToast('Department dues date is required.', 'error');
        setLoading(false);
        return;
      }

      await api.post('/students/freshers/pending/adopt', {
        student_id: selected.id,
        department_id: deptId,
        class_id: classId || undefined,
      });

      await api.post(`/payments/students/${selected.id}/pay`, {
        type: 'department_dues',
        amount: Number(deptPayment.amount),
        method: deptPayment.method,
        paid_at: deptPayment.paid_at || undefined,
      });

      if (deptSouvenirs.length > 0) {
        await api.post(`/payments/students/${selected.id}/souvenirs/department`, {
          souvenir_ids: deptSouvenirs,
        });
      }

      addToast(`${selected.name} assigned to department.`);
      setSelected(null);
      loadFreshers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to assign fresher', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatus = (f) => {
    if (f.department_name) return { label: 'Adopted', cls: 'badge-green' };
    return { label: 'Pending', cls: 'badge-gold' };
  };

  return (
    <div>
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      <Confirm
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm({ ...confirm, open: false })}
        danger={confirm.danger}
      />

      <div className="flex between align-center mb-md">
        <div>
          <h1><Users size={28} style={{ marginRight: 10, verticalAlign: -5 }} />{isSchool ? 'All Freshers' : 'Pending Freshers'}</h1>
          <p className="subtitle">
            {isSchool
              ? 'Register freshers, record school dues and school souvenirs. Department admins will assign them.'
              : 'Assign pending freshers to your department, record department dues and department souvenirs.'}
          </p>
        </div>
        {isSchool && (
          <button className="btn btn-green" onClick={openCreate}>
            <Plus size={18} /> Register Fresher
          </button>
        )}
      </div>

      {/* ─── Register / Edit Modal (School Admin only) ─── */}
      {showRegister && (
        <div className="modal-backdrop" onClick={() => setShowRegister(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Fresher' : 'Register a Fresher'}</h3>
              <button className="modal-close" onClick={() => setShowRegister(false)}><X size={18} /></button>
            </div>
            <form onSubmit={saveFresher}>
              <div className="modal-section">
                <div className="modal-section-title"><Users size={16} /> Student Details</div>
                <div className="grid grid-3">
                  <div className="field">
                    <label>First Name *</label>
                    <input className="input" value={studentForm.first_name} onChange={(e) => setStudentForm({ ...studentForm, first_name: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Middle Name</label>
                    <input className="input" value={studentForm.middle_name} onChange={(e) => setStudentForm({ ...studentForm, middle_name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Last Name *</label>
                    <input className="input" value={studentForm.last_name} onChange={(e) => setStudentForm({ ...studentForm, last_name: e.target.value })} required />
                  </div>
                </div>
                <div className="grid grid-2 mt">
                  <div className="field">
                    <label>Student Number *</label>
                    <input className="input" value={studentForm.student_no} onChange={(e) => setStudentForm({ ...studentForm, student_no: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Admission Year *</label>
                    <input className="input" value={studentForm.admission_year} onChange={(e) => setStudentForm({ ...studentForm, admission_year: e.target.value })} required />
                  </div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-title"><CurrencyCircleDollar size={16} /> School Dues Payment {editing ? '' : '*'}</div>
                <div className="grid grid-3">
                  <div className="field">
                    <label>Amount (GHS) {editing ? '' : '*'}</label>
                    <input className="input" type="number" step="0.01" min="0" value={schoolPayment.amount} onChange={(e) => setSchoolPayment({ ...schoolPayment, amount: e.target.value })} required={!editing} />
                  </div>
                  <div className="field">
                    <label>Method {editing ? '' : '*'}</label>
                    <Select value={schoolPayment.method} onChange={(v) => setSchoolPayment({ ...schoolPayment, method: v })} options={methodOptions} required={!editing} />
                  </div>
                  <div className="field">
                    <label>Date {editing ? '' : '*'}</label>
                    <DatePicker value={schoolPayment.paid_at} onChange={(v) => setSchoolPayment({ ...schoolPayment, paid_at: v })} required={!editing} />
                  </div>
                </div>
              </div>

              {isSchool && schoolSouvenirList.length > 0 && (
                <div className="modal-section">
                    <div className="modal-section-title"><Gift size={16} /> School Souvenirs {editing ? '' : '*'}</div>
                  <div className="grid grid-3">
                    {schoolSouvenirList.map((s) => (
                      <Checkbox
                        key={s.id}
                        checked={schoolSouvenirs.includes(s.id)}
                        onChange={() => setSchoolSouvenirs((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                        label={s.name}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap mt">
                <button
                  className="btn btn-green"
                  disabled={
                    !studentForm.first_name.trim() ||
                    !studentForm.last_name.trim() ||
                    !studentForm.student_no.trim() ||
                    !studentForm.admission_year ||
                    (!editing && (
                      !schoolPayment.amount || Number(schoolPayment.amount) <= 0 ||
                      !schoolPayment.paid_at ||
                      (isSchool && schoolSouvenirList.length > 0 && schoolSouvenirs.length === 0)
                    ))
                  }
                >
                  {editing ? <><CheckCircle size={18} /> Save Changes</> : <><UserPlus size={18} /> Register Fresher</>}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setShowRegister(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Table ─── */}
      <div className="card">
        <div className="field" style={{ maxWidth: 400 }}>
          <input
            className="input search-input"
            placeholder="Search by name or student number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Student No</th>
                <th>Clearance Status</th>
                <th>Department</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {freshers.length === 0 && (
                <tr><td colSpan={5} className="muted">{isSchool ? 'No freshers registered yet. Click "Register Fresher" to add one.' : 'No pending freshers to assign. Freshers appear here after the School Admin registers them.'}</td></tr>
              )}
              {freshers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((f) => {
                const status = getStatus(f);
                return (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{f.student_no || '-'}</td>
                    <td>
                      <ClearanceBadge
                        schoolDuesPaid={f.school_dues_paid}
                        schoolSouvenirCollected={f.school_souvenir_collected}
                        deptDuesPaid={f.dept_dues_paid}
                        deptSouvenirCollected={f.dept_souvenir_collected}
                        compact
                      />
                    </td>
                    <td>
                      <span className={`badge ${status.cls}`}>{status.label}</span>
                      {f.department_name && <span className="muted text-xs" style={{ marginLeft: 6 }}>{f.department_name}</span>}
                    </td>
                    <td>
                      <div className="flex gap-sm">
                        {!isSchool && !f.department_id && (
                          <button className="btn btn-sm btn-primary" onClick={() => openAdopt(f)}>
                            <UserPlus size={14} /> Assign
                          </button>
                        )}
                        {isSchool && (
                          <>
                            <button className="btn btn-sm btn-outline" onClick={() => openEdit(f)}>
                              <Pencil size={14} />
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => deleteFresher(f)}>
                              <Trash size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.ceil(freshers.length / PAGE_SIZE)}
          onPageChange={setPage}
          totalItems={freshers.length}
          pageSize={PAGE_SIZE}
        />
      </div>

      {/* ─── Adopt Modal ─── */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Assign {selected.name}</h3>
              <button className="modal-close" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            {/* Show inherited school clearance status */}
            <div className="modal-section" style={{ background: selected.school_dues_paid ? 'var(--green-light)' : 'var(--amber-light)', borderColor: selected.school_dues_paid ? '#BBF7D0' : '#FDE68A' }}>
              <div className="modal-section-title">
                {selected.school_dues_paid ? <CheckCircle size={16} color="var(--green)" /> : <Warning size={16} color="var(--amber)" />}
                School Clearance Status
              </div>
              <ClearanceBadge
                schoolDuesPaid={selected.school_dues_paid}
                schoolSouvenirCollected={selected.school_souvenir_collected}
                deptDuesPaid={false}
                deptSouvenirCollected={false}
                compact={false}
              />
            </div>

            <div className="modal-section">
              <div className="modal-section-title"><Users size={16} /> Department Assignment</div>
              <div className="grid grid-2">
                <div className="field">
                  <label>Department *</label>
                  {isSchool ? (
                    <Select value={deptId} onChange={handleDeptChange} options={deptOptions} placeholder="Select department..." required />
                  ) : (
                    <input className="input" value={user.department_name} disabled />
                  )}
                </div>
                <div className="field">
                  <label>Class / Level *</label>
                  <Select value={classId} onChange={setClassId} options={classOptions} placeholder="Select class..." disabled={!deptId} required />
                </div>
              </div>
            </div>

            <div className="modal-section">
              <div className="modal-section-title"><CurrencyCircleDollar size={16} /> Department Dues Payment *</div>
              <div className="grid grid-3">
                <div className="field">
                  <label>Amount (GHS) *</label>
                  <input className="input" type="number" step="0.01" min="0" value={deptPayment.amount} onChange={(e) => setDeptPayment({ ...deptPayment, amount: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Method *</label>
                  <Select value={deptPayment.method} onChange={(v) => setDeptPayment({ ...deptPayment, method: v })} options={methodOptions} required />
                </div>
                <div className="field">
                  <label>Date *</label>
                  <DatePicker value={deptPayment.paid_at} onChange={(v) => setDeptPayment({ ...deptPayment, paid_at: v })} required />
                </div>
              </div>
            </div>

            {deptSouvenirList.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-title"><Gift size={16} /> Department Souvenirs *</div>
                <div className="grid grid-3">
                  {deptSouvenirList.map((s) => (
                    <Checkbox
                      key={s.id}
                      checked={deptSouvenirs.includes(s.id)}
                      onChange={() => setDeptSouvenirs((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                      label={s.name}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap mt">
              <button
                className="btn btn-green"
                onClick={adopt}
                disabled={loading || (!deptId && isSchool) || !classId || !deptPayment.amount || Number(deptPayment.amount) <= 0 || !deptPayment.paid_at || (deptSouvenirList.length > 0 && deptSouvenirs.length === 0)}
              >
                {loading ? 'Assigning...' : <><UserPlus size={18} /> Assign & Record Dues</>}
              </button>
              <button className="btn btn-outline" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
