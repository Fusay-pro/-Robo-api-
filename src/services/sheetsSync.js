const cron    = require('node-cron');
const { google } = require('googleapis');
const { query }  = require('../config/db');

// ─── Shared helpers ──────────────────────────────────────────────────────────

function getSheetsClient() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  if (!key.type) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Extract spreadsheet ID from a full URL or return the value as-is if it's already an ID.
function extractSheetId(urlOrId) {
  if (!urlOrId) return null;
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : urlOrId;
}

// Per-branch sheet IDs — DB values take priority over env vars.
async function getBranchSheetIds(branchId) {
  const { rows: [branch] } = await query(
    'SELECT sheets_operational_id, sheets_finance_id FROM branches WHERE branch_id = $1',
    [branchId]
  );
  return {
    operationalId: extractSheetId(branch?.sheets_operational_id) || process.env.GOOGLE_SHEETS_OPERATIONAL_ID,
    financeId:     extractSheetId(branch?.sheets_finance_id)     || process.env.GOOGLE_SHEETS_FINANCE_ID || process.env.GOOGLE_SHEETS_ID,
  };
}

async function clearAndWrite(sheets, spreadsheetId, tabName, rows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

async function readTab(sheets, spreadsheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

// ─── Finance sync (existing, runs 1st of each month) ─────────────────────────

async function syncSheets(month) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const monthStart  = `${targetMonth}-01`;

  const { rows: branches } = await query('SELECT * FROM branches WHERE deleted_at IS NULL');
  const sheets = getSheetsClient();
  if (!sheets) { console.log('Sheets sync: no service account key configured'); return; }

  for (const branch of branches) {
    const { financeId: spreadsheetId } = await getBranchSheetIds(branch.branch_id);
    try {
      const { rows: [rev] } = await query(
        `SELECT
           COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'confirmed'), 0) AS branch_revenue,
           COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)  AS expenses
         FROM branches b
         LEFT JOIN transactions t ON t.branch_id = b.branch_id AND to_char(t.created_at,'YYYY-MM') = $1
         LEFT JOIN expenses e     ON e.branch_id = b.branch_id AND to_char(e.submitted_at,'YYYY-MM') = $1
         WHERE b.branch_id = $2`, [targetMonth, branch.branch_id]
      );
      const { rows: [csr] } = await query(
        `SELECT COALESCE(SUM(csp.amount),0) AS contract_revenue
         FROM contract_school_payments csp
         JOIN contract_schools cs ON csp.contract_school_id = cs.contract_school_id
         WHERE cs.branch_id = $1 AND to_char(csp.created_at,'YYYY-MM') = $2`,
        [branch.branch_id, targetMonth]
      );
      const { rows: [sal] } = await query(
        `SELECT COALESCE(SUM(
           monthly_salary *
           (LEAST(COALESCE(active_until,CURRENT_DATE),(date_trunc('month',$2::date)+interval'1 month - 1 day')::date)
            -GREATEST(active_from,date_trunc('month',$2::date)::date)+1)::numeric
           /EXTRACT(DAY FROM date_trunc('month',$2::date)+interval'1 month - 1 day')
         ),0) AS salary
         FROM users WHERE branch_id=$1 AND role='staff' AND monthly_salary IS NOT NULL
           AND active_from IS NOT NULL AND deleted_at IS NULL`,
        [branch.branch_id, monthStart]
      );
      const revenue  = Number(rev.branch_revenue) + Number(csr.contract_revenue);
      const salary   = Number(sal.salary);
      const expenses = Number(rev.expenses);
      const profit   = revenue - salary - expenses;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Monthly Summary!A:F',
        valueInputOption: 'RAW',
        requestBody: { values: [[targetMonth, branch.name, revenue, salary, expenses, profit]] },
      });
      await query(
        `INSERT INTO sheets_sync_log (branch_id, sync_month, status, sync_type, triggered_by)
         VALUES ($1,$2,'success','finance','cron')`,
        [branch.branch_id, monthStart]
      );
    } catch (err) {
      await query(
        `INSERT INTO sheets_sync_log (branch_id, sync_month, status, sync_type, triggered_by, error_message)
         VALUES ($1,$2,'failed','finance','cron',$3)`,
        [branch.branch_id, monthStart, err.message]
      );
    }
  }
}

// ─── Operational sync (push DB → sheets) ─────────────────────────────────────

async function pushOperationalSync(branchId, triggeredBy = 'cron') {
  const sheets = getSheetsClient();
  if (!sheets) throw new Error('Google service account not configured');
  const { operationalId, financeId } = await getBranchSheetIds(branchId);
  if (!operationalId) throw new Error('No operational sheet configured for this branch');

  const rowsWritten = {};

  // Students tab
  const { rows: students } = await query(
    `SELECT s.student_id, s.name, s.nickname, s.age, b.name AS branch,
            s.approval_status,
            u.name  AS parent_name,
            u.phone AS parent_phone,
            COALESCE((
              SELECT (SUM(COALESCE(cp2.custom_class_count, p2.class_count)) -
                      COUNT(pr2.redemption_id))::int
              FROM customer_packages cp2
              JOIN packages p2 ON cp2.package_id = p2.package_id
              LEFT JOIN package_redemptions pr2 ON pr2.customer_package_id = cp2.customer_package_id
              WHERE cp2.student_id = s.student_id AND cp2.is_active = true
            ), 0) AS classes_remaining,
            s.created_at::date AS joined_date
     FROM students s
     LEFT JOIN users u ON s.parent_user_id = u.user_id
     JOIN  branches b  ON s.branch_id = b.branch_id
     WHERE s.branch_id = $1 AND s.deleted_at IS NULL
     ORDER BY s.name`,
    [branchId]
  );
  const studentRows = [
    ['student_id','name','nickname','age','branch','approval_status','parent_name','parent_phone','classes_remaining','joined_date'],
    ...students.map(r => [r.student_id, r.name, r.nickname ?? '', r.age ?? '', r.branch, r.approval_status, r.parent_name ?? '', r.parent_phone ?? '', r.classes_remaining, String(r.joined_date)]),
  ];
  await clearAndWrite(sheets, operationalId, 'Students', studentRows);
  rowsWritten.students = students.length;

  // Schedules tab
  const { rows: schedules } = await query(
    `SELECT sc.schedule_id,
            sc.starts_at::date            AS date,
            sc.starts_at::time            AS start_time,
            sc.ends_at::time              AS end_time,
            COALESCE(c.name, cs.name, 'Session') AS course_name,
            u.name                        AS teacher_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.schedule_id = sc.schedule_id
               AND e.deleted_at IS NULL AND e.status != 'cancelled') AS enrolled_count,
            sc.max_capacity,
            sc.schedule_type              AS type
     FROM schedules sc
     LEFT JOIN courses c         ON sc.course_id = c.course_id
     LEFT JOIN contract_schools cs ON sc.contract_school_id = cs.contract_school_id
     LEFT JOIN users u           ON sc.teacher_user_id = u.user_id
     WHERE sc.branch_id = $1 AND sc.deleted_at IS NULL
     ORDER BY sc.starts_at DESC
     LIMIT 500`,
    [branchId]
  );
  const scheduleRows = [
    ['schedule_id','date','start_time','end_time','course_name','teacher_name','enrolled_count','max_capacity','type'],
    ...schedules.map(r => [r.schedule_id, String(r.date), String(r.start_time), String(r.end_time), r.course_name, r.teacher_name ?? '', r.enrolled_count, r.max_capacity ?? '', r.type]),
  ];
  await clearAndWrite(sheets, operationalId, 'Schedules', scheduleRows);
  rowsWritten.schedules = schedules.length;

  // Attendance tab
  const { rows: attendance } = await query(
    `SELECT sc.starts_at::date           AS date,
            s.name                       AS student_name,
            COALESCE(c.name, 'Session')  AS course_name,
            a.status,
            u.name                       AS marked_by,
            a.notes
     FROM attendance a
     JOIN enrollments e   ON a.enrollment_id = e.enrollment_id
     JOIN schedules sc    ON a.schedule_id   = sc.schedule_id
     JOIN students s      ON a.student_id    = s.student_id
     LEFT JOIN courses c  ON sc.course_id    = c.course_id
     LEFT JOIN users u    ON a.marked_by_user_id = u.user_id
     WHERE sc.branch_id = $1
     ORDER BY sc.starts_at DESC
     LIMIT 1000`,
    [branchId]
  );
  const attendanceRows = [
    ['date','student_name','course_name','status','marked_by','notes'],
    ...attendance.map(r => [String(r.date), r.student_name, r.course_name, r.status, r.marked_by ?? '', r.notes ?? '']),
  ];
  await clearAndWrite(sheets, operationalId, 'Attendance', attendanceRows);
  rowsWritten.attendance = attendance.length;

  // Packages tab
  const { rows: packages } = await query(
    `SELECT cp.customer_package_id,
            s.name                                        AS student_name,
            COALESCE(cp.custom_name, p.name)              AS package_name,
            c.name                                        AS course_name,
            COALESCE(cp.custom_class_count, p.class_count) AS class_count,
            (COALESCE(cp.custom_class_count, p.class_count) - COUNT(pr.redemption_id)::int) AS classes_remaining,
            cp.is_active
     FROM customer_packages cp
     JOIN students s  ON cp.student_id  = s.student_id
     JOIN packages p  ON cp.package_id  = p.package_id
     JOIN courses c   ON p.course_id    = c.course_id
     LEFT JOIN package_redemptions pr ON pr.customer_package_id = cp.customer_package_id
     WHERE s.branch_id = $1
     GROUP BY cp.customer_package_id, s.name, p.name, c.name,
              p.class_count, cp.custom_name, cp.custom_class_count, cp.is_active
     ORDER BY s.name, cp.is_active DESC`,
    [branchId]
  );
  const packageRows = [
    ['customer_package_id','student_name','package_name','course_name','class_count','classes_remaining','is_active'],
    ...packages.map(r => [r.customer_package_id, r.student_name, r.package_name, r.course_name, r.class_count, r.classes_remaining, r.is_active ? 'true' : 'false']),
  ];
  await clearAndWrite(sheets, operationalId, 'Packages', packageRows);
  rowsWritten.packages = packages.length;

  // Transactions tab (finance sheet)
  if (financeId) {
    const { rows: transactions } = await query(
      `SELECT t.transaction_id,
              t.created_at::date           AS date,
              s.name                       AS student_name,
              COALESCE(cp.custom_name, p.name) AS package_name,
              t.amount,
              t.payment_method,
              t.status
       FROM transactions t
       JOIN students s         ON t.student_id         = s.student_id
       JOIN customer_packages cp ON t.customer_package_id = cp.customer_package_id
       JOIN packages p         ON cp.package_id        = p.package_id
       WHERE t.branch_id = $1
       ORDER BY t.created_at DESC
       LIMIT 1000`,
      [branchId]
    );
    const txRows = [
      ['transaction_id','date','student_name','package_name','amount','payment_method','status'],
      ...transactions.map(r => [r.transaction_id, String(r.date), r.student_name, r.package_name, r.amount, r.payment_method, r.status]),
    ];
    await clearAndWrite(sheets, financeId, 'Transactions', txRows);
    rowsWritten.transactions = transactions.length;
  }

  const synced_at = new Date().toISOString();
  await query(
    `INSERT INTO sheets_sync_log (branch_id, sync_month, status, sync_type, triggered_by, rows_written)
     VALUES ($1, to_char(now(),'YYYY-MM'), 'success', 'operational', $2, $3)`,
    [branchId, triggeredBy, Object.values(rowsWritten).reduce((a, b) => a + b, 0)]
  );

  return { synced_at, rows_written: rowsWritten };
}

// ─── Pull: preview diff (sheets → DB) ────────────────────────────────────────

async function previewPull(branchId) {
  const sheets = getSheetsClient();
  if (!sheets) throw new Error('Google service account not configured');
  const { operationalId, financeId } = await getBranchSheetIds(branchId);
  if (!operationalId) throw new Error('No operational sheet configured for this branch');

  const diff = {
    students:     { updated: [] },
    packages:     { updated: [] },
    transactions: { added: [] },
  };

  // Students — compare name & nickname
  const studentSheet = await readTab(sheets, operationalId, 'Students');
  if (studentSheet.length > 1) {
    const header = studentSheet[0];
    const idIdx   = header.indexOf('student_id');
    const nameIdx = header.indexOf('name');
    const nickIdx = header.indexOf('nickname');

    const sheetIds = studentSheet.slice(1)
      .map(r => parseInt(r[idIdx]))
      .filter(id => !isNaN(id));

    if (sheetIds.length) {
      const { rows: dbStudents } = await query(
        `SELECT student_id, name, nickname FROM students
         WHERE student_id = ANY($1) AND branch_id = $2 AND deleted_at IS NULL`,
        [sheetIds, branchId]
      );
      const dbMap = Object.fromEntries(dbStudents.map(s => [s.student_id, s]));

      for (const row of studentSheet.slice(1)) {
        const id = parseInt(row[idIdx]);
        if (isNaN(id) || !dbMap[id]) continue;
        const db = dbMap[id];
        const sheetName = (row[nameIdx] || '').trim();
        const sheetNick = (row[nickIdx] || '').trim();
        if (sheetName && sheetName !== db.name)
          diff.students.updated.push({ student_id: id, field: 'name', old_value: db.name, new_value: sheetName });
        if (sheetNick !== (db.nickname || ''))
          diff.students.updated.push({ student_id: id, field: 'nickname', old_value: db.nickname || '', new_value: sheetNick });
      }
    }
  }

  // Packages — compare custom_name & custom_class_count
  const pkgSheet = await readTab(sheets, operationalId, 'Packages');
  if (pkgSheet.length > 1) {
    const header  = pkgSheet[0];
    const cpIdx   = header.indexOf('customer_package_id');
    const nameIdx = header.indexOf('package_name');
    const ccIdx   = header.indexOf('class_count');

    const sheetCpIds = pkgSheet.slice(1)
      .map(r => parseInt(r[cpIdx]))
      .filter(id => !isNaN(id));

    if (sheetCpIds.length) {
      const { rows: dbPkgs } = await query(
        `SELECT cp.customer_package_id,
                cp.custom_name, cp.custom_class_count,
                p.name AS base_name, p.class_count AS base_count
         FROM customer_packages cp
         JOIN packages p  ON cp.package_id = p.package_id
         JOIN students s  ON cp.student_id  = s.student_id
         WHERE cp.customer_package_id = ANY($1) AND s.branch_id = $2`,
        [sheetCpIds, branchId]
      );
      const dbMap = Object.fromEntries(dbPkgs.map(p => [p.customer_package_id, p]));

      for (const row of pkgSheet.slice(1)) {
        const id = parseInt(row[cpIdx]);
        if (isNaN(id) || !dbMap[id]) continue;
        const db = dbMap[id];
        const effectiveName  = db.custom_name  ?? db.base_name;
        const effectiveCount = db.custom_class_count ?? db.base_count;
        const sheetName  = (row[nameIdx] || '').trim();
        const sheetCount = parseInt(row[ccIdx]);

        if (sheetName && sheetName !== effectiveName)
          diff.packages.updated.push({ customer_package_id: id, field: 'custom_name', old_value: effectiveName, new_value: sheetName });
        if (!isNaN(sheetCount) && sheetCount !== effectiveCount)
          diff.packages.updated.push({ customer_package_id: id, field: 'custom_class_count', old_value: String(effectiveCount), new_value: String(sheetCount) });
      }
    }
  }

  // Transactions — rows with blank transaction_id = new entries
  if (financeId) {
    const txSheet = await readTab(sheets, financeId, 'Transactions');
    if (txSheet.length > 1) {
      const header   = txSheet[0];
      const txIdIdx  = header.indexOf('transaction_id');
      const dateIdx  = header.indexOf('date');
      const sNameIdx = header.indexOf('student_name');
      const pkgIdx   = header.indexOf('package_name');
      const amtIdx   = header.indexOf('amount');
      const methodIdx = header.indexOf('payment_method');

      for (const row of txSheet.slice(1)) {
        const txId = (row[txIdIdx] || '').trim();
        if (txId) continue; // existing row
        const amount = parseFloat(row[amtIdx]);
        const method = (row[methodIdx] || '').trim();
        if (!row[sNameIdx] || isNaN(amount) || amount <= 0) continue;
        if (!['cash', 'transfer', 'omise'].includes(method)) continue;
        diff.transactions.added.push({
          date: row[dateIdx] || '',
          student_name: row[sNameIdx] || '',
          package_name: row[pkgIdx]   || '',
          amount,
          payment_method: method,
        });
      }
    }
  }

  return diff;
}

// ─── Pull: execute (apply diff to DB) ────────────────────────────────────────

async function executePull(branchId, userId) {
  const diff = await previewPull(branchId);
  const result = { students_updated: 0, packages_updated: 0, transactions_inserted: 0, skipped: [] };

  for (const { student_id, field, new_value } of diff.students.updated) {
    if (!['name', 'nickname'].includes(field)) continue;
    await query(
      `UPDATE students SET ${field} = $1 WHERE student_id = $2 AND branch_id = $3`,
      [new_value || null, student_id, branchId]
    );
    result.students_updated++;
  }

  for (const { customer_package_id, field, new_value } of diff.packages.updated) {
    if (!['custom_name', 'custom_class_count'].includes(field)) continue;
    const val = field === 'custom_class_count' ? parseInt(new_value) : (new_value || null);
    await query(
      `UPDATE customer_packages SET ${field} = $1
       WHERE customer_package_id = $2
         AND student_id IN (SELECT student_id FROM students WHERE branch_id = $3)`,
      [val, customer_package_id, branchId]
    );
    result.packages_updated++;
  }

  for (const tx of diff.transactions.added) {
    try {
      const { rows: [student] } = await query(
        `SELECT student_id FROM students
         WHERE name = $1 AND branch_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [tx.student_name, branchId]
      );
      if (!student) { result.skipped.push(`Student not found: ${tx.student_name}`); continue; }

      const { rows: [cp] } = await query(
        `SELECT cp.customer_package_id FROM customer_packages cp
         JOIN packages p ON cp.package_id = p.package_id
         WHERE cp.student_id = $1
           AND (cp.custom_name = $2 OR p.name = $2) AND cp.is_active = true
         LIMIT 1`,
        [student.student_id, tx.package_name]
      );
      if (!cp) { result.skipped.push(`Package not found for ${tx.student_name}: ${tx.package_name}`); continue; }

      await query(
        `INSERT INTO transactions (branch_id, student_id, customer_package_id, amount, payment_method, status, confirmed_by_user_id, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,'confirmed',$6,now())`,
        [branchId, student.student_id, cp.customer_package_id, tx.amount, tx.payment_method, userId]
      );
      result.transactions_inserted++;
    } catch (err) {
      result.skipped.push(`${tx.student_name}: ${err.message}`);
    }
  }

  return result;
}

// ─── Cron schedules ──────────────────────────────────────────────────────────

// Monthly finance sync — 1st of each month at 6AM
cron.schedule('0 6 1 * *', () => syncSheets().catch(console.error));

// Daily operational sync — every day at 6AM
cron.schedule('0 6 * * *', async () => {
  const { rows: branches } = await query(
    'SELECT branch_id FROM branches WHERE deleted_at IS NULL'
  );
  for (const { branch_id } of branches) {
    await pushOperationalSync(branch_id, 'cron').catch(console.error);
  }
});

// ─── Helpers for registration sheet import ────────────────────────────────────

function parseThaiDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) {
    let year = parseInt(m[3]);
    if (year > 2400) year -= 543;
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function parseThaiAge(str) {
  const m = String(str || '').match(/(\d+)\s*ปี/);
  return m ? parseInt(m[1]) : null;
}

function parseBalance(str) {
  const n = parseInt(String(str || '').replace(/[^0-9]/g, ''));
  return isNaN(n) ? 0 : n;
}

// A row looks like the registration header if it names student/course/nickname.
function looksLikeHeaderRow(r) {
  return Array.isArray(r) && r.some(h => h && (h.includes('ชื่อ - สกุล') || h.includes('คอร์สเรียน') || h.includes('ชื่อเล่น')));
}

// Scan all sheet tabs and return the first one that has a recognisable Thai
// registration header — searching the first few rows, since sheets often put a
// title / column-number row above the real headers.
async function findRegistrationTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = meta.data.sheets.map(s => s.properties.title);
  for (const title of titles) {
    const rows = await readTab(sheets, spreadsheetId, title);
    const headerRow = rows.findIndex((r, i) => i < 8 && looksLikeHeaderRow(r));
    if (headerRow >= 0) return { title, rows, headerRow };
  }
  return null;
}

// ─── Import: registration sheet → DB ─────────────────────────────────────────

async function importStudentsFromSheet(branchId, userId) {
  const sheets = getSheetsClient();
  if (!sheets) throw new Error('Google service account not configured');
  const { operationalId } = await getBranchSheetIds(branchId);
  if (!operationalId) throw new Error('No operational sheet configured for this branch');

  const found = await findRegistrationTab(sheets, operationalId);
  if (!found) throw new Error('Could not find a student registration tab in the configured sheet');

  const { title: tabTitle, rows, headerRow } = found;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const header = (rows[headerRow] || []).map(norm);

  // Build column index map — match by keyword substrings (whitespace-insensitive,
  // so a header like "วัน  เดือน ปี เกิด" with stray double spaces still matches).
  function col(keywords) {
    const nk = keywords.map(norm);
    const idx = header.findIndex(h => h && nk.some(k => h.includes(k)));
    return idx >= 0 ? idx : null;
  }

  const iCode   = col(['รหัสประจำตัว']);
  const iName   = col(['ชื่อ - สกุล (ไทย)', 'ชื่อ - สกุล', 'ชื่อ-สกุล (ไทย)']);
  const iNick   = col(['ชื่อเล่น']);
  const iDob    = col(['วัน เดือน ปี เกิด', 'วันเกิด', 'เกิด']);
  const iAge    = col(['อายุ']);
  const iCourse = col(['คอร์สเรียน', 'คอร์ส']);
  const iBal    = col(['คงเหลือ']);
  const iPhone  = col(['เบอร์มือถือ', 'เบอร์โทร']);
  // Existing parent-code column (e.g. รหัสผู้ปกครอง / RCP), if the sheet already has one
  const iPCode  = (() => {
    const i = header.findIndex(h => h && (h.includes('รหัสผู้ปกครอง') || /\bRCP\b/i.test(h) || (h.includes('รหัส') && h.includes('ผู้ปกครอง'))));
    return i >= 0 ? i : null;
  })();
  // Parent NAME column. 'รหัสผู้ปกครอง' also contains 'ผู้ปกครอง', so exclude the code column.
  let iParent = col(['ชื่อ-สกุล (ผู้ปกครอง)', 'ชื่อ - สกุล (ผู้ปกครอง)', 'ผู้ปกครอง']);
  if (iParent !== null && iParent === iPCode) {
    const i = header.findIndex((h, idx) => idx !== iPCode && h && h.includes('ผู้ปกครอง') && !h.includes('รหัส'));
    iParent = i >= 0 ? i : null;
  }

  if (iName === null) throw new Error('Could not find student name column in sheet');

  // Cache: course name → { course_id, package_id }
  const courseCache = {};
  async function getOrCreateCourse(name) {
    if (!name) return null;
    const key = name.trim();
    if (courseCache[key]) return courseCache[key];
    let { rows: [course] } = await query(
      'SELECT course_id FROM courses WHERE name = $1 AND branch_id = $2 AND deleted_at IS NULL',
      [key, branchId]
    );
    if (!course) {
      const { rows: [c] } = await query(
        'INSERT INTO courses (branch_id, name) VALUES ($1, $2) RETURNING course_id',
        [branchId, key]
      );
      course = c;
    }
    let { rows: [pkg] } = await query(
      'SELECT package_id FROM packages WHERE course_id = $1 AND deleted_at IS NULL LIMIT 1',
      [course.course_id]
    );
    if (!pkg) {
      const { rows: [p] } = await query(
        'INSERT INTO packages (course_id, name, class_count, price) VALUES ($1, $2, 1, 0) RETURNING package_id',
        [course.course_id, 'Imported']
      );
      pkg = p;
    }
    courseCache[key] = { course_id: course.course_id, package_id: pkg.package_id };
    return courseCache[key];
  }

  // Cache of parents seen this run. Siblings are grouped by the sheet's parent
  // code when present, otherwise by full parent name (whitespace-normalised).
  const parentCache = {};
  const createdParents = new Set();
  const normParent = (s) => String(s || '').trim().replace(/\s+/g, ' ');

  async function nextParentCode() {
    const { rows: [{ next_num }] } = await query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(user_code FROM 5) AS INT)), 0) + 1 AS next_num
       FROM users WHERE user_code LIKE 'RCP-%'`
    );
    return `RCP-${String(next_num).padStart(4, '0')}`;
  }

  async function getOrCreateParent(rawName, phone, rawCode) {
    const code     = normParent(rawCode);   // e.g. an RCP-0007 already filled in the sheet
    const nameKey  = normParent(rawName);
    const cacheKey = code || nameKey;        // group siblings by code when present, else by name
    if (!cacheKey) return null;
    if (parentCache[cacheKey]) return parentCache[cacheKey];

    let parent = null;
    if (code) {
      ({ rows: [parent] } = await query(
        `SELECT user_id, user_code FROM users
         WHERE role='parent' AND branch_id=$1 AND user_code=$2 AND deleted_at IS NULL LIMIT 1`,
        [branchId, code]
      ));
    }
    if (!parent && nameKey) {
      ({ rows: [parent] } = await query(
        `SELECT user_id, user_code FROM users
         WHERE role='parent' AND branch_id=$1 AND name=$2 AND deleted_at IS NULL LIMIT 1`,
        [branchId, nameKey]
      ));
    }

    if (!parent) {
      const finalCode = code || await nextParentCode();
      ({ rows: [parent] } = await query(
        `INSERT INTO users (branch_id, role, name, phone, user_code)
         VALUES ($1, 'parent', $2, $3, $4) RETURNING user_id, user_code`,
        [branchId, nameKey || code, phone || null, finalCode]
      ));
      createdParents.add(parent.user_id);
    } else if (!parent.user_code) {
      const finalCode = code || await nextParentCode();
      await query('UPDATE users SET user_code=$1 WHERE user_id=$2', [finalCode, parent.user_id]);
      parent.user_code = finalCode;
    }

    parentCache[cacheKey] = parent;
    return parent;
  }

  const result = { imported: 0, skipped: 0, parents: 0, errors: [] };

  // Column written back to the sheet, aligned to absolute sheet rows: the header
  // text sits on the detected header row, then one RCP per data row below it.
  const PARENT_CODE_HEADER = 'รหัสผู้ปกครอง';
  const parentCodeColumn = new Array(rows.length).fill('');
  parentCodeColumn[headerRow] = PARENT_CODE_HEADER;

  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const name = (row[iName] || '').trim();
    if (!name) { result.skipped++; continue; }

    try {
      // Skip duplicates
      const { rows: [existing] } = await query(
        'SELECT student_id FROM students WHERE name = $1 AND branch_id = $2 AND deleted_at IS NULL',
        [name, branchId]
      );
      if (existing) { result.skipped++; continue; }

      const nickname    = iNick !== null ? (row[iNick] || '').trim() || null : null;
      const dob         = iDob  !== null ? parseThaiDate(row[iDob]) : null;
      const age         = iAge  !== null ? parseThaiAge(row[iAge])  : null;
      const sheetCode   = iCode !== null ? (row[iCode] || '').trim() || null : null;

      // Use sheet code if present, otherwise auto-generate next RCC-XXXX
      let student_code = sheetCode;
      if (!student_code) {
        const { rows: [{ next_num }] } = await query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(student_code FROM 5) AS INT)), 0) + 1 AS next_num
           FROM students WHERE student_code LIKE 'RCC-%'`
        );
        student_code = `RCC-${String(next_num).padStart(4, '0')}`;
      }

      // Find-or-create the parent account before the student, so we can link them.
      // Honour a parent code already present in the sheet; otherwise generate one.
      const parentName  = iParent !== null ? (row[iParent] || '').trim() : null;
      const parentPhone = iPhone  !== null ? (row[iPhone]  || '').trim() : null;
      const parentCode  = iPCode  !== null ? (row[iPCode]  || '').trim() : null;
      const parent      = await getOrCreateParent(parentName, parentPhone, parentCode);
      if (parent) parentCodeColumn[ri] = parent.user_code;

      const { rows: [student] } = await query(
        `INSERT INTO students (branch_id, parent_user_id, name, nickname, date_of_birth, age, approval_status, student_code)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7) RETURNING student_id`,
        [branchId, parent ? parent.user_id : null, name, nickname, dob, age, student_code]
      );

      // Package / class balance
      const courseName = iCourse !== null ? (row[iCourse] || '').trim() : null;
      const balance    = iBal    !== null ? parseBalance(row[iBal]) : 0;
      if (courseName && balance > 0) {
        const course = await getOrCreateCourse(courseName);
        if (course) {
          await query(
            `INSERT INTO customer_packages (student_id, package_id, is_active, custom_class_count)
             VALUES ($1, $2, true, $3)`,
            [student.student_id, course.package_id, balance]
          );
        }
      }

      // Keep phone-only info (no parent name to key on) as a fallback note
      if (!parentName && parentPhone) {
        await query(
          'INSERT INTO student_notes (student_id, author_id, body) VALUES ($1, $2, $3)',
          [student.student_id, userId, `Parent phone: ${parentPhone}`]
        );
      }

      result.imported++;
    } catch (err) {
      result.errors.push(`${name}: ${err.message}`);
    }
  }

  result.parents = createdParents.size;

  // Write the RCP codes back to the sheet (reuses the existing column, or appends one)
  try {
    const toColLetter = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const pcIdx = iPCode !== null ? iPCode : header.length; // reuse detected column, else append
    const col = toColLetter(pcIdx);
    await sheets.spreadsheets.values.update({
      spreadsheetId: operationalId,
      range: `${tabTitle}!${col}1`,
      valueInputOption: 'RAW',
      requestBody: { values: parentCodeColumn.map(v => [v]) },
    });
    result.sheetUpdated = true;
  } catch (err) {
    result.sheetUpdated = false;
    result.errors.push(`Sheet write-back failed (is the service account an Editor on the sheet?): ${err.message}`);
  }

  return result;
}

// ─── Full data reset for a branch ────────────────────────────────────────────

async function resetBranchData(branchId) {
  // Delete a table's branch-scoped rows, but tolerate schema drift:
  // skip a table/column that doesn't exist (42P01 / 42703) instead of
  // aborting the whole reset. Any other error still propagates.
  const del = async (sql) => {
    try {
      await query(sql, [branchId]);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        console.warn(`[reset] skipping (${err.code}): ${err.message}`);
        return;
      }
      throw err;
    }
  };

  const studentIds  = `(SELECT student_id FROM students WHERE branch_id = $1)`;
  const scheduleIds = `(SELECT schedule_id FROM schedules WHERE branch_id = $1)`;
  const courseIds   = `(SELECT course_id FROM courses WHERE branch_id = $1)`;
  const contractIds = `(SELECT contract_school_id FROM contract_schools WHERE branch_id = $1)`;
  const cpIds       = `(SELECT cp.customer_package_id FROM customer_packages cp
                        JOIN students s ON cp.student_id = s.student_id WHERE s.branch_id = $1)`;
  const nonOwnerIds = `(SELECT user_id FROM users WHERE branch_id = $1 AND role != 'owner')`;

  // Strict FK-topological order: every table is deleted before the tables it
  // references. Derived from the full public-schema foreign-key graph.
  await del(`DELETE FROM reinstatement_requests WHERE student_id IN ${studentIds}`);        // -> attendance, customer_packages, students
  await del(`DELETE FROM package_redemptions    WHERE customer_package_id IN ${cpIds}`);     // -> enrollments, customer_packages
  await del(`DELETE FROM attendance             WHERE student_id IN ${studentIds}`);        // -> enrollments, schedules, students
  await del(`DELETE FROM transactions           WHERE branch_id = $1`);                      // -> customer_packages, promotions, students
  await del(`DELETE FROM enrollments            WHERE student_id IN ${studentIds}`);        // -> customer_packages, schedules, students
  await del(`DELETE FROM schedule_reservations  WHERE student_id IN ${studentIds}`);        // -> schedules, students
  await del(`DELETE FROM contract_sessions      WHERE schedule_id IN ${scheduleIds}`);       // -> contracts, schedules
  await del(`DELETE FROM messages               WHERE sender_id IN ${nonOwnerIds} OR parent_id IN ${nonOwnerIds}`); // -> requests, users
  await del(`DELETE FROM requests               WHERE parent_id IN ${nonOwnerIds}`);         // -> users
  await del(`DELETE FROM complaints             WHERE student_id IN ${studentIds} OR parent_id IN ${nonOwnerIds}`); // -> students, users
  await del(`DELETE FROM student_notes          WHERE student_id IN ${studentIds}`);        // -> students, users
  await del(`DELETE FROM customer_warnings      WHERE branch_id = $1`);                      // -> students
  await del(`DELETE FROM contracts              WHERE branch_id = $1`);                      // -> packages, students, users
  await del(`DELETE FROM promotions             WHERE branch_id = $1`);                      // -> packages, users
  await del(`DELETE FROM customer_packages      WHERE student_id IN ${studentIds}`);        // -> packages, students
  await del(`DELETE FROM schedules              WHERE branch_id = $1`);                      // -> contract_school_slots, contract_schools, courses, users
  await del(`DELETE FROM contract_school_payments WHERE contract_school_id IN ${contractIds}`); // -> contract_schools, users
  await del(`DELETE FROM contract_school_slots  WHERE contract_school_id IN ${contractIds}`);   // -> contract_schools, users
  await del(`DELETE FROM contract_schools       WHERE branch_id = $1`);
  await del(`DELETE FROM packages               WHERE course_id IN ${courseIds}`);          // -> courses
  await del(`DELETE FROM courses                WHERE branch_id = $1`);                      // -> course_levels, robot_types
  await del(`DELETE FROM course_levels          WHERE branch_id = $1`);
  await del(`DELETE FROM robot_types            WHERE branch_id = $1`);
  await del(`DELETE FROM expenses               WHERE branch_id = $1`);
  await del(`DELETE FROM holidays               WHERE branch_id = $1`);
  await del(`DELETE FROM sheets_sync_log        WHERE branch_id = $1`);
  await del(`DELETE FROM device_tokens          WHERE user_id IN ${nonOwnerIds}`);
  await del(`DELETE FROM refresh_tokens         WHERE user_id IN ${nonOwnerIds}`);
  await del(`DELETE FROM notification_views     WHERE user_id IN ${nonOwnerIds}`);
  await del(`DELETE FROM students               WHERE branch_id = $1`);
  await del(`DELETE FROM users                  WHERE branch_id = $1 AND role != 'owner'`); // non-owner: staff + parent
}

module.exports = { syncSheets, pushOperationalSync, previewPull, executePull, importStudentsFromSheet, resetBranchData };
