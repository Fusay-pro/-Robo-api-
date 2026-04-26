const router = require('express').Router();
const { query } = require('../config/db');
const { roleGuard } = require('../middleware/roleGuard');

router.get('/capacity', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const { rows } = await query(
    `SELECT s.schedule_id, s.starts_at, s.max_capacity,
       COUNT(e.enrollment_id)::int AS booked,
       (s.max_capacity - COUNT(e.enrollment_id)::int) AS spots_left,
       c.name AS course_name
     FROM schedules s
     LEFT JOIN enrollments e ON s.schedule_id = e.schedule_id AND e.status = 'confirmed'
     LEFT JOIN courses c ON s.course_id = c.course_id
     WHERE s.branch_id = $1 AND s.deleted_at IS NULL AND s.starts_at > NOW()
     GROUP BY s.schedule_id, c.name ORDER BY s.starts_at`,
    [req.user.branch_id]
  );
  res.json(rows);
});

router.get('/profit', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;

  const { rows: [data] } = await query(
    `SELECT
       COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'confirmed'), 0)       AS branch_revenue,
       COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)         AS total_expenses
     FROM branches b
     LEFT JOIN transactions t ON t.branch_id = b.branch_id AND to_char(t.created_at, 'YYYY-MM') = $1
     LEFT JOIN expenses e     ON e.branch_id = b.branch_id AND to_char(e.submitted_at, 'YYYY-MM') = $1
     WHERE b.branch_id = $2`,
    [month, req.user.branch_id]
  );

  const { rows: [cspData] } = await query(
    `SELECT COALESCE(SUM(csp.amount), 0) AS contract_revenue
     FROM contract_school_payments csp
     JOIN contract_schools cs ON csp.contract_school_id = cs.contract_school_id
     WHERE cs.branch_id = $1 AND to_char(csp.created_at, 'YYYY-MM') = $2`,
    [req.user.branch_id, month]
  );

  const { rows: [salaryData] } = await query(
    `SELECT COALESCE(SUM(
       monthly_salary *
       (LEAST(COALESCE(active_until, CURRENT_DATE),
              (date_trunc('month', $2::date) + interval '1 month - 1 day')::date)
        - GREATEST(active_from, date_trunc('month', $2::date)::date) + 1)::numeric
       / EXTRACT(DAY FROM date_trunc('month', $2::date) + interval '1 month - 1 day')
     ), 0) AS salary_cost
     FROM users
     WHERE branch_id = $1 AND role = 'staff' AND monthly_salary IS NOT NULL
       AND active_from IS NOT NULL AND deleted_at IS NULL`,
    [req.user.branch_id, monthStart]
  );

  const revenue = Number(data.branch_revenue) + Number(cspData.contract_revenue);
  const salary  = Number(salaryData.salary_cost);
  const expenses = Number(data.total_expenses);

  res.json({
    month,
    branch_revenue:   Number(data.branch_revenue),
    contract_revenue: Number(cspData.contract_revenue),
    total_revenue:    revenue,
    salary_cost:      salary,
    other_expenses:   expenses,
    net_profit:       revenue - salary - expenses,
  });
});

module.exports = router;
