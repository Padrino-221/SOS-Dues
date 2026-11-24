import StaffAccessSignIn from '../components/StaffAccessSignIn';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconLock as Lock, IconArrowRight as ArrowRight } from '@tabler/icons-react';
import PasswordInput from '../components/ui/PasswordInput';

// Turn a login failure into a message a human on a shaky campus network
// can act on. Each branch matters: 429 means wait, no response means the
// network is down — neither is a credentials problem.
function loginErrorMessage(err) {
  if (err.code === 'ECONNABORTED')
    return 'The request timed out. Check your connection and try again.';
  if (!err.response) return "Can't reach the server. Check your connection.";
  const { status, data } = err.response;
  if (status === 401 || status === 403)
    return 'Incorrect email or password. Check your credentials and try again.';
  if (status === 429)
    return data?.error || 'Too many attempts — wait a few minutes before trying again.';
  return data?.error || 'Something went wrong on the server.';
}

// Where to go after a successful login: the page that bounced the user
// here (location.state.from, or 'dues_return_to' stored by the API client on
// a 401), else the admin dashboard. Only same-site paths are honored.
function resolvePostLoginPath(location) {
  const from = location.state?.from;
  if (from && typeof from.pathname === 'string') {
    return from.pathname + (from.search || '');
  }
  let stored = null;
  try {
    stored = sessionStorage.getItem('dues_return_to');
    sessionStorage.removeItem('dues_return_to');
  } catch {
    /* storage blocked — fall through to /admin */
  }
  if (stored && stored.startsWith('/') && !stored.startsWith('//')) return stored;
  return '/admin';
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(resolvePostLoginPath(location), { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img src="/school-logo.jpg" alt="School of Sciences" className="auth-logo" />
        <h1>Dues Management System</h1>
        <p className="subtitle">School of Sciences, UENR Sunyani</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary w-full" disabled={loading}>
            <ArrowRight size={18} /> {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <StaffAccessSignIn appId="dues"/>
        <p className="muted text-sm mt" style={{ textAlign: 'center' }}>
          <Lock size={14} /> Admin access only. Class reps use the class page link.
        </p>
        <p className="muted text-sm" style={{ textAlign: 'center', marginTop: 8 }}>
          Forgot your password? Contact the school admin to reset it.
        </p>
      </div>
    </div>
  );
}
