-- ============================================================
-- 012_schema_cleanup.sql
-- Fix schema drift accumulated since initial scaffold.
-- Safe to run on live DB — all changes are additive or
-- constraint replacements that match what the live DB already has.
-- ============================================================

-- 1. device_tokens — live DB allows 'web', schema only had ios/android
ALTER TABLE device_tokens DROP CONSTRAINT IF EXISTS device_tokens_platform_check;
ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_platform_check
  CHECK (platform IN ('ios','android','web'));

-- 2. students — date_of_birth column used throughout codebase
ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth date;

-- 3. branches — low_credit_threshold used in warningCron and settings endpoint
ALTER TABLE branches ADD COLUMN IF NOT EXISTS low_credit_threshold int NOT NULL DEFAULT 3;

-- 4. branches — per-branch Google Sheets URLs (owner-configurable)
--    Either a full URL or a raw spreadsheet ID is accepted and stored as-is;
--    sheetsSync.js strips the ID from a URL before calling the API.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_operational_id text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_finance_id      text;

-- 5. customer_packages — custom overrides added when catalog packages were removed
ALTER TABLE customer_packages ADD COLUMN IF NOT EXISTS custom_name        text;
ALTER TABLE customer_packages ADD COLUMN IF NOT EXISTS custom_class_count int;

-- 6. schedules — notes/cancel columns used throughout but missing from schema
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS cancelled_by_holiday_id int
  REFERENCES holidays(holiday_id);

-- 7. requests — cancellation type missing from CHECK constraint on live-compatible migration
-- (Run only if constraint exists with the old list; safe to skip if already updated)
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_type_check;
ALTER TABLE requests ADD CONSTRAINT requests_type_check
  CHECK (type IN ('refund', 'absence', 'reinstatement', 'cancellation'));

-- 8. enrollments — booking_note used in bookingGate.js INSERT
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS booking_note text;

-- 7. sheets_sync_log — operational-sync columns missing from original table
ALTER TABLE sheets_sync_log ADD COLUMN IF NOT EXISTS sync_type    text NOT NULL DEFAULT 'finance'
  CHECK (sync_type IN ('finance','operational'));
ALTER TABLE sheets_sync_log ADD COLUMN IF NOT EXISTS triggered_by text NOT NULL DEFAULT 'cron';
ALTER TABLE sheets_sync_log ADD COLUMN IF NOT EXISTS rows_written  int;
