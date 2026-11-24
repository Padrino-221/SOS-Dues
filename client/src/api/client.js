import axios from 'axios';

// Long enough for a slow campus link, short enough that a dead connection
// surfaces quickly. Timeouts reject with err.code === 'ECONNABORTED', which
// pages branch on to tell "the server is slow" apart from "the server said no".
const REQUEST_TIMEOUT_MS = 20000;

// Fired on `window` when the API answers 401 on a non-public path.
// AuthContext listens for it and clears `user`, so ProtectedRoute can render a
// soft <Navigate to="/login"> — no hard reload, the current page (and its
// filled-in forms) stays in the tree until React unmounts it.
const SESSION_EXPIRED_EVENT = 'dues:session-expired';

// Where the user was when the session died. Login.jsx reads it after a
// successful sign-in and clears the key.
const RETURN_TO_KEY = 'dues_return_to';

const api = axios.create({
  baseURL: '/api',
  timeout: REQUEST_TIMEOUT_MS,
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

function clearStoredSession() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  } catch (err) {
    /* storage unavailable — nothing to clear */
  }
}

// Persist `pathname + search` so Login can send the user back where they were.
// Never stored while sitting on /login itself (it would loop the post-login
// redirect back onto the login page).
function rememberReturnPath() {
  if (window.location.pathname === '/login') return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname + window.location.search);
  } catch (err) {
    /* storage unavailable — Login falls back to /admin */
  }
}

// Soft path: tell React about the dead session and let it redirect.
// Returns false only when the event/listener path is impossible (React never
// mounted, or CustomEvent is unavailable), so the caller can fall back to a
// full navigation — the only remaining way to reach /login.
function signalSessionExpired() {
  const root = document.getElementById('root');
  if (!root || !root.childElementCount) return false;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    return true;
  } catch (err) {
    return false;
  }
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err && err.response && err.response.status === 401 && !isPublicPath()) {
      // Session is gone (expired token, revoked user, …): drop it, remember
      // where we were, then redirect softly so the page is not wiped and the
      // return path survives.
      clearStoredSession();
      if (window.location.pathname !== '/login') {
        rememberReturnPath();
        if (!signalSessionExpired()) {
          // No listener to notify — hard redirect as a last resort.
          window.location.assign('/login');
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
