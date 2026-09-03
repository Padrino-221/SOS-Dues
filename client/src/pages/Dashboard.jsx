import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  CurrencyCircleDollar,
  Users,
  TrendUp,
  Warning,
  Clock,
  ShieldCheck,
} from '@phosphor-icons/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';

  useEffect(() => {
    api.get('/reports/summary').then((res) => setData(res.data)).catch(() => {});
    api.get('/payments').then((res) => setPayments(res.data.slice(0, 5))).catch(() => {});
    api.get('/reports/monthly').then((res) => setMonthly(res.data.monthly || [])).catch(() => {});
  }, []);

  if (!data) return <p>Loading...</p>;
  const t = data.totals;

  const unpaidDepts = data.departments.filter((d) => {
    const pct = d.student_count > 0
      ? Math.round((Number(d.amount_collected) / (Number(d.student_count) * Number(d.dues_amount))) * 100)
      : 0;
    return pct < 50;
  });

  return (
    <div>
      {/* ─── Stats Row ─── */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon-badge navy"><CurrencyCircleDollar size={26} /></div>
          <div className="stat-info">
            <div className="stat-label">{isSchool ? 'Total Dept Dues Collected' : 'Department Dues Collected'}</div>
            <div className="stat-value">GHS {Number(t.department_dues).toFixed(2)}</div>
            <div className="stat-trend"><TrendUp size={14} /> across {data.departments.length} department{data.departments.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        {isSchool && (
          <div className="stat-card">
            <div className="stat-icon-badge gold"><CurrencyCircleDollar size={26} /></div>
            <div className="stat-info">
              <div className="stat-label">School Dues Collected</div>
              <div className="stat-value gold">GHS {Number(t.school_dues).toFixed(2)}</div>
              <div className="stat-trend"><TrendUp size={14} /> from registered students</div>
            </div>
          </div>
        )}

        <div className="stat-card">
          <div className="stat-icon-badge green"><Users size={26} /></div>
          <div className="stat-info">
            <div className="stat-label">Students Paid</div>
            <div className="stat-value">{t.students_paid}</div>
            <div className="stat-trend"><TrendUp size={14} /> {isSchool ? 'dept dues recorded' : 'in your department'}</div>
          </div>
        </div>
      </div>

      {/* ─── Alert Banner for Dept Admin ─── */}
      {!isSchool && (
        <div className="alert alert-info" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} />
          <span>
            You are logged in as <strong>Department Admin</strong> for <strong>{user.department_name}</strong>.
            You can configure your department's dues and souvenirs under <a href="/admin/settings">Settings</a>.
          </span>
        </div>
      )}

      <div className="grid grid-2 mb-lg">
        {/* ─── Needs Attention ─── */}
        <div className="card">
          <div className="card-header">
            <h3><Warning size={18} style={{ marginRight: 8, verticalAlign: -3 }} />Needs Attention</h3>
          </div>
          {unpaidDepts.length === 0 ? (
            <p className="muted text-sm">{isSchool ? 'All departments are above 50% collection. Great job!' : 'Your department is above 50% collection. Great job!'}</p>
          ) : (
            unpaidDepts.map((d) => {
              const pct = Math.round((Number(d.amount_collected) / (Number(d.student_count) * Number(d.dues_amount))) * 100);
              return (
                <div key={d.id} className="activity-item">
                  <div className="activity-dot red"></div>
                  <div className="activity-text">
                    <strong>{d.name}</strong> — {pct}% collected ({d.student_count} students)
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ─── Recent Payments ─── */}
        <div className="card">
          <div className="card-header">
            <h3><Clock size={18} style={{ marginRight: 8, verticalAlign: -3 }} />Recent Payments</h3>
          </div>
          {payments.length === 0 ? (
            <p className="muted text-sm">No payments recorded yet.</p>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="activity-item">
                <div className={`activity-dot ${p.type === 'school_dues' ? 'navy' : 'green'}`}></div>
                <div className="activity-text">
                  {p.student_name} — GHS {Number(p.amount).toFixed(2)}
                  <span className="muted text-xs" style={{ marginLeft: 6 }}>
                    {p.type === 'school_dues' ? 'School' : 'Dept'} · {new Date(p.paid_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── Monthly Collection Flow Chart ─── */}
      <h3 className="mb">{isSchool ? 'Monthly Collection Flow' : 'Your Monthly Collection Flow'}</h3>
      <div className="card">
        {monthly.length === 0 ? (
          <p className="muted text-sm" style={{ padding: 20, textAlign: 'center' }}>
            No payment data available yet. Collections will appear here as payments are recorded.
          </p>
        ) : (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <AreaChart data={monthly} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradDept" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1A2868" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#1A2868" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradSchool" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B7D35" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8B7D35" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DA" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  axisLine={{ stroke: '#E5E3DA' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #E5E3DA',
                    fontFamily: 'Baloo 2',
                    fontSize: 14,
                  }}
                  formatter={(value, name) => [
                    `GHS ${Number(value).toFixed(2)}`,
                    name === 'dept_dues' ? 'Dept Dues' : 'School Dues',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="dept_dues"
                  stroke="#1A2868"
                  strokeWidth={2.5}
                  fill="url(#gradDept)"
                  name="dept_dues"
                  dot={{ r: 4, fill: '#1A2868', strokeWidth: 0 }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                  animationDuration={1200}
                />
                {isSchool && (
                  <Area
                    type="monotone"
                    dataKey="school_dues"
                    stroke="#8B7D35"
                    strokeWidth={2.5}
                    fill="url(#gradSchool)"
                    name="school_dues"
                    dot={{ r: 4, fill: '#8B7D35', strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                    animationDuration={1200}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend */}
        {monthly.length > 0 && (
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#1A2868' }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: '#1A2868', display: 'inline-block' }} />
              Dept Dues
            </div>
            {isSchool && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#8B7D35' }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: '#8B7D35', display: 'inline-block' }} />
                School Dues
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
