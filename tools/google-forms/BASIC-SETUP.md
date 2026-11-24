# Basic form — use this version

1. Create a **new** project at https://script.google.com/ so the earlier script does not interfere.
2. Paste only `BasicForm.gs` into Code.gs and save.
3. Select **createBasicDuesForm**, click **Run** and authorise it.
4. Copy **FORM LINK FOR COURSE REPS** from the execution log. Keep the edit and spreadsheet links private.
5. Check responder access in Google Forms before sharing. Submit a test response and check the linked spreadsheet.

This version uses department names only, one page, no custom queue and no triggers. Each response records one student's collection. Reps leave an unused dues amount blank. Both amount fields are optional to allow school-only or department-only payments; Google Forms cannot require at least one of two text fields, so office reviewers must check that at least one amount was supplied before issuing receipts. Amounts are positive GHS values with at most two decimal places; the office must check the applicable dues rates and balances.

The response sheet captures submission time, rep details, student name/index/email, department/class, current level, level being paid for, separate dues amounts and payment method/reference. These support a later reviewed bulk receipt process. No receipts or emails are generated now. Typed rep emails are not verified identities; restrict form access where your Google account allows it. Do not collect department codes or PINs.

The fixed academic year is **2026/2027**. Updating the script after creation does not update existing form questions; use the Google Forms editor to change wording. Running the function again returns the same form and enables responses. Avoid rerunning it if you intentionally closed the form.
