-- Fix tickets table schema to support worker sales and detailed attendee info
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS attendee_name text,
ADD COLUMN IF NOT EXISTS attendee_email text,
ADD COLUMN IF NOT EXISTS attendee_age integer,
ADD COLUMN IF NOT EXISTS ticket_type text, -- Stores the name of the ticket type (e.g. 'General', 'VIP')
ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.event_ticket_types(id), -- Optional FK if we want strict linking
ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0; -- Ensure price column exists

-- Update RLS to ensure workers can insert tickets
-- (Assuming 'Anyone can create tickets' policy exists, but we might want to be more specific for workers)
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
      -- Worker must be assigned to the event OR belong to the organizer
      EXISTS (
        SELECT 1 FROM public.events
        WHERE events.id = tickets.event_id
        AND events.creator_id = workers.organizer_id
      )
    )
  )
);

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
