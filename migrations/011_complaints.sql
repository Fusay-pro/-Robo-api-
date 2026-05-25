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
