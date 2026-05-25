/**
 * Demo seed — populates branch 1 (phetgasem 69) with realistic data
 * so you can see what an actual day in the apps looks like.
 *
 * Idempotent-ish: skips creating users that already exist (by email).
 *                 Wipes & rebuilds courses/schedules/students for a clean slate.
 *
 * Run:   node seed_demo.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = 'demo1234';
const BRANCH_ID = 1;

// helpers ---------------------------------------------------------------
function atTime(daysFromToday, hour, minute = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function dateOnly(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function upsertUser({ role, name, email, phone, monthly_salary }) {
  const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
  if (existing.rowCount) {
    console.log(`  · user exists: ${email}`);
    return existing.rows[0].user_id;
  }
  const hash = await bcrypt.hash(PASS, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (branch_id, role, name, email, phone, password_hash, monthly_salary, active_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_DATE - INTERVAL '90 days')
     RETURNING user_id`,
    [BRANCH_ID, role, name, email, phone, hash, monthly_salary || null]
  );
  console.log(`  ✓ created ${role}: ${name} <${email}>`);
  return rows[0].user_id;
}

async function clearDemoData() {
  console.log('\n[1/12] Clearing previous demo data (keeps branch + owner) ...');
  // delete in FK-safe order
  await pool.query('DELETE FROM customer_warnings');
  await pool.query('DELETE FROM contract_school_payments');
  await pool.query('DELETE FROM reinstatement_requests');
  await pool.query('DELETE FROM attendance');
  await pool.query('DELETE FROM package_redemptions');
  await pool.query('DELETE FROM contract_sessions').catch(() => {}); // table may not exist
  await pool.query('DELETE FROM contracts').catch(() => {});
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM expenses');
  await pool.query('DELETE FROM schedule_reservations');
  await pool.query('DELETE FROM enrollments');
  await pool.query('DELETE FROM customer_packages');
  await pool.query('DELETE FROM schedules');
  await pool.query('DELETE FROM contract_schools');
  await pool.query('DELETE FROM promotions');
  await pool.query('DELETE FROM packages');
  await pool.query('DELETE FROM courses');
  await pool.query('DELETE FROM course_levels');
  await pool.query('DELETE FROM robot_types');
  await pool.query('DELETE FROM student_notes').catch(() => {}); // added in migration 008
  await pool.query('DELETE FROM holidays').catch(() => {});     // added in migration 010
  await pool.query('DELETE FROM messages').catch(() => {});
  await pool.query('DELETE FROM students');
  await pool.query("DELETE FROM users WHERE role IN ('staff','parent') AND email LIKE '%@demo.local'");
  console.log('  ✓ cleared');
}

// main ------------------------------------------------------------------
async function main() {
  await clearDemoData();

  // ---- STAFF -----------------------------------------------------------
  console.log('\n[2/12] Staff & teachers ...');
  const teacher1 = await upsertUser({ role: 'staff', name: 'Kru Pim',  email: 'pim@demo.local',  phone: '081-111-1111', monthly_salary: 28000 });
  const teacher2 = await upsertUser({ role: 'staff', name: 'Kru Boss', email: 'boss@demo.local', phone: '081-222-2222', monthly_salary: 30000 });
  const teacher3 = await upsertUser({ role: 'staff', name: 'Kru Nice', email: 'nice@demo.local', phone: '081-333-3333', monthly_salary: 26000 });
  const frontDesk = await upsertUser({ role: 'staff', name: 'Khun May', email: 'may@demo.local', phone: '081-444-4444', monthly_salary: 22000 });

  // ---- PARENTS ---------------------------------------------------------
  console.log('\n[3/12] Parents ...');
  const parents = [];
  const parentDefs = [
    { name: 'Khun Som',    email: 'som@demo.local',    phone: '089-100-0001' },
    { name: 'Khun Tan',    email: 'tan@demo.local',    phone: '089-100-0002' },
    { name: 'Khun Ploy',   email: 'ploy@demo.local',   phone: '089-100-0003' },
    { name: 'Khun Beam',   email: 'beam@demo.local',   phone: '089-100-0004' },
    { name: 'Khun Mint',   email: 'mint@demo.local',   phone: '089-100-0005' },
    { name: 'Khun Earn',   email: 'earn@demo.local',   phone: '089-100-0006' },
  ];
  for (const p of parentDefs) parents.push(await upsertUser({ role: 'parent', ...p }));

  // ---- COURSE CATALOG --------------------------------------------------
  console.log('\n[4/12] Course catalog (levels, robots, courses, packages) ...');
  async function ins(table, cols, vals) {
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(`INSERT INTO ${table} (${cols}) VALUES (${ph}) RETURNING *`, vals);
    return rows[0];
  }
  const lvlBeg = (await ins('course_levels', 'branch_id,name', [BRANCH_ID, 'Beginner'])).level_id;
  const lvlInt = (await ins('course_levels', 'branch_id,name', [BRANCH_ID, 'Intermediate'])).level_id;
  const lvlAdv = (await ins('course_levels', 'branch_id,name', [BRANCH_ID, 'Advanced'])).level_id;

  const robotA = (await ins('robot_types', 'branch_id,name,quantity', [BRANCH_ID, 'Lego SPIKE',  8])).robot_type_id;
  const robotB = (await ins('robot_types', 'branch_id,name,quantity', [BRANCH_ID, 'VEX IQ',      6])).robot_type_id;
  const robotC = (await ins('robot_types', 'branch_id,name,quantity', [BRANCH_ID, 'Arduino Kit', 10])).robot_type_id;

  const cBeg = (await ins('courses', 'branch_id,level_id,robot_type_id,name,description', [BRANCH_ID, lvlBeg, robotA, 'Robotics Beginner', 'First steps with block coding'])).course_id;
  const cInt = (await ins('courses', 'branch_id,level_id,robot_type_id,name,description', [BRANCH_ID, lvlInt, robotB, 'Robotics Intermediate', 'Sensors and motion'])).course_id;
  const cAdv = (await ins('courses', 'branch_id,level_id,robot_type_id,name,description', [BRANCH_ID, lvlAdv, robotC, 'Robotics Advanced', 'Microcontrollers + Python'])).course_id;

  const pkg8Beg  = (await ins('packages', 'course_id,name,class_count,price', [cBeg, '8-Class Pack',  8,  4800])).package_id;
  const pkg16Beg = (await ins('packages', 'course_id,name,class_count,price', [cBeg, '16-Class Pack', 16, 9000])).package_id;
  const pkg8Int  = (await ins('packages', 'course_id,name,class_count,price', [cInt, '8-Class Pack',  8,  5500])).package_id;
  const pkg16Int = (await ins('packages', 'course_id,name,class_count,price', [cInt, '16-Class Pack', 16, 10500])).package_id;
  const pkg8Adv  = (await ins('packages', 'course_id,name,class_count,price', [cAdv, '8-Class Pack',  8,  6500])).package_id;

  // ---- PROMOTIONS ------------------------------------------------------
  console.log('\n[5/12] Promotions ...');
  await pool.query(
    `INSERT INTO promotions (branch_id, package_id, discount_percent, valid_from, valid_until, max_uses, created_by_user_id)
     VALUES ($1,$2,15, NOW() - INTERVAL '5 days', NOW() + INTERVAL '20 days', 50, 1),
            ($1,$3,20, NOW() - INTERVAL '2 days', NOW() + INTERVAL '14 days', 30, 1)`,
    [BRANCH_ID, pkg16Beg, pkg16Int]
  );

  // ---- CONTRACT SCHOOLS ------------------------------------------------
  console.log('\n[6/12] Contract schools ...');
  const csA = (await ins('contract_schools',
    'branch_id,name,address,contact_name,contact_phone,contract_start_date,contract_end_date,sessions_per_week,session_duration_minutes,notes',
    [BRANCH_ID, 'Bangkok Christian School', '35 Pramuan Rd, Bangrak', 'Ms. Wendy', '02-234-5678',
     dateOnly(-30), dateOnly(150), 2, 90, 'Semester program — robotics elective for grades 4–6.'])).contract_school_id;
  const csB = (await ins('contract_schools',
    'branch_id,name,address,contact_name,contact_phone,contract_start_date,contract_end_date,sessions_per_week,session_duration_minutes,notes',
    [BRANCH_ID, 'Sarasas Witaed', '99 Sukhumvit Soi 22', 'Mr. Phong', '02-987-6543',
     dateOnly(-60), dateOnly(20), 1, 60, 'Pilot program — review for renewal in 3 weeks.'])).contract_school_id;

  // record some payments (B2B revenue history)
  await pool.query(
    `INSERT INTO contract_school_payments (contract_school_id, amount, paid_at, notes, recorded_by_user_id)
     VALUES ($1, 25000, NOW() - INTERVAL '20 days', 'March visits', 1),
            ($2, 18000, NOW() - INTERVAL '12 days', 'March visits', 1)`,
    [csA, csB]
  );

  // ---- STUDENTS --------------------------------------------------------
  console.log('\n[7/12] Students (mix of approved + pending) ...');
  const studentDefs = [
    { p: parents[0], name: 'Nong Mind',  nickname: 'Mind',  age: 7,  status: 'approved' },
    { p: parents[0], name: 'Nong Maxx',  nickname: 'Maxx',  age: 9,  status: 'approved' },
    { p: parents[1], name: 'Nong Bua',   nickname: 'Bua',   age: 8,  status: 'approved' },
    { p: parents[1], name: 'Nong Khao',  nickname: 'Khao',  age: 10, status: 'approved' },
    { p: parents[2], name: 'Nong Plern', nickname: 'Plern', age: 6,  status: 'approved' },
    { p: parents[2], name: 'Nong Plug',  nickname: 'Plug',  age: 12, status: 'approved' },
    { p: parents[3], name: 'Nong Pang',  nickname: 'Pang',  age: 11, status: 'approved' },
    { p: parents[3], name: 'Nong Pun',   nickname: 'Pun',   age: 7,  status: 'pending'  },
    { p: parents[4], name: 'Nong Tonn',  nickname: 'Tonn',  age: 8,  status: 'approved' },
    { p: parents[4], name: 'Nong Title', nickname: 'Title', age: 9,  status: 'pending'  },
    { p: parents[5], name: 'Nong Cake',  nickname: 'Cake',  age: 6,  status: 'approved' },
    { p: parents[5], name: 'Nong Cream', nickname: 'Cream', age: 10, status: 'pending'  },
  ];

  const students = [];
  for (const s of studentDefs) {
    const r = await pool.query(
      `INSERT INTO students (parent_user_id, branch_id, name, nickname, age, approval_status, confirmed_by_user_id, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6='approved' THEN 1 ELSE NULL END,
                                  CASE WHEN $6='approved' THEN NOW() ELSE NULL END)
       RETURNING student_id, name, approval_status`,
      [s.p, BRANCH_ID, s.name, s.nickname, s.age, s.status]
    );
    students.push(r.rows[0]);
  }
  console.log(`  ✓ ${students.length} students (${students.filter(x => x.approval_status === 'approved').length} approved, ${students.filter(x => x.approval_status === 'pending').length} pending)`);

  // ---- SCHEDULES (TODAY + WEEK AHEAD) ----------------------------------
  console.log('\n[8/12] Schedules (today + 7 days) ...');
  // Branch sessions today
  const schedules = {};
  async function mkSched(courseId, teacherId, day, hour, mins = 60, cap = 8) {
    const r = await pool.query(
      `INSERT INTO schedules (branch_id, course_id, teacher_user_id, schedule_type, starts_at, ends_at, max_capacity)
       VALUES ($1,$2,$3,'branch',$4,$5,$6) RETURNING schedule_id`,
      [BRANCH_ID, courseId, teacherId, atTime(day, hour), atTime(day, hour, mins), cap]
    );
    return r.rows[0].schedule_id;
  }
  async function mkContractSched(teacherId, contractSchoolId, day, hour) {
    const r = await pool.query(
      `INSERT INTO schedules (branch_id, course_id, teacher_user_id, schedule_type, contract_school_id, starts_at, ends_at, max_capacity)
       VALUES ($1, NULL, $2, 'contract_school', $3, $4, $5, 25) RETURNING schedule_id`,
      [BRANCH_ID, teacherId, contractSchoolId, atTime(day, hour), atTime(day, hour, 90)]
    );
    return r.rows[0].schedule_id;
  }

  // TODAY
  schedules.today_morning   = await mkSched(cBeg, teacher1, 0, 9, 60);   // 09:00 Beginner
  schedules.today_noon      = await mkSched(cInt, teacher2, 0, 11, 60);  // 11:00 Intermediate
  schedules.today_afternoon = await mkSched(cAdv, teacher3, 0, 14, 60);  // 14:00 Advanced
  schedules.today_evening   = await mkSched(cBeg, teacher1, 0, 16, 60);  // 16:00 Beginner
  schedules.today_school    = await mkContractSched(teacher2, csA, 0, 13); // 13:00 contract school

  // Tomorrow + week
  for (let d = 1; d <= 7; d++) {
    schedules[`d${d}_a`] = await mkSched(cBeg, teacher1, d, 10);
    schedules[`d${d}_b`] = await mkSched(cInt, teacher2, d, 13);
    schedules[`d${d}_c`] = await mkSched(cAdv, teacher3, d, 15);
    if (d % 2 === 1) schedules[`d${d}_school`] = await mkContractSched(teacher2, d % 4 === 1 ? csA : csB, d, 11);
  }
  console.log(`  ✓ ${Object.keys(schedules).length} schedules`);

  // ---- CUSTOMER PACKAGES & ENROLLMENTS ---------------------------------
  console.log('\n[9/12] Packages purchased + enrollments ...');
  const approvedStudents = students.filter(s => s.approval_status === 'approved');
  const cpkgs = {};
  // give each approved student a package
  const pkgPool = [pkg8Beg, pkg16Beg, pkg8Int, pkg16Int, pkg8Adv];
  for (let i = 0; i < approvedStudents.length; i++) {
    const pkgId = pkgPool[i % pkgPool.length];
    const r = await pool.query(
      `INSERT INTO customer_packages (student_id, package_id, is_active)
       VALUES ($1, $2, true) RETURNING customer_package_id`,
      [approvedStudents[i].student_id, pkgId]
    );
    cpkgs[approvedStudents[i].student_id] = r.rows[0].customer_package_id;
  }

  // Enroll students into today's sessions (mix confirmed + pending)
  async function enroll(studentId, scheduleId, status = 'confirmed') {
    const cp = cpkgs[studentId];
    const r = await pool.query(
      `INSERT INTO enrollments (student_id, schedule_id, customer_package_id, status)
       VALUES ($1,$2,$3,$4) RETURNING enrollment_id`,
      [studentId, scheduleId, cp, status]
    );
    return r.rows[0].enrollment_id;
  }

  const enrollMap = {};
  // Today morning class — 4 confirmed
  enrollMap.e1 = await enroll(approvedStudents[0].student_id, schedules.today_morning, 'confirmed');
  enrollMap.e2 = await enroll(approvedStudents[1].student_id, schedules.today_morning, 'confirmed');
  enrollMap.e3 = await enroll(approvedStudents[2].student_id, schedules.today_morning, 'confirmed');
  enrollMap.e4 = await enroll(approvedStudents[3].student_id, schedules.today_morning, 'pending');
  // Today noon — 3
  enrollMap.e5 = await enroll(approvedStudents[4].student_id, schedules.today_noon, 'confirmed');
  enrollMap.e6 = await enroll(approvedStudents[5].student_id, schedules.today_noon, 'confirmed');
  // Today afternoon — 2
  enrollMap.e7 = await enroll(approvedStudents[6].student_id, schedules.today_afternoon, 'confirmed');
  enrollMap.e8 = await enroll(approvedStudents[7].student_id, schedules.today_afternoon, 'pending');
  // Today evening — 2
  enrollMap.e9  = await enroll(approvedStudents[0].student_id, schedules.today_evening, 'confirmed');
  enrollMap.e10 = await enroll(approvedStudents[2].student_id, schedules.today_evening, 'confirmed');

  // Future enrollments (next 7 days, sprinkle)
  for (let d = 1; d <= 5; d++) {
    await enroll(approvedStudents[d % approvedStudents.length].student_id, schedules[`d${d}_a`], 'confirmed');
    await enroll(approvedStudents[(d + 1) % approvedStudents.length].student_id, schedules[`d${d}_b`], 'pending');
  }
  console.log(`  ✓ enrollments created`);

  // ---- SCHEDULE RESERVATIONS (pending confirmations) ------------------
  console.log('\n[10/12] Pending reservation confirmations ...');
  // give parents some pending reservations to confirm
  for (let i = 0; i < 4; i++) {
    const stu = approvedStudents[i];
    await pool.query(
      `INSERT INTO schedule_reservations (student_id, schedule_id, day_of_week, recurrence_active, confirm_deadline, status)
       VALUES ($1, $2, EXTRACT(DOW FROM NOW())::int, true, NOW() + INTERVAL '2 days', 'pending_confirmation')`,
      [stu.student_id, schedules[`d${i + 1}_a`]]
    );
  }

  // ---- ATTENDANCE (past sessions) -------------------------------------
  console.log('\n[11/12] Past attendance + reinstatements + warnings ...');
  // Create past schedules + attendance records so dashboard has history
  const pastSched1 = (await pool.query(
    `INSERT INTO schedules (branch_id, course_id, teacher_user_id, schedule_type, starts_at, ends_at, max_capacity)
     VALUES ($1,$2,$3,'branch', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days' + INTERVAL '1 hour', 8) RETURNING schedule_id`,
    [BRANCH_ID, cBeg, teacher1]
  )).rows[0].schedule_id;

  const pastEnroll = await pool.query(
    `INSERT INTO enrollments (student_id, schedule_id, customer_package_id, status)
     VALUES ($1, $2, $3, 'confirmed') RETURNING enrollment_id`,
    [approvedStudents[7].student_id, pastSched1, cpkgs[approvedStudents[7].student_id]]
  );
  const pastEnrollId = pastEnroll.rows[0].enrollment_id;

  const att = await pool.query(
    `INSERT INTO attendance (enrollment_id, schedule_id, student_id, status, marked_by_user_id)
     VALUES ($1, $2, $3, 'absent', $4) RETURNING attendance_id`,
    [pastEnrollId, pastSched1, approvedStudents[7].student_id, teacher1]
  );

  // Reinstatement request for that absence
  await pool.query(
    `INSERT INTO reinstatement_requests (attendance_id, student_id, customer_package_id, reason_category, reason_detail, evidence_url, status)
     VALUES ($1, $2, $3, 'medical', $4, 'https://example.com/doctor-note.jpg', 'pending')`,
    [att.rows[0].attendance_id, approvedStudents[7].student_id, cpkgs[approvedStudents[7].student_id],
     'Student had high fever and was taken to the hospital. Doctor advised one week of rest, please find the medical certificate attached.']
  );

  // Customer warnings (low classes remaining)
  await pool.query(
    `INSERT INTO customer_warnings (student_id, branch_id, classes_remaining, generated_date)
     VALUES ($1,$2,2,CURRENT_DATE),
            ($3,$2,1,CURRENT_DATE),
            ($4,$2,3,CURRENT_DATE)`,
    [approvedStudents[2].student_id, BRANCH_ID, approvedStudents[5].student_id, approvedStudents[6].student_id]
  );

  // ---- STUDENT NOTES ---------------------------------------------------
  console.log('\n[12/13] Student progress notes ...');
  const noteData = [
    { stu: 0, author: teacher1, body: 'Completed block coding intro. Grasps loops well. Ready to move to sensors next session.' },
    { stu: 0, author: teacher1, body: 'Built line follower independently. Needed a hint on threshold tuning but got there. Strong progress.' },
    { stu: 1, author: teacher2, body: 'Good spatial reasoning for gear ratios. Tends to rush the build — remind to read instructions first.' },
    { stu: 2, author: teacher1, body: 'Shy at first but opens up once coding starts. Paired her with Mind today and they worked great together.' },
    { stu: 3, author: teacher2, body: 'Advanced quickly through beginner content. Consider moving to intermediate after next 2 sessions.' },
    { stu: 4, author: teacher3, body: 'Strong logical thinking. First student to finish the sumobot challenge. Parent asked about advanced track.' },
    { stu: 5, author: teacher3, body: 'Struggled with Python syntax today. Spent extra 10 min reviewing indentation rules. Needs more practice.' },
    { stu: 5, author: teacher3, body: 'Much better this week! Completed the LED pattern challenge without help. Building confidence.' },
    { stu: 6, author: teacher2, body: 'Good session — focused the whole time. Parents confirmed they\'ll renew the package next month.' },
  ];
  for (const n of noteData) {
    const stu = approvedStudents[n.stu];
    await pool.query(
      `INSERT INTO student_notes (student_id, author_id, body, created_at)
       VALUES ($1, $2, $3, NOW() - ($4 || ' days')::interval)`,
      [stu.student_id, n.author, n.body, noteData.indexOf(n) + 1]
    );
  }
  console.log(`  ✓ ${noteData.length} progress notes`);

  // ---- TRANSACTIONS, EXPENSES -----------------------------------------
  console.log('\n[13/13] Transactions + expenses ...');
  // confirmed transactions (revenue history)
  for (let i = 0; i < approvedStudents.length; i++) {
    const stu = approvedStudents[i];
    const cp = cpkgs[stu.student_id];
    await pool.query(
      `INSERT INTO transactions (branch_id, student_id, customer_package_id, amount, payment_method, status, confirmed_by_user_id, confirmed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'confirmed',1, NOW() - ($6 || ' days')::interval, NOW() - ($6 || ' days')::interval)`,
      [BRANCH_ID, stu.student_id, cp, [4800, 9000, 5500, 10500, 6500][i % 5], i % 2 ? 'transfer' : 'cash', i + 2]
    );
  }
  // 2 pending transactions (waiting for owner approval)
  for (let i = 0; i < 2; i++) {
    await pool.query(
      `INSERT INTO transactions (branch_id, student_id, customer_package_id, amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,'transfer','pending', NOW() - INTERVAL '6 hours')`,
      [BRANCH_ID, approvedStudents[i].student_id, cpkgs[approvedStudents[i].student_id], [4800, 5500][i]]
    );
  }

  // expenses
  await pool.query(
    `INSERT INTO expenses (branch_id, submitted_by_user_id, amount, category, description, status, submitted_at)
     VALUES ($1,$2, 850, 'travel',   'Taxi to Bangkok Christian School visit', 'pending',  NOW() - INTERVAL '1 day'),
            ($1,$3, 2200,'supplies', 'Replacement Lego SPIKE motors',          'pending',  NOW() - INTERVAL '2 hours'),
            ($1,$2, 1500,'travel',   'Grab to school visit (last week)',       'approved', NOW() - INTERVAL '6 days'),
            ($1,$4, 320, 'other',    'Snacks for kids party',                  'approved', NOW() - INTERVAL '10 days')`,
    [BRANCH_ID, teacher1, teacher3, frontDesk]
  );
  // mark approved ones with approver
  await pool.query(`UPDATE expenses SET approved_by_user_id = 1, approved_at = submitted_at + INTERVAL '1 day' WHERE status = 'approved'`);

  // ─── Messages ───────────────────────────────────────────────────────────────
  const [p1, p2, p3] = parents; // Som, Tan, Ploy
  await pool.query(
    `INSERT INTO messages (parent_id, sender_role, sender_id, body, is_read, created_at) VALUES
       ($1, 'parent', $1, 'Hello, how is my child doing this week?',                   false, NOW() - INTERVAL '2 hours'),
       ($1, 'staff',  $2, 'Hi! They did great on the line follower challenge today.',  true,  NOW() - INTERVAL '1 hour 50 minutes'),
       ($1, 'parent', $1, 'That is wonderful, thank you so much!',                     false, NOW() - INTERVAL '1 hour 45 minutes'),

       ($3, 'parent', $3, 'Is the session on Friday still on?',  true,  NOW() - INTERVAL '1 day'),
       ($3, 'staff',  $2, 'Yes, confirmed for 10:00 as usual.',  true,  NOW() - INTERVAL '23 hours'),

       ($4, 'parent', $4, 'Can we reschedule next week session? We have a trip.',  false, NOW() - INTERVAL '30 minutes')`,
    [p1.user_id, teacher1, p2.user_id, p3.user_id]
  );

  // ─── Complaints ─────────────────────────────────────────────────────────────
  await pool.query('DELETE FROM complaints').catch(() => {});
  await pool.query(
    `INSERT INTO complaints (parent_id, student_id, subject, body, status, created_at) VALUES
       ($1, $5, 'Missing robot parts in kit',        'My child''s kit was missing the sensor module. Can you please arrange a replacement?', 'pending',  NOW() - INTERVAL '2 days'),
       ($1, $5, 'Request to change session time',    'We have a schedule conflict on Thursdays. Is it possible to move to Friday afternoon?', 'reviewed', NOW() - INTERVAL '8 days'),
       ($2, $6, 'Feedback on beginner curriculum',   'The beginner course is moving a bit fast for my child. Could the teachers slow down slightly?', 'pending',  NOW() - INTERVAL '1 day'),
       ($3, $7, 'Parking issue at the branch',       'There is very limited parking near the branch. Please consider reserved spots for pickup times.', 'reviewed', NOW() - INTERVAL '5 days')`,
    [p1.user_id, p2.user_id, p3.user_id, parents[3],
     students[0].student_id, students[2].student_id, students[4].student_id]
  );

  // ─── Holidays ───────────────────────────────────────────────────────────────
  await pool.query('DELETE FROM holidays').catch(() => {});
  await pool.query(
    `INSERT INTO holidays (branch_id, name, start_date, end_date) VALUES
       ($1, 'Songkran Holiday',   '2026-04-13', '2026-04-15'),
       ($1, 'Labour Day',         '2026-05-01', '2026-05-01'),
       ($1, 'Summer Break',       '2026-06-01', '2026-06-30'),
       ($1, 'Christmas Break',    '2026-12-24', '2027-01-02')`,
    [BRANCH_ID]
  );

  console.log('\n========================================');
  console.log('Demo seed complete!');
  console.log('========================================');
  console.log('\nLogin credentials (all passwords: ' + PASS + '):');
  console.log('\n  OWNER  → apivit37463@gmail.com / Jmff2807   (your existing account)');
  console.log('\n  STAFF (use staff app):');
  console.log('    pim@demo.local       Kru Pim   (teacher)');
  console.log('    boss@demo.local      Kru Boss  (teacher)');
  console.log('    nice@demo.local      Kru Nice  (teacher)');
  console.log('    may@demo.local       Khun May  (front desk)');
  console.log('\n  PARENTS (use parent app):');
  parentDefs.forEach(p => console.log(`    ${p.email.padEnd(20)} ${p.name}`));
  console.log('\nWhat to look for in the apps:');
  console.log('  • Today screen (staff): 5 sessions today across 3 teachers + warnings list');
  console.log('  • Approvals tab (owner): 3 pending students + 2 pending payments + 1 reinstatement');
  console.log('  • Schedule (parent): monthly calendar with dots on session days');
  console.log('  • Dashboard (owner): revenue from past transactions');
  console.log('  • Expenses: 2 pending submitted by teachers');
  console.log('');
}

main()
  .catch(e => { console.error('\nSEED FAILED:', e); process.exit(1); })
  .finally(() => pool.end());
