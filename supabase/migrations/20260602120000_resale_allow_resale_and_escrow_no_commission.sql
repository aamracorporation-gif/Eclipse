-- 1) Add allow_resale flag to events (default true)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'allow_resale'
  ) THEN
    ALTER TABLE public.events
      ADD COLUMN allow_resale boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- 2) Platform escrow tracking (backs Eclipse Credit)
CREATE TABLE IF NOT EXISTS public.platform_escrow_balances (
  key text PRIMARY KEY,
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_escrow_balances(key, balance_cents)
VALUES ('eclipse_credit_backing', 0)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_platform_escrow_exists(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.platform_escrow_balances(key, balance_cents, updated_at)
  VALUES (p_key, 0, now())
  ON CONFLICT (key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_platform_escrow_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_platform_escrow_exists(text) TO service_role;

-- 3) apply_credito_delta now also updates escrow backing
CREATE OR REPLACE FUNCTION public.apply_credito_delta(
  p_usuario_id uuid,
  p_delta numeric,
  p_tipo public.ledger_movimiento_tipo,
  p_referencia_id text,
  p_descripcion text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit public.creditos_usuario%ROWTYPE;
  v_new_balance numeric;
  v_delta_cents bigint;
  v_key text := 'eclipse_credit_backing';
  v_escrow public.platform_escrow_balances%ROWTYPE;
BEGIN
  PERFORM public.ensure_credito_usuario_exists(p_usuario_id);
  PERFORM public.ensure_platform_escrow_exists(v_key);

  SELECT * INTO v_credit
  FROM public.creditos_usuario
  WHERE usuario_id = p_usuario_id
  FOR UPDATE;

  v_new_balance := ROUND((v_credit.saldo_credito + p_delta)::numeric, 2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credit';
  END IF;

  UPDATE public.creditos_usuario
  SET saldo_credito = v_new_balance
  WHERE id = v_credit.id;

  v_delta_cents := ROUND((COALESCE(p_delta, 0)::numeric * 100)::numeric, 0)::bigint;

  SELECT * INTO v_escrow
  FROM public.platform_escrow_balances
  WHERE key = v_key
  FOR UPDATE;

  IF p_tipo = 'generacion_credito_reventa' AND v_delta_cents > 0 THEN
    UPDATE public.platform_escrow_balances
    SET balance_cents = balance_cents + v_delta_cents,
        updated_at = now()
    WHERE key = v_key;
  ELSIF p_tipo = 'compra_con_credito' AND v_delta_cents < 0 THEN
    IF v_escrow.balance_cents < (-v_delta_cents) THEN
      RAISE EXCEPTION 'Insufficient escrow backing';
    END IF;
    UPDATE public.platform_escrow_balances
    SET balance_cents = balance_cents + v_delta_cents,
        updated_at = now()
    WHERE key = v_key;
  END IF;

  PERFORM public.record_ledger_movimiento(p_tipo, p_usuario_id, NULL, p_delta, p_referencia_id, p_descripcion);

  RETURN jsonb_build_object('saldo_credito', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) TO service_role;

-- 4) Enforce allow_resale on listing creation
CREATE OR REPLACE FUNCTION public.create_resale_listing_secure(
  p_ticket_id uuid,
  p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_existing public.resale_listings%ROWTYPE;
  v_listing_id uuid;
  v_allow_resale boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Invalid resale price';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not the ticket owner';
  END IF;

  SELECT COALESCE(e.allow_resale, true) INTO v_allow_resale
  FROM public.events e
  WHERE e.id = v_ticket.event_id;

  IF NOT COALESCE(v_allow_resale, true) THEN
    RAISE EXCEPTION 'Resale not allowed for this event';
  END IF;

  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' OR v_ticket.validation_status = 'used' OR v_ticket.ticket_status = 'used' THEN
    RAISE EXCEPTION 'Ticket already used';
  END IF;

  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RAISE EXCEPTION 'Ticket already in resale';
  END IF;

  IF v_ticket.total_price IS NOT NULL THEN
    IF p_price < v_ticket.total_price THEN
      RAISE EXCEPTION 'Resale price cannot be lower than original price';
    END IF;

    IF p_price > (v_ticket.total_price * 1.2) THEN
      RAISE EXCEPTION 'Resale price cannot exceed 120%% of original price';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.resale_listings
  WHERE ticket_id = p_ticket_id AND status = 'active'
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Active resale listing already exists';
  END IF;

  UPDATE public.tickets
  SET status = 'resale',
      ticket_status = 'reselling'
  WHERE id = p_ticket_id;

  INSERT INTO public.resale_listings (ticket_id, seller_id, price, status, created_at, updated_at)
  VALUES (p_ticket_id, auth.uid(), p_price, 'active', now(), now())
  ON CONFLICT (ticket_id) DO UPDATE
  SET
    seller_id = EXCLUDED.seller_id,
    price = EXCLUDED.price,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('listing_id', v_listing_id, 'ticket_id', p_ticket_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_resale_listing_secure(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid, numeric) TO authenticated;

-- 5) Resale with credit: no platform commission; enforce allow_resale
CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_seller_amount numeric;
  v_allow_resale boolean;
  v_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Listing not active';
  END IF;

  IF v_listing.seller_id IS DISTINCT FROM NULL AND v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy own listing';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_listing.ticket_id;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_ticket.event_id;

  v_allow_resale := COALESCE(v_event.allow_resale, true);
  IF NOT v_allow_resale THEN
    RAISE EXCEPTION 'Resale not allowed for this event';
  END IF;

  v_seller_amount := ROUND((v_listing.price)::numeric, 2);

  PERFORM public.apply_credito_delta(p_buyer_id, -ROUND(v_listing.price::numeric, 2), 'compra_con_credito', p_listing_id::text, 'Compra reventa con crédito (sin Stripe)');
  PERFORM public.apply_credito_delta(v_listing.seller_id, v_seller_amount, 'generacion_credito_reventa', p_listing_id::text, 'Crédito generado por reventa');

  UPDATE public.tickets
  SET
    user_id = p_buyer_id,
    status = 'valid',
    ticket_status = 'active',
    qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text,
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now()
  WHERE id = v_listing.ticket_id;

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = v_listing.id;

  INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount)
  VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_buyer_id, v_listing.price, 0, v_seller_amount);

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_buyer_id::text, ''),
    'seller_id', COALESCE(v_listing.seller_id::text, ''),
    'event_id', COALESCE(v_ticket.event_id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'quantity', '1',
    'ticket_id', COALESCE(v_listing.ticket_id::text, ''),
    'listing_id', COALESCE(v_listing.id::text, ''),
    'payment_intent_id', ''
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM p_buyer_id THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'RESALE_SUCCESS', v_data);
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'resale_sold', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing.id, 'ticket_id', v_listing.ticket_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid, uuid) TO authenticated;

-- 6) Resale with card (fulfillment): no platform commission; enforce allow_resale
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
  v_seller_amount numeric;
  v_ticket_ids uuid[];
  v_new_ticket_id uuid;
  v_vip_id uuid;
  v_vip public.reservados_vip%ROWTYPE;
  v_credit_debit_cents integer;
  v_original_total_cents integer;
  v_credit_debit numeric;
  v_allow_resale boolean;
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
  v_credit_debit_cents := COALESCE(NULLIF(v_tx.metadata->>'credit_debit_cents', '')::int, NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int, 0);
  IF v_credit_debit_cents < 0 THEN v_credit_debit_cents := 0; END IF;
  v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int, v_tx.amount_cents + v_credit_debit_cents);

  IF (v_tx.amount_cents + v_credit_debit_cents) <> v_original_total_cents THEN
    RAISE EXCEPTION 'Amount mismatch';
  END IF;

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
      RAISE EXCEPTION 'Not enough tickets available';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT (quantity - COALESCE(sold, 0)) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id AND event_id = v_event_id
      FOR UPDATE;

      IF v_ticket_type_available IS NULL OR v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Ticket type sold out';
      END IF;
    END IF;

    IF v_credit_debit_cents > 0 THEN
      v_credit_debit := ROUND((v_credit_debit_cents::numeric / 100)::numeric, 2);
      PERFORM public.apply_credito_delta(p_user_id, -v_credit_debit, 'compra_con_credito', p_payment_intent_id, 'Compra con crédito');
    END IF;

    IF v_tx.amount_cents > 0 THEN
      PERFORM public.record_ledger_movimiento('compra_normal', p_user_id, NULL, ROUND((v_tx.amount_cents::numeric / 100)::numeric, 2), p_payment_intent_id, 'Compra con tarjeta');
    END IF;

    v_single_price := ROUND(((v_original_total_cents::numeric / 100)::numeric / v_quantity)::numeric, 2);

    v_ticket_ids := ARRAY[]::uuid[];
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
    SET available_tickets = available_tickets - v_quantity,
        sold_tickets = COALESCE(sold_tickets, 0) + v_quantity
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

    IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Listing not active';
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_listing.ticket_id;

    IF v_ticket.id IS NULL THEN
      RAISE EXCEPTION 'Ticket not found';
    END IF;

    SELECT COALESCE(e.allow_resale, true) INTO v_allow_resale
    FROM public.events e
    WHERE e.id = v_ticket.event_id;

    IF NOT COALESCE(v_allow_resale, true) THEN
      RAISE EXCEPTION 'Resale not allowed for this event';
    END IF;

    v_seller_amount := ROUND((v_listing.price)::numeric, 2);

    PERFORM public.apply_credito_delta(v_listing.seller_id, v_seller_amount, 'generacion_credito_reventa', p_payment_intent_id, 'Crédito generado por reventa');

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
    VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_user_id, v_listing.price, 0, v_seller_amount, v_tx.id, v_tx.stripe_payment_intent_id);

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

    IF v_vip IS NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
      RAISE EXCEPTION 'VIP sold out';
    END IF;

    v_price_cents := ROUND(v_vip.base_price * 100)::int;

    IF v_original_total_cents <> v_price_cents THEN
      RAISE EXCEPTION 'Amount mismatch';
    END IF;

    IF v_credit_debit_cents > 0 THEN
      v_credit_debit := ROUND((v_credit_debit_cents::numeric / 100)::numeric, 2);
      PERFORM public.apply_credito_delta(p_user_id, -v_credit_debit, 'compra_con_credito', p_payment_intent_id, 'Compra VIP con crédito');
    END IF;

    IF v_tx.amount_cents > 0 THEN
      PERFORM public.record_ledger_movimiento('compra_normal', p_user_id, NULL, ROUND((v_tx.amount_cents::numeric / 100)::numeric, 2), p_payment_intent_id, 'Compra VIP con tarjeta');
    END IF;

    UPDATE public.reservados_vip
    SET quantity_available = quantity_available - 1
    WHERE id = v_vip.id;

    v_single_price := ROUND((v_price_cents::numeric / 100)::numeric, 2);

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

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
