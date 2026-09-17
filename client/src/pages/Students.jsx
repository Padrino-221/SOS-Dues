import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import {
  Plus,
  X,
  CheckCircle,
  Warning,
  UploadSimple,
  FileCsv,
  Trash,
  Student,
  PencilSimple,
  ArrowClockwise,
  Swap,
  Archive,
  Gift,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';
import Confirm from '../components/ui/Confirm';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import StudentDetailsModal from '../components/ui/StudentDetailsModal';

const GENDER_OPTIONS = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Other', label: 'Other' },
];

const LEVEL_OPTIONS = [
  { value: '100', label: 'Level 100' },
  { value: '200', label: 'Level 200' },
  { value: '300', label: 'Level 300' },
  { value: '400', label: 'Level 400' },
];

const EMPTY_FORM = {
  name: '',
  student_no: '',
  level: '',
  class_id: '',
  phone: '',
  email: '',
  programme: '',
  gender: '',
  hometown: '',
  admission_year: '',
};

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

// CSV import — state machine:
//  { step: 'form' } → choose a CSV file / default class → preview rows
//  { step: 'preview', rows: [{name, student_no, class_name, status, error}] }
const CSV_HEADERS = [
  'name',
  'student_no',
  'level',
  'class',
  'admission_year',
  'phone',
  'email',
  'programme',
  'gender',
  'hometown',
];
const CSV_TEMPLATE = `${CSV_HEADERS.join(',')}\nAma Serwaa,UEB2001,200,Level 200,2024,0244000000,ama@example.com,BSc Computer Science,Female,Sunyani`;

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  if (!['name', 'student_no', 'class'].every((header) => headers.includes(header))) return null;
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, parts[index] || '']));
    if (row.name || row.student_no) rows.push({ ...row, class_name: row.class || '' });
  }
  return rows;
}

function splitCsvLine(line) {
  const parts = [];
  let current = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      parts.push(current.trim());
      current = '';
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
}

export default function Students() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff'].includes(user?.role);
  const isSchoolAdmin = user?.role === 'school_admin';
  const isDeptAdmin = user?.role === 'dept_admin';

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState([]);
  const [depts, setDepts] = useState([]);
  const [deptFilter, setDeptFilter] = useState(''); // school only
  const [toasts, setToasts] = useState([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Add / Edit form (Dept Admin) — same profile fields as freshers
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deptSouvenirs, setDeptSouvenirs] = useState([]);
  const [schoolSouvenirs, setSchoolSouvenirs] = useState([]);
  const [givenSouvenirs, setGivenSouvenirs] = useState([]);
  const [souvenirSel, setSouvenirSel] = useState([]);

  // CSV import (Dept Admin)
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState('');
  const [defaultClassId, setDefaultClassId] = useState('');
  const [preview, setPreview] = useState(null); // { rows, okCount }
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  // Details modal (row click)
  const [details, setDetails] = useState(null);

  // Confirm delete
  const [confirm, setConfirm] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
    danger: true,
  });

  // Rollover (School Admin)
  const [showRollover, setShowRollover] = useState(false);
  const [holdIds, setHoldIds] = useState([]); // repeater student ids to hold at level
  const [rolloverSearch, setRolloverSearch] = useState('');
  const [rolling, setRolling] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferStudent, setTransferStudent] = useState(null);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const loadStudents = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = { is_fresher: 'false' };
    if (search) params.search = search;
    if (schoolSide) params.archived = includeArchived ? 'true' : 'false';
    if (schoolSide && deptFilter) {
      // School views by department via search of department name is not possible
      // server-side; fetch all and filter client-side instead.
    }
    api
      .get('/students', { params })
      .then((res) => {
        let list = res.data;
        if (schoolSide && deptFilter) {
          list = list.filter((s) => s.department_id === Number(deptFilter));
        }
        setStudents(list);
      })
      .catch(() =>
        setLoadError('Students could not be loaded. Check your connection and try again.')
      )
      .finally(() => setLoading(false));
  }, [search, schoolSide, deptFilter, includeArchived]);

  useEffect(() => {
    setPage(1);
  }, [search, deptFilter]);
  useEffect(loadStudents, [loadStudents]);

  // Live: additions/edits/deletes and payments refresh the list in place.
  useRealtime({
    'student:changed': loadStudents,
    'payment:new': loadStudents,
  });

  useEffect(() => {
    api
      .get('/classes')
      .then((res) => setClasses(res.data))
      .catch(() => {});
    if (schoolSide)
      api
        .get('/departments')
        .then((res) => setDepts(res.data))
        .catch(() => {});
    if (isDeptAdmin || schoolSide)
      api
        .get('/souvenirs')
        .then((res) => {
          setDeptSouvenirs(res.data.filter((s) => s.category === 'department'));
          setSchoolSouvenirs(res.data.filter((s) => s.category === 'school'));
        })
        .catch(() => {});
  }, [schoolSide, isDeptAdmin]);

  const myClasses = classes.map((c) => ({
    value: c.id,
    label: c.name + (c.level !== c.name ? ` (${c.level})` : ''),
    level: (c.level || '').replace(/[^0-9]/g, ''),
  }));

  // Classes matching the currently selected level (so a student's class always
  // agrees with their level). Falls back to all classes when no level is set.
  const levelClasses = form.level ? myClasses.filter((c) => c.level === form.level) : myClasses;

  // Souvenirs this role hands out: the department's own list for dept admins, or
  // the school catalogue for the school side. Either side can record a missed
  // souvenir later (each item is only ever given once per student).
  const souvenirOptions = isDeptAdmin ? deptSouvenirs : schoolSouvenirs;

  // ─── Add / Edit single (Dept Admin) ───
  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setGivenSouvenirs([]);
    setSouvenirSel([]);
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name || '',
      student_no: s.student_no || '',
      level: s.level || '',
      class_id: s.class_id ? String(s.class_id) : '',
      phone: s.phone || '',
      email: s.email || '',
      programme: s.programme || '',
      gender: s.gender || '',
      hometown: s.hometown || '',
      admission_year: s.admission_year || '',
    });
    setGivenSouvenirs([]);
    setSouvenirSel([]);
    api
      .get(`/students/${s.id}/souvenirs`)
      .then((res) => {
        const ids = res.data.map((r) => r.souvenir_id);
        setGivenSouvenirs(ids);
        setSouvenirSel(ids);
      })
      .catch(() => {});
    setShowForm(true);
  };

  const saveStudent = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        student_no: form.student_no.trim(),
        level: form.level || undefined,
        class_id: form.class_id ? Number(form.class_id) : null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        programme: form.programme.trim() || null,
        gender: form.gender || null,
        hometown: form.hometown.trim() || null,
        admission_year: form.admission_year || null,
      };
      if (editingId) {
        await api.put(`/students/${editingId}`, payload);
        const newlyGiven = souvenirSel.filter((id) => !givenSouvenirs.includes(id));
        if (newlyGiven.length) {
          await api.post(`/students/${editingId}/souvenirs`, { souvenir_ids: newlyGiven });
        }
        addToast('Student updated.');
      } else {
        await api.post('/students', payload);
        addToast('Continuing student added.');
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setGivenSouvenirs([]);
      setSouvenirSel([]);
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save student', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteStudent = (s) => {
    setConfirm({
      open: true,
      title: 'Delete Student',
      message: `Delete ${s.name} (${s.student_no})? Their receipts are removed with them.`,
      onConfirm: async () => {
        try {
          await api.delete(`/students/${s.id}`);
          addToast('Student deleted.');
          loadStudents();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed to delete', 'error');
        }
        setConfirm({ ...confirm, open: false });
      },
    });
  };

  // ─── Archive / un-archive (School Admin) ───
  const archiveStudent = (s) => {
    const archived = !s.is_archived;
    setConfirm({
      open: true,
      title: archived ? 'Archive Student' : 'Un-archive Student',
      danger: archived,
      message: archived
        ? `Archive ${s.name} (${s.student_no})? They'll be hidden from active lists and rep collection.`
        : `Restore ${s.name} (${s.student_no}) to the active roster?`,
      onConfirm: async () => {
        try {
          await api.post(`/students/${s.id}/archive`, { archived });
          addToast(archived ? 'Student archived.' : 'Student restored.');
          loadStudents();
        } catch (err) {
          addToast(err.response?.data?.error || 'Failed', 'error');
        }
        setConfirm({ ...confirm, open: false });
      },
    });
  };

  // ─── Transfer to another department (School Admin) ───
  const openTransfer = (s) => {
    setTransferStudent(s);
    setTransferDeptId('');
    setShowTransfer(true);
  };

  const confirmTransfer = async () => {
    if (!transferDeptId) {
      addToast('Select a target department', 'error');
      return;
    }
    setTransferring(true);
    try {
      await api.post(`/students/${transferStudent.id}/transfer`, {
        department_id: Number(transferDeptId),
      });
      addToast(`${transferStudent.name} transferred.`);
      setShowTransfer(false);
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Transfer failed', 'error');
    } finally {
      setTransferring(false);
    }
  };

  // ─── Start a new academic year (School Admin) ───
  // Opens a modal listing admitted, non-graduated students so the admin can
  // mark repeaters to hold at their current level before confirming.
  const eligibleForRollover = students.filter((s) => !s.is_graduated);

  const rolloverList = rolloverSearch.trim()
    ? eligibleForRollover.filter((s) => {
        const q = rolloverSearch.trim().toLowerCase();
        return (
          (s.name || '').toLowerCase().includes(q) ||
          (s.student_no || '').toLowerCase().includes(q)
        );
      })
    : eligibleForRollover;

  const toggleHold = (id) => {
    setHoldIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openRollover = () => {
    setHoldIds([]);
    setRolloverSearch('');
    setRolling(false);
    setShowRollover(true);
  };

  const confirmRollover = async () => {
    setRolling(true);
    try {
      const res = await api.post('/students/rollover', { confirm: true, hold_levels: holdIds });
      addToast(
        `${res.data.message} — ${res.data.promoted} promoted, ${res.data.held} held, ${res.data.graduated} graduated.`
      );
      setShowRollover(false);
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Rollover failed', 'error');
    } finally {
      setRolling(false);
    }
  };

  // ─── CSV Import (Dept Admin) ───
  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'continuing-students-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const buildPreview = () => {
    if (!csvText.trim()) {
      setCsvError('Choose a CSV file first.');
      return;
    }
    const rows = parseCsv(csvText);
    if (!rows) {
      setCsvError(`The CSV header must include: ${CSV_HEADERS.join(', ')}`);
      return;
    }
    if (rows.length === 0) {
      setCsvError('No rows found in the CSV.');
      return;
    }

    // Known class names in this department (case-insensitive)
    const deptClasses = classes.filter((c) => c.department_id === user?.department_id);
    const known = new Set(deptClasses.map((c) => c.name.toLowerCase()));
    const existing = new Set(students.map((s) => s.student_no));

    const seen = new Set();
    const annotated = rows.map((r) => {
      let error = null;
      const no = (r.student_no || '').trim();
      const name = (r.name || '').trim();
      const lvl = (r.level || '').trim();
      const cls = (r.class_name || '').trim();
      const knownLevels = ['100', '200', '300', '400'];
      const normLevel = lvl ? lvl.replace(/[^0-9]/g, '') : '';
      if (!name) error = 'Name missing';
      else if (!no) error = 'Student number missing';
      else if (existing.has(no) || seen.has(no)) error = `Duplicate: ${no}`;
      else if (lvl && !knownLevels.includes(normLevel)) error = `Unknown level "${lvl}"`;
      else if (cls && !known.has(cls.toLowerCase())) error = `Unknown class "${cls}"`;
      else if (!cls && !defaultClassId) error = 'No class and no default chosen';
      if (!error) seen.add(no);
      return {
        name,
        student_no: no,
        level: normLevel || '',
        class_name: cls,
        status: error ? 'error' : 'ok',
        error,
      };
    });

    const okCount = annotated.filter((r) => r.status === 'ok').length;
    setPreview({ rows: annotated, okCount });
    setCsvError('');
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const rows = preview.rows
        .filter((r) => r.status === 'ok')
        .map((r) => ({
          name: r.name,
          student_no: r.student_no,
          level: r.level || undefined,
          class_name: r.class_name || undefined,
          admission_year: r.admission_year || undefined,
          phone: r.phone || undefined,
          email: r.email || undefined,
          programme: r.programme || undefined,
          gender: r.gender || undefined,
          hometown: r.hometown || undefined,
        }));
      const res = await api.post('/students/import', {
        rows,
        default_class_id: defaultClassId ? Number(defaultClassId) : undefined,
      });
      addToast(`Imported ${res.data.inserted} student(s); ${res.data.skipped} skipped.`);
      setShowImport(false);
      setPreview(null);
      setCsvText('');
      setCsvError('');
      setDefaultClassId('');
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
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
        danger
      />

      <StudentDetailsModal student={details} onClose={() => setDetails(null)} />

      {/* ─── Rollover modal (School Admin) ─── */}
      {showRollover && isSchoolAdmin && (
        <Modal
          open
          size="wide"
          icon={<ArrowClockwise size={20} />}
          title="Start New Academic Year"
          subtitle="Advance everyone one level (freshers to 200, continuing +1, Level 400 graduates), then set the active year to the next one. Tick any repeaters to hold at their current level."
          onClose={() => {
            if (!rolling) setShowRollover(false);
          }}
        >
          <div className="alert alert-info">
            Pending (unreported) freshers are left as freshers automatically. Only tick students who
            must <strong>stay</strong> at their current level.
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Search by name or student number…"
              value={rolloverSearch}
              onChange={(e) => setRolloverSearch(e.target.value)}
            />
          </div>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Name</th>
                  <th>Student No</th>
                  <th>Level</th>
                  <th>Level After</th>
                </tr>
              </thead>
              <tbody>
                {rolloverList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {eligibleForRollover.length === 0
                        ? 'No students to roll over.'
                        : 'No students match your search.'}
                    </td>
                  </tr>
                )}
                {rolloverList.map((s) => {
                  const next = s.is_fresher
                    ? s.admitted_at
                      ? '200'
                      : '—'
                    : { 100: '200', 200: '300', 300: '400', 400: 'Graduated' }[s.level] || '—';
                  const held = holdIds.includes(s.id);
                  return (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={held}
                          onChange={() => toggleHold(s.id)}
                          disabled={rolling}
                          title={
                            held
                              ? `Hold ${s.name} at Level ${s.level}`
                              : `Mark ${s.name} as a repeater`
                          }
                        />
                      </td>
                      <td className="fw-600">{s.name}</td>
                      <td>{s.student_no || '-'}</td>
                      <td>{s.level_label || (s.level ? `Level ${s.level}` : '—')}</td>
                      <td>
                        {held
                          ? `Stays: ${s.level_label || `Level ${s.level}`}`
                          : next === 'Graduated'
                            ? 'Graduates'
                            : next === '—'
                              ? '—'
                              : `Level ${next}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="alert alert-error" style={{ marginTop: 14 }}>
            This is a bulk, irreversible change. Continue?
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              disabled={rolling}
              onClick={() => setShowRollover(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={rolling || eligibleForRollover.length === 0}
              onClick={confirmRollover}
            >
              {rolling ? (
                'Rolling over...'
              ) : (
                <>
                  <ArrowClockwise size={18} /> Confirm New Academic Year
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* ─── Transfer modal (School Admin) ─── */}
      {showTransfer && transferStudent && isSchoolAdmin && (
        <Modal
          open
          icon={<Swap size={20} />}
          title="Transfer Student"
          subtitle={`Move ${transferStudent.name} (${transferStudent.student_no || ''}) to another department. Their class is set to the new department's class at their current level when possible.`}
          onClose={() => {
            if (!transferring) setShowTransfer(false);
          }}
        >
          {transferStudent.is_archived && (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              This student is currently archived.
            </div>
          )}
          <label className="label">Target Department</label>
          <Select
            value={transferDeptId}
            onChange={setTransferDeptId}
            placeholder="Select a department…"
            options={depts
              .filter((d) => d.id !== transferStudent.department_id)
              .map((d) => ({ value: d.id, label: d.name }))}
          />
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              disabled={transferring}
              onClick={() => setShowTransfer(false)}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={transferring} onClick={confirmTransfer}>
              {transferring ? (
                'Transferring...'
              ) : (
                <>
                  <Swap size={18} /> Transfer
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      <div className="page-head">
        <div>
          <h1>Continuing Students</h1>
          <p className="subtitle">
            {schoolSide
              ? 'Continuing students across all departments.'
              : isDeptAdmin
                ? `Add continuing students to ${user?.department_name}.`
                : `Continuing students in ${user?.department_name}.`}
          </p>
        </div>
        {isDeptAdmin && (
          <div className="flex gap">
            <button className="btn btn-outline" onClick={() => setShowImport(true)}>
              <UploadSimple size={18} /> Bulk Import CSV
            </button>
            <button className="btn btn-green" onClick={openAdd}>
              <Plus size={18} /> Add Student
            </button>
          </div>
        )}
        {isSchoolAdmin && (
          <button
            className="btn btn-outline"
            onClick={openRollover}
            title="Advance all students to the next level and set a new active year"
          >
            <ArrowClockwise size={18} /> Start New Academic Year
          </button>
        )}
      </div>

      {/* ─── Add / Edit modal (Dept Admin; School side edits existing students) ─── */}
      {showForm && (isDeptAdmin || schoolSide) && (
        <Modal
          open
          size="wide"
          icon={<Student size={20} />}
          title={editingId ? 'Edit Continuing Student' : 'Add Continuing Student'}
          subtitle={
            editingId
              ? "Update the student's details — including contact and programme information."
              : 'Add a student your department collects dues from.'
          }
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={saveStudent}>
            <div className="modal-section">
              <div className="modal-section-title">
                <Student size={16} /> Student Details
              </div>
              <div className="grid grid-2">
                <div className="field">
                  <label>Full Name *</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Student Number *</label>
                  <input
                    className="input"
                    value={form.student_no}
                    onChange={(e) => setForm({ ...form, student_no: e.target.value })}
                    required
                    placeholder="e.g. UEB2001"
                  />
                </div>
                <div className="field">
                  <label>Level *</label>
                  <Select
                    value={form.level}
                    onChange={(v) => setForm((prev) => ({ ...prev, level: v, class_id: '' }))}
                    options={LEVEL_OPTIONS}
                    placeholder="Select level (e.g. Level 200)"
                    required
                  />
                </div>
                <div className="field">
                  <label>Class (optional)</label>
                  <Select
                    value={form.class_id}
                    onChange={(v) => setForm({ ...form, class_id: v })}
                    options={[{ value: '', label: '(no class — level only)' }, ...levelClasses]}
                    placeholder="Select class..."
                  />
                </div>
                <div className="field">
                  <label>Admission Year</label>
                  <input
                    className="input"
                    type="number"
                    min="2000"
                    max="2100"
                    value={form.admission_year}
                    onChange={(e) => setForm({ ...form, admission_year: e.target.value })}
                    placeholder="e.g. 2024"
                  />
                </div>
                <div className="field">
                  <label>Phone Number</label>
                  <input
                    className="input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 0244 000 000"
                  />
                </div>
                <div className="field">
                  <label>Email Address</label>
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="field">
                  <label>Programme</label>
                  <input
                    className="input"
                    value={form.programme}
                    onChange={(e) => setForm({ ...form, programme: e.target.value })}
                    placeholder="e.g. BSc. Computer Science"
                  />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <Select
                    value={form.gender}
                    onChange={(v) => setForm({ ...form, gender: v })}
                    options={GENDER_OPTIONS}
                    placeholder="Select gender..."
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>Hometown / Region</label>
                  <input
                    className="input"
                    value={form.hometown}
                    onChange={(e) => setForm({ ...form, hometown: e.target.value })}
                    placeholder="e.g. Sunyani, Bono Region"
                  />
                </div>
              </div>
            </div>

            {editingId && souvenirOptions.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-title">
                  <Gift size={16} /> Souvenirs
                </div>
                <p className="muted text-sm" style={{ marginBottom: 10 }}>
                  Tick any souvenir this student collects now (including a missed one). Items marked
                  “recorded” were handed out earlier and can never be given twice.
                </p>
                <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                  {souvenirOptions.map((s) => {
                    const given = givenSouvenirs.includes(s.id);
                    const checked = souvenirSel.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className="flex align-center gap-sm"
                        style={{ opacity: given ? 0.65 : 1, cursor: given ? 'default' : 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={given}
                          onChange={(e) =>
                            setSouvenirSel((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                            )
                          }
                        />
                        <span>
                          {s.name}
                          {given && <span className="muted text-xs"> · recorded</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-green"
                disabled={saving || !form.name.trim() || !form.student_no.trim() || !form.level}
              >
                {editingId ? (
                  <>
                    <CheckCircle size={18} /> Save Changes
                  </>
                ) : (
                  <>
                    <Plus size={18} /> Add Student
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── CSV Import modal (Dept Admin) ─── */}
      {showImport && isDeptAdmin && (
        <Modal
          open
          size="lg"
          icon={<FileCsv size={22} />}
          title="Bulk Import Continuing Students"
          subtitle="Upload a completed CSV template — validate and preview before importing."
          onClose={() => {
            if (!importing) {
              setShowImport(false);
              setPreview(null);
              setCsvError('');
            }
          }}
        >
          {!preview ? (
            <>
              <div className="alert alert-info">
                Required columns: <strong>name, student_no, class</strong>. Optional columns:{' '}
                <strong>level, admission_year, phone, email, programme, gender, hometown</strong>.
                Class names must match one of your department's classes exactly. If a row's level is
                blank, it is taken from the class.
              </div>
              <div className="flex align-center gap-md" style={{ marginBottom: 16 }}>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileCsv size={16} /> Choose .csv file
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={downloadTemplate}>
                  <FileCsv size={16} /> Download CSV template
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
              <div className="field">
                <label>Default class for rows without a class name</label>
                <Select
                  value={defaultClassId}
                  onChange={setDefaultClassId}
                  options={[
                    { value: '', label: '(none — class column is required on every row)' },
                    ...myClasses,
                  ]}
                  placeholder="Choose default class..."
                />
              </div>
              {csvError && <div className="alert alert-error">{csvError}</div>}
              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    setShowImport(false);
                    setPreview(null);
                    setCsvError('');
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={buildPreview}>
                  <CheckCircle size={18} /> Preview Rows
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex between align-center mb">
                <div>
                  <h3 style={{ margin: 0 }}>Preview</h3>
                  <p className="muted text-sm">
                    <span className="badge badge-green">{preview.okCount} ready</span>{' '}
                    <span className="badge badge-red">
                      {preview.rows.length - preview.okCount} problems
                    </span>
                  </p>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  <X size={14} /> Back to edit
                </button>
              </div>
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Student No</th>
                      <th>Level</th>
                      <th>Class</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.name || '—'}</td>
                        <td>{r.student_no || '—'}</td>
                        <td>{r.level ? `Level ${r.level}` : '(from class)'}</td>
                        <td>{r.class_name || '(default class)'}</td>
                        <td>
                          {r.status === 'ok' ? (
                            <span className="badge badge-green">Ready</span>
                          ) : (
                            <span className="badge badge-red" title={r.error}>
                              {r.error}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <span className="muted text-sm" style={{ marginRight: 'auto' }}>
                  Rows with problems are skipped, not imported.
                </span>
                <button
                  className="btn btn-outline"
                  disabled={importing}
                  onClick={() => setPreview(null)}
                >
                  Back
                </button>
                <button
                  className="btn btn-green"
                  disabled={importing || preview.okCount === 0}
                  onClick={confirmImport}
                >
                  {importing ? (
                    'Importing...'
                  ) : (
                    <>
                      <UploadSimple size={18} /> Import {preview.okCount} Student(s)
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ─── Table ─── */}
      <div className="card">
        {loadError && (
          <div className="alert alert-error">
            <Warning size={16} /> {loadError}{' '}
            <button className="btn btn-outline btn-xs" onClick={loadStudents}>
              Retry
            </button>
          </div>
        )}
        <div className="flex gap align-center" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, maxWidth: 400 }}>
            <input
              className="input search-input"
              placeholder="Search by name or student number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {schoolSide && depts.length > 0 && (
            <div style={{ width: 240 }}>
              <Select
                value={deptFilter}
                onChange={setDeptFilter}
                options={[
                  { value: '', label: 'All Departments' },
                  ...depts.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </div>
          )}
          {schoolSide && (
            <button
              className={`btn btn-sm ${includeArchived ? 'btn-gold' : 'btn-outline'}`}
              onClick={() => setIncludeArchived((v) => !v)}
              title="Toggle archived students"
            >
              <Archive size={16} /> {includeArchived ? 'Showing archived' : 'Include archived'}
            </button>
          )}
        </div>
        <div className="table-wrap">
          {loading && (
            <div className="table-state">
              <span className="spin-dot" /> Loading students...
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Student No</th>
                <th>Department</th>
                <th>Level</th>
                <th>Class</th>
                <th>Current Year</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && students.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {schoolSide
                      ? 'No continuing students found.'
                      : isDeptAdmin
                        ? 'No continuing students in your department yet. Add one or import a CSV.'
                        : 'No continuing students in your department yet.'}
                  </td>
                </tr>
              )}
              {students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => (
                <tr
                  key={s.id}
                  className="row-click"
                  onClick={() => setDetails(s)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetails(s);
                    }
                  }}
                >
                  <td className="fw-600">{s.name}</td>
                  <td>{s.student_no || '-'}</td>
                  <td>{s.department_name || '-'}</td>
                  <td>
                    {!s.is_graduated && (
                      <span className="badge badge-blue">
                        {s.level_label || (s.level ? `Level ${s.level}` : '—')}
                      </span>
                    )}
                    {s.is_graduated && (
                      <span className="badge badge-red" style={{ marginLeft: 6 }}>
                        Graduated
                      </span>
                    )}
                    {s.is_archived && (
                      <span className="badge badge-gold" style={{ marginLeft: 6 }}>
                        Archived
                      </span>
                    )}
                  </td>
                  <td>{s.class_name || '-'}</td>
                  <td>
                    <span
                      className={`badge ${s.school_dues_paid && s.dept_dues_paid ? 'badge-green' : 'badge-gold'}`}
                    >
                      {s.school_dues_paid && s.dept_dues_paid ? 'Paid' : 'Outstanding'}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-sm">
                      {isDeptAdmin && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => openEdit(s)}
                          title="Edit student"
                        >
                          <PencilSimple size={14} />
                        </button>
                      )}
                      {isDeptAdmin && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteStudent(s)}
                          title="Delete"
                        >
                          <Trash size={14} />
                        </button>
                      )}
                      {schoolSide && (
                        <>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEdit(s)}
                            title="Edit student"
                          >
                            <PencilSimple size={14} />
                          </button>
                          {isSchoolAdmin && (
                            <>
                              <button
                                className="btn btn-sm btn-outline"
                                onClick={() => openTransfer(s)}
                                title="Transfer to another department"
                              >
                                <Swap size={14} />
                              </button>
                              <button
                                className={`btn btn-sm ${s.is_archived ? 'btn-outline' : 'btn-gold'}`}
                                onClick={() => archiveStudent(s)}
                                title={s.is_archived ? 'Un-archive' : 'Archive'}
                              >
                                <Archive size={14} />
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => deleteStudent(s)}
                                title="Delete"
                              >
                                <Trash size={14} />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
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
