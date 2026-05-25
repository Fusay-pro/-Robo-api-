-- Contract teaching periods + recurring schedule for B2B school engagements.
-- Owner sets start/end dates so we know how long we're committed to teach.

ALTER TABLE contract_schools
  ADD COLUMN IF NOT EXISTS contract_start_date      date,
  ADD COLUMN IF NOT EXISTS contract_end_date        date,
  ADD COLUMN IF NOT EXISTS sessions_per_week        int,
  ADD COLUMN IF NOT EXISTS session_duration_minutes int,
  ADD COLUMN IF NOT EXISTS notes                    text;
