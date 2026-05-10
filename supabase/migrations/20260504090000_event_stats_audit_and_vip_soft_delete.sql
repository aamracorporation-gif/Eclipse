DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservados_vip' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.reservados_vip
      ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservados_vip' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE public.reservados_vip
      ADD COLUMN deleted_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservados_vip' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.reservados_vip
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.event_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_table text NOT NULL,
  action text NOT NULL,
  row_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_audit_logs_event_created_at
ON public.event_audit_logs(event_id, created_at DESC);

ALTER TABLE public.event_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creators can read audit logs for their events" ON public.event_audit_logs;
CREATE POLICY "Creators can read audit logs for their events"
ON public.event_audit_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_audit_logs.event_id
      AND e.creator_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "Authenticated can insert event audit logs" ON public.event_audit_logs;
CREATE POLICY "Authenticated can insert event audit logs"
ON public.event_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
