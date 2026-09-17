const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { ensureDatabase } = require('./setup');
const { resolveAcademicYear } = require('../utils/academicYear');

// v2 seed — clears every data table and rebuilds a full, realistic demo set:
// departments + PINs, classes, souvenirs, staff accounts, continuing students,
// freshers (pending admission and admitted), pre-registration applications,
// itemized receipts/payments spread over recent months, souvenirs handed out,
// and an audit trail.
//
// Run with `npm run db:setup` (drops + recreates the schema) followed by
// `npm run db:seed`, or `npm run setup` from the project root for both.

const ACTIVE_YEAR = resolveAcademicYear(); // e.g. 2026/2027
const YEAR_START = Number(ACTIVE_YEAR.split('/')[0]);

const DEPARTMENTS = [
  { name: 'Computer Science', code: 'CS', dues: 60, pin: '1234' },
  { name: 'Mathematics', code: 'MATHS', dues: 50, pin: '1234' },
  { name: 'Biology', code: 'BIOL', dues: 50, pin: '1234' },
  { name: 'Chemistry', code: 'CHEM', dues: 50, pin: '1234' },
  { name: 'Physics', code: 'PHYS', dues: 50, pin: '1234' },
];

// University-issued student numbers:
//   UE + programme letter + department id (2) + unique sequence (3) + enrollment
//   year (2), e.g. UEB3227523.
const UNIV_DEPT_ID = {
  'Computer Science': 32,
  Mathematics: 31,
  Biology: 33,
  Chemistry: 34,
  Physics: 35,
};
const PROGRAM_LETTER = 'B';

const CLASSES = {
  'Computer Science': ['Level 100 A', 'Level 100 B', 'Level 200', 'Level 300'],
  Mathematics: ['Level 100', 'Level 200', 'Level 300'],
  Biology: ['Level 100', 'Level 200', 'Level 300'],
  Chemistry: ['Level 100', 'Level 200', 'Level 300'],
  Physics: ['Level 100', 'Level 200', 'Level 300'],
};

const CONTINUING = {
  'Computer Science': {
    100: ['Jeremy Adjei', 'Joyce Antwi', 'Kevin Nitamoah', 'Linda Boakye'],
    200: ['Michael Asiedu', 'Naomi Sarpong', 'Obed Kwame'],
    300: ['Kwesi Appiah', 'Akosua Danso'],
  },
  Mathematics: {
    100: ['Samuel Tetteh', 'Grace Amoah', 'Isaac Nkrumah', 'Comfort Baidoo'],
    200: ['Daniel Agyeman', 'Rita Antwi', 'Emmanuel Ofori'],
    300: ['Sarah Addo', 'Michael Quaye'],
  },
  Biology: {
    100: ['Collins Ampadu', 'Mercy Nyarko', 'Stephen Badu', 'Paula Asamoah'],
    200: ['Bernice Kwarteng', 'Nana Yeboah', 'Abena Osei'],
    300: ['Yaw Owusu', 'Efua Asante'],
  },
  Chemistry: {
    100: ['Gifty Asante', 'Prince Ntim', 'Abigail Boateng', 'Kofi Mensah'],
    200: ['Evelyn Osei', 'Yaa Boakye', 'Kwabena Adjei'],
    300: ['Akua Mintah', 'Kojo Antwi'],
  },
  Physics: {
    100: ['Henry Okai', 'Irene Fosu', 'Grace Sefah', 'Daniel Safford'],
    200: ['Naa Adjei', 'Selina Osei', 'Bernard Akoto'],
    300: ['Vera Amankwah', 'Eric Gyamfi'],
  },
};

const PENDING_FRESHERS = {
  'Computer Science': ['Mensah Kwadwo', 'Adjoa Mensimah'],
  Mathematics: ['Fiifi Arthur', 'Esi Amponsah'],
  Biology: ['Ama Boakye', 'Kojo Frimpong'],
  Chemistry: ['Nana Ama Boateng', 'Yaw Darko'],
  Physics: ['Aboagye Kwame', 'Akosua Bempah'],
};

const ADMITTED_FRESHERS = {
  'Computer Science': ['Samuel Owusu', 'Rebecca Ansah'],
  Mathematics: ['Philip Mensah'],
  Biology: ['Doreen Asare'],
  Chemistry: ['Bright Osei'],
  Physics: ['Linda Ackah'],
};

const APPLICATIONS = [
  { full_name: 'Kwabena Nkrumah', student_no: 'UA2601001', programme: 'BSc. Computer Science', gender: 'Male', hometown: 'Kumasi', phone: '024 000 0001', email: 'kwabena.nkrumah@example.com' },
  { full_name: 'Godfred Amoah', student_no: 'UA2601002', programme: 'BSc. Mathematics', gender: 'Male', hometown: 'Sunyani', phone: '024 000 0002', email: 'godfred.amoah@example.com' },
  { full_name: 'Sandra Yeboah', student_no: 'UA2601003', programme: 'BSc. Biology', gender: 'Female', hometown: 'Accra', phone: '024 000 0003', email: 'sandra.yeboah@example.com' },
  { full_name: 'Francis Oduro', student_no: 'UA2601004', programme: 'BSc. Chemistry', gender: 'Male', hometown: 'Takoradi', phone: '024 000 0004', email: 'francis.oduro@example.com' },
  { full_name: 'Naomi Adjei', student_no: 'UA2601005', programme: 'BSc. Physics', gender: 'Female', hometown: 'Tamale', phone: '024 000 0005', email: 'naomi.adjei@example.com' },
  { full_name: 'Victor Danso', student_no: 'UA2601006', programme: 'BSc. Computer Science', gender: 'Male', hometown: 'Cape Coast', phone: '024 000 0006', email: 'victor.danso@example.com' },
];

const HOMETOWNS = [
  'Sunyani', 'Kumasi', 'Accra', 'Takoradi', 'Tamale', 'Cape Coast', 'Ho', 'Koforidua',
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

function paidAtFor(i) {
  const now = new Date();
  // Spread over the last six months so the dashboard trend is populated.
  return new Date(now.getFullYear(), now.getMonth() - (i % 6), 2 + (i % 24), 9, 30, 0, 0);
}

function classFor(deptName, level, counter) {
  if (deptName === 'Computer Science' && Number(level) === 100) {
    return counter % 2 === 0 ? 'Level 100 A' : 'Level 100 B';
  }
  return `Level ${level}`;
}

async function seed() {
  await ensureDatabase();

  const client = await pool.connect();

  // University-issued student numbers and the per-student receipt counter.
  const deptSeq = {}; // deptName -> last used sequence
  const receiptSeqByStudent = new Map(); // studentId -> last receipt counter
  const makeStudentNo = (deptName, enrollYear) => {
    deptSeq[deptName] = (deptSeq[deptName] || 0) + 1;
    const id = String(UNIV_DEPT_ID[deptName]).padStart(2, '0');
    const seq = String(deptSeq[deptName]).padStart(3, '0');
    const yr = String(enrollYear).slice(-2).padStart(2, '0');
    return `UE${PROGRAM_LETTER}${id}${seq}${yr}`;
  };
  const receiptNumberFor = (studentId, studentNo, tag) => {
    const n = (receiptSeqByStudent.get(studentId) || 0) + 1;
    receiptSeqByStudent.set(studentId, n);
    return `SOS-DUES-${tag}-${studentNo}-${n}`;
  };

  const addReceipt = async ({
    receiptNumber,
    studentId,
    method,
    paidAt,
    recordType,
    recordedBy,
    departmentId,
    classId,
    lines,
    voided = false,
  }) => {
    const total = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    const voidedAt = voided ? paidAt : null;
    const { rows } = await client.query(
      `INSERT INTO receipts
         (receipt_number, student_id, method, paid_at, academic_year, record_type,
          recorded_by, department_id, class_id, total_amount, voided_at, voided_by, void_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        receiptNumber,
        studentId,
        method,
        paidAt,
        ACTIVE_YEAR,
        recordType,
        recordedBy,
        departmentId,
        classId,
        total,
        voidedAt,
        voided ? recordedBy : null,
        voided ? 'Duplicate entry — corrected at the desk' : null,
      ]
    );
    const receiptId = rows[0].id;
    for (const line of lines) {
      await client.query(
        `INSERT INTO payments
           (receipt_id, type, amount, department_id, class_id, voided_at, voided_by, void_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          receiptId,
          line.type,
          line.amount,
          line.department_id ?? null,
          line.class_id ?? null,
          voidedAt,
          voided ? recordedBy : null,
          voided ? 'Duplicate entry — corrected at the desk' : null,
        ]
      );
    }
    return receiptId;
  };

  const logAudit = (adminId, role, type, description, meta = null) =>
    client.query(
      `INSERT INTO transaction_log (admin_id, admin_role, transaction_type, description, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [adminId, role, type, description, meta ? JSON.stringify(meta) : null]
    );

  try {
    await client.query('BEGIN');

    // ── Clean slate ──
    await client.query(
      `TRUNCATE transaction_log, student_souvenirs, payments, receipts,
                fresher_applications, souvenirs, students, classes, users,
                departments, settings RESTART IDENTITY CASCADE`
    );

    // ── Settings ──
    await client.query(
      `INSERT INTO settings (key, value) VALUES
         ('school_dues_amount', '50'),
         ('fresher_access_code', 'UENR2026'),
         ('active_academic_year', $1)`,
      [ACTIVE_YEAR]
    );

    // ── Departments (with a known collector PIN) ──
    const deptIds = {};
    const deptDues = {};
    for (const d of DEPARTMENTS) {
      const pinHash = await bcrypt.hash(d.pin, 10);
      const { rows } = await client.query(
        `INSERT INTO departments (name, code, dues_amount, pin)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [d.name, d.code, d.dues, pinHash]
      );
      deptIds[d.name] = rows[0].id;
      deptDues[d.name] = d.dues;
    }

    // ── Classes ──
    const classIds = {};
    for (const [deptName, classNames] of Object.entries(CLASSES)) {
      classIds[deptName] = {};
      for (const className of classNames) {
        const level = className.split(' ').slice(0, 2).join(' ');
        const { rows } = await client.query(
          `INSERT INTO classes (department_id, level, name) VALUES ($1,$2,$3) RETURNING id`,
          [deptIds[deptName], level, className]
        );
        classIds[deptName][className] = rows[0].id;
      }
    }

    // ── Souvenirs ──
    const schoolSouvenirIds = [];
    for (const s of [
      { name: 'School T-Shirt', cost: 10 },
      { name: 'School Cap', cost: 8 },
      { name: 'School Mug', cost: 6 },
      { name: 'School ID Holder', cost: 3 },
    ]) {
      const { rows } = await client.query(
        `INSERT INTO souvenirs (name, category, department_id, cost)
         VALUES ($1,'school',NULL,$2) RETURNING id`,
        [s.name, s.cost]
      );
      schoolSouvenirIds.push(rows[0].id);
    }
    const deptSouvenirIds = {};
    for (const [deptName, deptId] of Object.entries(deptIds)) {
      deptSouvenirIds[deptName] = [];
      for (const t of [
        { name: 'Departmental Pen', cost: 2 },
        { name: 'Departmental Sticker', cost: 1 },
        { name: 'Departmental Notebook', cost: 5 },
      ]) {
        const { rows } = await client.query(
          `INSERT INTO souvenirs (name, category, department_id, cost)
           VALUES ($1,'department',$2,$3) RETURNING id`,
          [`${deptName} ${t.name}`, deptId, t.cost]
        );
        deptSouvenirIds[deptName].push(rows[0].id);
      }
    }

    // ── Users ──
    const schoolHash = await bcrypt.hash('admin1234', 10);
    const staffHash = await bcrypt.hash('staff1234', 10);
    const adminHash = await bcrypt.hash('dept1234', 10);

    const schoolAdmin = (
      await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('School Admin','admin@sciences.uenr.edu.gh',$1,'school_admin') RETURNING id`,
        [schoolHash]
      )
    ).rows[0].id;

    await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('School Staff','staff@sciences.uenr.edu.gh',$1,'school_staff')`,
      [staffHash]
    );

    const deptAdminId = {};
    for (const [deptName, deptId] of Object.entries(deptIds)) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id)
         VALUES ($1,$2,$3,'dept_admin',$4) RETURNING id`,
        [`${deptName} Admin`, `${slug(deptName)}@sciences.uenr.edu.gh`, adminHash, deptId]
      );
      deptAdminId[deptName] = rows[0].id;
    }

    await client.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ('CS Dept Staff','csstaff@sciences.uenr.edu.gh',$1,'dept_staff',$2)`,
      [staffHash, deptIds['Computer Science']]
    );

    // ── Continuing students + their collections ──
    let globalIdx = 0;
    for (const [deptName, levels] of Object.entries(CONTINUING)) {
      const deptId = deptIds[deptName];
      const dues = deptDues[deptName];
      let counter = 0;

      for (const [levelStr, names] of Object.entries(levels)) {
        const level = String(levelStr);
        for (const name of names) {
          counter += 1;
          const className = classFor(deptName, level, counter);
          const classId = classIds[deptName][className];
          const admissionYear = String(YEAR_START - (Number(level) / 100 - 1));
          const studentNo = makeStudentNo(deptName, admissionYear);
          const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${studentNo.toLowerCase()}@example.com`;
          const phone = `02${String(4000000 + globalIdx).slice(0, 7)}`;
          const gender = globalIdx % 2 === 0 ? 'Female' : 'Male';
          const hometown = HOMETOWNS[globalIdx % HOMETOWNS.length];

          const { rows } = await client.query(
            `INSERT INTO students
               (name, student_no, is_fresher, level, department_id, class_id, admission_year,
                phone, email, programme, gender, hometown, admitted_at, created_by)
             VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12) RETURNING id`,
            [
              name,
              studentNo,
              level,
              deptId,
              classId,
              admissionYear,
              phone,
              email,
              `BSc. ${deptName}`,
              gender,
              hometown,
              deptAdminId[deptName],
            ]
          );
          const studentId = rows[0].id;

          // Payment scenarios cycle so every state appears in the UI.
          const scenario = globalIdx % 5;
          const when = paidAtFor(globalIdx);
          const method = globalIdx % 2 ? 'momo' : 'cash';
          const recordType = globalIdx % 3 === 0 ? 'admin' : 'rep';
          const recordedBy = recordType === 'admin' ? deptAdminId[deptName] : null;

          const lines = [];
          if (scenario === 1) {
            lines.push(
              { type: 'school_dues', amount: 50 },
              { type: 'department_dues', amount: dues, department_id: deptId, class_id: classId }
            );
          } else if (scenario === 2) {
            lines.push({ type: 'school_dues', amount: 50 });
          } else if (scenario === 3) {
            lines.push({
              type: 'department_dues',
              amount: dues,
              department_id: deptId,
              class_id: classId,
            });
          } else if (scenario === 4) {
            lines.push(
              { type: 'school_dues', amount: 25 },
              {
                type: 'department_dues',
                amount: Math.round(dues / 2),
                department_id: deptId,
                class_id: classId,
              }
            );
          }

          if (lines.length) {
            const voided = globalIdx % 23 === 0;
            const tag =
              lines.length > 1 ? 'DUES' : lines[0].type === 'school_dues' ? 'SCH' : 'DEPT';
            const receiptNumber = receiptNumberFor(studentId, studentNo, tag);
            await addReceipt({
              receiptNumber,
              studentId,
              method,
              paidAt: when,
              recordType,
              recordedBy,
              departmentId: deptId,
              classId,
              lines,
              voided,
            });
            if (!voided) {
              await logAudit(
                recordedBy,
                recordType === 'admin' ? 'DEPT_ADMIN' : 'REP',
                'payment',
                `${recordType === 'admin' ? 'Recorded' : 'Class rep recorded'} dues for ${name} (${receiptNumber})`,
                { student_id: studentId, receipt_number: receiptNumber, lines }
              );
            }
          }
          globalIdx += 1;
        }
      }
    }

    // ── Freshers awaiting admission (registered by the School) ──
    for (const [deptName, names] of Object.entries(PENDING_FRESHERS)) {
      const deptId = deptIds[deptName];
      for (const name of names) {
        globalIdx += 1;
        const studentNo = makeStudentNo(deptName, YEAR_START);
        const { rows } = await client.query(
          `INSERT INTO students
             (name, student_no, is_fresher, level, department_id, admission_year,
              phone, email, programme, gender, hometown, created_by)
           VALUES ($1,$2,true,'100',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            name,
            studentNo,
            deptId,
            String(YEAR_START),
            `02${String(3000000 + globalIdx).slice(0, 7)}`,
            `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            `BSc. ${deptName}`,
            globalIdx % 2 === 0 ? 'Female' : 'Male',
            HOMETOWNS[globalIdx % HOMETOWNS.length],
            schoolAdmin,
          ]
        );
        const studentId = rows[0].id;
        const when = paidAtFor(globalIdx);

        const receiptId = await addReceipt({
          receiptNumber: receiptNumberFor(studentId, studentNo, 'SCH'),
          studentId,
          method: globalIdx % 2 ? 'momo' : 'cash',
          paidAt: when,
          recordType: 'admin',
          recordedBy: schoolAdmin,
          departmentId: deptId,
          classId: null,
          lines: [{ type: 'school_dues', amount: 50 }],
        });
        await client.query(
          `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           VALUES ($1,$2,$3,'school',$4)`,
          [studentId, schoolSouvenirIds[globalIdx % schoolSouvenirIds.length], receiptId, schoolAdmin]
        );
        await logAudit(
          schoolAdmin,
          'SCHOOL_ADMIN',
          'fresher_register',
          `Registered fresher ${name} (${studentNo}) and recorded School Dues`,
          { student_id: studentId, department_id: deptId }
        );
      }
    }

    // ── Admitted freshers (registered + admitted, two receipts) ──
    for (const [deptName, names] of Object.entries(ADMITTED_FRESHERS)) {
      const deptId = deptIds[deptName];
      const dues = deptDues[deptName];
      for (const name of names) {
        globalIdx += 1;
        const studentNo = makeStudentNo(deptName, YEAR_START);
        const className = deptName === 'Computer Science' ? 'Level 100 A' : 'Level 100';
        const classId = classIds[deptName][className];
        const { rows } = await client.query(
          `INSERT INTO students
             (name, student_no, is_fresher, level, department_id, class_id, admission_year,
              phone, email, programme, gender, hometown, admitted_at, admitted_by, created_by)
           VALUES ($1,$2,true,'100',$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12) RETURNING id`,
          [
            name,
            studentNo,
            deptId,
            classId,
            String(YEAR_START),
            `02${String(5000000 + globalIdx).slice(0, 7)}`,
            `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            `BSc. ${deptName}`,
            globalIdx % 2 === 0 ? 'Female' : 'Male',
            HOMETOWNS[globalIdx % HOMETOWNS.length],
            deptAdminId[deptName],
            schoolAdmin,
          ]
        );
        const studentId = rows[0].id;

        // 1) School registration (School dues + school souvenir)
        const schoolReceipt = await addReceipt({
          receiptNumber: receiptNumberFor(studentId, studentNo, 'SCH'),
          studentId,
          method: 'cash',
          paidAt: paidAtFor(globalIdx),
          recordType: 'admin',
          recordedBy: schoolAdmin,
          departmentId: deptId,
          classId: null,
          lines: [{ type: 'school_dues', amount: 50 }],
        });
        await client.query(
          `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           VALUES ($1,$2,$3,'school',$4)`,
          [studentId, schoolSouvenirIds[globalIdx % schoolSouvenirIds.length], schoolReceipt, schoolAdmin]
        );

        // 2) Department admission (Department dues + department souvenir)
        const deptReceipt = await addReceipt({
          receiptNumber: receiptNumberFor(studentId, studentNo, 'DEPT'),
          studentId,
          method: globalIdx % 2 ? 'momo' : 'cash',
          paidAt: paidAtFor(globalIdx),
          recordType: 'admin',
          recordedBy: deptAdminId[deptName],
          departmentId: deptId,
          classId,
          lines: [
            { type: 'department_dues', amount: dues, department_id: deptId, class_id: classId },
          ],
        });
        await client.query(
          `INSERT INTO student_souvenirs (student_id, souvenir_id, receipt_id, level, given_by)
           VALUES ($1,$2,$3,'department',$4)`,
          [
            studentId,
            deptSouvenirIds[deptName][globalIdx % deptSouvenirIds[deptName].length],
            deptReceipt,
            deptAdminId[deptName],
          ]
        );
        await logAudit(
          deptAdminId[deptName],
          'DEPT_ADMIN',
          'fresher_admit',
          `Admitted fresher ${name} (${studentNo}) into ${className}`,
          { student_id: studentId, department_id: deptId, class_id: classId }
        );
      }
    }

    // ── One archived and one graduated student (for the list filters) ──
    const archivedNo = makeStudentNo('Computer Science', YEAR_START);
    await client.query(
      `INSERT INTO students
         (name, student_no, is_fresher, level, is_archived, department_id, admission_year,
          programme, gender, hometown, admitted_at, created_by)
       VALUES ('Daniel Osei',$1,false,'100',true,$2,$3,'BSc. Computer Science','Male','Sunyani',NOW(),$4)`,
      [archivedNo, deptIds['Computer Science'], String(YEAR_START), deptAdminId['Computer Science']]
    );
    const graduatedNo = makeStudentNo('Computer Science', YEAR_START - 3);
    await client.query(
      `INSERT INTO students
         (name, student_no, is_fresher, level, is_graduated, department_id, admission_year,
          programme, gender, hometown, admitted_at, created_by)
       VALUES ('Priscilla Owusu',$1,false,'400',true,$2,$3,'BSc. Computer Science','Female','Accra',NOW(),$4)`,
      [graduatedNo, deptIds['Computer Science'], String(YEAR_START - 3), deptAdminId['Computer Science']]
    );

    // ── Fresher pre-registration applications (pending, filled from home) ──
    for (const a of APPLICATIONS) {
      await client.query(
        `INSERT INTO fresher_applications
           (full_name, student_no, phone, email, programme, gender, hometown, admission_year, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [a.full_name, a.student_no, a.phone, a.email, a.programme, a.gender, a.hometown, String(YEAR_START)]
      );
    }

    await logAudit(
      schoolAdmin,
      'SCHOOL_ADMIN',
      'settings_update',
      `Set the active academic year to ${ACTIVE_YEAR}`,
      { active_academic_year: ACTIVE_YEAR }
    );

    // Persist each student's receipt counter so live receipts continue from here.
    for (const [sid, n] of receiptSeqByStudent) {
      await client.query('UPDATE students SET receipt_seq = $1 WHERE id = $2', [n, sid]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('Seed data applied.');
  console.log(`Active academic year: ${ACTIVE_YEAR}`);
  console.log('School admin:  admin@sciences.uenr.edu.gh / admin1234');
  console.log('School staff:  staff@sciences.uenr.edu.gh / staff1234');
  for (const d of DEPARTMENTS) {
    console.log(`Dept admin:    ${slug(d.name)}@sciences.uenr.edu.gh / dept1234  (${d.code}, PIN ${d.pin})`);
  }
  console.log('Dept staff:    csstaff@sciences.uenr.edu.gh / staff1234');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
