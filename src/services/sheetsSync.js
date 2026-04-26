const cron = require('node-cron');
const { google } = require('googleapis');
const { query } = require('../config/db');

async function syncSheets(month) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const monthStart  = `${targetMonth}-01`;

  const { rows: branches } = await query('SELECT * FROM branches WHERE deleted_at IS NULL');
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  if (!key.type) { console.log('Sheets sync: no service account key configured'); return; }

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  for (const branch of branches) {
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
      const revenue = Number(rev.branch_revenue) + Number(csr.contract_revenue);
      const salary  = Number(sal.salary);
      const expenses = Number(rev.expenses);
      const profit   = revenue - salary - expenses;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A:F',
        valueInputOption: 'RAW',
        requestBody: { values: [[targetMonth, branch.name, revenue, salary, expenses, profit]] },
      });
      await query(
        "INSERT INTO sheets_sync_log (branch_id, sync_month, status) VALUES ($1,$2,'success')",
        [branch.branch_id, monthStart]
      );
    } catch (err) {
      await query(
        "INSERT INTO sheets_sync_log (branch_id, sync_month, status, error_message) VALUES ($1,$2,'failed',$3)",
        [branch.branch_id, monthStart, err.message]
      );
    }
  }
}

// 1st of each month at 6AM
cron.schedule('0 6 1 * *', () => syncSheets().catch(console.error));

module.exports = { syncSheets };
