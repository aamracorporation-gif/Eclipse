-- Allow workers to view their organizer's events
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

-- Ensure workers can see the venue details too if RLS exists on venues
-- (Assuming venues are public or have similar policy, adding just in case)
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
