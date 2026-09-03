import React, { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  CheckCircle,
  Warning,
  Clock,
  CurrencyCircleDollar,
  Users,
  UserPlus,
  Trash,
  Pencil,
  Gift,
  ShieldCheck,
  MagnifyingGlass,
  DownloadSimple,
  ArrowLeft,
  ArrowRight,
} from '@phosphor-icons/react';
import Select from '../components/ui/Select';

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

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'payment', label: 'Payments' },
  { value: 'student_create', label: 'Student Created' },
  { value: 'student_update', label: 'Student Updated' },
  { value: 'student_delete', label: 'Student Deleted' },
  { value: 'student_adopt', label: 'Student Adopted' },
  { value: 'department_create', label: 'Department Created' },
  { value: 'department_update', label: 'Department Updated' },
  { value: 'department_delete', label: 'Department Deleted' },
  { value: 'department_dues_update', label: 'Dept Dues Config' },
  { value: 'souvenir_create', label: 'Souvenir Created' },
  { value: 'souvenir_update', label: 'Souvenir Updated' },
  { value: 'souvenir_delete', label: 'Souvenir Deleted' },
  { value: 'souvenir_distribution', label: 'Souvenir Distributed' },
  { value: 'payment_update', label: 'Payment Updated' },
];

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'SCHOOL_ADMIN', label: 'School Admin' },
  { value: 'DEPT_ADMIN', label: 'Dept Admin' },
  { value: 'REP', label: 'Class Rep' },
  { value: 'SYSTEM', label: 'System' },
];

const TYPE_ICONS = {
  payment: { Icon: CurrencyCircleDollar, color: 'green' },
  payment_update: { Icon: Pencil, color: 'gold' },
  student_create: { Icon: UserPlus, color: 'green' },
  student_update: { Icon: Pencil, color: 'navy' },
  student_delete: { Icon: Trash, color: 'red' },
  student_adopt: { Icon: Users, color: 'navy' },
  department_create: { Icon: ShieldCheck, color: 'navy' },
  department_update: { Icon: Pencil, color: 'gold' },
  department_delete: { Icon: Trash, color: 'red' },
  department_dues_update: { Icon: CurrencyCircleDollar, color: 'gold' },
  souvenir_create: { Icon: Gift, color: 'navy' },
  souvenir_update: { Icon: Pencil, color: 'gold' },
  souvenir_delete: { Icon: Trash, color: 'red' },
  souvenir_distribution: { Icon: Gift, color: 'green' },
};

const TYPE_BADGES = {
  payment: 'badge-green',
  payment_update: 'badge-gold',
  student_create: 'badge-green',
  student_update: 'badge-navy',
  student_delete: 'badge-red',
  student_adopt: 'badge-navy',
  department_create: 'badge-navy',
  department_update: 'badge-gold',
  department_delete: 'badge-red',
  department_dues_update: 'badge-gold',
  souvenir_create: 'badge-navy',
  souvenir_update: 'badge-gold',
  souvenir_delete: 'badge-red',
  souvenir_distribution: 'badge-green',
};

function formatType(type) {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRole(role) {
  const map = {
    SCHOOL_ADMIN: 'School Admin',
    DEPT_ADMIN: 'Dept Admin',
    REP: 'Class Rep',
    SYSTEM: 'System',
  };
  return map[role] || role;
}

export default function AuditLog() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';

  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [stats, setStats] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const loadEntries = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (typeFilter) params.type = typeFilter;
      if (roleFilter) params.admin_role = roleFilter;
      const res = await api.get('/audit', { params });
      setEntries(res.data.entries);
      setPagination(res.data.pagination);
    } catch (err) {
      addToast('Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, roleFilter, addToast]);

  const loadStats = useCallback(async () => {
    if (!isSchool) return;
    try {
      const res = await api.get('/audit/stats');
      setStats(res.data);
    } catch (err) {
      // Stats are optional
    }
  }, [isSchool]);

  useEffect(() => {
    loadEntries(1);
  }, [loadEntries]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const goToPage = (page) => {
    if (page < 1 || page > pagination.totalPages) return;
    loadEntries(page);
  };

  const downloadCsv = async () => {
    try {
      const params = {};
      if (typeFilter) params.type = typeFilter;
      if (roleFilter) params.admin_role = roleFilter;
      const res = await api.get('/audit/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit-log.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      addToast('Failed to export audit log', 'error');
    }
  };

  return (
    <div>
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>

      <div className="flex between align-center mb-md">
        <div>
          <h1><Clock size={28} style={{ marginRight: 10, verticalAlign: -5 }} />Audit Log</h1>
          <p className="subtitle">
            {isSchool
              ? 'View all system transactions — payments, student changes, configuration updates, and more.'
              : `View transactions related to ${user.department_name} and your own actions.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={downloadCsv}>
          <DownloadSimple size={18} /> Export CSV
        </button>
      </div>

      {/* ─── Stats Summary (School Admin only) ─── */}
      {isSchool && stats && (
        <div className="grid grid-3 mb-lg">
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Total Transactions</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="stat-icon-badge navy"><Clock size={22} /></div>
          </div>
          {stats.byType.slice(0, 2).map((s) => {
            const { Icon, color } = TYPE_ICONS[s.transaction_type] || { Icon: Clock, color: 'navy' };
            return (
              <div key={s.transaction_type} className="stat-card">
                <div className="stat-info">
                  <div className="stat-label">{formatType(s.transaction_type)}</div>
                  <div className="stat-value">{s.count}</div>
                  <div className="stat-trend">
                    Last: {new Date(s.last_occurrence).toLocaleDateString()}
                  </div>
                </div>
                <div className={`stat-icon-badge ${color}`}><Icon size={22} /></div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Filters ─── */}
      <div className="card">
        <div className="flex gap-md align-center" style={{ flexWrap: 'wrap' }}>
          <div style={{ width: 220 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Transaction Type</label>
            <Select value={typeFilter} onChange={(v) => { setTypeFilter(v); }} options={TYPE_OPTIONS} placeholder="All Types" />
          </div>
          <div style={{ width: 180 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Performed By</label>
            <Select value={roleFilter} onChange={(v) => { setRoleFilter(v); }} options={ROLE_OPTIONS} placeholder="All Roles" />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right', paddingTop: 18 }}>
            <span className="muted text-sm">{pagination.total} transaction{pagination.total !== 1 ? 's' : ''} found</span>
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="card">
        {loading && (
          <p className="muted text-sm" style={{ padding: 20, textAlign: 'center' }}>Loading...</p>
        )}

        {!loading && entries.length === 0 && (
          <p className="muted text-sm" style={{ padding: 20, textAlign: 'center' }}>{isSchool ? 'No audit log entries found.' : 'No audit log entries found for your department.'}</p>
        )}

        {!loading && entries.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Performed By</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const { Icon, color } = TYPE_ICONS[entry.transaction_type] || { Icon: Clock, color: 'navy' };
                  const badge = TYPE_BADGES[entry.transaction_type] || 'badge-gray';
                  const isExpanded = expandedId === entry.id;

                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        style={{ cursor: entry.meta ? 'pointer' : 'default' }}
                        onClick={() => entry.meta && setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <td className="muted text-sm">{idx + 1 + (pagination.page - 1) * pagination.limit}</td>
                        <td>
                          <div style={{ fontSize: 14 }}>
                            {new Date(entry.created_at).toLocaleDateString()}
                          </div>
                          <div className="muted text-xs">
                            {new Date(entry.created_at).toLocaleTimeString()}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon size={12} /> {formatType(entry.transaction_type)}
                          </span>
                        </td>
                        <td style={{ maxWidth: 400, fontSize: 14 }}>{entry.description}</td>
                        <td>
                          {entry.admin_name ? (
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 500 }}>{entry.admin_name}</div>
                              <div className="muted text-xs">
                                <span className={`badge badge-gray`} style={{ fontSize: 10, padding: '1px 6px' }}>
                                  {formatRole(entry.admin_role)}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="muted text-sm">{formatRole(entry.admin_role)}</span>
                          )}
                        </td>
                        <td>
                          {entry.meta && (
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : entry.id); }}
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {isExpanded && entry.meta && (
                        <tr key={`${entry.id}-detail`}>
                          <td colSpan={6} style={{ background: 'var(--cream-light)', padding: '12px 20px' }}>
                            <div style={{ fontSize: 13 }}>
                              <strong style={{ color: 'var(--navy)' }}>Metadata:</strong>
                              <pre style={{
                                marginTop: 8,
                                padding: '10px 14px',
                                background: 'var(--white)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                fontSize: 12,
                                fontFamily: "'Baloo 2', monospace",
                                overflowX: 'auto',
                                maxWidth: '100%',
                              }}>
                                {JSON.stringify(entry.meta, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Pagination ─── */}
        {pagination.totalPages > 1 && (
          <div className="flex between align-center" style={{ padding: '14px 0' }}>
            <button
              className="btn btn-outline btn-sm"
              disabled={pagination.page <= 1}
              onClick={() => goToPage(pagination.page - 1)}
            >
              <ArrowLeft size={14} /> Previous
            </button>
            <span className="muted text-sm">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className="btn btn-outline btn-sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => goToPage(pagination.page + 1)}
            >
              Next <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
