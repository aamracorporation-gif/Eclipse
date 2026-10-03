-- Add missing columns to events table
DO $$
BEGIN
  -- Add creator_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'creator_id'
  ) THEN
    ALTER TABLE events ADD COLUMN creator_id uuid REFERENCES auth.users(id);
  END IF;

  -- Add sold_tickets
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'sold_tickets'
  ) THEN
    ALTER TABLE events ADD COLUMN sold_tickets integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Enable RLS for events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Policy for INSERT: Authenticated users can create events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'Authenticated users can create events'
  ) THEN
    CREATE POLICY "Authenticated users can create events"
      ON events FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = creator_id);
  END IF;
END $$;

-- Policy for UPDATE: Users can update their own events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'Users can update their own events'
  ) THEN
    CREATE POLICY "Users can update their own events"
      ON events FOR UPDATE
      TO authenticated
      USING (auth.uid() = creator_id)
      WITH CHECK (auth.uid() = creator_id);
  END IF;
END $$;

-- Policy for DELETE: Users can delete their own events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'Users can delete their own events'
  ) THEN
    CREATE POLICY "Users can delete their own events"
      ON events FOR DELETE
      TO authenticated
      USING (auth.uid() = creator_id);
  END IF;
END $$;

-- Create index for creator_id
CREATE INDEX IF NOT EXISTS idx_events_creator_id ON events(creator_id);

-- Create event_ticket_types table
CREATE TABLE IF NOT EXISTS event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL,
  quantity integer NOT NULL,
  sold integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS for event_ticket_types
ALTER TABLE event_ticket_types ENABLE ROW LEVEL SECURITY;

-- Policies for event_ticket_types
DO $$
BEGIN
  -- Public read access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Anyone can view ticket types'
  ) THEN
    CREATE POLICY "Anyone can view ticket types"
      ON event_ticket_types FOR SELECT
      TO public
      USING (true);
  END IF;

  -- Only the owner of the event can create ticket types.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Authenticated users can create ticket types'
  ) THEN
    CREATE POLICY "Authenticated users can create ticket types"
      ON event_ticket_types FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM events
          WHERE events.id = event_ticket_types.event_id
          AND events.creator_id = auth.uid()
        )
      );
  END IF;

  -- Only the owner of the event can update or delete ticket types.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Authenticated users can update ticket types'
  ) THEN
    CREATE POLICY "Authenticated users can update ticket types"
      ON event_ticket_types FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM events
          WHERE events.id = event_ticket_types.event_id
          AND events.creator_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM events
          WHERE events.id = event_ticket_types.event_id
          AND events.creator_id = auth.uid()
        )
      );
  END IF;

    IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Authenticated users can delete ticket types'
  ) THEN
    CREATE POLICY "Authenticated users can delete ticket types"
      ON event_ticket_types FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM events
          WHERE events.id = event_ticket_types.event_id
          AND events.creator_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_types_event_id ON event_ticket_types(event_id);
