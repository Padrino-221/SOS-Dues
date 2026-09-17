import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowRight } from '@phosphor-icons/react';
import PasswordInput from '../components/ui/PasswordInput';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      navigate('/admin');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
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
        <p className="muted text-sm mt" style={{ textAlign: 'center' }}>
          <Lock size={14} /> Admin access only. Class reps use the class page link.
        </p>
      </div>
    </div>
  );
}
