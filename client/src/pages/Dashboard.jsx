import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { asArray } from '../utils/asArray';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../realtime';
import {
  IconCurrencyDollar as CurrencyCircleDollar,
  IconUsers as Users,
  IconTrendingUp as TrendUp,
  IconAlertTriangle as Warning,
  IconClock as Clock,
  IconShieldCheck as ShieldCheck,
  IconBackpack as Student,
  IconReceipt as Receipt,
  IconArrowUpRight as ArrowUpRight,
  IconUserPlus as UserPlus,
  IconBuildings as Buildings,
} from '@tabler/icons-react';

// The institution runs on Africa/Accra (GMT+0, no DST). Formatting from that
// zone keeps the displayed day identical on every device, instead of sliding
// a day either way on non-GMT machines.
const ACCRA_TZ = 'Africa/Accra';

function formatShortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { timeZone: ACCRA_TZ });
}

// Greeting follows the time of day instead of always saying "Good morning".
function greetingFor() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [loadError, setLoadError] = useState('');
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const isSchool = user?.role === 'school_admin' || isSuper;
  const greeting = greetingFor();

  const loadAll = useCallback(() => {
    setLoadError('');
    api
      .get('/reports/summary')
      .then((res) => setData(res.data))
      .catch(() => setLoadError('Dashboard data could not be loaded.'));
    api
      .get('/receipts', { params: { limit: 5 } })
      .then((res) => {
        const data = res.data || {};
        // Tolerate a plain array (older server) while preferring the
        // { receipts, total, page, pageSize } contract.
        setReceipts(Array.isArray(data) ? data : data.receipts || []);
      })
      .catch(() => setLoadError('Some dashboard data could not be loaded.'));
    api
      .get('/reports/monthly')
      .then((res) => setMonthly(Array.isArray(res.data?.monthly) ? res.data.monthly : []))
      .catch(() => setLoadError('Some dashboard data could not be loaded.'));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live updates: any payment (including a void), fresher movement or student
  // change refreshes the figures in place (no page reload, no flash).
  useRealtime({
    'payment:new': loadAll,
    'payment:voided': loadAll,
    'fresher:registered': loadAll,
    'fresher:verified': loadAll,
    'fresher:admitted': loadAll,
    'student:changed': loadAll,
  });

  if (!data)
    return (
      <div className="page-state">
        <span className="spin-dot" /> {loadError || 'Loading dashboard…'}{' '}
        {loadError && (
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        )}
      </div>
    );

  const t = data.totals || {};
  const depts = asArray(data.departments);
  const myDept = !isSchool ? depts[0] : null;
  const pendingFreshers = isSchool
    ? depts.reduce((s, d) => s + Number(d.pending_fresher_count || 0), 0)
    : Number(myDept?.pending_fresher_count || 0);

  const statCards = isSchool
    ? [
        // The super admin oversees both sides — dept money is back on their cards.
        ...(isSuper
          ? [
              {
                label: 'Dept Dues Collected',
                value: `GHS ${Number(t.department_dues).toFixed(2)}`,
                sub: `across ${depts.length} departments`,
                icon: <CurrencyCircleDollar size={26} />,
                cls: 'navy',
              },
            ]
          : []),
        {
          label: 'School Dues Collected',
          value: `GHS ${Number(t.school_dues).toFixed(2)}`,
          sub: 'school-wide dues',
          icon: <CurrencyCircleDollar size={26} />,
          cls: 'gold',
        },
        {
          label: 'School Other Dues',
          value: `GHS ${Number(t.school_other_dues || 0).toFixed(2)}`,
          sub: 'school-wide extra items',
          icon: <CurrencyCircleDollar size={26} />,
          cls: 'violet',
        },
        ...(isSuper
          ? [
              {
                label: 'Department Other Dues',
                value: `GHS ${Number(t.dept_other_dues || 0).toFixed(2)}`,
                sub: 'department extra items',
                icon: <CurrencyCircleDollar size={26} />,
                cls: 'violet',
              },
            ]
          : []),
        {
          label: 'Pending Fresher Admissions',
          value: pendingFreshers,
          sub: 'waiting for departments',
          icon: <Student size={26} />,
          cls: 'green',
        },
      ]
    : [
        // Department dashboard: only the department's own money — school dues
        // and school-wide items stay on the Reports page, not on these cards.
        {
          label: 'Department Dues',
          value: `GHS ${Number(myDept?.department_dues_collected || 0).toFixed(2)}`,
          sub: `${user?.department_name} collections`,
          icon: <CurrencyCircleDollar size={26} />,
          cls: 'navy',
        },
        {
          label: 'Department Other Dues',
          value: `GHS ${Number(t.dept_other_dues || 0).toFixed(2)}`,
          sub: 'your items from freshers',
          icon: <CurrencyCircleDollar size={26} />,
          cls: 'violet',
        },
        {
          label: 'Freshers Awaiting Admission',
          value: pendingFreshers,
          sub: 'assigned to your department',
          icon: <Student size={26} />,
          cls: 'green',
        },
      ];

  return (
    <div className={`dashboard-page ${isSchool ? 'dashboard-school' : 'dashboard-department'}`}>
      {loadError && (
        <div className="alert alert-error dashboard-alert">
          {loadError}{' '}
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        </div>
      )}
      <div className="dashboard-hero">
        <div>
          <div className="dashboard-eyebrow">
            <span className="dashboard-eyebrow-dot" />{' '}
            {isSchool ? 'School operations' : 'Department operations'}
          </div>
          <h1>
            {greeting}, {user?.name || (isSchool ? 'school admin' : 'there')}.
          </h1>
          <p className="subtitle">
            {isSchool
              ? 'A quick read on collections, student movement, and departments that need attention.'
              : 'Keep your department’s collections and fresher admissions moving.'}
          </p>
        </div>
        <div className="dashboard-hero-actions">
          <span className="dashboard-date">
            <Clock size={15} /> Live overview
          </span>
          <a className="btn btn-primary" href={isSchool ? '/admin/freshers' : '/admin/collect'}>
            {isSchool ? (
              <>
                <UserPlus size={17} /> View freshers
              </>
            ) : (
              <>
                <CurrencyCircleDollar size={17} /> Collect dues
              </>
            )}
          </a>
        </div>
      </div>

      {/* ─── Stats Row ─── */}
      <div className="dashboard-stats">
        {statCards.map((s) => (
          <div key={s.label} className={`dashboard-stat ${s.cls}`}>
            <div className="dashboard-stat-top">
              <span>{s.label}</span>
              <span className="dashboard-stat-icon">{s.icon}</span>
            </div>
            <div className="dashboard-stat-value">{s.value}</div>
            <div className="dashboard-stat-sub">
              <TrendUp size={14} /> {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ─── Alert banners ─── */}
      {!isSchool && pendingFreshers > 0 && (
        <div className="dashboard-alert alert alert-info">
          <ShieldCheck size={20} />
          <span>
            <strong>{pendingFreshers}</strong> fresher(s) assigned by the School are waiting to be
            admitted. <a href="/admin/freshers">Go to Admit Freshers →</a>
          </span>
        </div>
      )}
      {isSchool && pendingFreshers > 0 && (
        <div className="dashboard-alert alert alert-info">
          <Warning size={20} />
          <span>
            <strong>{pendingFreshers}</strong> registered fresher(s) have not been admitted by their
            departments yet. <a href="/admin/freshers">View freshers →</a>
          </span>
        </div>
      )}

      <div className="dashboard-content-grid mb-lg">
        {/* ─── Needs Attention ─── */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <span className="dashboard-panel-kicker">Needs attention</span>
              <h2>{isSchool ? 'Admission queue' : 'Your collection pulse'}</h2>
            </div>
            <span className="dashboard-panel-icon amber">
              <Warning size={19} />
            </span>
          </div>
          {isSchool ? (
            depts.filter((d) => Number(d.pending_fresher_count) > 0).length === 0 ? (
              <p className="muted text-sm">
                All registered freshers have been admitted. Great job!
              </p>
            ) : (
              depts
                .filter((d) => Number(d.pending_fresher_count) > 0)
                .map((d) => (
                  <div key={d.id} className="dashboard-queue-row">
                    <span className="dashboard-queue-mark">
                      <Buildings size={16} />
                    </span>
                    <span>
                      <strong>{d.name}</strong>
                      <small>{d.pending_fresher_count} fresher(s) pending admission</small>
                    </span>
                    <ArrowUpRight size={16} />
                  </div>
                ))
            )
          ) : (
            <>
              <div className="dashboard-pulse">
                <div className="dashboard-pulse-ring">
                  <Users size={23} />
                </div>
                <div>
                  <strong>{myDept?.payers || 0} distinct payer(s)</strong>
                  <span>
                    {myDept?.receipt_count || 0} receipts · {myDept?.fresher_count || 0} freshers ·{' '}
                    {myDept?.admitted_fresher_count || 0} admitted
                  </span>
                </div>
              </div>
              <p className="dashboard-panel-foot muted text-sm">
                Department dues collected{' '}
                <strong>GHS {Number(myDept?.department_dues_collected || 0).toFixed(2)}</strong>
              </p>
            </>
          )}
        </div>

        {/* ─── Recent Receipts ─── */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <span className="dashboard-panel-kicker">Latest activity</span>
              <h2>Recent receipts</h2>
            </div>
            <span className="dashboard-panel-icon green">
              <Receipt size={19} />
            </span>
          </div>
          {receipts.length === 0 ? (
            <p className="muted text-sm">No receipts recorded yet.</p>
          ) : (
            receipts.map((r) => (
              <div key={r.id} className="dashboard-receipt-row">
                <span className="dashboard-receipt-mark">
                  <Receipt size={15} />
                </span>
                <span>
                  <strong>{r.student_name}</strong>
                  <small>
                    {r.receipt_number} · {r.method === 'momo' ? 'Mobile Money' : r.method} ·{' '}
                    {formatShortDate(r.paid_at)}
                  </small>
                </span>
                <b>GHS {Number(r.total_amount).toFixed(2)}</b>
              </div>
            ))
          )}
          <a href="/admin/receipts" className="dashboard-panel-link">
            View all receipts <ArrowUpRight size={15} />
          </a>
        </div>
      </div>

      {/* ─── Monthly collection ledger — redesigned ─── */}
      <div className="dashboard-chart-head">
        <div>
          <span className="dashboard-panel-kicker">Collection rhythm</span>
          <h2>{isSchool ? 'Monthly collection ledger' : 'Your monthly collection'}</h2>
        </div>
        <span className="dashboard-chart-note">
          <TrendUp size={15} /> Updated live
        </span>
      </div>
      <div className="dashboard-chart-panel rhythm-panel">
        <RhythmChart monthly={monthly} />
      </div>
    </div>
  );
}

function RhythmChart({ monthly }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  if (!monthly || monthly.length === 0) {
    return (
      <div className="rhythm-empty">
        <span className="rhythm-empty-icon">
          <TrendUp size={22} />
        </span>
        <strong>No collections yet</strong>
        <span>Once dues are recorded, your 6-month trend will appear here.</span>
      </div>
    );
  }

  const months = monthly.slice(-6);
  const totals = months.map(
    (m) => Number(m.dept_dues || 0) + Number(m.school_dues || 0) + Number(m.other_dues || 0)
  );
  const deptVals = months.map((m) => Number(m.dept_dues || 0));
  const schoolVals = months.map((m) => Number(m.school_dues || 0));
  const otherVals = months.map((m) => Number(m.other_dues || 0));

  const maxVal = Math.max(...deptVals, ...schoolVals, ...otherVals, ...totals, 100);
  const roundedMax = Math.ceil(maxVal / 400) * 400 || 1000;
  const total6 = totals.reduce((a, b) => a + b, 0);
  const avg = total6 / Math.max(months.length, 1);
  const peak = Math.max(...totals, 0);
  const peakLabel = months[totals.indexOf(peak)]?.label || '';
  const last = totals[totals.length - 1] || 0;
  const prev = totals[totals.length - 2] || 0;
  const change = prev > 0 ? ((last - prev) / prev) * 100 : 0;

  const W = 660;
  const H = 210;
  const padL = 48;
  const padR = 24;
  const padT = 30;
  const padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = months.length;

  const yFor = (v) => padT + chartH - (v / roundedMax) * chartH;
  const ticks = [0, roundedMax * 0.25, roundedMax * 0.5, roundedMax * 0.75, roundedMax];

  const hoveredMonth = hoveredIdx !== null ? months[hoveredIdx] : null;
  const hoveredTotal = hoveredIdx !== null ? totals[hoveredIdx] : null;
  const hoveredDept = hoveredIdx !== null ? deptVals[hoveredIdx] : null;
  const hoveredSchool = hoveredIdx !== null ? schoolVals[hoveredIdx] : null;
  const hoveredOther = hoveredIdx !== null ? otherVals[hoveredIdx] : null;

  // Points & coordinates for Department, School and Other Dues series
  const ptsDept = months.map((m, i) => ({
    x: n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW,
    y: yFor(deptVals[i]),
    val: deptVals[i],
    m,
    i,
  }));

  const ptsSchool = months.map((m, i) => ({
    x: n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW,
    y: yFor(schoolVals[i]),
    val: schoolVals[i],
    m,
    i,
  }));

  const ptsOther = months.map((m, i) => ({
    x: n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW,
    y: yFor(otherVals[i]),
    val: otherVals[i],
    m,
    i,
  }));

  const lineDeptD = n > 1 ? ptsDept.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const lineSchoolD = n > 1 ? ptsSchool.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const lineOtherD = n > 1 ? ptsOther.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';

  const areaDeptD =
    n > 1
      ? lineDeptD + ` L ${ptsDept[n - 1].x} ${padT + chartH} L ${ptsDept[0].x} ${padT + chartH} Z`
      : '';
  const areaSchoolD =
    n > 1
      ? lineSchoolD + ` L ${ptsSchool[n - 1].x} ${padT + chartH} L ${ptsSchool[0].x} ${padT + chartH} Z`
      : '';
  const areaOtherD =
    n > 1
      ? lineOtherD + ` L ${ptsOther[n - 1].x} ${padT + chartH} L ${ptsOther[0].x} ${padT + chartH} Z`
      : '';

  return (
    <>
      {/* Summary Metrics Bar */}
      <div className="rhythm-top-bar">
        <div className="rhythm-summary">
          <div>
            <span>6-month total</span>
            <strong>GHS {total6.toFixed(2)}</strong>
          </div>
          <div>
            <span>Monthly avg</span>
            <strong>GHS {avg.toFixed(2)}</strong>
          </div>
          <div>
            <span>Peak month</span>
            <strong>
              {peakLabel} <small>· GHS {peak.toFixed(2)}</small>
            </strong>
          </div>
          <div className="rhythm-change">
            <span>Last vs prev</span>
            <strong className={change >= 0 ? 'up' : 'down'}>
              {change === 0 && prev === 0
                ? '—'
                : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
            </strong>
          </div>
        </div>
      </div>

      {/* Dual Drop-Line Trend Chart (Department Dues = Navy, School Dues = Gold) */}
      <div className="rhythm-area-wrap relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="rhythm-area-svg" role="img">
          <defs>
            <linearGradient id="deptFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d2a5e" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#1d2a5e" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="schoolFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b5852b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#b5852b" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="otherFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6d3fc0" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#6d3fc0" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y Axis */}
          {ticks.map((t) => {
            const y = yFor(t);
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="#e6e2d8"
                  strokeWidth="1"
                />
                <text
                  x={padL - 12}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="600"
                  fill="#9b9587"
                >
                  {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k` : t}
                </text>
              </g>
            );
          })}

          {/* Vertical Drop Lines for each month */}
          {ptsDept.map((p) => (
            <line
              key={`dropline-${p.i}`}
              x1={p.x}
              y1={padT + chartH}
              x2={p.x}
              y2={Math.min(ptsDept[p.i].y, ptsSchool[p.i].y, ptsOther[p.i].y)}
              stroke="#d6d0c1"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ))}

          {/* Area Fills */}
          {n > 1 && <path d={areaDeptD} fill="url(#deptFillGrad)" />}
          {n > 1 && <path d={areaSchoolD} fill="url(#schoolFillGrad)" />}
          {n > 1 && <path d={areaOtherD} fill="url(#otherFillGrad)" />}

          {/* Department Dues Polyline (Navy #1d2a5e) */}
          {n > 1 && (
            <path
              d={lineDeptD}
              fill="none"
              stroke="#1d2a5e"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* School Dues Polyline (Gold #b5852b) */}
          {n > 1 && (
            <path
              d={lineSchoolD}
              fill="none"
              stroke="#b5852b"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Other Dues Polyline (Violet #6d3fc0) */}
          {n > 1 && (
            <path
              d={lineOtherD}
              fill="none"
              stroke="#6d3fc0"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive Hover Hit Regions & Node Dots */}
          {months.map((m, i) => {
            const pDept = ptsDept[i];
            const pSchool = ptsSchool[i];
            const pOther = ptsOther[i];
            const isHovered = hoveredIdx === i;

            return (
              <g
                key={m.month}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Hit area spanning vertical height */}
                <rect
                  x={pDept.x - 24}
                  y={padT}
                  width="48"
                  height={chartH + padB}
                  fill="transparent"
                />

                {/* Outer halo on hover */}
                {isHovered && (
                  <>
                    <circle cx={pDept.x} cy={pDept.y} r="11" fill="#1d2a5e" opacity="0.14" />
                    <circle cx={pSchool.x} cy={pSchool.y} r="11" fill="#b5852b" opacity="0.14" />
                    <circle cx={pOther.x} cy={pOther.y} r="11" fill="#6d3fc0" opacity="0.14" />
                  </>
                )}

                {/* Department Dues Ring Node (Navy) */}
                <circle
                  cx={pDept.x}
                  cy={pDept.y}
                  r={isHovered ? 7.5 : 6}
                  fill="#1d2a5e"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                />
                <circle cx={pDept.x} cy={pDept.y} r="2.5" fill="#ffffff" />

                {/* School Dues Ring Node (Gold) */}
                <circle
                  cx={pSchool.x}
                  cy={pSchool.y}
                  r={isHovered ? 7.5 : 6}
                  fill="#b5852b"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                />
                <circle cx={pSchool.x} cy={pSchool.y} r="2.5" fill="#ffffff" />

                {/* Other Dues Ring Node (Violet) */}
                <circle
                  cx={pOther.x}
                  cy={pOther.y}
                  r={isHovered ? 7.5 : 6}
                  fill="#6d3fc0"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                />
                <circle cx={pOther.x} cy={pOther.y} r="2.5" fill="#ffffff" />

                {/* Single Month overhead total pill */}
                {n === 1 && (
                  <g transform={`translate(${pDept.x}, ${Math.min(pDept.y, pSchool.y, pOther.y) - 14})`}>
                    <rect
                      x="-65"
                      y="-11"
                      width="130"
                      height="22"
                      rx="11"
                      fill="#1d2a5e"
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="800"
                      fill="#ffffff"
                    >
                      {m.label}: GHS {totals[0].toFixed(2)}
                    </text>
                  </g>
                )}

                {/* X Axis Month Label */}
                <text
                  x={pDept.x}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isHovered ? '800' : '600'}
                  fill={isHovered ? '#1d2a5e' : '#66665f'}
                >
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredMonth && (
          <div className="rhythm-tooltip-box">
            <div className="rhythm-tooltip-head">{hoveredMonth.label}</div>
            <div className="rhythm-tooltip-row">
              <span className="dot dept"></span>
              <span>Department Dues:</span>
              <strong>GHS {hoveredDept.toFixed(2)}</strong>
            </div>
            <div className="rhythm-tooltip-row">
              <span className="dot school"></span>
              <span>School Dues:</span>
              <strong>GHS {hoveredSchool.toFixed(2)}</strong>
            </div>
            <div className="rhythm-tooltip-row">
              <span className="dot other"></span>
              <span>Other Dues:</span>
              <strong>GHS {hoveredOther.toFixed(2)}</strong>
            </div>
            <div className="rhythm-tooltip-row total">
              <span>Total Collection:</span>
              <strong>GHS {hoveredTotal.toFixed(2)}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="rhythm-legend">
        <span>
          <i className="dot dept" /> Department dues
        </span>
        <span>
          <i className="dot school" /> School dues
        </span>
        <span>
          <i className="dot other" /> Other dues
        </span>
        <span className="rhythm-legend-total">
          All amounts in GHS — Separate Dept & School trends
        </span>
      </div>
    </>
  );
}
