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
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  v_first_id uuid;
  i integer;
  v_single_price numeric;
  v_has_ticket_type_table boolean;
  v_has_ticket_type_column boolean;
  v_has_qr_token boolean;
  v_has_ticket_status boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'Invalid total price';
  END IF;

  v_has_ticket_type_table := to_regclass('public.event_ticket_types') IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'ticket_type_id'
  ) INTO v_has_ticket_type_column;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'qr_token'
  ) INTO v_has_qr_token;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'ticket_status'
  ) INTO v_has_ticket_status;

  -- Wallet lock & balance check
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

  -- Event availability (lock row)
  SELECT available_tickets INTO v_event_available
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available in event';
  END IF;

  -- Ticket type availability (optional, lock row)
  IF p_ticket_type_id IS NOT NULL AND v_has_ticket_type_table THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id
    FOR UPDATE;

    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
      RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  v_single_price := p_total_price / p_quantity;
  v_ticket_ids := ARRAY[]::uuid[];

  -- Update event stats ONCE
  UPDATE public.events
  SET
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  -- Update ticket type stats ONCE (if supported)
  IF p_ticket_type_id IS NOT NULL AND v_has_ticket_type_table THEN
    UPDATE public.event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  -- Insert tickets in a loop (support older schemas via dynamic SQL)
  FOR i IN 1..p_quantity LOOP
    IF v_has_ticket_type_column AND p_ticket_type_id IS NOT NULL THEN
      IF v_has_qr_token AND v_has_ticket_status THEN
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code, ticket_type_id,
            qr_token, ticket_status, purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8, gen_random_uuid(), ''active'', now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i), p_ticket_type_id;
      ELSE
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code, ticket_type_id,
            purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i), p_ticket_type_id;
      END IF;
    ELSE
      IF v_has_qr_token AND v_has_ticket_status THEN
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code,
            qr_token, ticket_status, purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7, gen_random_uuid(), ''active'', now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i);
      ELSE
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code,
            purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7, now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i);
      END IF;
    END IF;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  v_first_id := v_ticket_ids[1];

  -- Deduct wallet
  UPDATE public.wallets
  SET balance = balance - p_total_price,
      updated_at = now()
  WHERE id = v_wallet.id;

  -- Record transaction
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (
    v_wallet.id,
    p_total_price,
    'debit',
    'Purchase ' || p_quantity || ' ticket(s)',
    v_first_id
  );

  RETURN json_build_object('ticket_ids', v_ticket_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_ticket_with_wallet(uuid, uuid, text, text, int, numeric, text, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

