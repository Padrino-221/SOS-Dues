# Dues Management System (v2)
## School of Sciences — University of Energy and Natural Resources, Sunyani

A centralised web application that manages student dues collection across the School of Sciences and its departments — fresher registration/admission, free-flow yearly-dues payments maintained as payment records (School + Department portions), souvenir tracking, receipts, and reports.

> **v2 rebuild.** The role model matches the School's real workflow: the School Admin registers freshers, departments own their students and classes, and class reps collect yearly dues on a public page keyed by department code. See `PROJECT_PLAN.md` for the full spec.

## Tech Stack

- **Frontend:** React (Vite), React Router
- **Backend:** Node.js, Express (REST API)
- **Database:** PostgreSQL
- **Auth:** JWT + bcrypt
- **Extras:** `express-rate-limit` on public rep routes, audit `transaction_log`, receipt e-mails (dev-mode logs when no SMTP is configured)

## Project Structure

```
server/   Express API (routes, db, middleware)
client/   React frontend (Vite)
```

## Prerequisites

- **Node.js** (v18+) installed
- **PostgreSQL** running locally on `localhost:5432`

## Setup

### 1. Configure the database connection

The server reads Postgres credentials from `server/.env`. A `.env` file already exists with:

```
PGHOST=localhost
PGPORT=5432
PGDATABASE=dues_management
PGUSER=postgres
PGPASSWORD=1234567890
```

Update the password/credentials to match your local PostgreSQL installation.

### 2. Install dependencies

From the project root:

```
npm run install:all
```

### 3. Create the database, tables and seed data

```
npm run setup
```

This **drops and recreates** every table (v2 schema), creates the `dues_management` database if needed, and seeds it with:
- A **School Admin** account
- Five **Department Admin** accounts (one per department)
- Departments (each with a public rep **access code**), classes/levels, souvenirs and the school-wide dues amount

## Running the app

From the project root:

```
npm run dev
```

This starts both the API server (http://localhost:5000) and the frontend (http://localhost:5173) together.

Alternatively, run them separately in two terminals:
```
npm run dev:server   # API on :5000
npm run dev:client   # frontend on :5173
```

Or on Windows double-click `start.bat`.

Open **http://localhost:5173** in your browser.

## Default Login

| Role | Email | Password |
|------|-------|----------|
| School Admin | `admin@sciences.uenr.edu.gh` | `admin1234` |
| Computer Science Dept Admin | `computerscience@sciences.uenr.edu.gh` | `dept1234` |
| Biology Dept Admin | `biology@sciences.uenr.edu.gh` | `dept1234` |
| Chemistry Dept Admin | `chemistry@sciences.uenr.edu.gh` | `dept1234` |
| Physics Dept Admin | `physics@sciences.uenr.edu.gh` | `dept1234` |
| Mathematics Dept Admin | `mathematics@sciences.uenr.edu.gh` | `dept1234` |

**Change these passwords immediately in production.**

## Roles & Flows

| Task | School Admin | Dept Admin | Class Rep (no account) |
|------|:---:|:---:|:---:|
| Register freshers + assign to a department | ✅ | ❌ | ❌ |
| Record School dues + School souvenirs (at registration) | ✅ | ❌ | ❌ |
| Admit freshers assigned to their department | ❌ | ✅ | ❌ |
| Record Department dues + Department souvenirs (at admission) | ❌ | ✅ | ❌ |
| Create the department's levels / classes | ❌ | ✅ | ❌ |
| Configure the department's dues amount | ❌ (view only) | ✅ | ❌ |
| Configure the department's souvenir list | ❌ (view only) | ✅ | ❌ |
| Record dues free-flow — type the payer's name + index + email, pick level/class, choose the dues | ❌ | ✅ | ✅ (public page) |
| Supervise — verify receipts / reports / audit / school settings | ✅ | dept-scoped | ❌ |

### Freshers (first day)

1. School Admin registers the fresher, **assigns them to a department**, and records **School dues + School souvenirs** (one School receipt).
2. The fresher appears in that department's **pending admission queue**.
3. The Dept Admin **admits** the fresher (picks the class/level) and records **Department dues + Department souvenirs** (one Department receipt).

Freshers therefore get **two receipts** across the two steps — the two collections happen at different times.

### Continuing students (every year)

1. **There is no continuing-student list.** Payments are the record: every collection is free-flow, and the receipts table holds each payment with the payer's typed **name**, **index number**, **email** and **level** snapshotted on it — no roster row is ever created or maintained.
2. Whether collected on the **class rep public page** or the Dept Admin's **Collect Dues** page, the collector types the payer's **name and index number**, selects the **level** (and the **class** when that level has classes), selects **which dues** are being paid, and confirms on a review screen. **No student lookup happens before paying.**
3. One collection = **one itemized receipt** (one receipt number) listing the School and/or Department portions — verifiable by both the School and the department. The **Receipts** page and **Reports** aggregate everything by index number, and the public **`/records`** page shows any payer's full history straight from their receipts.

## Public pages (no login)

- **`/`** — Landing. Enter a **department access code** to open the class-rep collection form.
- **`/rep/:code`** — Yearly-dues collection, fully free-flow. After the department PIN unlock, the rep enters the **student's name, index number and email**, selects the **level** (plus the **class** when that level has classes), then selects **which dues** the student is paying (amounts pre-filled and editable) and method, and confirms on a separate review screen. There is **no lookup against existing student records** — the payment is written straight to the records and one receipt is issued.

## Admin pages (require login)

- **`/admin`** — Dashboard: collected dues, pending fresher admissions, recent receipts, monthly flow.
- **`/admin/freshers`** — School Admin: register/edit freshers + assign departments. Dept Admin: **admit** assigned freshers (pending / admitted tabs).
- **`/admin/collect`** — Dept Admin: free-flow collection desk — enter the payer's name + index number + email, pick level/class, select the dues, confirm, and issue the receipt. No student search.
- **`/admin/receipts`** — Every receipt issued (school registrations, fresher admissions, yearly collections, rep collections).
- **`/admin/verify`** — Verify a receipt by number; shows the itemized School/Department breakdown.
- **`/admin/reports`** — Totals by department and class/level, monthly trend, date filtering, CSV export.
- **`/admin/settings`** — School Admin (supervision): school-wide dues amount, school souvenir catalogue, departments overview, department admins. Dept Admin (configuration): their department's **dues amount**, their **own souvenir list**, classes/levels, and their rep code.
- **`/admin/audit`** — Full transaction log (School Admin only).

## Dues amounts & souvenirs

- **School dues:** one school-wide amount (Settings → School Admin), paid by every student every year.
- **Active academic year:** the School Admin sets this in Settings (for example, `2026/2027`). All new payment receipts and payment-status checks use this active year; payment dates no longer select the academic year.
- **Department dues:** one amount per department, **configured by each Department Admin** in their own Settings (pre-filled on every collection form and editable at the time of collection).
- **Souvenirs** are split the same way: the School Admin manages the **School souvenir catalogue** (given at registration); each Department Admin manages their **own department's souvenir list** (given at fresher admission). Only a department's own items can be handed out when its freshers are admitted.

## Receipts

- Every collection event creates a receipt with a unique number in the format `SOS-DUES-<TYPE>-<student-number>-<n>` — for example `SOS-DUES-SCH-UEB3227523-1`. `<TYPE>` is `SCH` (School-dues-only, e.g. fresher registration), `DEPT` (Department-dues-only, e.g. fresher admission) or `DUES` (combined collection). `<n>` is a lifetime counter per index number that keeps counting across every receipt issued under that number.
- **Free-flow receipts** (rep page / Collect desk) carry the payer's typed **name, index number, email and level** on the receipt itself and are not linked to a student record; the receipt email is sent to that captured address as the payment is recorded. Student-linked receipts (fresher registration / admission) resolve those fields through the student row. Reports, verify and exports read both the same way.
- Receipts are shown on screen, e-mailed (dev mode logs them when no SMTP is configured), and verifiable on the admin Verify page.
- School Admin verifies any receipt; a Dept Admin verifies receipts issued in their department.

### Receipt e-mails (SMTP)

Receipt e-mails are sent by the server. If SMTP is not configured (or only partly configured), the server stays in **dev mode** and logs the e-mail to the console instead — nothing breaks.

The current setup uses **Gmail**:

1. Enable 2-Step Verification on the sending Google account.
2. Create an **App Password** (Google Account → Security → App passwords).
3. In `server/.env`, set `SMTP_USER` to the Gmail address and `SMTP_PASS` to the 16-character App Password, then restart the server.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.address@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM=Dues Management <your.address@gmail.com>
```

**Switching to AWS SES later:** verify the sending domain/address in SES, create SES SMTP credentials, and replace the values in `server/.env` (no code changes needed):

```dotenv
SMTP_HOST=email-smtp.<region>.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
SMTP_FROM=Dues Management <no-reply@your-verified-domain>
```

The student's e-mail is used when available; set `RECEIPT_EMAIL_TO` to force every receipt e-mail to a single address instead.

## Security Notes

- Role-based access is enforced in the API (school-only registration, department-scoped freshers and classes). The public rep routes record free-flow payments only after an unlocked, department-scoped PIN session, and can only write to their own department.
- The public rep endpoints are rate-limited.
- Admin routes require a valid JWT. Department admins can only see/manage their own department's data.
- Change `JWT_SECRET` in `server/.env` before any production deployment.

## Deploying to Vercel (frontend + API together)

The repo deploys as a **single Vercel project** using
[Vercel Services](https://vercel.com/docs/services): `client/` (Vite SPA) and
`server/` (Express API) are built separately and served from one domain, routed
by `vercel.json`:

```json
{
  "services": {
    "frontend": { "root": "client/", "framework": "vite" },
    "backend": { "root": "server/", "framework": "express" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```

The Express app is exported from `server/src/app.js` (referenced by
`server/package.json` `"main"`) and runs as a single Vercel Function; the
original `/api/...` path is preserved, so the routes need no changes.
`server/src/index.js` remains the local/dev entrypoint (HTTP server + Socket.IO).

### 1. Database

Create a Neon (or any hosted Postgres) project and copy the **pooled**
connection string (the host contains `-pooler`). The API uses `DATABASE_URL`
when set, otherwise it falls back to the local `PG*` variables.

Run the schema + seed against it once (from your machine, with `DATABASE_URL`
set in `server/.env`):

```text
npm run setup
```

### 2. Import the project

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project** and import the repository.
3. Set **Framework Preset: Services** (required for the `services` block to take
   effect). Root Directory: repository root. Leave the build/install settings on
   their defaults — each service installs and builds itself.

### 3. Environment variables

Add these for Production, Preview and Development:

```text
DATABASE_URL=your_neon_pooled_connection_string
JWT_SECRET=your_long_random_secret
JWT_EXPIRES_IN=7d
PGPOOL_MAX=5
# Optional — only if the API is called from another domain
CLIENT_URL=https://your-project.vercel.app
# Optional — real receipt e-mails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.address@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM=Dues Management <your.address@gmail.com>
```

- `DATABASE_URL` must be the **pooled** Neon string; keep `PGPOOL_MAX` small.
- `CLIENT_URL` is optional: the frontend and API share one origin, so the browser
  does not apply CORS. Set it only when calling the API from a different domain.

### 4. Deploy

Deploy the project. `https://<project>.vercel.app/api/health` should return
`{"status":"ok"}`, and the app is served at `/`.

### Deployment notes

- **Realtime (Socket.IO)** is off in production by default, because Vercel
  Functions do not expose a long-lived WebSocket server. Every page works fully
  without it. To enable it against a WebSocket-capable backend, set
  `VITE_REALTIME=on` in the build environment.
- Vercel runs Linux, so the project scripts use `npm` (not `npm.cmd`).
- Build the client locally with `npm run build` (in `client/`) to check the
  production bundle before deploying.

