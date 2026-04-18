/*
  # Authentication and Analytics Enhancement

  ## Overview
  Adds user authentication tracking and event analytics to the party finder app.

  ## Changes to Existing Tables

  ### events
  - Add `sold_tickets` (integer) - Counter for total tickets sold
  - Add index for performance

  ### tickets
  - Add `user_id` (uuid) - Links ticket to authenticated user
  - Add foreign key to auth.users
  - Update RLS policies for user-specific access

  ## Security Updates
  - Update RLS policies to ensure users only see their own tickets
  - Maintain public read access for venues and events
  - Add user-specific insert policies for tickets

  ## Important Notes
  1. sold_tickets counter will be incremented when tickets are purchased
  2. Users must be authenticated to purchase tickets
  3. Each ticket is now associated with a specific user account
*/

-- Add sold_tickets counter to events table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'sold_tickets'
  ) THEN
    ALTER TABLE events ADD COLUMN sold_tickets integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add user_id to tickets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE tickets ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update existing sold_tickets based on current ticket sales
UPDATE events e
SET sold_tickets = COALESCE((
  SELECT SUM(quantity)
  FROM tickets t
  WHERE t.event_id = e.id
), 0)
WHERE sold_tickets = 0;

-- Drop old public policies for tickets
DROP POLICY IF EXISTS "Anyone can create tickets" ON tickets;
DROP POLICY IF EXISTS "Users can view their own tickets" ON tickets;

-- Create new RLS policies for tickets with user authentication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Authenticated users can create tickets'
  ) THEN
    CREATE POLICY "Authenticated users can create tickets"
      ON tickets FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Users can view only their own tickets'
  ) THEN
    CREATE POLICY "Users can view only their own tickets"
      ON tickets FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Users can update their own tickets'
  ) THEN
    CREATE POLICY "Users can update their own tickets"
      ON tickets FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Create function to increment sold_tickets counter
CREATE OR REPLACE FUNCTION increment_sold_tickets()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE events
  SET sold_tickets = sold_tickets + NEW.quantity
  WHERE id = NEW.event_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-increment sold_tickets
DROP TRIGGER IF EXISTS ticket_sold_counter ON tickets;
CREATE TRIGGER ticket_sold_counter
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION increment_sold_tickets();

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
