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
| Add **continuing students** (single or bulk CSV import) | ❌ | ✅ | ❌ |
| Create the department's **levels / classes** | ❌ | ✅ | ❌ |
| **Configure the department's dues amount** | ❌ (view only) | ✅ | ❌ |
| **Configure the department's souvenir list** | ❌ (view only) | ✅ | ❌ |
| Manage the **School souvenir catalogue** | ✅ | ❌ | ❌ |
| Record **continuing-student yearly dues** (School + Dept portions) | ❌ | ✅ | ✅ (public page) |
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
2. **Continuing students are created only by their department** (Dept Admin),
   individually or by bulk CSV import. The School Admin never creates continuing
   students.
3. **Reps never create students.** The public rep page works strictly on students
   already in the system. If a student number is not found, the page says the
   student must first be added by their department admin.
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

- Dept Admin adds continuing students to their department (single add, or
  **bulk CSV import** — upload, **preview** which rows are valid, then confirm).
- Continuing students pay **School dues AND Department dues every year**.
- Collection happens through the **class rep public page** (dept code → class)
  or by the Dept Admin in the dashboard.
- One collection session = **one combined, itemized receipt** (one receipt
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
- Payment methods: `cash`, `momo`, `bank`.

---

## 4. Receipts

- Every collection event creates a **receipt** with a unique receipt number
  (`UENR-…`) and one or more itemized **payment lines**:
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
  total school dues, per class/level, fresher vs continuing split, CSV export,
  monthly trend, audit log.
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
| `receipts` | One per collection event; unique `receipt_number`, student, method, `record_type` (`admin`/`rep`) |
| `payments` | Itemized lines under a receipt: `type` (`school_dues`/`department_dues`), amount, dept/class |
| `souvenirs` | Catalog: `category` (`school`/`department`); department souvenirs carry a `department_id` (each department owns its list) |
| `student_souvenirs` | Which souvenirs a fresher received, at which level, by whom |
| `transaction_log` | Audit trail |

---

## 8. Pages (client routes)

| Route | Page | Role |
|-------|------|------|
| `/` | Landing — enter department code | Public |
| `/rep/:code` | Class rep collection form (existing students only) | Public |
| `/login` | Login | Public |
| `/admin` | Dashboard | School / Dept |
| `/admin/freshers` | Register freshers + assign dept (School); assigned-freshers admit queue (Dept) | Both, role-aware |
| `/admin/students` | Continuing students: list, add single, bulk import w/ preview | Dept |
| `/admin/collect` | Record continuing-student yearly dues (combined receipt) | Dept |
| `/admin/verify` | Verify receipt by number | Both, role-aware |
| `/admin/reports` | Reports + CSV export | Both, role-aware |
| `/admin/settings` | School Admin: school-wide dues, school souvenirs, departments (read-only view), admins | Dept Admin: own dues amount, own souvenir list, own classes, rep code |
| `/admin/audit` | Audit log | School |

---

## 9. Security & trust

- Role-based access control enforced in the API middleware (school-only /
  dept-scoped / public-rep).
- Public rep endpoints are rate-limited and **never create students**.
- JWT auth, bcrypt-hashed passwords, unique receipt numbers, audit trail for
  every payment/student action.
