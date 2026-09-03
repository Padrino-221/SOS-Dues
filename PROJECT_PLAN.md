# Dues Management System
## School of Sciences — University of Energy and Natural Resources, Sunyani

### Project Plan & Proposal

---

## 1. Executive Summary

The School of Sciences currently tracks the payment of student dues using a **paper-based system**. This approach has several serious limitations:

- There is **no reliable, real-time record** of how much money each department collects from its dues.
- Freshers and continuing students are tracked inconsistently.
- **Souvenir distribution** to freshers on their first day is not systematically recorded.
- **Verification** of whether a student has paid is difficult and slow.
- Data is prone to loss, damage, and errors.

This project proposes a **centralised web-based Dues Management System** that digitises the entire dues lifecycle — from collection, through souvenir distribution, to verification and reporting. The system will give the School leadership **accurate, up-to-date insight** into how much each department generates from its dues, while making day-to-day collection faster and more transparent for staff and class representatives.

---

## 2. Objectives

The system is being built to achieve the following goals:

| # | Objective |
|---|-----------|
| 1 | Digitise the collection and recording of **dues payments** for both freshers and continuing students. |
| 2 | Provide the School with **accurate reporting on how much each department collects** from its dues. |
| 3 | Systematically record **which souvenirs were handed out to freshers** on their first day, at both the School and department levels. |
| 4 | Provide a simple, secure way to **verify a student's payment via a receipt number**. |
| 5 | Give class representatives a **simple, code-based page** to submit continuing-students' dues without needing their own accounts. |
| 6 | Replace fragile paper records with a **secure, centralised, searchable database**. |

---

## 3. Current Problem

- **Paper-based tracking:** All dues records are kept on paper, with no central, searchable record.
- **No departmental revenue visibility:** The School has no clear idea of how much each department earns from its dues.
- **Poor souvenir accountability:** There is no reliable record of which souvenirs were given to which fresher, creating potential for loss or misuse of items.
- **No verification mechanism:** Staff cannot quickly confirm whether a student has paid their dues.
- **Manual, error-prone workflow:** Data entry by hand is slow, inconsistent, and vulnerable to mistakes and loss of records.

---

## 4. Scope of the System

### 4.1 In Scope (MVP — Minimum Viable Product)

- User authentication for **School Admin** and **Department Admin** (role-based access).
- Management of the organisational structure:
  **School of Sciences → Departments → Classes / Levels**.
- Recording of **dues payments** for:
  - **Freshers** (first-day collection by School admin, followed by department-level collection on the same day).
  - **Continuing students** (collected by class representatives via a code-based page).
- Automatic generation of **unique receipt numbers** for every payment.
- **Souvenir tracking** — recording which souvenirs a fresher received at both the School and department levels.
- **Pending freshers workflow** — a searchable page where department admins adopt freshers who already belong to the School.
- **Admin-only receipt verification** — lookup a receipt number to see the full payment record.
- **Dashboard & reports** — totals per department, class, and level; money collected per department; number of students who have paid; exportable data.

### 4.2 Out of Scope (Later Phases)

- Online/mobile payment integration (e.g., Mobile Money / bank gateway).
- Public (student-facing) receipt lookup portal.
- Student self-service portals.
- Mobile native applications.
- Multi-campus / multi-school expansion.

---

## 5. Users & Roles

| Role | Description | Access |
|------|-------------|--------|
| **School Admin** | Oversees the entire School of Sciences. Manages departments, creates department admins, configures per-department dues amounts, records fresher School-dues and souvenirs, sees school-wide reports. | Full admin dashboard. |
| **Department Admin** | Manages a specific department. Adds pending freshers to their department, records department-dues and department souvenirs, uses the continuing-student collection workflow, verifies receipts, sees department reports. | Department-scoped admin dashboard. |
| **Class Representative** | Represents a specific class. Has **no account and no dashboard**. Collects continuing-student dues through a **public page accessed with a per-class code**. | Public class page only. |

---

## 6. How the System Works — Core Flows

### 6.1 Freshers (First Day)

The School takes fresher dues first and hands out School souvenirs. The department then records the student and takes department dues on the same day.

1. **School Admin** registers the fresher and records their **School dues** payment, plus which **School souvenirs** were handed over.
2. The fresher appears on a **"Pending Freshers"** page (they now belong to the School).
3. **Department Admin** uses the **search feature** on the Pending Freshers page, finds the fresher, and **adds them to their department** — no need to re-enter the student's details.
4. The **Department Admin** then records the **Department dues** for that student and links whichever **department souvenirs** were handed over.

> **Benefit:** The student's records flow automatically from the School to the Department. Names are captured only once, eliminating duplication and error.

### 6.2 Continuing Students

Continuing students may not already be in the system, so:

1. **Admins can add continuing students** to the system (capturing their details and assigning them to a department and class).
2. The **Class Representative** opens the class's public page using a **per-class code** (the code contains the class name).
3. The rep submits each continuing student's payment: **student, amount, payment method, date**.
4. The system automatically issues a **unique receipt number**.
5. The payment is recorded centrally against that class and department.

### 6.3 Verification

- On the **admin front**, a staff member can enter a **receipt number** to verify a student's payment record.
- The full payment details are displayed instantly.

### 6.4 Reporting

- Admins can view **dashboards and reports** showing:
  - Total money collected **per department**.
  - Collections **per class / level**.
  - Number of students who have paid versus outstanding.
  - Breakdown of fresher vs continuing-student collections.
  - Exportable (CSV) reports for further analysis.

---

## 7. Organisational Structure Model

```
School of Sciences
│
├── Department of Mathematics
│     └── Classes / Levels (e.g., Level 100, Level 200, ...)
│
├── Department of Biology
│     └── Classes / Levels
│
├── Department of Chemistry
│     └── Classes / Levels
│
├── Department of Physics
│     └── Classes / Levels
│
└── Department of Computer Science
      └── Classes / Levels
```

Each **department** has a **configurable dues amount**, and each **class** has a unique **access code** used by its representative.

---

## 8. Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React (Vite), Tailwind CSS, React Router |
| **Backend** | Node.js, Express (REST API) |
| **Database** | PostgreSQL |
| **Authentication** | JWT (JSON Web Tokens) + bcrypt password hashing |
| **Development** | Git, npm scripts |

This stack produces a **fast, modern, secure web application** that runs in any browser, so it works across the School's existing computers without installing software on each machine.

---

## 9. Proposed Data Model (Summary)

| Table | Purpose |
|-------|---------|
| `users` | Admin accounts (School & Department), roles, password hashes |
| `departments` | Department names and their configurable dues amounts |
| `classes` | Classes/levels within a department, each with a unique access code |
| `students` | Student records (both freshers and continuing students) |
| `payments` | Every dues payment, type (School/Department), amount, method, and unique receipt number |
| `souvenirs` | Inventory of souvenir items |
| `student_souvenirs` | Records of which souvenirs were given to which fresher, and by whom |

---

## 10. Security & Trustworthiness

- **Role-based access control:** School and Department admins only see what they are allowed to.
- **Secure authentication:** Passwords are hashed; sessions use JSON Web Tokens.
- **Unique receipt numbers:** Every payment gets a distinct, hard-to-guess receipt number for verification.
- **Audit trail:** Payments and souvenir distributions record who performed the action and when.
- **Centralised, searchable data:** No fragile paper records; data is safely stored in PostgreSQL.
- **Input validation & rate limiting:** Protects the public class-representative pages from abuse.

---

## 11. Project Timeline (Estimate)

| Phase | Activities | Estimated Duration |
|-------|------------|--------------------|
| **1. Setup** | Project scaffolding, database setup | 0.5 day |
| **2. Backend** | Database schema, authentication, all API routes | 3 days |
| **3. Frontend** | Admin dashboards, rep page, all screens | 4 days |
| **4. Integration & Testing** | End-to-end testing of all flows | 2 days |
| **5. Refinement & Documentation** | Polish, user guide, deployment notes | 1 day |

**Estimated total: ~2 weeks** for the MVP.

---

## 12. Expected Benefits

- **Clear departmental revenue insight** — the School finally knows what each department generates from dues.
- **Faster, accurate collection** — class reps submit dues digitally in seconds.
- **Better souvenir accountability** — every souvenir handed out is recorded.
- **Instant verification** — confirm any payment immediately via a receipt number.
- **No more lost records** — all data is stored securely in one central system.
- **Professional, modern image** — a digital system befitting a School of Sciences.

---

## 13. Next Steps

1. **Dean's approval** of this plan and the proposed scope.
2. **Confirmation of the organisational structure** (final list of departments and their classes/levels).
3. **Acknowledgement of the Student Number / ID format** used to identify students.
4. **Provision of hosting details** (where the system will be deployed after development).
5. Build, test, and roll out of the MVP, followed by training for the School Admin, Department Admins, and Class Representatives.

---

*Prepared for the Dean, School of Sciences, University of Energy and Natural Resources, Sunyani.*
