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

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next();
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if(payload.sso_sid){const user=await require('../services/staff-sso').authenticate(payload.sso_sid);if(!user)return next(new Error('Staff Access permission has ended.'));socket.staffSsoId=payload.sso_sid;socket.user=user;return next();}
      if(process.env.STAFF_SSO_ENABLED==='true'&&await require('../services/staff-sso').linked(payload.id))return next(new Error('Use Staff Access.'));
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
async function emitEvent(type,payload={}){if(!io)return;for(const socket of io.sockets.sockets.values()){let user=socket.user;if(socket.staffSsoId){user=await require('../services/staff-sso').authenticate(socket.staffSsoId);if(!user){socket.disconnect(true);continue;}}if(user&&(user.role==='school_admin'||user.role==='super_admin'||user.role==='dept_admin'&&String(user.department_id)===String(payload.department_id)))socket.emit(type,payload);}}

module.exports = { initIO, getIO, emitEvent };
