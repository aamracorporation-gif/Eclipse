CREATE OR REPLACE FUNCTION public.upsert_user_push_token(
  p_token text,
  p_platform text DEFAULT 'android'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid;
  v_platform text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Token required';
  END IF;

  v_platform := lower(COALESCE(NULLIF(p_platform, ''), 'android'));
  IF v_platform NOT IN ('ios', 'android', 'web') THEN
    v_platform := 'android';
  END IF;

  INSERT INTO public.user_push_tokens (user_id, token, platform, is_active, created_at, last_used_at)
  VALUES (v_uid, p_token, v_platform, true, now(), now())
  ON CONFLICT (token) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    is_active = true,
    last_used_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_push_token(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
