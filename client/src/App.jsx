import StaffSsoComplete from './pages/StaffSsoComplete';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import AdminLayout from './components/AdminLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import Freshers from './pages/Freshers';
import Students from './pages/Students';
import Collect from './pages/Collect';
import Receipts from './pages/Receipts';
import Verify from './pages/Verify';
import Reports from './pages/Reports';
import DataHealth from './pages/DataHealth';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import RepPage from './pages/RepPage';
import Apply from './pages/Apply';
import Records from './pages/Records';
import Landing from './pages/Landing';

function RequireRoles({ allow, children }) {
  const { user } = useAuth();
  const location = useLocation();
  // Same hand-off as ProtectedRoute: after signing back in the user lands on
  // the page (and role gate) that bounced them, not on a blanket /admin.
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!allow.includes(user.role)) return <Navigate to="/admin/freshers" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/staff-sso/complete" element={<StaffSsoComplete/>}/>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/rep/:code" element={<RepPage />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/records" element={<Records />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <RequireRoles allow={['school_admin', 'super_admin', 'dept_admin']}>
              <Dashboard />
            </RequireRoles>
          }
        />
        <Route path="freshers" element={<Freshers />} />
        {/* Continuing students + the class-rep verification queue (freshers
            stay on their own page). */}
        <Route
          path="students"
          element={
            <RequireRoles allow={['school_admin', 'super_admin', 'school_staff', 'dept_admin']}>
              <Students />
            </RequireRoles>
          }
        />
        <Route
          path="collect"
          element={
            <RequireRoles allow={['dept_admin']}>
              <Collect />
            </RequireRoles>
          }
        />
        <Route
          path="receipts"
          element={
            <RequireRoles allow={['school_admin', 'super_admin', 'dept_admin', 'dept_staff']}>
              <Receipts />
            </RequireRoles>
          }
        />
        <Route path="verify" element={<Verify />} />
        <Route
          path="reports"
          element={
            <RequireRoles allow={['school_admin', 'super_admin', 'dept_admin']}>
              <Reports />
            </RequireRoles>
          }
        />
        <Route
          path="health"
          element={
            <RequireRoles allow={['school_admin', 'super_admin']}>
              <DataHealth />
            </RequireRoles>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRoles allow={['school_admin', 'super_admin', 'dept_admin']}>
              <Settings />
            </RequireRoles>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRoles allow={['school_admin', 'super_admin']}>
              <AuditLog />
            </RequireRoles>
          }
        />
      </Route>
    </Routes>
  );
}
