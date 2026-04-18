DO $$
DECLARE
  v_target_email text := 'achrafmakd04@gmail.com';
  v_user_id uuid;
BEGIN
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_target_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (v_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

NOTIFY pgrst, 'reload schema';
