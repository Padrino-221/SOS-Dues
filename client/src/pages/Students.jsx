import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Plus, X, UserPlus, CheckCircle, Warning } from '@phosphor-icons/react';
import Select from '../components/ui/Select';
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

export default function Students() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [form, setForm] = useState({ first_name: '', middle_name: '', last_name: '', student_no: '', department_id: '', class_id: '', admission_year: new Date().getFullYear() });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const loadStudents = () => {
    api.get('/students', { params: search ? { search } : {} })
      .then((res) => setStudents(res.data))
      .catch(() => {});
  };

  useEffect(() => { setPage(1); }, [search]);
  useEffect(loadStudents, [search]);

  useEffect(() => {
    if (isSchool) api.get('/departments').then((res) => setDepts(res.data)).catch(() => {});
    api.get('/classes').then((res) => setClasses(res.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const fullName = [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ');
    try {
      await api.post('/students', {
        name: fullName,
        student_no: form.student_no || null,
        department_id: form.department_id || null,
        class_id: form.class_id || null,
        is_fresher: false,
        admission_year: form.admission_year || null,
      });
      setForm({ first_name: '', middle_name: '', last_name: '', student_no: '', department_id: '', class_id: '', admission_year: new Date().getFullYear() });
      setShowForm(false);
      addToast('Continuing student added.');
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to add student', 'error');
    }
  };

  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));
  const classOptions = classes
    .filter((c) => isSchool ? true : c.department_id === Number(user?.department_id))
    .map((c) => ({ value: c.id, label: isSchool ? `${c.department_name} - ${c.name}` : c.name }));

  return (
    <div>
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => {}} />
        ))}
      </div>

      <div className="flex between align-center mb-md">
        <div>
          <h1>Students</h1>
          <p className="subtitle">
            {isSchool
              ? 'Add and search continuing students. Manage student records and clearance status.'
              : 'View students in your department and their clearance status.'}
          </p>
        </div>
        {isSchool && (
          <button className="btn btn-green" onClick={() => setShowForm(true)}>
            <Plus size={18} /> Add Continuing Student
          </button>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Continuing Student</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={submit}>
              <div className="grid grid-3">
                <div className="field">
                  <label>First Name *</label>
                  <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Middle Name</label>
                  <input className="input" value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Last Name *</label>
                  <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-3 mt">
                <div className="field">
                  <label>Student Number *</label>
                  <input className="input" value={form.student_no} onChange={(e) => setForm({ ...form, student_no: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Department *</label>
                  {isSchool ? (
                    <Select value={form.department_id} onChange={(v) => setForm({ ...form, department_id: v, class_id: '' })} options={deptOptions} placeholder="Select department..." required />
                  ) : (
                    <input className="input" value={user.department_name} disabled />
                  )}
                </div>
                <div className="field">
                  <label>Class / Level *</label>
                  <Select value={form.class_id} onChange={(v) => setForm({ ...form, class_id: v })} options={classOptions} placeholder="Select class..." required />
                </div>
              </div>
              <div className="field mt">
                <label>Admission Year *</label>
                <input className="input" value={form.admission_year} onChange={(e) => setForm({ ...form, admission_year: e.target.value })} style={{ maxWidth: 200 }} required />
              </div>
              <div className="flex gap mt">
                <button className="btn btn-green"><UserPlus size={18} /> Add Student</button>
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <th>Department</th>
                <th>Class</th>
                <th>Clearance Status</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr><td colSpan="6" className="muted">{isSchool ? 'No students found. Click "Add Continuing Student" to register one.' : 'No students in your department yet.'}</td></tr>
              )}
              {students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.student_no || '-'}</td>
                  <td>{s.department_name || 'Pending'}</td>
                  <td>{s.class_name || '-'}</td>
                  <td>
                    <ClearanceBadge
                      schoolDuesPaid={s.school_dues_paid}
                      schoolSouvenirCollected={s.school_souvenir_collected}
                      deptDuesPaid={s.dept_dues_paid}
                      deptSouvenirCollected={s.dept_souvenir_collected}
                      compact
                    />
                  </td>
                  <td>
                    <span className={`badge ${s.is_fresher ? 'badge-gold' : 'badge-navy'}`}>
                      {s.is_fresher ? 'Fresher' : 'Continuing'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.ceil(students.length / PAGE_SIZE)}
          onPageChange={setPage}
          totalItems={students.length}
          pageSize={PAGE_SIZE}
        />
      </div>
    </div>
  );
}
