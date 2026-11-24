import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import {
  IconUserCheck as UserCheck,
  IconUserPlus as UserPlus,
  IconDownload as DownloadSimple,
  IconPencil as Pencil,
  IconTrash as Trash,
  IconAlertTriangle as Warning,
  IconSend as PaperPlaneTilt,
  IconArrowsLeftRight as ArrowsLeftRight,
} from '@tabler/icons-react';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import Select from '../components/ui/Select';
import Confirm from '../components/ui/Confirm';
import ResendConfirmModal from '../components/ui/ResendConfirmModal';
import StudentDetailsModal from '../components/ui/StudentDetailsModal';

const PAGE_SIZE = 10;
const LEVEL_OPTIONS = ['100', '200', '300', '400'].map((l) => ({ value: l, label: `Level ${l}` }));

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <UserCheck size={18} /> : <Warning size={18} />}
      {message}
    </div>
  );
}

// CSV rows may quote a cell containing commas — split on commas that are not
// inside double quotes, then strip the quoting.
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/**
 * Students page — the continuing-student roster (freshers live on the
 * Freshers page) plus the queue of manually entered records waiting for
 * school-admin verification, which class reps create when they collect from
 * a student who is not on the list yet.
 */
export default function Students() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff', 'super_admin'].includes(user?.role);
  const isSchoolAdmin = user?.role === 'school_admin' || user?.role === 'super_admin';
  const canImport = isSchoolAdmin || user?.role === 'dept_admin';
  // Resend receipt email(s): every admin and staff role may use it — the
  // server scopes it (school-side: any student; dept-side: own department).
  const canResend = [
    'school_admin',
    'super_admin',
    'school_staff',
    'dept_admin',
    'dept_staff',
  ].includes(user?.role);

  const [tab, setTab] = useState('roster');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [pendingList, setPendingList] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [verifyingId, setVerifyingId] = useState(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [details, setDetails] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Bulk import (continuing students only).
  const [depts, setDepts] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [importDept, setImportDept] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  // Manual add (a single continuing student).
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [resendTarget, setResendTarget] = useState(null);
  const [forceDelete, setForceDelete] = useState(null);
  const [forceReason, setForceReason] = useState('');
  const [forceSaving, setForceSaving] = useState(false);
  const [addDept, setAddDept] = useState('');
  const [addForm, setAddForm] = useState({ name: '', student_no: '', email: '', level: '100' });

  // Transfer (school admin / super admin only): move a student to another
  // department. Reason is required by the server and lands in the audit log.
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferDept, setTransferDept] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Edit / delete a student ───
  const openEdit = (s) => {
    setEditForm({
      name: s.name || '',
      student_no: s.student_no || '',
      email: s.email || '',
      level: s.level == null ? '' : String(s.level),
      department_id: s.department_id,
    });
    setEditing(s);
  };

  const saveEdit = (e) => {
    e.preventDefault();
    if (savingEdit || !editing) return;
    const name = editForm.name.trim();
    const studentNo = editForm.student_no.trim();
    if (!name || !studentNo) {
      addToast('Name and student number are required.', 'error');
      return;
    }
    const payload = {
      name,
      student_no: studentNo,
      email: editForm.email.trim(),
    };
    if (editForm.level) payload.level = Number(editForm.level);
    // Department changes never ride on profile edits — continuing students
    // move via the audited Transfer action (pending freshers use the
    // Freshers page to reassign before admission).
    setSavingEdit(true);
    api
      .put(`/students/${editing.id}`, payload)
      .then(() => {
        addToast(`${name} updated.`);
        setEditing(null);
        reloadStudents();
      })
      .catch((err) => {
        addToast(err?.response?.data?.error || 'Could not save the changes.', 'error');
      })
      .finally(() => setSavingEdit(false));
  };

  // ─── Transfer a student to another department ───
  const openTransfer = (s) => {
    setTransferTarget(s);
    setTransferDept('');
    setTransferReason('');
  };

  const runTransfer = (e) => {
    e.preventDefault();
    if (transferring || !transferTarget) return;
    if (!transferDept) {
      addToast('Choose the department to transfer to.', 'error');
      return;
    }
    if (!transferReason.trim()) {
      addToast('A reason is required to transfer a student.', 'error');
      return;
    }
    setTransferring(true);
    api
      .post(`/students/${transferTarget.id}/transfer`, {
        to_department_id: Number(transferDept),
        reason: transferReason.trim(),
      })
      .then(() => {
        addToast(`${transferTarget.name} transferred.`);
        setTransferTarget(null);
        reloadStudents();
      })
      .catch((err) => {
        addToast(err?.response?.data?.error || 'Could not transfer the student.', 'error');
      })
      .finally(() => setTransferring(false));
  };

  // Confirm handles failures itself (dialog stays open showing the server's
  // reason, e.g. "students with payment history cannot be deleted"); a
  // resolved promise closes it.
  const runDelete = () =>
    api.delete(`/students/${pendingDelete.id}`).then(() => {
      addToast(`${pendingDelete.name} removed.`);
      reloadStudents();
    });

  // ─── Super admin: force-delete (removes the student AND their receipts) ───
  const isSuper = user?.role === 'super_admin';

  const openForceDelete = (s) => {
    setForceDelete(s);
    setForceReason('');
  };

  const runForceDelete = (e) => {
    e.preventDefault();
    if (forceSaving || !forceDelete) return;
    const reason = forceReason.trim();
    if (!reason) {
      addToast('A reason is required to force-delete a student.', 'error');
      return;
    }
    setForceSaving(true);
    api
      .delete(`/students/${forceDelete.id}/force`, { data: { reason } })
      .then((res) => {
        const removed = res.data?.receipts_removed ?? 0;
        addToast(
          `${forceDelete.name} permanently deleted${removed ? ` along with ${removed} receipt(s)` : ''}.`
        );
        setForceDelete(null);
        setForceReason('');
        reloadStudents();
      })
      .catch((err) => {
        addToast(err?.response?.data?.error || 'Force-delete failed.', 'error');
      })
      .finally(() => setForceSaving(false));
  };

  // ─── Roster: students — continuing students + admitted freshers (L100) ───
  const loadStudents = useCallback(() => {
    const params = { type: 'continuing' };
    if (search) params.search = search;
    api
      .get('/students', { params })
      .then((res) => {
        setStudents(asArray(res.data));
        setLoadError('');
      })
      .catch(() => setLoadError('Students could not be loaded.'));
  }, [search]);

  // ─── Unverified queue (school side): manual rep entries awaiting merge ───
  const loadPending = useCallback(() => {
    if (!schoolSide) return;
    const params = { verification: 'pending' };
    if (search) params.search = search;
    api
      .get('/students', { params })
      .then((res) => {
        const rows = asArray(res.data);
        setPendingList(rows);
        setPendingCount(rows.length);
      })
      .catch(() => {});
  }, [search, schoolSide]);

  // Reloads both lists: a mutation on the roster tab must not leave a stale
  // pending queue behind (and vice versa). Declared after the two loaders it
  // calls, so both are initialised before this closure is built.
  const reloadStudents = useCallback(() => {
    loadStudents();
    loadPending();
  }, [loadStudents, loadPending]);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    loadPending();
  }, [loadPending, schoolSide, tab]);

  // A new search or tab change starts the roster over on page one.
  useEffect(() => {
    setPage(1);
  }, [search, tab]);

  useEffect(() => {
    if (schoolSide) {
      api
        .get('/departments')
        .then((res) => setDepts(res.data))
        .catch(() => {});
    }
  }, [schoolSide]);

  // Live updates (the server scopes each event to the right admin): a rep's
  // manual entry lands in the queue, a verification moves it into the roster.
  useRealtime({
    'student:changed': () => {
      loadStudents();
      loadPending();
    },
    'payment:new': () => {
      loadPending();
    },
  });

  const verifyRecord = async (id) => {
    setVerifyingId(id);
    try {
      await api.post(`/students/${id}/verify-record`);
      addToast('Student verified and merged into the student list.');
      loadPending();
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Verification failed', 'error');
    } finally {
      setVerifyingId(null);
    }
  };

  // ─── Bulk import ───
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));

  const runImport = async (e) => {
    e.preventDefault();
    setImportResult(null);
    const fileInput = document.getElementById('students-import-file');
    const file = fileInput?.files?.[0];
    const deptId = schoolSide ? importDept : user?.department_id;
    if (!file) {
      addToast('Choose a CSV file first.', 'error');
      return;
    }
    if (!deptId) {
      addToast('Choose the department this list belongs to.', 'error');
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((l) => l.trim());
      if (lines.length < 2) {
        addToast('The CSV needs a header row plus at least one student.', 'error');
        return;
      }
      const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const findCol = (...names) => {
        for (const n of names) {
          const i = headers.indexOf(n);
          if (i !== -1) return i;
        }
        return -1;
      };
      const nameIdx = findCol('name', 'full name', 'student name');
      const noIdx = findCol(
        'student_no',
        'student number',
        'index number',
        'number',
        'reference',
        'reference number'
      );
      const emailIdx = findCol('email', 'email address');
      const levelIdx = findCol('level');
      if (nameIdx === -1 || noIdx === -1) {
        addToast('The CSV needs Name and Student Number columns.', 'error');
        return;
      }
      const rows = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cols = splitCsvLine(lines[i]);
        rows.push({
          name: (cols[nameIdx] ?? '').trim(),
          student_no: (cols[noIdx] ?? '').trim(),
          email: emailIdx !== -1 ? (cols[emailIdx] ?? '').trim() : '',
          level: levelIdx !== -1 ? (cols[levelIdx] ?? '').trim() : '',
        });
      }
      const res = await api.post('/students/bulk', { department_id: Number(deptId), rows });
      setImportResult(res.data);
      loadStudents();
      loadPending();
    } catch (err) {
      addToast(err.response?.data?.error || 'Import failed. Please try again.', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ─── Manual add (a single continuing student) ───
  const openAdd = () => {
    setAddForm({ name: '', student_no: '', email: '', level: '100' });
    setAddDept(schoolSide ? '' : String(user?.department_id || ''));
    setShowAdd(true);
  };

  const runAdd = async (e) => {
    e.preventDefault();
    const deptId = schoolSide ? addDept : user?.department_id;
    if (!addForm.name.trim() || !addForm.student_no.trim() || !addForm.email.trim()) {
      addToast('Name, student number and email are required.', 'error');
      return;
    }
    if (!deptId) {
      addToast('Choose the department this student belongs to.', 'error');
      return;
    }
    setAdding(true);
    try {
      const res = await api.post('/students', {
        department_id: Number(deptId),
        name: addForm.name.trim(),
        student_no: addForm.student_no.trim(),
        email: addForm.email.trim(),
        level: addForm.level,
      });
      addToast(`${res.data.student.name} added to the student list.`);
      setShowAdd(false);
      loadStudents();
    } catch (err) {
      addToast(err.response?.data?.error || 'Could not add the student.', 'error');
    } finally {
      setAdding(false);
    }
  };

  const paged = students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="subtitle">
            {tab === 'unverified'
              ? 'Student records entered manually by class reps — verify each one to merge it into the list.'
              : 'Continuing students and admitted freshers (Level 100 students now) on the dues list. Pending applicants live on the Freshers page.'}
          </p>
        </div>
        {canImport && tab === 'roster' && (
          <div className="flex gap-sm">
            <button className="btn btn-primary" onClick={openAdd}>
              <UserPlus size={18} /> Add Student
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setImportResult(null);
                setImportDept(schoolSide ? '' : String(user?.department_id || ''));
                setShowImport(true);
              }}
            >
              <DownloadSimple size={18} /> Import Students
            </button>
          </div>
        )}
      </div>

      {schoolSide && (
        <div className="tabs mb-md">
          {[
            ['roster', 'Continuing Students'],
            ['unverified', `Unverified${pendingCount ? ` (${pendingCount})` : ''}`],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`tab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loadError && (
        <div className="alert alert-error">
          <Warning size={16} /> {loadError}{' '}
          <button className="btn btn-outline btn-xs" onClick={loadStudents}>
            Retry
          </button>
        </div>
      )}

      {tab === 'roster' ? (
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
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Student No</th>
                  <th>Email</th>
                  <th>Level</th>
                  <th>Department</th>
                  {schoolSide && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={schoolSide ? 6 : 5} className="muted">
                      {search
                        ? 'No students match your search.'
                        : 'No students on the list yet. Add students one by one, import a list, or records appear once a class rep collects from a student not on the list.'}
                    </td>
                  </tr>
                )}
                {paged.map((f) => (
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
                    <td>{f.email || '-'}</td>
                    <td>{f.level ? `Level ${f.level}` : '-'}</td>
                    <td>{f.department_name || '-'}</td>
                    {schoolSide && (
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(f);
                            }}
                            title="Edit student"
                            aria-label={`Edit ${f.name}`}
                          >
                            <Pencil size={14} />
                          </button>
                          {isSchoolAdmin && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTransfer(f);
                              }}
                              title="Transfer to another department"
                              aria-label={`Transfer ${f.name} to another department`}
                            >
                              <ArrowsLeftRight size={14} />
                            </button>
                          )}
                          {canResend && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setResendTarget(f);
                              }}
                              title="Review payment details and resend receipt email(s)"
                              aria-label={`Resend receipt email to ${f.name}`}
                            >
                              <PaperPlaneTilt size={14} />
                            </button>
                          )}
                          {isSchoolAdmin && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDelete(f);
                              }}
                              title="Delete student"
                              aria-label={`Delete ${f.name}`}
                            >
                              <Trash size={14} />
                            </button>
                          )}
                          {isSuper && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                openForceDelete(f);
                              }}
                              title="Force delete — permanently removes the student and their receipts"
                              aria-label={`Force delete ${f.name}`}
                            >
                              <Warning size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
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
      ) : (
        <div className="card">
          <p className="muted text-sm mb">
            Student records entered manually by class reps. Verify each one to merge it into the
            student list — payments linked to them are already recorded.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Student No</th>
                  <th>Email</th>
                  <th>Level</th>
                  <th>Department</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No unverified records. Manual entries from class reps will appear here.
                    </td>
                  </tr>
                )}
                {pendingList.map((f) => (
                  <tr key={f.id}>
                    <td className="fw-600">{f.name}</td>
                    <td>{f.student_no || '-'}</td>
                    <td>{f.email || '-'}</td>
                    <td>{f.level ? `Level ${f.level}` : '-'}</td>
                    <td>{f.department_name || '-'}</td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                        }}
                      >
                        {schoolSide && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEdit(f)}
                            title="Edit record"
                            aria-label={`Edit ${f.name}`}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
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
                            onClick={() => setPendingDelete(f)}
                            title="Delete record"
                            aria-label={`Delete ${f.name}`}
                          >
                            <Trash size={14} />
                          </button>
                        )}
                        {isSuper && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => openForceDelete(f)}
                            title="Force delete — permanently removes the student and their receipts"
                            aria-label={`Force delete ${f.name}`}
                          >
                            <Warning size={14} />
                          </button>
                        )}
                        {isSchoolAdmin ? (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => verifyRecord(f.id)}
                            disabled={verifyingId === f.id}
                          >
                            <UserCheck size={14} />{' '}
                            {verifyingId === f.id ? 'Verifying...' : 'Verify'}
                          </button>
                        ) : (
                          <span className="muted text-sm">Awaiting school admin</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Bulk import students modal ─── */}
      {showImport && (
        <Modal
          open
          icon={<DownloadSimple size={20} />}
          title="Import Student List"
          subtitle="Upload a CSV with Name, Student Number and Email columns. Imported rows join the student list immediately."
          onClose={() => setShowImport(false)}
        >
          <form onSubmit={runImport}>
            <div className="modal-section">
              {schoolSide ? (
                <div className="field">
                  <label>Department *</label>
                  <Select
                    value={importDept}
                    onChange={setImportDept}
                    options={deptOptions}
                    placeholder="Select department..."
                    required
                  />
                </div>
              ) : (
                <p className="muted text-sm mb">
                  Importing into <strong>{user?.department_name}</strong>.
                </p>
              )}
              <div className="field">
                <label>CSV file *</label>
                <input
                  id="students-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="input"
                  required
                />
                <p className="muted text-xs" style={{ marginTop: 6 }}>
                  Header row plus Name, Student Number and Email columns (Level optional).
                </p>
              </div>
            </div>
            {importResult && (
              <div className="modal-section">
                <div
                  className={`alert ${importResult.errors?.length ? 'alert-error' : 'alert-success'}`}
                >
                  {importResult.added} added
                  {importResult.skipped?.length ? `, ${importResult.skipped.length} skipped` : ''}
                  {importResult.errors?.length ? `, ${importResult.errors.length} errors` : ''}.
                </div>
                {(importResult.errors?.length > 0 || importResult.skipped?.length > 0) && (
                  <div
                    className="table-wrap"
                    style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}
                  >
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Student No</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(importResult.errors || []), ...(importResult.skipped || [])].map(
                          (r, i) => (
                            <tr key={i}>
                              <td>{r.row ?? '-'}</td>
                              <td>{r.student_no || '-'}</td>
                              <td>{r.error || r.reason || '-'}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowImport(false)}
              >
                {importResult ? 'Close' : 'Cancel'}
              </button>
              <button className="btn btn-green" disabled={importing}>
                <DownloadSimple size={18} /> {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Add a single student modal ─── */}
      {showAdd && (
        <Modal
          open
          icon={<UserPlus size={20} />}
          title="Add Student"
          subtitle="Add one continuing student to the dues list. For a whole class list, use Import Students instead."
          onClose={() => setShowAdd(false)}
        >
          <form onSubmit={runAdd}>
            <div className="modal-section">
              {schoolSide ? (
                <div className="field">
                  <label>Department *</label>
                  <Select
                    value={addDept}
                    onChange={setAddDept}
                    options={deptOptions}
                    placeholder="Select department..."
                    required
                  />
                </div>
              ) : (
                <p className="muted text-sm mb">
                  Adding to <strong>{user?.department_name}</strong>.
                </p>
              )}
              <div className="field">
                <label>Full name *</label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="e.g. Ama Mensah"
                  required
                />
              </div>
              <div className="field">
                <label>Student number *</label>
                <input
                  className="input"
                  value={addForm.student_no}
                  onChange={(e) =>
                    setAddForm({ ...addForm, student_no: e.target.value.toUpperCase() })
                  }
                  placeholder="e.g. UA2309001"
                  required
                />
              </div>
              <div className="field">
                <label>Email *</label>
                <input
                  className="input"
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  placeholder="e.g. ama@example.com"
                  required
                />
              </div>
              <div className="field">
                <label>Level</label>
                <Select
                  value={addForm.level}
                  onChange={(v) => setAddForm({ ...addForm, level: v })}
                  options={LEVEL_OPTIONS}
                  placeholder="Select level..."
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="btn btn-green" disabled={adding}>
                <UserPlus size={18} /> {adding ? 'Adding...' : 'Add Student'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Edit student modal ─── */}
      {editing && editForm && (
        <Modal
          open
          icon={<Pencil size={20} />}
          title="Edit Student"
          subtitle="Correct this student's details on the continuing list."
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveEdit}>
            <div className="modal-section">
              {isSchoolAdmin && (
                <div className="field">
                  <label>Department</label>
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{editing.department_name || 'Unassigned'}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        const s = editing;
                        setEditing(null);
                        openTransfer(s);
                      }}
                    >
                      <ArrowsLeftRight size={14} /> Transfer
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Moving a student to another department is a separate, audited action.
                  </p>
                </div>
              )}
              <div className="field">
                <label>Full name *</label>
                <input
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Student number *</label>
                <input
                  className="input"
                  value={editForm.student_no}
                  onChange={(e) => setEditForm({ ...editForm, student_no: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  className="input"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Level</label>
                <Select
                  value={editForm.level}
                  onChange={(v) => setEditForm({ ...editForm, level: v })}
                  options={LEVEL_OPTIONS}
                  placeholder="Select level..."
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn-green" disabled={savingEdit}>
                {savingEdit ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Transfer student to another department ─── */}
      {transferTarget && (
        <Modal
          open
          icon={<ArrowsLeftRight size={20} />}
          title="Transfer Student"
          subtitle={`Move ${transferTarget.name} to another department. This is recorded in the audit log.`}
          onClose={() => setTransferTarget(null)}
        >
          <form onSubmit={runTransfer}>
            <div className="modal-section">
              <div className="field">
                <label>Current department</label>
                <div style={{ fontWeight: 600 }}>
                  {transferTarget.department_name || 'Unassigned'}
                </div>
              </div>
              <div className="field">
                <label>Transfer to *</label>
                <Select
                  value={transferDept}
                  onChange={setTransferDept}
                  options={deptOptions.filter(
                    (o) => Number(o.value) !== Number(transferTarget.department_id)
                  )}
                  placeholder="Select department..."
                  required
                />
              </div>
              <div className="field">
                <label>Reason *</label>
                <textarea
                  className="input"
                  rows={3}
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="e.g. Wrong department recorded at registration"
                  required
                />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Transferring moves roster membership only. Any receipts and payments already
                recorded stay with the department that collected them.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setTransferTarget(null)}
              >
                Cancel
              </button>
              <button className="btn btn-green" disabled={transferring}>
                <ArrowsLeftRight size={18} /> {transferring ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Delete student confirm ─── */}
      {pendingDelete && (
        <Confirm
          open
          danger
          title="Delete student"
          message={`Remove ${pendingDelete.name} (${pendingDelete.student_no}) from the list? A student who has ever paid keeps their record for reconciliation.`}
          confirmLabel="Delete"
          onConfirm={runDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* ─── Super admin force-delete ─── */}
      {forceDelete && (
        <Modal
          open
          closeOnBackdrop={false}
          icon={<Warning size={20} />}
          title={`Force delete ${forceDelete.name}`}
          subtitle="This permanently destroys the student record and every receipt attached to it."
          onClose={() => {
            setForceDelete(null);
            setForceReason('');
          }}
        >
          <form onSubmit={runForceDelete}>
            <div className="modal-section">
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <Warning size={16} />
                <div>
                  <strong>This cannot be undone.</strong> {forceDelete.name} (
                  {forceDelete.student_no || 'no number'}) and{' '}
                  <strong>
                    {forceDelete.receipt_count ?? 0} receipt record
                    {forceDelete.receipt_count === 1 ? '' : 's'}
                  </strong>{' '}
                  will be permanently removed from the system, including their payment history.
                </div>
              </div>
              <div className="field">
                <label>Reason (required) *</label>
                <textarea
                  className="input"
                  rows={3}
                  value={forceReason}
                  onChange={(e) => setForceReason(e.target.value)}
                  placeholder="Why is this record being permanently removed? (audit-logged)"
                  required
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setForceDelete(null);
                  setForceReason('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={forceSaving || !forceReason.trim()}
              >
                <Warning size={18} /> {forceSaving ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <StudentDetailsModal student={details} onClose={() => setDetails(null)} />

      <ResendConfirmModal
        student={resendTarget}
        onClose={() => setResendTarget(null)}
        addToast={addToast}
      />
    </div>
  );
}
