-- FIX: Ensure tickets table has all required columns for worker sales
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS attendee_name text,
ADD COLUMN IF NOT EXISTS attendee_email text,
ADD COLUMN IF NOT EXISTS attendee_age integer,
ADD COLUMN IF NOT EXISTS ticket_type text,
ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.event_ticket_types(id),
ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS buyer_name text,
ADD COLUMN IF NOT EXISTS buyer_email text,
ADD COLUMN IF NOT EXISTS sold_by_worker_id uuid REFERENCES public.workers(id);

-- FIX: Ensure workers can SEE the events they are selling for (crucial for RLS checks)
DROP POLICY IF EXISTS "Workers can view their organizer's events" ON public.events;
CREATE POLICY "Workers can view their organizer's events"
ON public.events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workers
    WHERE workers.user_id = auth.uid()
    AND workers.organizer_id = events.creator_id
    AND workers.status = 'active'
  )
);

-- FIX: Ensure workers can INSERT tickets
DROP POLICY IF EXISTS "Workers can insert tickets" ON public.tickets;
CREATE POLICY "Workers can insert tickets"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workers
    WHERE user_id = auth.uid()
    AND status = 'active'
    AND (
      EXISTS (
        SELECT 1 FROM public.events
        WHERE events.id = tickets.event_id
        AND events.creator_id = workers.organizer_id
      )
    )
  )
);

-- FIX: Ensure workers can SELECT the tickets they just sold (for PDF generation)
DROP POLICY IF EXISTS "Workers can view tickets they sold" ON public.tickets;
CREATE POLICY "Workers can view tickets they sold"
ON public.tickets
FOR SELECT
TO authenticated
USING (
  sold_by_worker_id IN (
    SELECT id FROM public.workers WHERE user_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
