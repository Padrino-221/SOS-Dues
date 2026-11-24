# Dues Management — Vultr VPS Deployment (subdomain + HTTPS)

Deploy Dues Management to the shared sosuenr.com VPS at
**`https://dues.sosuenr.com`** with Nginx, PM2, and PostgreSQL on the same
box. It sits alongside the mother site (`sosuenr.com`), the Document Tracker
(`tracker.sosuenr.com`) and Attendance (`attendance.sosuenr.com`) — each app
gets its own kit in `deployment/vultr/`, its own database, and its own Nginx
vhost; the base server (Node, Nginx, PM2, PostgreSQL) is installed once.

---

## Architecture

```
Browser ──HTTPS──▶ Nginx (443, dues.sosuenr.com) ──┬─▶ /            → /opt/dues/client/dist  (static SPA)
                                                   ├─▶ /api/*       → 127.0.0.1:3001  (PM2: dues-api)
                                                   └─▶ /socket.io/* → 127.0.0.1:3001  (WebSocket upgrade)
                                                                        │
                                                                        └─▶ PostgreSQL  (localhost:5432/dues)
```

The client calls `/api` with a **relative baseURL** and opens Socket.io on its
own origin — same-origin through Nginx, so there are no CORS round-trips in
production. `CLIENT_URL` still feeds the server's CORS allow-list (for local
dev) and the origins inside emails; keep it set to the exact production
origin.

> **One instance, fork mode:** the API is deliberately NOT run as a PM2
> cluster — Socket.io connections and realtime events are per-process, so
> multiple workers would split connected admins and events would not reach
> everyone. See `ecosystem.config.js`.

---

## Prerequisites

- A Vultr instance running **Ubuntu 22.04/24.04** with a sudo-capable user
- DNS **A records** pointing at your Vultr IP:
  - `sosuenr.com` + `www.sosuenr.com` (mother site)
  - `dues.sosuenr.com`, `tracker.sosuenr.com`, `attendance.sosuenr.com`
- Ports **80** and **443** open in the Vultr firewall
- `scp`/`rsync` + `ssh` from your machine

---

## Step 1 — Base server setup (once per server)

Copy the setup script up and run it as the `ubuntu` user (so PM2 and the app
directory are owned by `ubuntu`, not `root`):

```bash
scp deployment/vultr/setup-vps.sh ubuntu@YOUR_IP:/tmp/
ssh ubuntu@YOUR_IP "sudo bash /tmp/setup-vps.sh"
```

This installs Node.js 22, Nginx, PM2, PostgreSQL, creates the `dues`
database + role, and prints the **generated DB password**. **Copy that
password** — you'll put it in `server/.env`. The script is idempotent and
safe to run alongside the other sosuenr.com kits.

---

## Step 2 — Copy the project to the server

From your local project root (the folder containing `server/` and `client/`):

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .git \
  --exclude 'client/dist' \
  --exclude 'server/.env' \
  ./ ubuntu@YOUR_IP:/opt/dues/
```

> `--exclude server/.env` keeps your local dev secrets (and the live SMTP
> credentials) off the server — you'll create the production `.env` next.

If you don't have `rsync`, use `scp`:

```bash
tar --exclude=node_modules --exclude=.git \
    --exclude='server/.env' --exclude='client/dist' \
    -czf - ./ | ssh ubuntu@YOUR_IP "mkdir -p /opt/dues && tar -xzf - -C /opt/dues"
```

---

## Step 3 — Configure the production environment

On the server:

```bash
ssh ubuntu@YOUR_IP
cd /opt/dues
cp deployment/vultr/env.production.example server/.env
nano server/.env
```

Fill in:

```env
DATABASE_URL=postgresql://dues:THE_PASSWORD_FROM_STEP_1@localhost:5432/dues
JWT_SECRET=<run: openssl rand -hex 32>
PORT=3001
NODE_ENV=production
CLIENT_URL=https://dues.sosuenr.com
SMTP_HOST=email-smtp.<region>.amazonaws.com   # Amazon SES
```

> Use the **exact** origin for `CLIENT_URL`: `https://`, no trailing slash.

---

## Step 4 — Deploy

```bash
cd /opt/dues
bash deployment/vultr/deploy.sh
```

This installs deps, builds the SPA, creates the schema on the first run
(afterwards it only runs idempotent migrations — `db:setup` is never run
against an existing database), starts PM2, and installs the Nginx vhost.

---

## Step 5 — Seed the first admin (EXACTLY ONCE)

A fresh schema has no accounts. Create the bootstrap admin + demo data one
time:

```bash
cd /opt/dues/server
npm run db:seed
```

This creates the **School Admin** login plus demo departments/freshers for
trying the flow:

| Role | Email | Password |
|------|-------|----------|
| School Admin | `admin@sciences.uenr.edu.gh` | `admin1234` |
| Dept Admin | `computerscience@sciences.uenr.edu.gh` | `dept1234` (PIN `1234`) |

### The Super Admin account

The seed also creates a **Super Admin** — the role that can resend receipts,
edit/reopen fresher applications, force-delete a student, and manage
super-admin accounts.

Because `NODE_ENV=production` is set, its password is **generated randomly**
and printed once at the end of the seed output:

```
Super admin:  superadmin@sosuenr.com / <the generated password>
```

> **Copy that password out of the terminal NOW.** It is not recoverable — only
> its bcrypt hash is stored. If you lose it, delete the account from the
> `users` table and re-seed, or create a replacement via
> `INSERT INTO users (name, email, password_hash, role) VALUES (...)` with a
> hash from `bcrypt.hash('<new password>', 10)`.
>
> To choose the password yourself, set `SUPER_ADMIN_PASSWORD` in
> `server/.env` **before** seeding. It must be a unique, high-entropy secret.
> There is deliberately no built-in default in production.

**Change the admin password and department PINs immediately** (Settings →
Accounts), then delete the demo freshers/receipts when real data starts
arriving. Never run `npm run db:seed` again afterwards if you don't want the
demo rows back (the seed is destructive by design — it rebuilds all demo
data).

> **Note on redeploys:** `db:migrate` also creates the Super Admin if the
> database has none, and it runs automatically on every deploy. It is
> idempotent — it never overwrites or duplicates an existing account. If you
> ever need to remove the super admin entirely, delete the row; the next
> deploy will recreate it with a fresh random password.

---

## Step 6 — Enable HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dues.sosuenr.com
```

Verify:

```bash
pm2 status
curl -sI http://dues.sosuenr.com         # 200 OK (HTTP)
sudo certbot renew --dry-run
curl -s https://dues.sosuenr.com/records # public records page
```

Open **https://dues.sosuenr.com** and log in with the School Admin.

---

## Updating the app

Re-sync files, then re-run deploy:

```bash
# from your local machine
rsync -avz --delete \
  --exclude node_modules --exclude .git \
  --exclude 'client/dist' --exclude 'server/.env' \
  ./ ubuntu@YOUR_IP:/opt/dues/
ssh ubuntu@YOUR_IP "bash /opt/dues/deployment/vultr/deploy.sh"
```

`deploy.sh` is idempotent — migrations only apply once, and the Nginx vhost
is only written on the first run.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `502 Bad Gateway` | `pm2 status` / `pm2 logs dues-api` — API down |
| Login says "Network Error" (dev/staging) | `CLIENT_URL` doesn't match the browser origin (CORS) |
| Realtime dashboard updates missing | Check `/socket.io/` proxy + `pm2 logs dues-api`; only ONE worker is expected (fork mode) |
| Emails not sending | `SMTP_*` values in `server/.env`; SES identities must be verified and out of sandbox |
| Deploy says "Cannot reach the database" | `DATABASE_URL` password matches Step 1; `systemctl status postgresql` |
| Port 3001 in use | `sudo lsof -i :3001`; `pm2 delete dues-api` then redeploy |
| `permission denied` on `/var/log/dues` | `sudo chown -R ubuntu:ubuntu /var/log/dues` |
| Cert expires | `sudo systemctl status certbot.timer` (auto-renews ~30 days before expiry) |

---

## Notes

- **Secrets:** `server/.env` is gitignored. Never commit real keys.
- **Destructive scripts:** `npm run db:setup` drops every table — only ever
  run it on an empty database (the deploy script gates this for you).
- **Ports:** internal `127.0.0.1:3001` (see the master plan
  `Vultr-Deployment-Cost-Plan.md` for the full port table: site 3000, dues
  3001, tracker 3002, attendance 5000).
