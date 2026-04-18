-- Admin RPC: suspend/activate any user account (organizer or attendee)

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

  UPDATE public.profiles
  SET
    is_suspended = p_is_suspended,
    suspended_at = CASE WHEN p_is_suspended THEN now() ELSE NULL END,
    suspended_by = CASE WHEN p_is_suspended THEN auth.uid() ELSE NULL END,
    suspended_reason = CASE WHEN p_is_suspended THEN COALESCE(p_reason, '') ELSE NULL END,
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
