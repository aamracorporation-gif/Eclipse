-- Enable RLS for event_ticket_types if not already enabled
ALTER TABLE event_ticket_types ENABLE ROW LEVEL SECURITY;

-- Policy for INSERT: Authenticated users can create ticket types for their own events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Creators can insert ticket types'
  ) THEN
    CREATE POLICY "Creators can insert ticket types"
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
END $$;

-- Policy for UPDATE: Creators can update ticket types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Creators can update ticket types'
  ) THEN
    CREATE POLICY "Creators can update ticket types"
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
END $$;

-- Policy for DELETE: Creators can delete ticket types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Creators can delete ticket types'
  ) THEN
    CREATE POLICY "Creators can delete ticket types"
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

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
