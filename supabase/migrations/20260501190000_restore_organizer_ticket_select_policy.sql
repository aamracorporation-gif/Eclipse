DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND policyname = 'Organizers can view tickets for their events'
  ) THEN
    CREATE POLICY "Organizers can view tickets for their events"
    ON public.tickets
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = tickets.event_id
          AND e.creator_id = auth.uid()
      )
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
