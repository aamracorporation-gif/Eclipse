-- Comprehensive fix for permissions and schema

-- 1. Ensure Venues permissions
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Drop existing policy if exists to ensure we have the correct one
  DROP POLICY IF EXISTS "Authenticated users can insert venues" ON venues;
  
  CREATE POLICY "Authenticated users can insert venues"
    ON venues FOR INSERT
    TO authenticated
    WITH CHECK (true);
    
  -- Ensure public read access
  DROP POLICY IF EXISTS "Anyone can view venues" ON venues;
  CREATE POLICY "Anyone can view venues"
    ON venues FOR SELECT
    TO public
    USING (true);
END $$;

-- 2. Ensure Events permissions
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
  CREATE POLICY "Authenticated users can create events"
    ON events FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = creator_id);

  DROP POLICY IF EXISTS "Users can update their own events" ON events;
  CREATE POLICY "Users can update their own events"
    ON events FOR UPDATE
    TO authenticated
    USING (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id);
    
  DROP POLICY IF EXISTS "Users can delete their own events" ON events;
  CREATE POLICY "Users can delete their own events"
    ON events FOR DELETE
    TO authenticated
    USING (auth.uid() = creator_id);

  DROP POLICY IF EXISTS "Anyone can view events" ON events;
  CREATE POLICY "Anyone can view events"
    ON events FOR SELECT
    TO public
    USING (true);
END $$;

-- 3. Ensure Ticket Types permissions
ALTER TABLE event_ticket_types ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Creators can insert ticket types" ON event_ticket_types;
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

  DROP POLICY IF EXISTS "Creators can update ticket types" ON event_ticket_types;
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
    
  DROP POLICY IF EXISTS "Anyone can view ticket types" ON event_ticket_types;
  CREATE POLICY "Anyone can view ticket types"
    ON event_ticket_types FOR SELECT
    TO public
    USING (true);
END $$;

-- 4. Fix potential issues with venues sequence (optional but good practice)
-- (Supabase handles UUIDs so no sequence issues typically)

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
