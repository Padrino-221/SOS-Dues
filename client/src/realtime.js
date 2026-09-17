import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;
let authedToken = null;

// Socket.IO needs a long-lived server. It is enabled in local development (the
// Vite proxy forwards /socket.io to the API) and can be turned on for a
// deployment that has a WebSocket-capable backend via VITE_REALTIME=on. On a
// plain Vercel serverless deployment it stays off so the app never opens a
// socket that cannot connect.
const REALTIME_ENABLED = import.meta.env.DEV || import.meta.env.VITE_REALTIME === 'on';

/**
 * Make sure a socket exists that matches the current auth token.
 * Public/anonymous sessions get no socket — events only matter to admins.
 */
function ensureSocket() {
  if (!REALTIME_ENABLED) return null;
  const token = localStorage.getItem('token') || null;
  if (socket && authedToken === token) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  authedToken = token;
  if (token) {
    socket = io({ auth: { token } });
  }
  return socket;
}

/** Call after login/logout so the socket (re)connects with the right identity. */
export function syncSocket() {
  return ensureSocket();
}

/** Subscribe to a realtime event; returns an unsubscribe function. */
export function onRealtime(event, handler) {
  const s = ensureSocket();
  if (!s) return () => {};
  s.on(event, handler);
  return () => s.off(event, handler);
}

/**
 * Subscribe a page to live events. Handlers run whenever the socket emits,
 * with the latest render's closure (so current filters are respected).
 */
export function useRealtime(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const offs = Object.entries(ref.current).map(([event, fn]) => onRealtime(event, fn));
    return () => offs.forEach((off) => off());
  }, []);
}
