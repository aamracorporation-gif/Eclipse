DO $$
DECLARE
  v_admin_email text := 'achrafmakd04@gmail.com';
  v_user_id uuid;
  v_wallet_id uuid;
BEGIN
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_admin_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (v_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT id
  INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.wallet_transactions
  WHERE wallet_id = v_wallet_id;

  UPDATE public.wallets
  SET
    balance = 20,
    updated_at = now()
  WHERE id = v_wallet_id;
END $$;

NOTIFY pgrst, 'reload schema';
