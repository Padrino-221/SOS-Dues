import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { mainDuesIssue } from '../utils/duesLimits';
import { genderScopeNote } from '../utils/genderScope';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import {
  IconUserPlus as UserPlus,
  IconPlus as Plus,
  IconUsers as Users,
  IconCircleCheck as CheckCircle,
  IconAlertTriangle as Warning,
  IconUserCheck as UserCheck,
  IconUserMinus as UserMinus,
  IconPencil as Pencil,
  IconTrash as Trash,
  IconCurrencyDollar as CurrencyCircleDollar,
  IconGift as Gift,
  IconBackpack as Student,
  IconLink as LinkSimple,
  IconCopy as Copy,
  IconDownload as DownloadSimple,
  IconSend as PaperPlaneTilt,
} from '@tabler/icons-react';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import DatePicker from '../components/ui/DatePicker';
import Confirm from '../components/ui/Confirm';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import StudentDetailsModal from '../components/ui/StudentDetailsModal';
import ResendConfirmModal from '../components/ui/ResendConfirmModal';

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

const APP_PAGE_SIZE = 10;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
// Student reference numbers look like UA2309264: "UA" + 7 digits.
const STUDENT_NO_RE = /^UA\d{7}$/i;

// Tickable "Other Dues" lines for a fresher. Amounts default from the item
// but stay editable — the server re-validates them against the collector's
// scope (school-wide at verify/register, the department's own at admission)
// before charging. `disabledNote(item)` greys items out (e.g. already charged).
function ExtrasPicker({ items, selected, onToggle, onAmount, disabledNote }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((item) => {
        const amount = selected[item.id];
        const checked = amount !== undefined;
        const note = disabledNote ? disabledNote(item) : null;
        return (
          <div
            key={item.id}
            className="flex gap-sm"
            style={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <div style={{ flex: '1 1 210px' }}>
              <Checkbox
                checked={checked}
                disabled={Boolean(note)}
                onChange={() => onToggle(item)}
                label={note ? `${item.name} ${note}` : item.name}
              />
            </div>
            {checked && (
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                style={{ maxWidth: 150 }}
                value={amount}
                onChange={(e) => onAmount(item, e.target.value)}
                aria-label={`${item.name} amount (GHS)`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Freshers() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff', 'super_admin'].includes(user?.role);
  const isSchoolAdmin = user?.role === 'school_admin' || user?.role === 'super_admin';
  // Resend receipt email(s): school admins (any student) + dept admins (own dept).
  // Resend receipt email(s): every admin and staff role may use it — the
  // server scopes it (school-side: any student; dept-side: own department).
  const canResend = [
    'school_admin',
    'super_admin',
    'school_staff',
    'dept_admin',
    'dept_staff',
  ].includes(user?.role);

  const [freshers, setFreshers] = useState([]);
  const [tabCounts, setTabCounts] = useState({ pending: 0, admitted: 0 });
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [depts, setDepts] = useState([]);
  const [souvenirs, setSouvenirs] = useState([]);
  const [schoolDues, setSchoolDues] = useState(''); // school-wide amount
  const [deptDues, setDeptDues] = useState(''); // own dept amount (dept admin)
  const [toasts, setToasts] = useState([]);
  const [tab, setTab] = useState(schoolSide ? 'registered' : 'pending'); // school: registered | prereg · dept: pending | admitted
  const [applications, setApplications] = useState([]);
  const [appsTotal, setAppsTotal] = useState(0); // true total for the active prereg filter
  const [preregCounts, setPreregCounts] = useState({ pending: 0, rejected: 0 });
  const [preregTab, setPreregTab] = useState('pending'); // pending | rejected
  const [appsPage, setAppsPage] = useState(1);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Details modal (row click)
  const [details, setDetails] = useState(null);

  // Verify pre-registration modal (School Admin)
  const [verifying, setVerifying] = useState(null);
  const [resendTarget, setResendTarget] = useState(null);
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
  // Other Dues: active dues items chargeable to freshers (school-wide +
  // department items). Selection maps are { [item id]: amount string }.
  const [duesItems, setDuesItems] = useState([]);
  const [verifyExtras, setVerifyExtras] = useState({});
  const [registerExtras, setRegisterExtras] = useState({});

  // Admit modal (Dept Admin)
  const [admitting, setAdmitting] = useState(null);
  const [admitForm, setAdmitForm] = useState({
    amount: '',
    method: 'cash',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  // The department's own dues items, ticked at admission — plus the labels
  // already charged to this student so the same item can't be collected twice.
  const [admitExtras, setAdmitExtras] = useState({});
  const [chargedExtraLabels, setChargedExtraLabels] = useState([]);
  const [deptSouvenirs, setDeptSouvenirs] = useState([]);
  const [givenSouvenirIds, setGivenSouvenirIds] = useState([]);

  // Record remaining department souvenirs after admission (Dept Admin)
  const [deptEditing, setDeptEditing] = useState(null);
  const [deptEditSouvs, setDeptEditSouvs] = useState([]);
  const [deptGivenIds, setDeptGivenIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  // Download the currently listed freshers as CSV (same scope + filters as
  // the table: school sees every fresher, departments see their own queue).
  const downloadFreshersCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (!schoolSide) params.status = tab === 'admitted' ? 'admitted' : 'pending';
      const res = await api.get('/students/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'freshers.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      addToast('Could not download the CSV. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

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
        setFreshers(asArray(res.data));
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
    ])
      .then(([p, a]) => {
        setTabCounts({ pending: asArray(p.data).length, admitted: asArray(a.data).length });
      })
      .catch(() => {});
  }, [search, schoolSide]);

  useEffect(() => {
    loadTabCounts();
  }, [loadTabCounts]);

  useEffect(() => {
    setPage(1);
  }, [search, tab]);

  useEffect(() => {
    setAppsPage(1);
  }, [search, preregTab]);

  // School: pre-registration submissions, server-paginated so the list never
  // silently truncates — the badge shows the true total and the second,
  // lightweight request keeps the other filter's count fresh.
  const loadApps = useCallback(() => {
    const base = { paged: '1', search: search || undefined };
    const other = preregTab === 'pending' ? 'rejected' : 'pending';
    Promise.all([
      api.get('/freshers', {
        params: {
          ...base,
          status: preregTab,
          limit: APP_PAGE_SIZE,
          offset: (appsPage - 1) * APP_PAGE_SIZE,
        },
      }),
      api.get('/freshers', { params: { ...base, status: other, limit: 1, offset: 0 } }),
    ])
      .then(([cur, otherRes]) => {
        const norm = (data) =>
          Array.isArray(data)
            ? { items: data, total: data.length }
            : { items: data.items || [], total: data.total || 0 };
        const a = norm(cur.data);
        const b = norm(otherRes.data);
        // If the current page fell off the end (rows deleted/rejected/verified
        // while on a later page), step back to the last page that exists.
        if (a.items.length === 0 && appsPage > 1 && a.total > 0) {
          setAppsPage(Math.max(1, Math.ceil(a.total / APP_PAGE_SIZE)));
          return;
        }
        setApplications(a.items);
        setAppsTotal(a.total);
        setPreregCounts(
          preregTab === 'pending'
            ? { pending: a.total, rejected: b.total }
            : { pending: b.total, rejected: a.total }
        );
      })
      .catch(() => setLoadError('Pre-registration records could not be loaded.'));
  }, [search, preregTab, appsPage]);

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
    'fresher:registered': () => {
      loadFreshers();
      loadTabCounts();
    },
    'fresher:verified': () => {
      loadFreshers();
      loadTabCounts();
      if (schoolSide) loadApps();
    },
    'fresher:admitted': () => {
      loadFreshers();
      loadTabCounts();
    },
    'payment:new': loadFreshers,
    'student:changed': loadFreshers,
  });

  useEffect(() => {
    // Reference data
    api
      .get('/settings')
      .then((res) => {
        setSchoolDues(res.data?.school_dues_amount || '');
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
    // Both sides need the items — the desks charge school-wide ones; the
    // department's admit modal charges its own. The API scopes the list by role.
    api
      .get('/dues-items')
      .then((res) => setDuesItems(asArray(res.data)))
      .catch(() => {});
  }, [schoolSide]);

  // School souvenirs only have category 'school'; the souvenirs the dept
  // hands out at admission are the 'department' category items.
  const schoolSouvenirList = souvenirs.filter((s) => s.category === 'school');
  const deptSouvenirList = souvenirs.filter((s) => s.category === 'department');

  // ─── Other Dues (additional dues items, freshers only) ───
  // Collection split: the verify and registration desks charge SCHOOL-WIDE
  // items only (school money); a department's own items are collected by that
  // department in the admit modal. Selections outside the visible list are
  // filtered out at render and submit — swapping departments never needs to
  // prune state.
  const schoolItems = duesItems.filter((i) => i.active && i.department_id == null);
  const itemsForDept = (deptId) =>
    duesItems.filter(
      (i) => i.active && i.department_id != null && Number(i.department_id) === Number(deptId)
    );
  const tickedExtras = (sel, items) => items.filter((i) => sel[i.id] !== undefined);
  const extrasSum = (sel, items) =>
    tickedExtras(sel, items).reduce((s, i) => s + (Number(sel[i.id]) || 0), 0);
  const extrasPayload = (sel, items) =>
    tickedExtras(sel, items).map((i) => ({
      dues_item_id: i.id,
      amount: Number(sel[i.id]) || 0,
    }));
  // First ticked item with a missing/non-positive amount — refused before
  // submit so the server never has to bounce the whole verification.
  const invalidExtra = (sel, items) =>
    tickedExtras(sel, items).find((i) => !(Number(sel[i.id]) > 0)) || null;
  const toggleExtra = (setter) => (item) =>
    setter((prev) => {
      const next = { ...prev };
      if (next[item.id] !== undefined) delete next[item.id];
      else next[item.id] = String(item.amount ?? '');
      return next;
    });

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
    setRegisterExtras({});
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
        const ids = asArray(res.data).map((r) => r.souvenir_id);
        setGivenSouvenirIds(ids);
        setSchoolSouvenirs(ids);
      })
      .catch(() => {});
    setShowRegister(true);
  };

  const buildPayload = (isFresher, departmentId) => {
    const payload = {
      name: studentForm.name.trim(),
      student_no: studentForm.student_no.trim().toUpperCase() || null,
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
      if (!STUDENT_NO_RE.test((studentForm.student_no || '').trim())) {
        addToast('Enter a valid reference number (e.g. UA2309264).', 'error');
        setSaving(false);
        return;
      }
      const badExtra = invalidExtra(registerExtras, schoolItems);
      if (badExtra) {
        addToast(`Enter an amount above 0 for "${badExtra.name}", or untick it.`, 'error');
        setSaving(false);
        return;
      }
      const duesIssue = mainDuesIssue(schoolPayment.amount, 'School dues');
      if (duesIssue) {
        addToast(duesIssue, 'error');
        setSaving(false);
        return;
      }
      const extras = extrasPayload(registerExtras, schoolItems);
      if (schoolSouvenirs.length > 0 && Number(schoolPayment.amount) <= 0 && extras.length === 0) {
        addToast(
          'A payment (School dues or an additional dues item) is required to record souvenirs.',
          'error'
        );
        setSaving(false);
        return;
      }
      const res = await api.post('/students/freshers', {
        ...buildPayload(true, studentForm.department_id),
        payment:
          Number(schoolPayment.amount) > 0 || extras.length > 0
            ? {
                ...schoolPayment,
                amount: Number(schoolPayment.amount) || 0,
                ...(extras.length ? { extras } : {}),
              }
            : undefined,
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

  // ─── Dept Admin: admit (freshers always enter at Level 100) ───
  const openAdmit = (f) => {
    setAdmitting(f);
    setAdmitForm({
      amount: deptDues || '',
      method: 'cash',
      paid_at: new Date().toISOString().slice(0, 10),
    });
    setAdmitExtras({});
    setChargedExtraLabels([]);
    setDeptSouvenirs([]);
    setGivenSouvenirIds([]);
    api
      .get(`/students/${f.id}/souvenirs`)
      .then((res) => {
        const ids = asArray(res.data)
          .filter((r) => r.level === 'department')
          .map((r) => r.souvenir_id);
        setGivenSouvenirIds(ids);
        setDeptSouvenirs(ids);
      })
      .catch(() => {});
    // Items already charged to this fresher (e.g. collected earlier) are
    // greyed out in the picker — an item is only ever charged once.
    api
      .get(`/students/${f.id}/payments`)
      .then((res) => {
        const labels = asArray(res.data)
          .filter((p) => p.type === 'extra_dues' && p.label)
          .map((p) => p.label);
        setChargedExtraLabels([...new Set(labels)]);
      })
      .catch(() => setChargedExtraLabels([]));
  };

  const admit = async () => {
    const admitItems = itemsForDept(admitting.department_id);
    const badAdmitExtra = invalidExtra(admitExtras, admitItems);
    if (badAdmitExtra) {
      addToast(`Enter an amount above 0 for "${badAdmitExtra.name}", or untick it.`, 'error');
      return;
    }
    const extras = extrasPayload(admitExtras, admitItems);
    const amount = Number(admitForm.amount) || 0;
    const duesIssue = mainDuesIssue(amount, 'Department dues');
    if (duesIssue) {
      addToast(duesIssue, 'error');
      return;
    }
    if (amount <= 0 && extras.length === 0 && deptSouvenirs.length > 0) {
      addToast(
        'Record a payment (Department dues or an additional dues item) to give souvenirs.',
        'error'
      );
      return;
    }
    setSaving(true);
    try {
      const body = {};
      if (amount > 0 || extras.length > 0) {
        body.payment = {
          amount,
          method: admitForm.method,
          paid_at: admitForm.paid_at || undefined,
          ...(extras.length ? { extras } : {}),
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

  // ─── Dept Admin: record remaining department souvenirs after admission ───
  const openDeptEdit = (f) => {
    setDeptEditing(f);
    setDeptEditSouvs([]);
    setDeptGivenIds([]);
    api
      .get(`/students/${f.id}/souvenirs`)
      .then((res) => {
        const ids = asArray(res.data)
          .filter((r) => r.level === 'department')
          .map((r) => r.souvenir_id);
        setDeptGivenIds(ids);
        setDeptEditSouvs(ids);
      })
      .catch(() => {});
  };

  const saveDeptEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const newly = deptEditSouvs.filter((id) => !deptGivenIds.includes(id));
      if (newly.length === 0) {
        addToast('No new souvenirs selected.');
        setDeptEditing(null);
        return;
      }
      const res = await api.post(`/students/${deptEditing.id}/souvenirs`, {
        souvenir_ids: newly,
      });
      const added = res.data?.added || 0;
      addToast(
        added > 0
          ? `${deptEditing.name} — ${added} souvenir(s) recorded.${res.data.receipt_number ? ` Receipt ${res.data.receipt_number}.` : ''}`
          : `${deptEditing.name} — souvenirs already recorded.`
      );
      setDeptEditing(null);
      loadFreshers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to record souvenirs', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── School Admin: pre-registrations (freshers still at home) ───
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
    setVerifyExtras({});
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
      const emailVal = verifyForm.email.trim();
      if (emailVal && !EMAIL_RE.test(emailVal)) {
        addToast('Enter a valid email address, or leave Email blank.', 'error');
        setSaving(false);
        return;
      }
      // Mirror the server rule: the UA format only applies when the admin
      // retypes the number. Free-form numbers filed via the apply form pass
      // through unchanged.
      const storedNo = String(verifying.student_no || '')
        .trim()
        .toUpperCase();
      if (
        verifyForm.student_no.trim().toUpperCase() !== storedNo &&
        !STUDENT_NO_RE.test((verifyForm.student_no || '').trim())
      ) {
        addToast('Enter a valid reference number (e.g. UA2309264).', 'error');
        setSaving(false);
        return;
      }
      const badExtra = invalidExtra(verifyExtras, schoolItems);
      if (badExtra) {
        addToast(`Enter an amount above 0 for "${badExtra.name}", or untick it.`, 'error');
        setSaving(false);
        return;
      }
      const extras = extrasPayload(verifyExtras, schoolItems);
      const duesIssue = mainDuesIssue(verifyPay.amount, 'School dues');
      if (duesIssue) {
        addToast(duesIssue, 'error');
        setSaving(false);
        return;
      }
      const body = {
        full_name: verifyForm.name.trim(),
        student_no: verifyForm.student_no.trim(),
        phone: verifyForm.phone.trim() || undefined,
        email: emailVal || undefined,
        programme: verifyForm.programme.trim() || undefined,
        gender: verifyForm.gender || undefined,
        hometown: verifyForm.hometown.trim() || undefined,
        department_id: Number(verifyForm.department_id),
        admission_year: verifyForm.admission_year ? String(verifyForm.admission_year) : undefined,
      };
      if (Number(verifyPay.amount) > 0 || extras.length > 0) {
        body.payment = {
          amount: Number(verifyPay.amount) || 0,
          method: verifyPay.method,
          paid_at: verifyPay.paid_at || undefined,
          ...(extras.length ? { extras } : {}),
        };
      }
      if (verifySouv.length > 0) body.souvenir_ids = verifySouv;

      const res = await api.post(`/freshers/${verifying.id}/verify`, body);
      let msg = `${verifyForm.name.trim()} verified and assigned to a department.`;
      if (res.data.receipt_number) {
        msg += extras.length
          ? ` Dues receipt ${res.data.receipt_number}.`
          : ` School Dues receipt ${res.data.receipt_number}.`;
      }
      let toastType = 'success';
      const emailInfo = res.data?.email;
      if (emailInfo?.sent) {
        msg += ` Receipt emailed to ${emailInfo.to || emailVal}.`;
      } else if (emailInfo?.mode === 'dev') {
        msg += ' Receipt recorded — email not configured.';
      } else if (emailInfo?.to) {
        toastType = 'error';
        msg += ' Receipt recorded — EMAIL FAILED, student not emailed.';
      }
      addToast(msg, toastType);
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
      title: 'Delete Pre-Registration',
      message: `This removes ${a.full_name}'s application entirely — use Reject to keep a record with a reason. Only delete spam submissions.`,
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

  // Reject (school admin only): keeps the record, stores the reason.
  const rejectApp = (a) => {
    const input = window.prompt(
      `Reject ${a.full_name}'s pre-registration?\n\nEnter the reason (required) — it is kept on the record:`
    );
    if (input === null) return;
    const reason = input.trim();
    if (!reason) {
      addToast('A reason is required to reject an application.', 'error');
      return;
    }
    api
      .patch(`/freshers/${a.id}/reject`, { reason })
      .then(() => {
        addToast(`${a.full_name}'s application rejected.`);
        loadApps();
      })
      .catch((err) =>
        addToast(err.response?.data?.error || 'Failed to reject application', 'error')
      );
  };

  const isSuper = user?.role === 'super_admin';

  // Super admin: edit a pending application's details before verification.
  // Reuses the verify modal (it already allows correcting every field) but
  // marks the session as edit-only so submitting saves without verifying.
  const [editingApp, setEditingApp] = useState(false);
  const editApp = (a) => {
    openVerify(a);
    setEditingApp(true);
  };

  const saveAppEdit = async () => {
    if (!verifying || saving) return;
    setSaving(true);
    try {
      const emailVal = verifyForm.email.trim();
      if (emailVal && !EMAIL_RE.test(emailVal)) {
        addToast('Enter a valid email address, or leave Email blank.', 'error');
        setSaving(false);
        return;
      }
      const res = await api.patch(`/freshers/${verifying.id}`, {
        full_name: verifyForm.name.trim(),
        student_no: verifyForm.student_no.trim(),
        phone: verifyForm.phone.trim() || undefined,
        email: emailVal || undefined,
        programme: verifyForm.programme.trim() || undefined,
        gender: verifyForm.gender || undefined,
        hometown: verifyForm.hometown.trim() || undefined,
      });
      addToast(`${res.data.application.full_name}'s details corrected.`);
      setVerifying(null);
      setEditingApp(false);
      loadApps();
    } catch (err) {
      addToast(err.response?.data?.error || 'Edit failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Super admin: reopen a rejected application back to pending.
  const reopenApp = (a) => {
    const input = window.prompt(
      `Reopen ${a.full_name}'s application?\n\nEnter the reason (required) — it is audit-logged:`
    );
    if (input === null) return;
    const reason = input.trim();
    if (!reason) {
      addToast('A reason is required to reopen an application.', 'error');
      return;
    }
    api
      .post(`/freshers/${a.id}/reopen`, { reason })
      .then(() => {
        addToast(`${a.full_name}'s application reopened to pending.`);
        loadApps();
      })
      .catch((err) =>
        addToast(err.response?.data?.error || 'Failed to reopen application', 'error')
      );
  };

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

      <ResendConfirmModal
        student={resendTarget}
        onClose={() => setResendTarget(null)}
        addToast={addToast}
      />

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
                `Pre-Registrations${preregCounts.pending ? ` (${preregCounts.pending})` : ''}`,
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
                  <label>Reference Number *</label>
                  <input
                    className="input"
                    value={studentForm.student_no}
                    onChange={(e) => setStudentForm({ ...studentForm, student_no: e.target.value })}
                    placeholder="e.g. UA2309264"
                    required
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
                {schoolItems.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="muted text-xs fw-600 mb-sm">
                      OTHER DUES (SCHOOL-WIDE) — tick what the fresher pays now
                    </div>
                    <ExtrasPicker
                      items={schoolItems}
                      selected={registerExtras}
                      onToggle={toggleExtra(setRegisterExtras)}
                      onAmount={(item, v) =>
                        setRegisterExtras((prev) => ({ ...prev, [item.id]: v }))
                      }
                      disabledNote={(item) =>
                        genderScopeNote(item.gender, studentForm.gender)
                          ? `(${genderScopeNote(item.gender, studentForm.gender)})`
                          : null
                      }
                    />
                  </div>
                )}
                <div className="flex" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                  <span className="muted text-sm">Total due:&nbsp;</span>
                  <strong>
                    GHS{' '}
                    {(
                      (Number(schoolPayment.amount) || 0) + extrasSum(registerExtras, schoolItems)
                    ).toFixed(2)}
                  </strong>
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
                disabled={
                  saving ||
                  !studentForm.name.trim() ||
                  !studentForm.student_no.trim() ||
                  !studentForm.department_id
                }
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
          subtitle="Confirm admission and record Department dues & souvenirs."
          onClose={() => setAdmitting(null)}
        >
          <div className="modal-section">
            <div className="modal-section-title">
              <Users size={16} /> Admission Details
            </div>
            <p className="muted text-sm mb">
              Registered by the School and assigned to {admitting.department_name}. Freshers always
              enter at Level 100.
            </p>
            <div className="field">
              <label>Level</label>
              <input className="input" value="Level 100" disabled readOnly />
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
            {itemsForDept(admitting.department_id).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="muted text-xs fw-600 mb-sm">
                  OTHER DUES — your department's additional charges
                </div>
                <ExtrasPicker
                  items={itemsForDept(admitting.department_id)}
                  selected={admitExtras}
                  onToggle={toggleExtra(setAdmitExtras)}
                  onAmount={(item, v) => setAdmitExtras((prev) => ({ ...prev, [item.id]: v }))}
                  disabledNote={(item) => {
                    if (chargedExtraLabels.includes(item.name)) return '(already charged)';
                    const genderNote = genderScopeNote(item.gender, admitting.gender);
                    return genderNote ? `(${genderNote})` : null;
                  }}
                />
              </div>
            )}
            <div className="flex" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <span className="muted text-sm">Total due:&nbsp;</span>
              <strong>
                GHS{' '}
                {(
                  (Number(admitForm.amount) || 0) +
                  extrasSum(admitExtras, itemsForDept(admitting.department_id))
                ).toFixed(2)}
              </strong>
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
            <button className="btn btn-green" onClick={admit} disabled={saving}>
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

      {/* ─── Record remaining department souvenirs (Dept Admin) ─── */}
      {deptEditing && !schoolSide && (
        <Modal
          open
          icon={<Gift size={20} />}
          title={`Souvenirs — ${deptEditing.name}`}
          subtitle="Record department souvenirs the student collects after admission."
          onClose={() => setDeptEditing(null)}
        >
          <form onSubmit={saveDeptEdit}>
            <div className="modal-section">
              <div className="modal-section-title">
                <Users size={16} /> Student
              </div>
              <div className="grid grid-2">
                <div className="field">
                  <label>Reference Number</label>
                  <input
                    className="input"
                    value={deptEditing.student_no || '-'}
                    disabled
                    readOnly
                  />
                </div>
                <div className="field">
                  <label>Level</label>
                  <input
                    className="input"
                    value={deptEditing.level ? `Level ${deptEditing.level}` : '-'}
                    disabled
                    readOnly
                  />
                </div>
              </div>
            </div>

            {deptSouvenirList.length > 0 ? (
              <div className="modal-section">
                <div className="modal-section-title">
                  <Gift size={16} /> Department Souvenirs
                </div>
                <p className="muted text-sm mb">
                  Items already handed out are marked "recorded". Tick any remaining items the
                  student collects now — a $0 souvenir receipt is issued for them.
                </p>
                <div className="grid grid-3">
                  {deptSouvenirList.map((s) => {
                    const given = deptGivenIds.includes(s.id);
                    return (
                      <Checkbox
                        key={s.id}
                        checked={deptEditSouvs.includes(s.id)}
                        disabled={given}
                        onChange={() =>
                          setDeptEditSouvs((prev) =>
                            prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                          )
                        }
                        label={given ? `${s.name} (recorded)` : s.name}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="modal-section">
                <p className="muted text-sm mb" style={{ marginBottom: 0 }}>
                  No department souvenirs are configured yet — add them in Settings first.
                </p>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setDeptEditing(null)}
              >
                Cancel
              </button>
              <button className="btn btn-green" disabled={saving}>
                <Gift size={18} /> {saving ? 'Saving...' : 'Record Souvenirs'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Verify pre-registration modal (School Admin) ─── */}
      {verifying && schoolSide && (
        <Modal
          open
          size="wide"
          icon={<UserCheck size={20} />}
          title={`${editingApp ? 'Edit' : 'Verify'} ${verifying.full_name}`}
          subtitle={
            editingApp
              ? 'Correct the details below — saving keeps the application pending.'
              : 'Check their details, correct anything wrong, assign a department, and record School dues & souvenirs.'
          }
          onClose={() => {
            setVerifying(null);
            setEditingApp(false);
          }}
        >
          <form
            onSubmit={
              editingApp
                ? (e) => {
                    e.preventDefault();
                    saveAppEdit();
                  }
                : verifyApp
            }
          >
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
                    placeholder="e.g. UA2309264"
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
              {/* Edit mode only corrects the application details — the
                  department, dues and souvenirs are settled at verification
                  time, so they are hidden (and their `required` guard
                  removed) while editing. */}
              {!editingApp && (
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
              )}
            </div>

            {/* Dues and souvenirs are collected at verification, not when a
                correction is saved — the edit endpoint only records the
                applicant's own details. */}
            {!editingApp && (
              <>
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
                  {schoolItems.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div className="muted text-xs fw-600 mb-sm">
                        OTHER DUES (SCHOOL-WIDE) — tick what the fresher pays now
                      </div>
                      <ExtrasPicker
                        items={schoolItems}
                        selected={verifyExtras}
                        onToggle={toggleExtra(setVerifyExtras)}
                        onAmount={(item, v) =>
                          setVerifyExtras((prev) => ({ ...prev, [item.id]: v }))
                        }
                        disabledNote={(item) =>
                          genderScopeNote(item.gender, verifyForm.gender)
                            ? `(${genderScopeNote(item.gender, verifyForm.gender)})`
                            : null
                        }
                      />
                    </div>
                  )}
                  <div className="flex" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                    <span className="muted text-sm">Total due:&nbsp;</span>
                    <strong>
                      GHS{' '}
                      {(
                        (Number(verifyPay.amount) || 0) + extrasSum(verifyExtras, schoolItems)
                      ).toFixed(2)}
                    </strong>
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
              </>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setVerifying(null);
                  setEditingApp(false);
                }}
              >
                Cancel
              </button>
              {editingApp ? (
                <button
                  className="btn btn-green"
                  disabled={saving || !verifyForm.name.trim() || !verifyForm.student_no.trim()}
                >
                  <Pencil size={18} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              ) : (
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
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Registered freshers (school) / admit queue (dept) ─── */}
      {!(schoolSide && tab === 'prereg') && (
        <div className="card">
          <div className="flex gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ maxWidth: 400, flex: '1 1 260px', marginBottom: 0 }}>
              <input
                className="input search-input"
                placeholder="Search by name or student number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={downloadFreshersCsv}
              disabled={exporting}
              title="Download the listed freshers as CSV"
            >
              <DownloadSimple size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Student No</th>
                  <th>{schoolSide ? 'Department' : 'Status'}</th>
                  {schoolSide && <th>Status</th>}
                  <th>Level</th>
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
                      <td>{f.level ? `Level ${f.level}` : '-'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-sm">
                          {!schoolSide && !f.admitted_at && (
                            <button className="btn btn-sm btn-primary" onClick={() => openAdmit(f)}>
                              <UserPlus size={14} /> Admit
                            </button>
                          )}
                          {!schoolSide && f.admitted_at && user?.role === 'dept_admin' && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => openDeptEdit(f)}
                              title="Record souvenirs"
                            >
                              <Gift size={14} />
                            </button>
                          )}
                          {!schoolSide && canResend && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => setResendTarget(f)}
                              title="Review payment details and resend receipt email(s)"
                              aria-label={`Resend receipt email to ${f.name}`}
                            >
                              <PaperPlaneTilt size={14} />
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
                              {canResend && (
                                <button
                                  className="btn btn-sm btn-outline"
                                  onClick={() => setResendTarget(f)}
                                  title="Review payment details and resend receipt email(s)"
                                  aria-label={`Resend receipt email to ${f.name}`}
                                >
                                  <PaperPlaneTilt size={14} />
                                </button>
                              )}
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
              </div>
            </div>
          )}

          <div className="flex align-center gap-sm mb" style={{ flexWrap: 'wrap' }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {[
                ['pending', `Pending${preregCounts.pending ? ` (${preregCounts.pending})` : ''}`],
                [
                  'rejected',
                  `Rejected${preregCounts.rejected ? ` (${preregCounts.rejected})` : ''}`,
                ],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`tab-btn ${preregTab === key ? 'active' : ''}`}
                  onClick={() => setPreregTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="field" style={{ maxWidth: 360, marginBottom: 0, flex: '1 1 240px' }}>
              <input
                className="input search-input"
                placeholder="Search submissions by name or student number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
                  {preregTab === 'rejected' && <th>Reason</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 && (
                  <tr>
                    <td colSpan={preregTab === 'rejected' ? 7 : 6} className="muted">
                      {preregTab === 'rejected'
                        ? 'No rejected applications.'
                        : 'No pre-registrations yet. Share the form link above with incoming freshers.'}
                    </td>
                  </tr>
                )}
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td className="fw-600">{a.full_name}</td>
                    <td>{a.student_no || '-'}</td>
                    <td>{a.programme || '-'}</td>
                    <td>{a.phone || '-'}</td>
                    <td>{new Date(a.created_at).toLocaleDateString()}</td>
                    {preregTab === 'rejected' && <td>{a.rejection_reason || '-'}</td>}
                    <td>
                      <div className="flex gap-sm">
                        {preregTab === 'pending' && (
                          <button className="btn btn-sm btn-primary" onClick={() => openVerify(a)}>
                            <UserCheck size={14} /> Verify
                          </button>
                        )}
                        {isSuper && preregTab === 'pending' && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => editApp(a)}
                            title="Correct details before verification"
                          >
                            <Pencil size={14} /> Edit
                          </button>
                        )}
                        {isSuper && preregTab === 'rejected' && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => reopenApp(a)}
                            title="Reopen back to pending"
                          >
                            <UserCheck size={14} /> Reopen
                          </button>
                        )}
                        {isSchoolAdmin && preregTab === 'pending' && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => rejectApp(a)}
                            title="Reject with a reason"
                          >
                            <UserMinus size={14} /> Reject
                          </button>
                        )}
                        {isSchoolAdmin && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => deleteApp(a)}
                            title="Delete submission (spam only)"
                          >
                            <Trash size={14} />
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
            page={appsPage}
            totalPages={Math.max(1, Math.ceil(appsTotal / APP_PAGE_SIZE))}
            onPageChange={setAppsPage}
            totalItems={appsTotal}
            pageSize={APP_PAGE_SIZE}
          />
        </div>
      )}
    </div>
  );
}
