-- ============================================================
-- Robotics School — Combined schema + migrations for Supabase
-- Generated 2026-05-26
-- Paste this entire file into Supabase SQL editor and run once.
-- ============================================================

-- === schema.sql (base) ===
-- ============================================================
-- Robotics School Database Schema
-- PostgreSQL
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- BRANCHES
-- ============================================================
CREATE TABLE branches (
  branch_id          serial PRIMARY KEY,
  name               text NOT NULL,
  address            text,
  phone              text,
  capacity_per_teacher int NOT NULL DEFAULT 10,
  deleted_at         timestamptz
);

-- ============================================================
-- USERS  (staff, owner, super_owner, parent)
-- ============================================================
CREATE TABLE users (
  user_id            serial PRIMARY KEY,
  branch_id          int REFERENCES branches(branch_id),
  role               text NOT NULL CHECK (role IN ('super_owner','owner','staff','parent')),
  name               text NOT NULL,
  email              text UNIQUE,
  phone              text,
  password_hash      text,                    -- null for LINE-only parents
  line_user_id       text UNIQUE,             -- set for parents via LINE OAuth
  monthly_salary     numeric(12,2),           -- staff/owner only
  active_from        date,                    -- for pro-rated salary calc
  active_until       date,                    -- null = currently active
  consent_given_at   timestamptz,             -- PDPA consent timestamp (parents)
  created_at         timestamptz DEFAULT NOW(),
  deleted_at         timestamptz
);

-- ============================================================
-- AUTH
-- ============================================================
CREATE TABLE refresh_tokens (
  token_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            int NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash         text NOT NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz DEFAULT NOW()
);

CREATE TABLE device_tokens (
  token_id           serial PRIMARY KEY,
  user_id            int NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  fcm_token          text NOT NULL,
  platform           text NOT NULL CHECK (platform IN ('ios','android')),
  created_at         timestamptz DEFAULT NOW(),
  UNIQUE (user_id, fcm_token)
);

-- ============================================================
-- COURSE CATALOGUE
-- ============================================================
CREATE TABLE course_levels (
  level_id           serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  name               text NOT NULL,           -- beginner, intermediate, advanced …
  deleted_at         timestamptz
);

CREATE TABLE robot_types (
  robot_type_id      serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  name               text NOT NULL,           -- Robot A, Robot B …
  deleted_at         timestamptz
);

CREATE TABLE courses (
  course_id          serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  level_id           int REFERENCES course_levels(level_id),
  robot_type_id      int REFERENCES robot_types(robot_type_id),
  name               text NOT NULL,
  description        text,
  deleted_at         timestamptz
);

CREATE TABLE packages (
  package_id         serial PRIMARY KEY,
  course_id          int NOT NULL REFERENCES courses(course_id),
  name               text NOT NULL,
  class_count        int NOT NULL,
  price              numeric(10,2) NOT NULL,
  deleted_at         timestamptz
);

CREATE TABLE promotions (
  promo_id           serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  package_id         int NOT NULL REFERENCES packages(package_id),
  discount_percent   int NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  valid_from         timestamptz NOT NULL,
  valid_until        timestamptz NOT NULL,
  max_uses           int,                     -- null = unlimited
  uses_count         int NOT NULL DEFAULT 0,
  created_by_user_id int REFERENCES users(user_id),
  deleted_at         timestamptz
);

-- ============================================================
-- CONTRACT SCHOOLS  (B2B)
-- ============================================================
CREATE TABLE contract_schools (
  contract_school_id serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  name               text NOT NULL,
  address            text,
  contact_name       text,
  contact_phone      text,
  deleted_at         timestamptz
);

CREATE TABLE contract_school_payments (
  payment_id         serial PRIMARY KEY,
  contract_school_id int NOT NULL REFERENCES contract_schools(contract_school_id),
  amount             numeric(12,2) NOT NULL,
  paid_at            timestamptz NOT NULL,
  notes              text,
  recorded_by_user_id int NOT NULL REFERENCES users(user_id),
  created_at         timestamptz DEFAULT NOW()
);

-- ============================================================
-- SCHEDULES
-- schedule_type 'branch'          → normal class at branch
-- schedule_type 'contract_school' → teacher visits a B2B school
-- ============================================================
CREATE TABLE schedules (
  schedule_id        serial PRIMARY KEY,
  branch_id          int NOT NULL REFERENCES branches(branch_id),
  course_id          int REFERENCES courses(course_id),
  teacher_user_id    int REFERENCES users(user_id),
  schedule_type      text NOT NULL DEFAULT 'branch'
                       CHECK (schedule_type IN ('branch','contract_school')),
  contract_school_id int REFERENCES contract_schools(contract_school_id),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  max_capacity       int NOT NULL DEFAULT 10,
  deleted_at         timestamptz,
  CHECK (
    (schedule_type = 'branch' AND contract_school_id IS NULL)
    OR
    (schedule_type = 'contract_school' AND contract_school_id IS NOT NULL)
  )
);

-- ============================================================
-- STUDENTS  (children — parents manage these accounts)
-- ============================================================
CREATE TABLE students (
  student_id              serial PRIMARY KEY,
  parent_user_id          int NOT NULL REFERENCES users(user_id),
  branch_id               int NOT NULL REFERENCES branches(branch_id),
  name                    text NOT NULL,
  nickname                text,
  age                     int,
  pre_existing_conditions text,               -- medical/physical info for staff
  approval_status         text NOT NULL DEFAULT 'pending'
                            CHECK (approval_status IN ('pending','approved','rejected')),
  confirmed_by_user_id    int REFERENCES users(user_id),
  confirmed_at            timestamptz,
  created_at              timestamptz DEFAULT NOW(),
  deleted_at              timestamptz
);

-- ============================================================
-- PACKAGES OWNED BY STUDENTS
-- ============================================================
CREATE TABLE customer_packages (
  customer_package_id  serial PRIMARY KEY,
  student_id           int NOT NULL REFERENCES students(student_id),
  package_id           int NOT NULL REFERENCES packages(package_id),
  purchased_at         timestamptz DEFAULT NOW(),
  is_active            boolean NOT NULL DEFAULT true
);

-- Each confirmed enrollment redeems one class from a package
CREATE TABLE package_redemptions (
  redemption_id        serial PRIMARY KEY,
  customer_package_id  int NOT NULL REFERENCES customer_packages(customer_package_id),
  enrollment_id        int,                   -- FK added after enrollments table
  created_at           timestamptz DEFAULT NOW()
);

-- ============================================================
-- ENROLLMENTS
-- ============================================================
CREATE TABLE enrollments (
  enrollment_id        serial PRIMARY KEY,
  student_id           int NOT NULL REFERENCES students(student_id),
  schedule_id          int NOT NULL REFERENCES schedules(schedule_id),
  customer_package_id  int REFERENCES customer_packages(customer_package_id),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','cancelled')),
  low_class_warning    boolean NOT NULL DEFAULT false,
  created_at           timestamptz DEFAULT NOW(),
  deleted_at           timestamptz
);

-- Add FK from package_redemptions back to enrollments
ALTER TABLE package_redemptions
  ADD CONSTRAINT package_redemptions_enrollment_id_fkey
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(enrollment_id);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE attendance (
  attendance_id        serial PRIMARY KEY,
  enrollment_id        int NOT NULL REFERENCES enrollments(enrollment_id),
  schedule_id          int NOT NULL REFERENCES schedules(schedule_id),
  student_id           int NOT NULL REFERENCES students(student_id),
  status               text NOT NULL CHECK (status IN ('present','absent','excused')),
  marked_by_user_id    int REFERENCES users(user_id),
  marked_at            timestamptz DEFAULT NOW()
);

-- ============================================================
-- SCHEDULE RESERVATIONS  (weekly recurring soft-hold)
-- ============================================================
CREATE TABLE schedule_reservations (
  reservation_id       serial PRIMARY KEY,
  student_id           int NOT NULL REFERENCES students(student_id),
  schedule_id          int NOT NULL REFERENCES schedules(schedule_id),
  day_of_week          int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  recurrence_active    boolean NOT NULL DEFAULT true,
  confirm_deadline     timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'pending_confirmation'
                         CHECK (status IN ('pending_confirmation','confirmed','released')),
  created_at           timestamptz DEFAULT NOW()
);

-- ============================================================
-- REINSTATEMENT REQUESTS
-- Parent can only submit after attendance is marked 'absent'.
-- Max 2 approved reinstatements per customer_package.
-- Only owner can approve/reject.
-- All rows are permanent — never soft-deleted.
-- ============================================================
CREATE TABLE reinstatement_requests (
  request_id           serial PRIMARY KEY,
  attendance_id        int NOT NULL REFERENCES attendance(attendance_id),
  student_id           int NOT NULL REFERENCES students(student_id),
  customer_package_id  int NOT NULL REFERENCES customer_packages(customer_package_id),
  reason_category      text NOT NULL
                         CHECK (reason_category IN ('medical','bereavement','accident')),
  reason_detail        text NOT NULL
                         CHECK (char_length(reason_detail) >= 50),
  evidence_url         text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
  reviewed_by_user_id  int REFERENCES users(user_id),
  reviewer_note        text,
  created_at           timestamptz DEFAULT NOW(),
  reviewed_at          timestamptz
);

-- ============================================================
-- TRANSACTIONS  (payments from parents)
-- ============================================================
CREATE TABLE transactions (
  transaction_id       serial PRIMARY KEY,
  branch_id            int NOT NULL REFERENCES branches(branch_id),
  student_id           int NOT NULL REFERENCES students(student_id),
  customer_package_id  int NOT NULL REFERENCES customer_packages(customer_package_id),
  amount               numeric(12,2) NOT NULL,
  promo_id             int REFERENCES promotions(promo_id),
  payment_method       text NOT NULL CHECK (payment_method IN ('omise','cash','transfer')),
  omise_charge_id      text UNIQUE,           -- for webhook matching
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','refunded')),
  confirmed_by_user_id int REFERENCES users(user_id),
  created_at           timestamptz DEFAULT NOW(),
  confirmed_at         timestamptz
);

-- ============================================================
-- EXPENSES  (staff reimbursements — travel, supplies, etc.)
-- submitted_by != approved_by enforced at API layer AND here
-- ============================================================
CREATE TABLE expenses (
  expense_id           serial PRIMARY KEY,
  branch_id            int NOT NULL REFERENCES branches(branch_id),
  submitted_by_user_id int NOT NULL REFERENCES users(user_id),
  approved_by_user_id  int REFERENCES users(user_id),
  amount               numeric(12,2) NOT NULL,
  category             text NOT NULL CHECK (category IN ('travel','supplies','other')),
  description          text NOT NULL,
  receipt_url          text,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
  submitted_at         timestamptz DEFAULT NOW(),
  approved_at          timestamptz,
  deleted_at           timestamptz,
  CHECK (submitted_by_user_id != approved_by_user_id OR approved_by_user_id IS NULL)
);

-- ============================================================
-- STUDENT CONTRACTS  (rolling monthly agreements)
-- contractGenerator.js creates 4 weeks of sessions ahead
-- ============================================================
CREATE TABLE contracts (
  contract_id          serial PRIMARY KEY,
  student_id           int NOT NULL REFERENCES students(student_id),
  package_id           int NOT NULL REFERENCES packages(package_id),
  branch_id            int NOT NULL REFERENCES branches(branch_id),
  start_date           date NOT NULL,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','cancelled')),
  created_by_user_id   int REFERENCES users(user_id),
  created_at           timestamptz DEFAULT NOW(),
  deleted_at           timestamptz
);

CREATE TABLE contract_sessions (
  session_id           serial PRIMARY KEY,
  contract_id          int NOT NULL REFERENCES contracts(contract_id),
  schedule_id          int NOT NULL REFERENCES schedules(schedule_id),
  scheduled_date       date NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','completed','skipped')),
  created_at           timestamptz DEFAULT NOW()
);

-- ============================================================
-- WARNINGS  (populated daily by warningCron at 8AM)
-- ============================================================
CREATE TABLE customer_warnings (
  warning_id           serial PRIMARY KEY,
  student_id           int NOT NULL REFERENCES students(student_id),
  branch_id            int NOT NULL REFERENCES branches(branch_id),
  classes_remaining    int NOT NULL,
  generated_date       date NOT NULL DEFAULT CURRENT_DATE
);

-- ============================================================
-- SHEETS SYNC LOG
-- ============================================================
CREATE TABLE sheets_sync_log (
  log_id               serial PRIMARY KEY,
  branch_id            int NOT NULL REFERENCES branches(branch_id),
  sync_month           date NOT NULL,         -- always first of month, e.g. 2026-04-01
  status               text NOT NULL CHECK (status IN ('success','failed')),
  error_message        text,
  synced_at            timestamptz DEFAULT NOW()
);

-- ============================================================
-- INDEXES  (performance for common query patterns)
-- ============================================================
CREATE INDEX idx_users_branch          ON users(branch_id);
CREATE INDEX idx_users_line_user_id    ON users(line_user_id);
CREATE INDEX idx_students_parent       ON students(parent_user_id);
CREATE INDEX idx_students_branch       ON students(branch_id);
CREATE INDEX idx_students_approval     ON students(approval_status);
CREATE INDEX idx_schedules_branch      ON schedules(branch_id);
CREATE INDEX idx_schedules_teacher     ON schedules(teacher_user_id);
CREATE INDEX idx_schedules_starts_at   ON schedules(starts_at);
CREATE INDEX idx_enrollments_student   ON enrollments(student_id);
CREATE INDEX idx_enrollments_schedule  ON enrollments(schedule_id);
CREATE INDEX idx_attendance_schedule   ON attendance(schedule_id);
CREATE INDEX idx_attendance_student    ON attendance(student_id);
CREATE INDEX idx_reservations_student  ON schedule_reservations(student_id);
CREATE INDEX idx_reservations_deadline ON schedule_reservations(confirm_deadline)
                                        WHERE status = 'pending_confirmation';
CREATE INDEX idx_transactions_branch   ON transactions(branch_id);
CREATE INDEX idx_transactions_omise    ON transactions(omise_charge_id);
CREATE INDEX idx_expenses_branch       ON expenses(branch_id);
CREATE INDEX idx_warnings_date         ON customer_warnings(generated_date);
CREATE INDEX idx_reinstatements_pkg    ON reinstatement_requests(customer_package_id);
CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens(user_id);

-- ============================================================
-- ROW LEVEL SECURITY SETUP
-- App sets: app.role, app.branch_id, app.user_id per request
-- ============================================================
ALTER TABLE branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_packages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_warnings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_schools      ENABLE ROW LEVEL SECURITY;

-- super_owner bypasses all RLS
CREATE POLICY super_owner_all ON branches
  USING (current_setting('app.role', true) = 'super_owner');

-- Branch isolation: owner and staff see only their branch
CREATE POLICY branch_isolation ON branches
  USING (
    current_setting('app.role', true) IN ('owner','staff')
    AND branch_id = current_setting('app.branch_id', true)::int
  );

-- Parents see only their own children's data
CREATE POLICY parent_own_students ON students
  USING (
    current_setting('app.role', true) = 'parent'
    AND parent_user_id = current_setting('app.user_id', true)::int
  );

-- Staff and owner see students in their branch
CREATE POLICY staff_branch_students ON students
  USING (
    current_setting('app.role', true) IN ('owner','staff')
    AND branch_id = current_setting('app.branch_id', true)::int
  );

-- ============================================================
-- ADDITIONAL CONSTRAINTS (added post-scaffold)
-- ============================================================

-- Attendance: one record per enrollment
ALTER TABLE attendance ADD CONSTRAINT attendance_enrollment_unique UNIQUE (enrollment_id);

-- Contract sessions: no duplicate date per contract+schedule
ALTER TABLE contract_sessions ADD CONSTRAINT contract_sessions_unique UNIQUE (contract_id, schedule_id, scheduled_date);


-- === migrations/002_robot_quantity.sql ===
-- Add quantity (number of physical robots available) to robot_types.
-- This becomes the default max_capacity for any session using a course
-- whose robot_type matches.

ALTER TABLE robot_types ADD COLUMN IF NOT EXISTS quantity int NOT NULL DEFAULT 8;

-- === migrations/003_contract_school_period.sql ===
-- Contract teaching periods + recurring schedule for B2B school engagements.
-- Owner sets start/end dates so we know how long we're committed to teach.

ALTER TABLE contract_schools
  ADD COLUMN IF NOT EXISTS contract_start_date      date,
  ADD COLUMN IF NOT EXISTS contract_end_date        date,
  ADD COLUMN IF NOT EXISTS sessions_per_week        int,
  ADD COLUMN IF NOT EXISTS session_duration_minutes int,
  ADD COLUMN IF NOT EXISTS notes                    text;

-- === migrations/004_contract_school_slots.sql ===
-- Recurring weekly teaching slots per contract school
CREATE TABLE IF NOT EXISTS contract_school_slots (
  slot_id              serial PRIMARY KEY,
  contract_school_id   int NOT NULL REFERENCES contract_schools(contract_school_id),
  day_of_week          int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, matches EXTRACT(DOW)
  start_time           time NOT NULL,
  duration_minutes     int NOT NULL,
  teacher_user_id      int REFERENCES users(user_id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_contract_school_slots_contract
  ON contract_school_slots(contract_school_id)
  WHERE deleted_at IS NULL;

-- Link auto-generated schedule rows back to their source slot
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS source_slot_id int REFERENCES contract_school_slots(slot_id);

CREATE INDEX IF NOT EXISTS idx_schedules_source_slot
  ON schedules(source_slot_id)
  WHERE source_slot_id IS NOT NULL;

-- === migrations/005_otp_verifications.sql ===
CREATE TABLE IF NOT EXISTS otp_verifications (
  otp_id     serial PRIMARY KEY,
  email      text NOT NULL,
  code       text NOT NULL,
  expires_at timestamptz NOT NULL,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email) WHERE used = false;

-- === migrations/006_requests.sql ===
-- Structured request cards sent by parents via quick-reply buttons
CREATE TABLE IF NOT EXISTS requests (
  request_id  SERIAL PRIMARY KEY,
  parent_id   INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type        VARCHAR(30)  NOT NULL CHECK (type IN ('refund', 'absence', 'reinstatement')),
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  details     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_parent_id ON requests(parent_id);
CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests(status);

-- === migrations/007_messages.sql ===
-- Chat messages between parent and staff
CREATE TABLE IF NOT EXISTS messages (
  message_id  SERIAL PRIMARY KEY,
  parent_id   INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sender_role VARCHAR(10)  NOT NULL CHECK (sender_role IN ('parent', 'staff')),
  sender_id   INT          NOT NULL REFERENCES users(user_id),
  body        TEXT         NOT NULL,
  request_id  INT          REFERENCES requests(request_id) ON DELETE SET NULL,
  is_read     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_parent_id  ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(parent_id, created_at);

-- === migrations/008_student_notes.sql ===
-- Staff progress notes on individual students
CREATE TABLE IF NOT EXISTS student_notes (
  note_id     SERIAL PRIMARY KEY,
  student_id  INT         NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  author_id   INT         NOT NULL REFERENCES users(user_id),
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id, created_at DESC);

-- === migrations/009_perf_indexes.sql ===
-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_students_branch        ON students(branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_parent        ON students(parent_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_name          ON students(branch_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_packages_student ON customer_packages(student_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_package_redemptions_pkg   ON package_redemptions(customer_package_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student    ON enrollments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_branch_date  ON schedules(branch_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_notes_student  ON student_notes(student_id, created_at DESC);

-- === migrations/010_holidays.sql ===
CREATE TABLE IF NOT EXISTS holidays (
  holiday_id  SERIAL PRIMARY KEY,
  branch_id   INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  start_date  DATE    NOT NULL,
  end_date    DATE    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holidays_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_branch ON holidays(branch_id);

-- === migrations/011_complaints.sql ===
CREATE TABLE IF NOT EXISTS complaints (
  complaint_id  SERIAL PRIMARY KEY,
  parent_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  student_id    INTEGER REFERENCES students(student_id) ON DELETE SET NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'closed')),
  staff_note    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_parent ON complaints(parent_id);

-- === migrations/announcements.sql ===
-- Run once to enable announcements feature
CREATE TABLE IF NOT EXISTS announcements (
  announcement_id SERIAL PRIMARY KEY,
  branch_id       INT  NOT NULL REFERENCES branches(branch_id),
  title           TEXT NOT NULL,
  body            TEXT,
  image_url       TEXT,
  send_to         TEXT NOT NULL DEFAULT 'all',
  created_by      INT  REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_announcements_branch ON announcements(branch_id);
