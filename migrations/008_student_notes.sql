-- Staff progress notes on individual students
CREATE TABLE IF NOT EXISTS student_notes (
  note_id     SERIAL PRIMARY KEY,
  student_id  INT         NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  author_id   INT         NOT NULL REFERENCES users(user_id),
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id, created_at DESC);
