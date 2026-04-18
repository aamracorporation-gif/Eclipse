-- Fix worker policies by dropping existing ones first
DROP POLICY IF EXISTS "Workers can view organizer events" ON public.events;
DROP POLICY IF EXISTS "Workers can view organizer venues" ON public.venues;

-- Re-create policies with idempotent checks
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE tablename = 'events'
        AND policyname = 'Workers can view organizer events'
    ) THEN
        CREATE POLICY "Workers can view organizer events" ON public.events
        FOR SELECT
        USING (
          auth.uid() IN (
            SELECT user_id 
            FROM public.workers 
            WHERE organizer_id = events.creator_id 
            AND status = 'active'
          )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE tablename = 'venues'
        AND policyname = 'Workers can view organizer venues'
    ) THEN
        CREATE POLICY "Workers can view organizer venues" ON public.venues
        FOR SELECT
        USING (
          auth.uid() IN (
            SELECT w.user_id 
            FROM public.workers w
            JOIN public.events e ON e.creator_id = w.organizer_id
            WHERE e.venue_id = venues.id
            AND w.status = 'active'
          )
        );
    END IF;
END
$$;