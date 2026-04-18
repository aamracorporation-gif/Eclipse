-- MASTER FIX: Run this in Supabase SQL Editor to fix all schema and permission issues

-- 1. Create Tables (if they don't exist)
CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  description text DEFAULT '',
  image_url text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES venues(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  poster_url text DEFAULT '',
  event_date timestamptz NOT NULL,
  ticket_price numeric NOT NULL DEFAULT 0,
  available_tickets integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  total_price numeric NOT NULL,
  purchase_date timestamptz DEFAULT now(),
  qr_code text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL,
  quantity integer NOT NULL,
  sold integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Add Missing Columns (Safe operations)
DO $$
BEGIN
  -- Events columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'dress_code') THEN
    ALTER TABLE events ADD COLUMN dress_code text DEFAULT 'Casual' NOT NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'age_restriction') THEN
    ALTER TABLE events ADD COLUMN age_restriction integer DEFAULT 0 NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'theme') THEN
    ALTER TABLE events ADD COLUMN theme text DEFAULT 'Mixed' NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'event_type') THEN
    ALTER TABLE events ADD COLUMN event_type text DEFAULT 'Club Night' NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'creator_id') THEN
    ALTER TABLE events ADD COLUMN creator_id uuid REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'sold_tickets') THEN
    ALTER TABLE events ADD COLUMN sold_tickets integer DEFAULT 0 NOT NULL;
  END IF;

  -- Tickets columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'user_id') THEN
    ALTER TABLE tickets ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Enable RLS
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_ticket_types ENABLE ROW LEVEL SECURITY;

-- 4. Fix Permissions (Drop and Recreate to be sure)
DO $$
BEGIN
  -- VENUES
  DROP POLICY IF EXISTS "Authenticated users can insert venues" ON venues;
  CREATE POLICY "Authenticated users can insert venues" ON venues FOR INSERT TO authenticated WITH CHECK (true);
  
  DROP POLICY IF EXISTS "Anyone can view venues" ON venues;
  CREATE POLICY "Anyone can view venues" ON venues FOR SELECT TO public USING (true);

  -- EVENTS
  DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
  CREATE POLICY "Authenticated users can create events" ON events FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);

  DROP POLICY IF EXISTS "Users can update their own events" ON events;
  CREATE POLICY "Users can update their own events" ON events FOR UPDATE TO authenticated USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);
    
  DROP POLICY IF EXISTS "Users can delete their own events" ON events;
  CREATE POLICY "Users can delete their own events" ON events FOR DELETE TO authenticated USING (auth.uid() = creator_id);

  DROP POLICY IF EXISTS "Anyone can view events" ON events;
  CREATE POLICY "Anyone can view events" ON events FOR SELECT TO public USING (true);

  -- TICKET TYPES
  DROP POLICY IF EXISTS "Creators can insert ticket types" ON event_ticket_types;
  CREATE POLICY "Creators can insert ticket types" ON event_ticket_types FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = event_ticket_types.event_id AND events.creator_id = auth.uid()));

  DROP POLICY IF EXISTS "Creators can update ticket types" ON event_ticket_types;
  CREATE POLICY "Creators can update ticket types" ON event_ticket_types FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM events WHERE events.id = event_ticket_types.event_id AND events.creator_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = event_ticket_types.event_id AND events.creator_id = auth.uid()));
    
  DROP POLICY IF EXISTS "Anyone can view ticket types" ON event_ticket_types;
  CREATE POLICY "Anyone can view ticket types" ON event_ticket_types FOR SELECT TO public USING (true);

  -- TICKETS (Purchases)
  DROP POLICY IF EXISTS "Authenticated users can create tickets" ON tickets;
  CREATE POLICY "Authenticated users can create tickets" ON tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

  DROP POLICY IF EXISTS "Users can view only their own tickets" ON tickets;
  CREATE POLICY "Users can view only their own tickets" ON tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
END $$;

-- 5. Notify Schema Cache Reload
NOTIFY pgrst, 'reload schema';
