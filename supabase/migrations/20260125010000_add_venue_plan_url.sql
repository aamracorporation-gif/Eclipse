
-- Add venue_plan_url to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_plan_url text;
