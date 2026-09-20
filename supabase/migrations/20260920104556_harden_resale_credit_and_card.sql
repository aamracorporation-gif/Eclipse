-- Resale hardening against invalid transfers and inconsistent balances.
-- Derived from production function definitions on 2026-09-20; review against live schema before deployment.
CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(p_listing_id uuid, p_buyer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_buyer public.user_credit%ROWTYPE;
  v_real numeric;
  v_promo numeric;
  v_remaining numeric;
  v_move numeric;
  v_reserve public.wallet_reserves%ROWTYPE;
  v_email text;
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_listing_id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;

  -- Same lock order as listing creation, cancellation and card fulfillment.
  SELECT t.* INTO v_ticket FROM public.tickets t
  WHERE t.id = (SELECT l.ticket_id FROM public.resale_listings l WHERE l.id = p_listing_id)
  FOR UPDATE;
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  SELECT * INTO v_listing FROM public.resale_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active'
     OR v_listing.ticket_id IS DISTINCT FROM v_ticket.id THEN
    RAISE EXCEPTION 'Listing not active';
  END IF;
  IF v_listing.seller_id = p_buyer_id THEN RAISE EXCEPTION 'Cannot buy own listing'; END IF;
  IF v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
     OR v_ticket.status IS DISTINCT FROM 'resale'
     OR v_ticket.ticket_status IS DISTINCT FROM 'reselling'
     OR v_ticket.validation_status IS DISTINCT FROM 'valid'
     OR v_ticket.payment_status IS DISTINCT FROM 'paid'
     OR v_ticket.wallet_added IS TRUE
     OR v_ticket.scanned_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ticket is not eligible for resale';
  END IF;
  PERFORM 1 FROM public.events e WHERE e.id = v_ticket.event_id
    AND e.allow_resale IS TRUE AND e.is_cancelled IS FALSE
    AND e.status = 'scheduled'
    AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Event unavailable for resale'; END IF;

  -- Lock both balances in a stable order to prevent two opposing sales deadlocking.
  INSERT INTO public.user_credit (user_id, balance_real, balance_promo)
  SELECT uid, 0, 0 FROM unnest(ARRAY[p_buyer_id, v_listing.seller_id]) AS uid
  ORDER BY uid ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_credit
  WHERE user_id IN (p_buyer_id, v_listing.seller_id)
  ORDER BY user_id FOR UPDATE;
  SELECT * INTO v_buyer FROM public.user_credit WHERE user_id = p_buyer_id;
  IF v_buyer.balance_real + v_buyer.balance_promo < v_listing.price THEN
    RAISE EXCEPTION 'Insufficient credit';
  END IF;

  v_real := LEAST(v_buyer.balance_real, v_listing.price);
  v_promo := v_listing.price - v_real;
  v_remaining := v_real;
  -- Real balance is backed by Stripe reserves; transfer its backing as well.
  FOR v_reserve IN SELECT * FROM public.wallet_reserves
    WHERE user_id = p_buyer_id AND status = 'pending' AND amount > 0
    ORDER BY created_at, id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_move := LEAST(v_remaining, v_reserve.amount);
    IF v_move = v_reserve.amount THEN
      UPDATE public.wallet_reserves SET user_id = v_listing.seller_id, updated_at = now()
      WHERE id = v_reserve.id;
    ELSE
      UPDATE public.wallet_reserves SET amount = amount - v_move, updated_at = now()
      WHERE id = v_reserve.id;
      INSERT INTO public.wallet_reserves (user_id, amount, stripe_payment_intent_id)
      VALUES (v_listing.seller_id, v_move, v_reserve.stripe_payment_intent_id);
    END IF;
    v_remaining := v_remaining - v_move;
  END LOOP;
  IF v_remaining > 0 THEN RAISE EXCEPTION 'Real credit lacks a payment reserve'; END IF;

  UPDATE public.user_credit SET balance_real = balance_real - v_real,
    balance_promo = balance_promo - v_promo, updated_at = now()
  WHERE user_id = p_buyer_id;
  UPDATE public.user_credit SET balance_real = balance_real + v_real,
    balance_promo = balance_promo + v_promo, updated_at = now()
  WHERE user_id = v_listing.seller_id;

  SELECT email, COALESCE(NULLIF(raw_user_meta_data->>'full_name',''), split_part(email,'@',1))
  INTO v_email, v_name FROM auth.users WHERE id = p_buyer_id;
  UPDATE public.tickets SET user_id = p_buyer_id, status = 'valid',
    ticket_status = 'active', qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text, short_code = NULL,
    wallet_added = false, wallet_pass_id = NULL,
    buyer_email = COALESCE(v_email, buyer_email),
    buyer_name = COALESCE(v_name, buyer_name),
    transfer_count = COALESCE(transfer_count,0) + 1,
    last_transferred_at = now()
  WHERE id = v_ticket.id;
  UPDATE public.resale_listings SET status = 'sold', updated_at = now() WHERE id = v_listing.id;
  INSERT INTO public.resale_transactions
    (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount)
  VALUES (v_listing.id, v_ticket.id, v_listing.seller_id, p_buyer_id,
          v_listing.price, 0, v_listing.price);
  INSERT INTO public.ledger_movimientos (tipo, usuario_id, importe, referencia_id, descripcion)
  VALUES ('compra_con_credito', p_buyer_id, -v_listing.price, v_listing.id::text, 'Compra de entrada de reventa'),
         ('generacion_credito_reventa', v_listing.seller_id, v_listing.price,
          v_listing.id::text, 'Venta de entrada de reventa');
  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket.id,
                             'event_id', COALESCE(v_ticket.event_id::text, ''));
END;
$function$;
REVOKE ALL ON FUNCTION public.buy_resale_ticket_with_credito(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_resale_listing_secure(p_ticket_id uuid, p_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_existing public.resale_listings%ROWTYPE;
  v_listing_id uuid;
  v_allow_resale boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_price IS NULL OR p_price <= 0 OR p_price <> round(p_price, 2) THEN
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

  PERFORM 1 FROM public.events e WHERE e.id = v_ticket.event_id
    AND e.allow_resale IS TRUE AND e.is_cancelled IS FALSE
    AND e.status = 'scheduled'
    AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Event unavailable for resale'; END IF;

  IF NOT COALESCE(v_allow_resale, true) THEN
    RAISE EXCEPTION 'Resale not allowed for this event';
  END IF;

  IF v_ticket.scanned_at IS NOT NULL
     OR v_ticket.status IS DISTINCT FROM 'valid'
     OR v_ticket.ticket_status IS DISTINCT FROM 'active'
     OR v_ticket.validation_status IS DISTINCT FROM 'valid'
     OR v_ticket.payment_status IS DISTINCT FROM 'paid'
     OR v_ticket.wallet_added IS TRUE THEN
    RAISE EXCEPTION 'Ticket is not eligible for resale';
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
$function$;
REVOKE ALL ON FUNCTION public.create_resale_listing_secure(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(p_payment_intent_id text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tx                    public.payment_transactions%ROWTYPE;
  v_kind                  text;
  v_event_id              uuid;
  v_ticket_type_id        uuid;
  v_quantity              integer;
  v_price_cents           integer;
  v_original_total_cents  integer;
  v_discount_amount_cents integer;
  v_service_fee_cents     integer;
  v_credit_debit_cents    integer;
  v_expected_amount_cents integer;
  v_event_available       integer;
  v_ticket_type_available integer;
  v_single_price          numeric;
  v_listing               public.resale_listings%ROWTYPE;
  v_ticket                public.tickets%ROWTYPE;
  v_commission            numeric;
  v_seller_amount         numeric;
  v_seller_wallet         public.wallets%ROWTYPE;
  v_buyer_wallet          public.wallets%ROWTYPE;
  v_ticket_ids            uuid[];
  -- Nuevas variables para el sistema de crédito unificado
  v_uc_row                public.user_credit%ROWTYPE;
  v_credit_amount         numeric;
  v_real_to_use           numeric;
  v_promo_to_use          numeric;
  v_remaining             numeric;
  v_reserve               RECORD;
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

  -- ── EVENT TICKET ────────────────────────────────────────────────────────────
  IF v_kind = 'event_ticket' THEN
    v_event_id       := (v_tx.metadata->>'event_id')::uuid;
    v_ticket_type_id := NULLIF(v_tx.metadata->>'ticket_type_id', '')::uuid;
    v_quantity       := GREATEST((v_tx.metadata->>'quantity')::int, 1);

    SELECT available_tickets INTO v_event_available
    FROM public.events WHERE id = v_event_id FOR UPDATE;

    IF v_event_available IS NULL THEN
      RAISE EXCEPTION 'Event not found';
    END IF;
    IF v_event_available < v_quantity THEN
      RAISE EXCEPTION 'Not enough tickets available in event';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id AND event_id = v_event_id FOR UPDATE;

      IF v_ticket_type_available IS NULL OR v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available';
      END IF;
    END IF;

    IF v_ticket_type_id IS NULL THEN
      SELECT ROUND(e.ticket_price * 100)::int INTO v_price_cents
      FROM public.events e WHERE e.id = v_event_id;
    ELSE
      SELECT ROUND(t.price * 100)::int INTO v_price_cents
      FROM public.event_ticket_types t
      WHERE t.id = v_ticket_type_id AND t.event_id = v_event_id;
    END IF;

    IF v_price_cents IS NULL THEN
      RAISE EXCEPTION 'Pricing not found';
    END IF;

    v_original_total_cents  := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int,
                                        v_price_cents * v_quantity);
    v_discount_amount_cents := COALESCE(NULLIF(v_tx.metadata->>'discount_amount_cents', '')::int, 0);
    v_service_fee_cents     := COALESCE(NULLIF(v_tx.metadata->>'service_fee_cents', '')::int, 0);
    v_credit_debit_cents    := COALESCE(
                                NULLIF(v_tx.metadata->>'credit_debit_cents', '')::int,
                                NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int,
                                0);
    IF v_credit_debit_cents    < 0 THEN v_credit_debit_cents    := 0; END IF;
    IF v_discount_amount_cents < 0 THEN v_discount_amount_cents := 0; END IF;

    -- original_total_cents must still match DB price × qty (audit check, pre-discount)
    IF (v_price_cents * v_quantity) <> v_original_total_cents THEN
      RAISE EXCEPTION 'Amount mismatch: ticket_price*qty=% original_total_cents=%',
        (v_price_cents * v_quantity), v_original_total_cents;
    END IF;

    -- Amount check accounts for discount: buyer paid (original - discount + fee - credit)
    v_expected_amount_cents := v_original_total_cents - v_discount_amount_cents + v_service_fee_cents - v_credit_debit_cents;
    IF v_expected_amount_cents <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch: expected=% got=% (original=% discount=% fee=% credit=%)',
        v_expected_amount_cents, v_tx.amount_cents,
        v_original_total_cents, v_discount_amount_cents, v_service_fee_cents, v_credit_debit_cents;
    END IF;

    -- Debitar crédito del sistema unificado
    IF v_credit_debit_cents > 0 THEN
      v_credit_amount := v_credit_debit_cents::numeric / 100;

      SELECT * INTO v_uc_row FROM public.user_credit WHERE user_id = p_user_id FOR UPDATE;
      IF v_uc_row IS NULL THEN
        RAISE EXCEPTION 'Insufficient credit balance (no user_credit row)';
      END IF;

      -- Gastar balance_real primero (respaldado por Stripe), luego balance_promo
      v_real_to_use  := LEAST(v_uc_row.balance_real, v_credit_amount);
      v_promo_to_use := v_credit_amount - v_real_to_use;

      IF v_promo_to_use > v_uc_row.balance_promo THEN
        RAISE EXCEPTION 'Insufficient credit balance: needed=% real=% promo=%',
          v_credit_amount, v_uc_row.balance_real, v_uc_row.balance_promo;
      END IF;

      UPDATE public.user_credit
      SET balance_real  = balance_real  - v_real_to_use,
          balance_promo = balance_promo - v_promo_to_use,
          updated_at    = now()
      WHERE user_id = p_user_id;

      -- Marcar reservas como 'consumed' en orden FIFO
      IF v_real_to_use > 0 THEN
        v_remaining := v_real_to_use;
        FOR v_reserve IN
          SELECT * FROM public.wallet_reserves
          WHERE user_id = p_user_id AND status = 'pending'
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          EXIT WHEN v_remaining <= 0;
          IF v_reserve.amount <= v_remaining THEN
            UPDATE public.wallet_reserves
            SET status = 'consumed', consumed_by_stripe_pi = p_payment_intent_id, updated_at = now()
            WHERE id = v_reserve.id;
            v_remaining := v_remaining - v_reserve.amount;
          ELSE
            -- Dividir la reserva: parte consumida, parte pendiente
            UPDATE public.wallet_reserves
            SET amount = amount - v_remaining, updated_at = now()
            WHERE id = v_reserve.id;
            INSERT INTO public.wallet_reserves
              (user_id, amount, stripe_payment_intent_id, status, consumed_by_stripe_pi)
            VALUES
              (p_user_id, v_remaining, v_reserve.stripe_payment_intent_id, 'consumed', p_payment_intent_id);
            v_remaining := 0;
          END IF;
        END LOOP;
      END IF;

      -- Backward-compat: también debitar wallets legacy
      SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
      IF v_buyer_wallet IS NOT NULL AND v_buyer_wallet.balance > 0 THEN
        UPDATE public.wallets
        SET balance    = GREATEST(0, balance - v_real_to_use),
            updated_at = now()
        WHERE id = v_buyer_wallet.id;
      END IF;
      IF v_buyer_wallet IS NOT NULL THEN
        INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
        VALUES (v_buyer_wallet.id, v_credit_amount, 'debit', 'Compra de entrada (saldo)', v_event_id);
      END IF;
    END IF;

    UPDATE public.events
    SET available_tickets = available_tickets - v_quantity,
        sold_tickets = COALESCE(sold_tickets, 0) + v_quantity
    WHERE id = v_event_id;

    IF v_ticket_type_id IS NOT NULL THEN
      UPDATE public.event_ticket_types
      SET sold = COALESCE(sold, 0) + v_quantity
      WHERE id = v_ticket_type_id;
    END IF;

    v_single_price := (v_price_cents::numeric / 100);
    v_ticket_ids   := ARRAY[]::uuid[];

    FOR i IN 1..v_quantity LOOP
      INSERT INTO public.tickets (
        event_id, user_id, buyer_name, buyer_email,
        qr_token, qr_code, ticket_type_id, total_price,
        status, ticket_status, payment_transaction_id, stripe_payment_intent_id
      ) VALUES (
        v_event_id, p_user_id,
        COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
        COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
        gen_random_uuid(), gen_random_uuid()::text,
        v_ticket_type_id, v_single_price,
        'valid', 'active', v_tx.id, v_tx.stripe_payment_intent_id
      )
      RETURNING id INTO v_ticket;
      v_ticket_ids := array_append(v_ticket_ids, v_ticket.id);
    END LOOP;

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind,
      'tickets', jsonb_build_object('ids', v_ticket_ids));

  -- ── RESALE TICKET ──────────────────────────────────────────────────────────
  ELSIF v_kind = 'resale_ticket' THEN
    -- All resale operations lock ticket before listing, including cancellation.
    SELECT t.* INTO v_ticket FROM public.tickets t
    WHERE t.id = (SELECT l.ticket_id FROM public.resale_listings l
                  WHERE l.id = (v_tx.metadata->>'listing_id')::uuid)
    FOR UPDATE;
    IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

    SELECT * INTO v_listing FROM public.resale_listings
    WHERE id = (v_tx.metadata->>'listing_id')::uuid FOR UPDATE;
    IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active'
       OR v_listing.ticket_id IS DISTINCT FROM v_ticket.id THEN
      RAISE EXCEPTION 'Listing not found or not active';
    END IF;
    IF v_listing.seller_id = p_user_id THEN RAISE EXCEPTION 'Cannot buy your own ticket'; END IF;
    IF v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
       OR v_ticket.ticket_status IS DISTINCT FROM 'reselling'
       OR v_ticket.status IS DISTINCT FROM 'resale'
       OR v_ticket.validation_status IS DISTINCT FROM 'valid'
       OR v_ticket.payment_status IS DISTINCT FROM 'paid'
       OR v_ticket.wallet_added IS TRUE
       OR v_ticket.scanned_at IS NOT NULL THEN
      RAISE EXCEPTION 'Ticket is not eligible for resale';
    END IF;
    PERFORM 1 FROM public.events e WHERE e.id = v_ticket.event_id
      AND e.allow_resale IS TRUE AND e.is_cancelled IS FALSE
      AND e.status = 'scheduled'
      AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'Event unavailable for resale'; END IF;

    v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int,
                                       ROUND(v_listing.price * 100)::int);
    v_service_fee_cents    := COALESCE(NULLIF(v_tx.metadata->>'service_fee_cents', '')::int, 0);

    IF ROUND(v_listing.price * 100)::int <> v_original_total_cents THEN
      RAISE EXCEPTION 'Amount mismatch: listing_price=% original_total_cents=%',
        ROUND(v_listing.price * 100)::int, v_original_total_cents;
    END IF;

    v_expected_amount_cents := v_original_total_cents + v_service_fee_cents;
    IF v_expected_amount_cents <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch: expected=% got=%', v_expected_amount_cents, v_tx.amount_cents;
    END IF;

    v_commission    := 0;
    v_seller_amount := v_listing.price - v_commission;

    -- Acreditar al vendedor en user_credit (balance_real, respaldado por este PI)
    INSERT INTO public.user_credit (user_id, balance_real, balance_promo)
    VALUES (v_listing.seller_id, v_seller_amount, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET balance_real = public.user_credit.balance_real + v_seller_amount,
          updated_at   = now();

    -- Crear reserva explícita que vincula el crédito al PaymentIntent de Stripe
    INSERT INTO public.wallet_reserves (user_id, amount, stripe_payment_intent_id)
    VALUES (v_listing.seller_id, v_seller_amount, p_payment_intent_id);

    -- Backward-compat: también actualizar wallets legacy
    SELECT * INTO v_seller_wallet FROM public.wallets WHERE user_id = v_listing.seller_id FOR UPDATE;
    IF v_seller_wallet IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (v_listing.seller_id, 0) RETURNING * INTO v_seller_wallet;
    END IF;
    UPDATE public.wallets SET balance = balance + v_seller_amount WHERE id = v_seller_wallet.id;
    INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
    VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold resale ticket', v_listing.ticket_id);

    -- Transferir la entrada al comprador
    UPDATE public.tickets
    SET user_id = p_user_id, status = 'valid', ticket_status = 'active',
        qr_token = gen_random_uuid(), qr_code = gen_random_uuid()::text,
        short_code = NULL, wallet_added = false, wallet_pass_id = NULL,
        buyer_name = COALESCE(NULLIF(v_tx.metadata->>'buyer_name',''), buyer_name),
        buyer_email = COALESCE(NULLIF(v_tx.metadata->>'buyer_email',''), buyer_email),
        transfer_count = COALESCE(transfer_count, 0) + 1,
        last_transferred_at = now(),
        payment_transaction_id = v_tx.id,
        stripe_payment_intent_id = v_tx.stripe_payment_intent_id
    WHERE id = v_listing.ticket_id;

    UPDATE public.resale_listings SET status = 'sold', updated_at = now() WHERE id = v_listing.id;

    INSERT INTO public.resale_transactions
      (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount, payment_transaction_id, stripe_payment_intent_id)
    VALUES
      (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_user_id,
       v_listing.price, v_commission, v_seller_amount, v_tx.id, v_tx.stripe_payment_intent_id);

    INSERT INTO public.ledger_movimientos (tipo, usuario_id, importe, referencia_id, descripcion)
    VALUES ('generacion_credito_reventa', v_listing.seller_id, v_seller_amount,
            v_listing.id::text, 'Venta de entrada de reventa');

    UPDATE public.payment_transactions SET status = 'fulfilled', fulfilled_at = now() WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind,
      'resale', jsonb_build_object('ticket_id', v_listing.ticket_id, 'listing_id', v_listing.id));

  -- ── VIP / PREMIUM ──────────────────────────────────────────────────────────
  ELSIF v_kind IN ('vip_table', 'premium_feature') THEN
    v_credit_debit_cents := COALESCE(
                              NULLIF(v_tx.metadata->>'credit_debit_cents', '')::int,
                              NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int,
                              0);
    IF v_credit_debit_cents < 0 THEN v_credit_debit_cents := 0; END IF;

    v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int,
                                       v_tx.amount_cents + v_credit_debit_cents);
    v_service_fee_cents    := COALESCE(NULLIF(v_tx.metadata->>'service_fee_cents', '')::int, 0);

    v_expected_amount_cents := v_original_total_cents + v_service_fee_cents - v_credit_debit_cents;
    IF v_expected_amount_cents <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch: expected=% got=%', v_expected_amount_cents, v_tx.amount_cents;
    END IF;

    IF v_credit_debit_cents > 0 THEN
      v_credit_amount := v_credit_debit_cents::numeric / 100;

      SELECT * INTO v_uc_row FROM public.user_credit WHERE user_id = p_user_id FOR UPDATE;
      IF v_uc_row IS NULL THEN
        RAISE EXCEPTION 'Insufficient credit balance (no user_credit row)';
      END IF;

      v_real_to_use  := LEAST(v_uc_row.balance_real, v_credit_amount);
      v_promo_to_use := v_credit_amount - v_real_to_use;

      IF v_promo_to_use > v_uc_row.balance_promo THEN
        RAISE EXCEPTION 'Insufficient credit balance: needed=% real=% promo=%',
          v_credit_amount, v_uc_row.balance_real, v_uc_row.balance_promo;
      END IF;

      UPDATE public.user_credit
      SET balance_real  = balance_real  - v_real_to_use,
          balance_promo = balance_promo - v_promo_to_use,
          updated_at    = now()
      WHERE user_id = p_user_id;

      IF v_real_to_use > 0 THEN
        v_remaining := v_real_to_use;
        FOR v_reserve IN
          SELECT * FROM public.wallet_reserves
          WHERE user_id = p_user_id AND status = 'pending'
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          EXIT WHEN v_remaining <= 0;
          IF v_reserve.amount <= v_remaining THEN
            UPDATE public.wallet_reserves
            SET status = 'consumed', consumed_by_stripe_pi = p_payment_intent_id, updated_at = now()
            WHERE id = v_reserve.id;
            v_remaining := v_remaining - v_reserve.amount;
          ELSE
            UPDATE public.wallet_reserves
            SET amount = amount - v_remaining, updated_at = now()
            WHERE id = v_reserve.id;
            INSERT INTO public.wallet_reserves
              (user_id, amount, stripe_payment_intent_id, status, consumed_by_stripe_pi)
            VALUES
              (p_user_id, v_remaining, v_reserve.stripe_payment_intent_id, 'consumed', p_payment_intent_id);
            v_remaining := 0;
          END IF;
        END LOOP;
      END IF;

      SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
      IF v_buyer_wallet IS NOT NULL AND v_buyer_wallet.balance > 0 THEN
        UPDATE public.wallets
        SET balance    = GREATEST(0, balance - v_real_to_use),
            updated_at = now()
        WHERE id = v_buyer_wallet.id;
      END IF;
      IF v_buyer_wallet IS NOT NULL THEN
        INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
        VALUES (
          v_buyer_wallet.id, v_credit_amount, 'debit',
          CASE WHEN v_kind = 'vip_table' THEN 'Compra VIP (saldo)' ELSE 'Compra (saldo)' END,
          CASE WHEN (v_tx.metadata->>'event_id') ~* '^[0-9a-f-]{36}$'
               THEN (v_tx.metadata->>'event_id')::uuid ELSE NULL END
        );
      END IF;
    END IF;

    UPDATE public.payment_transactions SET status = 'fulfilled', fulfilled_at = now() WHERE id = v_tx.id;
    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind);

  ELSE
    RAISE EXCEPTION 'Unsupported kind: %', v_kind;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text,uuid) TO service_role;

-- Once ownership changes, an old ticket ID cannot act as a scannable QR.
CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v3(p_qr_token text, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_owner_name text;
  v_ticket_type_name text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_event_id IS NULL OR nullif(btrim(p_qr_token), '') IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Solicitud inválida');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Evento no encontrado'); END IF;
  IF v_event.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE event_id = p_event_id
    AND (qr_token::text = p_qr_token OR qr_code = p_qr_token OR (id::text = p_qr_token AND COALESCE(transfer_count, 0) = 0) OR short_code = upper(p_qr_token))
  LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada'); END IF;
  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA EN REVENTA - NO VÁLIDA', 'event_id', p_event_id);
  END IF;
  IF v_ticket.ticket_status = 'invalidated' OR v_ticket.status = 'cancelled' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA INVALIDADA', 'event_id', p_event_id);
  END IF;
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status = 'used' OR v_ticket.status = 'used' OR v_ticket.ticket_status = 'used' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ESTA ENTRADA YA FUE ESCANEADA', 'event_id', p_event_id, 'scanned_at', v_ticket.scanned_at);
  END IF;

  SELECT full_name INTO v_owner_name FROM public.profiles WHERE id = v_ticket.user_id;
  SELECT name INTO v_ticket_type_name FROM public.event_ticket_types WHERE id = v_ticket.ticket_type_id;
  UPDATE public.tickets SET scanned_at=v_now, validation_status='used', ticket_status='used', status='used' WHERE id=v_ticket.id;
  RETURN jsonb_build_object('valid', true, 'message', 'ACCESO AUTORIZADO', 'event_id', p_event_id,
    'attendee_name', coalesce(nullif(v_ticket.attendee_name,''), nullif(v_ticket.buyer_name,''), v_owner_name, 'Desconocido'),
    'ticket_type', coalesce(v_ticket_type_name, nullif(v_ticket.ticket_type,''), 'General'), 'scanned_at', v_now);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_ticket_worker_v2(p_qr_token text, p_worker_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_owner_name text;
  v_ticket_type_name text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_worker FROM public.workers
   WHERE id=p_worker_id
     AND user_id=auth.uid()
     AND status='active'
     AND (
       permissions ? 'scan'
       OR lower(coalesce(permissions->>'scan', 'false')) = 'true'
     );
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker not found, inactive, or scan permission denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.worker_event_assignments WHERE worker_id=v_worker.id AND event_id=p_event_id AND status='active') THEN
    RAISE EXCEPTION 'Worker is not assigned to this event' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND creator_id=v_worker.organizer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA DE OTRO ORGANIZADOR'); END IF;

  SELECT * INTO v_ticket FROM public.tickets
   WHERE event_id=p_event_id AND (qr_token::text=p_qr_token OR qr_code=p_qr_token OR (id::text=p_qr_token AND COALESCE(transfer_count,0)=0) OR short_code=upper(p_qr_token))
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada'); END IF;
  IF v_ticket.ticket_status='reselling' OR v_ticket.status='resale' THEN RETURN jsonb_build_object('valid',false,'message','ENTRADA EN REVENTA - NO VÁLIDA','event_id',p_event_id); END IF;
  IF v_ticket.ticket_status='invalidated' OR v_ticket.status='cancelled' THEN RETURN jsonb_build_object('valid',false,'message','ENTRADA INVALIDADA','event_id',p_event_id); END IF;
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status='used' OR v_ticket.status='used' OR v_ticket.ticket_status='used' THEN
    RETURN jsonb_build_object('valid',false,'message','ESTA ENTRADA YA FUE ESCANEADA','event_id',p_event_id,'scanned_at',v_ticket.scanned_at);
  END IF;
  SELECT full_name INTO v_owner_name FROM public.profiles WHERE id=v_ticket.user_id;
  SELECT name INTO v_ticket_type_name FROM public.event_ticket_types WHERE id=v_ticket.ticket_type_id;
  UPDATE public.tickets SET scanned_at=v_now, validation_status='used', ticket_status='used', status='used', scanned_by_worker_id=v_worker.id WHERE id=v_ticket.id;
  RETURN jsonb_build_object('valid',true,'message','ACCESO AUTORIZADO','event_id',p_event_id,
    'attendee_name',coalesce(nullif(v_ticket.attendee_name,''),nullif(v_ticket.buyer_name,''),v_owner_name,'Desconocido'),
    'ticket_type',coalesce(v_ticket_type_name,nullif(v_ticket.ticket_type,''),'General'),'scanned_at',v_now);
END;
$function$
;
