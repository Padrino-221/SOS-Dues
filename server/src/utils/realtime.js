const jwt = require('jsonwebtoken');

let io = null;

/**
 * Attach Socket.IO to the existing HTTP server.
 * Admins join rooms based on their token:
 *   school_admin -> 'school'      (receives everything)
 *   dept_admin   -> `dept-<id>`   (receives only their department's events)
 * Anonymous sockets (public pages) connect but receive nothing.
 *
 * socket.io is required lazily so serverless deployments (where there is no
 * long-lived HTTP server / WebSocket support) never load it.
 */
function initIO(server) {
  const { Server } = require('socket.io');
  const clientUrl = (process.env.CLIENT_URL || '').trim();
  const origins = clientUrl ? clientUrl.split(',').map((u) => u.trim()) : [];
  io = new Server(server, {
    cors: {
      origin: origins.length ? origins : false,
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next();
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = {
        id: payload.id,
        role: payload.role,
        department_id: payload.department_id ?? null,
      };
      next();
    } catch {
      next();
    }
  });

  io.on('connection', (socket) => {
    const u = socket.user;
    if (!u) return;
    if (u.role === 'school_admin') socket.join('school');
    if (u.role === 'dept_admin' && u.department_id) socket.join(`dept-${u.department_id}`);
  });

  return io;
}

function getIO() {
  return io;
}

/**
 * Emit an event to the admins who care about it:
 *  - school admins always receive it
 *  - if payload.department_id is set, that department's admins receive it too
 */
function emitEvent(type, payload = {}) {
  if (!io) return;
  io.to('school').emit(type, payload);
  if (payload.department_id) {
    io.to(`dept-${payload.department_id}`).emit(type, payload);
  }
}

module.exports = { initIO, getIO, emitEvent };
