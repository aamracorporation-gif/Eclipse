-- The public dispatcher already locks the payment. Keep VIP inventory, credit,
-- ticket issuance and fulfillment in that same transaction.
CREATE OR REPLACE FUNCTION private.fulfill_vip_card(p_intent text, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  vip public.reservados_vip%ROWTYPE;
  ev public.events%ROWTYPE;
  credit public.user_credit%ROWTYPE;
  reserve record;
  reason text;
  debit numeric;
  real_debit numeric;
  backing numeric := 0;
  ticket_id uuid;
  qr uuid;
  result jsonb;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions
    WHERE stripe_payment_intent_id=p_intent FOR UPDATE;
  IF NOT FOUND OR tx.user_id IS DISTINCT FROM p_user OR tx.kind <> 'vip_table' THEN
    RAISE EXCEPTION 'VIP payment unavailable' USING ERRCODE='42501';
  END IF;
  IF tx.status='fulfilled' THEN RETURN jsonb_build_object('fulfilled',true,'kind',tx.kind); END IF;
  IF tx.status IN ('refund_pending','refunded','refund_failed') THEN
    RETURN jsonb_build_object('fulfilled',false,'kind',tx.kind,'status',tx.status,
      'refund_required',tx.status='refund_pending');
  END IF;
  SELECT * INTO vip FROM public.reservados_vip
    WHERE id=nullif(tx.metadata->>'vip_reservado_id','')::uuid FOR UPDATE;
  IF NOT FOUND OR vip.quantity_available < 1 OR NOT vip.is_active OR vip.deleted_at IS NOT NULL
    OR tx.status='canceled' THEN
    reason:='vip_unavailable';
  ELSE
    SELECT * INTO ev FROM public.events WHERE id=vip.event_id FOR UPDATE;
    IF NOT FOUND OR ev.is_cancelled OR ev.status='cancelled'
      OR coalesce(ev.end_datetime,ev.event_date+interval '5 hours') <= now() THEN
      reason:='event_unavailable';
    ELSIF tx.metadata->>'event_id' IS DISTINCT FROM vip.event_id::text
      OR vip.base_price <= 0 OR vip.capacity_people < 1
      OR round(vip.base_price*100)::int IS DISTINCT FROM nullif(tx.metadata->>'original_total_cents','')::int
      OR (tx.metadata ? 'capacity_people' AND (tx.metadata->>'capacity_people')::int IS DISTINCT FROM vip.capacity_people) THEN
      reason:='vip_changed';
    END IF;
  END IF;

  debit:=coalesce(nullif(tx.metadata->>'credit_debit_cents','')::int,
    nullif(tx.metadata->>'wallet_debit_cents','')::int,0)::numeric/100;
  IF reason IS NULL AND debit > 0 THEN
    SELECT * INTO credit FROM public.user_credit WHERE user_id=p_user FOR UPDATE;
    IF NOT FOUND OR credit.balance_real+credit.balance_promo < debit THEN
      reason:='credit_unavailable';
    ELSE
      real_debit:=least(credit.balance_real,debit);
      FOR reserve IN SELECT amount FROM public.wallet_reserves
        WHERE user_id=p_user AND status='pending' ORDER BY created_at,id FOR UPDATE
      LOOP backing:=backing+reserve.amount; END LOOP;
      IF backing < real_debit THEN reason:='credit_backing_unavailable'; END IF;
    END IF;
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE public.payment_transactions SET status='refund_pending',
      metadata=metadata||jsonb_build_object('refund_reason',reason) WHERE id=tx.id;
    RETURN jsonb_build_object('fulfilled',false,'kind',tx.kind,'status','refund_pending','refund_required',true);
  END IF;
  IF debit < 0 OR coalesce(nullif(tx.metadata->>'service_fee_cents','')::int,0) < 0 THEN
    RAISE EXCEPTION 'Invalid payment amounts';
  END IF;

  qr:=gen_random_uuid();
  INSERT INTO public.tickets(event_id,user_id,buyer_name,buyer_email,quantity,total_price,
    qr_token,qr_code,status,ticket_status,payment_status,payment_transaction_id,stripe_payment_intent_id)
  VALUES(vip.event_id,p_user,coalesce(nullif(tx.metadata->>'buyer_name',''),'Comprador'),
    coalesce(tx.metadata->>'buyer_email',''),vip.capacity_people,vip.base_price,
    qr,qr::text,'valid','active','paid',tx.id,tx.stripe_payment_intent_id)
  RETURNING id INTO ticket_id;
  UPDATE public.reservados_vip SET quantity_available=quantity_available-1 WHERE id=vip.id;

  -- Reuse amount verification and real/promo debit from the private core.
  -- Any failure rolls back the ticket and inventory update above.
  result:=public.fulfill_payment_for_user_legacy_20260920(p_intent,p_user);
  IF (result->>'fulfilled')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'VIP fulfillment failed'; END IF;
  RETURN result||jsonb_build_object('tickets',jsonb_build_object('ids',jsonb_build_array(ticket_id)));
END;
$$;
REVOKE ALL ON FUNCTION private.fulfill_vip_card(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $dispatch$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.fulfill_payment_for_user(text,uuid)'::regprocedure) INTO definition;
  IF position('private.fulfill_vip_card' IN definition)>0 THEN RETURN; END IF;
  IF position('IF v_tx.kind <> ''resale_ticket'' THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected payment dispatcher; review VIP integration';
  END IF;
  definition:=replace(definition,'IF v_tx.kind <> ''resale_ticket'' THEN',
    E'IF v_tx.kind = ''vip_table'' THEN\n    RETURN private.fulfill_vip_card(p_payment_intent_id,p_user_id);\n  END IF;\n  IF v_tx.kind <> ''resale_ticket'' THEN');
  EXECUTE definition;
END $dispatch$;
