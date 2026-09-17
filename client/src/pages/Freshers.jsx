import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import {
  UserPlus,
  Plus,
  Users,
  CheckCircle,
  Warning,
  UserCheck,
  Pencil,
  Trash,
  CurrencyCircleDollar,
  Gift,
  Student,
  LinkSimple,
  Copy,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import DatePicker from '../components/ui/DatePicker';
import Confirm from '../components/ui/Confirm';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';
import StudentDetailsModal from '../components/ui/StudentDetailsModal';

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <CheckCircle size={18} /> : <Warning size={18} />}
      {message}
    </div>
  );
}

const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'momo', label: 'Mobile Money' },
];

const GENDER_OPTIONS = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Other', label: 'Other' },
];

export default function Freshers() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff'].includes(user?.role);
  const isSchoolAdmin = user?.role === 'school_admin';

  const [freshers, setFreshers] = useState([]);
  const [tabCounts, setTabCounts] = useState({ pending: 0, admitted: 0 });
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [schoolDues, setSchoolDues] = useState(''); // school-wide amount
  const [deptDues, setDeptDues] = useState(''); // own dept amount (dept admin)
  const [toasts, setToasts] = useState([]);
  const [tab, setTab] = useState(schoolSide ? 'registered' : 'pending'); // school: registered | prereg · dept: pending | admitted
  const [applications, setApplications] = useState([]);
  const [accessCode, setAccessCode] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Details modal (row click)
  const [details, setDetails] = useState(null);

  // Verify pre-registration modal (School Admin)
  const [verifying, setVerifying] = useState(null);
  const [verifyForm, setVerifyForm] = useState({
    name: '',
    student_no: '',
    phone: '',
    email: '',
    programme: '',
    gender: '',
    hometown: '',
    department_id: '',
    admission_year: new Date().getFullYear(),
  });
  const [verifyPay, setVerifyPay] = useState({
    amount: '',
    method: 'cash',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [verifySouv, setVerifySouv] = useState([]);

  // Register modal (School Admin)
  const [showRegister, setShowRegister] = useState(false);
  const [editing, setEditing] = useState(null);
  const [studentForm, setStudentForm] = useState({
    name: '',
    student_no: '',
    phone: '',
    email: '',
    programme: '',
    gender: '',
    hometown: '',
    department_id: '',
    admission_year: new Date().getFullYear(),
  });
  const [schoolPayment, setSchoolPayment] = useState({
    amount: '',
    method: 'cash',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [schoolSouvenirs, setSchoolSouvenirs] = useState([]);

  // Admit modal (Dept Admin)
  const [admitting, setAdmitting] = useState(null);
  const [admitForm, setAdmitForm] = useState({
    class_id: '',
    amount: '',
    method: 'cash',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [deptSouvenirs, setDeptSouvenirs] = useState([]);
  const [givenSouvenirIds, setGivenSouvenirIds] = useState([]);
  const [saving, setSaving] = useState(false);

  // Confirm delete
  const [confirm, setConfirm] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
    danger: false,
  });

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadFreshers = useCallback(() => {
    setLoadError('');
    const params = {};
    if (search) params.search = search;
    if (schoolSide) params.is_fresher = 'true';
    else if (tab === 'admitted') params.status = 'admitted';
    else params.status = 'pending';
    api
      .get('/students', { params })
      .then((res) => {
        // Dept admin: pending queue is all freshers still waiting.
        // School admin: only freshers (list already filtered server-side).
        setFreshers(res.data);
      })
      .catch(() => setLoadError('Fresher records could not be loaded.'));
  }, [search, schoolSide, tab]);

  // Fetch tab counts for dept admin
  const loadTabCounts = useCallback(() => {
    if (schoolSide) return;
    const params = {};
    if (search) params.search = search;
    Promise.all([
      api.get('/students', { params: { ...params, status: 'pending' } }),
      api.get('/students', { params: { ...params, status: 'admitted' } }),
    ]).then(([p, a]) => {
      setTabCounts({ pending: p.data.length, admitted: a.data.length });
    }).catch(() => {});
  }, [search, schoolSide]);

  useEffect(() => {
    loadTabCounts();
  }, [loadTabCounts]);

  useEffect(() => {
    setPage(1);
  }, [search, tab]);

  // School: keep registered freshers AND pre-registration submissions fresh.
  // Dept: just the admit queue.
  const loadApps = useCallback(() => {
    api
      .get('/freshers', { params: { status: 'pending', search: search || undefined } })
      .then((res) => setApplications(res.data))
      .catch(() => setLoadError('Pre-registration records could not be loaded.'));
  }, [search]);

  useEffect(() => {
    loadFreshers();
    if (schoolSide) loadApps();
  }, [loadFreshers, loadApps, schoolSide]);

  // Live updates (server scopes each event to the right admin):
  //  - a fresher's at-home submission lands instantly on the school's list
  //  - registers/verifies/admits/payments refresh the queues & badges in place
  useRealtime({
    'fresher_application:new': () => {
      if (schoolSide) loadApps();
    },
    'fresher_application:removed': () => {
      if (schoolSide) loadApps();
    },
    'fresher:registered': loadFreshers,
    'fresher:verified': () => {
      loadFreshers();
      if (schoolSide) loadApps();
    },
    'fresher:admitted': () => { loadFreshers(); loadTabCounts(); },
    'payment:new': loadFreshers,
    'student:changed': loadFreshers,
  });

  useEffect(() => {
    // Reference data
    api
      .get('/settings')
      .then((res) => {
        setSchoolDues(res.data?.school_dues_amount || '');
        setAccessCode(res.data?.fresher_access_code || '');
      })
      .catch(() => {});
    api
      .get('/souvenirs')
      .then((res) => setSouvenirs(res.data))
      .catch(() => {});

    if (schoolSide) {
      api
        .get('/departments')
        .then((res) => setDepts(res.data))
        .catch(() => {});
    } else {
      api
        .get('/departments')
        .then((res) => setDeptDues(String(res.data?.[0]?.dues_amount || '')))
        .catch(() => {});
    }
    api
      .get('/classes')
      .then((res) => setClasses(res.data))
      .catch(() => {});
  }, [schoolSide]);

  // School souvenirs only have category 'school'; the souvenirs the dept
  // hands out at admission are the 'department' category items.
  const schoolSouvenirList = souvenirs.filter((s) => s.category === 'school');
  const deptSouvenirList = souvenirs.filter((s) => s.category === 'department');

  // ─── School Admin: register / edit fresher ───
  const openCreate = () => {
    setEditing(null);
    setStudentForm({
      name: '',
      student_no: '',
      phone: '',
      email: '',
      programme: '',
      gender: '',
      hometown: '',
      department_id: '',
      admission_year: new Date().getFullYear(),
    });
    setSchoolPayment({
      amount: schoolDues || '',
      method: 'cash',
      paid_at: new Date().toISOString().slice(0, 10),
    });
    setSchoolSouvenirs([]);
    setGivenSouvenirIds([]);
    setShowRegister(true);
  };

  const openEdit = (f) => {
    setEditing(f);
    setStudentForm({
      name: f.name || '',
      student_no: f.student_no || '',
      phone: f.phone || '',
      email: f.email || '',
      programme: f.programme || '',
      gender: f.gender || '',
      hometown: f.hometown || '',
      department_id: String(f.department_id || ''),
      admission_year: f.admission_year || new Date().getFullYear(),
    });
    setSchoolSouvenirs([]);
    setGivenSouvenirIds([]);
    api
      .get(`/students/${f.id}/souvenirs`)
      .then((res) => {
        const ids = res.data.map((r) => r.souvenir_id);
        setGivenSouvenirIds(ids);
        setSchoolSouvenirs(ids);
      })
      .catch(() => {});
    setShowRegister(true);
  };

  const buildPayload = (isFresher, departmentId) => {
    const payload = {
      name: studentForm.name.trim(),
      student_no: studentForm.student_no.trim() || null,
      phone: studentForm.phone.trim() || null,
      email: studentForm.email.trim() || null,
      programme: studentForm.programme.trim() || null,
      gender: studentForm.gender || null,
      hometown: studentForm.hometown.trim() || null,
      admission_year: studentForm.admission_year ? String(studentForm.admission_year) : null,
    };
    if (isFresher) payload.department_id = departmentId || null;
    return payload;
  };

  const registerFresher = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!studentForm.department_id) {
        addToast('Assign the fresher to a department.', 'error');
        setSaving(false);
        return;
      }
      if (schoolSouvenirs.length > 0 && Number(schoolPayment.amount) <= 0) {
        addToast('A School Dues amount is required to record souvenirs.', 'error');
        setSaving(false);
        return;
      }
      const res = await api.post('/students/freshers', {
        ...buildPayload(true, studentForm.department_id),
        payment: Number(schoolPayment.amount) > 0 ? schoolPayment : undefined,
        souvenir_ids: schoolSouvenirs.length > 0 ? schoolSouvenirs : undefined,
      });
      const student = res.data;

      addToast(`${student.name} registered and assigned to a department.`);
      setShowRegister(false);
      loadFreshers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to register fresher', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/students/${editing.id}`, buildPayload(true, studentForm.department_id));
      // Record any remaining school souvenirs the fresher collects later. The
      // server ignores items already handed out and issues a $0 receipt for the
      // newly given ones.
      const newlyGiven = schoolSouvenirs.filter((id) => !givenSouvenirIds.includes(id));
      let added = 0;
      if (newlyGiven.length) {
        const res = await api.post(`/students/${editing.id}/souvenirs`, {
          souvenir_ids: newlyGiven,
        });
        added = res.data?.added || 0;
      }
      addToast(added > 0 ? `Fresher updated — ${added} souvenir(s) recorded.` : 'Fresher updated.');
      setShowRegister(false);
      loadFreshers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update fresher', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteFresher = (f) => {
    setConfirm({
      open: true,
      title: 'Delete Fresher',
      message: `Delete ${f.name}? This permanently removes their record and receipts.`,
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

  // ─── Dept Admin: admit ───
  const openAdmit = (f) => {
    setAdmitting(f);
    setAdmitForm({
      class_id: f.class_id ? String(f.class_id) : '',
      amount: deptDues || '',
      method: 'cash',
      paid_at: new Date().toISOString().slice(0, 10),
    });
    setDeptSouvenirs([]);
    setGivenSouvenirIds([]);
    api
      .get(`/students/${f.id}/souvenirs`)
      .then((res) => {
        const ids = res.data.filter((r) => r.level === 'department').map((r) => r.souvenir_id);
        setGivenSouvenirIds(ids);
        setDeptSouvenirs(ids);
      })
      .catch(() => {});
  };

  const admit = async () => {
    setSaving(true);
    try {
      if (!admitForm.class_id) {
        addToast("Pick the fresher's class/level.", 'error');
        setSaving(false);
        return;
      }
      const body = { class_id: Number(admitForm.class_id) };
      if (Number(admitForm.amount) > 0) {
        body.payment = {
          amount: Number(admitForm.amount),
          method: admitForm.method,
          paid_at: admitForm.paid_at || undefined,
        };
      }
      if (deptSouvenirs.length > 0) {
        const newly = deptSouvenirs.filter((id) => !givenSouvenirIds.includes(id));
        if (newly.length) body.souvenir_ids = newly;
      }

      const res = await api.post(`/students/${admitting.id}/admit`, body);
      addToast(
        `${admitting.name} admitted.${res.data.receipt_number ? ` Receipt ${res.data.receipt_number}.` : ''}`
      );
      setAdmitting(null);
      loadFreshers();
      loadTabCounts();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to admit fresher', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── School Admin: pre-registrations (freshers still at home) ───
  const appPager = usePagination(applications, 10);

  const preregLink = () => `${window.location.origin}/apply`;

  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(`${what} copied to clipboard.`);
    } catch {
      addToast('Could not copy automatically — copy manually.', 'error');
    }
  };

  const openVerify = (a) => {
    setVerifying(a);
    setVerifyForm({
      name: a.full_name || '',
      student_no: a.student_no || '',
      phone: a.phone || '',
      email: a.email || '',
      programme: a.programme || '',
      gender: a.gender || '',
      hometown: a.hometown || '',
      department_id: '',
      admission_year: a.admission_year || new Date().getFullYear(),
    });
    setVerifyPay({
      amount: schoolDues || '',
      method: 'cash',
      paid_at: new Date().toISOString().slice(0, 10),
    });
    setVerifySouv([]);
  };

  const verifyApp = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!verifyForm.department_id) {
        addToast('Assign the fresher to a department.', 'error');
        setSaving(false);
        return;
      }
      const body = {
        full_name: verifyForm.name.trim(),
        student_no: verifyForm.student_no.trim(),
        phone: verifyForm.phone.trim() || undefined,
        email: verifyForm.email.trim() || undefined,
        programme: verifyForm.programme.trim() || undefined,
        gender: verifyForm.gender || undefined,
        hometown: verifyForm.hometown.trim() || undefined,
        department_id: Number(verifyForm.department_id),
        admission_year: verifyForm.admission_year ? String(verifyForm.admission_year) : undefined,
      };
      if (Number(verifyPay.amount) > 0) {
        body.payment = {
          amount: Number(verifyPay.amount),
          method: verifyPay.method,
          paid_at: verifyPay.paid_at || undefined,
        };
      }
      if (verifySouv.length > 0) body.souvenir_ids = verifySouv;

      const res = await api.post(`/freshers/${verifying.id}/verify`, body);
      addToast(
        `${verifyForm.name.trim()} verified and assigned to a department.${res.data.receipt_number ? ` School Dues receipt ${res.data.receipt_number}.` : ''}`
      );
      setVerifying(null);
      loadApps();
    } catch (err) {
      addToast(err.response?.data?.error || 'Verification failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteApp = (a) => {
    setConfirm({
      open: true,
      title: 'Remove Pre-Registration',
      message: `Remove ${a.full_name}'s submission? They can fill the form again if needed.`,
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/freshers/${a.id}`);
          addToast('Pre-registration removed.');
          loadApps();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed to remove', 'error');
        }
        setConfirm({ ...confirm, open: false });
      },
    });
  };

  const myClasses = classes.map((c) => ({
    value: c.id,
    label: c.name + (c.level !== c.name ? ` (${c.level})` : ''),
  }));

  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));
  const statusBadge = (f) => {
    if (!f.is_fresher) return { label: 'Continuing', cls: 'badge-navy' };
    if (f.admitted_at) return { label: 'Admitted', cls: 'badge-green' };
    return { label: 'Pending', cls: 'badge-gold' };
  };

  const paged = freshers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {loadError && (
        <div className="alert alert-error">
          <Warning size={16} /> {loadError}{' '}
          <button
            className="btn btn-outline btn-xs"
            onClick={() => {
              loadFreshers();
              if (schoolSide) loadApps();
            }}
          >
            Retry
          </button>
        </div>
      )}
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

      <StudentDetailsModal student={details} onClose={() => setDetails(null)} />

      <div className="page-head">
        <div>
          <h1>{schoolSide ? 'Freshers' : 'Admit Freshers'}</h1>
          <p className="subtitle">
            {schoolSide
              ? tab === 'prereg'
                ? 'Freshers who pre-registered from home. Verify and assign a department on reporting day.'
                : 'Registered freshers — assign departments and record School dues & souvenirs.'
              : `Freshers assigned to ${user?.department_name}. Admit and record Department dues & souvenirs.`}
          </p>
        </div>
        {isSchoolAdmin && tab === 'prereg' && (
          <button
            className="btn btn-outline"
            onClick={() => copyText(preregLink(), 'Pre-registration link')}
          >
            <LinkSimple size={18} /> Copy Form Link
          </button>
        )}
        {schoolSide && tab === 'registered' && (
          <button className="btn btn-green" onClick={openCreate}>
            <Plus size={18} /> Register Fresher
          </button>
        )}
      </div>

      <div className="tabs mb-md">
        {(schoolSide
          ? [
              ['registered', 'Registered Freshers'],
              [
                'prereg',
                `Pre-Registrations${applications.length ? ` (${applications.length})` : ''}`,
              ],
            ]
          : [
              ['pending', `Pending Admission${tabCounts.pending ? ` (${tabCounts.pending})` : ''}`],
              ['admitted', `Admitted${tabCounts.admitted ? ` (${tabCounts.admitted})` : ''}`],
            ]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── Register / Edit Fresher modal (School Admin) ─── */}
      {showRegister && schoolSide && (
        <Modal
          open
          size="wide"
          icon={<Student size={20} />}
          title={editing ? 'Edit Fresher' : 'Register a Fresher'}
          subtitle={
            editing
              ? 'Update the fresher record or reassign their department.'
              : 'Capture their details, assign a department, and record School dues & souvenirs.'
          }
          onClose={() => setShowRegister(false)}
        >
          <form onSubmit={editing ? saveEdit : registerFresher}>
            <div className="modal-section">
              <div className="modal-section-title">
                <Student size={16} /> Fresher Details
              </div>
              <div className="grid grid-2">
                <div className="field">
                  <label>Full Name *</label>
                  <input
                    className="input"
                    value={studentForm.name}
                    onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Reference Number</label>
                  <input
                    className="input"
                    value={studentForm.student_no}
                    onChange={(e) => setStudentForm({ ...studentForm, student_no: e.target.value })}
                    placeholder="e.g. REF-2026-00123"
                  />
                </div>
                <div className="field">
                  <label>Phone Number</label>
                  <input
                    className="input"
                    value={studentForm.phone}
                    onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                    placeholder="e.g. 0244 000 000"
                  />
                </div>
                <div className="field">
                  <label>Email Address</label>
                  <input
                    className="input"
                    type="email"
                    value={studentForm.email}
                    onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="field">
                  <label>Programme of Choice</label>
                  <input
                    className="input"
                    value={studentForm.programme}
                    onChange={(e) => setStudentForm({ ...studentForm, programme: e.target.value })}
                    placeholder="e.g. BSc. Computer Science"
                  />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <Select
                    value={studentForm.gender}
                    onChange={(v) => setStudentForm({ ...studentForm, gender: v })}
                    options={GENDER_OPTIONS}
                    placeholder="Select gender..."
                  />
                </div>
                <div className="field">
                  <label>Hometown / Region</label>
                  <input
                    className="input"
                    value={studentForm.hometown}
                    onChange={(e) => setStudentForm({ ...studentForm, hometown: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Admission Year</label>
                  <input
                    className="input"
                    type="number"
                    min="2000"
                    max="2100"
                    value={studentForm.admission_year}
                    onChange={(e) =>
                      setStudentForm({ ...studentForm, admission_year: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assign to Department *</label>
                <Select
                  value={studentForm.department_id}
                  onChange={(v) => setStudentForm({ ...studentForm, department_id: v })}
                  options={deptOptions}
                  placeholder="Select department..."
                  required
                />
              </div>
            </div>

            {!editing && (
              <div className="modal-section">
                <div className="modal-section-title">
                  <CurrencyCircleDollar size={16} /> School Dues Payment
                </div>
                <p className="muted text-sm mb">Pre-filled from Settings — editable.</p>
                <div className="grid grid-3">
                  <div className="field">
                    <label>Amount (GHS) *</label>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={schoolPayment.amount}
                      onChange={(e) =>
                        setSchoolPayment({ ...schoolPayment, amount: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Method *</label>
                    <Select
                      value={schoolPayment.method}
                      onChange={(v) => setSchoolPayment({ ...schoolPayment, method: v })}
                      options={METHOD_OPTIONS}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Date</label>
                    <DatePicker
                      value={schoolPayment.paid_at}
                      onChange={(v) => setSchoolPayment({ ...schoolPayment, paid_at: v })}
                    />
                  </div>
                </div>
              </div>
            )}

            {schoolSouvenirList.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-title">
                  <Gift size={16} /> School Souvenirs
                </div>
                <p className="muted text-sm mb">
                  {editing
                    ? 'Items already handed out are marked "recorded". Tick any remaining items the student collects now — a $0 souvenir receipt is issued for them.'
                    : 'Tick the items handed to the fresher now.'}
                </p>
                <div className="grid grid-2">
                  {schoolSouvenirList.map((s) => {
                    const given = givenSouvenirIds.includes(s.id);
                    return (
                      <Checkbox
                        key={s.id}
                        checked={schoolSouvenirs.includes(s.id)}
                        disabled={given}
                        onChange={() =>
                          setSchoolSouvenirs((prev) =>
                            prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                          )
                        }
                        label={given ? `${s.name} (recorded)` : s.name}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowRegister(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-green"
                disabled={saving || !studentForm.name.trim() || !studentForm.department_id}
              >
                {editing ? (
                  <>
                    <CheckCircle size={18} /> Save Changes
                  </>
                ) : (
                  <>
                    <UserPlus size={18} /> Register & Record School Dues
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Admit modal (Dept Admin) ─── */}
      {admitting && !schoolSide && (
        <Modal
          open
          icon={<UserPlus size={20} />}
          title={`Admit ${admitting.name}`}
          subtitle="Assign their class and record Department dues & souvenirs."
          onClose={() => setAdmitting(null)}
        >
          <div className="modal-section">
            <div className="modal-section-title">
              <Users size={16} /> Admission Details
            </div>
            <p className="muted text-sm mb">
              Registered by the School and assigned to {admitting.department_name}. Pick their class
              to admit.
            </p>
            <div className="field">
              <label>Class / Level *</label>
              <Select
                value={admitForm.class_id}
                onChange={(v) => setAdmitForm({ ...admitForm, class_id: v })}
                options={myClasses}
                placeholder="Select class..."
                required
              />
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">
              <CurrencyCircleDollar size={16} /> Department Dues Payment
            </div>
            <p className="muted text-sm mb">Pre-filled and editable.</p>
            <div className="grid grid-3">
              <div className="field">
                <label>Amount (GHS)</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={admitForm.amount}
                  onChange={(e) => setAdmitForm({ ...admitForm, amount: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Method</label>
                <Select
                  value={admitForm.method}
                  onChange={(v) => setAdmitForm({ ...admitForm, method: v })}
                  options={METHOD_OPTIONS}
                />
              </div>
              <div className="field">
                <label>Date</label>
                <DatePicker
                  value={admitForm.paid_at}
                  onChange={(v) => setAdmitForm({ ...admitForm, paid_at: v })}
                />
              </div>
            </div>
          </div>

          {deptSouvenirList.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-title">
                <Gift size={16} /> Department Souvenirs
              </div>
              <div className="grid grid-3">
                {deptSouvenirList.map((s) => {
                  const given = givenSouvenirIds.includes(s.id);
                  return (
                    <Checkbox
                      key={s.id}
                      checked={deptSouvenirs.includes(s.id)}
                      disabled={given}
                      onChange={() =>
                        setDeptSouvenirs((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                        )
                      }
                      label={given ? `${s.name} (recorded)` : s.name}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={() => setAdmitting(null)}>
              Cancel
            </button>
            <button
              className="btn btn-green"
              onClick={admit}
              disabled={saving || !admitForm.class_id}
            >
              {saving ? (
                'Admitting...'
              ) : (
                <>
                  <UserPlus size={20} /> Admit Fresher
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* ─── Verify pre-registration modal (School Admin) ─── */}
      {verifying && schoolSide && (
        <Modal
          open
          size="wide"
          icon={<UserCheck size={20} />}
          title={`Verify ${verifying.full_name}`}
          subtitle="Check their details, correct anything wrong, assign a department, and record School dues & souvenirs."
          onClose={() => setVerifying(null)}
        >
          <form onSubmit={verifyApp}>
            <div className="modal-section">
              <div className="modal-section-title">
                <Student size={16} /> Fresher Details
              </div>
              <div className="grid grid-2">
                <div className="field">
                  <label>Full Name *</label>
                  <input
                    className="input"
                    value={verifyForm.name}
                    onChange={(e) => setVerifyForm({ ...verifyForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Reference Number *</label>
                  <input
                    className="input"
                    value={verifyForm.student_no}
                    onChange={(e) => setVerifyForm({ ...verifyForm, student_no: e.target.value })}
                    placeholder="e.g. REF-2026-00123"
                    required
                  />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input
                    className="input"
                    value={verifyForm.phone}
                    onChange={(e) => setVerifyForm({ ...verifyForm, phone: e.target.value })}
                    placeholder="e.g. 0244 000 000"
                  />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input
                    className="input"
                    type="email"
                    value={verifyForm.email}
                    onChange={(e) => setVerifyForm({ ...verifyForm, email: e.target.value })}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="field">
                  <label>Programme of Choice</label>
                  <input
                    className="input"
                    value={verifyForm.programme}
                    onChange={(e) => setVerifyForm({ ...verifyForm, programme: e.target.value })}
                    placeholder="e.g. BSc. Computer Science"
                  />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <Select
                    value={verifyForm.gender}
                    onChange={(v) => setVerifyForm({ ...verifyForm, gender: v })}
                    options={GENDER_OPTIONS}
                    placeholder="Select gender..."
                  />
                </div>
                <div className="field">
                  <label>Hometown / Region</label>
                  <input
                    className="input"
                    value={verifyForm.hometown}
                    onChange={(e) => setVerifyForm({ ...verifyForm, hometown: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Admission Year</label>
                  <input
                    className="input"
                    type="number"
                    min="2000"
                    max="2100"
                    value={verifyForm.admission_year}
                    onChange={(e) =>
                      setVerifyForm({ ...verifyForm, admission_year: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assign to Department *</label>
                <Select
                  value={verifyForm.department_id}
                  onChange={(v) => setVerifyForm({ ...verifyForm, department_id: v })}
                  options={deptOptions}
                  placeholder="Select department..."
                  required
                />
              </div>
            </div>

            <div className="modal-section">
              <div className="modal-section-title">
                <CurrencyCircleDollar size={16} /> School Dues Payment
              </div>
              <p className="muted text-sm mb">Pre-filled and editable.</p>
              <div className="grid grid-3">
                <div className="field">
                  <label>Amount (GHS)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={verifyPay.amount}
                    onChange={(e) => setVerifyPay({ ...verifyPay, amount: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Method</label>
                  <Select
                    value={verifyPay.method}
                    onChange={(v) => setVerifyPay({ ...verifyPay, method: v })}
                    options={METHOD_OPTIONS}
                  />
                </div>
                <div className="field">
                  <label>Date</label>
                  <DatePicker
                    value={verifyPay.paid_at}
                    onChange={(v) => setVerifyPay({ ...verifyPay, paid_at: v })}
                  />
                </div>
              </div>
            </div>

            {schoolSouvenirList.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-title">
                  <Gift size={16} /> School Souvenirs
                </div>
                <div className="grid grid-2">
                  {schoolSouvenirList.map((s) => (
                    <Checkbox
                      key={s.id}
                      checked={verifySouv.includes(s.id)}
                      onChange={() =>
                        setVerifySouv((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                        )
                      }
                      label={s.name}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setVerifying(null)}>
                Cancel
              </button>
              <button
                className="btn btn-green"
                disabled={
                  saving ||
                  !verifyForm.name.trim() ||
                  !verifyForm.student_no.trim() ||
                  !verifyForm.department_id
                }
              >
                <UserCheck size={18} /> {saving ? 'Verifying...' : 'Verify & Assign Department'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Registered freshers (school) / admit queue (dept) ─── */}
      {!(schoolSide && tab === 'prereg') && (
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
                  <th>{schoolSide ? 'Department' : 'Status'}</th>
                  {schoolSide && <th>Status</th>}
                  <th>Class</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={schoolSide ? 6 : 5} className="muted">
                      {schoolSide
                        ? 'No freshers registered yet. Click "Register Fresher" to capture one.'
                        : tab === 'pending'
                          ? 'No freshers are waiting for admission in your department right now.'
                          : 'No admitted freshers yet.'}
                    </td>
                  </tr>
                )}
                {paged.map((f) => {
                  const st = statusBadge(f);
                  return (
                    <tr
                      key={f.id}
                      className="row-click"
                      onClick={() => setDetails(f)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetails(f);
                        }
                      }}
                    >
                      <td className="fw-600">{f.name}</td>
                      <td>{f.student_no || '-'}</td>
                      <td>
                        {schoolSide ? (
                          f.department_name || '-'
                        ) : (
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        )}
                      </td>
                      {schoolSide && (
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </td>
                      )}
                      <td>{f.class_name || '-'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-sm">
                          {!schoolSide && !f.admitted_at && (
                            <button className="btn btn-sm btn-primary" onClick={() => openAdmit(f)}>
                              <UserPlus size={14} /> Admit
                            </button>
                          )}
                          {schoolSide && (
                            <>
                              <button
                                className="btn btn-sm btn-outline"
                                onClick={() => openEdit(f)}
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                              {isSchoolAdmin && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => deleteFresher(f)}
                                  title="Delete"
                                >
                                  <Trash size={14} />
                                </button>
                              )}
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
      )}

      {/* ─── School Admin: pre-registrations awaiting verification ─── */}
      {schoolSide && tab === 'prereg' && (
        <div className="card">
          {isSchoolAdmin && (
            <div className="mb">
              <p className="muted text-sm">
                Freshers still at home fill this once — verify them on reporting day.
              </p>
              <div className="flex align-center gap-sm mt-sm" style={{ flexWrap: 'wrap' }}>
                <span className="code-cell">{preregLink()}</span>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => copyText(preregLink(), 'Pre-registration link')}
                >
                  <Copy size={14} /> Copy link
                </button>
                {accessCode && (
                  <>
                    <span className="muted text-sm">access code:</span>
                    <span className="code-cell">{accessCode}</span>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => copyText(accessCode, 'Access code')}
                      title="Copy access code"
                    >
                      <Copy size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="field" style={{ maxWidth: 400 }}>
            <input
              className="input search-input"
              placeholder="Search submissions by name or student number..."
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
                  <th>Programme</th>
                  <th>Phone</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {appPager.slice.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No pre-registrations yet. Share the form link above with incoming freshers.
                    </td>
                  </tr>
                )}
                {appPager.slice.map((a) => (
                  <tr key={a.id}>
                    <td className="fw-600">{a.full_name}</td>
                    <td>{a.student_no || '-'}</td>
                    <td>{a.programme || '-'}</td>
                    <td>{a.phone || '-'}</td>
                    <td>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="flex gap-sm">
                        <button className="btn btn-sm btn-primary" onClick={() => openVerify(a)}>
                          <UserCheck size={14} /> Verify
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteApp(a)}
                          title="Remove submission"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={appPager.page}
            totalPages={appPager.totalPages}
            onPageChange={appPager.setPage}
            totalItems={appPager.totalItems}
            pageSize={appPager.perPage}
          />
        </div>
      )}
    </div>
  );
}
