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
