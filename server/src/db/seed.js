const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { ensureDatabase } = require('./setup');

async function seed() {
  await ensureDatabase();

  // School admin
  const hash = await bcrypt.hash('admin1234', 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('School Admin', 'admin@sciences.uenr.edu.gh', $1, 'school_admin')
     ON CONFLICT (email) DO NOTHING`,
    [hash]
  );

  // Departments
  const depts = [
    { name: 'Mathematics', dues: 50 },
    { name: 'Biology', dues: 50 },
    { name: 'Chemistry', dues: 50 },
    { name: 'Physics', dues: 50 },
    { name: 'Computer Science', dues: 60 },
  ];

  const deptIds = {};
  for (const d of depts) {
    const res = await pool.query(
      `INSERT INTO departments (name, dues_amount) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET dues_amount = EXCLUDED.dues_amount
       RETURNING id`,
      [d.name, d.dues]
    );
    deptIds[d.name] = res.rows[0].id;
  }

  // Classes for each department
  const levels = ['Level 100', 'Level 200', 'Level 300'];
  for (const [dept, id] of Object.entries(deptIds)) {
    for (const lv of levels) {
      const codePart = dept.replace(/[^A-Za-z]/g, '').toUpperCase();
      const code = `${codePart}-100-${lv.split(' ')[1]}`;
      await pool.query(
        `INSERT INTO classes (department_id, name, level, code) VALUES ($1, $2, $3, $4)
         ON CONFLICT (department_id, name) DO NOTHING`,
        [id, lv, lv, `${codePart}-${lv.split(' ')[1]}-${lv.split(' ')[1]}`]
      );
    }
  }

  // Souvenirs
  const souvenirs = [
    { name: 'School T-Shirt', category: 'school', cost: 10 },
    { name: 'School Cap', category: 'school', cost: 8 },
    { name: 'School Mug', category: 'school', cost: 6 },
    { name: 'Department Pen', category: 'department', cost: 2 },
    { name: 'Department Sticker', category: 'department', cost: 1 },
    { name: 'Department Notebook', category: 'department', cost: 5 },
  ];
  for (const s of souvenirs) {
    await pool.query(
      `INSERT INTO souvenirs (name, category, cost) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [s.name, s.category, s.cost]
    );
  }

  console.log('Seed data applied.');
  console.log('School admin login: admin@sciences.uenr.edu.gh / admin1234');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
