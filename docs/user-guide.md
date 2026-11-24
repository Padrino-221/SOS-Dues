# User Guide — Dues Management

A practical guide for freshers, class representatives, school administrators,
and department administrators.

## 1. At a glance

| I want to… | Go to | Account needed |
|---|---|---|
| Pre-register as a fresher | `/apply` | No |
| Check my payment history | `/records` | No — index number |
| Collect dues as a class rep | `/rep/<department-code>` | No — department PIN |
| Sign in to the admin area | `/login` | Yes |
| Register or admit freshers | `/admin/freshers` | Yes |
| Collect continuing-student dues | `/admin/collect` | Yes — department admin |
| Find or verify a receipt | `/admin/receipts`, `/admin/verify` | Yes |
| View reports | `/admin/reports` | Yes |
| Review audit history | `/admin/audit` | Yes — school admin |

All money is collected **offline** (cash or mobile money) and recorded in the
system. The app does not process payments.

## 2. Freshers

### Pre-registration

1. Open `/apply`.
2. Enter your full name, student number, phone, email, programme, gender,
   hometown, and admission year.
3. Submit. Your application is stored as **pending** for school review.
4. Keep your student number safe; it is used on every receipt.

Pre-registration does not register you as a student by itself. A School Admin
must verify the application and complete registration.

### Checking your payment history

1. Open `/records`.
2. Enter your index/student number.
3. Review the receipts and their itemized lines.

This page looks up receipt records; it is not a student roster and does not show
unpaid balances.

## 3. Class representatives

Class representatives collect continuing-student dues from a public page — no
account is required.

1. Get the department code and PIN from the department admin.
2. Open `/rep/<department-code>` (or choose the department on the landing page).
3. Enter the department PIN to unlock the form.
4. Enter the payer's name, index number, email, level, dues being paid, amounts,
   and payment method.
5. Review the summary carefully.
6. Confirm. The system creates an itemized receipt and reserves the next receipt
   number.

Rules:

- Do not share the department PIN outside authorised collection work.
- Use the payer's real index number; receipt numbering is tied to it.
- If the page says a matching payment already exists, check with the payer
  before recording another one.
- A representative cannot void receipts; ask a department admin.

## 4. Signing in

1. Open `/login`.
2. Enter your staff email and password.
3. You land on the dashboard or the page you originally requested.

Roles:

| Role | Main use |
|---|---|
| `super_admin` | Cross-school administration |
| `school_admin` | School-wide registration, receipts, reports, users, audit |
| `school_staff` | School-side operational access |
| `dept_admin` | Department admission, dues, souvenirs, receipts, reports |
| `dept_staff` | Department operational access |

## 5. School administrators

### Verifying pre-registrations and registering freshers

1. Open `/admin/freshers`.
2. Review pending pre-registration applications.
3. Verify the application after checking the details.
4. Register the fresher and assign the correct department.
5. Record **School dues** and any **School souvenirs** issued.
6. Confirm. This creates a School receipt (`SCH`).
7. The fresher now appears in the assigned department's admission queue.

### Monitoring departments

Use the dashboard and **Students** to review registrations, admissions, and
payment activity across departments. Use **Settings** to maintain departments,
school dues, souvenirs, and “Other Dues”.

### Receipts

- **Receipts** lists collection events. Open one to see payer details, itemized
  lines, souvenirs, and void history.
- **Verify** checks whether a receipt number is valid.
- You can resend a receipt email when SMTP is configured.
- Voiding keeps the receipt in the audit trail; it does not erase history.

### Reports and audit

- **Reports** shows school-wide totals, filters, department breakdowns, and CSV
  export.
- **Audit** shows who did what and when. Use it for reconciliation and dispute
  investigation.
- **Data Health** flags incomplete “Other Dues”, receipt total mismatches, and
  duplicate pre-registration numbers. Fix these before closing a collection
  period.

## 6. Department administrators

### Admitting freshers

1. Open `/admin/freshers` (shown as **Admit Freshers** for department accounts).
2. Select a fresher assigned to your department.
3. Choose the correct level (100–400).
4. Record **Department dues** and any **Department souvenirs** issued.
5. Confirm admission. This creates a Department receipt (`DEPT`).
6. Send or resend the receipt email if configured.

Only admit students assigned to your own department. The school-side receipt and
the department-side receipt are separate collection events.

### Collecting continuing-student dues

1. Open `/admin/collect`.
2. Enter who is paying: name, index number, email, and level.
3. Select the dues being paid: school, department, and/or extra items.
4. Choose **cash** or **momo**.
5. Review the total and lines.
6. Confirm. The receipt is created and the receipt number is reserved.

A combined school + department payment produces a `FULL` receipt. Department-only
payments produce `DEPT`; school-only payments produce `SCH`.

### Students and the verification queue

The **Students** page holds fresher/student records and the class-representative
verification queue. Use it to:

- review rep-recorded payments;
- correct student details;
- transfer a student to another department (where permitted);
- resend receipt emails;
- delete a student record when appropriate.

“Force delete” permanently removes the student and their receipts. Use it only
after confirming with a school administrator.

### Receipts

Department admins and department staff can browse and inspect their department's
receipts. Void a receipt or a single line when a collection was recorded in
error; always give an accurate reason. Voids are auditable and do not delete the
original row.

### Reports

Department reports are scoped to your department. Filter by date and academic
year, review totals and breakdowns, and export CSV where offered.

### Settings

Maintain department dues, souvenirs, “Other Dues”, and the class-representative
PIN. Changing the PIN immediately invalidates the old one for new rep sessions.

## 7. Receipt numbers

Receipt numbers look like:

```
SOS-DUES-FULL-UEB3227523-4
SOS-DUES-SCH-UEB3227523-5
SOS-DUES-DEPT-UEB3227523-6
```

| Part | Meaning |
|---|---|
| `SOS-DUES` | School of Sciences dues |
| `SCH` | School dues only |
| `DEPT` | Department dues / extra dues only |
| `FULL` | School + department combined |
| `UEB3227523` | Payer's index number |
| `4` | Lifetime sequence for that index number |

The sequence is shared across all tags, so a payer's 4th receipt is `-4`
regardless of type.

## 8. Roles and permissions

| Capability | Class rep | Dept staff | Dept admin | School staff | School admin |
|---|---|---|---|---|---|
| Pre-register as fresher | Public | — | — | — | — |
| Look up own receipts | Public | — | — | — | — |
| Record rep collection | PIN | — | — | — | — |
| Admit freshers | — | — | Yes | — | — |
| Register freshers / School dues | — | — | — | — | Yes |
| Collect continuing dues | — | — | Yes | — | — |
| Browse receipts | — | Yes | Yes | — | Yes |
| Void receipts | — | — | Yes | — | Yes |
| Reports | — | — | Dept | — | School |
| Data Health | — | — | — | — | Yes |
| Audit log | — | — | — | — | Yes |
| Manage settings/PINs | — | — | Dept | — | School |

## 9. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Rep page rejects the PIN | Wrong code/PIN or PIN changed | Confirm both with the department admin |
| “Add a student number before recording a receipt” | Index number blank | Enter the payer's real index number |
| Receipt number conflict | Concurrent collection on the same index | Retry; the advisory lock should resolve it |
| Duplicate payment warning | A matching receipt already exists | Check with the payer before recording |
| Receipt email not received | SMTP not configured or wrong email | Check the payer email; ask an admin to verify mail settings |
| Fresher missing from admission queue | Not registered/assigned yet, or wrong department | School admin should confirm registration and department |
| Report totals look wrong | Voided lines included/excluded by filter, or year filter | Clear filters; check the void history |
| “Only administrators can…” | Role lacks permission | Use the correct role or ask a school admin |
| Data Health shows mismatches | Receipt total ≠ sum of lines | Review the flagged receipts before reconciling |

## 10. Privacy and support

- Receipts, reports, and exports contain names, index numbers, emails, and
  payment details. Share only with authorised staff.
- Do not post receipt screenshots or department PINs publicly.
- Keep paper/offline records reconciled with the audit log.
- Freshers: contact the School Admin for registration issues.
- Continuing students: contact the department admin or class representative.
- Staff: escalate suspected duplicate receipts or missing payments to a school
  administrator before voiding anything.
