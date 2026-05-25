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
