import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, checkingSession } = useAuth();
  if (checkingSession)
    return (
      <p className="muted text-sm" style={{ padding: 40, textAlign: 'center' }}>
        Checking your session…
      </p>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
