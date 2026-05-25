-- Recurring weekly teaching slots per contract school
CREATE TABLE IF NOT EXISTS contract_school_slots (
  slot_id              serial PRIMARY KEY,
  contract_school_id   int NOT NULL REFERENCES contract_schools(contract_school_id),
  day_of_week          int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, matches EXTRACT(DOW)
  start_time           time NOT NULL,
  duration_minutes     int NOT NULL,
  teacher_user_id      int REFERENCES users(user_id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_contract_school_slots_contract
  ON contract_school_slots(contract_school_id)
  WHERE deleted_at IS NULL;

-- Link auto-generated schedule rows back to their source slot
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS source_slot_id int REFERENCES contract_school_slots(slot_id);

CREATE INDEX IF NOT EXISTS idx_schedules_source_slot
  ON schedules(source_slot_id)
  WHERE source_slot_id IS NOT NULL;
