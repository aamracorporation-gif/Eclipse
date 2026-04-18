CREATE TABLE IF NOT EXISTS public.reservados_vip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  base_price numeric NOT NULL,
  capacity_people integer NOT NULL,
  included_bottles integer NOT NULL DEFAULT 0,
  extra_bottle_price numeric,
  quantity_available integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservados_vip_event_id ON public.reservados_vip(event_id);

ALTER TABLE public.reservados_vip ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reservados_vip'
      AND policyname = 'Anyone can view reservados vip'
  ) THEN
    CREATE POLICY "Anyone can view reservados vip"
      ON public.reservados_vip
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reservados_vip'
      AND policyname = 'Creators can insert reservados vip'
  ) THEN
    CREATE POLICY "Creators can insert reservados vip"
      ON public.reservados_vip
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = reservados_vip.event_id
            AND e.creator_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND (
              p.role = 'admin'
              OR (
                p.role = 'organizer'
                AND p.verification_status = 'verified'
                AND COALESCE(p.is_suspended, false) = false
              )
            )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reservados_vip'
      AND policyname = 'Creators can update reservados vip'
  ) THEN
    CREATE POLICY "Creators can update reservados vip"
      ON public.reservados_vip
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = reservados_vip.event_id
            AND e.creator_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND (
              p.role = 'admin'
              OR (
                p.role = 'organizer'
                AND p.verification_status = 'verified'
                AND COALESCE(p.is_suspended, false) = false
              )
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = reservados_vip.event_id
            AND e.creator_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND (
              p.role = 'admin'
              OR (
                p.role = 'organizer'
                AND p.verification_status = 'verified'
                AND COALESCE(p.is_suspended, false) = false
              )
            )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reservados_vip'
      AND policyname = 'Creators can delete reservados vip'
  ) THEN
    CREATE POLICY "Creators can delete reservados vip"
      ON public.reservados_vip
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = reservados_vip.event_id
            AND e.creator_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND (
              p.role = 'admin'
              OR (
                p.role = 'organizer'
                AND p.verification_status = 'verified'
                AND COALESCE(p.is_suspended, false) = false
              )
            )
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
