import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, checkingSession } = useAuth();
  const location = useLocation();
  if (checkingSession)
    return (
      <p className="muted text-sm" style={{ padding: 40, textAlign: 'center' }}>
        Checking your session…
      </p>
    );
  // Hand the full location to Login so it can send the user back to the page
  // that bounced them here (it reads location.state.from, falling back to the
  // 'dues_return_to' key the API client stores on a 401).
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}
