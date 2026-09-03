import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  House,
  UserPlus,
  Users,
  CurrencyCircleDollar,
  CheckCircle,
  ChartBar,
  Gear,
  Clock,
  ArrowLeft,
  Bell,
  SignOut,
  GraduationCap,
} from '@phosphor-icons/react';

export default function AdminLayout() {
  const { user, logout } = useAuth();

  const nav = [
    { to: '/admin', label: 'Dashboard', end: true, Icon: House },
    { to: '/admin/freshers', label: user?.role === 'school_admin' ? 'Freshers' : 'Pending Freshers', Icon: UserPlus },
    { to: '/admin/students', label: 'Students', Icon: Users },
    { to: '/admin/payments', label: 'Payments', Icon: CurrencyCircleDollar },
    { to: '/admin/verify', label: 'Verify Receipt', Icon: CheckCircle },
    { to: '/admin/reports', label: 'Reports', Icon: ChartBar },
    { to: '/admin/settings', label: 'Settings', Icon: Gear },
    ...(user?.role === 'school_admin' ? [{ to: '/admin/audit', label: 'Audit Log', Icon: Clock }] : []),
  ];

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-icon">
            <GraduationCap size={22} weight="fill" />
          </div>
          <div>
            <h2>School of Sciences</h2>
            <p>UENR Sunyani</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map(({ to, label, end, Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="icon"><Icon size={20} /></span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <a href="/" onClick={(e) => { e.preventDefault(); logout(); }}>
            <span className="icon"><ArrowLeft size={18} /></span>
            Log Out
          </a>
        </div>
      </aside>

      <main className="main">
        <header className="top-header">
          <div className="header-left">
            <div className="greeting">{greeting}, {user?.name?.split(' ')[0] || 'Admin'}!</div>
            <div className="date">{dateStr}</div>
          </div>
          <div className="header-right">
            <div className="header-notif">
              <Bell size={18} />
              <div className="badge-dot"></div>
            </div>
            <div className="header-user">
              <div className="user-info">
                <div className="user-name">{user?.name}</div>
                <div className="user-email">{user?.role === 'school_admin' ? 'School Admin' : `Dept Admin · ${user?.department_name}`}</div>
              </div>
              <div className="avatar">{initials}</div>
            </div>
            <a href="/" className="header-logout" title="Sign Out" onClick={(e) => { e.preventDefault(); logout(); }}>
              <SignOut size={18} />
            </a>
          </div>
        </header>

        <div className="main-scroll">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
