import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { syncSocket } from '../realtime';

const AuthContext = createContext(null);

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
    syncSocket();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    syncSocket();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, checkingSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
