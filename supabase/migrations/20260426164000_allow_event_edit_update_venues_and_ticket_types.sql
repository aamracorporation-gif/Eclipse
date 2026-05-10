DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='venues'
  ) THEN
    DROP POLICY IF EXISTS "Creators can update venues" ON public.venues;
    CREATE POLICY "Creators can update venues"
    ON public.venues
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.venue_id = venues.id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.venue_id = venues.id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='event_ticket_types'
  ) THEN
    DROP POLICY IF EXISTS "Creators can insert ticket types" ON public.event_ticket_types;
    CREATE POLICY "Creators can insert ticket types"
    ON public.event_ticket_types
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_ticket_types.event_id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    );

    DROP POLICY IF EXISTS "Creators can update ticket types" ON public.event_ticket_types;
    CREATE POLICY "Creators can update ticket types"
    ON public.event_ticket_types
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_ticket_types.event_id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_ticket_types.event_id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    );

    DROP POLICY IF EXISTS "Creators can delete ticket types" ON public.event_ticket_types;
    CREATE POLICY "Creators can delete ticket types"
    ON public.event_ticket_types
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_ticket_types.event_id
          AND e.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
