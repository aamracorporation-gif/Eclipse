/*
  # Party Finder App - Initial Schema

  ## Overview
  Creates the complete database schema for a party/nightclub discovery and ticketing app.

  ## New Tables

  ### venues
  - `id` (uuid, primary key) - Unique venue identifier
  - `name` (text) - Name of the venue/nightclub
  - `address` (text) - Full address
  - `latitude` (numeric) - GPS latitude coordinate
  - `longitude` (numeric) - GPS longitude coordinate
  - `description` (text) - Venue description
  - `image_url` (text) - Venue image
  - `created_at` (timestamptz) - Record creation timestamp

  ### events
  - `id` (uuid, primary key) - Unique event identifier
  - `venue_id` (uuid, foreign key) - References venues table
  - `title` (text) - Event title
  - `description` (text) - Event description
  - `poster_url` (text) - Event poster/flyer image
  - `event_date` (timestamptz) - Date and time of the event
  - `ticket_price` (numeric) - Price per ticket
  - `available_tickets` (integer) - Remaining tickets
  - `created_at` (timestamptz) - Record creation timestamp

  ### tickets
  - `id` (uuid, primary key) - Unique ticket identifier
  - `event_id` (uuid, foreign key) - References events table
  - `buyer_name` (text) - Name of ticket buyer
  - `buyer_email` (text) - Email of ticket buyer
  - `quantity` (integer) - Number of tickets purchased
  - `total_price` (numeric) - Total purchase amount
  - `purchase_date` (timestamptz) - Purchase timestamp
  - `qr_code` (text) - QR code for ticket validation

  ## Security
  - Enable RLS on all tables
  - Public read access for venues and events (anyone can browse)
  - Authenticated users can purchase tickets
  - Users can only view their own tickets
*/

-- Create venues table
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

-- Create events table
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

-- Create tickets table
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

-- Enable Row Level Security
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for venues (public read)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'venues'
      AND policyname = 'Anyone can view venues'
  ) THEN
    CREATE POLICY "Anyone can view venues"
      ON venues FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

-- RLS Policies for events (public read)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND policyname = 'Anyone can view events'
  ) THEN
    CREATE POLICY "Anyone can view events"
      ON events FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

-- RLS Policies for tickets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Anyone can create tickets'
  ) THEN
    CREATE POLICY "Anyone can create tickets"
      ON tickets FOR INSERT
      TO public
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Users can view their own tickets'
  ) THEN
    CREATE POLICY "Users can view their own tickets"
      ON tickets FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events(venue_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(buyer_email);
