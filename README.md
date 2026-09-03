# Dues Management System
## School of Sciences — University of Energy and Natural Resources, Sunyani

A centralised web application to manage the collection of student dues, record souvenirs given to freshers, and report how much each department collects.

## Tech Stack

- **Frontend:** React (Vite), React Router
- **Backend:** Node.js, Express (REST API)
- **Database:** PostgreSQL
- **Auth:** JWT + bcrypt

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

### 3. Create the database and tables, then seed it

```
npm run setup
```

This creates the `dues_management` database and its tables, then seeds it with:
- A **School Admin** account
- Sample departments (Mathematics, Biology, Chemistry, Physics, Computer Science)
- Classes/levels and souvenir items

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

Open **http://localhost:5173** in your browser.

## Default Login

| Role | Email | Password |
|------|-------|----------|
| School Admin | `admin@sciences.uenr.edu.gh` | `admin1234` |

**Change this password immediately in production.**

## App Overview

### Public pages (no login)
- **`/`** — Landing page. Enter a **class code** to open the class-rep collection form.
- **`/rep/:code`** — Class Representative collection form for **continuing students**. The rep enters student name, student number, amount and payment method. The system generates a **unique receipt number** and records the payment against that class/department.

### Admin pages (require login)
- **`/admin`** — Dashboard: totals per department, money collected per department, class/level breakdown.
- **`/admin/freshers`** — Pending Freshers with search. School admin registers freshers; dept admins search and **add pending freshers to their department** (no re-typing names).
- **`/admin/students`** — Add/search students (continuing students are added here).
- **`/admin/payments`** — Record fresher **School dues + souvenirs** and **Department dues + department souvenirs**.
- **`/admin/verify`** — Verify a payment by **receipt number** (admin only).
- **`/admin/reports`** — Detailed reports + CSV export.
- **`/admin/settings`** — Configure departments & dues amounts, classes (access codes), souvenirs, and department admins. (Mostly school-admin only.)

## The Two Collection Flows

1. **Freshers (first day):**
   - School admin registers the fresher and records **School dues + School souvenirs**.
   - The fresher appears on the **Pending Freshers** page.
   - Department admin searches and **adds the fresher to their department** (same day).
   - Department admin records **Department dues + Department souvenirs**.

2. **Continuing students:**
   - Admin adds the continuing student to the system if not present.
   - The class rep opens the class page using the **class code** and submits each student's dues → gets a **receipt number**.
   - Admins verify any payment later via the **Verify Receipt** page.

## Finding a class code

Codes are generated automatically when a class is created (Settings → Classes). The code contains the department and class name, e.g. `COMPUTERSCIENCE-100-100`. Share the correct code with each class representative.

## Security Notes

- The **class-rep endpoint is public** and rate-limited. Only use it for collecting continuing-student dues.
- Admin routes require a valid JWT. Department admins can only see/manage data within their own department.
- Change `JWT_SECRET` in `server/.env` before any production deployment.

## Production Deployment (later)

Build the client (`npm run build` in `client/`), serve the static files, set a strong `JWT_SECRET`, and run `npm start` in `server/`. The database can be moved to a hosted Postgres by updating the connection variables in `server/.env`.
