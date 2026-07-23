-- Reversible "hide/archive" for students: archived students drop off the main
-- roster but keep all their data and can be un-hidden. Distinct from deleted_at
-- (soft delete). NULL = active/visible; a timestamp = archived.
ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at timestamptz;
