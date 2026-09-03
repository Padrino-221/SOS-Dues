import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { TrendUp, DownloadSimple, CalendarX, X } from '@phosphor-icons/react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const METHOD_COLORS = ['#1A2868', '#8B7D35', '#16a34a'];
const METHOD_LABELS = { cash: 'Cash', momo: 'Mobile Money', bank: 'Bank Transfer' };

function StatCard({ label, value, icon, variant }) {
  return (
    <div className="stat-card">
      <div className="stat-info">
        <div className="stat-label">{label}</div>
        <div className={`stat-value ${variant || ''}`}>{value}</div>
      </div>
      <div className={`stat-icon-badge ${variant || 'navy'}`}>{icon}</div>
    </div>
  );
}

function CollapsibleCard({ title, children, height, defaultOpen = false }) {
  return (
    <details className="card" open={defaultOpen}>
      <summary>
        <span className="caret">▶</span>
        <h3 style={{ display: 'inline' }}>{title}</h3>
      </summary>
      <div style={{ padding: '0 24px 24px' }}>
        {height ? (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        ) : children}
      </div>
    </details>
  );
}

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E3DA', borderRadius: 8,
      padding: '10px 14px', fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontWeight: 600, color: '#1A2868' }}>{d.name || d.payload?.method}</div>
      <div style={{ color: '#4B5563' }}>GHS {Number(d.value).toFixed(2)}</div>
      {d.payload?.count != null && <div style={{ color: '#6B7280', fontSize: 12 }}>{d.payload.count} transaction{d.payload.count !== 1 ? 's' : ''}</div>}
    </div>
  );
};

const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E3DA', borderRadius: 8,
      padding: '10px 14px', fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontWeight: 600, color: '#1A2868', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontSize: 13 }}>
          {p.name}: {typeof p.value === 'number' && p.value > 100 ? `GHS ${Number(p.value).toFixed(0)}` : p.value}
        </div>
      ))}
    </div>
  );
};

export default function Reports() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
  const [data, setData] = useState(null);
  const [charts, setCharts] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const buildParams = useCallback(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return params;
  }, [from, to]);

  const loadAll = useCallback(() => {
    const params = buildParams();
    setData(null);
    setCharts(null);
    setMonthly(null);
    api.get('/reports/summary', { params }).then((res) => setData(res.data)).catch(() => {});
    api.get('/reports/charts', { params }).then((res) => setCharts(res.data)).catch(() => {});
    api.get('/reports/monthly', { params }).then((res) => setMonthly(res.data)).catch(() => {});
  }, [buildParams]);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDates = () => { setFrom(''); setTo(''); };

  const downloadCsv = async () => {
    const params = buildParams();
    const res = await api.get('/reports/export', { params, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dues-report.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (!data) return <p>Loading...</p>;
  const t = data.totals;
  const hasDateFilter = from || to;

  // ── Chart data preparation ──
  const pieData = charts?.methods?.map((m) => ({
    name: METHOD_LABELS[m.method] || m.method,
    value: Number(m.total),
    count: m.count,
    method: m.method,
  })) || [];

  const clearanceData = charts?.clearance?.map((c) => ({
    name: c.department_name,
    'School Dues Paid': Number(c.school_dues_paid),
    'Dept Dues Paid': Number(c.dept_dues_paid),
    'Total Students': Number(c.total_students),
  })) || [];

  const methodTypeMap = {};
  (charts?.methodTypes || []).forEach((mt) => {
    if (!methodTypeMap[mt.method]) methodTypeMap[mt.method] = { method: METHOD_LABELS[mt.method] || mt.method };
    methodTypeMap[mt.method][mt.type === 'school_dues' ? 'School Dues' : 'Dept Dues'] = Number(mt.count);
  });
  const methodTypeData = Object.values(methodTypeMap);

  const souvenirData = charts?.souvenirs?.map((s) => ({
    name: s.name,
    Distributed: Number(s.distributed),
    category: s.category,
  })) || [];

  return (
    <div>
      <div className="flex between align-center mb-md">
        <div>
          <h1>Reports</h1>
          <p className="subtitle">
            {isSchool
              ? 'Detailed breakdowns of dues collection across the School.'
              : `Detailed breakdowns for ${user.department_name}.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={downloadCsv}><DownloadSimple size={18} /> Export CSV</button>
      </div>

      {/* ─── Date Range Filter ─── */}
      <div className="card">
        <div className="flex align-center gap-md" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-600)', fontWeight: 600, fontSize: 14 }}>
            <CalendarX size={18} />
            Date Range:
          </div>
          <div className="flex align-center gap-sm">
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12, marginBottom: 2 }}>From</label>
              <input
                type="date"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ width: 170, padding: '8px 12px', fontSize: 14 }}
              />
            </div>
            <span style={{ marginTop: 18, color: 'var(--gray-400)', fontWeight: 600 }}>—</span>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12, marginBottom: 2 }}>To</label>
              <input
                type="date"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ width: 170, padding: '8px 12px', fontSize: 14 }}
              />
            </div>
          </div>
          {hasDateFilter && (
            <button className="btn btn-outline btn-sm" onClick={clearDates} style={{ marginTop: 14 }}>
              <X size={14} /> Clear
            </button>
          )}
          {hasDateFilter && (
            <span className="badge badge-navy" style={{ marginTop: 14 }}>
              Filtered: {from || '...'} → {to || '...'}
            </span>
          )}
        </div>
      </div>

      {/* ─── Stat Cards ─── */}
      <div className="grid grid-3 mb-lg">
        <StatCard
          label={isSchool ? 'Total Dept Dues' : 'Department Dues'}
          value={`GHS ${Number(t.department_dues).toFixed(2)}`}
          icon={<TrendUp size={22} />}
          variant="navy"
        />
        {isSchool && t.school_dues !== undefined && (
          <StatCard
            label="Total School Dues"
            value={`GHS ${Number(t.school_dues).toFixed(2)}`}
            icon={<TrendUp size={22} />}
            variant="gold"
          />
        )}
        <StatCard
          label="Students Paid"
          value={t.students_paid}
          icon={<TrendUp size={22} />}
          variant="green"
        />
      </div>

      {/* ─── Payment Methods (Pie) ─── */}
      {pieData.length > 0 && (
        <CollapsibleCard title="Payment Methods" height={320}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={4} dataKey="value" animationBegin={0} animationDuration={1000}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomPieTooltip />} />
            <Legend formatter={(value) => <span style={{ color: '#374151', fontSize: 13 }}>{value}</span>} />
          </PieChart>
        </CollapsibleCard>
      )}

      {/* ─── Transactions by Method & Type ─── */}
      {methodTypeData.length > 0 && (
        <CollapsibleCard title="Transactions by Method & Type" height={320}>
          <BarChart data={methodTypeData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DA" />
            <XAxis dataKey="method" tick={{ fontSize: 13, fill: '#6B7280' }} />
            <YAxis tick={{ fontSize: 13, fill: '#6B7280' }} allowDecimals={false} />
            <Tooltip content={<CustomBarTooltip />} />
            <Legend formatter={(value) => <span style={{ color: '#374151', fontSize: 13 }}>{value}</span>} />
            <Bar dataKey="School Dues" fill="#8B7D35" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Dept Dues" fill="#1A2868" radius={[4, 4, 0, 0]} />
          </BarChart>
        </CollapsibleCard>
      )}

      {/* ─── Clearance Rates ─── */}
      {clearanceData.length > 0 && (
        <CollapsibleCard title={isSchool ? 'Clearance Rates by Department' : 'Your Department Clearance'} height={Math.max(280, clearanceData.length * 50 + 60)}>
          <BarChart data={clearanceData} layout="vertical" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DA" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 13, fill: '#6B7280' }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13, fill: '#6B7280' }} width={120} />
            <Tooltip content={<CustomBarTooltip />} />
            <Legend formatter={(value) => <span style={{ color: '#374151', fontSize: 13 }}>{value}</span>} />
            <Bar dataKey="School Dues Paid" fill="#8B7D35" radius={[0, 4, 4, 0]} />
            <Bar dataKey="Dept Dues Paid" fill="#1A2868" radius={[0, 4, 4, 0]} />
          </BarChart>
        </CollapsibleCard>
      )}

      {/* ─── Souvenir Distribution ─── */}
      {souvenirData.length > 0 && (
        <CollapsibleCard title="Souvenir Distribution" height={320}>
          <BarChart data={souvenirData} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DA" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 13, fill: '#6B7280' }} allowDecimals={false} />
            <Tooltip content={<CustomBarTooltip />} />
            <Bar dataKey="Distributed" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </CollapsibleCard>
      )}

      {/* ─── Monthly Trend ─── */}
      {monthly?.monthly?.length > 0 && (
        <CollapsibleCard title="Monthly Collection Trend" height={300}>
          <BarChart data={monthly.monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DA" />
            <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#6B7280' }} />
            <YAxis tick={{ fontSize: 13, fill: '#6B7280' }} />
            <Tooltip content={<CustomBarTooltip />} />
            <Legend formatter={(value) => <span style={{ color: '#374151', fontSize: 13 }}>{value}</span>} />
            {!monthly.is_dept && <Bar dataKey="school_dues" name="School Dues" fill="#8B7D35" radius={[4, 4, 0, 0]} />}
            <Bar dataKey="dept_dues" name="Dept Dues" fill="#1A2868" radius={[4, 4, 0, 0]} />
          </BarChart>
        </CollapsibleCard>
      )}

      {/* ─── Department Breakdown Table ─── */}
      <CollapsibleCard title={isSchool ? 'Department Dues Collection' : "Your Department's Dues Collection"}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Per-Student Dues</th>
                <th>Students</th>
                <th>Collected</th>
                <th>Collection %</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((d) => {
                const expected = Number(d.dues_amount) * Number(d.student_count);
                const pct = expected > 0 ? ((Number(d.amount_collected) / expected) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={d.id}>
                    <td className="fw-600">{d.name}</td>
                    <td>GHS {Number(d.dues_amount).toFixed(2)}</td>
                    <td>{d.student_count}</td>
                    <td>GHS {Number(d.amount_collected).toFixed(2)}</td>
                    <td>
                      <span className="flex align-center gap-sm">
                        <span style={{ width: 60, height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden', display: 'inline-block' }}>
                          <span style={{ display: 'block', height: '100%', width: `${Math.min(pct, 100)}%`, background: Number(pct) >= 50 ? 'var(--green)' : 'var(--gold)', borderRadius: 4 }} />
                        </span>
                        <span className="text-sm fw-600" style={{ color: Number(pct) >= 50 ? 'var(--green)' : 'var(--gold)' }}>{pct}%</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      {/* ─── Class Breakdown Table ─── */}
      <CollapsibleCard title={isSchool ? 'Class Collection Breakdown' : "Your Department's Class Breakdown"}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Department</th>
                <th>Collected</th>
                <th>Students Paid</th>
                <th>Total Students</th>
                <th>Payment %</th>
              </tr>
            </thead>
            <tbody>
              {data.classes.map((c) => {
                const pct = c.student_count > 0 ? ((c.paid_count / c.student_count) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={c.id}>
                    <td className="fw-600">{c.name}</td>
                    <td>{c.department_name}</td>
                    <td>GHS {Number(c.collected).toFixed(2)}</td>
                    <td>{c.paid_count}</td>
                    <td>{c.student_count}</td>
                    <td>
                      <span className="flex align-center gap-sm">
                        <span style={{ width: 60, height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden', display: 'inline-block' }}>
                          <span style={{ display: 'block', height: '100%', width: `${Math.min(pct, 100)}%`, background: Number(pct) >= 50 ? 'var(--green)' : 'var(--gold)', borderRadius: 4 }} />
                        </span>
                        <span className="text-sm fw-600" style={{ color: Number(pct) >= 50 ? 'var(--green)' : 'var(--gold)' }}>{pct}%</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>
    </div>
  );
}
