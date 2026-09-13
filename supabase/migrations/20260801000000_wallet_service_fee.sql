-- Add p_service_fee to buy_ticket_with_credito so wallet payments deduct ticket + service fee
-- The ticket records still store only the ticket price (without fee) to preserve resale calculations.
CREATE OR REPLACE FUNCTION public.buy_ticket_with_credito(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity int,
  p_total_price numeric,
  p_qr_code text,
  p_ticket_type_id uuid DEFAULT NULL,
  p_service_fee numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  i integer;
  v_single_price numeric;
  v_event public.events%ROWTYPE;
  v_data jsonb;
  v_total_debit numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;
  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'Invalid total price';
  END IF;

  -- Deduct ticket price + service fee from wallet in one atomic operation
  v_total_debit := ROUND(p_total_price::numeric, 2) + ROUND(GREATEST(COALESCE(p_service_fee, 0), 0)::numeric, 2);
  PERFORM public.apply_credito_delta(
    p_user_id,
    -v_total_debit,
    'compra_con_credito',
    NULL,
    'Compra con crédito (tasa de servicio incluida)'
  );

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  v_event_available := COALESCE(v_event.available_tickets, 0);
  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id
    FOR UPDATE;
    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
      RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  -- Store only ticket price per unit (not including service fee) for correct resale calculations
  v_single_price := ROUND((p_total_price::numeric / p_quantity)::numeric, 2);
  v_ticket_ids := ARRAY[]::uuid[];

  FOR i IN 1..p_quantity LOOP
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
      purchase_date
    ) VALUES (
      p_event_id,
      p_user_id,
      p_buyer_name,
      p_buyer_email,
      1,
      gen_random_uuid(),
      p_qr_code || '-' || i::text,
      p_ticket_type_id,
      v_single_price,
      'valid',
      'paid',
      NOW()
    )
    RETURNING id INTO v_ticket_id;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  -- Update available_tickets on event
  UPDATE public.events
  SET available_tickets = GREATEST(0, available_tickets - p_quantity)
  WHERE id = p_event_id;

  -- Update sold count on ticket type if applicable
  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE public.event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id AND event_id = p_event_id;
  END IF;

  v_data := jsonb_build_object(
    'ticket_ids', to_jsonb(v_ticket_ids),
    'quantity', p_quantity,
    'total_price', p_total_price,
    'service_fee', COALESCE(p_service_fee, 0),
    'total_debit', v_total_debit
  );

  RETURN v_data::json;
END;
$$;

-- Add p_service_fee to buy_vip_with_credito
CREATE OR REPLACE FUNCTION public.buy_vip_with_credito(
  p_vip_reservado_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_service_fee numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vip public.reservados_vip%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_price numeric;
  v_total_debit numeric;
  v_ticket_id uuid;
  v_qty int;
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

  IF v_vip.id IS NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  v_price := ROUND(COALESCE(v_vip.base_price, 0)::numeric, 2);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
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
    purchase_date
  ) VALUES (
    v_vip.event_id,
    p_user_id,
    p_buyer_name,
    p_buyer_email,
    v_qty,
    gen_random_uuid(),
    gen_random_uuid()::text,
    NULL,
    v_price,
    'valid',
    'paid',
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
$$;
