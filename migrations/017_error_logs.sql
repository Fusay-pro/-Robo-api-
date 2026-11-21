-- Every API response of status 400 or worse, recorded so a failure can be
-- explained after the fact instead of needing a terminal, PM2 and a database
-- session. Written because a bulk delete failed repeatedly and silently: the
-- API rejected each batch, the staff app said nothing useful, and nothing was
-- written down anywhere.
--
-- What is deliberately NOT here: request bodies, query strings, headers,
-- tokens, and names. `path` holds the Express route pattern (`/students/:id`),
-- never the URL as called, so student and user ids stay out of the log. The
-- viewer joins `users` on `user_id` for display.
CREATE TABLE IF NOT EXISTS error_log (
  log_id      serial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT NOW(),
  status      int         NOT NULL,          -- HTTP status; 0 for a browser-side crash
  method      text        NOT NULL,
  path        text        NOT NULL,          -- route pattern, not the raw URL
  message     text,                          -- the `error` string the client received
  stack       text,                          -- 500s and client crashes only
  user_id     int,                           -- no FK: a row outlives the user it happened to
  role        text,
  branch_id   int,
  request_id  text                           -- also returned to the client as x-request-id
);

-- The viewer reads newest first, always.
CREATE INDEX IF NOT EXISTS error_log_occurred_at_idx ON error_log (occurred_at DESC);
-- The viewer's branch scoping for a non-super owner.
CREATE INDEX IF NOT EXISTS error_log_branch_idx ON error_log (branch_id);
