CREATE OR REPLACE FUNCTION private.enforce_ticket_entry_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_minutes text; v_start timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND OLD.entry_deadline IS NOT NULL THEN
   NEW.entry_deadline:=OLD.entry_deadline;
 ELSE
   v_minutes:=CASE WHEN TG_OP='UPDATE' THEN OLD.product_snapshot#>>'{metadata,entryDeadlineMinutes}' ELSE NEW.product_snapshot#>>'{metadata,entryDeadlineMinutes}' END;
   NEW.entry_deadline:=NULL;
   IF nullif(v_minutes,'') IS NOT NULL THEN
     IF v_minutes !~ '^[0-9]{1,4}$' OR v_minutes::int NOT BETWEEN 1 AND 1440 THEN RAISE EXCEPTION 'Límite de acceso inválido'; END IF;
     SELECT event_date INTO v_start FROM public.events WHERE id=NEW.event_id;
     NEW.entry_deadline:=v_start+v_minutes::int*interval '1 minute';
     IF TG_OP='INSERT' AND NEW.payment_transaction_id IS NULL AND NEW.entry_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'El plazo de acceso de esta entrada ha terminado'; END IF;
   END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.entry_deadline IS NOT NULL AND clock_timestamp()>=NEW.entry_deadline
    AND ((NEW.scanned_at IS NOT NULL AND OLD.scanned_at IS NULL)
      OR (NEW.status='used' AND OLD.status IS DISTINCT FROM 'used')
      OR (NEW.ticket_status='used' AND OLD.ticket_status IS DISTINCT FROM 'used')
      OR (NEW.validation_status='used' AND OLD.validation_status IS DISTINCT FROM 'used')) THEN
   RAISE EXCEPTION 'ENTRADA CADUCADA: ha terminado su horario de acceso';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_ticket_entry_deadline() FROM PUBLIC,anon,authenticated;
UPDATE public.tickets SET entry_deadline=NULL WHERE entry_deadline IS NULL AND nullif(product_snapshot#>>'{metadata,entryDeadlineMinutes}','') IS NOT NULL;

CREATE OR REPLACE FUNCTION private.fulfill_primary_card(p_intent text, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
  IF reason IS NULL AND coalesce(nullif(tx.metadata#>>'{product_snapshot,metadata,entryDeadlineMinutes}','')::int,0)>0
    AND ev.event_date+(tx.metadata#>>'{product_snapshot,metadata,entryDeadlineMinutes}')::int*interval '1 minute'<=now() THEN
    reason:='entry_deadline_passed';
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE public.payment_transactions SET status='refund_pending',
      metadata=metadata||jsonb_build_object('refund_reason',reason) WHERE id=tx.id;
    RETURN jsonb_build_object('fulfilled',false,'kind',tx.kind,'status','refund_pending','refund_required',true);
  END IF;
  RETURN public.fulfill_payment_for_user_legacy_20260920(p_intent,p_user);
END;
$function$;

CREATE OR REPLACE FUNCTION private.fulfill_vip_card(p_intent text, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
  IF reason IS NULL AND coalesce(nullif(tx.metadata#>>'{product_snapshot,metadata,entryDeadlineMinutes}','')::int,0)>0
    AND ev.event_date+(tx.metadata#>>'{product_snapshot,metadata,entryDeadlineMinutes}')::int*interval '1 minute'<=now() THEN
    reason:='entry_deadline_passed';
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
$function$;
