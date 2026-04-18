CREATE OR REPLACE FUNCTION public.buy_ticket_with_wallet(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity int,
  p_total_price numeric,
  p_qr_code text,
  p_ticket_type_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_result json;
  v_first_id text;
  v_has_ticket_type_rpc boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance)
    VALUES (p_user_id, 0)
    RETURNING * INTO v_wallet;
  END IF;

  IF v_wallet.balance < p_total_price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  v_has_ticket_type_rpc :=
    to_regprocedure('public.purchase_ticket(uuid,uuid,text,text,integer,numeric,text,uuid)') IS NOT NULL
    OR to_regprocedure('purchase_ticket(uuid,uuid,text,text,integer,numeric,text,uuid)') IS NOT NULL;

  IF v_has_ticket_type_rpc THEN
    SELECT public.purchase_ticket(
      p_event_id,
      p_user_id,
      p_buyer_name,
      p_buyer_email,
      p_quantity,
      p_total_price,
      p_qr_code,
      p_ticket_type_id
    ) INTO v_result;
  ELSE
    SELECT public.purchase_ticket(
      p_event_id,
      p_user_id,
      p_buyer_name,
      p_buyer_email,
      p_quantity,
      p_total_price,
      p_qr_code
    ) INTO v_result;
  END IF;

  v_first_id := COALESCE(v_result->>'ticket_id', (v_result->'ticket_ids'->>0));

  UPDATE public.wallets
  SET balance = balance - p_total_price,
      updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (
    v_wallet.id,
    p_total_price,
    'debit',
    'Purchase ' || p_quantity || ' ticket(s)',
    NULLIF(v_first_id, '')::uuid
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_ticket_with_wallet(uuid, uuid, text, text, int, numeric, text, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

