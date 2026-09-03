import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash, CheckCircle, Warning } from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import Confirm from '../components/ui/Confirm';

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

export default function Settings() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
  const [tab, setTab] = useState(isSchool ? 'departments' : 'my-dept');

  const [departments, setDepartments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [toasts, setToasts] = useState([]);

  // Forms
  const [deptForm, setDeptForm] = useState({ name: '', dues_amount: '' });
  const [classForm, setClassForm] = useState({ department_id: '', name: '', level: '' });
  const [souvenirForm, setSouvenirForm] = useState({ name: '', category: 'department', cost: '' });
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '', department_id: '' });

  // Confirm state
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const loadAll = () => {
    api.get('/departments').then((res) => setDepartments(res.data)).catch(() => {});
    api.get('/classes').then((res) => setClasses(res.data)).catch(() => {});
    api.get('/souvenirs').then((res) => setSouvenirs(res.data)).catch(() => {});
    if (isSchool) api.get('/users').then((res) => setAdmins(res.data)).catch(() => {});
  };

  useEffect(loadAll, []);

  const showConfirm = (title, message, onConfirm) => {
    setConfirm({ open: true, title, message, onConfirm });
  };

  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const categoryOptions = [{ value: 'school', label: 'School' }, { value: 'department', label: 'Department' }];

  // Current department for Dept Admin
  const myDept = isSchool ? null : departments.find((d) => d.id === user?.department_id);
  const deptSouvenirs = souvenirs.filter((s) => s.category === 'department');

  // ─── Departments (School Admin) ───
  const addDept = async (e) => {
    e.preventDefault();
    try {
      await api.post('/departments', { name: deptForm.name, dues_amount: Number(deptForm.dues_amount) || 0 });
      setDeptForm({ name: '', dues_amount: '' });
      addToast('Department added.');
      loadAll();
    } catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const updateDues = async (id, amount) => {
    try {
      await api.put(`/departments/${id}/dues`, { dues_amount: Number(amount) });
      addToast('Dues amount updated.');
      loadAll();
    } catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const deleteDept = (d) => {
    showConfirm('Delete Department', `Delete "${d.name}" and all its classes?`, async () => {
      try { await api.delete(`/departments/${d.id}`); addToast('Department deleted.'); loadAll(); }
      catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
      setConfirm({ ...confirm, open: false });
    });
  };

  // ─── Classes ───
  const addClass = async (e) => {
    e.preventDefault();
    try {
      const deptId = isSchool ? Number(classForm.department_id) : user.department_id;
      await api.post('/classes', { department_id: deptId, name: classForm.name, level: classForm.level });
      setClassForm({ department_id: '', name: '', level: '' });
      addToast('Class added.');
      loadAll();
    } catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const deleteClass = (c) => {
    showConfirm('Delete Class', `Delete "${c.name}"?`, async () => {
      try { await api.delete(`/classes/${c.id}`); addToast('Class deleted.'); loadAll(); }
      catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
      setConfirm({ ...confirm, open: false });
    });
  };

  // ─── Souvenirs ───
  const addSouvenir = async (e) => {
    e.preventDefault();
    try {
      const category = isSchool ? souvenirForm.category : 'department';
      await api.post('/souvenirs', { name: souvenirForm.name, category, cost: Number(souvenirForm.cost) || 0 });
      setSouvenirForm({ name: '', category: 'department', cost: '' });
      addToast('Souvenir added.');
      loadAll();
    } catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const deleteSouvenir = (s) => {
    showConfirm('Delete Souvenir', `Delete "${s.name}"?`, async () => {
      try { await api.delete(`/souvenirs/${s.id}`); addToast('Souvenir deleted.'); loadAll(); }
      catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
      setConfirm({ ...confirm, open: false });
    });
  };

  // ─── Admins ───
  const addAdmin = async (e) => {
    e.preventDefault();
    try {
      await api.post('/users', { name: adminForm.name, email: adminForm.email, password: adminForm.password, department_id: Number(adminForm.department_id) });
      setAdminForm({ name: '', email: '', password: '', department_id: '' });
      addToast('Department admin created.');
      loadAll();
    } catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const deleteAdmin = (a) => {
    showConfirm('Delete Admin', `Delete admin "${a.name}"?`, async () => {
      try { await api.delete(`/users/${a.id}`); addToast('Admin deleted.'); loadAll(); }
      catch (err) { addToast(err.response?.data?.error || 'Failed', 'error'); }
      setConfirm({ ...confirm, open: false });
    });
  };

  const tabs = isSchool
    ? [['departments', 'Departments'], ['classes', 'Classes'], ['souvenirs', 'Souvenirs'], ['admins', 'Dept Admins']]
    : [['my-dept', 'My Department'], ['classes', 'Classes'], ['my-souvenirs', 'Dept Souvenirs']];

  return (
    <div>
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => {}} />
        ))}
      </div>

      <Confirm
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm({ ...confirm, open: false })}
        danger
      />

      <div className="mb-md">
        <h1>Settings</h1>
        <p className="subtitle">
          {isSchool
            ? 'Configure departments, dues amounts, classes, souvenirs and department admins.'
            : `Configure your department (${user.department_name}): dues amount, classes, and department souvenirs.`}
        </p>
      </div>

      <div className="tabs mb-md">
        {tabs.map(([key, label]) => (
          <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── My Department (Dept Admin) ─── */}
      {tab === 'my-dept' && !isSchool && myDept && (
        <div className="card">
          <h3 className="mb">Configure Department Dues</h3>
          <p className="muted text-sm mb">Set the dues amount that will be charged to students in your department.</p>
          <div className="grid grid-2">
            <div className="field">
              <label>Department Name</label>
              <input className="input" value={myDept.name} disabled />
            </div>
            <div className="field">
              <label>Dues Amount (GHS)</label>
              <div className="flex gap-sm">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={myDept.dues_amount}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== Number(myDept.dues_amount)) {
                      updateDues(myDept.id, e.target.value);
                    }
                  }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => {
                    const input = e.target.closest('.flex').querySelector('input');
                    if (Number(input.value) !== Number(myDept.dues_amount)) {
                      updateDues(myDept.id, input.value);
                    }
                  }}
                >Save</button>
              </div>
            </div>
          </div>
          <div className="mt-md">
            <p className="text-sm muted">
              <strong>Access Code:</strong> <span className="code-cell">{myDept.code}</span>
              {' '}(share this with your class representatives)
            </p>
          </div>
        </div>
      )}

      {/* ─── Departments (School Admin) ─── */}
      {tab === 'departments' && isSchool && (
        <>
          <div className="card">
            <h3 className="mb">Add Department</h3>
            <form onSubmit={addDept} className="grid grid-2">
              <div className="field"><label>Department Name *</label><input className="input" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required /></div>
              <div className="field"><label>Dues Amount (GHS)</label><input className="input" type="number" step="0.01" min="0" value={deptForm.dues_amount} onChange={(e) => setDeptForm({ ...deptForm, dues_amount: e.target.value })} /></div>
              <div><button className="btn btn-primary"><Plus size={18} /> Add Department</button></div>
            </form>
          </div>
          <div className="card">
            <h3 className="mb">Departments & Dues</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Department</th><th>Access Code</th><th>Classes</th><th>Students</th><th>Dues Amount</th><th></th></tr></thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td><span className="code-cell">{d.code}</span></td>
                      <td>{d.class_count}</td>
                      <td>{d.student_count}</td>
                      <td>
                        <input className="input" type="number" step="0.01" min="0" defaultValue={d.dues_amount} style={{ width: 120 }}
                          onBlur={(e) => Number(e.target.value) !== Number(d.dues_amount) && updateDues(d.id, e.target.value)} />
                      </td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => deleteDept(d)}><Trash size={14} /> Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── Classes ─── */}
      {tab === 'classes' && (
        <>
          <div className="card">
            <h3 className="mb">Add Class / Level</h3>
            {!isSchool && <p className="muted text-sm mb">Add classes to your department ({user.department_name}).</p>}
            <form onSubmit={addClass} className="grid grid-3">
              <div className="field">
                <label>Department *</label>
                {isSchool ? (
                  <Select value={classForm.department_id} onChange={(v) => setClassForm({ ...classForm, department_id: v })} options={deptOptions} placeholder="Select..." />
                ) : (
                  <input className="input" value={user.department_name} disabled />
                )}
              </div>
              <div className="field"><label>Class Name *</label><input className="input" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. Level 400" required /></div>
              <div className="field"><label>Level</label><input className="input" value={classForm.level} onChange={(e) => setClassForm({ ...classForm, level: e.target.value })} placeholder="e.g. 400" /></div>
              <div><button className="btn btn-primary"><Plus size={18} /> Add Class</button></div>
            </form>
          </div>
          <div className="card">
            <h3 className="mb">Classes</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Class</th><th>Department</th><th>Level</th><th></th></tr></thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.department_name}</td>
                      <td>{c.level}</td>
                      <td>{isSchool && <button className="btn btn-danger btn-sm" onClick={() => deleteClass(c)}><Trash size={14} /> Delete</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── Souvenirs (School Admin — all categories) ─── */}
      {tab === 'souvenirs' && isSchool && (
        <>
          <div className="card">
            <h3 className="mb">Add Souvenir</h3>
            <form onSubmit={addSouvenir} className="grid grid-3">
              <div className="field"><label>Name *</label><input className="input" value={souvenirForm.name} onChange={(e) => setSouvenirForm({ ...souvenirForm, name: e.target.value })} required /></div>
              <div className="field">
                <label>Category</label>
                <Select value={souvenirForm.category} onChange={(v) => setSouvenirForm({ ...souvenirForm, category: v })} options={categoryOptions} />
              </div>
              <div className="field"><label>Cost (GHS)</label><input className="input" type="number" step="0.01" min="0" value={souvenirForm.cost} onChange={(e) => setSouvenirForm({ ...souvenirForm, cost: e.target.value })} /></div>
              <div><button className="btn btn-primary"><Plus size={18} /> Add Souvenir</button></div>
            </form>
          </div>
          <div className="card">
            <h3 className="mb">Souvenirs</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Category</th><th>Cost</th><th></th></tr></thead>
                <tbody>
                  {souvenirs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td><span className={`badge ${s.category === 'school' ? 'badge-navy' : 'badge-green'}`}>{s.category}</span></td>
                      <td>GHS {Number(s.cost).toFixed(2)}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => deleteSouvenir(s)}><Trash size={14} /> Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── Department Souvenirs (Dept Admin) ─── */}
      {tab === 'my-souvenirs' && !isSchool && (
        <>
          <div className="card">
            <h3 className="mb">Add Department Souvenir</h3>
            <form onSubmit={addSouvenir} className="grid grid-3">
              <div className="field"><label>Name *</label><input className="input" value={souvenirForm.name} onChange={(e) => setSouvenirForm({ ...souvenirForm, name: e.target.value })} required /></div>
              <div className="field"><label>Cost (GHS)</label><input className="input" type="number" step="0.01" min="0" value={souvenirForm.cost} onChange={(e) => setSouvenirForm({ ...souvenirForm, cost: e.target.value })} /></div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-primary"><Plus size={18} /> Add Souvenir</button></div>
            </form>
          </div>
          <div className="card">
            <h3 className="mb">Department Souvenirs</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Cost</th><th></th></tr></thead>
                <tbody>
                  {deptSouvenirs.length === 0 && (
                    <tr><td colSpan="3" className="muted">No department souvenirs configured.</td></tr>
                  )}
                  {deptSouvenirs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>GHS {Number(s.cost).toFixed(2)}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => deleteSouvenir(s)}><Trash size={14} /> Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── Admins (School Admin only) ─── */}
      {tab === 'admins' && isSchool && (
        <>
          <div className="card">
            <h3 className="mb">Create Department Admin</h3>
            <form onSubmit={addAdmin} className="grid grid-2">
              <div className="field"><label>Full Name *</label><input className="input" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} required /></div>
              <div className="field"><label>Email *</label><input className="input" type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} required /></div>
              <div className="field"><label>Password *</label><input className="input" type="password" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} required /></div>
              <div className="field">
                <label>Department *</label>
                <Select value={adminForm.department_id} onChange={(v) => setAdminForm({ ...adminForm, department_id: v })} options={deptOptions} placeholder="Select..." required />
              </div>
              <div><button className="btn btn-primary"><Plus size={18} /> Create Admin</button></div>
            </form>
          </div>
          <div className="card">
            <h3 className="mb">Department Admins</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Department</th><th></th></tr></thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.email}</td>
                      <td>{a.department_name || '-'}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => deleteAdmin(a)}><Trash size={14} /> Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
