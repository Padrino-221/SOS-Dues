# Course representative dues collection form

This standalone Google Apps Script creates a Google Form, its linked response spreadsheet and an office **Receipt Queue**. It follows the collection fields in `client/src/pages/RepPage.jsx` and `server/src/routes/rep.js`. It does not issue receipts, send email, accept payments or change the production database.

## Create the form link

1. Sign in to the school Google account that should own the form and open [Google Apps Script](https://script.google.com/). Create a new project named **School of Sciences — Dues Collection**.
2. Replace the contents of `Code.gs` with the supplied `Code.gs` file and save.
3. Check `DUES_FORM_CONFIG` at the top. The supplied departments, rates and **2026/2027** academic year were checked against Dues Management on **4 November 2026**. Mathematics and Statistics currently have no configured department rate; collections for these are flagged for office review.
4. Select **createDuesCollectionForm** in the function dropdown and click **Run**. Authorise the requested Forms, Sheets and trigger permissions using the owning account. No email-sending permission is requested.
5. Open the execution log. Copy **form_url**: this is the link for course reps. **edit_url** and **spreadsheet_url** are private office links. They also appear in the spreadsheet's **Setup & links** tab.
6. In Google Forms, check the publishing/responder access settings and restrict access to the authorised reps where your Google account permits. Share only the responder link. Rep names and emails typed into this form do not verify identity; this form does not use the Dues system's department PIN.
7. Submit one clearly identified test collection, check both the raw responses tab and **Receipt Queue**, then mark the test queue row **REJECTED** with an office note. Test each dues branch before distributing the link.

The live Google Form URL is created only when you run the script in your Google account. A web-app deployment is not required. If you prefer explicit permissions, enable **Show appsscript.json manifest file** in Project Settings and use the supplied manifest.

## What reps record

Each submission records one collection for one student: rep details, department and class; student name, index number and receipt email entered twice; current level and level being paid for; payment method and optional reference/date; school dues, department dues or both; and confirmation that the money was received. Partial payments and arrears are supported. Continuing students' numbers need not start with UA. Amounts are entered in GHS with at most two decimal places and validated against the application's current per-line limit.

Students' receipt emails are kept separate from reps' contact emails. The academic year is fixed for the form. A blank collection date uses the submission date. The form collects records only: reps must not enter PINs, passwords or payment-card details.

## Office review and later receipt processing

The linked raw responses preserve the original submissions. **Receipt Queue** adds validated, normalised fields for later processing, including the application's `school_dues` / `department_dues` item types, department codes, payment levels, a stable source ID and a 70-character idempotency key. Keep the queue column headers unchanged.

- Every row starts with **PENDING**, **NOT_ISSUED** and **NOT_SENT**. Nothing is automatically approved.
- Check `validation_status`, `validation_notes`, `review_flags` and `possible_duplicate_of`. Email mismatches, invalid dates and other inconsistencies are held as **INVALID**. Forms cannot check matching email fields before submission; the queue performs that check.
- Verify the actual collection, student, department, dues balance and email against school records. Google Forms does not look up students or previous payments in Dues Management.
- A possible duplicate is flagged, never removed: it may be a separate instalment. Trigger retries with the same source response ID do not append another row or overwrite office decisions.
- An authorised reviewer can set **APPROVED** or **REJECTED**, and fill `reviewed_by`, `reviewed_at` and `office_notes`. Share spreadsheet editing access only with authorised reviewers. Reject an incorrect submission and submit a corrected one; retain the original for audit.
- A future bulk receipt tool should require **VALID + APPROVED + NOT_ISSUED**, use the idempotency key, obtain the official receipt number from Dues Management, and email the **email** column (the student), not `rep_email`. Receipt-number and sent-date fields intentionally remain blank for now.

## Recovery and academic-year changes

The script installs one form-submit trigger. If raw responses exist without queue rows, run **reconcileDuesResponses** manually. It recovers up to 250 missing responses per form per run and logs the remaining count; repeat until zero. Existing rows, reviews and receipt statuses are preserved. Check Apps Script **Executions** for trigger failures.

Running **createDuesCollectionForm** again returns the same form for that academic year. It does not reset submissions or reopen a form deliberately closed after initial setup. **getDuesFormLinks** logs the existing links. Keep the Apps Script project and its Script Properties: these contain the stable question mapping and form registry. Do not delete/recreate questions on a live form; matching uses question IDs.

For a new academic year, update the configuration and run the creation function: it creates a separate form and sheet and retains the earlier form's processing metadata. Close the old form in Google Forms when collections end. Updating configuration alone does not alter an existing year's form or its rate snapshot.

## Validation

Local tests exercise validation, branch handling, partial payments, arrears, duplicate handling and recovery. Google authorisation, publishing and real trigger delivery require the owner-account test in step 7; they cannot be verified offline.

Run local checks with Node.js: `node --test tools/google-forms/tests/generator.test.cjs` from the Dues Management folder.

API references: [Forms service](https://developers.google.com/apps-script/reference/forms/form), [page navigation semantics](https://developers.google.com/apps-script/reference/forms/page-break-item), [form-submit events](https://developers.google.com/apps-script/guides/triggers/events), [text validation](https://developers.google.com/apps-script/reference/forms/text-validation-builder).
