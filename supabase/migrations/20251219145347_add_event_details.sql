/*
  # Add Event Details and Filtering Fields

  ## Overview
  Adds comprehensive event information fields to enable better filtering and user experience.

  ## Changes to events table
  - Add `dress_code` (text) - Dress code requirements (e.g., "Casual", "Formal", "Cocktail", "Themed")
  - Add `age_restriction` (integer) - Minimum age requirement (e.g., 18, 21, 0 for all ages)
  - Add `theme` (text) - Event theme/type (e.g., "Electronic", "Hip Hop", "Rock", "Latin", "Mixed")
  - Add `event_type` (text) - Category (e.g., "Club Night", "Concert", "Festival", "Private Party")
  - Add indexes for better query performance

  ## Security
  - No RLS changes needed (inherits existing policies)

  ## Important Notes
  1. These fields enable advanced filtering options
  2. Default values allow backward compatibility
  3. Existing events will have empty/default values until updated
*/

-- Add dress_code field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'dress_code'
  ) THEN
    ALTER TABLE events ADD COLUMN dress_code text DEFAULT 'Casual' NOT NULL;
  END IF;
END $$;

-- Add age_restriction field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'age_restriction'
  ) THEN
    ALTER TABLE events ADD COLUMN age_restriction integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add theme field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'theme'
  ) THEN
    ALTER TABLE events ADD COLUMN theme text DEFAULT 'Mixed' NOT NULL;
  END IF;
END $$;

-- Add event_type field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'event_type'
  ) THEN
    ALTER TABLE events ADD COLUMN event_type text DEFAULT 'Club Night' NOT NULL;
  END IF;
END $$;

-- Create indexes for better filtering performance
CREATE INDEX IF NOT EXISTS idx_events_age_restriction ON events(age_restriction);
CREATE INDEX IF NOT EXISTS idx_events_theme ON events(theme);
CREATE INDEX IF NOT EXISTS idx_events_dress_code ON events(dress_code);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);