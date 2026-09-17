# Edge Cases & Known Issues

## Fixed Issues

### Issue 1: School Report Totals ✅
**Status:** FIXED (was already correct in codebase)

The school report totals correctly separate:
- `department_dues`: Sum of all department dues payments
- `school_dues`: Sum of all school dues payments

Department-level reports also correctly show:
- `department_dues_collected`: Department dues for that department
- `school_dues_through_dept`: School dues collected through that department

No changes needed - the reports were already correctly filtering by payment type.

---

### Issue 2: Receipt Souvenirs Not Receipt-Specific ✅
**Status:** FIXED

**Problem:** Souvenirs could be given without being attached to a receipt (receipt_id = NULL), making them not receipt-specific. Verifying a receipt might not show all souvenirs given to a student.

**Solution:**
1. Database migration makes `student_souvenirs.receipt_id` NOT NULL
2. Existing souvenirs with NULL receipt_id are migrated to new $0 "souvenir-only" receipts
3. All souvenir-giving endpoints now create a $0 souvenir-only receipt when souvenirs are given without payment:
   - `POST /students/freshers` (manual fresher registration)
   - `POST /students/:id/admit` (department admission)
   - `POST /freshers/:id/verify` (fresher application verification)
4. Audit log entries use `transaction_type: 'souvenir_distribution'` for souvenir-only receipts

**Result:** Every souvenir is now linked to a specific receipt, making them fully receipt-specific and traceable.

---

### Issue 3: Archived Students Rolled Over Invisibly ✅
**Status:** FIXED (was already correct in codebase)

**Problem:** Archived students might be included in rollover.

**Solution:** The rollover query already filters `WHERE s.is_archived = false`, excluding archived students from the rollover process.

No changes needed - the rollover was already correctly excluding archived students.

---

### Issue 4: Students Retain Old-Level Class After Rollover ✅
**Status:** FIXED (was already correct in codebase)

**Problem:** When a department has multiple classes at the target level, students might retain their old-class assignment.

**Solution:** The `setClassForLevel` function already handles this correctly:
- If exactly one class exists at the target level → assign that class
- If zero or multiple classes exist → clear the class (set to NULL)

The function is called during rollover for all promoted students, ensuring class assignments are updated or cleared appropriately.

No changes needed - the class assignment logic was already correct.

---

### Issue 5: Manual Registration/Admission Receipts Inconsistently Delivered ✅
**Status:** FIXED (was already correct in codebase)

**Problem:** Manual fresher registration and department admission might not return receipt numbers or send emails.

**Solution:** All endpoints already correctly:
- Return `receipt_number` in the response
- Send receipt emails via `sendReceiptEmail()`
- Emit real-time events for new payments

No changes needed - receipt delivery was already consistent.

---

### Issue 6: No Correction/Reversal Workflow for Wrong Payments ✅
**Status:** FIXED

**Problem:** Receipts were effectively permanent; couldn't void individual payment lines with an audit trail.

**Solution:**
1. **Database migration adds payment voiding support:**
   - Added `voided_at`, `voided_by`, `void_reason` columns to `payments` table
   - Added index on `payments(voided_at)` for efficient queries

2. **New endpoint: `POST /api/receipts/:id/void-payment`**
   - Allows voiding individual payment lines within a receipt
   - Requires: `payment_id` and `reason` (min 3 characters)
   - Creates audit log entry with `transaction_type: 'payment_void'`
   - Emits real-time event `payment:voided` with payment details
   - Returns voided payment details in response

3. **Updated duplicate guard:**
   - Payment creation now excludes voided payments (`AND p.voided_at IS NULL`)
   - This allows re-collecting dues after voiding a payment line

4. **Updated receipt verification:**
   - `GET /api/receipts/verify/:number` now excludes voided payment lines
   - Only shows active (non-voided) payments and their souvenirs

**Result:** Administrators can now correct wrong payments by voiding individual payment lines while maintaining a complete audit trail.

---

## Summary Table

| Issue | Status | Changes Required |
|-------|--------|------------------|
| 1. School report totals | ✅ Fixed | None (already correct) |
| 2. Receipt souvenirs | ✅ Fixed | Migration + code updates |
| 3. Archived student rollover | ✅ Fixed | None (already correct) |
| 4. Rollover class retention | ✅ Fixed | None (already correct) |
| 5. Receipt delivery | ✅ Fixed | None (already correct) |
| 6. Payment reversal workflow | ✅ Fixed | Migration + new endpoint |

## Database Migration Required

Run the migration to apply schema changes:
```bash
npm run migrate
# or
node server/src/db/migrate.js
```

This will:
- Make `student_souvenirs.receipt_id` NOT NULL
- Add `voided_at`, `voided_by`, `void_reason` to `payments` table
- Migrate existing NULL-receipt souvenirs to $0 souvenir-only receipts
