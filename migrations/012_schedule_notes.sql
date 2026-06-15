-- Per-session notes/description. The create-session UI has always collected a
-- "Description" field and the API has always inserted `notes` into schedules,
-- but the column was never added in schema.sql or a prior migration.
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS notes text;
