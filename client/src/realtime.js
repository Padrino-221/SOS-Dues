import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;
let authedToken = null;

// Realtime is on by default: the app runs on a long-lived API (pm2) behind
// nginx, which proxies /socket.io/ with WebSocket upgrade. Set
// VITE_REALTIME=off at build time to opt out (e.g. a serverless deployment
// where there is no long-lived WebSocket backend — the client then never
// opens a socket that cannot connect).
const REALTIME_ENABLED = import.meta.env.VITE_REALTIME !== 'off';

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
