CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(
  p_payment_intent_id text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_kind text;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_price_cents integer;
  v_event_available integer;
  v_ticket_type_available integer;
  v_single_price numeric;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_commission numeric;
  v_seller_amount numeric;
  v_seller_wallet public.wallets%ROWTYPE;
  v_ticket_ids uuid[];
  v_new_ticket_id uuid;
  v_vip_id uuid;
  v_vip public.reservados_vip%ROWTYPE;
  i integer;
BEGIN
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE stripe_payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Payment transaction not found';
  END IF;

  IF v_tx.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Payment does not belong to user';
  END IF;

  IF v_tx.status = 'fulfilled' THEN
    RETURN jsonb_build_object('fulfilled', true, 'kind', v_tx.kind);
  END IF;

  v_kind := v_tx.kind;

  IF v_kind = 'event_ticket' THEN
    v_event_id := (v_tx.metadata->>'event_id')::uuid;
    v_ticket_type_id := NULLIF(v_tx.metadata->>'ticket_type_id', '')::uuid;
    v_quantity := GREATEST((v_tx.metadata->>'quantity')::int, 1);

    SELECT available_tickets INTO v_event_available
    FROM public.events
    WHERE id = v_event_id
    FOR UPDATE;

    IF v_event_available IS NULL THEN
      RAISE EXCEPTION 'Event not found';
    END IF;

    IF v_event_available < v_quantity THEN
      RAISE EXCEPTION 'Not enough tickets available in event';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id AND event_id = v_event_id
      FOR UPDATE;

      IF v_ticket_type_available IS NULL OR v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available';
      END IF;
    END IF;

    IF v_ticket_type_id IS NULL THEN
      SELECT ROUND(e.ticket_price * 100)::int INTO v_price_cents
      FROM public.events e
      WHERE e.id = v_event_id;
    ELSE
      SELECT ROUND(t.price * 100)::int INTO v_price_cents
      FROM public.event_ticket_types t
      WHERE t.id = v_ticket_type_id AND t.event_id = v_event_id;
    END IF;

    IF v_price_cents IS NULL THEN
      RAISE EXCEPTION 'Pricing not found';
    END IF;

    IF (v_price_cents * v_quantity) <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch';
    END IF;

    UPDATE public.events
    SET
      available_tickets = available_tickets - v_quantity,
      sold_tickets = COALESCE(sold_tickets, 0) + v_quantity
    WHERE id = v_event_id;

    IF v_ticket_type_id IS NOT NULL THEN
      UPDATE public.event_ticket_types
      SET sold = COALESCE(sold, 0) + v_quantity
      WHERE id = v_ticket_type_id;
    END IF;

    v_single_price := (v_price_cents::numeric / 100);

    v_ticket_ids := ARRAY[]::uuid[];
    FOR i IN 1..v_quantity LOOP
      INSERT INTO public.tickets (
        event_id,
        user_id,
        buyer_name,
        buyer_email,
        qr_token,
        qr_code,
        ticket_type_id,
        total_price,
        status,
        ticket_status,
        payment_transaction_id,
        stripe_payment_intent_id
      )
      VALUES (
        v_event_id,
        p_user_id,
        COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
        COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
        gen_random_uuid(),
        gen_random_uuid()::text,
        v_ticket_type_id,
        v_single_price,
        'valid',
        'active',
        v_tx.id,
        v_tx.stripe_payment_intent_id
      )
      RETURNING id INTO v_new_ticket_id;

      v_ticket_ids := array_append(v_ticket_ids, v_new_ticket_id);
    END LOOP;

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', v_ticket_ids));
  ELSIF v_kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = (v_tx.metadata->>'listing_id')::uuid AND status = 'active'
    FOR UPDATE;

    IF v_listing IS NULL THEN
      RAISE EXCEPTION 'Listing not found or not active';
    END IF;

    IF v_listing.seller_id = p_user_id THEN
      RAISE EXCEPTION 'Cannot buy your own ticket';
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_listing.ticket_id
    FOR UPDATE;

    IF v_ticket IS NULL THEN
      RAISE EXCEPTION 'Ticket not found';
    END IF;

    IF v_ticket.ticket_status IS DISTINCT FROM 'reselling' AND v_ticket.status IS DISTINCT FROM 'resale' THEN
      RAISE EXCEPTION 'Ticket is not in resale state';
    END IF;

    IF v_listing.price < v_ticket.total_price THEN
      RAISE EXCEPTION 'Resale price cannot be lower than original price';
    END IF;

    IF v_listing.price > (v_ticket.total_price * 1.2) THEN
      RAISE EXCEPTION 'Resale price cannot exceed 120%% of original price';
    END IF;

    IF ROUND(v_listing.price * 100)::int <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch';
    END IF;

    SELECT * INTO v_seller_wallet
    FROM public.wallets
    WHERE user_id = v_listing.seller_id
    FOR UPDATE;

    IF v_seller_wallet IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (v_listing.seller_id, 0) RETURNING * INTO v_seller_wallet;
    END IF;

    v_commission := ROUND(v_listing.price * 0.12, 2);
    v_seller_amount := v_listing.price - v_commission;

    UPDATE public.wallets SET balance = balance + v_seller_amount WHERE id = v_seller_wallet.id;
    INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
    VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold ticket (less 12% commission)', v_listing.ticket_id);

    UPDATE public.tickets
    SET
      user_id = p_user_id,
      status = 'valid',
      ticket_status = 'active',
      qr_token = gen_random_uuid(),
      qr_code = gen_random_uuid()::text,
      transfer_count = COALESCE(transfer_count, 0) + 1,
      last_transferred_at = now(),
      payment_transaction_id = v_tx.id,
      stripe_payment_intent_id = v_tx.stripe_payment_intent_id
    WHERE id = v_listing.ticket_id;

    UPDATE public.resale_listings
    SET status = 'sold', updated_at = now()
    WHERE id = v_listing.id;

    INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount, payment_transaction_id, stripe_payment_intent_id)
    VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_user_id, v_listing.price, v_commission, v_seller_amount, v_tx.id, v_tx.stripe_payment_intent_id);

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'resale', jsonb_build_object('ticket_id', v_listing.ticket_id, 'listing_id', v_listing.id));
  ELSIF v_kind = 'vip_table' THEN
    v_vip_id := NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;
    IF v_vip_id IS NULL THEN
      v_vip_id := NULLIF(v_tx.metadata->>'reference_id', '')::uuid;
    END IF;
    IF v_vip_id IS NULL THEN
      RAISE EXCEPTION 'VIP not found';
    END IF;

    SELECT * INTO v_vip
    FROM public.reservados_vip
    WHERE id = v_vip_id
    FOR UPDATE;

    IF v_vip IS NULL THEN
      RAISE EXCEPTION 'VIP not found';
    END IF;

    IF COALESCE(v_vip.quantity_available, 0) < 1 THEN
      RAISE EXCEPTION 'VIP sold out';
    END IF;

    v_price_cents := ROUND(v_vip.base_price * 100)::int;
    IF v_price_cents <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch';
    END IF;

    UPDATE public.reservados_vip
    SET quantity_available = quantity_available - 1
    WHERE id = v_vip.id;

    v_single_price := (v_price_cents::numeric / 100);

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
      payment_transaction_id,
      stripe_payment_intent_id
    )
    VALUES (
      v_vip.event_id,
      p_user_id,
      COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
      COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
      GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
      gen_random_uuid(),
      gen_random_uuid()::text,
      NULL,
      v_single_price,
      'valid',
      'active',
      v_tx.id,
      v_tx.stripe_payment_intent_id
    )
    RETURNING id INTO v_new_ticket_id;

    v_ticket_ids := ARRAY[v_new_ticket_id];

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', v_ticket_ids));
  ELSIF v_kind = 'premium_feature' THEN
    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind);
  ELSE
    RAISE EXCEPTION 'Unsupported kind';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
