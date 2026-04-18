CREATE OR REPLACE FUNCTION buy_vip_with_wallet(
  p_vip_reservado_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_vip reservados_vip%ROWTYPE;
  v_ticket_id uuid;
  v_price numeric;
BEGIN
  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id
  FOR UPDATE;

  IF v_vip IS NULL THEN
    RAISE EXCEPTION 'VIP not found';
  END IF;

  IF COALESCE(v_vip.quantity_available, 0) < 1 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  v_price := COALESCE(v_vip.base_price, 0);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING * INTO v_wallet;
  END IF;

  IF v_wallet.balance < v_price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - 1
  WHERE id = v_vip.id;

  INSERT INTO public.tickets (
    event_id,
    user_id,
    buyer_name,
    buyer_email,
    quantity,
    qr_token,
    qr_code,
    ticket_type_id,
    total_price,
    status,
    ticket_status,
    purchase_date
  )
  VALUES (
    v_vip.event_id,
    p_user_id,
    COALESCE(NULLIF(p_buyer_name, ''), 'Comprador'),
    COALESCE(NULLIF(p_buyer_email, ''), 'sin-email'),
    GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
    gen_random_uuid(),
    gen_random_uuid()::text,
    NULL,
    v_price,
    'valid',
    'active',
    now()
  )
  RETURNING id INTO v_ticket_id;

  UPDATE public.wallets
  SET balance = balance - v_price, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_wallet.id, v_price, 'debit', 'Compra reservado VIP', v_ticket_id);

  RETURN json_build_object('ticket_id', v_ticket_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
