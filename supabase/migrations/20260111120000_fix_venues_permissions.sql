-- Allow authenticated users to insert venues
-- This is necessary for the 'create event' flow where we insert a venue first

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'venues' 
    AND policyname = 'Authenticated users can insert venues'
  ) THEN
    CREATE POLICY "Authenticated users can insert venues"
      ON venues FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;
