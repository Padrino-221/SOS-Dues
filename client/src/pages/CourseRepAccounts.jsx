import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCsv as FileCsv, IconUpload as UploadSimple, IconBan as Prohibit, IconKey as Key, IconPencil as PencilSimple } from '@tabler/icons-react';
import api from '../api/client';
import Select from '../components/ui/Select';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';
import Confirm from '../components/ui/Confirm';
import Modal from '../components/ui/Modal';
import './CourseRepAccounts.css';

const endpoint = '/users/course-reps';

function AccountAction({ label, icon: Icon, disabled, onClick }) {
  const id = useId();
  const [position, setPosition] = useState(null);
  const show = event => { const rect = event.currentTarget.getBoundingClientRect(); setPosition({ left: Math.min(Math.max(rect.left + rect.width / 2, 100), window.innerWidth - 100), top: rect.top - 8 }); };
  return <span className="rep-action-wrap" onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}>
    <button type="button" className="btn btn-secondary rep-icon-action" aria-label={label} aria-describedby={position ? id : undefined} disabled={disabled} onClick={() => { setPosition(null); onClick(); }}><Icon size={19} aria-hidden="true"/></button>
    {position && createPortal(<span id={id} role="tooltip" className="rep-action-tooltip" style={position}>{label}</span>, document.body)}
  </span>;
}

function parseCsv(source) {
  const csv = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let offset = 0;
  while (offset < csv.length) {
    const field = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r\n|\r|\n|$)/y;
    field.lastIndex = offset;
    const match = field.exec(csv);
    if (!match) throw new Error(`Invalid CSV quoting in record ${rows.length + 1}.`);
    const [, value, separator] = match;
    row.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
    offset = field.lastIndex;
    if (separator === ',' && offset === csv.length) row.push('');
    if (separator !== ',' || offset === csv.length) {
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    }
  }
  return rows;
}

export default function CourseRepAccounts({ departments = [] }) {
  const [accounts, setAccounts] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [account, setAccount] = useState({ name: '', email: '', department: '' });
  const pager = usePagination(accounts, 10);
  const [disableTarget, setDisableTarget] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function saveEdit(event) {
    event.preventDefault();setSavingEdit(true);setEditError('');
    try {
      await api.put(`${endpoint}/${editing.id}`, { name: editing.name, email: editing.email, department: editing.department });
      await load();setEditing(null);setMessage('Course rep account updated. Existing collection records are unchanged.');
    } catch (err) { setEditError(err.response?.data?.error || 'Could not update this account. Please try again.'); }
    finally { setSavingEdit(false); }
  }

  function createAccount(event) {
    event.preventDefault();
    run(async () => {
      if (!account.department) throw new Error('Choose a department.');
      const { data } = await api.post(endpoint + '/import', { rows: [account] }, { timeout: 60000 });
      if (data.failed.length) throw new Error('The account is pending, but its invitation email could not be sent. Submit these details again to retry.');
      if (data.skipped.length) throw new Error('This email already belongs to an existing account. Its access has not been changed.');
      setAccount({ name: '', email: '', department: '' });
      setMessage('Invitation sent. The course rep can use the email link to set their password.');
    });
  }

  async function load() {
    const response = await api.get(endpoint);
    setAccounts(response.data);
  }

  useEffect(() => {
    load().catch(() => setError('Could not load course rep accounts.'));
  }, []);

  async function run(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not update course rep accounts.');
    } finally {
      setBusy(false);
    }
  }

  function importAccounts(event) {
    event.preventDefault();
    const form = event.currentTarget;
    run(async () => {
      if (!file || !/\.csv$/i.test(file.name)) throw new Error('Choose a CSV file.');
      if (file.size > 256 * 1024) throw new Error('Choose a CSV file smaller than 256 KB.');
      const records = parseCsv(await file.text());
      const headers = records.shift()?.map(value => value.trim().toLowerCase());
      const columns = ['name', 'email', 'department'];
      if (headers?.length !== 3 || !columns.every(column => headers.includes(column))) {
        throw new Error('CSV headers must be Name, Email and Department.');
      }
      if (!records.length || records.length > 100) throw new Error('Include 1 to 100 account rows.');
      const rows = records.map((fields, index) => {
        if (fields.length !== 3) throw new Error(`CSV record ${index + 2} must contain three columns.`);
        return Object.fromEntries(columns.map(column => [column, fields[headers.indexOf(column)]]));
      });
      const { data } = await api.post(endpoint + '/import', { rows }, { timeout: 60000 });
      if (data.failed.length || data.skipped.length) {
        setError([
          data.failed.length && `Email failed for ${data.failed.join(', ')}. Upload the same CSV to retry pending invitations.`,
          data.skipped.length && `Skipped existing accounts: ${data.skipped.join(', ')}.`,
        ].filter(Boolean).join(' '));
      }
      form.reset();
      setFile(null);
      setMessage(`Sent ${data.invited} invitations.`);
    });
  }

  return (
    <section className="settings-panel course-rep-accounts">
      <div className="settings-panel-head"><h3>Course rep accounts</h3></div>
      <div className="course-rep-create-options">
      <form className="course-rep-single" onSubmit={createAccount}>
        <div><strong>Add one course rep</strong><p className="muted text-sm">Send an invitation to set a password. The email includes the department code.</p></div>
        <label htmlFor="rep-account-name">Full name</label>
        <input id="rep-account-name" className="input" required maxLength={150} autoComplete="name" value={account.name} disabled={busy} onChange={event => setAccount({ ...account, name: event.target.value })}/>
        <label htmlFor="rep-account-email">Email address</label>
        <input id="rep-account-email" className="input" type="email" required maxLength={254} autoComplete="email" value={account.email} disabled={busy} onChange={event => setAccount({ ...account, email: event.target.value })}/>
        <label>Department
          <Select value={account.department} onChange={department => setAccount({ ...account, department })} options={departments.map(department => ({ value: department.name, label: department.name }))} placeholder="Choose department" required disabled={busy}/>
        </label>
        <button className="btn btn-primary course-rep-submit" disabled={busy || !departments.length}>{busy ? 'Please wait…' : 'Send invitation'}</button>
      </form>
      <form className="course-rep-upload" onSubmit={importAccounts}>
        <div>
          <strong>Bulk import accounts</strong>
          <p className="muted text-sm">Upload up to 100 accounts per CSV. Use full department names. Each rep receives an email to set their password.</p>
          <a href="data:text/csv;charset=utf-8,Name%2CEmail%2CDepartment%0D%0A" download="course-rep-accounts-template.csv">Download CSV template</a>
        </div>
        <div className="course-rep-picker">
          <FileCsv size={28} aria-hidden="true" />
          <div className="course-rep-file-name" aria-live="polite">
            <strong>{file ? file.name : 'Select a CSV file'}</strong>
            <span className="muted text-sm">{file ? `${Math.max(1, Math.ceil(file.size / 1024))} KB` : 'CSV · up to 256 KB'}</span>
          </div>
          <label className="btn btn-secondary course-rep-file-button" aria-disabled={busy}>
            <input type="file" accept=".csv,text/csv" aria-label="Choose course rep CSV file"
              onChange={event => setFile(event.target.files[0] ?? null)} disabled={busy} required />
            <UploadSimple size={16} aria-hidden="true" /> {file ? 'Change file' : 'Choose CSV'}
          </label>
        </div>
        <button className="btn btn-primary course-rep-submit" disabled={busy || !file}>
          {busy ? 'Please wait…' : 'Import accounts'}
        </button>
      </form>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {!accounts.length && !error && <tr><td colSpan={5} className="muted">No course rep accounts yet.</td></tr>}
            {pager.slice.map(account => (
              <tr key={account.id}>
                <td>{account.name}</td><td>{account.email}</td><td>{account.department}</td>
                <td>{account.disabled_at ? 'Disabled' : account.password_pending ? 'Password setup pending' : 'Active'}</td>
                <td><div className="rep-account-actions">
                  <AccountAction label={`Edit ${account.name}`} icon={PencilSimple} disabled={busy} onClick={() => { setEditError('');setEditing({ ...account }); }}/>
                  <AccountAction label={`Send password reset to ${account.name}`} icon={Key} disabled={busy || !!account.disabled_at} onClick={() => run(async () => {
                    await api.post(`${endpoint}/${account.id}/reset-password`, {}, { timeout: 60000 });
                    setMessage(`Password-reset email sent to ${account.email}.`);
                  })}/>
                  <AccountAction label={`Disable ${account.name}`} icon={Prohibit} disabled={busy || !!account.disabled_at} onClick={() => setDisableTarget(account)}/>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rep-account-pagination"><Pagination page={pager.page} totalPages={pager.totalPages} onPageChange={pager.setPage} totalItems={pager.totalItems} pageSize={pager.perPage}/></div>
      <Modal open={!!editing} onClose={() => { if (!savingEdit) setEditing(null); }} title="Edit course rep account" subtitle="Update account details without changing collection history.">
        {editing && <form className="course-rep-single rep-edit-form" onSubmit={saveEdit}>
          {editError && <p className="alert alert-error" role="alert">{editError}</p>}
          <label htmlFor="rep-edit-name">Full name</label>
          <input className="input" id="rep-edit-name" required maxLength={150} disabled={savingEdit} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })}/>
          <label htmlFor="rep-edit-email">Email address</label>
          <input className="input" id="rep-edit-email" type="email" required maxLength={254} disabled={savingEdit} value={editing.email} onChange={event => setEditing({ ...editing, email: event.target.value })}/>
          <label>Department<Select value={editing.department} options={departments.map(department => ({ value: department.name, label: department.name }))} onChange={department => setEditing({ ...editing, department })} disabled={savingEdit} required/></label>
          <p className="muted text-sm">The account keeps its current status. If you change a pending account’s email, send a new password-reset link afterwards.</p>
          <div className="rep-account-actions"><button className="btn btn-secondary" type="button" disabled={savingEdit} onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save changes'}</button></div>
        </form>}
      </Modal>
      <Confirm open={!!disableTarget} title="Disable course rep account?" message={`Disable access for ${disableTarget?.name ?? ''}? Their collection records will be preserved.`} confirmLabel="Disable account" danger onCancel={() => setDisableTarget(null)} onConfirm={async () => {
        setError('');setMessage('');
        await api.post(`${endpoint}/${disableTarget.id}/disable`);
        await load();setMessage(`Access disabled for ${disableTarget.name}.`);setDisableTarget(null);
      }}/>
    </section>
  );
}
