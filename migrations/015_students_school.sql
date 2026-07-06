-- Store which school the student attends (registration sheet column โรงเรียน).
ALTER TABLE students ADD COLUMN IF NOT EXISTS school TEXT;
