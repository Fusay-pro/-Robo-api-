-- Structured request cards sent by parents via quick-reply buttons
CREATE TABLE IF NOT EXISTS requests (
  request_id  SERIAL PRIMARY KEY,
  parent_id   INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type        VARCHAR(30)  NOT NULL CHECK (type IN ('refund', 'absence', 'reinstatement', 'cancellation')),
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  details     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_parent_id ON requests(parent_id);
CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests(status);
