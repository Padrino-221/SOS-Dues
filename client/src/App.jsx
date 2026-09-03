import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import AdminLayout from './components/AdminLayout';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Freshers from './pages/Freshers';
import Students from './pages/Students';
import Payments from './pages/Payments';
import Verify from './pages/Verify';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import RepPage from './pages/RepPage';
import Landing from './pages/Landing';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/rep/:code" element={<RepPage />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="freshers" element={<Freshers />} />
        <Route path="students" element={<Students />} />
        <Route path="payments" element={<Payments />} />
        <Route path="verify" element={<Verify />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>
    </Routes>
  );
}
