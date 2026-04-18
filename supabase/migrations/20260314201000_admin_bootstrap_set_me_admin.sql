-- Allow the configured admin email to bootstrap their profile role to 'admin'

CREATE OR REPLACE FUNCTION public.bootstrap_set_me_admin(p_admin_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  IF v_email = '' THEN
    RAISE EXCEPTION 'Missing email in token';
  END IF;

  IF lower(coalesce(p_admin_email, '')) = '' THEN
    RAISE EXCEPTION 'Missing admin email';
  END IF;

  IF v_email <> lower(p_admin_email) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.profiles
  SET
    role = 'admin',
    updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_set_me_admin(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
