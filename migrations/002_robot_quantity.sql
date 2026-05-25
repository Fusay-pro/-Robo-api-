-- Add quantity (number of physical robots available) to robot_types.
-- This becomes the default max_capacity for any session using a course
-- whose robot_type matches.

ALTER TABLE robot_types ADD COLUMN IF NOT EXISTS quantity int NOT NULL DEFAULT 8;
