-- Fix Resale Visibility: Allow public access to tickets that are in active resale
-- This is necessary because buyers need to see ticket details (event, type) before buying.

-- 1. Add policy to 'tickets' table
-- Allow anyone to select tickets that are currently in an active resale listing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'tickets' 
    AND policyname = 'Anyone can view tickets in active resale'
  ) THEN
    CREATE POLICY "Anyone can view tickets in active resale" 
    ON tickets 
    FOR SELECT 
    USING (
      EXISTS (
        SELECT 1 FROM resale_listings 
        WHERE resale_listings.ticket_id = tickets.id 
        AND resale_listings.status = 'active'
      )
    );
  END IF;
END $$;

-- 2. Ensure 'events' is publicly readable (just in case)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'Anyone can view events'
  ) THEN
    CREATE POLICY "Anyone can view events" 
    ON events 
    FOR SELECT 
    USING (true);
  END IF;
END $$;

-- 3. Ensure 'event_ticket_types' is publicly readable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'event_ticket_types' 
    AND policyname = 'Anyone can view ticket types'
  ) THEN
    CREATE POLICY "Anyone can view ticket types" 
    ON event_ticket_types 
    FOR SELECT 
    USING (true);
  END IF;
END $$;
