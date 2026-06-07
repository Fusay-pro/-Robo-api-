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

function rangeClause(range) {
  switch (range) {
    case 'today': return `>= CURRENT_DATE AND < CURRENT_DATE + interval '1 day'`;
    case 'week':  return `>= date_trunc('week', CURRENT_DATE) AND < date_trunc('week', CURRENT_DATE) + interval '7 days'`;
    case 'year':  return `>= date_trunc('year', CURRENT_DATE) AND < date_trunc('year', CURRENT_DATE) + interval '1 year'`;
    case 'all':   return `IS NOT NULL`;
    default:      return `>= date_trunc('month', CURRENT_DATE) AND < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
  }
}

router.get('/profit', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const range = req.query.range || 'month';
  const clause = rangeClause(range);

  const { rows: [data] } = await query(
    `SELECT
       COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'confirmed'), 0) AS branch_revenue,
       COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)  AS total_expenses
     FROM branches b
     LEFT JOIN transactions t ON t.branch_id = b.branch_id AND t.created_at ${clause}
     LEFT JOIN expenses e     ON e.branch_id = b.branch_id AND e.submitted_at ${clause}
     WHERE b.branch_id = $1`,
    [req.user.branch_id]
  );

  const { rows: [cspData] } = await query(
    `SELECT COALESCE(SUM(csp.amount), 0) AS contract_revenue
     FROM contract_school_payments csp
     JOIN contract_schools cs ON csp.contract_school_id = cs.contract_school_id
     WHERE cs.branch_id = $1 AND csp.created_at ${clause}`,
    [req.user.branch_id]
  );

  const { rows: txRows } = await query(
    `SELECT t.transaction_id, t.amount, t.payment_method, t.created_at, s.name AS student_name
     FROM transactions t
     JOIN students s ON t.student_id = s.student_id
     WHERE t.branch_id = $1 AND t.created_at ${clause}
     ORDER BY t.created_at DESC LIMIT 50`,
    [req.user.branch_id]
  );

  const { rows: expRows } = await query(
    `SELECT e.expense_id, e.amount, e.category, e.description, e.submitted_at, u.name AS submitted_by_name
     FROM expenses e JOIN users u ON e.submitted_by_user_id = u.user_id
     WHERE e.branch_id = $1 AND e.submitted_at ${clause}
     ORDER BY e.submitted_at DESC LIMIT 50`,
    [req.user.branch_id]
  );

  const revenue  = Number(data.branch_revenue) + Number(cspData.contract_revenue);
  const expenses = Number(data.total_expenses);

  res.json({
    range,
    branch_revenue:   Number(data.branch_revenue),
    contract_revenue: Number(cspData.contract_revenue),
    total_revenue:    revenue,
    other_expenses:   expenses,
    net_profit:       revenue - expenses,
    transactions:     txRows,
    expenses:         expRows,
  });
});

// GET /owner/stats — quick summary cards on the dashboard
router.get('/stats', roleGuard(['owner', 'super_owner']), async (req, res) => {
  const { rows: [students] } = await query(
    `SELECT COUNT(*)::int AS total_students
     FROM students WHERE branch_id = $1 AND deleted_at IS NULL`,
    [req.user.branch_id]
  );
  const { rows: [revenue] } = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'), 0) AS revenue_this_month
     FROM transactions
     WHERE branch_id = $1
       AND created_at >= date_trunc('month', CURRENT_DATE)
       AND created_at <  date_trunc('month', CURRENT_DATE) + interval '1 month'`,
    [req.user.branch_id]
  );
  res.json({
    total_students:    students.total_students,
    revenue_this_month: Number(revenue.revenue_this_month),
  });
});

module.exports = router;
