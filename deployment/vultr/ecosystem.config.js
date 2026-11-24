// ═══════════════════════════════════════════════════════════════════
// Dues Management — PM2 production config (Vultr VPS)
// Copy to /opt/dues/server/ecosystem.config.js, or start directly:
//   pm2 start /opt/dues/deployment/vultr/ecosystem.config.js
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  apps: [
    {
      name: 'dues-api',
      script: 'src/index.js',
      cwd: '/opt/dues/server',
      // fork mode, ONE instance on purpose: Socket.io connections and the
      // realtime event bus are per-process — a cluster would split
      // connected admins across workers and events would not reach them.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/dues/error.log',
      out_file: '/var/log/dues/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
