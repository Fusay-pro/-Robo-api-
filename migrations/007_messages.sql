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
