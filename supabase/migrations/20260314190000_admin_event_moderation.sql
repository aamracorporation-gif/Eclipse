-- Admin moderation permissions for events and reports

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can update their own events" ON public.events;
CREATE POLICY "Users can update their own events"
ON public.events
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'admin'
        OR (
          auth.uid() = creator_id
          AND p.role = 'organizer'
          AND p.verification_status = 'verified'
          AND COALESCE(p.is_suspended, false) = false
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'admin'
        OR (
          auth.uid() = creator_id
          AND p.role = 'organizer'
          AND p.verification_status = 'verified'
          AND COALESCE(p.is_suspended, false) = false
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can delete their own events" ON public.events;
CREATE POLICY "Users can delete their own events"
ON public.events
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'admin'
        OR (
          auth.uid() = creator_id
          AND p.role = 'organizer'
          AND p.verification_status = 'verified'
          AND COALESCE(p.is_suspended, false) = false
        )
      )
  )
);

DROP POLICY IF EXISTS "Admins can read event reports" ON public.event_reports;
CREATE POLICY "Admins can read event reports"
ON public.event_reports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
);

NOTIFY pgrst, 'reload schema';
