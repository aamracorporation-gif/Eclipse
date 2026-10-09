-- The four-argument public RPC must not collide with an internal default argument.
-- RESTRICT (no CASCADE) aborts if dependencies have appeared.
DROP FUNCTION public.buy_vip_with_credito(uuid,uuid,text,text,numeric);
CREATE OR REPLACE FUNCTION public.buy_vip_with_credito(p_vip_reservado_id uuid, p_user_id uuid, p_buyer_name text, p_buyer_email text, p_service_fee numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_vip public.reservados_vip%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_price numeric;
  v_total_debit numeric;
  v_ticket_id uuid;
  v_qty int;
  v_qr uuid := gen_random_uuid();
  v_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_vip_reservado_id IS NULL THEN
    RAISE EXCEPTION 'VIP not found';
  END IF;

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id
  FOR UPDATE;

  IF v_vip.id IS NULL OR v_vip.is_active IS DISTINCT FROM true
    OR v_vip.deleted_at IS NOT NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  v_price := ROUND(COALESCE(v_vip.base_price, 0)::numeric, 2);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_vip.event_id
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_event.is_cancelled, false)
    OR v_event.status IN ('cancelled', 'deleted')
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') IS NULL
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
    RAISE EXCEPTION 'Event not available';
  END IF;

  -- Deduct ticket price + service fee in one atomic operation
  v_total_debit := v_price + ROUND(GREATEST(COALESCE(p_service_fee, 0), 0)::numeric, 2);
  PERFORM public.apply_credito_delta(p_user_id, -v_total_debit, 'compra_con_credito', NULL, 'Compra VIP con crédito (tasa de servicio incluida)');

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - 1
  WHERE id = v_vip.id;

  v_qty := GREATEST(COALESCE(v_vip.capacity_people, 1), 1);

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
    payment_status,
    ticket_status,
    purchase_date
  ) VALUES (
    v_vip.event_id,
    p_user_id,
    p_buyer_name,
    p_buyer_email,
    v_qty,
    v_qr,
    v_qr::text,
    NULL,
    v_price,
    'valid',
    'paid',
    'active',
    NOW()
  )
  RETURNING id INTO v_ticket_id;

  -- Update event available tickets
  UPDATE public.events
  SET available_tickets = GREATEST(0, available_tickets - v_qty)
  WHERE id = v_vip.event_id;

  v_data := jsonb_build_object(
    'ticket_id', v_ticket_id,
    'price', v_price,
    'service_fee', COALESCE(p_service_fee, 0),
    'total_debit', v_total_debit
  );

  RETURN v_data::json;
END;
$function$;

REVOKE ALL ON FUNCTION public.buy_vip_with_credito(uuid,uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buy_vip_with_credito(uuid,uuid,text,text,numeric) TO service_role;
NOTIFY pgrst, 'reload schema';
