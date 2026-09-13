-- ============================================================
-- Admin full permissions fix
-- Uses email check (jwt) only — never queries profiles inside
-- a profiles policy (that causes 42P17 infinite recursion).
-- ============================================================

-- ============================================================
-- EVENTS: full CRUD for admin
-- ============================================================

DROP POLICY IF EXISTS "Users can delete their own events" ON public.events;
CREATE POLICY "Users can delete their own events"
ON public.events FOR DELETE TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
  OR (
    auth.uid() = creator_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'organizer'
        AND p.verification_status = 'verified'
        AND COALESCE(p.is_suspended, false) = false
    )
  )
);

DROP POLICY IF EXISTS "Users can update their own events" ON public.events;
CREATE POLICY "Users can update their own events"
ON public.events FOR UPDATE TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
  OR (
    auth.uid() = creator_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'organizer'
        AND p.verification_status = 'verified'
        AND COALESCE(p.is_suspended, false) = false
    )
  )
)
WITH CHECK (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
  OR (
    auth.uid() = creator_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'organizer'
        AND p.verification_status = 'verified'
        AND COALESCE(p.is_suspended, false) = false
    )
  )
);

-- Admin SELECT on all events
DROP POLICY IF EXISTS "Admin can select all events" ON public.events;
CREATE POLICY "Admin can select all events"
ON public.events FOR SELECT TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Admin INSERT events
DROP POLICY IF EXISTS "Admin can insert events" ON public.events;
CREATE POLICY "Admin can insert events"
ON public.events FOR INSERT TO authenticated
WITH CHECK (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ============================================================
-- TICKETS: admin can SELECT, UPDATE, DELETE
-- ============================================================

DROP POLICY IF EXISTS "Admin can view all tickets" ON public.tickets;
CREATE POLICY "Admin can view all tickets"
ON public.tickets FOR SELECT TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "Admin can update all tickets" ON public.tickets;
CREATE POLICY "Admin can update all tickets"
ON public.tickets FOR UPDATE TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "Admin can delete tickets" ON public.tickets;
CREATE POLICY "Admin can delete tickets"
ON public.tickets FOR DELETE TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ============================================================
-- PROFILES: admin full access
-- CRITICAL: must NOT query profiles inside this policy (42P17).
-- Use ONLY auth.jwt() ->> 'email' here.
-- ============================================================

DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;
CREATE POLICY "Admin can manage all profiles"
ON public.profiles FOR ALL TO authenticated
USING (
  auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
)
WITH CHECK (
  auth.jwt() ->> 'email' = 'aamracorporation@gmail.com'
);

-- ============================================================
-- EVENT_TICKET_TYPES: admin full access
-- ============================================================

DROP POLICY IF EXISTS "Admin can manage all event ticket types" ON public.event_ticket_types;
CREATE POLICY "Admin can manage all event ticket types"
ON public.event_ticket_types FOR ALL TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ============================================================
-- RESALE_LISTINGS: admin full access
-- ============================================================

DROP POLICY IF EXISTS "Admin can manage all resale listings" ON public.resale_listings;
CREATE POLICY "Admin can manage all resale listings"
ON public.resale_listings FOR ALL TO authenticated
USING (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

NOTIFY pgrst, 'reload schema';
