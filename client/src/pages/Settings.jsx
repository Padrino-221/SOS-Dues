import CourseRepAccounts from './CourseRepAccounts';
import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { mainDuesIssue } from '../utils/duesLimits';
import { useAuth } from '../context/AuthContext';
import { useLocation } from 'react-router-dom';
import {
  IconPlus as Plus,
  IconTrash as Trash,
  IconPencil as PencilSimple,
  IconCircleCheck as CheckCircle,
  IconAlertTriangle as Warning,
  IconCopy as Copy,
  IconBuilding as Building,
  IconGift as Gift,
  IconUsers as Users,
  IconCrown as Crown,
  IconBooks as Books,
  IconEye as Eye,
  IconSend as PaperPlaneTilt,
  IconCurrencyDollar as CurrencyCircleDollar,
} from '@tabler/icons-react';
import Confirm from '../components/ui/Confirm';
import Checkbox from '../components/ui/Checkbox';
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

// Institution timezone (GMT+0) — keeps account dates from sliding a day on
// devices set outside GMT.
const ACCRA_TZ = 'Africa/Accra';

// Which students a dues item may be charged to (server normalizes to
// 'any' | 'male' | 'female'). Gendered items are greyed out of the opposite
// gender's pickers and refused server-side at charge time.
const GENDER_SCOPE_OPTIONS = [
  { value: 'any', label: 'All students' },
  { value: 'female', label: 'Female students only' },
  { value: 'male', label: 'Male students only' },
];

function formatShortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { timeZone: ACCRA_TZ });
}

// Parse a dues amount from its input. Returns NaN for empty/non-numeric text
// so callers can reject it: Number('') === 0 would silently store GHS 0.
function parseAmount(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Valid Settings tab keys per role — also the allow-list for ?tab= deep-links.
const SCHOOL_TAB_KEYS = ['departments', 'dues-items', 'prereg', 'souvenirs', 'admins'];
const DEPT_TAB_KEYS = ['my-dept', 'dues-items', 'souvenirs', 'staff'];

export default function Settings() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const isSchool = user?.role === 'school_admin' || isSuper;
  const location = useLocation();
  // Deep-links (the sidebar's Accounts item → ?tab=admins) win over the role
  // default; anything invalid falls back to it.
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(location.search).get('tab');
    const valid = isSchool ? SCHOOL_TAB_KEYS : DEPT_TAB_KEYS;
    return q && valid.includes(q) ? q : isSchool ? 'departments' : 'my-dept';
  });

  const [departments, setDepartments] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [schoolAdmins, setSchoolAdmins] = useState([]);
  const [superAdmins, setSuperAdmins] = useState([]);
  const [deptStaff, setDeptStaff] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [loadError, setLoadError] = useState('');

  // Keep the tab in sync with ?tab=… deep-links (the sidebar's Accounts item).
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('tab');
    if (!q) return;
    const valid = isSchool ? SCHOOL_TAB_KEYS : DEPT_TAB_KEYS;
    if (valid.includes(q)) setTab(q);
  }, [location.search, isSchool]);

  // Forms
  const [deptForm, setDeptForm] = useState({ name: '' });
  const [schoolSouvenirForm, setSchoolSouvenirForm] = useState({ name: '' });
  const [deptSouvenirForm, setDeptSouvenirForm] = useState({ name: '' });
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
  const [superAdminForm, setSuperAdminForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [schoolDuesInput, setSchoolDuesInput] = useState('');
  const [activeAcademicYear, setActiveAcademicYear] = useState('');
  const [deptDuesInput, setDeptDuesInput] = useState('');

  // Other Dues items (freshers-only additional dues).
  const [duesItems, setDuesItems] = useState([]);
  const [duesItemForm, setDuesItemForm] = useState({
    name: '',
    amount: '',
    department_id: '',
    active: true,
  });

  // Confirm state
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });

  // Modal state
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showSchoolSouvenirModal, setShowSchoolSouvenirModal] = useState(false);
  const [showSchoolStaffModal, setShowSchoolStaffModal] = useState(false);
  const [showDeptStaffModal, setShowDeptStaffModal] = useState(false);
  const [showDeptAdminModal, setShowDeptAdminModal] = useState(false);
  const [showSuperAdminModal, setShowSuperAdminModal] = useState(false);
  const [showDeptSouvenirModal, setShowDeptSouvenirModal] = useState(false);
  const [showDuesItemModal, setShowDuesItemModal] = useState(false);

  // Rows currently being edited (null = the modal is in "create" mode).
  const [editingDept, setEditingDept] = useState(null);
  const [editingSchoolSouvenir, setEditingSchoolSouvenir] = useState(null);
  const [editingDeptSouvenir, setEditingDeptSouvenir] = useState(null);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editingSchoolStaff, setEditingSchoolStaff] = useState(null);
  const [editingDeptStaff, setEditingDeptStaff] = useState(null);
  const [editingSuperAdmin, setEditingSuperAdmin] = useState(null);
  const [editingDuesItem, setEditingDuesItem] = useState(null);

  // Double-submit guard for modal forms — only one modal can be open at a
  // time, so a single flag covers every create/save button in this page.
  const [modalSaving, setModalSaving] = useState(false);
  const modalSavingRef = useRef(false);

  // Dues inputs are seeded from the server once (or right after that field's
  // own save). loadAll() runs after every mutation, and re-seeding there would
  // revert an amount the admin is still busy typing.
  const seededSchoolDues = useRef(false);
  const seededDeptDues = useRef(false);

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
        const rows = asArray(res.data);
        setDepartments(rows);
        if (!isSchool && rows[0] && !seededDeptDues.current) {
          seededDeptDues.current = true;
          setDeptDuesInput(rows[0].dues_amount || '');
        }
      })
      .catch(() => setLoadError('Department data could not be loaded.'));
    api
      .get('/souvenirs')
      .then((res) => setSouvenirs(asArray(res.data)))
      .catch(() => setLoadError('Souvenir data could not be loaded.'));
    api
      .get('/settings')
      .then((res) => {
        if (!seededSchoolDues.current) {
          seededSchoolDues.current = true;
          setSchoolDuesInput(res.data?.school_dues_amount ?? '');
        }
        setActiveAcademicYear(res.data?.active_academic_year || '');
      })
      .catch(() => setLoadError('Settings data could not be loaded.'));
    api
      .get('/dues-items')
      .then((res) => setDuesItems(asArray(res.data)))
      .catch(() => setLoadError('Additional dues items could not be loaded.'));
    if (isSchool) {
      api
        .get('/users', { params: { role: 'dept_admin' } })
        .then((res) => setAdmins(asArray(res.data).filter((u) => u.role === 'dept_admin')))
        .catch(() => setLoadError('Admin data could not be loaded.'));
      api
        .get('/users', { params: { role: 'school_staff' } })
        .then((res) => setSchoolAdmins(asArray(res.data).filter((u) => u.role === 'school_staff')))
        .catch(() => setLoadError('Admin data could not be loaded.'));
      if (isSuper) {
        api
          .get('/users', { params: { role: 'super_admin' } })
          .then((res) => setSuperAdmins(asArray(res.data).filter((u) => u.role === 'super_admin')))
          .catch(() => setLoadError('Super admin data could not be loaded.'));
        // The super admin sees every department's staff, not just one dept's.
        api
          .get('/users', { params: { role: 'dept_staff' } })
          .then((res) => setDeptStaff(asArray(res.data).filter((u) => u.role === 'dept_staff')))
          .catch(() => setLoadError('Staff data could not be loaded.'));
      }
    } else {
      api
        .get('/users', { params: { role: 'dept_staff' } })
        .then((res) => setDeptStaff(asArray(res.data).filter((u) => u.role === 'dept_staff')))
        .catch(() => setLoadError('Staff data could not be loaded.'));
    }
  }, [isSchool, isSuper]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showConfirm = (title, message, onConfirm) => {
    setConfirm({ open: true, title, message, onConfirm });
  };

  // Used inside Confirm handlers: surface the failure, then re-throw so the
  // dialog knows the action failed and stays open instead of closing as if it
  // had succeeded.
  const confirmError = (err, fallback) => {
    const message = err.response?.data?.error || fallback;
    addToast(message, 'error');
    throw new Error(message);
  };

  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  const myDept = isSchool ? null : departments.find((d) => d.id === user?.department_id);

  // For a Dept Admin, GET /souvenirs returns ONLY their own department's items.
  // For a School Admin it returns everything (school items + every dept's).
  const schoolSouvenirs = souvenirs.filter((s) => s.category === 'school');
  const deptSouvenirs = isSchool ? souvenirs.filter((s) => s.category === 'department') : souvenirs; // dept-scoped already

  // Other Dues rows. Ownership: the school admin manages school-wide items;
  // each department's admin manages their own. The school's list is
  // school-wide only — department items live with their department (the API
  // still returns them to school accounts for the verify desk, we just don't
  // offer management of them here).
  const schoolWideDuesItems = duesItems.filter((i) => i.department_id == null);
  const ownDuesItems = duesItems.filter(
    (i) => Number(i.department_id) === Number(user?.department_id)
  );

  const deptPager = usePagination(departments, 8);
  const schoolSouvenirsPager = usePagination(schoolSouvenirs, 8);
  const deptSouvenirsReadPager = usePagination(isSchool ? deptSouvenirs : [], 8);
  const deptOwnSouvPager = usePagination(!isSchool ? deptSouvenirs : [], 8);
  const adminPager = usePagination(admins, 8);
  const schoolAdminPager = usePagination(schoolAdmins, 8);
  const superAdminPager = usePagination(superAdmins, 8);
  const deptStaffPager = usePagination(deptStaff, 8);

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
  const persistSchoolDues = async (value) => {
    try {
      const res = await api.put('/settings/school_dues_amount', { value });
      // Re-seed from the server's quantized value right after this field's
      // own save; loadAll() alone must never overwrite a mid-edit input.
      setSchoolDuesInput(res.data?.school_dues_amount ?? String(value));
      seededSchoolDues.current = true;
      addToast('School-wide dues amount updated.');
      loadAll();
      return true;
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
      return false;
    }
  };

  const saveSchoolDues = async () => {
    const value = parseAmount(schoolDuesInput);
    if (Number.isNaN(value)) {
      addToast('Enter an amount', 'error');
      return;
    }
    if (value < 0) {
      addToast('Amount cannot be negative', 'error');
      return;
    }
    const schoolDuesIssue = mainDuesIssue(value, 'School dues');
    if (schoolDuesIssue) {
      addToast(schoolDuesIssue, 'error');
      return;
    }
    if (value === 0) {
      // GHS 0 is legal but drastic — make saving it an explicit choice.
      showConfirm(
        'Save GHS 0 school dues?',
        'School-wide dues will be set to GHS 0.00. No student will be charged school dues until you set an amount again. Save GHS 0?',
        async () => {
          const ok = await persistSchoolDues(value);
          if (!ok) throw new Error('School dues were not saved.');
          setConfirm((c) => ({ ...c, open: false }));
        }
      );
      return;
    }
    await persistSchoolDues(value);
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


  // ─── Dept dues (owning Dept Admin) ───
  const persistDeptDues = async (value) => {
    try {
      const res = await api.put(`/departments/${user.department_id}/dues`, {
        dues_amount: value,
      });
      // Re-seed from the server's quantized value right after this field's
      // own save; loadAll() alone must never overwrite a mid-edit input.
      setDeptDuesInput(res.data?.dues_amount ?? String(value));
      seededDeptDues.current = true;
      addToast('Your department dues amount updated.');
      loadAll();
      return true;
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update', 'error');
      return false;
    }
  };

  const saveDeptDues = async () => {
    const value = parseAmount(deptDuesInput);
    if (Number.isNaN(value)) {
      addToast('Enter an amount', 'error');
      return;
    }
    if (value < 0) {
      addToast('Amount cannot be negative', 'error');
      return;
    }
    const deptDuesIssue = mainDuesIssue(value, 'Department dues');
    if (deptDuesIssue) {
      addToast(deptDuesIssue, 'error');
      return;
    }
    if (value === 0) {
      // GHS 0 is legal but drastic — make saving it an explicit choice.
      showConfirm(
        'Save GHS 0 department dues?',
        'This department will charge GHS 0.00 dues until you set an amount again. Save GHS 0?',
        async () => {
          const ok = await persistDeptDues(value);
          if (!ok) throw new Error('Department dues were not saved.');
          setConfirm((c) => ({ ...c, open: false }));
        }
      );
      return;
    }
    await persistDeptDues(value);
  };

  // ─── Additional dues items ("Other Dues", freshers only) ───
  // School Admin manages school-wide items + every department's items;
  // Dept Admin manages only their own department's items (enforced server
  // side too). Items are deactivated, not deleted, once charged.
  const openDuesItemCreate = () => {
    setEditingDuesItem(null);
    setDuesItemForm({
      name: '',
      amount: '',
      gender: 'any',
      department_id: isSchool ? '' : String(user?.department_id || ''),
      active: true,
    });
    setShowDuesItemModal(true);
  };

  const openDuesItemEdit = (item) => {
    setEditingDuesItem(item);
    setDuesItemForm({
      name: item.name,
      amount: String(item.amount ?? ''),
      gender: item.gender || 'any',
      department_id: item.department_id == null ? '' : String(item.department_id),
      active: Boolean(item.active),
    });
    setShowDuesItemModal(true);
  };

  const saveDuesItem = async (e) => {
    e.preventDefault();
    if (modalSavingRef.current) return;
    const amount = parseAmount(duesItemForm.amount);
    if (Number.isNaN(amount)) {
      addToast('Enter an amount', 'error');
      return;
    }
    if (amount < 0) {
      addToast('Amount cannot be negative', 'error');
      return;
    }
    if (!duesItemForm.name.trim()) {
      addToast('Enter a name for the dues item', 'error');
      return;
    }
    modalSavingRef.current = true;
    setModalSaving(true);
    try {
      // School admins create school-wide items only; dept admins create for
      // their own department. The scope is never editable after creation.
      const scopeDept = isSchool ? null : user?.department_id || null;
      if (editingDuesItem) {
        await api.put(`/dues-items/${editingDuesItem.id}`, {
          name: duesItemForm.name.trim(),
          amount,
          gender: duesItemForm.gender || 'any',
          active: duesItemForm.active,
        });
        addToast('Dues item updated.');
      } else {
        await api.post('/dues-items', {
          name: duesItemForm.name.trim(),
          amount,
          gender: duesItemForm.gender || 'any',
          department_id: scopeDept,
        });
        addToast(scopeDept ? 'Department dues item added.' : 'School-wide dues item added.');
      }
      setShowDuesItemModal(false);
      setEditingDuesItem(null);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save dues item', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  // Quick activate/deactivate from the table (name/amount unchanged).
  const toggleDuesItem = async (item) => {
    try {
      await api.put(`/dues-items/${item.id}`, { active: !item.active });
      addToast(
        !item.active
          ? `"${item.name}" activated.`
          : `"${item.name}" deactivated — it will not be offered at verification.`
      );
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update the dues item', 'error');
    }
  };

  const deleteDuesItem = (item) => {
    showConfirm(
      'Delete Dues Item',
      `Delete "${item.name}"? Only items that have never been charged can be deleted — once a fresher has paid it, deactivate instead.`,
      async () => {
        try {
          await api.delete(`/dues-items/${item.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open with the server's reason.
          confirmError(err, 'Failed to delete dues item');
        }
        addToast('Dues item deleted.');
        loadAll();
        setConfirm((prev) => ({ ...prev, open: false }));
      }
    );
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
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
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
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteDept = (d) => {
    showConfirm(
      'Delete Department',
      `Delete "${d.name}"? Its students, souvenirs and staff accounts are removed too, and this cannot be undone. Departments that already have receipts cannot be deleted — archive them instead.`,
      async () => {
        try {
          await api.delete(`/departments/${d.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open so the user can read why.
          confirmError(err, 'Failed to delete department');
        }
        addToast('Department deleted.');
        loadAll();
        setConfirm((c) => ({ ...c, open: false }));
      }
    );
  };

  // ─── Souvenirs ───
  // School souvenirs are managed by the School Admin (given at registration).
  // Department souvenirs are managed by the owning Dept Admin (given at admission).
  const openSchoolSouvenirCreate = () => {
    setEditingSchoolSouvenir(null);
    setSchoolSouvenirForm({ name: '' });
    setShowSchoolSouvenirModal(true);
  };

  const openSchoolSouvenirEdit = (s) => {
    setEditingSchoolSouvenir(s);
    setSchoolSouvenirForm({ name: s.name });
    setShowSchoolSouvenirModal(true);
  };

  const saveSchoolSouvenir = async (e) => {
    e.preventDefault();
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
    try {
      const payload = {
        name: schoolSouvenirForm.name,
      };
      if (editingSchoolSouvenir) {
        await api.put(`/souvenirs/${editingSchoolSouvenir.id}`, { ...payload, category: 'school' });
        addToast('School souvenir updated.');
      } else {
        await api.post('/souvenirs', { ...payload, category: 'school' });
        addToast('School souvenir added.');
      }
      setSchoolSouvenirForm({ name: '' });
      setEditingSchoolSouvenir(null);
      setShowSchoolSouvenirModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const openDeptSouvenirCreate = () => {
    setEditingDeptSouvenir(null);
    setDeptSouvenirForm({ name: '' });
    setShowDeptSouvenirModal(true);
  };

  const openDeptSouvenirEdit = (s) => {
    setEditingDeptSouvenir(s);
    setDeptSouvenirForm({ name: s.name });
    setShowDeptSouvenirModal(true);
  };

  const saveDeptSouvenir = async (e) => {
    e.preventDefault();
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
    try {
      const payload = {
        name: deptSouvenirForm.name,
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
      setDeptSouvenirForm({ name: '' });
      setEditingDeptSouvenir(null);
      setShowDeptSouvenirModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteSouvenir = (s) => {
    showConfirm('Delete Souvenir', `Delete "${s.name}"?`, async () => {
      try {
        await api.delete(`/souvenirs/${s.id}`);
      } catch (err) {
        // Re-throws: the Confirm dialog stays open so the user can read why.
        confirmError(err, 'Failed to delete souvenir');
      }
      addToast('Souvenir deleted.');
      loadAll();
      setConfirm((prev) => ({ ...prev, open: false }));
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
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
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
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteAdmin = (a) => {
    showConfirm(
      'Delete Admin',
      `Delete admin "${a.name}"? Their account is removed immediately and they can no longer sign in. Receipts and payments they recorded stay on record.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open so the user can read why.
          confirmError(err, 'Failed to delete admin');
        }
        addToast('Admin deleted.');
        loadAll();
        setConfirm((prev) => ({ ...prev, open: false }));
      }
    );
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
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
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
        addToast('School staff account created — limited to Register Freshers and Verify Receipt.');
      }
      setSchoolAdminForm({ name: '', email: '', password: '' });
      setEditingSchoolStaff(null);
      setShowSchoolStaffModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteSchoolAdmin = (a) => {
    showConfirm(
      'Delete School Staff',
      `Delete school staff "${a.name}"? Their account is removed immediately and they lose access. Records they created stay on record.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open so the user can read why.
          confirmError(err, 'Failed to delete school staff');
        }
        addToast('School staff deleted.');
        loadAll();
        setConfirm((prev) => ({ ...prev, open: false }));
      }
    );
  };

  // ─── Super Admins (super-admin-only accounts — full school access + the
  //     five privileged powers). Only a super admin may manage these. ───
  const openSuperAdminCreate = () => {
    setEditingSuperAdmin(null);
    setSuperAdminForm({ name: '', email: '', password: '' });
    setShowSuperAdminModal(true);
  };

  const openSuperAdminEdit = (a) => {
    setEditingSuperAdmin(a);
    setSuperAdminForm({ name: a.name, email: a.email, password: '' });
    setShowSuperAdminModal(true);
  };

  const saveSuperAdmin = async (e) => {
    e.preventDefault();
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
    try {
      if (editingSuperAdmin) {
        await api.put(`/users/${editingSuperAdmin.id}`, {
          name: superAdminForm.name,
          email: superAdminForm.email,
          password: superAdminForm.password || undefined,
          role: 'super_admin',
        });
        addToast('Super admin updated.');
      } else {
        await api.post('/users', {
          name: superAdminForm.name,
          email: superAdminForm.email,
          password: superAdminForm.password,
          role: 'super_admin',
        });
        addToast('Super admin account created.');
      }
      setSuperAdminForm({ name: '', email: '', password: '' });
      setEditingSuperAdmin(null);
      setShowSuperAdminModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteSuperAdmin = (a) => {
    showConfirm(
      'Delete Super Admin',
      `Delete super admin "${a.name}"? They lose every privileged power immediately. Records they created stay on record.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open so the user can read why.
          confirmError(err, 'Failed to delete super admin');
        }
        addToast('Super admin deleted.');
        loadAll();
        setConfirm((prev) => ({ ...prev, open: false }));
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
    // Guard against double-submit: while a save is in flight, ignore clicks.
    if (modalSavingRef.current) return;
    modalSavingRef.current = true;
    setModalSaving(true);
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
          'Department staff account created — limited to Admit Freshers, Receipts and Verify.'
        );
      }
      setDeptStaffForm({ name: '', email: '', password: '' });
      setEditingDeptStaff(null);
      setShowDeptStaffModal(false);
      loadAll();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const deleteDeptStaff = (a) => {
    showConfirm(
      'Delete Department Staff',
      `Delete department staff "${a.name}"? Their account is removed immediately and they lose access. Receipts they recorded stay on record.`,
      async () => {
        try {
          await api.delete(`/users/${a.id}`);
        } catch (err) {
          // Re-throws: the Confirm dialog stays open so the user can read why.
          confirmError(err, 'Failed to delete department staff');
        }
        addToast('Department staff deleted.');
        loadAll();
        setConfirm((prev) => ({ ...prev, open: false }));
      }
    );
  };

  const schoolTabs = [
    ['departments', 'Departments'],
    ['dues-items', 'Other Dues'],
    ['prereg', 'Pre-Registration'],
    ['souvenirs', 'Souvenirs'],
    ['admins', 'Admins'],
  ];
  const deptTabs = [
    ['my-dept', 'My Department'],
    ['dues-items', 'Other Dues'],
    ['souvenirs', 'Dept Souvenirs'],
    ['staff', 'Staff'],
  ];
  const tabs = isSchool ? schoolTabs : deptTabs;

  return (
    <div>
      <style>{`
        @media (max-width: 640px) { .hide-sm { display: none; } }
      `}</style>
      {isSuper && <CourseRepAccounts departments={departments} />}
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
              : `Your department's dues, souvenirs and staff.`}
          </p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map(([key, label]) => {
            const icons = {
              departments: <Building size={18} />,
              'dues-items': <CurrencyCircleDollar size={18} />,
              prereg: <PaperPlaneTilt size={18} />,
              souvenirs: <Gift size={18} />,
              admins: <Users size={18} />,
              'my-dept': <Building size={18} />,
              staff: <Users size={18} />,
            };
            const counts = {
              departments: departments.length,
              'dues-items': duesItems.length,
              admins: admins.length + schoolAdmins.length,
              souvenirs: souvenirs.length,
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
                {counts[key] !== undefined && <span className="nav-count">{counts[key]}</span>}
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
                  <h2>General Settings</h2>
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
                  <h3>Departments</h3>
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
                        <th className="hide-sm">Code</th>
                        <th>Dues</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptPager.slice.length === 0 && (
                        <tr>
                          <td colSpan={4} className="muted">
                            No departments yet.
                          </td>
                        </tr>
                      )}
                      {deptPager.slice.map((d) => {
                        return (
                          <tr key={d.id}>
                            <td className="fw-600">{d.name}</td>
                            <td className="hide-sm">
                              <span className="code-cell">{d.code}</span>{' '}
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => copyCode(d.code)}
                                title="Copy code"
                              >
                                <Copy size={12} />
                              </button>
                            </td>
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
                                <button
                                  className="btn btn-danger btn-xs"
                                  onClick={() => deleteDept(d)}
                                >
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

          {/* ═══════════ OTHER DUES: additional dues items (freshers only) ═══════════ */}
          {tab === 'dues-items' && (
            <>
              <div className="settings-section-head">
                <div>
                  <h2>Additional Dues (Other Dues)</h2>
                  <p className="section-desc">
                    {isSchool
                      ? 'School-wide extra charges collected at verification and manual registration. Each department manages — and collects at admission — its own items.'
                      : `Extra charges your department collects from its freshers at admission, alongside Department dues.`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openDuesItemCreate();
                  }}
                >
                  <Plus size={16} /> Add Item
                </button>
              </div>

              <div className="alert alert-info">
                <CurrencyCircleDollar size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                Charged only to freshers. School-wide items are collected at verification and manual
                registration; a department's items when that department admits the fresher.
                Deactivate an item once the year's freshers have paid — it stays on old receipts by
                name.
              </div>

              {isSchool && (
                <div className="settings-panel">
                  <div className="settings-panel-head">
                    <h3>School-Wide Items</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="table settings-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {schoolWideDuesItems.length === 0 && (
                          <tr>
                            <td colSpan={4} className="muted">
                              No school-wide dues items yet. These are collected from every fresher
                              at verification and manual registration; each department adds its own
                              items in its settings.
                            </td>
                          </tr>
                        )}
                        {schoolWideDuesItems.map((i) => (
                          <tr key={i.id}>
                            <td className="fw-600">
                              {i.name}
                              {i.gender && i.gender !== 'any' && (
                                <span className="badge badge-gold" style={{ marginLeft: 8 }}>
                                  {i.gender}-only
                                </span>
                              )}
                            </td>
                            <td>GHS {Number(i.amount).toFixed(2)}</td>
                            <td>
                              <span className={`badge ${i.active ? 'badge-green' : 'badge-red'}`}>
                                {i.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              <div className="flex gap-sm">
                                <button
                                  className="btn btn-outline btn-xs"
                                  onClick={() => openDuesItemEdit(i)}
                                  title="Edit item"
                                >
                                  <PencilSimple size={13} />
                                </button>
                                <button
                                  className={`btn btn-xs ${i.active ? 'btn-danger' : 'btn-outline'}`}
                                  onClick={() => toggleDuesItem(i)}
                                  title={i.active ? 'Deactivate item' : 'Reactivate item'}
                                >
                                  {i.active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                  className="btn btn-danger btn-xs"
                                  onClick={() => deleteDuesItem(i)}
                                  title="Delete item (only if never charged)"
                                >
                                  <Trash size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!isSchool && (
                <>
                  <div className="settings-panel">
                    <div className="settings-panel-head">
                      <h3>Your Department's Items</h3>
                      <span className="badge badge-navy">{ownDuesItems.length}</span>
                    </div>
                    <div className="table-wrap">
                      <table className="table settings-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {ownDuesItems.length === 0 && (
                            <tr>
                              <td colSpan={4} className="muted">
                                No additional dues yet. Add the levies your department charges
                                freshers at verification.
                              </td>
                            </tr>
                          )}
                          {ownDuesItems.map((i) => (
                            <tr key={i.id}>
                              <td className="fw-600">
                                {i.name}
                                {i.gender && i.gender !== 'any' && (
                                  <span className="badge badge-gold" style={{ marginLeft: 8 }}>
                                    {i.gender}-only
                                  </span>
                                )}
                              </td>
                              <td>GHS {Number(i.amount).toFixed(2)}</td>
                              <td>
                                <span className={`badge ${i.active ? 'badge-green' : 'badge-red'}`}>
                                  {i.active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td>
                                <div className="flex gap-sm">
                                  <button
                                    className="btn btn-outline btn-xs"
                                    onClick={() => openDuesItemEdit(i)}
                                    title="Edit item"
                                  >
                                    <PencilSimple size={13} />
                                  </button>
                                  <button
                                    className={`btn btn-xs ${i.active ? 'btn-danger' : 'btn-outline'}`}
                                    onClick={() => toggleDuesItem(i)}
                                    title={i.active ? 'Deactivate item' : 'Reactivate item'}
                                  >
                                    {i.active ? 'Deactivate' : 'Activate'}
                                  </button>
                                  <button
                                    className="btn btn-danger btn-xs"
                                    onClick={() => deleteDuesItem(i)}
                                    title="Delete item (only if never charged)"
                                  >
                                    <Trash size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══════════ SCHOOL: Pre-Registration (freshers at home) ═══════════ */}
          {tab === 'prereg' && isSchool && (
            <>
              <div className="settings-section-head">
                <div>
                  <h2>Pre-Registration</h2>
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
                    <span
                      className="code-cell"
                      style={{ flex: '1 1 260px', wordBreak: 'break-all' }}
                    >
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
              </div>
            </>
          )}

          {/* ═══════════ SCHOOL: Souvenirs (school catalogue only) ═══════════ */}
          {tab === 'souvenirs' && isSchool && (
            <>
              <div className="settings-section-head">
                <div>
                  <h2>Souvenirs</h2>
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
                  <h3>School Souvenirs</h3>
                  <button className="btn btn-primary btn-sm" onClick={openSchoolSouvenirCreate}>
                    <Plus size={16} /> Add Souvenir
                  </button>
                </div>
                <p className="muted text-sm mb">Given to freshers at registration.</p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {schoolSouvenirsPager.slice.length === 0 && (
                        <tr>
                          <td colSpan={2} className="muted">
                            No school souvenirs yet.
                          </td>
                        </tr>
                      )}
                      {schoolSouvenirsPager.slice.map((s) => (
                        <tr key={s.id}>
                          <td className="fw-600">{s.name}</td>
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
                  <h3>Department Souvenirs</h3>
                </div>
                <p className="muted text-sm mb">Each department manages its own list.</p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Department</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptSouvenirsReadPager.slice.length === 0 && (
                        <tr>
                          <td colSpan={2} className="muted">
                            No department souvenirs yet.
                          </td>
                        </tr>
                      )}
                      {deptSouvenirsReadPager.slice.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>{s.department_name || '—'}</td>
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
                  <h2>User Management</h2>
                  <p className="section-desc">
                    {isSuper
                      ? 'Every account: school staff, department admins, department staff and super admins.'
                      : 'School staff for registration and department admins.'}
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
                      {
                        departments.filter((d) => admins.some((a) => a.department_id === d.id))
                          .length
                      }
                    </div>
                    <div className="settings-stat-label">Covered Depts</div>
                  </div>
                </div>
                {isSuper && (
                  <div className="settings-stat">
                    <div className="settings-stat-icon gold">
                      <Users size={20} />
                    </div>
                    <div>
                      <div className="settings-stat-value">{deptStaff.length}</div>
                      <div className="settings-stat-label">Dept Staff</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>School Staff</h3>
                  <button className="btn btn-primary btn-sm" onClick={openSchoolStaffCreate}>
                    <Plus size={16} /> Create Account
                  </button>
                </div>
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                  <Users size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                  Give each person at the School office their own <strong>School Staff</strong>{' '}
                  account (different name + email). They can only see{' '}
                  <em>Register Freshers and Verify Receipt</em> — the main School Admin keeps all
                  pages. The audit log then shows <em>who</em> registered which fresher by name.
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th className="hide-sm">Created</th>
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
                          <td className="text-sm muted hide-sm">{formatShortDate(a.created_at)}</td>
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

              {isSuper && (
                <div className="settings-panel">
                  <div className="settings-panel-head">
                    <h3>Super Admins</h3>
                    <button className="btn btn-primary btn-sm" onClick={openSuperAdminCreate}>
                      <Plus size={16} /> Create Super Admin
                    </button>
                  </div>
                  <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <Crown size={16} style={{ marginRight: 6, verticalAlign: -3 }} />A{' '}
                    <strong>Super Admin</strong> has every School Admin power plus the five
                    privileged actions: resend receipt emails, correct or reopen fresher
                    applications, force-delete a student with its receipts, and manage other super
                    admin accounts. Only a super admin can create or edit these accounts.
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th className="hide-sm">Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {superAdminPager.slice.length === 0 && (
                          <tr>
                            <td colSpan={4} className="muted">
                              No super admins yet.
                            </td>
                          </tr>
                        )}
                        {superAdminPager.slice.map((a) => (
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
                            <td className="text-sm muted hide-sm">
                              {formatShortDate(a.created_at)}
                            </td>
                            <td>
                              <div className="flex gap-sm">
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => openSuperAdminEdit(a)}
                                >
                                  <PencilSimple size={14} /> Edit
                                </button>
                                {a.id !== user?.id && (
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => deleteSuperAdmin(a)}
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
                    page={superAdminPager.page}
                    totalPages={superAdminPager.totalPages}
                    onPageChange={superAdminPager.setPage}
                    totalItems={superAdminPager.totalItems}
                    pageSize={superAdminPager.perPage}
                  />
                </div>
              )}

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>Department Admins</h3>
                  <button className="btn btn-primary btn-sm" onClick={openAdminCreate}>
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
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => deleteAdmin(a)}
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
                  page={adminPager.page}
                  totalPages={adminPager.totalPages}
                  onPageChange={adminPager.setPage}
                  totalItems={adminPager.totalItems}
                  pageSize={adminPager.perPage}
                />
              </div>

              {isSuper && (
                <div className="settings-panel">
                  <div className="settings-panel-head">
                    <h3>Department Staff</h3>
                    <span className="badge badge-navy">{deptStaff.length} total</span>
                  </div>
                  <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <Users size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                    Every <strong>Department Staff</strong> account across all departments. Each one
                    works only inside their own department — admit freshers, view receipts, verify.
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Department</th>
                          <th className="hide-sm">Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptStaffPager.slice.length === 0 && (
                          <tr>
                            <td colSpan={5} className="muted">
                              No department staff yet.
                            </td>
                          </tr>
                        )}
                        {deptStaffPager.slice.map((a) => (
                          <tr key={a.id}>
                            <td className="fw-600">{a.name}</td>
                            <td>{a.email}</td>
                            <td>{a.department_name || '-'}</td>
                            <td className="text-sm muted hide-sm">
                              {formatShortDate(a.created_at)}
                            </td>
                            <td>
                              <div className="flex gap-sm">
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => openDeptStaffEdit(a)}
                                >
                                  <PencilSimple size={14} /> Edit
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => deleteDeptStaff(a)}
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
                    page={deptStaffPager.page}
                    totalPages={deptStaffPager.totalPages}
                    onPageChange={deptStaffPager.setPage}
                    totalItems={deptStaffPager.totalItems}
                    pageSize={deptStaffPager.perPage}
                  />
                </div>
              )}
            </>
          )}

          {/* ═══════════ DEPT: My Department (dept admin configures dues + PIN) ═══════════ */}
          {tab === 'my-dept' && !isSchool && myDept && (
            <>
              <div className="settings-section-head">
                <div>
                  <h2>My Department</h2>
                  <p className="section-desc">
                    Configure dues and access code for {myDept.name}.
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
                  <div className="settings-stat-icon navy">
                    <Books size={20} />
                  </div>
                  <div>
                    <div className="settings-stat-value">{myDept?.code || '—'}</div>
                    <div className="settings-stat-label">Rep Code</div>
                  </div>
                </div>
              </div>

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>Dues &amp; Department</h3>
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
                      Charged to every student in {myDept.name} and pre-filled when you admit
                      freshers or record dues collections.
                    </span>
                  </div>
                </div>
              </div>

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>Rep Access Code</h3>
                </div>
                <p className="muted text-sm mb">
                  Share this code with your class representatives — they open the collection page
                  with it, then sign in with their course rep account.
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
                  <h2>Department Souvenirs</h2>
                  <p className="section-desc">
                    Items {user?.department_name} gives to freshers at admission.
                  </p>
                </div>
              </div>

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>Your Souvenirs</h3>
                  <button className="btn btn-primary btn-sm" onClick={openDeptSouvenirCreate}>
                    <Plus size={16} /> Add Souvenir
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptOwnSouvPager.slice.length === 0 && (
                        <tr>
                          <td colSpan="2" className="muted">
                            No souvenirs yet. Add the items your department hands out at fresher
                            admission.
                          </td>
                        </tr>
                      )}
                      {deptOwnSouvPager.slice.map((s) => (
                        <tr key={s.id}>
                          <td className="fw-600">{s.name}</td>
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

          {/* ═══════════ DEPT: Staff ═══════════ */}
          {tab === 'staff' && !isSchool && (
            <>
              <div className="settings-section-head">
                <div>
                  <h2>Department Staff</h2>
                  <p className="section-desc">
                    Give your team their own <strong>Department Staff</strong> account. They can
                    admit freshers, view receipts, and verify receipts — all limited to{' '}
                    {user?.department_name}.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={openDeptStaffCreate}>
                  <Plus size={16} /> Create Staff
                </button>
              </div>

              <div className="settings-panel">
                <div className="settings-panel-head">
                  <h3>Staff Accounts</h3>
                  <span className="badge badge-navy">{deptStaff.length} total</span>
                </div>
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                  <Users size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                  Staff cannot change dues, settings, or collect payments. They only help with
                  admitting freshers and checking receipts.
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th className="hide-sm">Created</th>
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
                          <td className="text-sm muted hide-sm">{formatShortDate(a.created_at)}</td>
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
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setShowDeptModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingDept ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving ? 'Saving…' : editingDept ? 'Save Changes' : 'Add Department'}
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
              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setShowSchoolSouvenirModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingSchoolSouvenir ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving
                    ? 'Saving…'
                    : editingSchoolSouvenir
                      ? 'Save Changes'
                      : 'Add Souvenir'}
                </button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showSchoolStaffModal}
            onClose={() => setShowSchoolStaffModal(false)}
            title={editingSchoolStaff ? 'Edit School Staff' : 'Create School Staff'}
            subtitle="Limited account for registration — they can only see Register Freshers and Verify Receipt."
            icon={<Crown size={20} />}
          >
            <form onSubmit={saveSchoolAdmin}>
              <div className="field">
                <label>Full Name *</label>
                <input
                  className="input"
                  value={schoolAdminForm.name}
                  onChange={(e) => setSchoolAdminForm({ ...schoolAdminForm, name: e.target.value })}
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
                <label>
                  {editingSchoolStaff ? 'New Password (leave blank to keep)' : 'Password *'}
                </label>
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
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingSchoolStaff ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving
                    ? 'Saving…'
                    : editingSchoolStaff
                      ? 'Save Changes'
                      : 'Create School Staff'}
                </button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showDeptStaffModal}
            onClose={() => setShowDeptStaffModal(false)}
            title={editingDeptStaff ? 'Edit Department Staff' : 'Create Department Staff'}
            subtitle={`Limited account for ${user?.department_name || editingDeptStaff?.department_name || 'their department'} — Admit Freshers, Receipts, and Verify.`}
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
                <label>
                  {editingDeptStaff ? 'New Password (leave blank to keep)' : 'Password *'}
                </label>
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
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingDeptStaff ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving ? 'Saving…' : editingDeptStaff ? 'Save Changes' : 'Create Staff'}
                </button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showSuperAdminModal}
            onClose={() => setShowSuperAdminModal(false)}
            title={editingSuperAdmin ? 'Edit Super Admin' : 'Create Super Admin'}
            subtitle="Full school access plus the five privileged actions (resend receipt emails, correct/reopen applications, force-delete, account management)."
            icon={<Crown size={20} />}
          >
            <form onSubmit={saveSuperAdmin}>
              <div className="field">
                <label>Full Name *</label>
                <input
                  className="input"
                  value={superAdminForm.name}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Email *</label>
                <input
                  className="input"
                  type="email"
                  value={superAdminForm.email}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, email: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>
                  {editingSuperAdmin ? 'New Password (leave blank to keep)' : 'Password *'}
                </label>
                <PasswordInput
                  value={superAdminForm.password}
                  onChange={(e) =>
                    setSuperAdminForm({ ...superAdminForm, password: e.target.value })
                  }
                  required={!editingSuperAdmin}
                  autoComplete="new-password"
                />
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setShowSuperAdminModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingSuperAdmin ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving
                    ? 'Saving…'
                    : editingSuperAdmin
                      ? 'Save Changes'
                      : 'Create Super Admin'}
                </button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showDeptAdminModal}
            onClose={() => setShowDeptAdminModal(false)}
            title={editingAdmin ? 'Edit Department Admin' : 'Create Department Admin'}
            subtitle="Full admin access to their own department — freshers, dues, and souvenirs."
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
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingAdmin ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving ? 'Saving…' : editingAdmin ? 'Save Changes' : 'Create Admin'}
                </button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showDuesItemModal}
            onClose={() => setShowDuesItemModal(false)}
            title={editingDuesItem ? 'Edit Dues Item' : 'Add Dues Item'}
            subtitle={
              editingDuesItem
                ? 'Rename, reprice or deactivate it. Past receipts keep the name they were charged under.'
                : isSchool
                  ? 'An extra charge every fresher pays alongside School dues at verification and registration.'
                  : `An extra charge ${user?.department_name}'s freshers pay alongside Department dues at admission.`
            }
            icon={<CurrencyCircleDollar size={20} />}
          >
            <form onSubmit={saveDuesItem}>
              <div className="field">
                <label>Name *</label>
                <input
                  className="input"
                  value={duesItemForm.name}
                  onChange={(e) => setDuesItemForm({ ...duesItemForm, name: e.target.value })}
                  placeholder="e.g. Lab Levy, Exam Levy, Dept T-shirt"
                  maxLength={60}
                  required
                />
              </div>
              <div className="field">
                <label>Amount (GHS) *</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={duesItemForm.amount}
                  onChange={(e) => setDuesItemForm({ ...duesItemForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Applies to *</label>
                <Select
                  value={duesItemForm.gender || 'any'}
                  onChange={(v) => setDuesItemForm({ ...duesItemForm, gender: v })}
                  options={GENDER_SCOPE_OPTIONS}
                />
                <p className="muted text-xs" style={{ marginTop: 6 }}>
                  Gendered items are greyed out for the other gender at verification, registration
                  and admission, and refused server-side.
                </p>
              </div>
              {!isSchool && (
                <div className="field">
                  <label>Scope</label>
                  <input className="input" value={user?.department_name || ''} disabled readOnly />
                </div>
              )}
              {editingDuesItem && (
                <div className="field">
                  <Checkbox
                    checked={duesItemForm.active}
                    onChange={(checked) => setDuesItemForm({ ...duesItemForm, active: checked })}
                    label="Active — offered to freshers at verification"
                  />
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setShowDuesItemModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingDuesItem ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving ? 'Saving…' : editingDuesItem ? 'Save Changes' : 'Add Item'}
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
              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setShowDeptSouvenirModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={modalSaving}>
                  {editingDeptSouvenir ? <CheckCircle size={16} /> : <Plus size={16} />}{' '}
                  {modalSaving ? 'Saving…' : editingDeptSouvenir ? 'Save Changes' : 'Add Souvenir'}
                </button>
              </div>
            </form>
          </Modal>
        </div>
      </div>
    </div>
  );
}
