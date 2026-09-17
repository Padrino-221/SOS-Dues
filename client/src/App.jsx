import { Routes, Route, Navigate } from 'react-router-dom';
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
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import RepPage from './pages/RepPage';
import Apply from './pages/Apply';
import Records from './pages/Records';
import Landing from './pages/Landing';

function RequireRoles({ allow, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/admin/freshers" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
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
            <RequireRoles allow={['school_admin', 'dept_admin']}>
              <Dashboard />
            </RequireRoles>
          }
        />
        <Route path="freshers" element={<Freshers />} />
        <Route path="students" element={<Students />} />
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
            <RequireRoles allow={['school_admin', 'dept_admin', 'dept_staff']}>
              <Receipts />
            </RequireRoles>
          }
        />
        <Route path="verify" element={<Verify />} />
        <Route
          path="reports"
          element={
            <RequireRoles allow={['school_admin', 'dept_admin']}>
              <Reports />
            </RequireRoles>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRoles allow={['school_admin', 'dept_admin']}>
              <Settings />
            </RequireRoles>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRoles allow={['school_admin']}>
              <AuditLog />
            </RequireRoles>
          }
        />
      </Route>
    </Routes>
  );
}
