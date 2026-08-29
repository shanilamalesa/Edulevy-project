require('dotenv').config({ path: '../.env' });
const argon2 = require('argon2');
const { pool } = require('./src/db/pool');
const { withTenant } = require('./src/db/withTenant');

const GREEN = 'eadd75ae-1946-45f7-a73b-ea2b850b8d2c';
const MARYS = '41c2bc98-5776-489f-9f10-085fab23bc8a';

const FIRST = ['Amina','Yusuf','Fatuma','Hassan','Grace','Peter','Mercy','Brian','Faith','Kevin',
               'Joy','Samuel','Esther','Daniel','Ruth','John','Sarah','James','Mary','Paul'];
const LAST  = ['Otieno','Wanjiru','Kimani','Ochieng','Njeri','Mwangi','Achieng','Kamau','Wambui','Odhiambo'];
const CLASSES = ['Form 1','Form 2','Form 3','Form 4'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function seedSchool(tenantId, prefix, studentCount) {
  await withTenant(tenantId, async (c) => {
    // Fee items
    const fees = [
      ['T2-TUITION', 'Term 2 Tuition',      'tuition', 1200000],
      ['T2-EXAM',    'Term 2 Exam Fee',     'tuition',  150000],
      ['F3-TRIP',    'Form 3 Nairobi Trip', 'trip',     200000],
      ['CHESS',      'Chess Club',          'club',      50000],
      ['FOOTBALL',   'Football Kit',        'sport',     80000],
    ];

    const feeIds = {};
    for (const [code, label, category, amount] of fees) {
      const r = await c.query(
        `INSERT INTO fee_items (tenant_id, code, label, category, amount_minor)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [tenantId, code, label, category, amount]
      );
      feeIds[code] = r.rows[0].id;
    }

    for (let i = 1; i <= studentCount; i++) {
      const admission = `${prefix}-${String(i).padStart(3, '0')}`;
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const klass = pick(CLASSES);

      const s = await c.query(
        `INSERT INTO students (tenant_id, admission_no, full_name, class_label)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, admission, name, klass]
      );
      const studentId = s.rows[0].id;

      // Everyone gets tuition and the exam fee
      let charged = 0;
      for (const code of ['T2-TUITION', 'T2-EXAM']) {
        const amount = fees.find((f) => f[0] === code)[3];
        charged += amount;
        await c.query(
          `INSERT INTO charges (tenant_id, student_id, fee_item_id, amount_minor)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, studentId, feeIds[code], amount]
        );
      }

      // Some get extras
      if (klass === 'Form 3' && Math.random() < 0.7) {
        charged += 200000;
        await c.query(
          `INSERT INTO charges (tenant_id, student_id, fee_item_id, amount_minor)
           VALUES ($1,$2,$3,200000)`,
          [tenantId, studentId, feeIds['F3-TRIP']]
        );
      }

      // A realistic spread: fully paid, part paid, nothing, one in credit
      const roll = Math.random();
      let paid = 0;
      if (roll < 0.35) paid = charged;                       // paid up
      else if (roll < 0.75) paid = Math.round(charged * (0.2 + Math.random() * 0.5 / 100) * 100);
      else if (roll < 0.95) paid = 0;                        // owing
      else paid = charged + rand(50000, 200000);             // in credit

      if (paid > 0) {
        const ref = 'R' + Math.random().toString(36).slice(2, 10).toUpperCase();
        const daysAgo = rand(1, 30);
        await c.query(
          `INSERT INTO payments (tenant_id, student_id, provider, provider_ref,
                                 amount_minor, status, raw_payload, created_at)
           VALUES ($1,$2,'mpesa',$3,$4,'settled','{"channel":"ussd"}',
                   now() - ($5 || ' days')::interval)`,
          [tenantId, studentId, ref, paid, daysAgo]
        );
      }
    }
  });
}

(async () => {
  console.log('seeding Green Hills…');
  await seedSchool(GREEN, 'ADM', 24);

  console.log('seeding St Marys…');
  await seedSchool(MARYS, 'ADM', 16);

  // Guardians for the demo — both linked to the first two Green Hills students
  await withTenant(GREEN, async (c) => {
    const students = await c.query(
      'SELECT id, full_name FROM students ORDER BY admission_no LIMIT 2'
    );

    for (const [msisdn, name] of [
      ['+254708374149', 'Mary Otieno'],   // USSD, Daraja test number
      ['+447417449196', 'John Otieno'],   // WhatsApp, Twilio sandbox
    ]) {
      const g = await c.query(
        `INSERT INTO guardians (tenant_id, msisdn, full_name)
         VALUES ($1,$2,$3) RETURNING id`,
        [GREEN, msisdn, name]
      );
      for (const s of students.rows) {
        await c.query(
          `INSERT INTO guardian_students (guardian_id, student_id, tenant_id)
           VALUES ($1,$2,$3)`,
          [g.rows[0].id, s.id, GREEN]
        );
      }
    }

    // Staff for payroll
    for (const [name, msisdn, title, gross] of [
      ['Peter Otieno',  '+254722000111', 'Teacher', 4500000],
      ['Grace Wanjiru', '+254722000222', 'Teacher', 5200000],
      ['Samuel Kimani', '+254722000333', 'Bursar',  3800000],
      ['Esther Njeri',  '+254722000444', 'Teacher', 4800000],
    ]) {
      await c.query(
        `INSERT INTO staff (tenant_id, full_name, msisdn, role_title, gross_minor)
         VALUES ($1,$2,$3,$4,$5)`,
        [GREEN, name, msisdn, title, gross]
      );
    }
  });

  console.log('done — 24 students at Green Hills, 16 at St Marys');
  process.exit(0);
})();