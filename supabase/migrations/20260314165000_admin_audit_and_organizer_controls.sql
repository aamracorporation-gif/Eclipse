-- Admin dashboard backend: organizer controls + audit logging

-- 1) Profiles: suspension controls
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS suspended_reason text;

-- 2) Extend verification status to support "needs_correction"
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.profiles'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%verification_status%'
  ORDER BY c.conname
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_verification_status_check
  CHECK (verification_status IN ('pending_verification', 'verified', 'rejected', 'needs_correction'));
END $$;

-- 3) Admin audit logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_user_id ON public.admin_audit_logs(target_user_id, created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can read audit logs"
ON public.admin_audit_logs
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- 4) Admin RPC: set organizer verification (approve/reject/request correction)
CREATE OR REPLACE FUNCTION public.admin_set_organizer_verification(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_status NOT IN ('pending_verification', 'verified', 'rejected', 'needs_correction') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.profiles
  SET
    verification_status = p_status,
    verification_rejection_reason = CASE
      WHEN p_status IN ('rejected', 'needs_correction') THEN COALESCE(p_reason, '')
      ELSE NULL
    END,
    verification_reviewed_at = now(),
    verification_reviewed_by = auth.uid(),
    updated_at = now()
  WHERE id = p_user_id
    AND role = 'organizer';

  INSERT INTO public.admin_audit_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'organizer_verification_set',
    p_user_id,
    jsonb_build_object('status', p_status, 'reason', COALESCE(p_reason, ''))
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_organizer_verification(uuid, text, text) TO authenticated;

-- 5) Admin RPC: suspend/activate organizer accounts
CREATE OR REPLACE FUNCTION public.admin_set_organizer_suspension(
  p_user_id uuid,
  p_is_suspended boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.profiles
  SET
    is_suspended = p_is_suspended,
    suspended_at = CASE WHEN p_is_suspended THEN now() ELSE NULL END,
    suspended_by = CASE WHEN p_is_suspended THEN auth.uid() ELSE NULL END,
    suspended_reason = CASE WHEN p_is_suspended THEN COALESCE(p_reason, '') ELSE NULL END,
    updated_at = now()
  WHERE id = p_user_id
    AND role = 'organizer';

  INSERT INTO public.admin_audit_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'organizer_suspension_set',
    p_user_id,
    jsonb_build_object('is_suspended', p_is_suspended, 'reason', COALESCE(p_reason, ''))
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_organizer_suspension(uuid, boolean, text) TO authenticated;

-- 6) Enforce organizer restrictions: verified + not suspended
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can create events" ON public.events;
  CREATE POLICY "Authenticated users can create events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = creator_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'organizer'
        AND p.verification_status = 'verified'
        AND COALESCE(p.is_suspended, false) = false
    )
  );

  DROP POLICY IF EXISTS "Users can update their own events" ON public.events;
  CREATE POLICY "Users can update their own events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = creator_id
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
    auth.uid() = creator_id
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

  DROP POLICY IF EXISTS "Users can delete their own events" ON public.events;
  CREATE POLICY "Users can delete their own events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = creator_id
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

  DROP POLICY IF EXISTS "Authenticated users can insert venues" ON public.venues;
  CREATE POLICY "Authenticated users can insert venues"
  ON public.venues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
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
      WHERE e.id = event_ticket_types.event_id
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
END $$;

-- 7) Night Mode: verified organizers can start streams (not suspended)
DO $$
BEGIN
  IF to_regclass('public.event_live_streams') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Verified organizers can start streams" ON public.event_live_streams;
  CREATE POLICY "Verified organizers can start streams"
  ON public.event_live_streams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = organizer_id
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.creator_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'organizer'
        AND p.verification_status = 'verified'
        AND COALESCE(p.is_suspended, false) = false
    )
  );
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

NOTIFY pgrst, 'reload schema';
