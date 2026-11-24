#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Dues Management — Vultr VPS deploy/redeploy
# Run from the project root on the server (after copying files via scp/rsync):
#   bash deployment/vultr/deploy.sh
#
# Assumes:
#   - setup-vps.sh has been run (Node, Nginx, PM2, PostgreSQL ready)
#   - server/.env exists (copy deployment/vultr/env.production.example)
#
# The database step is first-run aware:
#   - empty database  → db:setup   (creates the v2 schema)
#   - existing schema → db:migrate (idempotent column/index additions)
# db:setup is destructive (DROP ... CASCADE) and is NEVER run against an
# existing database.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dues}"
DOMAIN="${DOMAIN:-dues.sosuenr.com}"

echo "╔══════════════════════════════════════════════╗"
echo "║  Dues Management — Deploy to Vultr VPS       ║"
echo "╚══════════════════════════════════════════════╝"

cd "$APP_DIR"

# ── 1. Environment check ───────────────────────────────────────────
echo "[1/6] Checking environment..."
if [ ! -f "$APP_DIR/server/.env" ]; then
  echo "  ERROR: $APP_DIR/server/.env not found."
  echo "  Copy the template and fill in your values:"
  echo "    cp deployment/vultr/env.production.example server/.env"
  echo "    nano server/.env"
  exit 1
fi

# ── 2. API dependencies ────────────────────────────────────────────
echo "[2/6] Installing API dependencies..."
cd "$APP_DIR/server"
npm ci --omit=dev --silent

# ── 3. Frontend build (same-origin /api via Nginx) ─────────────────
echo "[3/6] Building frontend..."
cd "$APP_DIR/client"
npm ci --silent
npm run build --silent

# ── 4. Database: first run creates the schema, later runs migrate ──
echo "[4/6] Checking database..."
cd "$APP_DIR/server"
DB_HAS_TABLES=$(node -e "
require('dotenv').config();
const { Pool } = require('pg');
const opts = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'dues_management',
    };
const pool = new Pool(opts);
pool
  .query(\"SELECT to_regclass('public.users') IS NOT NULL AS has_users\")
  .then((r) => { console.log(r.rows[0].has_users ? 'yes' : 'no'); return pool.end(); })
  .catch((e) => { console.error('Cannot reach the database:', e.message); process.exit(1); });
")
if [ "$DB_HAS_TABLES" = "yes" ]; then
  echo "  Existing schema — applying migrations (db:migrate)..."
  npm run db:migrate --silent
else
  echo "  Fresh database — creating schema (db:setup)..."
  npm run db:setup --silent
  echo ""
  echo "  ⚠  The schema exists but there are no accounts yet."
  echo "     Create the first admin (demo data + admin login) EXACTLY ONCE:"
  echo "       cd $APP_DIR/server && npm run db:seed"
  echo "     Then change the seeded admin password and PIN immediately."
fi

# ── 5. (Re)start the API with PM2 ──────────────────────────────────
echo "[5/6] Restarting application..."
mkdir -p /var/log/dues
pm2 delete dues-api 2>/dev/null || true
pm2 start "$APP_DIR/deployment/vultr/ecosystem.config.js"
pm2 save

# ── 6. Nginx vhost (first run only) ────────────────────────────────
echo "[6/6] Configuring Nginx..."
if [ ! -f /etc/nginx/sites-enabled/dues ]; then
  sudo cp "$APP_DIR/deployment/vultr/nginx.conf" /etc/nginx/sites-available/dues
  sudo sed -i "s/dues\.sosuenr\.com/${DOMAIN}/g" /etc/nginx/sites-available/dues
  sudo ln -sf /etc/nginx/sites-available/dues /etc/nginx/sites-enabled/dues
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
  echo ""
  echo "  ── Enable HTTPS ──"
  echo "  sudo apt-get install -y certbot python3-certbot-nginx"
  echo "  sudo certbot --nginx -d ${DOMAIN}"
else
  echo "  Nginx vhost already present — reloading."
  sudo nginx -t && sudo systemctl reload nginx
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Deployment complete!                        ║"
echo "║                                              ║"
echo "║  App:    https://${DOMAIN}                   ║"
echo "║  Health: curl http://localhost:3001/api/…    ║"
echo "║                                              ║"
echo "║  Logs:   pm2 logs dues-api                   ║"
echo "║  Status: pm2 status                          ║"
echo "╚══════════════════════════════════════════════╝"
