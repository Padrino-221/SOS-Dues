import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  DownloadSimple,
  X,
  Buildings,
  ChartBar,
  Funnel,
  Student,
  TrendUp,
} from '@phosphor-icons/react';
import DatePicker from '../components/ui/DatePicker';
import Select from '../components/ui/Select';
import Pagination from '../components/ui/Pagination';
import usePagination from '../components/ui/usePagination';

export default function Reports() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
  const [data, setData] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showUpdating, setShowUpdating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadSeq = useRef(0);
  const slowTimer = useRef(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const deptPager = usePagination(data?.departments || [], 10);

  const filteredClasses = useMemo(() => {
    const list = data?.classes || [];

    if (isSchool && selectedDeptId) {
      const deptObj = (data?.departments || []).find(
        (d) => String(d.id) === String(selectedDeptId) || String(d.name) === String(selectedDeptId)
      );
      const targetId = deptObj ? String(deptObj.id) : String(selectedDeptId);
      const targetName = deptObj ? String(deptObj.name).toLowerCase() : String(selectedDeptId).toLowerCase();
      return list.filter((c) => {
        const cDeptId = c.department_id ? String(c.department_id) : '';
        const cDeptName = c.department_name ? String(c.department_name).toLowerCase() : '';
        return (cDeptId && cDeptId === targetId) || (cDeptName && cDeptName === targetName);
      });
    }

    if (!isSchool && selectedLevel) {
      return list.filter((c) => String(c.level) === String(selectedLevel));
    }

    return list;
  }, [data?.classes, data?.departments, selectedDeptId, selectedLevel, isSchool]);

  const classPager = usePagination(filteredClasses, 10);

  const [academicYear, setAcademicYear] = useState('');
  const [activeAcademicYear, setActiveAcademicYear] = useState('');
  const buildParams = useCallback(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (academicYear) params.academic_year = academicYear;
    return params;
  }, [from, to, academicYear]);

  const loadAll = useCallback(async () => {
    const params = buildParams();
    const run = ++loadSeq.current;
    setRefreshing(true);
    setLoadError('');
    try {
      // Keep showing the current data while refetching (no page blink).
      const [s, m] = await Promise.all([
        api.get('/reports/summary', { params }),
        api.get('/reports/monthly', { params }),
      ]);
      if (run === loadSeq.current) {
        setData(s.data);
        setMonthly(m.data);
      }
    } catch (err) {
      setLoadError('Reports could not be updated. Check your connection and try again.');
    } finally {
      if (run === loadSeq.current) setRefreshing(false);
    }
  }, [buildParams]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    api
      .get('/settings')
      .then((res) => {
        const activeYear = res.data?.active_academic_year || '';
        setActiveAcademicYear(activeYear);
        setAcademicYear((current) => current || activeYear);
      })
      .catch(() => {});
  }, []);

  // Only surface the "Updating…" notice when a refresh is genuinely slow —
  // fast local refetches should swap data silently with no flicker.
  useEffect(() => {
    if (refreshing) {
      slowTimer.current = setTimeout(() => setShowUpdating(true), 350);
    } else {
      setShowUpdating(false);
    }
    return () => clearTimeout(slowTimer.current);
  }, [refreshing]);

  const clearDates = () => {
    setFrom('');
    setTo('');
    setAcademicYear('');
  };

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

  if (!data)
    return (
      <div className="page-state">
        <span className="spin-dot" /> {loadError || 'Loading reports…'}{' '}
        {loadError && (
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        )}
      </div>
    );
  const t = data.totals;
  const hasDateFilter = from || to || academicYear;

  const academicYearOptions = activeAcademicYear
    ? [{ value: activeAcademicYear, label: activeAcademicYear }]
    : [];

  const totalStudents = data.departments.reduce((s, d) => s + Number(d.student_count || 0), 0);
  const totalFreshers = data.departments.reduce((s, d) => s + Number(d.fresher_count || 0), 0);
  const pendingFreshers = data.departments.reduce(
    (s, d) => s + Number(d.pending_fresher_count || 0),
    0
  );

  return (
    <div className="reports-page">
      {loadError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {loadError}{' '}
          <button className="btn btn-outline btn-xs" onClick={loadAll}>
            Retry
          </button>
        </div>
      )}

      {showUpdating && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <span className="spin-dot" /> Updating…
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>{isSchool ? 'Reports' : 'Department Reports'}</h1>
          <p className="subtitle">
            {isSchool
              ? 'Collection overview across all departments.'
              : `Collection overview for ${user?.department_name}.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={downloadCsv}>
          <DownloadSimple size={18} /> Export CSV
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="flex gap align-center" style={{ flexWrap: 'wrap' }}>
          <Funnel size={16} style={{ color: 'var(--gold)' }} />
          <div className="field" style={{ marginBottom: 0, width: 180 }}>
            <Select
              value={academicYear}
              onChange={setAcademicYear}
              options={[{ value: '', label: 'All academic years' }, ...academicYearOptions]}
              placeholder="All years"
            />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 155 }}>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <span style={{ color: 'var(--gray-400)', fontWeight: 700, fontSize: 11 }}>to</span>
          <div className="field" style={{ marginBottom: 0, width: 155 }}>
            <DatePicker value={to} onChange={setTo} />
          </div>
          {hasDateFilter && (
            <button className="btn btn-ghost btn-sm" onClick={clearDates}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ─── Monthly Summary ─── */}
      {monthly && monthly.monthly?.length > 0 && (
        <div className="rc-stats">
          <div className="rc-stat-card rc-stat-card--navy">
            <div className="rc-stat-icon"><ChartBar size={20} /></div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS {monthly.monthly.reduce((s, m) => s + Number(m.dept_dues || 0), 0).toFixed(2)}
              </div>
              <div className="rc-stat-label">Dept Dues</div>
            </div>
          </div>
          <div className="rc-stat-card rc-stat-card--gold">
            <div className="rc-stat-icon"><ChartBar size={20} /></div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS {monthly.monthly.reduce((s, m) => s + Number(m.school_dues || 0), 0).toFixed(2)}
              </div>
              <div className="rc-stat-label">School Dues</div>
            </div>
          </div>
          <div className="rc-stat-card rc-stat-card--green">
            <div className="rc-stat-icon"><TrendUp size={20} /></div>
            <div className="rc-stat-body">
              <div className="rc-stat-value">
                GHS {monthly.monthly.reduce((s, m) => s + Number(m.dept_dues || 0) + Number(m.school_dues || 0), 0).toFixed(2)}
              </div>
              <div className="rc-stat-label">Total Collected</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Department Breakdown ─── */}
      <div className="card">
        <div className="card-header">
          <h3>
            <Buildings size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            {isSchool ? 'Dues by Department' : 'Department Detail'}
          </h3>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Per-Student Dues</th>
                <th>Students</th>
                <th>Freshers (pending / admitted)</th>
                <th>Dept Dues Collected</th>
                <th>School Dues Via Dept</th>
              </tr>
            </thead>
            <tbody>
              {deptPager.slice.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No departments yet.</td>
                </tr>
              )}
              {deptPager.slice.map((d) => (
                <tr key={d.id}>
                  <td className="fw-600">{d.name}</td>
                  <td>GHS {Number(d.dues_amount).toFixed(2)}</td>
                  <td>{d.student_count}</td>
                  <td>
                    {d.fresher_count} ({d.pending_fresher_count} pending / {d.admitted_fresher_count} admitted)
                  </td>
                  <td className="fw-600">
                    GHS {Number(d.department_dues_collected || 0).toFixed(2)}
                  </td>
                  <td>GHS {Number(d.school_dues_through_dept || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={deptPager.page}
          totalPages={deptPager.totalPages}
          onPageChange={deptPager.setPage}
          totalItems={deptPager.totalItems}
          pageSize={deptPager.perPage}
        />
      </div>

      {/* ─── Class Breakdown ─── */}
      <div className="card">
        <div className="card-header flex align-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h3>
            <Student size={16} style={{ marginRight: 6, color: 'var(--gold)' }} />
            Class / Level Breakdown
          </h3>
          {isSchool && data?.departments?.length > 0 && (
            <div className="flex align-center gap-sm" style={{ width: 220 }}>
              <Funnel size={14} style={{ color: 'var(--text-muted)' }} />
              <div style={{ flex: 1 }}>
                <Select
                  value={selectedDeptId}
                  onChange={(val) => {
                    setSelectedDeptId(val);
                    classPager.setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All departments' },
                    ...(data?.departments || []).map((d) => ({
                      value: String(d.id),
                      label: d.name,
                    })),
                  ]}
                  placeholder="All departments"
                />
              </div>
            </div>
          )}
          {!isSchool && (
            <div className="flex align-center gap-sm" style={{ width: 180 }}>
              <Funnel size={14} style={{ color: 'var(--text-muted)' }} />
              <div style={{ flex: 1 }}>
                <Select
                  value={selectedLevel}
                  onChange={(val) => {
                    setSelectedLevel(val);
                    classPager.setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All levels' },
                    ...Array.from(new Set((data?.classes || []).map((c) => c.level).filter(Boolean)))
                      .sort()
                      .map((l) => ({ value: String(l), label: `Level ${l}` })),
                  ]}
                  placeholder="All levels"
                />
              </div>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Class / Level</th>
                <th>Department</th>
                <th>Students</th>
                <th>Paid Dept Dues</th>
                <th>Dept Dues Collected</th>
                <th>Payment %</th>
              </tr>
            </thead>
            <tbody>
              {classPager.slice.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {isSchool && selectedDeptId
                      ? 'No classes found for the selected department.'
                      : !isSchool && selectedLevel
                        ? 'No classes found for the selected level.'
                        : 'No classes yet.'}
                  </td>
                </tr>
              )}
              {classPager.slice.map((c) => {
                const pct =
                  c.student_count > 0
                    ? (Number(c.paid_students) / Number(c.student_count)) * 100
                    : 0;
                return (
                  <tr key={c.id}>
                    <td className="fw-600">{c.name}</td>
                    <td>{c.department_name}</td>
                    <td>{c.student_count}</td>
                    <td>{c.paid_students}</td>
                    <td>GHS {Number(c.dept_dues_collected || 0).toFixed(2)}</td>
                    <td>
                      <span className="flex align-center gap-sm">
                        <span
                          style={{
                            width: 60,
                            height: 8,
                            background: 'var(--gray-100)',
                            borderRadius: 4,
                            overflow: 'hidden',
                            display: 'inline-block',
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              height: '100%',
                              width: `${Math.min(pct, 100)}%`,
                              background: pct >= 50 ? 'var(--green)' : 'var(--gold)',
                              borderRadius: 4,
                            }}
                          />
                        </span>
                        <span
                          className="text-sm fw-600"
                          style={{ color: pct >= 50 ? 'var(--green)' : 'var(--gold)' }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={classPager.page}
          totalPages={classPager.totalPages}
          onPageChange={classPager.setPage}
          totalItems={classPager.totalItems}
          pageSize={classPager.perPage}
        />
      </div>
    </div>
  );
}
