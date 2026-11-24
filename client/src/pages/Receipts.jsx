import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import Pagination from '../components/ui/Pagination';
import Modal from '../components/ui/Modal';
import ExtrasEditPicker from '../components/ui/ExtrasEditPicker';
import { genderScopeNote } from '../utils/genderScope';
import {
  IconReceipt as ReceiptIcon,
  IconCircleCheck as CheckCircle,
  IconAlertTriangle as Warning,
  IconBan as Prohibit,
  IconSend as PaperPlaneTilt,
  IconPencil as PencilSimple,
} from '@tabler/icons-react';

const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
  // extra_dues lines carry their own snapshot label — this is the fallback.
  extra_dues: 'Other Dues',
};

export default function Receipts() {
  const { user } = useAuth();
  const schoolSide = ['school_admin', 'school_staff', 'super_admin'].includes(user?.role);
  const [receipts, setReceipts] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [voidFilter, setVoidFilter] = useState('all'); // 'all' | 'voided'
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'success'|'error', text }
  const [selected, setSelected] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [savingVoid, setSavingVoid] = useState(false);
  const [voidingLine, setVoidingLine] = useState(null);
  const [voidLineReason, setVoidLineReason] = useState('');
  const [voidLineError, setVoidLineError] = useState('');
  const [savingVoidLine, setSavingVoidLine] = useState(false);
  const [resending, setResending] = useState(false);
  // "Other Dues" checkbox editor: toggleable item catalog, the checked set
  // ({ id: amount }), locked ids (already-charged lines — amount read-only),
  // and the save form. `editingExtras` is truthy while the editor is open.
  const [editingExtras, setEditingExtras] = useState(false);
  const [extrasItems, setExtrasItems] = useState([]);
  const [extrasSelected, setExtrasSelected] = useState({});
  const [extrasLocked, setExtrasLocked] = useState(() => new Set());
  const [extrasReason, setExtrasReason] = useState('');
  const [extrasError, setExtrasError] = useState('');
  const [extrasSaving, setExtrasSaving] = useState(false);
  const PAGE_SIZE = 12;

  // Server-side pagination: the server filters, counts (COUNT(*) total) and
  // slices; the client only clamps the page when the list shrinks (e.g. after
  // a void reload) so it never shows an empty "page 7 of 3".
  const loadReceipts = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = { page, limit: PAGE_SIZE };
    if (search) params.search = search;
    if (voidFilter === 'voided') params.voided = 'only';
    api
      .get('/receipts', { params })
      .then((res) => {
        const data = res.data || {};
        // Tolerate a plain array (older server) while preferring the
        // { receipts, total, page, pageSize } contract.
        const rows = Array.isArray(data) ? data : data.receipts || [];
        const tot = Array.isArray(data) ? rows.length : Number(data.total) || 0;
        const pageSize = Array.isArray(data) ? PAGE_SIZE : Number(data.pageSize) || PAGE_SIZE;
        const maxPage = Math.max(1, Math.ceil(tot / pageSize));
        if (page > maxPage) {
          setPage(maxPage); // reload with the clamped page
          return;
        }
        setReceipts(rows);
        setTotal(tot);
      })
      .catch(() =>
        setLoadError('Receipts could not be loaded. Check your connection and try again.')
      )
      .finally(() => setLoading(false));
  }, [search, page, voidFilter]);

  const openReceipt = async (receipt) => {
    try {
      const res = await api.get(`/receipts/verify/${encodeURIComponent(receipt.receipt_number)}`);
      setSelected(res.data);
    } catch {
      setLoadError('Receipt details could not be loaded.');
    }
  };

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  // Live: a new payment anywhere adds its receipt to this list immediately.
  useRealtime({
    'payment:new': loadReceipts,
    'payment:voided': loadReceipts,
    'student:changed': loadReceipts,
  });

  useEffect(() => {
    setPage(1);
  }, [search, voidFilter]);

  const recorderLabel = (r) => {
    if (r.record_type === 'rep') return 'Class Rep';
    return schoolSide && !r.recorded_by ? 'System' : 'Admin';
  };

  // Only actual admins can void — school_staff never has the server-side
  // permission (the endpoint returns 403), so no dead button for them.
  const canVoid = (receipt) =>
    Boolean(receipt) &&
    !receipt.voided_at &&
    ['school_admin', 'dept_admin', 'super_admin'].includes(user?.role);

  // "Other Dues" editing is broader than void: the verification desk
  // (school_staff) and dept_staff can check/uncheck items — the server
  // scopes what each may toggle via extrasScopeForRole.
  const canEditExtras = (receipt) =>
    Boolean(receipt) &&
    !receipt.voided_at &&
    ['school_admin', 'school_staff', 'dept_admin', 'dept_staff', 'super_admin'].includes(
      user?.role
    );

  const voidReceipt = async () => {
    if (!voiding) return;
    setVoidError('');
    if (voidReason.trim().length < 3) {
      setVoidError('Enter a brief reason for voiding this receipt.');
      return;
    }
    setSavingVoid(true);
    try {
      const res = await api.post(`/receipts/${voiding.id}/void`, { reason: voidReason.trim() });
      // The server now reports the REAL reversal-email status.
      const email = res.data?.email;
      if (email?.mode === 'sent') {
        setNotice({
          type: 'success',
          text: `Receipt ${voiding.receipt_number} reversed. Reversal email sent to ${email.to}.`,
        });
      } else if (email?.mode === 'dev') {
        setNotice({
          type: 'success',
          text: `Receipt ${voiding.receipt_number} reversed. Email not configured — the payer was not notified.`,
        });
      } else {
        setNotice({
          type: 'error',
          text: `Receipt ${voiding.receipt_number} reversed, but the reversal email failed${
            email?.error ? ` (${email.error})` : ''
          } — the payer was NOT notified.`,
        });
      }
      setVoiding(null);
      setVoidReason('');
      setSelected(null);
      loadReceipts();
    } catch (err) {
      setVoidError(err.response?.data?.error || 'Receipt could not be voided.');
    } finally {
      setSavingVoid(false);
    }
  };

  // Per-line void: correct a single wrong line without reversing the whole
  // receipt. The server recomputes the receipt total from the remaining lines.
  const voidPaymentLine = async () => {
    if (!voidingLine || !selected) return;
    setVoidLineError('');
    if (voidLineReason.trim().length < 3) {
      setVoidLineError('Enter a brief reason for voiding this payment line.');
      return;
    }
    setSavingVoidLine(true);
    try {
      const res = await api.post(`/receipts/${selected.id}/void-payment`, {
        payment_id: voidingLine.id,
        reason: voidLineReason.trim(),
      });
      const newTotal = Number(res.data.total_amount);
      setSelected((sel) =>
        sel
          ? {
              ...sel,
              total_amount: newTotal,
              voided_line_count: (sel.voided_line_count || 0) + 1,
              lines: asArray(sel.lines).map((l) =>
                l.id === voidingLine.id
                  ? {
                      ...l,
                      voided_at: new Date().toISOString(),
                      void_reason: voidLineReason.trim(),
                    }
                  : l
              ),
            }
          : sel
      );
      setNotice({
        type: 'success',
        text: `${voidingLine.label || TYPE_LABEL[voidingLine.type] || 'Payment'} line voided — receipt ${selected.receipt_number} total is now GHS ${newTotal.toFixed(2)}.`,
      });
      setVoidingLine(null);
      setVoidLineReason('');
      loadReceipts();
    } catch (err) {
      setVoidLineError(err.response?.data?.error || 'The payment line could not be voided.');
    } finally {
      setSavingVoidLine(false);
    }
  };

  // Super admin: re-send the receipt email to the address on file.
  const resendReceipt = async (receipt) => {
    if (!receipt || resending) return;
    setResending(true);
    try {
      const res = await api.post(`/receipts/${receipt.id}/resend-email`, {});
      const email = res.data?.email;
      if (email?.sent) {
        setNotice({
          type: 'success',
          text: `Receipt ${receipt.receipt_number} re-sent to ${email.to}.`,
        });
      } else if (email?.mode === 'dev') {
        setNotice({
          type: 'success',
          text: `Email not configured — receipt ${receipt.receipt_number} logged in dev mode, not delivered.`,
        });
      } else {
        setNotice({
          type: 'error',
          text: `Re-send failed${email?.error ? ` (${email.error})` : ''} — the payer was NOT notified.`,
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.error || 'The receipt email could not be re-sent.',
      });
    } finally {
      setResending(false);
    }
  };

  // ─── "Other Dues" checkbox editor ───
  // Open: load the items this account may toggle, then pre-check the ones
  // already charged on this receipt (matching by the label snapshot = item
  // name). Already-charged amounts are locked — change money via uncheck +
  // re-check so the original line survives as a voided audit row.
  const openExtrasEditor = async (receipt) => {
    if (!receipt) return;
    setExtrasError('');
    setExtrasReason('');
    setEditingExtras(true);
    try {
      const res = await api.get('/dues-items', { params: { toggleable: 1, department_id: 'all' } });
      const items = asArray(res.data);
      setExtrasItems(items);
      const nameToId = new Map(items.map((i) => [String(i.name).toLowerCase(), i.id]));
      const selected = {};
      const locked = new Set();
      for (const line of asArray(receipt.lines)) {
        if (line.type !== 'extra_dues' || line.voided_at) continue;
        const id = nameToId.get(String(line.label || '').toLowerCase());
        if (id == null) continue; // out-of-catalog line: shown as a skipped note, not a box
        selected[id] = Number(line.amount);
        locked.add(id);
      }
      setExtrasSelected(selected);
      setExtrasLocked(locked);
    } catch {
      setExtrasItems([]);
      setExtrasError('The dues items could not be loaded — close and try again.');
    }
  };

  const closeExtrasEditor = () => {
    setEditingExtras(false);
    setExtrasSelected({});
    setExtrasLocked(new Set());
    setExtrasReason('');
    setExtrasError('');
  };

  const toggleExtraItem = (item) => {
    setExtrasSelected((prev) => {
      const next = { ...prev };
      if (next[item.id] !== undefined) delete next[item.id];
      else next[item.id] = Number(item.amount);
      return next;
    });
  };

  const setExtraAmount = (item, value) => {
    setExtrasSelected((prev) => ({ ...prev, [item.id]: value }));
  };

  const saveExtras = async () => {
    if (!selected || extrasSaving) return;
    setExtrasError('');
    if (extrasReason.trim().length < 3) {
      setExtrasError('Enter a brief reason for this change.');
      return;
    }
    const items = Object.entries(extrasSelected).map(([id, amount]) => ({
      dues_item_id: Number(id),
      amount: Number(amount),
    }));
    setExtrasSaving(true);
    try {
      const res = await api.put(`/receipts/${selected.id}/extra-dues`, {
        items,
        reason: extrasReason.trim(),
      });
      const data = res.data || {};
      const skippedNote =
        asArray(data.skipped).length > 0
          ? ` ${asArray(data.skipped).length} line(s) not managed here were left untouched.`
          : '';
      setNotice({
        type: 'success',
        text: `Other Dues updated on ${selected.receipt_number}: ${data.added} added, ${data.removed} removed. Total now GHS ${Number(
          data.total_amount ?? selected.total_amount
        ).toFixed(2)}.${skippedNote}`,
      });
      // Refresh the open receipt so the breakdown reflects the new lines.
      try {
        const fresh = await api.get(
          `/receipts/verify/${encodeURIComponent(selected.receipt_number)}`
        );
        setSelected(fresh.data);
      } catch {
        /* list reload still keeps things consistent */
      }
      closeExtrasEditor();
      loadReceipts();
    } catch (err) {
      setExtrasError(err.response?.data?.error || 'Other Dues could not be updated.');
    } finally {
      setExtrasSaving(false);
    }
  };

  return (
    <div>
      <Modal
        open={Boolean(voiding)}
        icon={<Prohibit size={20} />}
        title="Void receipt"
        subtitle={voiding ? `${voiding.receipt_number} will remain in the audit trail.` : ''}
        onClose={() => !savingVoid && setVoiding(null)}
      >
        <div className="alert alert-error">
          Voiding reverses this collection for reporting and allows the affected dues to be recorded
          again.
        </div>
        <div className="field">
          <label>Reason *</label>
          <textarea
            className="input"
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="e.g. Wrong amount entered"
          />
        </div>
        {voidError && <div className="alert alert-error">{voidError}</div>}
        <div className="modal-actions">
          <button
            className="btn btn-outline"
            disabled={savingVoid}
            onClick={() => setVoiding(null)}
          >
            Cancel
          </button>
          <button className="btn btn-danger" disabled={savingVoid} onClick={voidReceipt}>
            <Prohibit size={17} /> {savingVoid ? 'Voiding...' : 'Void receipt'}
          </button>
        </div>
      </Modal>
      <Modal
        open={Boolean(voidingLine)}
        icon={<Prohibit size={20} />}
        title="Void payment line"
        subtitle={
          voidingLine && selected
            ? `${voidingLine.label || TYPE_LABEL[voidingLine.type] || 'Payment'} · GHS ${Number(voidingLine.amount).toFixed(2)} on ${selected.receipt_number}`
            : ''
        }
        onClose={() => !savingVoidLine && setVoidingLine(null)}
      >
        <div className="alert alert-error">
          Voiding this line reverses only this dues type and recomputes the receipt total. The
          receipt stays valid for its other lines.
        </div>
        <div className="field">
          <label>Reason *</label>
          <textarea
            className="input"
            rows={3}
            value={voidLineReason}
            onChange={(e) => setVoidLineReason(e.target.value)}
            placeholder="e.g. Wrong amount entered"
          />
        </div>
        {voidLineError && <div className="alert alert-error">{voidLineError}</div>}
        <div className="modal-actions">
          <button
            className="btn btn-outline"
            disabled={savingVoidLine}
            onClick={() => setVoidingLine(null)}
          >
            Cancel
          </button>
          <button className="btn btn-danger" disabled={savingVoidLine} onClick={voidPaymentLine}>
            <Prohibit size={17} /> {savingVoidLine ? 'Voiding...' : 'Void line'}
          </button>
        </div>
      </Modal>
      <Modal
        open={Boolean(selected)}
        icon={<ReceiptIcon size={20} />}
        title="Receipt details"
        subtitle={selected ? `${selected.receipt_number} · ${selected.student_name}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="receipt-detail-modal">
            <div className={`alert ${selected.voided_at ? 'alert-error' : 'alert-success'}`}>
              {selected.voided_at ? <Prohibit size={17} /> : <CheckCircle size={17} />}{' '}
              {selected.voided_at
                ? `This receipt was voided${selected.void_reason ? `: ${selected.void_reason}` : '.'}`
                : 'This receipt is valid and recorded.'}
            </div>
            <div className="receipt-detail-grid">
              <div>
                <span>Student</span>
                <strong>{selected.student_name}</strong>
                <small>{selected.student_no || 'No student number'}</small>
              </div>
              <div>
                <span>Department</span>
                <strong>{selected.department_name || 'School'}</strong>
                <small>
                  {selected.payment_level || selected.level
                    ? `Level ${selected.payment_level || selected.level}`
                    : 'No level'}
                </small>
              </div>
              <div>
                <span>Paid on</span>
                <strong>{new Date(selected.paid_at).toLocaleString()}</strong>
                <small>{selected.method === 'momo' ? 'Mobile Money' : selected.method}</small>
              </div>
              <div>
                <span>Total</span>
                <strong>GHS {Number(selected.total_amount).toFixed(2)}</strong>
                <small>{selected.record_type === 'rep' ? 'Class Rep' : 'Admin'}</small>
              </div>
            </div>
            <h4 className="receipt-detail-heading">Payment breakdown</h4>
            <div className="receipt-detail-lines">
              {selected.lines &&
                asArray(selected.lines).map((line) => (
                  <div key={line.id || line.type}>
                    <span>{line.label || TYPE_LABEL[line.type] || line.type}</span>
                    <strong>GHS {Number(line.amount).toFixed(2)}</strong>
                    {canVoid(selected) && !line.voided_at && (
                      <button
                        className="btn btn-outline btn-xs"
                        onClick={() => {
                          setVoidingLine(line);
                          setVoidLineReason('');
                          setVoidLineError('');
                        }}
                      >
                        <Prohibit size={12} /> Void line
                      </button>
                    )}
                  </div>
                ))}
            </div>
            {selected.voided_line_count > 0 && (
              <p className="muted text-sm" style={{ marginTop: 8 }}>
                <Warning size={14} /> {selected.voided_line_count} payment line
                {selected.voided_line_count === 1 ? '' : 's'} voided on this receipt.
              </p>
            )}
            {canEditExtras(selected) && !editingExtras && (
              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn btn-outline" onClick={() => openExtrasEditor(selected)}>
                  <PencilSimple size={17} /> Edit Other Dues
                </button>
              </div>
            )}
            {canEditExtras(selected) && editingExtras && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4 className="receipt-detail-heading" style={{ marginTop: 0 }}>
                  Other Dues
                </h4>
                <p className="muted text-sm">
                  Check the items this student should be charged. Unchecking voids the existing line
                  (kept as an audit record). Already-charged amounts are fixed — uncheck and
                  re-check to change an amount.
                </p>
                {extrasError && <div className="alert alert-error">{extrasError}</div>}
                <ExtrasEditPicker
                  items={extrasItems}
                  selected={extrasSelected}
                  lockedIds={extrasLocked}
                  onToggle={toggleExtraItem}
                  onAmount={setExtraAmount}
                  warnNote={(item) => genderScopeNote(item.gender, selected?.student_gender)}
                />
                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="extras-reason">Reason for this change</label>
                  <input
                    id="extras-reason"
                    className="input"
                    value={extrasReason}
                    onChange={(e) => setExtrasReason(e.target.value)}
                    placeholder="e.g. Wrong item charged at verification"
                  />
                </div>
                <div className="modal-actions">
                  <button
                    className="btn btn-outline"
                    onClick={closeExtrasEditor}
                    disabled={extrasSaving}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={saveExtras} disabled={extrasSaving}>
                    {extrasSaving ? 'Saving…' : 'Save Other Dues'}
                  </button>
                </div>
              </div>
            )}
            {canVoid(selected) && (
              <div className="modal-actions">
                {user?.role === 'super_admin' && !selected.voided_at && (
                  <button
                    className="btn btn-outline"
                    disabled={resending}
                    onClick={() => resendReceipt(selected)}
                  >
                    <PaperPlaneTilt size={17} /> {resending ? 'Sending…' : 'Resend email'}
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setVoiding(selected);
                    setVoidReason('');
                    setVoidError('');
                  }}
                >
                  <Prohibit size={17} /> Void receipt
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
      <div className="page-head">
        <div>
          <h1>Receipts</h1>
          <p className="subtitle">
            {schoolSide
              ? 'All collections across the School.'
              : `Receipts issued for ${user?.department_name}.`}
          </p>
        </div>
      </div>

      <div className="card">
        {notice && (
          <div className={`alert ${notice.type === 'error' ? 'alert-error' : 'alert-success'}`}>
            {notice.type === 'error' ? <Warning size={16} /> : <CheckCircle size={16} />}{' '}
            {notice.text}{' '}
            <button className="btn btn-outline btn-xs" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {loadError && (
          <div className="alert alert-error">
            <Warning size={16} /> {loadError}{' '}
            <button className="btn btn-outline btn-xs" onClick={loadReceipts}>
              Retry
            </button>
          </div>
        )}
        <div className="flex gap-sm" style={{ maxWidth: 660, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 260px', maxWidth: 420 }}>
            <input
              className="input search-input"
              placeholder="Search by receipt number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '0 0 180px' }}>
            <select
              className="input"
              value={voidFilter}
              onChange={(e) => setVoidFilter(e.target.value)}
              aria-label="Voided receipts filter"
            >
              <option value="all">Include voided</option>
              <option value="voided">Only voided</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt Number</th>
                <th>Student</th>
                <th>Student No</th>
                {schoolSide && <th>Department</th>}
                <th>Total</th>
                <th>Method</th>
                <th>Paid On</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {!loading && receipts.length === 0 && (
                <tr>
                  <td colSpan={schoolSide ? 8 : 7} className="muted">
                    No receipts found.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={schoolSide ? 8 : 7}>
                    <div className="table-state">
                      <span className="spin-dot" /> Loading receipts...
                    </div>
                  </td>
                </tr>
              )}
              {receipts.map((r) => {
                // Voided rows read as reversed: badge + struck-through values.
                const strike = r.voided_at
                  ? { textDecoration: 'line-through', opacity: 0.65 }
                  : undefined;
                return (
                  <tr
                    key={r.id}
                    className="row-click"
                    onClick={() => openReceipt(r)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openReceipt(r);
                      }
                    }}
                  >
                    <td>
                      <span className="code-cell" style={{ fontSize: 12 }}>
                        {r.receipt_number}
                      </span>{' '}
                      {r.voided_at && <span className="badge badge-red">Voided</span>}
                    </td>
                    <td className="fw-600" style={strike}>
                      {r.student_name}
                    </td>
                    <td style={strike}>{r.student_no || '-'}</td>
                    {schoolSide && (
                      <td style={strike}>
                        {r.department_name || <span className="muted">—</span>}
                      </td>
                    )}
                    <td className="fw-700" style={strike}>
                      GHS {Number(r.total_amount).toFixed(2)}
                    </td>
                    <td style={{ textTransform: 'capitalize', ...(strike || {}) }}>
                      {r.method === 'momo' ? 'Mobile Money' : r.method}
                    </td>
                    <td style={strike}>{new Date(r.paid_at).toLocaleString()}</td>
                    <td>
                      <span className="badge badge-gray">{recorderLabel(r)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          onPageChange={setPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
        />
      </div>
    </div>
  );
}
