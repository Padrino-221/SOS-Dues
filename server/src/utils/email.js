/**
 * Email receipt utility.
 *
 * In production, configure SMTP via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * If no SMTP is configured, emails are logged to console (dev mode).
 */

let transporter = null;
let warnedIncomplete = false;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    // Dev mode: no SMTP configured, just log
    return null;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const authRequired = process.env.SMTP_AUTH !== 'false';

  // A host without credentials (e.g. a half-filled .env) would only produce
  // auth failures, so stay in dev mode and warn once instead of breaking
  // every receipt. Set SMTP_AUTH=false for an unauthenticated relay.
  if (authRequired && (!user || !pass)) {
    if (!warnedIncomplete) {
      warnedIncomplete = true;
      console.warn(
        '[EMAIL] SMTP_HOST is set but SMTP_USER/SMTP_PASS are missing — receipt emails stay in dev mode until credentials are added.'
      );
    }
    return null;
  }

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    ...(authRequired ? { auth: { user, pass } } : {}),
  });
  return transporter;
}

const TYPE_LABEL = {
  school_dues: 'School Dues',
  department_dues: 'Department Dues',
};

const FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// The institution operates in Ghana (GMT+0, no DST). Format receipt times in
// that zone so the email never shows a time skewed by the server's own zone.
const INSTITUTION_TIME_ZONE = 'Africa/Accra';

// Date-only inputs (from the date picker) are stored at 00:00, so show just the
// date for those and date + time only for real timestamps. This prevents a
// payment recorded with only a date from showing a false time like "1:00 AM".
function formatPaymentDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = d.toLocaleDateString('en-GB', {
    timeZone: INSTITUTION_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-GB', {
    timeZone: INSTITUTION_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  return timeStr === '00:00' ? dateStr : `${dateStr}, ${timeStr}`;
}

/**
 * Generate responsive HTML receipt email matching system design system.
 */
function generateReceiptHtml({
  studentName,
  studentNo,
  receiptNumber,
  paidAt,
  methodLabel,
  numericTotal,
  safeLines,
  safeSouvenirs,
  departmentName,
  souvenirOnly,
  subject,
}) {
  const formattedDate = formatPaymentDate(paidAt);

  const linesRowsHtml = safeLines.length
    ? safeLines
        .map(
          (l) => `
          <tr>
            <td style="padding:10px 14px; font-size:13px; color:#3d3a33; border-bottom:1px solid #e6e2d8;">${
              TYPE_LABEL[l.type] || l.type
            }</td>
            <td align="right" style="padding:10px 14px; font-size:13px; font-weight:600; color:#171714; border-bottom:1px solid #e6e2d8;">GHS ${Number(
              l.amount
            ).toFixed(2)}</td>
          </tr>`
        )
        .join('')
    : `
      <tr>
        <td colspan="2" style="padding:10px 14px; font-size:13px; color:#9b9587; text-align:center;">(no payment lines)</td>
      </tr>`;

  const souvenirsHtml = safeSouvenirs.length
    ? `
      <div style="font-size:11px; font-weight:800; color:#1d2a5e; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">
        Souvenirs Handed Out
      </div>
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#e2f0e4; border:1px solid #bfdcc4; margin-bottom:24px;">
        <tr>
          <td style="padding:14px 16px;">
            <div style="font-size:12px; font-weight:700; color:#2e5f38; margin-bottom:8px;">
              Items Received:
            </div>
            <div>
              ${safeSouvenirs
                .map(
                  (s) =>
                    `<span style="display:inline-block; background-color:#ffffff; color:#2e5f38; border:1px solid #3e7d49; font-size:12px; font-weight:700; padding:4px 10px; margin-right:6px; margin-bottom:6px;">✓ ${s}</span>`
                )
                .join('')}
            </div>
          </td>
        </tr>
      </table>`
    : '';

  const amountBadgeHtml = souvenirOnly
    ? `<div style="font-size:13px; font-weight:700; color:#8f6618; margin-top:6px;">
        Souvenir Collection Receipt
      </div>`
    : `<div style="font-size:15px; font-weight:700; color:#8f6618; margin-top:6px;">
        Amount Paid: GHS ${numericTotal.toFixed(2)}
      </div>`;

  const paymentSummaryRows = `
    <tr>
      <td style="padding:10px 14px; background-color:#f1efe8; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; width:40%; border-bottom:1px solid #e6e2d8;">Student Name</td>
      <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#171714; border-bottom:1px solid #e6e2d8;">${studentName}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; background-color:#f1efe8; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; border-bottom:1px solid #e6e2d8;">Student Number</td>
      <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#171714; border-bottom:1px solid #e6e2d8;">${studentNo || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; background-color:#f1efe8; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; border-bottom:1px solid #e6e2d8;">Date & Time</td>
      <td style="padding:10px 14px; font-size:13px; color:#171714; border-bottom:1px solid #e6e2d8;">${formattedDate}</td>
    </tr>
    ${
      !souvenirOnly
        ? `
    <tr>
      <td style="padding:10px 14px; background-color:#f1efe8; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; border-bottom:1px solid #e6e2d8;">Payment Method</td>
      <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#171714; border-bottom:1px solid #e6e2d8;">${methodLabel}</td>
    </tr>`
        : ''
    }
    ${
      departmentName
        ? `
    <tr>
      <td style="padding:10px 14px; background-color:#f1efe8; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase;">Department</td>
      <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#171714;">${departmentName}</td>
    </tr>`
        : ''
    }
  `;

  const breakdownSectionHtml = souvenirOnly
    ? ''
    : `
      <div style="font-size:11px; font-weight:800; color:#1d2a5e; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">
        Itemized Dues Breakdown
      </div>
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid #e6e2d8; margin-bottom:24px; border-collapse:collapse;">
        <thead>
          <tr style="background-color:#f1efe8;">
            <th align="left" style="padding:10px 14px; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; border-bottom:1px solid #e6e2d8;">Item Description</th>
            <th align="right" style="padding:10px 14px; font-size:11px; font-weight:800; color:#66665f; text-transform:uppercase; border-bottom:1px solid #e6e2d8;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${linesRowsHtml}
          <tr style="background-color:#1d2a5e; color:#ffffff;">
            <td style="padding:12px 14px; font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Total Amount Paid</td>
            <td align="right" style="padding:12px 14px; font-size:15px; font-weight:800; color:#e2bd4e;">GHS ${numericTotal.toFixed(
              2
            )}</td>
          </tr>
        </tbody>
      </table>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <!-- Plus Jakarta Sans. Web fonts are honoured by Apple Mail / iOS Mail;
       other clients (Gmail web, Outlook) fall back to the system stack. -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    body, table, td, th, div, p, span, a { font-family: ${FONT_STACK} !important; }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f7f5f1; font-family:${FONT_STACK}; -webkit-font-smoothing:antialiased; color:#171714;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f7f5f1; padding: 24px 12px;">
    <tr>
      <td align="center" style="font-family:${FONT_STACK};">
        <!-- Main Card -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border:1px solid #e6e2d8; border-collapse:separate; text-align:left;">
          
          <!-- Navy & Gold Header Banner -->
          <tr>
            <td style="background-color:#0f1633; padding:24px 28px; border-bottom:3px solid #b5852b; color:#ffffff;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size:11px; font-weight:800; color:#e2bd4e; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">
                      University of Energy and Natural Resources
                    </div>
                    <div style="font-size:18px; font-weight:800; color:#ffffff; letter-spacing:-0.3px; margin:0;">
                      SCHOOL OF SCIENCES
                    </div>
                    <div style="font-size:12px; color:rgba(255,255,255,0.7); margin-top:2px;">
                      Dues Management System • Official Receipt
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:28px 28px 20px 28px; font-family:${FONT_STACK};">
              <!-- Greeting -->
              <p style="font-size:15px; font-weight:600; color:#1d2a5e; margin:0 0 12px 0;">
                Dear ${studentName},
              </p>
              <p style="font-size:14px; color:#57534a; line-height:1.5; margin:0 0 20px 0;">
                ${
                  souvenirOnly
                    ? 'Your souvenir collection has been recorded successfully. Below are the details for your records.'
                    : 'Your dues payment has been recorded successfully. Below is your official itemized receipt statement.'
                }
              </p>

              <!-- Receipt Highlight Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:24px; background-color:#f8f2e0; border:1px dashed #b5852b; text-align:center;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:11px; font-weight:800; color:#8f6618; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">
                      Receipt Number
                    </div>
                    <div style="font-size:20px; font-weight:800; color:#1d2a5e; letter-spacing:-0.5px; word-break:break-all;">
                      ${receiptNumber}
                    </div>
                    ${amountBadgeHtml}
                  </td>
                </tr>
              </table>

              <!-- Student & Payment Info Table -->
              <div style="font-size:11px; font-weight:800; color:#1d2a5e; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">
                Payment Summary
              </div>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid #e6e2d8; margin-bottom:24px; border-collapse:collapse;">
                ${paymentSummaryRows}
              </table>

              <!-- Dues Breakdown Table -->
              ${breakdownSectionHtml}

              <!-- Souvenirs Section -->
              ${souvenirsHtml}

              <!-- Verification Notice -->
              <p style="font-size:12px; color:#66665f; line-height:1.5; margin:0 0 16px 0; background-color:#f1efe8; padding:12px 14px; border-left:3px solid #b5852b;">
                Please keep this receipt for your records. It can be verified at any time by the School of Sciences or your department administration.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f7f5f1; padding:18px 28px; border-top:1px solid #e6e2d8; text-align:center; font-size:11px; color:#7d7868; line-height:1.5;">
              <strong style="color:#1d2a5e;">School of Sciences, UENR Sunyani</strong><br>
              Dues Management System • Official Electronic Statement
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an itemized receipt email for a collection.
 *
 * @param {object} opts
 * @param {string} opts.studentName
 * @param {string} opts.studentNo
 * @param {string} opts.receiptNumber
 * @param {Date}   opts.paidAt
 * @param {string} opts.method
 * @param {number} opts.total
 * @param {Array<{type:string, amount:number}>} opts.lines
 * @param {string[]} [opts.souvenirs] Souvenir names handed out with this receipt
 * @param {string} [opts.departmentName]
 * @param {string} [opts.to]  Optional explicit recipient email (defaults to fallback config)
 * @returns {Promise<{sent:boolean, mode:'sent'|'dev'|'skipped'|'error', to:string|null, html?:string, error?:string}>}
 */
async function sendReceiptEmail({
  studentName,
  studentNo,
  receiptNumber,
  paidAt,
  method,
  total,
  lines,
  souvenirs,
  departmentName,
  to,
}) {
  const numericTotal = Number(total) || 0;
  const safeLines = Array.isArray(lines) ? lines : [];
  // A receipt with no money and no payment lines is a souvenir-only receipt;
  // label it as such instead of sending a misleading "GHS 0.00" dues email.
  const souvenirOnly = numericTotal <= 0 && safeLines.length === 0;

  const subject = souvenirOnly
    ? `Souvenir Receipt — ${receiptNumber}`
    : `Dues Receipt — ${receiptNumber}`;

  const lineText = safeLines.length
    ? safeLines
        .map((l) => `  ${TYPE_LABEL[l.type] || l.type}:  GHS ${Number(l.amount).toFixed(2)}`)
        .join('\n')
    : '  (no payment lines)';
  const methodLabel = method ? String(method).toUpperCase() : 'N/A';
  const safeSouvenirs = (Array.isArray(souvenirs) ? souvenirs : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  // Only mention souvenirs when some were handed out with this receipt.
  const souvenirText = safeSouvenirs.length
    ? `\nSouvenirs:\n${safeSouvenirs.map((s) => `  ${s}`).join('\n')}\n`
    : '';

  const textBody = souvenirOnly
    ? `
Dear ${studentName},

Your souvenir collection has been recorded.

Receipt Number:  ${receiptNumber}
Student Number:  ${studentNo || 'N/A'}
Date:            ${formatPaymentDate(paidAt)}
${departmentName ? `Department:      ${departmentName}\n` : ''}${souvenirText}
Please keep this receipt for your records. It can be verified by the
School of Sciences or your department.

— School of Sciences, UENR Sunyani
  Dues Management System
`
    : `
Dear ${studentName},

Your dues payment has been recorded successfully.

Receipt Number:  ${receiptNumber}
Student Number:  ${studentNo || 'N/A'}
Amount Paid:     GHS ${numericTotal.toFixed(2)}
Payment Method:  ${methodLabel}
Payment Date:    ${formatPaymentDate(paidAt)}
${departmentName ? `Department:      ${departmentName}\n` : ''}
Breakdown:
${lineText}
${souvenirText}
Please keep this receipt for your records. It can be verified by the
School of Sciences or your department.

— School of Sciences, UENR Sunyani
  Dues Management System
`;

  const htmlBody = generateReceiptHtml({
    studentName,
    studentNo,
    receiptNumber,
    paidAt,
    methodLabel,
    numericTotal,
    safeLines,
    safeSouvenirs,
    departmentName,
    souvenirOnly,
    subject,
  });

  return dispatchEmail(to || studentNo, subject, textBody, htmlBody, to);
}

/**
 * Internal: dispatch email or log to console in dev mode.
 * Sends to the caller-provided recipient when available; otherwise falls back
 * to RECEIPT_EMAIL_TO or the SMTP user. Never sends outside the configured
 * domain unless an explicit recipient (e.g. a student's email) is supplied.
 *
 * Always resolves with a result object; it never throws, so a failed email
 * can never break the request that triggered it.
 */
async function dispatchEmail(identifier, subject, textBody, htmlBody, explicitTo) {
  const transport = getTransporter();
  const fallbackTo = process.env.RECEIPT_EMAIL_TO || process.env.SMTP_USER;
  const to = explicitTo || fallbackTo;

  if (!transport) {
    console.log(`[EMAIL DEV MODE] To: ${to || 'no-recipient'} | Subject: ${subject}`);
    console.log(textBody);
    return { sent: false, mode: 'dev', to: to || null, html: htmlBody };
  }

  if (!to) {
    console.warn(`Email skipped for ${identifier}: no recipient configured`);
    return { sent: false, mode: 'skipped', to: null, error: 'No recipient configured' };
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    console.log(`Email sent: ${subject} → ${to}`);
    return { sent: true, mode: 'sent', to };
  } catch (err) {
    console.error(`Email send failed for ${identifier} (${to}):`, err.message);
    return { sent: false, mode: 'error', to, error: err.message };
  }
}

module.exports = { sendReceiptEmail, generateReceiptHtml };

