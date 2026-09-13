-- Reescritura de fulfill_payment_for_user con soporte de reservas explícitas.
--
-- Cambios respecto a la versión anterior:
--
--   event_ticket  (crédito usado):
--     - Debita user_credit.balance_real primero, luego balance_promo.
--     - Marca wallet_reserves como 'consumed' en orden FIFO; divide si necesario.
--     - Mantiene escritura en wallets (backward-compat) para lecturas legacy.
--
--   resale_ticket (crédito ganado):
--     - Acredita user_credit.balance_real al vendedor.
--     - Inserta wallet_reserve vinculando el crédito al stripe_payment_intent.
--     - Mantiene escritura en wallets (backward-compat).
--
--   vip_table / premium_feature (crédito usado):
--     - Igual que event_ticket para la parte de crédito.

CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(
  p_payment_intent_id text,
  p_user_id           uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx                    public.payment_transactions%ROWTYPE;
  v_kind                  text;
  v_event_id              uuid;
  v_ticket_type_id        uuid;
  v_quantity              integer;
  v_price_cents           integer;
  v_original_total_cents  integer;
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

    v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int,
                                       v_price_cents * v_quantity);
    v_service_fee_cents    := COALESCE(NULLIF(v_tx.metadata->>'service_fee_cents', '')::int, 0);
    v_credit_debit_cents   := COALESCE(
                                NULLIF(v_tx.metadata->>'credit_debit_cents', '')::int,
                                NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int,
                                0);
    IF v_credit_debit_cents < 0 THEN v_credit_debit_cents := 0; END IF;

    IF (v_price_cents * v_quantity) <> v_original_total_cents THEN
      RAISE EXCEPTION 'Amount mismatch: ticket_price*qty=% original_total_cents=%',
        (v_price_cents * v_quantity), v_original_total_cents;
    END IF;

    v_expected_amount_cents := v_original_total_cents + v_service_fee_cents - v_credit_debit_cents;
    IF v_expected_amount_cents <> v_tx.amount_cents THEN
      RAISE EXCEPTION 'Amount mismatch: expected=% got=% (original=% fee=% credit=%)',
        v_expected_amount_cents, v_tx.amount_cents,
        v_original_total_cents, v_service_fee_cents, v_credit_debit_cents;
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
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = (v_tx.metadata->>'listing_id')::uuid AND status = 'active'
    FOR UPDATE;

    IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found or not active'; END IF;
    IF v_listing.seller_id = p_user_id THEN RAISE EXCEPTION 'Cannot buy your own ticket'; END IF;

    SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id FOR UPDATE;
    IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

    IF v_ticket.ticket_status IS DISTINCT FROM 'reselling' AND v_ticket.status IS DISTINCT FROM 'resale' THEN
      RAISE EXCEPTION 'Ticket is not in resale state';
    END IF;

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

    v_commission    := v_listing.price * 0.10;
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
    VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold ticket (less 10% commission)', v_listing.ticket_id);

    -- Transferir la entrada al comprador
    UPDATE public.tickets
    SET user_id = p_user_id, status = 'valid', ticket_status = 'active',
        qr_token = gen_random_uuid(), qr_code = gen_random_uuid()::text,
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
$$;

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;
