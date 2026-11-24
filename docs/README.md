# Documentation — Dues Management

This folder documents the **Dues Management System** for the School of Sciences,
UENR: fresher pre-registration and admission, yearly dues collection, souvenirs,
itemized receipts, verification, reports, and audit history.

## Document map

| Document | Audience | What it covers |
|---|---|---|
| [`architecture.md`](architecture.md) | Developers, maintainers, operators | Runtime architecture, API, data model, collection flows, receipts, deployment |
| [`user-guide.md`](user-guide.md) | School admins, department admins, class reps | Step-by-step collection and administration |
| [`dues-process-flow-a4-landscape.pdf`](dues-process-flow-a4-landscape.pdf) | Everyone | One-page printable process flow |
| [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) | Everyone | Earlier single-file guide |
| [`../README.md`](../README.md) | Operators | Setup, routes, deployment options |
| [`../PROJECT_PLAN.md`](../PROJECT_PLAN.md) | Developers | v2 role model, data model, collection rules |
| [`../EDGE_CASES.md`](../EDGE_CASES.md) | Developers | Known and tested edge cases |

## Quick facts

| Item | Value |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Axios, Socket.IO client, Phosphor Icons |
| Backend | Express 5, raw `pg`, JWT, Helmet, express-rate-limit, Socket.IO, PDFKit |
| Database | PostgreSQL — production database `dues`; local default `dues_management` |
| Production process | PM2 `dues-api`, **fork mode, 1 instance**, `127.0.0.1:3001` |
| Public domain | `https://dues.sosuenr.com` |
| Payments | **No payment gateway** — cash and mobile money are recorded offline |
| Email | Nodemailer, optional; receipt emails are logged in development when SMTP is absent |

> **Database naming:** `.env.example` defaults to `dues_management` for local
> development. Production uses `dues`. Always confirm `PGDATABASE` /
> `DATABASE_URL` before running migrations or backups.

## Diagrams

```bash
npx -y @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.pdf
```

`architecture.md` embeds the same diagram plus flow diagrams, so it renders on
GitHub without a build step.
