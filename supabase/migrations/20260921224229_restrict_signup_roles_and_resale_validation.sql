-- Narrow, drift-aware repair: preserve all other signup behavior and existing users.
DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO definition;
  IF position('(''attendee'', ''organizer'', ''admin'')' IN definition) > 0 THEN
    definition := replace(definition,
      '(''attendee'', ''organizer'', ''admin'')', '(''attendee'', ''organizer'')');
    EXECUTE definition;
  ELSIF position('(''attendee'', ''organizer'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected signup role whitelist; review before applying';
  END IF;
END $repair$;

-- Restore atomic resale settlement through the balance displayed in the app.
-- Move existing Stripe-backed reserves with the credit; do not mint backing.
CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_buyer public.user_credit%ROWTYPE;
  v_real numeric(12,4);
  v_promo numeric(12,4);
  v_remaining numeric(12,4);
  v_chunk numeric(12,4);
  v_reserve public.wallet_reserves%ROWTYPE;
  v_qr uuid;
  v_data jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_buyer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Card fulfillment locks the same listing first. Only one buyer can win.
  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND OR v_listing.status IS DISTINCT FROM 'active'
    OR v_listing.seller_id IS NULL OR v_listing.seller_id = p_buyer_id
    OR v_listing.price IS NULL OR v_listing.price <= 0
    OR v_listing.price <> round(v_listing.price, 2) THEN
    RAISE EXCEPTION 'Listing unavailable';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_listing.ticket_id
  FOR UPDATE;
  IF NOT FOUND OR v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
    OR v_ticket.status IS DISTINCT FROM 'resale' OR v_ticket.ticket_status IS DISTINCT FROM 'reselling'
    OR v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status IS DISTINCT FROM 'valid'
    OR coalesce(v_ticket.wallet_added, false)
    OR v_ticket.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Ticket unavailable for resale';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF NOT FOUND OR NOT coalesce(v_event.allow_resale, true)
    OR coalesce(v_event.is_cancelled, false)
    OR v_event.status IN ('cancelled', 'deleted')
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') IS NULL
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
    RAISE EXCEPTION 'Event unavailable for resale';
  END IF;

  -- Lock balances in a stable order for reciprocal purchases by the same users.
  INSERT INTO public.user_credit (user_id, balance_real, balance_promo)
  VALUES (v_listing.seller_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
  PERFORM user_id FROM public.user_credit
  WHERE user_id IN (p_buyer_id, v_listing.seller_id) ORDER BY user_id FOR UPDATE;

  -- Verify that both classes of credit cover the price.
  SELECT * INTO v_buyer
  FROM public.user_credit
  WHERE user_id = p_buyer_id
  FOR UPDATE;
  IF NOT FOUND OR v_buyer.balance_real + v_buyer.balance_promo < v_listing.price THEN
    RAISE EXCEPTION 'Insufficient credit';
  END IF;
  -- Promotional credit is transferred as promotional credit; use it first so
  -- legacy real balances with missing reserves do not become new backing.
  v_promo := least(v_buyer.balance_promo, v_listing.price);
  v_real := v_listing.price - v_promo;

  -- Preflight backing under row locks; any gap aborts the entire transfer.
  v_remaining := v_real;
  FOR v_reserve IN
    SELECT * FROM public.wallet_reserves
    WHERE user_id = p_buyer_id AND status = 'pending'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_remaining := v_remaining - least(v_remaining, v_reserve.amount);
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient reserve backing';
  END IF;

  UPDATE public.user_credit
  SET balance_real = balance_real - v_real,
      balance_promo = balance_promo - v_promo,
      updated_at = now()
  WHERE user_id = p_buyer_id;

  INSERT INTO public.user_credit (user_id, balance_real, balance_promo)
  VALUES (v_listing.seller_id, v_real, v_promo)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_real = public.user_credit.balance_real + excluded.balance_real,
        balance_promo = public.user_credit.balance_promo + excluded.balance_promo,
        updated_at = now();

  v_remaining := v_real;
  FOR v_reserve IN
    SELECT * FROM public.wallet_reserves
    WHERE user_id = p_buyer_id AND status = 'pending'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_chunk := least(v_remaining, v_reserve.amount);
    IF v_chunk = v_reserve.amount THEN
      UPDATE public.wallet_reserves
      SET user_id = v_listing.seller_id, updated_at = now()
      WHERE id = v_reserve.id;
    ELSE
      UPDATE public.wallet_reserves
      SET amount = amount - v_chunk, updated_at = now()
      WHERE id = v_reserve.id;
      INSERT INTO public.wallet_reserves (user_id, amount, stripe_payment_intent_id)
      VALUES (v_listing.seller_id, v_chunk, v_reserve.stripe_payment_intent_id);
    END IF;
    v_remaining := v_remaining - v_chunk;
  END LOOP;

  -- Keep the legacy wallet mirror of real credit in sync.
  INSERT INTO public.wallets (user_id, balance)
  SELECT p_buyer_id, balance_real FROM public.user_credit WHERE user_id = p_buyer_id
  ON CONFLICT (user_id) DO UPDATE
    SET balance = excluded.balance, updated_at = now();
  INSERT INTO public.wallets (user_id, balance)
  SELECT v_listing.seller_id, balance_real
  FROM public.user_credit WHERE user_id = v_listing.seller_id
  ON CONFLICT (user_id) DO UPDATE
    SET balance = excluded.balance, updated_at = now();

  PERFORM public.record_ledger_movimiento(
    'compra_con_credito', p_buyer_id, NULL, -v_listing.price,
    p_listing_id::text, 'Compra de reventa con crédito'
  );
  PERFORM public.record_ledger_movimiento(
    'generacion_credito_reventa', v_listing.seller_id, NULL, v_listing.price,
    p_listing_id::text, 'Crédito transferido por reventa'
  );

  -- The old pass and QR must stop working as soon as ownership changes.
  v_qr := gen_random_uuid();
  UPDATE public.tickets
  SET user_id = p_buyer_id, status = 'valid', ticket_status = 'active',
      qr_token = v_qr, qr_code = v_qr::text,
      buyer_name = coalesce((SELECT nullif(full_name, '') FROM public.profiles WHERE id = p_buyer_id), 'Comprador'),
      buyer_email = coalesce((SELECT email FROM public.profiles WHERE id = p_buyer_id), ''),
      transfer_count = coalesce(transfer_count, 0) + 1,
      last_transferred_at = now()
  WHERE id = v_listing.ticket_id;

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = v_listing.id;

  INSERT INTO public.resale_transactions (
    listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount
  ) VALUES (
    v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_buyer_id,
    v_listing.price, 0, v_listing.price
  );

  v_data := jsonb_build_object(
    'buyer_id', p_buyer_id::text,
    'seller_id', v_listing.seller_id::text,
    'event_id', v_event.id::text,
    'event_title', coalesce(v_event.title, ''),
    'quantity', '1',
    'ticket_id', v_ticket.id::text,
    'listing_id', v_listing.id::text,
    'payment_intent_id', ''
  );
  BEGIN
    PERFORM public.enqueue_notification_from_template(
      p_buyer_id, 'attendee', 'purchase_completed', v_data
    );
    PERFORM public.enqueue_notification_from_template(
      v_listing.seller_id, 'attendee', 'resale_sold', v_data
    );
  EXCEPTION WHEN others THEN
    NULL; -- Notifications cannot reverse a completed purchase.
  END;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing.id, 'ticket_id', v_ticket.id);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_resale_ticket_with_credito(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid,uuid)
  TO authenticated, service_role;
-- Listing eligibility is enforced again at the database boundary.
CREATE OR REPLACE FUNCTION public.create_resale_listing_secure(
  p_ticket_id uuid, p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_listing_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price <> round(p_price, 2) THEN
    RAISE EXCEPTION 'Invalid resale price';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.user_id IS DISTINCT FROM auth.uid()
    OR v_ticket.status IS DISTINCT FROM 'valid' OR v_ticket.ticket_status IS DISTINCT FROM 'active'
    OR v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status IS DISTINCT FROM 'valid'
    OR coalesce(v_ticket.wallet_added, false)
    OR v_ticket.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Ticket unavailable for resale';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF NOT FOUND OR NOT coalesce(v_event.allow_resale, true)
    OR coalesce(v_event.is_cancelled, false)
    OR v_event.status IN ('cancelled', 'deleted')
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') IS NULL
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
    RAISE EXCEPTION 'Event unavailable for resale';
  END IF;
  IF v_ticket.total_price IS NULL OR v_ticket.total_price <= 0
    OR p_price < v_ticket.total_price
    OR p_price > v_ticket.total_price * 1.2 THEN
    RAISE EXCEPTION 'Resale price must be between 100%% and 120%% of the original';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.resale_listings
    WHERE ticket_id = p_ticket_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Ticket already listed';
  END IF;

  UPDATE public.tickets
  SET status = 'resale', ticket_status = 'reselling'
  WHERE id = p_ticket_id;
  INSERT INTO public.resale_listings (
    ticket_id, seller_id, price, status, created_at, updated_at
  )
  VALUES (p_ticket_id, auth.uid(), p_price, 'active', now(), now())
  ON CONFLICT (ticket_id) DO UPDATE SET
    seller_id = excluded.seller_id, price = excluded.price,
    status = 'active', updated_at = now()
  RETURNING id INTO v_listing_id;
  RETURN jsonb_build_object('listing_id', v_listing_id, 'ticket_id', p_ticket_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_resale_listing_secure(uuid,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid,numeric)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(p_payment_intent_id text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_reason text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_tx FROM public.payment_transactions
  WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND OR v_tx.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Payment transaction unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_tx.status = 'fulfilled' THEN
    RETURN jsonb_build_object('fulfilled', true, 'kind', v_tx.kind);
  END IF;
  IF v_tx.kind <> 'resale_ticket' THEN
    RETURN public.fulfill_payment_for_user_legacy_20260920(p_payment_intent_id, p_user_id);
  END IF;
  IF v_tx.status IN ('refund_pending', 'refunded', 'refund_failed') THEN
    RETURN jsonb_build_object('fulfilled', false, 'kind', v_tx.kind,
      'status', v_tx.status, 'refund_required', v_tx.status = 'refund_pending');
  END IF;

  -- Both wallet purchases and card purchases lock the listing before the ticket.
  SELECT * INTO v_listing FROM public.resale_listings
  WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR v_listing.status IS DISTINCT FROM 'active'
    OR v_listing.seller_id IS NULL OR v_listing.seller_id = p_user_id
    OR v_tx.status = 'canceled' THEN
    v_reason := 'listing_unavailable';
  ELSE
    SELECT * INTO v_ticket FROM public.tickets
    WHERE id = v_listing.ticket_id FOR UPDATE;
    IF NOT FOUND OR v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
      OR v_ticket.status IS DISTINCT FROM 'resale'
      OR v_ticket.ticket_status IS DISTINCT FROM 'reselling'
      OR v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status IS DISTINCT FROM 'valid'
      OR coalesce(v_ticket.wallet_added, false)
      OR v_ticket.payment_status IS DISTINCT FROM 'paid' THEN
      v_reason := 'ticket_unavailable';
    ELSE
      SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id FOR SHARE;
      IF NOT FOUND OR NOT coalesce(v_event.allow_resale, true)
        OR coalesce(v_event.is_cancelled, false)
        OR v_event.status IN ('cancelled', 'deleted')
        OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') IS NULL
        OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
        v_reason := 'event_unavailable';
      ELSIF v_tx.metadata->>'ticket_id' IS DISTINCT FROM v_ticket.id::text
        OR v_tx.metadata->>'seller_id' IS DISTINCT FROM v_listing.seller_id::text
        OR v_listing.price IS NULL OR v_listing.price <= 0
        OR round(v_listing.price * 100)::int IS DISTINCT FROM
          NULLIF(v_tx.metadata->>'original_total_cents', '')::int THEN
        v_reason := 'listing_changed';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.payment_transactions
    SET status = 'refund_pending',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('refund_reason', v_reason)
    WHERE id = v_tx.id;
    RETURN jsonb_build_object('fulfilled', false, 'kind', v_tx.kind,
      'status', 'refund_pending', 'refund_required', true);
  END IF;

  -- Unexpected database or network failures are retried, never treated as a refund decision.
  v_result := public.fulfill_payment_for_user_legacy_20260920(p_payment_intent_id, p_user_id);
  IF (v_result->>'fulfilled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Resale fulfillment did not complete';
  END IF;
  UPDATE public.tickets
  SET qr_code = qr_token::text,
      buyer_name = coalesce((SELECT nullif(full_name, '') FROM public.profiles WHERE id = p_user_id), 'Comprador'),
      buyer_email = coalesce((SELECT email FROM public.profiles WHERE id = p_user_id), '')
  WHERE id = v_ticket.id AND user_id = p_user_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;
