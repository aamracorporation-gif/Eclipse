CREATE OR REPLACE FUNCTION public.bump_organizer_verification_on_docs_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at := now();

  UPDATE public.profiles
  SET
    verification_status = 'pending_verification',
    verification_rejection_reason = NULL,
    verification_reviewed_at = NULL,
    verification_reviewed_by = NULL,
    updated_at = now()
  WHERE id = NEW.user_id
    AND role = 'organizer'
    AND COALESCE(verification_status, 'pending_verification') NOT IN ('verified', 'rejected');

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS "Users manage own organizer documents" ON public.organizer_verification_documents;
    DROP POLICY IF EXISTS "Users read own organizer documents" ON public.organizer_verification_documents;
    DROP POLICY IF EXISTS "Users write own organizer documents" ON public.organizer_verification_documents;
    DROP POLICY IF EXISTS "Users update own organizer documents" ON public.organizer_verification_documents;
    DROP POLICY IF EXISTS "Users delete own organizer documents" ON public.organizer_verification_documents;

    CREATE POLICY "Users read own organizer documents"
    ON public.organizer_verification_documents
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

    CREATE POLICY "Users write own organizer documents"
    ON public.organizer_verification_documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'organizer'
          AND COALESCE(p.verification_status, 'pending_verification') <> 'rejected'
      )
    );

    CREATE POLICY "Users update own organizer documents"
    ON public.organizer_verification_documents
    FOR UPDATE
    TO authenticated
    USING (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'organizer'
          AND COALESCE(p.verification_status, 'pending_verification') <> 'rejected'
      )
    )
    WITH CHECK (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'organizer'
          AND COALESCE(p.verification_status, 'pending_verification') <> 'rejected'
      )
    );

    CREATE POLICY "Users delete own organizer documents"
    ON public.organizer_verification_documents
    FOR DELETE
    TO authenticated
    USING (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'organizer'
          AND COALESCE(p.verification_status, 'pending_verification') <> 'rejected'
      )
    );
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
    ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS suspended_reason text;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
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
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END $$;

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
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

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

CREATE OR REPLACE FUNCTION public.admin_set_user_suspension(
  p_user_id uuid,
  p_is_suspended boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_role text;
  v_reject_note text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT role
  INTO v_target_role
  FROM public.profiles
  WHERE id = p_user_id;

  v_reject_note := CASE
    WHEN COALESCE(p_reason, '') <> '' THEN p_reason
    ELSE 'Cuenta suspendida'
  END;

  UPDATE public.profiles
  SET
    is_suspended = p_is_suspended,
    suspended_at = CASE WHEN p_is_suspended THEN now() ELSE NULL END,
    suspended_by = CASE WHEN p_is_suspended THEN auth.uid() ELSE NULL END,
    suspended_reason = CASE WHEN p_is_suspended THEN COALESCE(p_reason, '') ELSE NULL END,
    verification_status = CASE
      WHEN p_is_suspended AND COALESCE(v_target_role, '') = 'organizer' THEN 'rejected'
      ELSE verification_status
    END,
    verification_rejection_reason = CASE
      WHEN p_is_suspended AND COALESCE(v_target_role, '') = 'organizer' THEN v_reject_note
      ELSE verification_rejection_reason
    END,
    verification_reviewed_at = CASE
      WHEN p_is_suspended AND COALESCE(v_target_role, '') = 'organizer' THEN now()
      ELSE verification_reviewed_at
    END,
    verification_reviewed_by = CASE
      WHEN p_is_suspended AND COALESCE(v_target_role, '') = 'organizer' THEN auth.uid()
      ELSE verification_reviewed_by
    END,
    updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.admin_audit_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'user_suspension_set',
    p_user_id,
    jsonb_build_object(
      'is_suspended', p_is_suspended,
      'reason', COALESCE(p_reason, ''),
      'target_role', COALESCE(v_target_role, '')
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_suspension(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
