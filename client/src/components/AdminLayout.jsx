import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  House,
  UserPlus,
  Users,
  HandCoins,
  Receipt,
  CheckCircle,
  ChartBar,
  Gear,
  Clock,
  GraduationCap,
  List,
  SignOut,
} from '@phosphor-icons/react';

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSchool = user?.role === 'school_admin';
  const isSchoolStaff = user?.role === 'school_staff';
  const isDeptStaff = user?.role === 'dept_staff';
  const isAnySchool = isSchool || isSchoolStaff;
  const [drawer, setDrawer] = useState(false);

  const nav = isSchoolStaff
    ? [
        { to: '/admin/freshers', label: 'Register Freshers', Icon: UserPlus },
        { to: '/admin/students', label: 'All Students', Icon: Users },
        { to: '/admin/verify', label: 'Verify Receipt', Icon: CheckCircle },
      ]
    : isDeptStaff
      ? [
          { to: '/admin/freshers', label: 'Admit Freshers', Icon: UserPlus },
          { to: '/admin/students', label: 'Students', Icon: Users },
          { to: '/admin/receipts', label: 'Receipts', Icon: Receipt },
          { to: '/admin/verify', label: 'Verify Receipt', Icon: CheckCircle },
        ]
      : [
          { to: '/admin', label: 'Dashboard', end: true, Icon: House },
          {
            to: '/admin/freshers',
            label: isAnySchool ? 'Register Freshers' : 'Admit Freshers',
            Icon: UserPlus,
          },
          {
            to: '/admin/students',
            label: isAnySchool ? 'All Students' : 'Students',
            Icon: Users,
          },
          ...(isAnySchool ? [] : [{ to: '/admin/collect', label: 'Collect Dues', Icon: HandCoins }]),
          { to: '/admin/receipts', label: 'Receipts', Icon: Receipt },
          { to: '/admin/verify', label: 'Verify Receipt', Icon: CheckCircle },
          { to: '/admin/reports', label: 'Reports', Icon: ChartBar },
          { to: '/admin/settings', label: 'Settings', Icon: Gear },
          ...(isSchool ? [{ to: '/admin/audit', label: 'Audit Log', Icon: Clock }] : []),
        ];

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '??';

  const roleLabel = isSchool
    ? 'School Admin'
    : isSchoolStaff
      ? 'School Staff'
      : isDeptStaff
        ? user?.department_name
          ? `Dept Staff · ${user.department_name}`
          : 'Dept Staff'
        : user?.department_name
          ? `Dept Admin · ${user.department_name}`
          : 'Dept Admin';

  const doLogout = () => {
    logout();
    navigate('/');
  };

  const closeDrawer = () => setDrawer(false);

  const navItems = nav.map(({ to, label, end, Icon }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={closeDrawer}
      className={({ isActive }) => (isActive ? 'active' : '')}
    >
      <Icon size={20} />
      {label}
    </NavLink>
  ));

  return (
    <div className="app-shell">
      <aside className={`sidebar${drawer ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <span className="logo-dot">
            <GraduationCap size={22} />
          </span>
          <div className="brand-text">
            <strong>School of Sciences</strong>
            <small>UENR · Sunyani</small>
          </div>
        </div>

        <nav className="sidebar-nav">{navItems}</nav>

        <div className="sidebar-bottom">
          <div className="sb-user">
            <div className="avatar">{initials}</div>
            <div className="sb-meta">
              <div className="sb-name">{user?.name}</div>
              <div className="sb-role">{roleLabel}</div>
            </div>
          </div>
          <button type="button" className="logout-btn" onClick={doLogout}>
            <SignOut size={15} /> Log out
          </button>
        </div>
      </aside>

      <div className={`sidebar-scrim${drawer ? ' open' : ''}`} onClick={closeDrawer} />

      <div className="main">
        <div className="mobile-topbar">
          <div className="mt-brand">
            <span className="logo-dot">
              <GraduationCap size={17} />
            </span>
            School of Sciences
          </div>
          <button className="mt-hamburger" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <List size={24} />
          </button>
        </div>

        <div className="main-scroll">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
