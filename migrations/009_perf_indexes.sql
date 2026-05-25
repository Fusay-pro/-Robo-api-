-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_students_branch        ON students(branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_parent        ON students(parent_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_name          ON students(branch_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_packages_student ON customer_packages(student_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_package_redemptions_pkg   ON package_redemptions(customer_package_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student    ON enrollments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_branch_date  ON schedules(branch_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_notes_student  ON student_notes(student_id, created_at DESC);
