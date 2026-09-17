const test = require('node:test');
const assert = require('node:assert/strict');

// Force dev mode for this suite regardless of the developer's environment.
delete process.env.SMTP_HOST;

const { sendReceiptEmail, generateReceiptHtml } = require('../src/utils/email');

// Capture console output so the dev-mode logs stay out of the test report and
// can be asserted on.
function captureConsole(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const logs = [];
  const warns = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => warns.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, logs, warns }))
    .finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
    });
}

test('sendReceiptEmail logs in dev mode and reports not sent', async () => {
  const { result, logs } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-1',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: 'cash',
      total: 100,
      lines: [{ type: 'school_dues', amount: 100 }],
      to: 'jane@example.com',
    })
  );
  assert.equal(result.sent, false);
  assert.equal(result.mode, 'dev');
  assert.equal(result.to, 'jane@example.com');
  assert.ok(logs.some((l) => l.includes('[EMAIL DEV MODE]')));
  assert.ok(logs.some((l) => l.includes('Amount Paid:') && l.includes('GHS 100.00')));
  assert.ok(result.html.includes('SCHOOL OF SCIENCES'));
  assert.ok(result.html.includes('UENR-TEST-1'));
  assert.ok(result.html.includes('GHS 100.00'));
});

test('sendReceiptEmail labels a zero-total receipt as a souvenir receipt', async () => {
  const { result, logs } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-2',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: 'cash',
      total: 0,
      lines: [],
      to: 'jane@example.com',
    })
  );
  assert.equal(result.sent, false);
  assert.equal(result.mode, 'dev');
  assert.ok(logs.some((l) => l.includes('Subject: Souvenir Receipt')));
  assert.ok(!logs.some((l) => l.includes('Amount Paid')));
  assert.ok(result.html.includes('Souvenir Collection Receipt'));
});

test('sendReceiptEmail tolerates a missing payment method', async () => {
  const { result, logs } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-3',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: undefined,
      total: 50,
      lines: [{ type: 'department_dues', amount: 50 }],
      to: 'jane@example.com',
    })
  );
  assert.equal(result.mode, 'dev');
  assert.ok(logs.some((l) => l.includes('Payment Method:') && l.includes('N/A')));
  assert.ok(result.html.includes('N/A'));
});

test('sendReceiptEmail stays in dev mode when SMTP_HOST has no credentials', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const { result, warns } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-4',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: 'cash',
      total: 25,
      lines: [{ type: 'school_dues', amount: 25 }],
      to: 'jane@example.com',
    })
  );
  delete process.env.SMTP_HOST;
  assert.equal(result.sent, false);
  assert.equal(result.mode, 'dev');
  assert.ok(warns.some((w) => w.includes('SMTP_USER/SMTP_PASS are missing')));
});

test('sendReceiptEmail includes souvenirs when some were handed out', async () => {
  const { result, logs } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-5',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: 'cash',
      total: 50,
      lines: [{ type: 'school_dues', amount: 50 }],
      souvenirs: ['School Cap', 'School Mug'],
      to: 'jane@example.com',
    })
  );
  assert.ok(logs.some((l) => l.includes('Souvenirs:')));
  assert.ok(logs.some((l) => l.includes('School Cap') && l.includes('School Mug')));
  assert.ok(result.html.includes('School Cap'));
  assert.ok(result.html.includes('School Mug'));
});

test('sendReceiptEmail omits the souvenirs section when none were given', async () => {
  const { result, logs } = await captureConsole(() =>
    sendReceiptEmail({
      studentName: 'Jane Doe',
      studentNo: 'BIO1001',
      receiptNumber: 'UENR-TEST-6',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      method: 'cash',
      total: 50,
      lines: [{ type: 'school_dues', amount: 50 }],
      to: 'jane@example.com',
    })
  );
  assert.ok(!logs.some((l) => l.includes('Souvenirs:')));
  assert.ok(!result.html.includes('Souvenirs Handed Out'));
});

test('generateReceiptHtml generates styled HTML with design system elements', () => {
  const html = generateReceiptHtml({
    studentName: 'Alex Kwesi',
    studentNo: 'COMP202401',
    receiptNumber: 'SOS-DUES-DUES-COMP202401-1',
    paidAt: new Date('2026-09-15T14:30:00Z'),
    methodLabel: 'CASH',
    numericTotal: 150,
    safeLines: [
      { type: 'school_dues', amount: 100 },
      { type: 'department_dues', amount: 50 },
    ],
    safeSouvenirs: ['Department T-Shirt'],
    departmentName: 'Computer Science',
    souvenirOnly: false,
    subject: 'Dues Receipt — SOS-DUES-DUES-COMP202401-1',
  });

  assert.ok(html.includes('SCHOOL OF SCIENCES'));
  assert.ok(html.includes('University of Energy and Natural Resources'));
  assert.ok(html.includes('SOS-DUES-DUES-COMP202401-1'));
  assert.ok(html.includes('Alex Kwesi'));
  assert.ok(html.includes('COMP202401'));
  assert.ok(html.includes('Computer Science'));
  assert.ok(html.includes('School Dues'));
  assert.ok(html.includes('Department Dues'));
  assert.ok(html.includes('Department T-Shirt'));
  assert.ok(html.includes('#0f1633')); // Deep navy header background
  assert.ok(html.includes('#b5852b')); // Gold accent border
});

test('generateReceiptHtml shows only the date for a date-only payment (no false time)', () => {
  const html = generateReceiptHtml({
    studentName: 'Alex Kwesi',
    studentNo: 'COMP202401',
    receiptNumber: 'SOS-DUES-DUES-COMP202401-2',
    paidAt: new Date('2026-09-17T00:00:00Z'), // date-only picker value stored at midnight
    methodLabel: 'CASH',
    numericTotal: 50,
    safeLines: [{ type: 'school_dues', amount: 50 }],
    safeSouvenirs: [],
    departmentName: 'Computer Science',
    souvenirOnly: false,
    subject: 'Dues Receipt',
  });
  assert.ok(/Sep/.test(html), 'should show the date');
  assert.ok(!html.includes('00:00'), 'should not show a midnight time');
});

test('generateReceiptHtml shows the time for a real timestamp', () => {
  const html = generateReceiptHtml({
    studentName: 'Alex Kwesi',
    studentNo: 'COMP202401',
    receiptNumber: 'SOS-DUES-DUES-COMP202401-3',
    paidAt: new Date('2026-09-17T14:30:00Z'),
    methodLabel: 'CASH',
    numericTotal: 50,
    safeLines: [{ type: 'school_dues', amount: 50 }],
    safeSouvenirs: [],
    departmentName: 'Computer Science',
    souvenirOnly: false,
    subject: 'Dues Receipt',
  });
  assert.ok(html.includes('14:30'), 'should show the payment time');
});

