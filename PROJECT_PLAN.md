# Dues Management System — v2
## School of Sciences — University of Energy and Natural Resources, Sunyani

> **v2 rebuild.** This document supersedes the v1 plan. The app is being rebuilt from
> scratch because the v1 role model did not match the School's real workflow.
> v1 remains in git history (`4e06ec7`) for reference.

---

## 1. Who does what (the role model)

| Task | School Admin | Dept Admin | Class Rep (no account) |
|------|:---:|:---:|:---:|
| **Register freshers** and assign them to a department | ✅ | ❌ | ❌ |
| Record **School dues + School souvenirs** (at fresher registration) | ✅ | ❌ | ❌ |
| **Admit** freshers assigned to their department | ❌ | ✅ | ❌ |
| Record **Department dues + Department souvenirs** (at fresher admission) | ❌ | ✅ | ❌ |
| Create the department's **levels / classes** | ❌ | ✅ | ❌ |
| **Configure the department's dues amount** | ❌ (view only) | ✅ | ❌ |
| **Configure the department's souvenir list** | ❌ (view only) | ✅ | ❌ |
| Manage the **School souvenir catalogue** | ✅ | ❌ | ❌ |
| Record **continuing-student yearly dues** (free-flow: name + index + email + level/class) | ❌ | ✅ | ✅ (public page) |
| Supervise — verify receipts / reports / audit / school settings | ✅ | dept-scoped | ❌ |

> **Correction (from the School's real workflow):** department-level configuration —
> the department's **dues amount** and its own **souvenir list** — is done by each
> Department Admin. The School Admin only registers freshers and assigns them to a
> department; everything else at School level is supervision (verify, reports,
> audit, school-wide dues amount, school souvenir catalogue, creating
> departments/admins).

**Key rules (hard rules, enforced by the API, not just the UI):**

1. **Only freshers are created at School level.** The School Admin captures the
   fresher's record and assigns them to a department in the same step. No fresher
   exists without a department, and no other role can create one.
2. **Continuing students have no roster.** The students table holds only the
   fresher registration/admission workflow. Nobody creates or maintains rows for
   continuing students — the receipts are the payment record.
3. **Payments are free-flow — no student lookup.** The public rep page and the
   Collect desk take the payer's **name + index number + email**, the **level**
   (and the **class** when that level has classes) and the **dues being paid**,
   then confirm on a separate screen. The payment is written straight to the
   records: the receipt snapshots the typed name/index/email/level with
   `student_id = NULL` and the receipt email goes to the captured address, so
   a payer never has to exist beforehand — reports and the public records lookup
   aggregate everything by index number.
4. **Departments own their structure.** Each Dept Admin creates their own
   levels/classes. A class may be a whole level (e.g. "Level 200") or one of
   several classes within a level (e.g. "Level 200 A", "Level 200 B").
5. **The public rep page is keyed by department code, not class code.** The rep
   enters the department code, then picks the class from that department's list.
   One code per department.

---

## 2. The two collection flows

### 2.1 Freshers (first day)

```
School Admin                  Dept Admin
────────────                  ──────────
1. Register fresher
   (name, student number)
2. Assign fresher to a
   department  ──────────────►  appears in that dept's
3. Record SCHOOL DUES              "assigned freshers" queue
   + School souvenirs
                                4. Admit the fresher
                                   (pick class/level)
                                5. Record DEPARTMENT DUES
                                   + Department souvenirs
```

- Freshers therefore receive **two receipts across the two steps** — a School
  receipt at registration and a Department receipt at admission — because the two
  collections happen at different times.
- A fresher's admission status is `pending` until their department admits them.

### 2.2 Continuing students (every year)

- **There is no roster.** Continuing students are never listed, added or
  imported — each payment simply lands in the records with the typed payer
  details snapshotted on the receipt.
- Continuing students pay **School dues AND Department dues every year**.
- Collection is **free-flow** on the **class rep public page** (dept code → PIN)
  or the Dept Admin's **Collect** page: enter name + index number, pick the level
  (and class when the level has classes), pick the dues, confirm — no lookup.
- One collection session = **one itemized receipt** (one receipt
  number) listing the School dues portion and the Department dues portion. That
  single receipt can be verified by **both** the School and the Department.

---

## 3. Dues & money

| What | Amount source | Who sets it |
|------|---------------|-------------|
| School dues (per student, per year) | **One school-wide amount** in Settings | School Admin |
| Department dues (per student, per year) | **One amount per department** (`departments.dues_amount`) | **Department Admin** (its own department) |

- Souvenirs are split the same way: the **School souvenir catalogue** (given at
  fresher registration) is managed by the School Admin; each department keeps and
  configures its **own souvenir list** (given at fresher admission), and only a
  department's own items can be handed out when its freshers are admitted.

- Amounts auto-fill on collection forms (from the school-wide amount / the
  department's amount) but remain editable at the time of collection.
- Payment methods: `cash`, `momo`.

---

## 4. Receipts

- Every collection event creates a **receipt** with a unique receipt number
  (`SOS-DUES-<TAG>-<index>-<n>`) and one or more itemized **payment lines**:
  - School-dues-only receipt (fresher registration)
  - Department-dues-only receipt (fresher admission)
  - Combined receipt with both lines (continuing-student yearly collection)
- A receipt is shown on screen, e-mailed (dev mode logs it), and can be looked up
  on the admin **Verify** page by receipt number.
- School Admin can verify any receipt; Dept Admin can verify receipts issued in
  their department.

---

## 5. Reporting

- School Admin: school-wide — totals per department (department-dues revenue),
  total school dues, distinct payers and receipts per class/level, fresher
  admission counts, CSV export, monthly trend, audit log.
- Dept Admin: department-scoped equivalents (their own classes/levels and
  department-dues revenue).

---

## 6. Technology (unchanged from v1)

| Layer | Tech |
|-------|------|
| Frontend | React (Vite), custom CSS (Baloo 2), React Router, axios |
| Backend | Node.js, Express REST API |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| Extras | `express-rate-limit` on public rep routes, audit `transaction_log` |

---

## 7. Data model (v2 summary)

| Table | Purpose / notable change |
|-------|--------------------------|
| `settings` | Key/value store, e.g. `school_dues_amount` |
| `departments` | Name, **public `code`** (for the rep page), `dues_amount` |
| `classes` | Owned by a department (`department_id`), has `level` + `name`; a department can have several classes in one level |
| `users` | `school_admin` / `dept_admin` (dept admins bound to one department) |
| `students` | Name, unique `student_no`, `is_fresher`, `department_id`, `class_id`, `admitted_at/admitted_by` (fresher lifecycle) |
| `receipts` | One per collection event; unique `receipt_number`, method, `record_type` (`admin`/`rep`). **Free-flow receipts** snapshot `student_name`, `student_no`, `payer_email`, `level` with `student_id = NULL`; student-linked receipts keep the FK and readers COALESCE both sources |
| `payments` | Itemized lines under a receipt: `type` (`school_dues`/`department_dues`), amount, dept/class |
| `souvenirs` | Catalog: `category` (`school`/`department`); department souvenirs carry a `department_id` (each department owns its list) |
| `student_souvenirs` | Which souvenirs a fresher received, at which level, by whom |
| `transaction_log` | Audit trail |

---

## 8. Pages (client routes)

| Route | Page | Role |
|-------|------|------|
| `/` | Landing — enter department code | Public |
| `/rep/:code` | Class rep collection form (free-flow, no student lookup) | Public |
| `/login` | Login | Public |
| `/admin` | Dashboard | School / Dept |
| `/admin/freshers` | Register freshers + assign dept (School); assigned-freshers admit queue (Dept) | Both, role-aware |
| `/admin/collect` | Record continuing-student yearly dues (combined receipt) | Dept |
| `/admin/verify` | Verify receipt by number | Both, role-aware |
| `/admin/reports` | Reports + CSV export | Both, role-aware |
| `/admin/settings` | School Admin: school-wide dues, school souvenirs, departments (read-only view), admins | Dept Admin: own dues amount, own souvenir list, own classes, rep code |
| `/admin/audit` | Audit log | School |

---

## 9. Security & trust

- Role-based access control enforced in the API middleware (school-only /
  dept-scoped / public-rep).
- Public rep endpoints are rate-limited and, once unlocked with the department
  PIN, only ever write free-flow payment records for their own department.
- JWT auth, bcrypt-hashed passwords, unique receipt numbers, audit trail for
  every payment/fresher action.
