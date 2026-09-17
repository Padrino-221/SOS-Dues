import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Trash,
  PencilSimple,
  CheckCircle,
  Warning,
  Copy,
  Building,
  Gift,
  Users,
  Crown,
  Books,
  Eye,
  PaperPlaneTilt,
  LockKey,
} from '@phosphor-icons/react';
import Confirm from '../components/ui/Confirm';
import Modal from '../components/ui/Modal';
import PasswordInput from '../components/ui/PasswordInput';
import Select from '../components/ui/Select';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';

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
  const [schoolAdmins, setSchoolAdmins] = useState([]);
  const [deptStaff, setDeptStaff] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [loadError, setLoadError] = useState('');

  // Forms
  const [deptForm, setDeptForm] = useState({ name: '' });
  const [classForm, setClassForm] = useState({ name: '', level: '' });
  const [schoolSouvenirForm, setSchoolSouvenirForm] = useState({ name: '', cost: '' });
  const [deptSouvenirForm, setDeptSouvenirForm] = useState({ name: '', cost: '' });
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    password: '',
    department_id: '',
  });
  const [schoolAdminForm, setSchoolAdminForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [deptStaffForm, setDeptStaffForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [schoolDuesInput, setSchoolDuesInput] = useState('');
  const [activeAcademicYear, setActiveAcademicYear] = useState('');
  const [deptDuesInput, setDeptDuesInput] = useState('');
  const [repPinInput, setRepPinInput] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeInput, setAccessCodeInput] = useState('');

  // Confirm state
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });

  // Modal state
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showSchoolSouvenirModal, setShowSchoolSouvenirModal] = useState(false);
  const [showSchoolStaffModal, setShowSchoolStaffModal] = useState(false);
  const [showDeptStaffModal, setShowDeptStaffModal] = useState(false);
  const [showDeptAdminModal, setShowDeptAdminModal] = useState(false);
  const [showDeptSouvenirModal, setShowDeptSouvenirModal] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);

  // Rows currently being edited (null = the modal is in "create" mode).
  const [editingDept, setEditingDept] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [editingSchoolSouvenir, setEditingSchoolSouvenir] = useState(null);
  const [editingDeptSouvenir, setEditingDeptSouvenir] = useState(null);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editingSchoolStaff, setEditingSchoolStaff] = useState(null);
  const [editingDeptStaff, setEditingDeptStaff] = useState(null);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadAll = useCallback(() => {
    setLoadError('');
    api
      .get('/departments')
      .then((res) => {
        setDepartments(res.data);
        if (!isSchool && res.data[0]) setDeptDuesInput(res.data[0].dues_amount || '');
      })
      .catch(() => setLoadError('Department data could not be loaded.'));
    api
      .get('/classes')
      .then((res) => setClasses(res.data))
      .catch(() => setLoadError('Class data could not be loaded.'));
    api
      .get('/souvenirs')
      .then((res) => setSouvenirs(res.data))
      .catch(() => setLoadError('Souvenir data could not be loaded.'));
    api
      .get('/settings')
      .then((res) => {
        setSchoolDuesInput(res.data?.school_dues_amount || '');
        setActiveAcademicYear(res.data?.active_academic_year || '');
        setAccessCode(res.data?.fresher_access_code || '');
        setAccessCodeInput(res.data?.fresher_access_code || '');
      })
      .catch(() => setLoadError('Settings data could not be loaded.'));
    if (isSchool) {
      api
        .get('/users', { params: { role: 'dept_admin' } })
        .then((res) => setAdmins(res.data.filter((u) => u.role === 'dept_admin')))
        .catch(() => setLoadError('Admin data could not be loaded.'));
      api
        .get('/users', { params: { role: 'school_staff' } })
        .then((res) => setSchoolAdmins(res.data.filter((u) => u.role === 'school_staff')))
        .catch(() => setLoadError('Admin data could not be loaded.'));
    } else {
      api
        .get('/users', { params: { role: 'dept_staff' } })
        .then((res) => setDeptStaff(res.data.filter((u) => u.role === 'dept_staff')))
        .catch(() => setLoadError('Staff data could not be loaded.'));
    }
  }, [isSchool]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showConfirm = (title, message, onConfirm) => {
    setConfirm({ open: true, title, message, onConfirm });
  };

  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  const myDept = isSchool ? null : departments.find((d) => d.id === user?.department_id);

  // For a Dept Admin, GET /souvenirs returns ONLY their own department's items.
  // For a School Admin it returns everything (school items + every dept's).
  const schoolSouvenirs = souvenirs.filter((s) => s.category === 'school');
  const deptSouvenirs = isSchool ? souvenirs.filter((s) => s.category === 'department') : souvenirs; // dept-scoped already

  const deptPager = usePagination(departments, 8);
  const schoolSouvenirsPager = usePagination(schoolSouvenirs, 8);
  const deptSouvenirsReadPager = usePagination(isSchool ? deptSouvenirs : [], 8);
  const deptOwnSouvPager = usePagination(!isSchool ? deptSouvenirs : [], 8);
  const adminPager = usePagination(admins, 8);
  const schoolAdminPager = usePagination(schoolAdmins, 8);
  const deptStaffPager = usePagination(deptStaff, 8);
  const classPager = usePagination(classes, 8);

  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(`${what} copied to clipboard.`);
    } catch {
      addToast('Could not copy automatically — select and copy manually.', 'error');
    }
  };

  const copyCode = async (code) => {
    await copyText(code, 'Department code');
  };

  // ─── School-wide dues (School Admin) ───
  const saveSchoolDues = async () => {
    try {
      await api.put('/settings/school_dues_amount', { value: Number(schoolDuesInput) });
      addToast('School-wide dues amount updated.');
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
    }
  };

  const saveActiveAcademicYear = async () => {
    const value = activeAcademicYear.trim();
    if (!/^\d{4}\/\d{4}$/.test(value)) {
      addToast('Use the format YYYY/YYYY, for example 2026/2027.', 'error');
      return;
    }
    try {
      const res = await api.put('/settings/active_academic_year', { value });
      setActiveAcademicYear(res.data.active_academic_year);
      addToast(`Active academic year set to ${res.data.active_academic_year}.`);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update academic year', 'error');
    }
  };

  // ─── Fresher pre-registration access code (School Admin) ───
  const saveAccessCode = async () => {
    const v = accessCodeInput.trim();
    if (v.length < 4) {
      addToast('Access code must be at least 4 characters.', 'error');
      return;
    }
    try {
      await api.put('/settings/fresher_access_code', { value: v });
      setAccessCode(v);
      addToast('Pre-registration access code updated.');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
    }
  };

  // ─── Dept collector PIN (owning Dept Admin) ───
  const saveRepPin = async () => {
    const v = repPinInput.trim();
    if (!/^\d{4,8}$/.test(v)) {
      addToast('PIN must be 4–8 digits.', 'error');
      return;
    }
    try {
      await api.put(`/departments/${user.department_id}/pin`, { pin: v });
      setRepPinInput('');
      addToast('Collector PIN saved. Reps will need it before recording payments.');
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save PIN', 'error');
    }
  };

  const removeRepPin = () => {
    showConfirm(
      'Remove Collector PIN',
      'Recording will stay open to anyone with the department code until a new PIN is set. Remove it?',
      async () => {
        try {
          await api.delete(`/departments/${user.department_id}/pin`);
          setRepPinInput('');
          addToast('Collector PIN removed. Set a new one to protect recording.');
          loadAll();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed to remove PIN', 'error');
        }
        setConfirm({ ...confirm, open: false });
      }
    );
  };

  // ─── Dept dues (owning Dept Admin) ───
  const saveDeptDues = async () => {
    try {
      await api.put(`/departments/${user.department_id}/dues`, {
        dues_amount: Number(deptDuesInput),
      });
      addToast('Your department dues amount updated.');
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
    }
  };

  // ─── Departments (School Admin — structure only; dues are the dept's own) ───
  const openDeptCreate = () => {
    setEditingDept(null);
    setDeptForm({ name: '' });
    setShowDeptModal(true);
  };

  const openDeptEdit = (d) => {
    setEditingDept(d);
    setDeptForm({ name: d.name });
    setShowDeptModal(true);
  };

  const saveDept = async (e) => {
    e.preventDefault();
    try {
      if (editingDept) {
        await api.put(`/departments/${editingDept.id}`, {
          name: deptForm.name,
          dues_amount: editingDept.dues_amount,
        });
        addToast('Department updated.');
      } else {
        await api.post('/departments', { name: deptForm.name, dues_amount: 0 });
        addToast('Department added. Its admin will set the department dues amount.');
      }
      setDeptForm({ name: '' });
      setEditingDept(null);
      setShowDeptModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteDept = (d) => {
    showConfirm(
      'Delete Department',
      `Delete "${d.name}" and all its classes, students and admins? This cannot be undone.`,
      async () => {
        try {
          await api.delete(`/departments/${d.id}`);
          addToast('Department deleted.');
          loadAll();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed', 'error');
        }
        setConfirm({ ...confirm, open: false });
      }
    );
  };

  // ─── Classes (Dept Admin creates own) ───
  const openClassCreate = () => {
    setEditingClass(null);
    setClassForm({ name: '', level: '' });
    setShowClassModal(true);
  };

  const openClassEdit = (c) => {
    setEditingClass(c);
    setClassForm({ name: c.name, level: c.level || '' });
    setShowClassModal(true);
  };

  const saveClass = async (e) => {
    e.preventDefault();
    try {
      const name = classForm.name.trim();
      const level = classForm.level.trim() || name;
      if (editingClass) {
        await api.put(`/classes/${editingClass.id}`, { name, level });
        addToast('Class updated.');
      } else {
        await api.post('/classes', { department_id: user.department_id, name, level });
        addToast('Class added.');
      }
      setClassForm({ name: '', level: '' });
      setEditingClass(null);
      setShowClassModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteClass = (c) => {
    showConfirm(
      'Delete Class',
      `Delete "${c.name}"? Students in this class will keep their records but lose the class.`,
      async () => {
        try {
          await api.delete(`/classes/${c.id}`);
          addToast('Class deleted.');
          loadAll();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed', 'error');
        }
        setConfirm({ ...confirm, open: false });
      }
    );
  };

  // ─── Souvenirs ───
  // School souvenirs are managed by the School Admin (given at registration).
  // Department souvenirs are managed by the owning Dept Admin (given at admission).
  const openSchoolSouvenirCreate = () => {
    setEditingSchoolSouvenir(null);
    setSchoolSouvenirForm({ name: '', cost: '' });
    setShowSchoolSouvenirModal(true);
  };

  const openSchoolSouvenirEdit = (s) => {
    setEditingSchoolSouvenir(s);
    setSchoolSouvenirForm({ name: s.name, cost: String(s.cost ?? '') });
    setShowSchoolSouvenirModal(true);
  };

  const saveSchoolSouvenir = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: schoolSouvenirForm.name,
        cost: Number(schoolSouvenirForm.cost) || 0,
      };
      if (editingSchoolSouvenir) {
        await api.put(`/souvenirs/${editingSchoolSouvenir.id}`, { ...payload, category: 'school' });
        addToast('School souvenir updated.');
      } else {
        await api.post('/souvenirs', { ...payload, category: 'school' });
        addToast('School souvenir added.');
      }
      setSchoolSouvenirForm({ name: '', cost: '' });
      setEditingSchoolSouvenir(null);
      setShowSchoolSouvenirModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const openDeptSouvenirCreate = () => {
    setEditingDeptSouvenir(null);
    setDeptSouvenirForm({ name: '', cost: '' });
    setShowDeptSouvenirModal(true);
  };

  const openDeptSouvenirEdit = (s) => {
    setEditingDeptSouvenir(s);
    setDeptSouvenirForm({ name: s.name, cost: String(s.cost ?? '') });
    setShowDeptSouvenirModal(true);
  };

  const saveDeptSouvenir = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: deptSouvenirForm.name,
        cost: Number(deptSouvenirForm.cost) || 0,
      };
      if (editingDeptSouvenir) {
        await api.put(`/souvenirs/${editingDeptSouvenir.id}`, {
          ...payload,
          category: 'department',
        });
        addToast('Department souvenir updated.');
      } else {
        await api.post('/souvenirs', { ...payload, category: 'department' });
        addToast('Department souvenir added.');
      }
      setDeptSouvenirForm({ name: '', cost: '' });
      setEditingDeptSouvenir(null);
      setShowDeptSouvenirModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteSouvenir = (s) => {
    showConfirm('Delete Souvenir', `Delete "${s.name}"?`, async () => {
      try {
        await api.delete(`/souvenirs/${s.id}`);
        addToast('Souvenir deleted.');
        loadAll();
      } catch (err) {
        addToast(err.response?.data?.error || 'Failed', 'error');
      }
      setConfirm({ ...confirm, open: false });
    });
  };

  // ─── Dept Admins (School Admin) ───
  const openAdminCreate = () => {
    setEditingAdmin(null);
    setAdminForm({ name: '', email: '', password: '', department_id: '' });
    setShowDeptAdminModal(true);
  };

  const openAdminEdit = (a) => {
    setEditingAdmin(a);
    setAdminForm({
      name: a.name,
      email: a.email,
      password: '',
      department_id: a.department_id ? String(a.department_id) : '',
    });
    setShowDeptAdminModal(true);
  };

  const saveAdmin = async (e) => {
    e.preventDefault();
    try {
      if (editingAdmin) {
        await api.put(`/users/${editingAdmin.id}`, {
          name: adminForm.name,
          email: adminForm.email,
          password: adminForm.password || undefined,
          department_id: Number(adminForm.department_id),
          role: 'dept_admin',
        });
        addToast('Department admin updated.');
      } else {
        await api.post('/users', {
          name: adminForm.name,
          email: adminForm.email,
          password: adminForm.password,
          department_id: Number(adminForm.department_id),
          role: 'dept_admin',
        });
        addToast('Department admin created.');
      }
      setAdminForm({ name: '', email: '', password: '', department_id: '' });
      setEditingAdmin(null);
      setShowDeptAdminModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteAdmin = (a) => {
    showConfirm('Delete Admin', `Delete admin "${a.name}"?`, async () => {
      try {
        await api.delete(`/users/${a.id}`);
        addToast('Admin deleted.');
        loadAll();
      } catch (err) {
        addToast(err.response?.data?.error || 'Failed', 'error');
      }
      setConfirm({ ...confirm, open: false });
    });
  };

  // ─── School Staff (secondary limited accounts for auditing) ───
  const openSchoolStaffCreate = () => {
    setEditingSchoolStaff(null);
    setSchoolAdminForm({ name: '', email: '', password: '' });
    setShowSchoolStaffModal(true);
  };

  const openSchoolStaffEdit = (a) => {
    setEditingSchoolStaff(a);
    setSchoolAdminForm({ name: a.name, email: a.email, password: '' });
    setShowSchoolStaffModal(true);
  };

  const saveSchoolAdmin = async (e) => {
    e.preventDefault();
    try {
      if (editingSchoolStaff) {
        await api.put(`/users/${editingSchoolStaff.id}`, {
          name: schoolAdminForm.name,
          email: schoolAdminForm.email,
          password: schoolAdminForm.password || undefined,
          role: 'school_staff',
        });
        addToast('School staff updated.');
      } else {
        await api.post('/users', {
          name: schoolAdminForm.name,
          email: schoolAdminForm.email,
          password: schoolAdminForm.password,
          role: 'school_staff',
        });
        addToast(
          'School staff account created — limited to Register Freshers / All Students / Receipts / Verify.'
        );
      }
      setSchoolAdminForm({ name: '', email: '', password: '' });
      setEditingSchoolStaff(null);
      setShowSchoolStaffModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteSchoolAdmin = (a) => {
    showConfirm(
      'Delete School Staff',
      `Delete school staff "${a.name}"? They will lose access immediately.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
          addToast('School staff deleted.');
          loadAll();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed', 'error');
        }
        setConfirm({ ...confirm, open: false });
      }
    );
  };

  // ─── Dept Staff (secondary limited accounts for the department) ───
  const openDeptStaffCreate = () => {
    setEditingDeptStaff(null);
    setDeptStaffForm({ name: '', email: '', password: '' });
    setShowDeptStaffModal(true);
  };

  const openDeptStaffEdit = (a) => {
    setEditingDeptStaff(a);
    setDeptStaffForm({ name: a.name, email: a.email, password: '' });
    setShowDeptStaffModal(true);
  };

  const saveDeptStaff = async (e) => {
    e.preventDefault();
    try {
      if (editingDeptStaff) {
        await api.put(`/users/${editingDeptStaff.id}`, {
          name: deptStaffForm.name,
          email: deptStaffForm.email,
          password: deptStaffForm.password || undefined,
          department_id: user?.department_id,
          role: 'dept_staff',
        });
        addToast('Department staff updated.');
      } else {
        await api.post('/users', {
          name: deptStaffForm.name,
          email: deptStaffForm.email,
          password: deptStaffForm.password,
          department_id: user?.department_id,
          role: 'dept_staff',
        });
        addToast(
          'Department staff account created — limited to Admit Freshers / Students / Receipts / Verify.'
        );
      }
      setDeptStaffForm({ name: '', email: '', password: '' });
      setEditingDeptStaff(null);
      setShowDeptStaffModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteDeptStaff = (a) => {
    showConfirm(
      'Delete Department Staff',
      `Delete department staff "${a.name}"? They will lose access immediately.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
          addToast('Department staff deleted.');
          loadAll();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed', 'error');
        }
        setConfirm({ ...confirm, open: false });
      }
    );
  };

  const schoolTabs = [
    ['departments', 'Departments'],
    ['prereg', 'Pre-Registration'],
    ['souvenirs', 'Souvenirs'],
    ['admins', 'Admins'],
  ];
  const deptTabs = [
    ['my-dept', 'My Department'],
    ['souvenirs', 'Dept Souvenirs'],
    ['classes', 'Classes / Levels'],
    ['staff', 'Staff'],
  ];
  const tabs = isSchool ? schoolTabs : deptTabs;

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
        danger
      />
      {loadError && (
        <div className="alert alert-error">
          <Warning size={16} /> {loadError}{' '}
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        </div>
      )}

      <div className="settings-hero">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">
            {isSchool
              ? 'School-wide dues, souvenirs, departments and admins.'
              : `Your department's dues, souvenirs and classes.`}
          </p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map(([key, label]) => {
            const icons = {
              departments: <Building size={18} />,
              prereg: <PaperPlaneTilt size={18} />,
              souvenirs: <Gift size={18} />,
              admins: <Users size={18} />,
              'my-dept': <Building size={18} />,
              classes: <Books size={18} />,
              staff: <Users size={18} />,
            };
            const counts = {
              departments: departments.length,
              admins: admins.length + schoolAdmins.length,
              souvenirs: souvenirs.length,
              classes: classes.length,
              staff: deptStaff.length,
            };
            return (
              <button
                key={key}
                className={`settings-nav-item ${tab === key ? 'active' : ''}`}
                onClick={() => setTab(key)}
              >
                {icons[key]}
                <span className="nav-label">{label}</span>
                {counts[key] !== undefined && (
                  <span className="nav-count">{counts[key]}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="settings-content">

      {/* ═══════════ SCHOOL: Departments (supervision) ═══════════ */}
      {tab === 'departments' && isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Crown size={20} /> General Settings
              </h2>
              <p className="section-desc">
                Academic year and school-wide dues applied across all departments.
              </p>
            </div>
          </div>

          <div className="settings-stats">
            <div className="settings-stat">
              <div className="settings-stat-icon navy">
                <Building size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{departments.length}</div>
                <div className="settings-stat-label">Departments</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon gold">
                <Crown size={20} />
              </div>
              <div>
                <div className="settings-stat-value">
                  GHS {Number(schoolDuesInput || 0).toFixed(0)}
                </div>
                <div className="settings-stat-label">School Dues</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon green">
                <Users size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{admins.length + schoolAdmins.length}</div>
                <div className="settings-stat-label">Total Staff</div>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="grid grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Active Academic Year</label>
                <p className="muted text-xs mb-sm">
                  Used for payments, status checks, and reports.
                </p>
                <div className="flex gap-sm">
                  <input
                    className="input"
                    value={activeAcademicYear}
                    onChange={(e) => setActiveAcademicYear(e.target.value)}
                    placeholder="e.g. 2026/2027"
                    pattern="[0-9]{4}/[0-9]{4}"
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveActiveAcademicYear}>
                    Save
                  </button>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>School-Wide Dues (GHS per year)</label>
                <p className="muted text-xs mb-sm">Paid by every student each year.</p>
                <div className="flex gap-sm">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={schoolDuesInput}
                    onChange={(e) => setSchoolDuesInput(e.target.value)}
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveSchoolDues}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Building size={16} /> Departments
              </h3>
              <button className="btn btn-primary btn-sm" onClick={openDeptCreate}>
                <Plus size={16} /> Add Department
              </button>
            </div>
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <Eye size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              Read-only overview. Each Department Admin configures their own dues amount and
              souvenirs.
            </div>
            <div className="table-wrap">
              <table className="table settings-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Code</th>
                    <th>Classes</th>
                    <th>Students</th>
                    <th>Dues</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deptPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No departments yet.
                      </td>
                    </tr>
                  )}
                  {deptPager.slice.map((d) => {
                    return (
                      <tr key={d.id}>
                        <td className="fw-600">{d.name}</td>
                        <td>
                          <span className="code-cell">{d.code}</span>{' '}
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => copyCode(d.code)}
                            title="Copy code"
                          >
                            <Copy size={12} />
                          </button>
                        </td>
                        <td>{d.class_count}</td>
                        <td>{d.student_count}</td>
                        <td className="fw-600">GHS {Number(d.dues_amount || 0).toFixed(2)}</td>
                        <td>
                          <div className="flex gap-sm">
                            <button
                              className="btn btn-outline btn-xs"
                              onClick={() => openDeptEdit(d)}
                              title="Edit department"
                            >
                              <PencilSimple size={13} />
                            </button>
                            <button className="btn btn-danger btn-xs" onClick={() => deleteDept(d)}>
                              <Trash size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={deptPager.page}
              totalPages={deptPager.totalPages}
              onPageChange={deptPager.setPage}
              totalItems={deptPager.totalItems}
              pageSize={deptPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ SCHOOL: Pre-Registration (freshers at home) ═══════════ */}
      {tab === 'prereg' && isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <PaperPlaneTilt size={20} /> Pre-Registration
              </h2>
              <p className="section-desc">
                Share the form link and access code with freshers still at home.
              </p>
            </div>
          </div>

          <div className="settings-panel">
            <h3 style={{ marginBottom: 16 }}>
              <PaperPlaneTilt size={16} style={{ marginRight: 8, verticalAlign: -3 }} />
              Form Link & Access Code
            </h3>
            <p className="muted text-sm mb">
              Submissions appear under <strong>Freshers → Pre-Registrations</strong>.
            </p>
            <div className="mb">
              <label className="text-sm fw-600" style={{ display: 'block', marginBottom: 6 }}>
                Form Link
              </label>
              <div className="flex gap-sm align-center" style={{ flexWrap: 'wrap' }}>
                <span className="code-cell" style={{ flex: '1 1 260px', wordBreak: 'break-all' }}>
                  {`${window.location.origin}/apply`}
                </span>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    copyText(`${window.location.origin}/apply`, 'Pre-registration link')
                  }
                >
                  <Copy size={14} /> Copy link
                </button>
              </div>
            </div>
            <div className="flex gap-sm align-center" style={{ flexWrap: 'wrap' }}>
              <span className="text-sm fw-600">Access code:</span>
              {accessCode ? (
                <>
                  <span className="code-cell">{accessCode}</span>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => copyText(accessCode, 'Access code')}
                    title="Copy access code"
                  >
                    <Copy size={13} />
                  </button>
                </>
              ) : (
                <span className="badge badge-red">Not set yet — set one below</span>
              )}
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <LockKey size={16} /> Change Access Code
              </h3>
            </div>
            <p className="muted text-sm mb">
              Freshers must enter this code to open the form.
            </p>
            <div className="field" style={{ maxWidth: 420, marginBottom: 0 }}>
              <label>Access Code (min. 4 characters)</label>
              <div className="flex gap-sm">
                <input
                  className="input"
                  value={accessCodeInput}
                  onChange={(e) => setAccessCodeInput(e.target.value)}
                  placeholder="e.g. UENR2026"
                  maxLength={20}
                />
                <button className="btn btn-primary btn-sm" onClick={saveAccessCode}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════ SCHOOL: Souvenirs (school catalogue only) ═══════════ */}
      {tab === 'souvenirs' && isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Gift size={20} /> Souvenirs
              </h2>
              <p className="section-desc">
                Items given to freshers at registration and admission.
              </p>
            </div>
          </div>

          <div className="settings-stats">
            <div className="settings-stat">
              <div className="settings-stat-icon gold">
                <Gift size={20} />
              </div>
              <div>
                <div className="settings-stat-value">
                  {souvenirs.filter((s) => s.category === 'school').length}
                </div>
                <div className="settings-stat-label">School Souvenirs</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon navy">
                <Building size={20} />
              </div>
              <div>
                <div className="settings-stat-value">
                  {souvenirs.filter((s) => s.category === 'department').length}
                </div>
                <div className="settings-stat-label">Dept Souvenirs</div>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Gift size={16} /> School Souvenirs
              </h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={openSchoolSouvenirCreate}
              >
                <Plus size={16} /> Add Souvenir
              </button>
            </div>
            <p className="muted text-sm mb">Given to freshers at registration.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Cost</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {schoolSouvenirsPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No school souvenirs yet.
                      </td>
                    </tr>
                  )}
                  {schoolSouvenirsPager.slice.map((s) => (
                    <tr key={s.id}>
                      <td className="fw-600">{s.name}</td>
                      <td>GHS {Number(s.cost).toFixed(2)}</td>
                      <td>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openSchoolSouvenirEdit(s)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteSouvenir(s)}
                          >
                            <Trash size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={schoolSouvenirsPager.page}
              totalPages={schoolSouvenirsPager.totalPages}
              onPageChange={schoolSouvenirsPager.setPage}
              totalItems={schoolSouvenirsPager.totalItems}
              pageSize={schoolSouvenirsPager.perPage}
            />
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Building size={16} /> Department Souvenirs
              </h3>
            </div>
            <p className="muted text-sm mb">Each department manages its own list.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {deptSouvenirsReadPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No department souvenirs yet.
                      </td>
                    </tr>
                  )}
                  {deptSouvenirsReadPager.slice.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.department_name || '—'}</td>
                      <td>GHS {Number(s.cost).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={deptSouvenirsReadPager.page}
              totalPages={deptSouvenirsReadPager.totalPages}
              onPageChange={deptSouvenirsReadPager.setPage}
              totalItems={deptSouvenirsReadPager.totalItems}
              pageSize={deptSouvenirsReadPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ SCHOOL: Users / Admins ═══════════ */}
      {tab === 'admins' && isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Users size={20} /> User Management
              </h2>
              <p className="section-desc">
                School staff for registration and department admins.
              </p>
            </div>
          </div>

          <div className="settings-stats">
            <div className="settings-stat">
              <div className="settings-stat-icon gold">
                <Crown size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{schoolAdmins.length}</div>
                <div className="settings-stat-label">School Staff</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon navy">
                <Users size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{admins.length}</div>
                <div className="settings-stat-label">Dept Admins</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon green">
                <Building size={20} />
              </div>
              <div>
                <div className="settings-stat-value">
                  {departments.filter((d) => admins.some((a) => a.department_id === d.id)).length}
                </div>
                <div className="settings-stat-label">Covered Depts</div>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Crown size={16} /> School Staff
              </h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={openSchoolStaffCreate}
              >
                <Plus size={16} /> Create Account
              </button>
            </div>
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <Users size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              Give each person at the School office their own <strong>School Staff</strong> account
              (different name + email). They can only see{' '}
              <em>Register Freshers, All Students, Receipts, Verify</em> — the main School Admin
              keeps all pages. The audit log then shows <em>who</em> registered which fresher by
              name.
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {schoolAdminPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No school staff yet.
                      </td>
                    </tr>
                  )}
                  {schoolAdminPager.slice.map((a) => (
                    <tr key={a.id}>
                      <td className="fw-600">
                        {a.name}{' '}
                        {a.id === user?.id && (
                          <span className="badge badge-navy" style={{ marginLeft: 8 }}>
                            You
                          </span>
                        )}
                      </td>
                      <td>{a.email}</td>
                      <td className="text-sm muted">
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openSchoolStaffEdit(a)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          {a.id !== user?.id && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => deleteSchoolAdmin(a)}
                            >
                              <Trash size={14} /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={schoolAdminPager.page}
              totalPages={schoolAdminPager.totalPages}
              onPageChange={schoolAdminPager.setPage}
              totalItems={schoolAdminPager.totalItems}
              pageSize={schoolAdminPager.perPage}
            />
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Users size={16} /> Department Admins
              </h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={openAdminCreate}
              >
                <Plus size={16} /> Create Admin
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {adminPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No department admins yet.
                      </td>
                    </tr>
                  )}
                  {adminPager.slice.map((a) => (
                    <tr key={a.id}>
                      <td className="fw-600">{a.name}</td>
                      <td>{a.email}</td>
                      <td>{a.department_name || '-'}</td>
                      <td>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openAdminEdit(a)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteAdmin(a)}>
                            <Trash size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={adminPager.page}
              totalPages={adminPager.totalPages}
              onPageChange={adminPager.setPage}
              totalItems={adminPager.totalItems}
              pageSize={adminPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ DEPT: My Department (dept admin configures dues + PIN) ═══════════ */}
      {tab === 'my-dept' && !isSchool && myDept && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Building size={20} /> My Department
              </h2>
              <p className="section-desc">
                Configure dues, collector PIN, and access code for {myDept.name}.
              </p>
            </div>
          </div>

          <div className="settings-stats">
            <div className="settings-stat">
              <div className="settings-stat-icon gold">
                <Crown size={20} />
              </div>
              <div>
                <div className="settings-stat-value">
                  GHS {Number(deptDuesInput || 0).toFixed(0)}
                </div>
                <div className="settings-stat-label">Dept Dues</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className={`settings-stat-icon ${myDept.pin_set ? 'green' : 'red'}`}>
                <LockKey size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{myDept.pin_set ? 'Set' : 'None'}</div>
                <div className="settings-stat-label">Collector PIN</div>
              </div>
            </div>
            <div className="settings-stat">
              <div className="settings-stat-icon navy">
                <Books size={20} />
              </div>
              <div>
                <div className="settings-stat-value">{classes.length}</div>
                <div className="settings-stat-label">Classes</div>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Crown size={16} /> Dues &amp; Department
              </h3>
            </div>
            <div className="grid grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Department</label>
                <input className="input" value={myDept.name} disabled />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Department Dues (GHS per year)</label>
                <div className="flex gap-sm">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={deptDuesInput}
                    onChange={(e) => setDeptDuesInput(e.target.value)}
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveDeptDues}>
                    Save
                  </button>
                </div>
                <span className="muted text-xs">
                  Charged to every student in {myDept.name} and pre-filled when you admit freshers or
                  record dues collections.
                </span>
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <LockKey size={16} /> Collector PIN
              </h3>
              {myDept.pin_set && (
                <span className="badge badge-green">Set</span>
              )}
            </div>
            <p className="muted text-sm mb">
              Reps enter this PIN once per session (8 hours) before they can record any payment.
              Without it, a leaked department code alone is not enough to record dues.
            </p>
            <div className="flex gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '0 1 260px', marginBottom: 0 }}>
                <label>New PIN (4–8 digits)</label>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="••••"
                  value={repPinInput}
                  onChange={(e) => setRepPinInput(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="flex gap-sm" style={{ marginBottom: 0 }}>
                <button className="btn btn-primary btn-sm" onClick={saveRepPin}>
                  <LockKey size={14} /> Save PIN
                </button>
                {myDept.pin_set && (
                  <button className="btn btn-danger btn-sm" onClick={removeRepPin}>
                    Remove PIN
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <PaperPlaneTilt size={16} /> Rep Access Code
              </h3>
            </div>
            <p className="muted text-sm mb">
              Share this code with your class representatives — they open the collection page with
              it, then enter the PIN above to record.
            </p>
            <div className="flex gap-sm align-center">
              <span className="code-cell">{myDept.code}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => copyCode(myDept.code)}>
                <Copy size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════ DEPT: Souvenirs (dept admin configures own) ═══════════ */}
      {tab === 'souvenirs' && !isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Gift size={20} /> Department Souvenirs
              </h2>
              <p className="section-desc">
                Items {user?.department_name} gives to freshers at admission.
              </p>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Gift size={16} /> Your Souvenirs
              </h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={openDeptSouvenirCreate}
              >
                <Plus size={16} /> Add Souvenir
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Cost</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deptOwnSouvPager.slice.length === 0 && (
                    <tr>
                      <td colSpan="3" className="muted">
                        No souvenirs yet. Add the items your department hands out at fresher
                        admission.
                      </td>
                    </tr>
                  )}
                  {deptOwnSouvPager.slice.map((s) => (
                    <tr key={s.id}>
                      <td className="fw-600">{s.name}</td>
                      <td>GHS {Number(s.cost).toFixed(2)}</td>
                      <td>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openDeptSouvenirEdit(s)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteSouvenir(s)}
                          >
                            <Trash size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={deptOwnSouvPager.page}
              totalPages={deptOwnSouvPager.totalPages}
              onPageChange={deptOwnSouvPager.setPage}
              totalItems={deptOwnSouvPager.totalItems}
              pageSize={deptOwnSouvPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ DEPT: Classes ═══════════ */}
      {tab === 'classes' && !isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Books size={20} /> Classes / Levels
              </h2>
              <p className="section-desc">
                Organise your students by class or level — a class can be a whole level (e.g.{' '}
                <strong>Level 200</strong>) or a stream within a level (e.g.{' '}
                <strong>Level 100 A</strong>).
              </p>
            </div>
            <button className="btn btn-primary" onClick={openClassCreate}>
              <Plus size={16} /> Add Class
            </button>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Books size={16} /> Your Classes
              </h3>
              <span className="badge badge-navy">{classes.length} total</span>
            </div>
            <p className="muted text-sm mb">Names must be unique in your department.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Level</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {classPager.slice.length === 0 && (
                    <tr>
                      <td colSpan="3" className="muted">
                        No classes yet. Add your first class/level above.
                      </td>
                    </tr>
                  )}
                  {classPager.slice.map((c) => (
                    <tr key={c.id}>
                      <td className="fw-600">{c.name}</td>
                      <td>
                        <span className="badge badge-gray">{c.level}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openClassEdit(c)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteClass(c)}>
                            <Trash size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={classPager.page}
              totalPages={classPager.totalPages}
              onPageChange={classPager.setPage}
              totalItems={classPager.totalItems}
              pageSize={classPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ DEPT: Staff ═══════════ */}
      {tab === 'staff' && !isSchool && (
        <>
          <div className="settings-section-head">
            <div>
              <h2>
                <Users size={20} /> Department Staff
              </h2>
              <p className="section-desc">
                Give your team their own <strong>Department Staff</strong> account. They can admit
                freshers, view students and receipts, and verify receipts — all limited to{' '}
                {user?.department_name}.
              </p>
            </div>
            <button className="btn btn-primary" onClick={openDeptStaffCreate}>
              <Plus size={16} /> Create Staff
            </button>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>
                <Users size={16} /> Staff Accounts
              </h3>
              <span className="badge badge-navy">{deptStaff.length} total</span>
            </div>
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <Users size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              Staff cannot change dues, settings, classes, or collect payments. They only help with
              admitting freshers and checking students and receipts.
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deptStaffPager.slice.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No department staff yet. Create one to help with admissions.
                      </td>
                    </tr>
                  )}
                  {deptStaffPager.slice.map((a) => (
                    <tr key={a.id}>
                      <td className="fw-600">
                        {a.name}{' '}
                        {a.id === user?.id && (
                          <span className="badge badge-navy" style={{ marginLeft: 8 }}>
                            You
                          </span>
                        )}
                      </td>
                      <td>{a.email}</td>
                      <td className="text-sm muted">
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openDeptStaffEdit(a)}
                          >
                            <PencilSimple size={14} /> Edit
                          </button>
                          {a.id !== user?.id && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => deleteDeptStaff(a)}
                            >
                              <Trash size={14} /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={deptStaffPager.page}
              totalPages={deptStaffPager.totalPages}
              onPageChange={deptStaffPager.setPage}
              totalItems={deptStaffPager.totalItems}
              pageSize={deptStaffPager.perPage}
            />
          </div>
        </>
      )}

      {/* ═══════════ MODALS ═══════════ */}

      <Modal
        open={showDeptModal}
        onClose={() => setShowDeptModal(false)}
        title={editingDept ? 'Edit Department' : 'Add Department'}
        subtitle={
          editingDept
            ? 'Update the department name. Its dues amount is set by the department admin.'
            : 'Create a new department. Its admin will set the department dues amount.'
        }
        icon={<Building size={20} />}
      >
        <form onSubmit={saveDept}>
          <div className="field">
            <label>Department Name *</label>
            <input
              className="input"
              value={deptForm.name}
              onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
              placeholder="e.g. Computer Science"
              required
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-outline" type="button" onClick={() => setShowDeptModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingDept ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingDept ? 'Save Changes' : 'Add Department'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showSchoolSouvenirModal}
        onClose={() => setShowSchoolSouvenirModal(false)}
        title={editingSchoolSouvenir ? 'Edit School Souvenir' : 'Add School Souvenir'}
        subtitle="Add an item to the school souvenir catalogue given at registration."
        icon={<Gift size={20} />}
      >
        <form onSubmit={saveSchoolSouvenir}>
          <div className="field">
            <label>Name *</label>
            <input
              className="input"
              value={schoolSouvenirForm.name}
              onChange={(e) =>
                setSchoolSouvenirForm({ ...schoolSouvenirForm, name: e.target.value })
              }
              required
            />
          </div>
          <div className="field">
            <label>Cost (GHS)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={schoolSouvenirForm.cost}
              onChange={(e) =>
                setSchoolSouvenirForm({ ...schoolSouvenirForm, cost: e.target.value })
              }
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowSchoolSouvenirModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingSchoolSouvenir ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingSchoolSouvenir ? 'Save Changes' : 'Add Souvenir'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showSchoolStaffModal}
        onClose={() => setShowSchoolStaffModal(false)}
        title={editingSchoolStaff ? 'Edit School Staff' : 'Create School Staff'}
        subtitle="Limited account for registration — they can only see Register Freshers, All Students, Verify."
        icon={<Crown size={20} />}
      >
        <form onSubmit={saveSchoolAdmin}>
          <div className="field">
            <label>Full Name *</label>
            <input
              className="input"
              value={schoolAdminForm.name}
              onChange={(e) =>
                setSchoolAdminForm({ ...schoolAdminForm, name: e.target.value })
              }
              placeholder="e.g. Ama Mensah"
              required
            />
          </div>
          <div className="field">
            <label>Email *</label>
            <input
              className="input"
              type="email"
              value={schoolAdminForm.email}
              onChange={(e) =>
                setSchoolAdminForm({ ...schoolAdminForm, email: e.target.value })
              }
              placeholder="e.g. ama.mensah@sciences.uenr.edu.gh"
              required
            />
          </div>
          <div className="field">
            <label>{editingSchoolStaff ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <PasswordInput
              value={schoolAdminForm.password}
              onChange={(e) =>
                setSchoolAdminForm({ ...schoolAdminForm, password: e.target.value })
              }
              required={!editingSchoolStaff}
              autoComplete="new-password"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowSchoolStaffModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingSchoolStaff ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingSchoolStaff ? 'Save Changes' : 'Create School Staff'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showDeptStaffModal}
        onClose={() => setShowDeptStaffModal(false)}
        title={editingDeptStaff ? 'Edit Department Staff' : 'Create Department Staff'}
        subtitle={`Limited account for ${user?.department_name} — Admit Freshers, Students, Receipts, and Verify.`}
        icon={<Users size={20} />}
      >
        <form onSubmit={saveDeptStaff}>
          <div className="field">
            <label>Full Name *</label>
            <input
              className="input"
              value={deptStaffForm.name}
              onChange={(e) => setDeptStaffForm({ ...deptStaffForm, name: e.target.value })}
              placeholder="e.g. Ama Mensah"
              required
            />
          </div>
          <div className="field">
            <label>Email *</label>
            <input
              className="input"
              type="email"
              value={deptStaffForm.email}
              onChange={(e) => setDeptStaffForm({ ...deptStaffForm, email: e.target.value })}
              placeholder="e.g. ama.mensah@sciences.uenr.edu.gh"
              required
            />
          </div>
          <div className="field">
            <label>{editingDeptStaff ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <PasswordInput
              value={deptStaffForm.password}
              onChange={(e) => setDeptStaffForm({ ...deptStaffForm, password: e.target.value })}
              required={!editingDeptStaff}
              autoComplete="new-password"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowDeptStaffModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingDeptStaff ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingDeptStaff ? 'Save Changes' : 'Create Staff'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showDeptAdminModal}
        onClose={() => setShowDeptAdminModal(false)}
        title={editingAdmin ? 'Edit Department Admin' : 'Create Department Admin'}
        subtitle="Full admin access to their own department — dues, classes, students, and souvenirs."
        icon={<Users size={20} />}
      >
        <form onSubmit={saveAdmin}>
          <div className="field">
            <label>Full Name *</label>
            <input
              className="input"
              value={adminForm.name}
              onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Email *</label>
            <input
              className="input"
              type="email"
              value={adminForm.email}
              onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>{editingAdmin ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <PasswordInput
              value={adminForm.password}
              onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              required={!editingAdmin}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label>Department *</label>
            <Select
              value={adminForm.department_id}
              onChange={(v) => setAdminForm({ ...adminForm, department_id: v })}
              options={deptOptions}
              placeholder="Select department..."
              required
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowDeptAdminModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingAdmin ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingAdmin ? 'Save Changes' : 'Create Admin'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showDeptSouvenirModal}
        onClose={() => setShowDeptSouvenirModal(false)}
        title={editingDeptSouvenir ? 'Edit Department Souvenir' : 'Add Department Souvenir'}
        subtitle={`Add an item ${user?.department_name} gives to freshers at admission.`}
        icon={<Gift size={20} />}
      >
        <form onSubmit={saveDeptSouvenir}>
          <div className="field">
            <label>Name *</label>
            <input
              className="input"
              value={deptSouvenirForm.name}
              onChange={(e) =>
                setDeptSouvenirForm({ ...deptSouvenirForm, name: e.target.value })
              }
              required
            />
          </div>
          <div className="field">
            <label>Cost (GHS)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={deptSouvenirForm.cost}
              onChange={(e) =>
                setDeptSouvenirForm({ ...deptSouvenirForm, cost: e.target.value })
              }
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowDeptSouvenirModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingDeptSouvenir ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingDeptSouvenir ? 'Save Changes' : 'Add Souvenir'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showClassModal}
        onClose={() => setShowClassModal(false)}
        title={editingClass ? 'Edit Class / Level' : 'Add Class / Level'}
        subtitle="A class can be a whole level or a stream within a level. Names must be unique in your department."
        icon={<Books size={20} />}
      >
        <form onSubmit={saveClass}>
          <div className="field">
            <label>Class Name *</label>
            <input
              className="input"
              value={classForm.name}
              onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
              placeholder="e.g. Level 200 A"
              required
            />
          </div>
          <div className="field">
            <label>Level (optional)</label>
            <input
              className="input"
              value={classForm.level}
              onChange={(e) => setClassForm({ ...classForm, level: e.target.value })}
              placeholder="e.g. Level 200 (defaults to class name)"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setShowClassModal(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {editingClass ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
              {editingClass ? 'Save Changes' : 'Add Class'}
            </button>
          </div>
        </form>
      </Modal>
        </div>
      </div>
    </div>
  );
}
