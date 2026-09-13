-- Fix RLS policies for event_ticket_types so organizers can INSERT/UPDATE/DELETE
-- their own event's ticket types. Previously only SELECT was permissioned,
-- causing UPDATE (soft-delete) and upsert to silently fail with 0 rows affected.

-- Drop ALL existing policies on this table to start clean
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'event_ticket_types' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.event_ticket_types', pol.policyname);
  END LOOP;
END $$;

-- Allow anyone to view ticket types (customers browsing events)
CREATE POLICY "Anyone can view active ticket types"
  ON public.event_ticket_types FOR SELECT
  USING (true);

-- Allow authenticated users (organizers/admin) to insert ticket types for events they own
CREATE POLICY "Creators can insert ticket types"
  ON public.event_ticket_types FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_ticket_types.event_id
        AND e.creator_id = auth.uid()
    )
    OR auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
  );

-- Allow authenticated users (organizers/admin) to update ticket types for events they own
CREATE POLICY "Creators can update ticket types"
  ON public.event_ticket_types FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_ticket_types.event_id
        AND e.creator_id = auth.uid()
    )
    OR auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_ticket_types.event_id
        AND e.creator_id = auth.uid()
    )
    OR auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
  );

-- Allow authenticated users (organizers/admin) to delete ticket types for events they own
CREATE POLICY "Creators can delete ticket types"
  ON public.event_ticket_types FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_ticket_types.event_id
        AND e.creator_id = auth.uid()
    )
    OR auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
  );
