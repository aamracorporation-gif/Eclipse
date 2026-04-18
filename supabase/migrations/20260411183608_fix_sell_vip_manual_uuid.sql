CREATE OR REPLACE FUNCTION public.sell_vip_manual(
  p_worker_id uuid,
  p_vip_reservado_id uuid,
  p_quantity int,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_age int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_worker record;
  v_vip public.reservados_vip%ROWTYPE;
  v_now timestamptz := now();
  v_token uuid;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  i int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, organizer_id, status
  INTO v_worker
  FROM public.workers
  WHERE id = p_worker_id
  LIMIT 1;

  IF v_worker IS NULL OR v_worker.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Worker not found or inactive';
  END IF;

  IF v_worker.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id
  FOR UPDATE;

  IF v_vip IS NULL THEN
    RAISE EXCEPTION 'VIP not found';
  END IF;

  IF COALESCE(v_vip.quantity_available, 0) < p_quantity THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - p_quantity
  WHERE id = v_vip.id;

  v_ticket_ids := ARRAY[]::uuid[];

  FOR i IN 1..p_quantity LOOP
    v_token := gen_random_uuid();
    INSERT INTO public.tickets (
      event_id,
      ticket_type,
      ticket_type_id,
      price,
      quantity,
      total_price,
      status,
      payment_status,
      sold_by_worker_id,
      scanned_by_worker_id,
      scanned_at,
      purchase_date,
      attendee_name,
      attendee_email,
      attendee_age,
      buyer_name,
      buyer_email,
      qr_code,
      qr_token
    )
    VALUES (
      v_vip.event_id,
      'VIP - ' || COALESCE(v_vip.name, 'VIP'),
      NULL,
      COALESCE(v_vip.base_price, 0),
      1,
      COALESCE(v_vip.base_price, 0),
      'used',
      'paid',
      v_worker.id,
      v_worker.id,
      v_now,
      v_now,
      COALESCE(NULLIF(p_buyer_name, ''), 'Asistente'),
      COALESCE(NULLIF(p_buyer_email, ''), 'sin-email'),
      COALESCE(p_buyer_age, 0),
      COALESCE(NULLIF(p_buyer_name, ''), 'Asistente'),
      COALESCE(NULLIF(p_buyer_email, ''), 'sin-email'),
      v_token::text,
      v_token
    )
    RETURNING id INTO v_ticket_id;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  RETURN jsonb_build_object('ticket_ids', v_ticket_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_vip_manual(uuid, uuid, int, text, text, int) TO authenticated;
NOTIFY pgrst, 'reload schema';