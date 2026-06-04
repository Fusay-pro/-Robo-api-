const router = require('express').Router();
const { query } = require('../config/db');

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT cw.*, s.name AS student_name, s.parent_user_id
     FROM customer_warnings cw
     JOIN students s ON cw.student_id = s.student_id
     WHERE cw.branch_id = $1 AND cw.generated_date = CURRENT_DATE
     ORDER BY cw.classes_remaining`,
    [req.user.branch_id]
  );
  res.json(rows);
});

module.exports = router;
