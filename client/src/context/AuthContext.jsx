import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { syncSocket } from '../realtime';

const AuthContext = createContext(null);

// See api/client.js: fired on `window` when the API answers 401 on a
// non-public path. Handling it here (instead of window.location = '/login')
// keeps the current page mounted until React redirects, so nothing is wiped
// mid-navigation and ProtectedRoute can pass location.state.from to Login.
const SESSION_EXPIRED_EVENT = 'dues:session-expired';

export function AuthProvider({ children }) {
  const [checkingSession, setCheckingSession] = useState(() =>
    Boolean(localStorage.getItem('token'))
  );
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user'));
    } catch {
      return null;
    }
  });
  // True after the API rejected our token — pages may show "please sign in
  // again" instead of a generic error. Cleared on the next successful login.
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const onSessionExpired = () => {
      setCheckingSession(false);
      setUser(null);
      setSessionExpired(true);
      // The token is gone — drop the socket bound to it.
      syncSocket();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api
      .get('/auth/me')
      .then(({ data }) => {
        localStorage.setItem('user', JSON.stringify(data));
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    setSessionExpired(false);
    syncSocket();
    return data.user;
  };

  const logout = () => {
    void api.post('/auth/staff-sso/dues/logout').catch(()=>{});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setSessionExpired(false);
    syncSocket();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, checkingSession, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
