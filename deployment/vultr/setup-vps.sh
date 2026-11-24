#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Dues Management — Vultr VPS one-time server setup
# Tested on Ubuntu 22.04 / 24.04 (x86_64 or ARM).
#
# Installs Node.js 22, Nginx, PM2, PostgreSQL, and creates the app
# database/user. Idempotent — safe to run on a box that already hosts the
# other sosuenr.com apps (the attendance, site and tracker kits use the
# same guarded installs). Run as a sudo-capable user:
#   sudo bash setup-vps.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

APP_USER="${SUDO_USER:-ubuntu}"
APP_DIR="/opt/dues"
DB_NAME="dues"
DB_USER="dues"
DB_PASS="$(openssl rand -hex 16)"
NODE_MAJOR=22

echo "╔══════════════════════════════════════════════╗"
echo "║  Dues Management — Vultr VPS Setup           ║"
echo "╚══════════════════════════════════════════════╝"

# ── 1. System packages ─────────────────────────────────────────────
echo "[1/6] Updating system packages..."
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg

# ── 2. Node.js 22 ──────────────────────────────────────────────────
echo "[2/6] Installing Node.js ${NODE_MAJOR}.x..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != "v${NODE_MAJOR}"* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node $(node -v) | npm $(npm -v)"

# ── 3. Nginx ───────────────────────────────────────────────────────
echo "[3/6] Installing Nginx..."
apt-get install -y -qq nginx
systemctl enable nginx
systemctl start nginx

# ── 4. PM2 ─────────────────────────────────────────────────────────
echo "[4/6] Installing PM2..."
npm install -g pm2
# Auto-start PM2 on boot (as the app user)
sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash - || true

# ── 5. PostgreSQL ──────────────────────────────────────────────────
echo "[5/6] Installing PostgreSQL and creating database..."
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Create role + database (idempotent)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# ── 6. App directory + logs ────────────────────────────────────────
echo "[6/6] Preparing app directory and logs..."
mkdir -p "$APP_DIR" /var/log/dues
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/log/dues

# Firewall (if ufw is present)
if command -v ufw &>/dev/null; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo " Setup complete. Save this database password now:"
echo ""
echo "   DB_USER = ${DB_USER}"
echo "   DB_PASS = ${DB_PASS}"
echo "   DB_NAME = ${DB_NAME}"
echo ""
echo " Add it to server/.env as:"
echo "   DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Next: copy the project to ${APP_DIR}, configure server/.env,"
echo "then run: bash deployment/vultr/deploy.sh"
