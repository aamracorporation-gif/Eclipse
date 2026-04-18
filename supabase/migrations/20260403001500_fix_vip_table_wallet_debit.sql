-- Allow hybrid wallet + card payments for vip_table

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
  v_wallet_debit_cents integer;
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
    WHERE id = v_event_id;

    IF v_event_available IS NULL THEN
      RAISE EXCEPTION 'Event not found';
    END IF;

    IF v_event_available < v_quantity THEN
      RAISE EXCEPTION 'Not enough tickets available';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT (quantity - COALESCE(sold, 0)) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id
      FOR UPDATE;

      IF v_ticket_type_available IS NULL THEN
        RAISE EXCEPTION 'Ticket type not found';
      END IF;

      IF v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Ticket type sold out';
      END IF;
    END IF;

    v_single_price := (v_tx.amount_cents::numeric / 100) / v_quantity;

    FOR i IN 1..v_quantity LOOP
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
        v_event_id,
        p_user_id,
        COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
        COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
        1,
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

    UPDATE public.events
    SET available_tickets = available_tickets - v_quantity
    WHERE id = v_event_id;

    IF v_ticket_type_id IS NOT NULL THEN
      UPDATE public.event_ticket_types
      SET sold = COALESCE(sold, 0) + v_quantity
      WHERE id = v_ticket_type_id;
    END IF;

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', v_ticket_ids));

  ELSIF v_kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid
    FOR UPDATE;

    IF v_listing IS NULL THEN
      RAISE EXCEPTION 'Listing not found';
    END IF;

    IF v_listing.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Listing not active';
    END IF;

    v_commission := ROUND((v_listing.price * 0.12)::numeric, 2);
    v_seller_amount := v_listing.price - v_commission;

    SELECT * INTO v_seller_wallet
    FROM public.wallets
    WHERE user_id = v_listing.seller_id
    FOR UPDATE;

    IF v_seller_wallet IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (v_listing.seller_id, 0) RETURNING * INTO v_seller_wallet;
    END IF;

    UPDATE public.wallets
    SET balance = balance + v_seller_amount
    WHERE id = v_seller_wallet.id;

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
    v_wallet_debit_cents := COALESCE(NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int, 0);
    IF v_wallet_debit_cents < 0 THEN
      v_wallet_debit_cents := 0;
    END IF;

    IF (v_tx.amount_cents + v_wallet_debit_cents) <> v_price_cents THEN
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

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', ARRAY[v_new_ticket_id]));
  END IF;

  RAISE EXCEPTION 'Not implemented';
END;
$$;

NOTIFY pgrst, 'reload schema';

