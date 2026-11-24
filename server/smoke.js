/**
 * Local smoke test for the Dues Management overhaul.
 * Seeds its own data, boots the API, exercises the critical paths, cleans up.
 * Run from server/:  node src/db/setup-checked first;  node smoke.js
 * Covers: fresher pre-registration (UA reference numbers), rep sessions and
 * idempotent payments, the continuing-student roster + verification queue
 * behind the Students page, and the rep as-you-type lookup.
 */
require('dotenv').config();
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./src/db/pool');

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}/api`;
const results = [];
let serverProc = null;

function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
}

async function api(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, data };
}

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department_id: user.department_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function waitForHealth(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

let deptId = null;
const userIds = [];

async function seed() {
  const pinHash = await bcrypt.hash('1234', 10);
  const dept = await pool.query(
    `INSERT INTO departments (name, code, dues_amount, pin) VALUES ('Smoke Dept', 'SMOKE', 50, $1) RETURNING id`,
    [pinHash]
  );
  deptId = dept.rows[0].id;

  const admin = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Smoke Admin', 'smoke-admin@local.test', $1, 'school_admin') RETURNING id, role, department_id`,
    [pinHash]
  );
  const deptAdmin = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id) VALUES ('Smoke Dept Admin', 'smoke-dept@local.test', $1, 'dept_admin', $2) RETURNING id, role, department_id`,
    [pinHash, deptId]
  );
  userIds.push(admin.rows[0].id, deptAdmin.rows[0].id);
  return { admin: admin.rows[0], deptAdmin: deptAdmin.rows[0] };
}

async function cleanup() {
  try {
    const smokeNos = `('UA9990012','UA9990013','UA9990014','UA9990015','UA9990016','UA9990017','UA9990018','UA9990019','UA9990020','UA9990021','UA9990050','SMK/2021/045')`;
    await pool.query(
      `DELETE FROM student_souvenirs WHERE receipt_id IN (SELECT id FROM receipts WHERE student_no IN ${smokeNos} OR idempotency_key LIKE 'smoke-%')`
    );
    await pool.query(
      `DELETE FROM payments WHERE receipt_id IN (SELECT id FROM receipts WHERE student_no IN ${smokeNos} OR idempotency_key LIKE 'smoke-%')`
    );
    await pool.query(
      `DELETE FROM receipts WHERE student_no IN ${smokeNos} OR idempotency_key LIKE 'smoke-%'`
    );
    await pool.query(
      `DELETE FROM fresher_applications WHERE student_no IN ('UA9990011', 'UA9990016', 'UA9990017', 'UA9990020', 'UA9990021', 'SMK/FRE/01')`
    );
    if (userIds.length) {
      await pool.query(`DELETE FROM transaction_log WHERE admin_id = ANY($1::int[]) OR description ILIKE '%Smoke%'`, [userIds]);
    }
    // Student rows the queue/roster checks created (receipts above go first).
    await pool.query(`DELETE FROM students WHERE student_no IN ${smokeNos}`);
    await pool.query(`DELETE FROM users WHERE email LIKE 'smoke-%@local.test'`);
    // Dues items (school-wide by name; the Smoke Dept's cascade with it below).
    await pool.query(`DELETE FROM dues_items WHERE name LIKE 'Smoke %' OR department_id IN (SELECT id FROM departments WHERE code = 'SMOKE')`);
    await pool.query(`DELETE FROM souvenirs WHERE name LIKE 'Smoke %'`);
    await pool.query(`DELETE FROM departments WHERE code = 'SMOKE' OR name LIKE 'Smoke %'`);
  } catch (err) {
    console.error('Cleanup error (local only):', err.message);
  }
}

async function main() {
  const { admin, deptAdmin } = await seed();

  // Boot the API
  serverProc = spawn(process.execPath, ['src/index.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  serverProc.stdout.on('data', (d) => (serverLog += d));
  serverProc.stderr.on('data', (d) => (serverLog += d));

  const up = await waitForHealth();
  check('server boots + /api/health 200', up, up ? '' : serverLog.slice(-400));
  if (!up) return;

  // ── Fresher public flow ──
  const ap = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'Smoke Fresher', student_no: 'ua9990011', phone: '0244 000 000' },
  });
  check(
    'apply returns reference + pending',
    [200, 201].includes(ap.status) && ap.data?.reference != null && ap.data?.status === 'pending',
    `status=${ap.status} reference=${ap.data?.reference}`
  );

  const dup = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'Smoke Fresher', student_no: 'UA9990011' },
  });
  check(
    'duplicate apply → 409 ALREADY_APPLIED',
    dup.status === 409 && dup.data?.code === 'ALREADY_APPLIED',
    `status=${dup.status} code=${dup.data?.code}`
  );

  const ff = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'Smoke Freeform', student_no: 'SMK/FRE/01' },
  });
  check(
    'apply accepts a free-form reference number',
    [200, 201].includes(ff.status) && ff.data?.reference != null,
    `status=${ff.status} reference=${ff.data?.reference}`
  );

  // ── Character validation on the apply form ──
  // All three must 400 BEFORE any insert — no rows are created by these.
  const emojiName = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'Smoke \u{1F600} Applicant', student_no: 'ua9990013' },
  });
  check(
    'apply rejects an emoji in the full name',
    emojiName.status === 400 && /letters only/i.test(emojiName.data?.error || ''),
    `status=${emojiName.status} error=${emojiName.data?.error}`
  );

  const digitName = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'John42 Mensah', student_no: 'ua9990014' },
  });
  check(
    'apply rejects digits in the full name',
    digitName.status === 400 && /letters only/i.test(digitName.data?.error || ''),
    `status=${digitName.status} error=${digitName.data?.error}`
  );

  const emojiPhone = await api('POST', '/public/freshers/apply', {
    body: { full_name: 'Smoke Phone', student_no: 'ua9990015', phone: '024\u{1F600}000000' },
  });
  check(
    'apply rejects a non-numeric phone number',
    emojiPhone.status === 400 && /numbers only/i.test(emojiPhone.data?.error || ''),
    `status=${emojiPhone.status} error=${emojiPhone.data?.error}`
  );

  // ── Rep session + idempotent payment ──
  const un = await api('POST', '/public/departments/SMOKE/unlock', { body: { pin: '1234' } });
  const repToken = un.data?.token;
  check('rep unlock with PIN → token', un.status === 200 && !!repToken, `status=${un.status}`);

  const payBody = {
    student_name: 'Smoke Payer',
    student_no: 'UA9990012',
    email: 'smoke-payer@local.test',
    level: '100',
    items: [{ type: 'school_dues', amount: 50 }],
    method: 'cash',
    idempotency_key: 'smoke-key-1',
  };
  const p1 = await api('POST', '/public/departments/SMOKE/payments', { body: payBody, token: repToken });
  check(
    'payment records (201) + honest email status',
    p1.status === 201 && p1.data?.email?.mode === 'dev' && Array.isArray(p1.data?.lines),
    `status=${p1.status} email.mode=${p1.data?.email?.mode}`
  );

  const p2 = await api('POST', '/public/departments/SMOKE/payments', { body: payBody, token: repToken });
  check(
    'IDEMPOTENT REPLAY → 200 duplicate:true, same receipt',
    p2.status === 200 && p2.data?.duplicate === true && p2.data?.receipt_number === p1.data?.receipt_number,
    `status=${p2.status} duplicate=${p2.data?.duplicate} receipt=${p2.data?.receipt_number} vs ${p1.data?.receipt_number}`
  );

  const cnt = await pool.query(`SELECT count(*)::int AS n FROM receipts WHERE idempotency_key = 'smoke-key-1'`);
  check('exactly ONE receipt for the idempotency key', cnt.rows[0].n === 1, `count=${cnt.rows[0].n}`);

  // Manual entry accepts any index number the school uses — the UA reference
  // format is a freshers-only rule, so a continuing student numbered before
  // that scheme must still be payable at the desk.
  const legacyPay = await api('POST', '/public/departments/SMOKE/payments', {
    body: {
      student_name: 'Smoke Legacy',
      student_no: 'SMK/2021/045',
      email: 'smoke-legacy@local.test',
      level: '300',
      items: [{ type: 'school_dues', amount: 50 }],
      method: 'cash',
      idempotency_key: 'smoke-key-legacy',
    },
    token: repToken,
  });
  check(
    'manual entry accepts a non-UA index number (freshers-only rule)',
    legacyPay.status === 201,
    `status=${legacyPay.status} ${legacyPay.data?.error || ''}`
  );

  // ── Admin surfaces ──
  const adminToken = sign(admin);
  const list = await api('GET', '/receipts?page=1&limit=5', { token: adminToken });
  check(
    'receipts list = paginated object {receipts,total}',
    list.status === 200 && Array.isArray(list.data?.receipts) && typeof list.data?.total === 'number',
    `status=${list.status} keys=${list.data && Object.keys(list.data).join(',')}`
  );

  const auditOk = await api('GET', '/audit', { token: adminToken });
  check('audit reachable for school_admin', auditOk.status === 200, `status=${auditOk.status}`);

  const auditNo = await api('GET', '/audit', { token: sign(deptAdmin) });
  check('audit BLOCKED for dept_admin (403)', auditNo.status === 403, `status=${auditNo.status}`);

  // ── Students page: continuing roster + verification queue ──
  // The rep's manual entry above created a PENDING student (UA9990012): it
  // must sit in the school-side queue, stay off the continuing roster, and
  // join the roster only after a school admin verifies it.
  const pendingList = await api('GET', '/students?verification=pending', { token: adminToken });
  const pendingRow = (pendingList.data || []).find((r) => r.student_no === 'UA9990012');
  check(
    'manual entry lands in ?verification=pending queue',
    pendingList.status === 200 && pendingRow?.verification_status === 'pending',
    `status=${pendingList.status} found=${!!pendingRow}`
  );

  let contList = await api('GET', '/students?type=continuing', { token: adminToken });
  check(
    'pending student NOT in ?type=continuing roster',
    contList.status === 200 && !(contList.data || []).some((r) => r.student_no === 'UA9990012'),
    `status=${contList.status}`
  );

  const lk = await api('GET', '/public/departments/SMOKE/students/lookup?student_no=UA99900', {
    token: repToken,
  });
  check(
    'rep lookup (prefix, as-you-type) returns candidates with pending flag',
    lk.status === 200 &&
      Array.isArray(lk.data) &&
      lk.data.some((c) => c.student_no === 'UA9990012' && c.pending === true),
    `status=${lk.status} n=${Array.isArray(lk.data) ? lk.data.length : '?'}`
  );

  const ver = await api('POST', `/students/${pendingRow?.id}/verify-record`, { token: adminToken });
  check('school admin verifies the manual record', ver.status === 200, `status=${ver.status}`);

  contList = await api('GET', '/students?type=continuing', { token: adminToken });
  const verifiedRow = (contList.data || []).find((r) => r.student_no === 'UA9990012');
  check(
    'verified student joins ?type=continuing roster',
    verifiedRow?.verification_status === 'verified',
    `found=${!!verifiedRow}`
  );

  const pendAfter = await api('GET', '/students?verification=pending', { token: adminToken });
  check(
    'verified student leaves the pending queue',
    !(pendAfter.data || []).some((r) => r.student_no === 'UA9990012'),
    ''
  );

  // Bulk import feeds the same roster (rows land verified), and the roster
  // stays department-scoped for dept admins.
  const imp = await api('POST', '/students/bulk', {
    body: {
      department_id: deptId,
      rows: [
        {
          name: 'Smoke Imported',
          student_no: 'UA9990013',
          email: 'smoke-imported@local.test',
          level: '200',
        },
      ],
    },
    token: adminToken,
  });
  check(
    'bulk import adds a continuing student',
    imp.status === 201 && imp.data?.added === 1 && imp.data?.students?.[0]?.student_no === 'UA9990013',
    `status=${imp.status} added=${imp.data?.added}`
  );

  // Manual add feeds the same roster one student at a time; email is
  // mandatory on both paths.
  const single = await api('POST', '/students', {
    body: {
      department_id: deptId,
      name: 'Smoke Single',
      student_no: 'UA9990015',
      email: 'smoke-single@local.test',
      level: '300',
    },
    token: adminToken,
  });
  check(
    'manual add creates a verified continuing student',
    single.status === 201 &&
      single.data?.student?.student_no === 'UA9990015' &&
      single.data?.student?.verification_status === 'verified',
    `status=${single.status}`
  );

  const singleNoEmail = await api('POST', '/students', {
    body: { department_id: deptId, name: 'Smoke NoEmail', student_no: 'UA9990099' },
    token: adminToken,
  });
  check(
    'manual add without email is rejected',
    singleNoEmail.status === 400,
    `status=${singleNoEmail.status}`
  );

  contList = await api('GET', '/students?type=continuing&search=UA999001', { token: adminToken });
  check(
    'roster search finds both the verified and the imported student',
    (contList.data || []).some((r) => r.student_no === 'UA9990012') &&
      (contList.data || []).some((r) => r.student_no === 'UA9990013'),
    `n=${(contList.data || []).length}`
  );

  const otherDept = await pool.query(`SELECT id FROM departments WHERE code <> 'SMOKE' LIMIT 1`);
  if (otherDept.rows.length > 0) {
    await api('POST', '/students/bulk', {
      body: {
        department_id: otherDept.rows[0].id,
        rows: [{ name: 'Smoke Other', student_no: 'UA9990014', email: 'smoke-other@local.test', level: '300' }],
      },
      token: adminToken,
    });
    const mine = await api('GET', '/students?type=continuing', { token: sign(deptAdmin) });
    check(
      "dept admin's continuing roster is scoped to their department",
      mine.status === 200 &&
        (mine.data || []).some((r) => r.student_no === 'UA9990012') &&
        !(mine.data || []).some((r) => r.student_no === 'UA9990014'),
      `n=${(mine.data || []).length}`
    );
  }

  // ── Other Dues: items, verify with extras, admission, reports ──
  // Ownership split: the school desk collects SCHOOL-WIDE extras alongside
  // School dues (a department's items are refused — the department collects
  // them at admission); the dept admin collects the department's own items in
  // the admit flow. Reports reconcile to a third "Other Dues" bucket everywhere.
  const optsSchool = await pool.query(
    `INSERT INTO dues_items (name, amount, department_id) VALUES ('Smoke Exam Levy', 25, NULL) RETURNING id`
  );
  const optsDept = await pool.query(
    `INSERT INTO dues_items (name, amount, department_id) VALUES ('Smoke Lab Levy', 50, $1) RETURNING id`,
    [deptId]
  );
  // A school-wide item retired before use — exercises the inactive guard.
  const optsInactive = await pool.query(
    `INSERT INTO dues_items (name, amount, department_id) VALUES ('Smoke Retired Levy', 15, NULL) RETURNING id`
  );
  await pool.query(`UPDATE dues_items SET active = FALSE WHERE id = $1`, [optsInactive.rows[0].id]);
  const optsOtherDeptRow = await pool.query(`SELECT id FROM departments WHERE code <> 'SMOKE' LIMIT 1`);
  let optsForeign = null;
  if (optsOtherDeptRow.rows.length > 0) {
    optsForeign = await pool.query(
      `INSERT INTO dues_items (name, amount, department_id) VALUES ('Smoke Foreign Levy', 99, $1) RETURNING id`,
      [optsOtherDeptRow.rows[0].id]
    );
  }
  const dToken = sign(deptAdmin);

  const appA = await pool.query(
    `INSERT INTO fresher_applications (full_name, student_no, email, status)
     VALUES ('Smoke Opts Fresher', 'UA9990016', 'smoke-opts@local.test', 'pending') RETURNING id`
  );
  const appB = await pool.query(
    `INSERT INTO fresher_applications (full_name, student_no, email, status)
     VALUES ('Smoke Foreign Fresher', 'UA9990017', 'smoke-foreign@local.test', 'pending') RETURNING id`
  );

  // 1) The desk refuses a department's item — that charge belongs to the
  //    department's admission flow. The rollback leaves the application
  //    pending so the desk can correct and retry.
  const vDeptItem = await api('POST', `/freshers/${appA.rows[0].id}/verify`, {
    token: adminToken,
    body: {
      department_id: deptId,
      email: 'smoke-opts@local.test',
      payment: {
        amount: 0,
        method: 'cash',
        extras: [{ dues_item_id: optsDept.rows[0].id, amount: 50 }],
      },
    },
  });
  const appAPending = await pool.query(`SELECT status FROM fresher_applications WHERE id = $1`, [
    appA.rows[0].id,
  ]);
  check(
    'verify refuses a department item (400, collected at admission), app stays pending',
    vDeptItem.status === 400 &&
      /admitted/.test(vDeptItem.data?.error || '') &&
      appAPending.rows[0].status === 'pending',
    `status=${vDeptItem.status} app=${appAPending.rows[0].status} ${vDeptItem.data?.error || ''}`
  );

  // 2) Verify with School dues + a school-wide extra → one receipt, total
  //    75, FULL tag, the extra itemized by name and stamped with the dept.
  const v1 = await api('POST', `/freshers/${appA.rows[0].id}/verify`, {
    token: adminToken,
    body: {
      department_id: deptId,
      email: 'smoke-opts@local.test',
      payment: {
        amount: 50,
        method: 'cash',
        extras: [{ dues_item_id: optsSchool.rows[0].id, amount: 25 }],
      },
    },
  });
  const v1Rec = await pool.query(
    `SELECT r.id, r.receipt_number, r.total_amount FROM receipts r
       JOIN students s ON s.id = r.student_id
      WHERE s.student_no = 'UA9990016'`
  );
  const v1Lines = v1Rec.rows[0]
    ? (await pool.query(
        `SELECT type, label, amount, department_id FROM payments WHERE receipt_id = $1 ORDER BY id`,
        [v1Rec.rows[0].id]
      )).rows
    : [];
  check(
    'verify: School dues + school-wide extra = one receipt, total 75, FULL, itemized',
    v1.status === 201 &&
      v1Rec.rows[0] &&
      Number(v1Rec.rows[0].total_amount) === 75 &&
      /-FULL-/.test(v1Rec.rows[0].receipt_number) &&
      v1Lines.length === 2 &&
      v1Lines.some(
        (l) =>
          l.label === 'Smoke Exam Levy' && Number(l.amount) === 25 && l.department_id === deptId
      ),
    `status=${v1.status} total=${v1Rec.rows[0] && v1Rec.rows[0].total_amount} lines=${v1Lines.length} ${JSON.stringify(v1.data).slice(0, 140)}`
  );
  check(
    'verify receipt email sends in dev mode with the receipt number',
    v1.data?.email?.mode === 'dev' && v1.data?.receipt_number === v1Rec.rows[0]?.receipt_number,
    `mode=${v1.data?.email?.mode}`
  );

  const v1Detail = await api('GET', `/receipts/verify/${encodeURIComponent(v1Rec.rows[0]?.receipt_number || '')}`, {
    token: adminToken,
  });
  check(
    'receipt detail API returns the labeled extra lines',
    v1Detail.status === 200 &&
      (v1Detail.data?.lines || []).some((l) => l.type === 'extra_dues' && l.label === 'Smoke Exam Levy'),
    `status=${v1Detail.status} lines=${JSON.stringify((v1Detail.data?.lines || []).map((l) => l.type))}`
  );

  // 3) An item belonging to ANOTHER department is out of scope → 400.
  if (optsForeign) {
    const v2 = await api('POST', `/freshers/${appB.rows[0].id}/verify`, {
      token: adminToken,
      body: {
        department_id: deptId,
        payment: {
          amount: 50,
          method: 'cash',
          extras: [{ dues_item_id: optsForeign.rows[0].id, amount: 99 }],
        },
      },
    });
    check(
      "verify rejects another department's dues item (400)",
      v2.status === 400,
      `status=${v2.status} ${v2.data?.error || ''}`
    );
  }

  // 4) A deactivated school-wide item is refused too — and the rollback
  //    leaves the application pending so the desk can correct and retry.
  const v3 = await api('POST', `/freshers/${appB.rows[0].id}/verify`, {
    token: adminToken,
    body: {
      department_id: deptId,
      payment: {
        amount: 0,
        method: 'cash',
        extras: [{ dues_item_id: optsInactive.rows[0].id, amount: 15 }],
      },
    },
  });
  const stillPending = await pool.query(
    `SELECT status FROM fresher_applications WHERE id = $1`,
    [appB.rows[0].id]
  );
  check(
    'verify rejects a deactivated item (400), application stays pending',
    v3.status === 400 && stillPending.rows[0].status === 'pending',
    `status=${v3.status} app=${stillPending.rows[0].status} ${v3.data?.error || ''}`
  );

  // 4) School-dues-only verification still works unchanged (SCH receipt).
  const v4 = await api('POST', `/freshers/${appB.rows[0].id}/verify`, {
    token: adminToken,
    body: { department_id: deptId, payment: { amount: 50, method: 'momo' } },
  });
  const v4Rec = await pool.query(
    `SELECT r.receipt_number, r.total_amount FROM receipts r
       JOIN students s ON s.id = r.student_id
      WHERE s.student_no = 'UA9990017'`
  );
  check(
    'verify with School dues only → SCH receipt, total 50, single line',
    v4.status === 201 &&
      v4Rec.rows[0] &&
      /-SCH-/.test(v4Rec.rows[0].receipt_number) &&
      Number(v4Rec.rows[0].total_amount) === 50,
    `status=${v4.status} receipt=${v4Rec.rows[0] && v4Rec.rows[0].receipt_number}`
  );

  // 4b) Admission: the department collects its own dues + its items in one
  //     itemized DEPT receipt (the school desk never touches these).
  const admitStudent = await pool.query(`SELECT id FROM students WHERE student_no = 'UA9990017'`);
  const admitRes = await api('POST', `/students/${admitStudent.rows[0].id}/admit`, {
    token: dToken,
    body: {
      payment: {
        amount: 50,
        method: 'cash',
        extras: [{ dues_item_id: optsDept.rows[0].id, amount: 50 }],
      },
    },
  });
  const admitRec = await pool.query(
    `SELECT id, receipt_number, total_amount FROM receipts
      WHERE student_id = $1 AND voided_at IS NULL ORDER BY id DESC LIMIT 1`,
    [admitStudent.rows[0].id]
  );
  const admitLines = admitRec.rows[0]
    ? (await pool.query(
        `SELECT type, label, amount, department_id FROM payments WHERE receipt_id = $1 ORDER BY id`,
        [admitRec.rows[0].id]
      )).rows
    : [];
  check(
    'admit: dept dues + dept item = one DEPT receipt, total 100, itemized',
    admitRes.status === 200 &&
      admitRec.rows[0] &&
      /-DEPT-/.test(admitRec.rows[0].receipt_number) &&
      Number(admitRec.rows[0].total_amount) === 100 &&
      admitLines.length === 2 &&
      admitLines.some((l) => l.type === 'department_dues' && Number(l.amount) === 50) &&
      admitLines.some(
        (l) =>
          l.type === 'extra_dues' &&
          l.label === 'Smoke Lab Levy' &&
          Number(l.amount) === 50 &&
          l.department_id === deptId
      ),
    `status=${admitRes.status} total=${admitRec.rows[0] && admitRec.rows[0].total_amount} lines=${admitLines.length} ${JSON.stringify(admitRes.data).slice(0, 140)}`
  );
  check(
    'admit receipt email sends in dev mode',
    admitRes.data?.email?.mode === 'dev',
    `mode=${admitRes.data?.email?.mode}`
  );
  // An admitted fresher is a Level 100 student now, so the students roster
  // (?type=continuing) must include them alongside the continuing students.
  const rosterAfterAdmit = await api('GET', '/students?type=continuing', { token: adminToken });
  check(
    'admitted fresher (Level 100) appears on the students roster',
    rosterAfterAdmit.status === 200 &&
      (rosterAfterAdmit.data || []).some((r) => r.student_no === 'UA9990017'),
    `status=${rosterAfterAdmit.status} n=${(rosterAfterAdmit.data || []).length}`
  );

  // 4c) Management ownership: a department's items belong to its own admin —
  //     the school admin manages school-wide items only.
  const deptOff = await api('PUT', `/dues-items/${optsDept.rows[0].id}`, {
    token: dToken,
    body: { active: false },
  });
  check(
    'dept admin can manage their own item (deactivate → 200)',
    deptOff.status === 200,
    `status=${deptOff.status}`
  );
  const schoolOnDeptPut = await api('PUT', `/dues-items/${optsDept.rows[0].id}`, {
    token: adminToken,
    body: { active: true },
  });
  const schoolOnDeptDel = await api('DELETE', `/dues-items/${optsDept.rows[0].id}`, {
    token: adminToken,
  });
  const schoolCreateDeptItem = await api('POST', '/dues-items', {
    token: adminToken,
    body: { name: 'Smoke Forged Dept Item', amount: 10, department_id: deptId },
  });
  check(
    'school admin cannot manage department items (403 on PUT/DELETE/create)',
    schoolOnDeptPut.status === 403 &&
      schoolOnDeptDel.status === 403 &&
      schoolCreateDeptItem.status === 403,
    `put=${schoolOnDeptPut.status} del=${schoolOnDeptDel.status} post=${schoolCreateDeptItem.status}`
  );
  const deptOnSchoolWide = await api('PUT', `/dues-items/${optsSchool.rows[0].id}`, {
    token: dToken,
    body: { amount: 20 },
  });
  check(
    'dept admin cannot touch school-wide items (403)',
    deptOnSchoolWide.status === 403,
    `status=${deptOnSchoolWide.status}`
  );

  // 5) Manual registration follows the same school-wide-only rule — a
  //    department item is refused and no student is created.
  const regReject = await api('POST', '/students/freshers', {
    token: adminToken,
    body: {
      name: 'Smoke Reg Reject',
      student_no: 'UA9990019',
      email: 'smoke-reg-reject@local.test',
      department_id: deptId,
      level: '100',
      payment: {
        amount: 50,
        method: 'cash',
        extras: [{ dues_item_id: optsDept.rows[0].id, amount: 50 }],
      },
    },
  });
  const regRejectLeftover = await pool.query(
    `SELECT 1 FROM students WHERE student_no = 'UA9990019'`
  );
  check(
    'registration refuses a department item (400, no student created)',
    regReject.status === 400 && regRejectLeftover.rows.length === 0,
    `status=${regReject.status} created=${regRejectLeftover.rows.length} ${regReject.data?.error || ''}`
  );

  // 6) Manual registration charges school-wide extras the same way.
  const reg = await api('POST', '/students/freshers', {
    token: adminToken,
    body: {
      name: 'Smoke Reg Fresher',
      student_no: 'UA9990018',
      email: 'smoke-reg@local.test',
      department_id: deptId,
      level: '100',
      payment: {
        amount: 50,
        method: 'cash',
        extras: [{ dues_item_id: optsSchool.rows[0].id, amount: 25 }],
      },
    },
  });
  const regRec = await pool.query(
    `SELECT r.id, r.receipt_number, r.total_amount FROM receipts r
       JOIN students s ON s.id = r.student_id
      WHERE s.student_no = 'UA9990018'`
  );
  const regLines = regRec.rows[0]
    ? (await pool.query(
        `SELECT type, label, amount FROM payments WHERE receipt_id = $1 ORDER BY id`,
        [regRec.rows[0].id]
      )).rows
    : [];
  check(
    'manual registration: extras on the receipt (total 75, labeled line)',
    reg.status === 201 &&
      regRec.rows[0] &&
      Number(regRec.rows[0].total_amount) === 75 &&
      regLines.length === 2 &&
      regLines.some((l) => l.type === 'extra_dues' && l.label === 'Smoke Exam Levy' && Number(l.amount) === 25),
    `status=${reg.status} total=${regRec.rows[0] && regRec.rows[0].total_amount} lines=${regLines.length} ${JSON.stringify(reg.data).slice(0, 140)}`
  );

  // 6) Reports reconcile: Other Dues lands in the dept row, the level rows,
  //    the monthly series and the CSV — and dept rows sum to the totals.
  const summary = await api('GET', '/reports/summary', { token: adminToken });
  const smokeDeptRow = (summary.data?.departments || []).find((d) => d.id === deptId);
  const deptOtherSum = (summary.data?.departments || []).reduce(
    (s, d) => s + Number(d.other_dues_collected || 0),
    0
  );
  check(
    'reports summary: Other Dues in totals + dept row, dept rows sum to totals',
    summary.status === 200 &&
      Number(summary.data?.totals?.other_dues) === 100 &&
      Number(smokeDeptRow?.other_dues_collected) === 100 &&
      deptOtherSum === Number(summary.data?.totals?.other_dues),
    `status=${summary.status} totals=${summary.data?.totals?.other_dues} dept=${smokeDeptRow?.other_dues_collected} sum=${deptOtherSum}`
  );
  check(
    'level breakdown carries an Other Dues figure',
    Array.isArray(summary.data?.levels) &&
      summary.data.levels.some((l) => Number(l.other_dues_collected) > 0),
    `levels=${JSON.stringify((summary.data?.levels || []).map((l) => Number(l.other_dues_collected)))}`
  );

  const monthly = await api('GET', '/reports/monthly', { token: adminToken });
  check(
    'monthly series has an other_dues bucket',
    monthly.status === 200 &&
      Array.isArray(monthly.data?.monthly) &&
      monthly.data.monthly.some((m) => Number(m.other_dues) > 0),
    `status=${monthly.status}`
  );

  // School-wide vs department separation of Other Dues: the split reconciles
  // with the combined bucket, the monthly series splits the same way, and the
  // per-item breakdown carries a scope on every row.
  const othTotals = summary.data?.totals || {};
  check(
    'summary totals split Other Dues into school-wide + department',
    Number(othTotals.school_other_dues || 0) + Number(othTotals.dept_other_dues || 0) ===
      Number(othTotals.other_dues),
    `school=${othTotals.school_other_dues} dept=${othTotals.dept_other_dues} all=${othTotals.other_dues}`
  );
  check(
    'monthly series splits Other Dues the same way',
    Array.isArray(monthly.data?.monthly) &&
      monthly.data.monthly.every(
        (m) =>
          Number(m.school_other_dues || 0) + Number(m.dept_other_dues || 0) ===
          Number(m.other_dues)
      ),
    `months=${monthly.data?.monthly?.length}`
  );
  check(
    'level rows split Other Dues the same way',
    Array.isArray(summary.data?.levels) &&
      summary.data.levels.every(
        (l) =>
          Number(l.school_other_dues_collected || 0) + Number(l.dept_other_dues_collected || 0) ===
          Number(l.other_dues_collected)
      ),
    `levels=${summary.data?.levels?.length}`
  );
  const otherItemsReport = await api('GET', '/reports/other-items', { token: adminToken });
  const otherItemsSum = (otherItemsReport.data?.items || []).reduce(
    (s, it) => s + Number(it.amount || 0),
    0
  );
  check(
    'other-items: scope on every row, sums to the Other Dues total',
    otherItemsReport.status === 200 &&
      Array.isArray(otherItemsReport.data?.items) &&
      otherItemsReport.data.items.length > 0 &&
      otherItemsReport.data.items.every((it) => it.scope === 'school' || it.scope === 'dept') &&
      otherItemsSum === Number(summary.data?.totals?.other_dues),
    `status=${otherItemsReport.status} rows=${otherItemsReport.data?.items?.length} sum=${otherItemsSum} vs ${summary.data?.totals?.other_dues}`
  );

  // Day-specific date filtering: a tomorrow-only range matches nothing (a
  // monthly-granularity filter would return the whole current month), and
  // today-only equals a direct SQL sum of today's receipts — same inclusive
  // day boundaries the API applies.
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayStr = (d) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = dayStr(new Date());
  const tomorrowStr = dayStr(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const todayOnly = await api('GET', `/reports/summary?from=${todayStr}&to=${todayStr}`, {
    token: adminToken,
  });
  const tomorrowOnly = await api('GET', `/reports/summary?from=${tomorrowStr}&to=${tomorrowStr}`, {
    token: adminToken,
  });
  const todaySql = await pool.query(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0) AS school_dues,
            COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0) AS other_dues
     FROM payments p JOIN receipts r ON r.id = p.receipt_id
     WHERE p.voided_at IS NULL AND r.voided_at IS NULL
       AND r.paid_at >= $1::date AND r.paid_at < ($1::date + INTERVAL '1 day')`,
    [todayStr]
  );
  check(
    'date from/to are day-specific: today-only matches SQL, tomorrow-only none',
    todayOnly.status === 200 &&
      Number(todayOnly.data?.totals?.school_dues) === Number(todaySql.rows[0].school_dues) &&
      Number(todayOnly.data?.totals?.other_dues) === Number(todaySql.rows[0].other_dues) &&
      Number(tomorrowOnly.data?.totals?.school_dues) === 0 &&
      Number(tomorrowOnly.data?.totals?.other_dues) === 0,
    `today api=${todayOnly.data?.totals?.school_dues}/${todayOnly.data?.totals?.other_dues} sql=${todaySql.rows[0].school_dues}/${todaySql.rows[0].other_dues}; tomorrow=${tomorrowOnly.data?.totals?.school_dues}`
  );

  // ── Filtered report downloads + filters: the report's name heads the file,
  //    the five columns follow, and every filter actually narrows the rows.
  //    All of it sits before the cap block so the receipts below can't skew
  //    these totals. ──
  const csv = await fetch(`${BASE}/reports/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const csvText = await csv.text();
  const csvLines = csvText.split('\n');
  check(
    'CSV export: report name in row 1, Name/Reference/Programme/Amount/Date header, receipt rows',
    csv.status === 200 &&
      csvLines[0] === 'All Departments — All Levels — All Methods' &&
      csvLines[1] === 'Name,Reference,Programme,Amount,Date' &&
      csvText.includes('UA9990012') &&
      csvText.includes('SMK/2021/045'),
    `status=${csv.status} row1=${JSON.stringify(csvLines[0])} row2=${JSON.stringify(csvLines[1])}`
  );

  // The cash/momo split covers ONLY the school admin's own money (school dues
  // + school-wide items) — department money keeps its channels on the
  // department report. Both channels carry data (the smoke receipts mix
  // methods).
  const bm = summary.data?.by_method || {};
  const repTotalsSum =
    Number(summary.data?.totals?.department_dues) +
    Number(summary.data?.totals?.school_dues) +
    Number(summary.data?.totals?.other_dues);
  const schoolMoney =
    Number(summary.data?.totals?.school_dues) + Number(summary.data?.totals?.school_other_dues);
  check(
    'summary by_method: school admin cash + momo = school money only',
    summary.status === 200 &&
      Number(bm.cash) + Number(bm.momo) === schoolMoney &&
      Number(bm.cash) > 0 &&
      Number(bm.momo) > 0,
    `cash=${bm.cash} momo=${bm.momo} school=${schoolMoney}`
  );

  // Cross-checked against a direct SQL sum with the same school-vs-dept item
  // classification the route uses.
  const schoolCashSql = await pool.query(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE r.method = 'cash'), 0)::numeric AS cash,
            COALESCE(SUM(p.amount) FILTER (WHERE r.method = 'momo'), 0)::numeric AS momo
       FROM payments p JOIN receipts r ON r.id = p.receipt_id
      WHERE p.voided_at IS NULL
        AND (p.type = 'school_dues'
             OR (p.type = 'extra_dues' AND EXISTS (SELECT 1 FROM dues_items di WHERE di.department_id IS NULL AND di.name = p.label)))`
  );
  check(
    'school admin by_method = school money only (direct SQL cross-check)',
    Number(bm.cash) === Number(schoolCashSql.rows[0].cash) &&
      Number(bm.momo) === Number(schoolCashSql.rows[0].momo),
    `cash=${bm.cash}/${schoolCashSql.rows[0].cash} momo=${bm.momo}/${schoolCashSql.rows[0].momo}`
  );

  // Same idea on the department report: its channels cover department dues +
  // department items only (the school money its reps collect shows on the
  // school side instead).
  const deptSummary = await api('GET', '/reports/summary', { token: dToken });
  const deptBm = deptSummary.data?.by_method || {};
  const deptOwnMoney =
    Number(deptSummary.data?.totals?.department_dues) +
    Number(deptSummary.data?.totals?.dept_other_dues);
  check(
    'dept admin by_method: cash + momo = department money only',
    deptSummary.status === 200 &&
      Number(deptBm.cash) + Number(deptBm.momo) === deptOwnMoney &&
      Number(deptBm.cash) + Number(deptBm.momo) > 0,
    `cash=${deptBm.cash} momo=${deptBm.momo} dept=${deptOwnMoney}`
  );

  // The method filter narrows the money to one channel — cross-checked against
  // a direct SQL sum of cash receipts, not just the route's own split.
  const cashOnly = await api('GET', '/reports/summary?method=cash', { token: adminToken });
  const cashTotals =
    Number(cashOnly.data?.totals?.department_dues) +
    Number(cashOnly.data?.totals?.school_dues) +
    Number(cashOnly.data?.totals?.other_dues);
  const cashDbSum = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0)::numeric AS cash
       FROM payments p JOIN receipts r ON r.id = p.receipt_id
      WHERE p.voided_at IS NULL AND r.voided_at IS NULL AND r.method = 'cash'`
  );
  check(
    'method=cash totals = a direct SQL sum of cash receipts',
    cashOnly.status === 200 &&
      cashTotals === Number(cashDbSum.rows[0].cash) &&
      cashTotals > 0 &&
      cashTotals < repTotalsSum,
    `status=${cashOnly.status} totals=${cashTotals} sql=${cashDbSum.rows[0].cash}`
  );

  // The level filter narrows the money to level-300 receipts only — cross-
  // checked against a direct SQL sum using the same payment-level → receipt →
  // student derivation (the seeded DB has several level-300 receipts).
  const lvl300 = await api('GET', '/reports/summary?level=300', { token: adminToken });
  const lvl300Db = await pool.query(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0)::numeric AS dept_dues,
            COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0)::numeric AS school_dues,
            COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0)::numeric AS other_dues
       FROM payments p JOIN receipts r ON r.id = p.receipt_id
       LEFT JOIN students s ON s.id = r.student_id
      WHERE p.voided_at IS NULL AND r.voided_at IS NULL
        AND COALESCE(r.payment_level, r.level, s.level) = '300'`
  );
  const lvl300Sum =
    Number(lvl300.data?.totals?.department_dues) +
    Number(lvl300.data?.totals?.school_dues) +
    Number(lvl300.data?.totals?.other_dues);
  check(
    'level=300 totals match a direct SQL sum of level-300 receipts and narrow the report',
    lvl300.status === 200 &&
      Number(lvl300.data?.totals?.department_dues) === Number(lvl300Db.rows[0].dept_dues) &&
      Number(lvl300.data?.totals?.school_dues) === Number(lvl300Db.rows[0].school_dues) &&
      Number(lvl300.data?.totals?.other_dues) === Number(lvl300Db.rows[0].other_dues) &&
      lvl300Sum > 0 &&
      lvl300Sum < repTotalsSum,
    `status=${lvl300.status} totals=${JSON.stringify(lvl300.data?.totals)} sql=${JSON.stringify(lvl300Db.rows[0])}`
  );
  const badLevel = await api('GET', '/reports/summary?level=150', { token: adminToken });
  const badMethod = await api('GET', '/reports/monthly?method=cheque', { token: adminToken });
  check(
    'invalid level/method filters are rejected (400)',
    badLevel.status === 400 && badMethod.status === 400,
    `level=${badLevel.status} method=${badMethod.status}`
  );

  // Department scoping: picking a department narrows both the rows and the
  // money to it — cross-checked against a direct SQL sum of the receipts
  // attributed to that department (the seeded DB funds several departments).
  const deptMoneySql = async (id) => {
    const r = await pool.query(
      `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'department_dues'), 0)::numeric AS dept_dues,
              COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'school_dues'), 0)::numeric AS school_dues,
              COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'extra_dues'), 0)::numeric AS other_dues
         FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE p.voided_at IS NULL AND r.voided_at IS NULL AND r.department_id = $1`,
      [id]
    );
    return r.rows[0];
  };
  const reportEmptyDept = (summary.data?.departments || []).find((d) => d.id !== deptId);
  const ownDept = await api('GET', `/reports/summary?department_id=${deptId}`, {
    token: adminToken,
  });
  const ownDb = await deptMoneySql(deptId);
  const ownTotals = ownDept.data?.totals || {};
  check(
    'department_id=own narrows rows to one department and money to its receipts',
    ownDept.status === 200 &&
      ownDept.data?.departments?.length === 1 &&
      ownDept.data.departments[0].id === deptId &&
      Number(ownTotals.department_dues) === Number(ownDb.dept_dues) &&
      Number(ownTotals.school_dues) === Number(ownDb.school_dues) &&
      Number(ownTotals.other_dues) === Number(ownDb.other_dues) &&
      Number(ownTotals.school_dues) <= Number(summary.data?.totals?.school_dues),
    `status=${ownDept.status} rows=${ownDept.data?.departments?.length} totals=${JSON.stringify(ownTotals)} sql=${JSON.stringify(ownDb)}`
  );
  if (reportEmptyDept) {
    const emptyDept = await api('GET', `/reports/summary?department_id=${reportEmptyDept.id}`, {
      token: adminToken,
    });
    const emptyDb = await deptMoneySql(reportEmptyDept.id);
    const emptyTotals = emptyDept.data?.totals || {};
    check(
      'department_id=another department narrows rows and money to that department',
      emptyDept.status === 200 &&
        emptyDept.data?.departments?.length === 1 &&
        emptyDept.data.departments[0].id === reportEmptyDept.id &&
        Number(emptyTotals.department_dues) === Number(emptyDb.dept_dues) &&
        Number(emptyTotals.school_dues) === Number(emptyDb.school_dues) &&
        Number(emptyTotals.other_dues) === Number(emptyDb.other_dues),
      `status=${emptyDept.status} totals=${JSON.stringify(emptyTotals)} sql=${JSON.stringify(emptyDb)}`
    );

    // A department admin asking for someone else's department still gets
    // their own — the foreign parameter is ignored server-side.
    const pinned = await api('GET', `/reports/summary?department_id=${reportEmptyDept.id}`, {
      token: dToken,
    });
    check(
      'dept admin is pinned to their own department (foreign department_id ignored)',
      pinned.status === 200 &&
        pinned.data?.departments?.length === 1 &&
        pinned.data.departments[0].id === deptId &&
        pinned.data?.departments[0]?.name === 'Smoke Dept',
      `status=${pinned.status} rows=${JSON.stringify((pinned.data?.departments || []).map((d) => d.name))}`
    );
  }

  // Staff accounts can't reach reports at all.
  let staffRow = (
    await pool.query(
      `SELECT id, role, department_id FROM users WHERE email = 'smoke-staff@local.test'`
    )
  ).rows[0];
  if (!staffRow) {
    staffRow = (
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         SELECT 'Smoke Staff', 'smoke-staff@local.test', password_hash, 'school_staff'
           FROM users WHERE email = 'smoke-admin@local.test'
         RETURNING id, role, department_id`
      )
    ).rows[0];
  }
  const staffReports = await api('GET', '/reports/summary', {
    token: staffRow ? sign(staffRow) : undefined,
  });
  check(
    'staff account is refused reports access (403)',
    Boolean(staffRow) && staffReports.status === 403,
    `status=${staffReports.status}`
  );

  // The on-page payments list mirrors the export columns exactly, and the
  // filters narrow it server-side.
  const pays = await api('GET', '/reports/payments?limit=50', { token: adminToken });
  const paysLvl300 = await api('GET', '/reports/payments?level=300&limit=50', { token: adminToken });
  const lvl300Receipts = await pool.query(
    `SELECT COUNT(*)::int AS n FROM receipts r
       LEFT JOIN students s ON s.id = r.student_id
      WHERE r.voided_at IS NULL AND COALESCE(r.payment_level, r.level, s.level) = '300'`
  );
  const payKeys = pays.data?.payments?.[0]
    ? Object.keys(pays.data.payments[0]).sort().join(',')
    : '';
  check(
    'payments list: five report columns, level filter matches the SQL row count',
    pays.status === 200 &&
      pays.data?.total > 0 &&
      payKeys === 'amount,date,name,programme,reference' &&
      paysLvl300.status === 200 &&
      paysLvl300.data?.total === lvl300Receipts.rows[0].n &&
      paysLvl300.data?.total > 0 &&
      (paysLvl300.data?.payments || []).some((p) => p.reference === 'SMK/2021/045'),
    `status=${pays.status} total=${pays.data?.total} keys=${payKeys} lvl300=${paysLvl300.data?.total} sql=${lvl300Receipts.rows[0].n}`
  );

  // A filtered CSV carries the filter's name in row 1 and only matching rows.
  const csvFiltered = await fetch(`${BASE}/reports/export?level=300&method=cash`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const csvFilteredText = await csvFiltered.text();
  const csvFilteredLine1 = csvFilteredText.split('\n')[0];
  check(
    'filtered CSV: report name carries Level 300 + Cash, only matching rows',
    csvFiltered.status === 200 &&
      csvFilteredLine1.includes('Level 300') &&
      csvFilteredLine1.includes('Cash') &&
      csvFilteredText.includes('SMK/2021/045') &&
      !csvFilteredText.includes('UA9990012'),
    `status=${csvFiltered.status} row1=${JSON.stringify(csvFilteredLine1)}`
  );

  // The PDF export is a real document served as application/pdf.
  const pdfRes = await fetch(`${BASE}/reports/export.pdf`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check(
    'PDF export: application/pdf and a real %PDF document',
    pdfRes.status === 200 &&
      (pdfRes.headers.get('content-type') || '').includes('application/pdf') &&
      pdfBuf.subarray(0, 4).toString('utf8') === '%PDF' &&
      pdfBuf.length > 500,
    `status=${pdfRes.status} type=${pdfRes.headers.get('content-type')} bytes=${pdfBuf.length}`
  );

  // ── Main-dues cap: School/Department dues stop at the limit; extra dues
  //    (Other Dues items) don't. The limit itself is never stated in an
  //    error message — the UI must not leak it either. Placed after every
  //    data-dependent report check so the receipts below can't skew totals.
  const capSettings = await api('PUT', '/settings/school_dues_amount', {
    token: adminToken,
    body: { value: 61 },
  });
  check(
    'settings rejects School dues above the cap (400, no cap value in the message)',
    capSettings.status === 400 &&
      typeof capSettings.data?.error === 'string' &&
      !/\d/.test(capSettings.data.error),
    `status=${capSettings.status} error=${capSettings.data?.error || ''}`
  );

  const capDeptCreate = await api('POST', '/departments', {
    token: adminToken,
    body: { name: 'Smoke Cap Dept', dues_amount: 61 },
  });
  const capDeptCreateLeftover = await pool.query(
    `SELECT 1 FROM departments WHERE name = 'Smoke Cap Dept'`
  );
  check(
    'department create rejects dues above the cap (400, no dept created)',
    capDeptCreate.status === 400 && capDeptCreateLeftover.rows.length === 0,
    `status=${capDeptCreate.status} created=${capDeptCreateLeftover.rows.length} ${capDeptCreate.data?.error || ''}`
  );

  const capDeptEdit = await api('PUT', `/departments/${deptId}`, {
    token: adminToken,
    body: { name: 'Smoke Dept', dues_amount: 61 },
  });
  check(
    'department edit rejects dues above the cap (400)',
    capDeptEdit.status === 400,
    `status=${capDeptEdit.status} ${capDeptEdit.data?.error || ''}`
  );

  const capDeptDuesReject = await api('PUT', `/departments/${deptId}/dues`, {
    token: dToken,
    body: { dues_amount: 61 },
  });
  const capDeptDuesAtCap = await api('PUT', `/departments/${deptId}/dues`, {
    token: dToken,
    body: { dues_amount: 60 },
  });
  await api('PUT', `/departments/${deptId}/dues`, { token: dToken, body: { dues_amount: 50 } });
  check(
    'dept dues setter: above the cap → 400, exactly at the cap → 200',
    capDeptDuesReject.status === 400 && capDeptDuesAtCap.status === 200,
    `over=${capDeptDuesReject.status} atCap=${capDeptDuesAtCap.status} ${capDeptDuesReject.data?.error || ''}`
  );

  const capRep = await api('POST', '/public/departments/SMOKE/payments', {
    body: {
      ...payBody,
      idempotency_key: 'smoke-cap-rep',
      items: [{ type: 'school_dues', amount: 61 }],
    },
    token: repToken,
  });
  const capRepLeftover = await pool.query(
    `SELECT 1 FROM receipts WHERE idempotency_key = 'smoke-cap-rep'`
  );
  check(
    'rep payment refuses a dues line above the cap (400, no receipt)',
    capRep.status === 400 && capRepLeftover.rows.length === 0,
    `status=${capRep.status} created=${capRepLeftover.rows.length} ${capRep.data?.error || ''}`
  );

  const capDesk = await api('POST', '/receipts', {
    token: adminToken,
    body: {
      student_name: 'Smoke Cap Desk',
      student_no: 'UA9990050',
      email: 'smoke-cap-desk@local.test',
      level: '100',
      method: 'cash',
      items: [{ type: 'school_dues', amount: 61 }],
      idempotency_key: 'smoke-cap-desk',
    },
  });
  const capDeskLeftover = await pool.query(
    `SELECT 1 FROM receipts WHERE idempotency_key = 'smoke-cap-desk'`
  );
  check(
    'desk entry refuses School dues above the cap (400, no receipt)',
    capDesk.status === 400 && capDeskLeftover.rows.length === 0,
    `status=${capDesk.status} created=${capDeskLeftover.rows.length} ${capDesk.data?.error || ''}`
  );

  const capReg = await api('POST', '/students/freshers', {
    token: adminToken,
    body: {
      name: 'Smoke Cap Reg',
      student_no: 'UA9990021',
      email: 'smoke-cap-reg@local.test',
      department_id: deptId,
      level: '100',
      payment: { amount: 61, method: 'cash' },
    },
  });
  const capRegLeftover = await pool.query(`SELECT 1 FROM students WHERE student_no = 'UA9990021'`);
  check(
    'registration refuses School dues above the cap (400, no student created)',
    capReg.status === 400 && capRegLeftover.rows.length === 0,
    `status=${capReg.status} created=${capRegLeftover.rows.length} ${capReg.data?.error || ''}`
  );

  // Boundary + extras: exactly at the cap goes through with an uncapped
  // extra riding the same receipt; then admit is refused above the cap and
  // the admission itself rolls back.
  const capApp = await pool.query(
    `INSERT INTO fresher_applications (full_name, student_no, email, status)
     VALUES ('Smoke Cap Fresher', 'UA9990020', 'smoke-cap@local.test', 'pending') RETURNING id`
  );
  const capVerify = await api('POST', `/freshers/${capApp.rows[0].id}/verify`, {
    token: adminToken,
    body: {
      department_id: deptId,
      payment: { amount: 61, method: 'cash' },
    },
  });
  const capAppPending = await pool.query(`SELECT status FROM fresher_applications WHERE id = $1`, [
    capApp.rows[0].id,
  ]);
  check(
    'verify refuses School dues above the cap (400, application stays pending)',
    capVerify.status === 400 && capAppPending.rows[0].status === 'pending',
    `status=${capVerify.status} app=${capAppPending.rows[0].status} ${capVerify.data?.error || ''}`
  );

  const capBigItem = await api('POST', '/dues-items', {
    token: adminToken,
    body: { name: 'Smoke Big Levy', amount: 500 },
  });
  check(
    'extra dues item far above the cap is accepted (201 — extras are unlimited)',
    capBigItem.status === 201,
    `status=${capBigItem.status} ${capBigItem.data?.error || ''}`
  );

  const capVerifyOk = await api('POST', `/freshers/${capApp.rows[0].id}/verify`, {
    token: adminToken,
    body: {
      department_id: deptId,
      payment: {
        amount: 60,
        method: 'cash',
        extras: [{ dues_item_id: capBigItem.data?.id, amount: 500 }],
      },
    },
  });
  const capRec = await pool.query(
    `SELECT r.id, r.total_amount FROM receipts r
       JOIN students s ON s.id = r.student_id
      WHERE s.student_no = 'UA9990020'`
  );
  const capLines = capRec.rows[0]
    ? (await pool.query(
        `SELECT type, label, amount FROM payments WHERE receipt_id = $1 ORDER BY id`,
        [capRec.rows[0].id]
      )).rows
    : [];
  check(
    'verify at the cap + uncapped extra = one receipt, total 560',
    capVerifyOk.status === 201 &&
      capRec.rows[0] &&
      Number(capRec.rows[0].total_amount) === 560 &&
      capLines.length === 2 &&
      capLines.some((l) => l.type === 'school_dues' && Number(l.amount) === 60) &&
      capLines.some(
        (l) => l.type === 'extra_dues' && l.label === 'Smoke Big Levy' && Number(l.amount) === 500
      ),
    `status=${capVerifyOk.status} total=${capRec.rows[0] && capRec.rows[0].total_amount} lines=${capLines.length} ${JSON.stringify(capVerifyOk.data).slice(0, 140)}`
  );

  const capAdmitStudent = await pool.query(
    `SELECT id FROM students WHERE student_no = 'UA9990020'`
  );
  const capAdmit = await api('POST', `/students/${capAdmitStudent.rows[0].id}/admit`, {
    token: dToken,
    body: { payment: { amount: 61, method: 'cash' } },
  });
  const capAdmitAfter = await pool.query(`SELECT admitted_at FROM students WHERE student_no = 'UA9990020'`);
  check(
    'admit refuses Department dues above the cap (400, admission rolls back)',
    capAdmit.status === 400 && capAdmitAfter.rows[0].admitted_at === null,
    `status=${capAdmit.status} admitted_at=${capAdmitAfter.rows[0].admitted_at} ${capAdmit.data?.error || ''}`
  );

  // ── Resend receipt emails: every admin and staff role pushes every live
  //    receipt to the address on file — school-side for any student,
  //    dept-side for own department only; foreign departments refused. ──
  const resendStuId = capAdmitStudent.rows[0].id;

  // No email on file → 400 (email temporarily cleared, then restored).
  const origEmailRes = await pool.query(
    `SELECT email FROM students WHERE student_no = 'UA9990020'`
  );
  const origEmail = origEmailRes.rows[0]?.email ?? null;
  await pool.query(`UPDATE students SET email = NULL WHERE student_no = 'UA9990020'`);
  const resendNoEmail = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: adminToken,
  });
  await pool.query(`UPDATE students SET email = $1 WHERE student_no = 'UA9990020'`, [origEmail]);
  check(
    'resend refuses a student with no email on file (400)',
    resendNoEmail.status === 400,
    `status=${resendNoEmail.status} ${resendNoEmail.data?.error || ''}`
  );

  // No receipts at all → 400.
  const noReceiptStu = await pool.query(
    `INSERT INTO students (name, student_no, email, department_id)
     VALUES ('Smoke No Receipt', 'UA9990040', 'smoke-noreceipt@local.test', $1)
     RETURNING id`,
    [deptId]
  );
  const resendNone = await api(
    'POST',
    `/students/${noReceiptStu.rows[0].id}/resend-receipt-emails`,
    { token: adminToken }
  );
  check(
    'resend refuses a student with no receipts (400)',
    resendNone.status === 400,
    `status=${resendNone.status} ${resendNone.data?.error || ''}`
  );

  // Staff accounts can resend too: school staff anywhere, dept staff only
  // for their own department's students.
  const tempStaff = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ('Smoke Resend Staff', 'smoke-resend-staff@local.test', 'x', 'dept_staff', $1)
     RETURNING id, role, department_id`,
    [deptId]
  );
  const staffResend = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: sign(tempStaff.rows[0]),
  });
  check(
    'own-dept dept staff resends (200)',
    staffResend.status === 200 && staffResend.data?.total >= 1,
    `status=${staffResend.status} ${JSON.stringify(staffResend.data).slice(0, 160)}`
  );
  const tempSchoolStaff = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ('Smoke Resend School Staff', 'smoke-resend-schoolstaff@local.test', 'x', 'school_staff', NULL)
     RETURNING id, role, department_id`
  );
  const schoolStaffResend = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: sign(tempSchoolStaff.rows[0]),
  });
  check(
    'school staff resends for any student (200)',
    schoolStaffResend.status === 200 && schoolStaffResend.data?.total >= 1,
    `status=${schoolStaffResend.status} ${JSON.stringify(schoolStaffResend.data).slice(0, 160)}`
  );

  // A dept admin of ANOTHER department → 403 (dept isolation).
  const resendOtherDept = await pool.query(
    `INSERT INTO departments (name, code, dues_amount)
     VALUES ('Smoke Resend Dept', 'SMRSEND', 40) RETURNING id`
  );
  const resendOtherAdmin = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ('Smoke Resend Admin', 'smoke-resend-admin@local.test', 'x', 'dept_admin', $1)
     RETURNING id, role, department_id`,
    [resendOtherDept.rows[0].id]
  );
  const wrongDeptResend = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: sign(resendOtherAdmin.rows[0]),
  });
  check(
    'resend BLOCKED for a dept_admin of another department (403)',
    wrongDeptResend.status === 403,
    `status=${wrongDeptResend.status} ${wrongDeptResend.data?.error || ''}`
  );
  const resendOtherStaff = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ('Smoke Resend Other Staff', 'smoke-resend-other-staff@local.test', 'x', 'dept_staff', $1)
     RETURNING id, role, department_id`,
    [resendOtherDept.rows[0].id]
  );
  const wrongDeptStaffResend = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: sign(resendOtherStaff.rows[0]),
  });
  check(
    'resend BLOCKED for a dept_staff of another department (403)',
    wrongDeptStaffResend.status === 403,
    `status=${wrongDeptStaffResend.status} ${wrongDeptStaffResend.data?.error || ''}`
  );

  // The confirmation modal's preview: address on file + itemized records.
  const previewOk = await api('GET', `/students/${resendStuId}/resend-preview`, {
    token: adminToken,
  });
  check(
    'resend preview shows the address + payment records (200)',
    previewOk.status === 200 &&
      previewOk.data?.student?.email === 'smoke-cap@local.test' &&
      previewOk.data?.can_send === true &&
      previewOk.data?.receipts?.length >= 1 &&
      previewOk.data.receipts[0]?.lines?.length >= 1 &&
      typeof previewOk.data.receipts[0]?.receipt_number === 'string',
    `status=${previewOk.status} ${JSON.stringify(previewOk.data).slice(0, 180)}`
  );
  const previewWrongDept = await api('GET', `/students/${resendStuId}/resend-preview`, {
    token: sign(resendOtherAdmin.rows[0]),
  });
  check(
    'resend preview BLOCKED for a dept_admin of another department (403)',
    previewWrongDept.status === 403,
    `status=${previewWrongDept.status} ${previewWrongDept.data?.error || ''}`
  );

  // Happy paths: school admin for any student; dept admin for their own dept.
  const resendOk = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: adminToken,
  });
  check(
    'school admin resends the receipt email(s) (200, one live receipt)',
    resendOk.status === 200 &&
      resendOk.data?.total >= 1 &&
      typeof resendOk.data?.message === 'string' &&
      resendOk.data.message.includes('resent') &&
      (resendOk.data.results[0]?.mode === 'dev' || resendOk.data.results[0]?.sent === true),
    `status=${resendOk.status} ${JSON.stringify(resendOk.data).slice(0, 160)}`
  );
  const deptResendOk = await api('POST', `/students/${resendStuId}/resend-receipt-emails`, {
    token: dToken,
  });
  check(
    'own-dept dept_admin resends too (200)',
    deptResendOk.status === 200 && deptResendOk.data?.total >= 1,
    `status=${deptResendOk.status} ${JSON.stringify(deptResendOk.data).slice(0, 160)}`
  );

  // Cleanup of the resend fixtures.
  await pool.query(
    `DELETE FROM users WHERE email IN ('smoke-resend-staff@local.test', 'smoke-resend-admin@local.test', 'smoke-resend-schoolstaff@local.test', 'smoke-resend-other-staff@local.test')`
  );
  await pool.query(`DELETE FROM departments WHERE code = 'SMRSEND'`);
  await pool.query(`DELETE FROM students WHERE id = $1`, [noReceiptStu.rows[0].id]);


  // ── Souvenirs carry no cost: create/update take name + category only, and
  //    the API never returns a cost field (the column is gone). ──
  const souvCreate = await api('POST', '/souvenirs', {
    token: adminToken,
    body: { name: 'Smoke Freebie', category: 'school' },
  });
  const souvUpdate =
    souvCreate.status === 201
      ? await api('PUT', `/souvenirs/${souvCreate.data?.id}`, {
          token: adminToken,
          body: { name: 'Smoke Freebie Renamed', category: 'school' },
        })
      : { status: 0, data: {} };
  if (souvCreate.data?.id) {
    await api('DELETE', `/souvenirs/${souvCreate.data.id}`, { token: adminToken });
  }
  check(
    'souvenirs have no cost (create 201 + update 200, no cost field in either)',
    souvCreate.status === 201 &&
      souvUpdate.status === 200 &&
      !('cost' in (souvCreate.data || {})) &&
      !('cost' in (souvUpdate.data || {})),
    `create=${souvCreate.status} update=${souvUpdate.status} keys=${Object.keys(souvCreate.data || {}).join(',')}`
  );

  let limited = null;
  for (let i = 0; i < 40; i++) {
    const r = await api('POST', '/auth/login', { body: { email: 'nobody@smoke.test', password: 'nope' } });
    if (r.status === 429) {
      limited = r;
      break;
    }
  }
  check(
    'login limiter trips with JSON {error, code:RATE_LIMITED}',
    limited && limited.data?.code === 'RATE_LIMITED' && typeof limited.data?.error === 'string',
    limited ? `code=${limited.data?.code} error=${limited.data?.error}` : 'never tripped in 40 tries'
  );
}

main()
  .catch((err) => {
    check('smoke script ran without crashing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    if (serverProc) serverProc.kill();
    await cleanup();
    await pool.end();

    let fails = 0;
    for (const r of results) {
      const mark = r.ok ? 'PASS' : 'FAIL';
      if (!r.ok) fails++;
      console.log(`${mark}  ${r.name}${r.extra ? `  [${r.extra}]` : ''}`);
    }
    console.log(`\n${results.length - fails}/${results.length} checks passed`);
    process.exit(fails ? 1 : 0);
  });
