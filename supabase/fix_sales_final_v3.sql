-- FIX: Ensure tickets table has all required columns for worker sales
-- Run this in Supabase SQL Editor

-- 1. Add missing columns (Safe to run multiple times)
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS attendee_name text,
ADD COLUMN IF NOT EXISTS attendee_email text,
ADD COLUMN IF NOT EXISTS attendee_age integer,
ADD COLUMN IF NOT EXISTS ticket_type text,
ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.event_ticket_types(id),
ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS buyer_name text,
ADD COLUMN IF NOT EXISTS buyer_email text,
ADD COLUMN IF NOT EXISTS sold_by_worker_id uuid REFERENCES public.workers(id),
ADD COLUMN IF NOT EXISTS scanned_by_worker_id uuid REFERENCES public.workers(id),
ADD COLUMN IF NOT EXISTS scanned_at timestamptz,
ADD COLUMN IF NOT EXISTS qr_token uuid DEFAULT gen_random_uuid(), -- Ensure this exists for validation
ADD COLUMN IF NOT EXISTS qr_code text; -- Ensure this exists for PDF/legacy

-- 2. Update RLS to ensure workers can INSERT tickets
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

-- 3. Update RLS to ensure workers can VIEW tickets they sold (for PDF generation)
DROP POLICY IF EXISTS "Workers can view sold tickets" ON public.tickets;

CREATE POLICY "Workers can view sold tickets"
ON public.tickets
FOR SELECT
TO authenticated
USING (
  sold_by_worker_id IN (
    SELECT id FROM public.workers WHERE user_id = auth.uid()
  )
  OR
  user_id = auth.uid() -- Buyer
);

-- 4. Ensure workers can view their organizer's events
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

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
