-- Some registrations are organizations (schools/companies booking bulk event
-- slots, e.g. "Robot & Innovation 2026") or families who gave a phone but no
-- parent name — neither has a real parent account. Allow parent_user_id to be
-- NULL so the import doesn't reject these rows.
ALTER TABLE students ALTER COLUMN parent_user_id DROP NOT NULL;
