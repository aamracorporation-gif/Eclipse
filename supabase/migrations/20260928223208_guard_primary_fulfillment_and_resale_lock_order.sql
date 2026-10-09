-- A paid charge whose inventory/credit became unavailable must enter a durable
-- refund state, without issuing tickets or consuming credit. Staging reviewed.
CREATE OR REPLACE FUNCTION private.fulfill_primary_card(p_intent text, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  ev public.events%ROWTYPE;
  tt public.event_ticket_types%ROWTYPE;
  credit public.user_credit%ROWTYPE;
  reserve record;
  reason text;
  qty integer;
  type_id uuid;
  original_cents integer;
  discount_cents integer;
  fee_cents integer;
  debit_cents integer;
  price_cents integer;
  backing numeric := 0;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions
    WHERE stripe_payment_intent_id=p_intent FOR UPDATE;
  IF NOT FOUND OR tx.user_id IS DISTINCT FROM p_user OR tx.kind <> 'event_ticket' THEN
    RAISE EXCEPTION 'Primary payment unavailable' USING ERRCODE='42501';
  END IF;
  IF tx.status='fulfilled' THEN RETURN jsonb_build_object('fulfilled',true,'kind',tx.kind); END IF;
  IF tx.status IN ('refund_pending','refunded','refund_failed') THEN
    RETURN jsonb_build_object('fulfilled',false,'kind',tx.kind,'status',tx.status,
      'refund_required',tx.status='refund_pending');
  END IF;
  qty:=nullif(tx.metadata->>'quantity','')::int;
  type_id:=nullif(tx.metadata->>'ticket_type_id','')::uuid;
  discount_cents:=coalesce(nullif(tx.metadata->>'discount_amount_cents','')::int,0);
  fee_cents:=coalesce(nullif(tx.metadata->>'service_fee_cents','')::int,0);
  debit_cents:=coalesce(nullif(tx.metadata->>'credit_debit_cents','')::int,
    nullif(tx.metadata->>'wallet_debit_cents','')::int,0);
  IF qty IS NULL OR qty < 1 OR qty > 20 OR discount_cents < 0 OR fee_cents < 0 OR debit_cents < 0 THEN
    RAISE EXCEPTION 'Invalid primary payment amounts';
  END IF;
  SELECT * INTO ev FROM public.events
    WHERE id=nullif(tx.metadata->>'event_id','')::uuid FOR UPDATE;
  IF NOT FOUND OR ev.is_cancelled OR ev.status IN ('cancelled','deleted')
    OR coalesce(ev.end_datetime,ev.event_date+interval '5 hours') IS NULL
    OR coalesce(ev.end_datetime,ev.event_date+interval '5 hours') <= now() THEN
    reason:='event_unavailable';
  ELSIF ev.available_tickets < qty THEN reason:='event_sold_out';
  ELSE
    price_cents:=round(ev.ticket_price*100)::int;
    IF type_id IS NOT NULL THEN
      SELECT * INTO tt FROM public.event_ticket_types WHERE id=type_id AND event_id=ev.id FOR UPDATE;
      IF NOT FOUND OR tt.is_active IS DISTINCT FROM true OR tt.deleted_at IS NOT NULL
        OR tt.quantity-coalesce(tt.sold,0) < qty THEN
        reason:='ticket_type_unavailable';
      ELSE price_cents:=round(tt.price*100)::int;
      END IF;
    END IF;
    original_cents:=coalesce(nullif(tx.metadata->>'original_total_cents','')::int,price_cents*qty);
    IF reason IS NULL AND (price_cents IS NULL OR price_cents <= 0 OR price_cents*qty IS DISTINCT FROM original_cents) THEN
      reason:='price_changed';
    END IF;
    IF reason IS NULL AND (discount_cents > original_cents OR
      original_cents-discount_cents+fee_cents-debit_cents <> tx.amount_cents) THEN
      RAISE EXCEPTION 'Primary payment amount mismatch';
    END IF;
  END IF;
  IF tx.status IN ('canceled','cancelled') THEN reason:='payment_canceled'; END IF;
  IF reason IS NULL AND debit_cents > 0 THEN
    SELECT * INTO credit FROM public.user_credit WHERE user_id=p_user FOR UPDATE;
    IF NOT FOUND OR credit.balance_real+credit.balance_promo < debit_cents::numeric/100 THEN
      reason:='credit_unavailable';
    ELSE
      FOR reserve IN SELECT amount FROM public.wallet_reserves
        WHERE user_id=p_user AND status='pending' ORDER BY created_at,id FOR UPDATE
      LOOP backing:=backing+reserve.amount; END LOOP;
      IF backing < least(credit.balance_real,debit_cents::numeric/100) THEN
        reason:='credit_backing_unavailable';
      END IF;
    END IF;
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE public.payment_transactions SET status='refund_pending',
      metadata=metadata||jsonb_build_object('refund_reason',reason) WHERE id=tx.id;
    RETURN jsonb_build_object('fulfilled',false,'kind',tx.kind,'status','refund_pending','refund_required',true);
  END IF;
  RETURN public.fulfill_payment_for_user_legacy_20260920(p_intent,p_user);
END;
$$;
REVOKE ALL ON FUNCTION private.fulfill_primary_card(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(p_payment_intent_id text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
  IF v_tx.kind = 'event_ticket' THEN
    RETURN private.fulfill_primary_card(p_payment_intent_id,p_user_id);
  END IF;
  IF v_tx.kind = 'vip_table' THEN
    RETURN private.fulfill_vip_card(p_payment_intent_id,p_user_id);
  END IF;
  IF v_tx.kind <> 'resale_ticket' THEN
    RETURN public.fulfill_payment_for_user_legacy_20260920(p_payment_intent_id, p_user_id);
  END IF;
  IF v_tx.status IN ('refund_pending', 'refunded', 'refund_failed') THEN
    RETURN jsonb_build_object('fulfilled', false, 'kind', v_tx.kind,
      'status', v_tx.status, 'refund_required', v_tx.status = 'refund_pending');
  END IF;

  -- Same ticket -> listing order as wallet resale and cancellation.
  SELECT t.* INTO v_ticket FROM public.tickets t
  WHERE t.id = (SELECT l.ticket_id FROM public.resale_listings l
    WHERE l.id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid) FOR UPDATE;
  SELECT * INTO v_listing FROM public.resale_listings
  WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR v_listing.status IS DISTINCT FROM 'active'
    OR v_listing.seller_id IS NULL OR v_listing.seller_id = p_user_id
    OR v_tx.status = 'canceled' THEN
    v_reason := 'listing_unavailable';
  ELSE
    IF v_ticket.id IS NULL OR v_ticket.id IS DISTINCT FROM v_listing.ticket_id
      OR v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
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
$function$
;
