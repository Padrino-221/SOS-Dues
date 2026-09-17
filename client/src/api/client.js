import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  // A caller-set header wins (e.g. the rep page's own session token);
  // otherwise fall back to the admin token when logged in.
  if (!config.headers.Authorization) {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

const isPublicPath = () => {
  const p = window.location.pathname;
  return p === '/' || p.startsWith('/rep') || p === '/apply' || p === '/records';
};

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401 && !isPublicPath()) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
