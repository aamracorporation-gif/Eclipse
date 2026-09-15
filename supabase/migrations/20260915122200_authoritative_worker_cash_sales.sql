-- Cash sales by workers are priced, authorized and stocked atomically by the
-- database. The mobile client supplies only ticket-type quantities and attendee
-- details; it cannot mint arbitrary paid tickets.

CREATE OR REPLACE FUNCTION public.sell_tickets_manual_v2(
  p_worker_id uuid,
  p_event_id uuid,
  p_items jsonb,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_age integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_type public.event_ticket_types%ROWTYPE;
  v_item jsonb;
  v_quantity integer;
  v_total_quantity integer := 0;
  v_total_cents integer := 0;
  v_ticket_id uuid;
  v_ticket_ids uuid[] := ARRAY[]::uuid[];
  v_qr uuid;
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) = 0
    OR nullif(btrim(p_buyer_name), '') IS NULL
    OR nullif(btrim(p_buyer_email), '') IS NULL
    OR length(p_buyer_name) > 120 OR length(p_buyer_email) > 320
    OR (p_buyer_age IS NOT NULL AND (p_buyer_age < 0 OR p_buyer_age > 120))
  THEN
    RAISE EXCEPTION 'Invalid sale request';
  END IF;

  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = p_worker_id
    AND user_id = auth.uid()
    AND status = 'active'
    AND (
      permissions ? 'sell'
      OR lower(coalesce(permissions->>'sell', 'false')) = 'true'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker not found, inactive, or sale permission denied'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_event_assignments
    WHERE worker_id = v_worker.id AND event_id = p_event_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Worker is not assigned to this event' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid ticket quantity';
    END;
    IF nullif(v_item->>'ticket_type_id', '') IS NULL OR v_quantity < 1 OR v_quantity > 20 THEN
      RAISE EXCEPTION 'Invalid ticket item';
    END IF;
    v_total_quantity := v_total_quantity + v_quantity;
  END LOOP;
  IF v_total_quantity < 1 OR v_total_quantity > 20 THEN
    RAISE EXCEPTION 'A sale must contain between 1 and 20 tickets';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id AND creator_id = v_worker.organizer_id
  FOR UPDATE;
  IF NOT FOUND OR v_event.is_cancelled OR v_event.status IN ('cancelled', 'deleted')
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now()
  THEN
    RAISE EXCEPTION 'Event not available';
  END IF;
  IF v_event.available_tickets < v_total_quantity THEN
    RAISE EXCEPTION 'Not enough event tickets available';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
    ORDER BY (value->>'ticket_type_id')::uuid
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT * INTO v_type
    FROM public.event_ticket_types
    WHERE id = (v_item->>'ticket_type_id')::uuid
      AND event_id = p_event_id
      AND is_active
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND OR (v_type.quantity - coalesce(v_type.sold, 0)) < v_quantity THEN
      RAISE EXCEPTION 'Ticket type not available';
    END IF;

    FOR i IN 1..v_quantity LOOP
      v_qr := gen_random_uuid();
      INSERT INTO public.tickets (
        event_id, buyer_name, buyer_email, attendee_name, attendee_email,
        attendee_age, quantity, price, total_price, ticket_type_id,
        ticket_type, status, ticket_status, validation_status, payment_status,
        sold_by_worker_id, purchase_date, qr_token, qr_code
      ) VALUES (
        p_event_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)),
        btrim(p_buyer_name), lower(btrim(p_buyer_email)), p_buyer_age,
        1, v_type.price, v_type.price, v_type.id, v_type.name,
        'valid', 'active', 'valid', 'paid', v_worker.id, now(), v_qr, v_qr::text
      ) RETURNING id INTO v_ticket_id;
      v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
      v_total_cents := v_total_cents + round(v_type.price * 100)::integer;
    END LOOP;

    UPDATE public.event_ticket_types
    SET sold = coalesce(sold, 0) + v_quantity
    WHERE id = v_type.id;
  END LOOP;

  UPDATE public.events
  SET available_tickets = available_tickets - v_total_quantity,
      sold_tickets = coalesce(sold_tickets, 0) + v_total_quantity,
      updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'quantity', v_total_quantity,
    'total_cents', v_total_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sell_tickets_manual_v2(uuid,uuid,jsonb,text,text,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_tickets_manual_v2(uuid,uuid,jsonb,text,text,integer)
  TO authenticated, service_role;
