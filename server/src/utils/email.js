/**
 * Email receipt utility.
 *
 * In production, configure SMTP via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * If no SMTP is configured, emails are logged to console (dev mode).
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    // Dev mode: no SMTP configured, just log
    return null;
  }

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Send a school clearance receipt email.
 */
async function sendSchoolReceipt({ studentName, studentNo, amount, receiptNumber, paidAt, souvenirs }) {
  const subject = `School Dues Receipt — ${receiptNumber}`;
  const body = `
Dear ${studentName},

Your School Dues payment has been recorded successfully.

Payment Details:
  Receipt Number: ${receiptNumber}
  Student Number:  ${studentNo || 'N/A'}
  Amount Paid:     GHS ${Number(amount).toFixed(2)}
  Payment Date:    ${new Date(paidAt).toLocaleString()}
  Type:            School Dues

${souvenirs && souvenirs.length > 0 ? `School Souvenirs Collected:\n${souvenirs.map(s => `  • ${s}`).join('\n')}\n` : ''}
Please keep this receipt for your records.

— School of Sciences, UENR Sunyani
  Dues Management System
`;

  await dispatchEmail(studentNo, subject, body);
}

/**
 * Send a department clearance receipt email.
 */
async function sendDepartmentReceipt({ studentName, studentNo, amount, receiptNumber, paidAt, departmentName, souvenirs }) {
  const subject = `Department Dues Receipt — ${receiptNumber}`;
  const body = `
Dear ${studentName},

Your Department Dues payment has been recorded successfully.

Payment Details:
  Receipt Number:  ${receiptNumber}
  Student Number:   ${studentNo || 'N/A'}
  Amount Paid:      GHS ${Number(amount).toFixed(2)}
  Payment Date:     ${new Date(paidAt).toLocaleString()}
  Type:             Department Dues
  Department:       ${departmentName || 'N/A'}

${souvenirs && souvenirs.length > 0 ? `Department Souvenirs Collected:\n${souvenirs.map(s => `  • ${s}`).join('\n')}\n` : ''}
Please keep this receipt for your records.

— School of Sciences, UENR Sunyani
  Dues Management System
`;

  await dispatchEmail(studentNo, subject, body);
}

/**
 * Internal: dispatch email or log to console in dev mode.
 */
async function dispatchEmail(identifier, subject, body) {
  const transport = getTransporter();
  const to = process.env.RECEIPT_EMAIL_TO || process.env.SMTP_USER;

  if (!transport) {
    console.log(`[EMAIL DEV MODE] To: ${to || 'no-recipient'} | Subject: ${subject}`);
    console.log(body);
    return;
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: body,
    });
    console.log(`Email sent: ${subject}`);
  } catch (err) {
    console.error(`Email send failed for ${identifier}:`, err.message);
  }
}

module.exports = { sendSchoolReceipt, sendDepartmentReceipt };
