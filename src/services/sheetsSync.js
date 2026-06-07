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

module.exports = { syncSheets, pushOperationalSync, previewPull, executePull };
