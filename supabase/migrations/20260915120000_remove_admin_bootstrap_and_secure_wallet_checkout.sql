-- Release hardening: database roles are authoritative and wallet prices are
-- always calculated from locked server-side rows.

DROP FUNCTION IF EXISTS public.bootstrap_set_me_admin(text);

CREATE OR REPLACE FUNCTION public.buy_ticket_with_credito_v2(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity integer,
  p_ticket_type_id uuid DEFAULT NULL,
  p_discount_code_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_ticket_type public.event_ticket_types%ROWTYPE;
  v_discount public.discount_codes%ROWTYPE;
  v_unit_price_cents integer;
  v_original_total_cents integer;
  v_discount_cents integer := 0;
  v_ticket_total_cents integer;
  v_service_fee_cents integer;
  v_total_debit numeric;
  v_ticket_id uuid;
  v_ticket_ids uuid[] := ARRAY[]::uuid[];
  v_qr uuid;
  i integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 20 THEN
    RAISE EXCEPTION 'Invalid purchase request';
  END IF;
  IF nullif(btrim(p_buyer_name), '') IS NULL OR nullif(btrim(p_buyer_email), '') IS NULL THEN
    RAISE EXCEPTION 'Buyer name and email are required';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.is_cancelled OR v_event.status IN ('cancelled', 'deleted') THEN
    RAISE EXCEPTION 'Event not available';
  END IF;
  IF coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
    RAISE EXCEPTION 'Event has ended';
  END IF;
  IF v_event.available_tickets < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  IF p_ticket_type_id IS NULL THEN
    v_unit_price_cents := round(v_event.ticket_price * 100)::integer;
  ELSE
    SELECT * INTO v_ticket_type
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id
      AND event_id = p_event_id
      AND is_active
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND OR (v_ticket_type.quantity - coalesce(v_ticket_type.sold, 0)) < p_quantity THEN
      RAISE EXCEPTION 'Ticket type not available';
    END IF;
    v_unit_price_cents := round(v_ticket_type.price * 100)::integer;
  END IF;

  IF v_unit_price_cents IS NULL OR v_unit_price_cents <= 0 THEN
    RAISE EXCEPTION 'Invalid server price';
  END IF;
  v_original_total_cents := v_unit_price_cents * p_quantity;

  IF p_discount_code_id IS NOT NULL THEN
    SELECT * INTO v_discount
    FROM public.discount_codes
    WHERE id = p_discount_code_id
      AND event_id = p_event_id
    FOR UPDATE;
    IF NOT FOUND OR NOT v_discount.is_active
      OR v_discount.valid_from > now()
      OR (v_discount.valid_until IS NOT NULL AND v_discount.valid_until < now())
      OR p_quantity < v_discount.min_tickets
      OR (v_discount.max_uses IS NOT NULL AND v_discount.uses_count >= v_discount.max_uses)
    THEN
      RAISE EXCEPTION 'Discount code is not available';
    END IF;
    IF v_discount.discount_type = 'percentage' THEN
      v_discount_cents := round(v_original_total_cents * v_discount.discount_value / 100)::integer;
    ELSE
      v_discount_cents := least(round(v_discount.discount_value * 100)::integer, v_original_total_cents);
    END IF;
  END IF;

  v_discount_cents := greatest(0, least(v_discount_cents, v_original_total_cents));
  v_ticket_total_cents := v_original_total_cents - v_discount_cents;
  v_service_fee_cents := greatest(round((v_ticket_total_cents * 0.015 + 25) / 0.985)::integer, 50);
  v_total_debit := (v_ticket_total_cents + v_service_fee_cents)::numeric / 100;

  PERFORM public.apply_credito_delta(
    v_user_id,
    -v_total_debit,
    'compra_con_credito',
    NULL,
    'Compra con crédito (precio y tasa calculados en servidor)'
  );

  FOR i IN 1..p_quantity LOOP
    v_qr := gen_random_uuid();
    INSERT INTO public.tickets (
      event_id, user_id, buyer_name, buyer_email, quantity,
      qr_token, qr_code, ticket_type_id, total_price,
      price, status, ticket_status, payment_status, purchase_date
    ) VALUES (
      p_event_id, v_user_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)), 1,
      v_qr, v_qr::text, p_ticket_type_id, v_ticket_total_cents::numeric / 100 / p_quantity,
      v_ticket_total_cents::numeric / 100 / p_quantity,
      'valid', 'active', 'paid', now()
    ) RETURNING id INTO v_ticket_id;
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  UPDATE public.events
  SET available_tickets = available_tickets - p_quantity,
      sold_tickets = coalesce(sold_tickets, 0) + p_quantity,
      updated_at = now()
  WHERE id = p_event_id;

  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE public.event_ticket_types
    SET sold = coalesce(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  IF p_discount_code_id IS NOT NULL THEN
    UPDATE public.discount_codes
    SET uses_count = uses_count + 1
    WHERE id = p_discount_code_id;
    INSERT INTO public.discount_code_uses(discount_code_id, buyer_name, buyer_email)
    VALUES (p_discount_code_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'ticket_total_cents', v_ticket_total_cents,
    'service_fee_cents', v_service_fee_cents,
    'total_debit_cents', v_ticket_total_cents + v_service_fee_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.buy_ticket_with_credito_v2(uuid,text,text,integer,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito_v2(uuid,text,text,integer,uuid,uuid)
  TO authenticated;

-- Legacy methods accepted money-related values from the caller. They remain in
-- the schema for rollback compatibility but are no longer callable by clients.
REVOKE ALL ON FUNCTION public.buy_ticket_with_credito(uuid,uuid,text,text,integer,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buy_ticket_with_credito(uuid,uuid,text,text,integer,numeric,text,uuid,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buy_ticket_with_wallet(uuid,uuid,text,text,integer,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito(uuid,uuid,text,text,integer,numeric,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito(uuid,uuid,text,text,integer,numeric,text,uuid,numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.buy_ticket_with_wallet(uuid,uuid,text,text,integer,numeric,text,uuid)
  TO service_role;

-- Internal balance and fulfillment primitives must never be directly exposed.
REVOKE ALL ON FUNCTION public.add_funds(uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_credito_delta(uuid,numeric,public.ledger_movimiento_tipo,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds(uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_credito_delta(uuid,numeric,public.ledger_movimiento_tipo,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO service_role;
