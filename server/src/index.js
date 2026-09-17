const http = require('http');
require('dotenv').config();

const app = require('./app');
const pool = require('./db/pool');
const { initIO } = require('./utils/realtime');

// Local / long-running Node entrypoint. On Vercel the exported app in app.js is
// used directly as a single Function, so this file is not executed there.
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initIO(server);
server.listen(PORT, () => {
  console.log(`Dues Management API running on port ${PORT}`);
  console.log('Socket.IO attached for real-time admin updates');
});

// Friendly message instead of a raw crash when a second copy is started
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n┌────────────────────────────────────────────────────────────┐');
    console.error(`│  Port ${PORT} is already in use.                            │`);
    console.error('│  The API server is probably already running.              │');
    console.error('│  Do NOT start a second copy — just use the running one.    │');
    console.error('│  To restart it instead: stop the process on port 5000      │');
    console.error('│  first (taskkill /PID <id> /F), then start again.          │');
    console.error('└────────────────────────────────────────────────────────────┘\n');
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown: stop accepting connections and close the DB pool.
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('Closed database pool. Goodbye.');
    } catch (err) {
      console.error('Error closing database pool:', err.message);
    }
    process.exit(0);
  });
  // Safety net if connections won't drain.
  setTimeout(() => {
    console.error('Forcing exit after shutdown timeout.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
