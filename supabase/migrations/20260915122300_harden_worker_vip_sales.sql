-- Keep the existing mobile contract while applying the same authorization,
-- inventory and input guarantees as normal worker cash sales.

CREATE OR REPLACE FUNCTION public.sell_vip_manual(
  p_worker_id uuid,
  p_vip_reservado_id uuid,
  p_quantity integer,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_age integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_vip public.reservados_vip%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_ticket_id uuid;
  v_ticket_ids uuid[] := ARRAY[]::uuid[];
  v_token uuid;
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 20
    OR nullif(btrim(p_buyer_name), '') IS NULL
    OR nullif(btrim(p_buyer_email), '') IS NULL
    OR length(p_buyer_name) > 120 OR length(p_buyer_email) > 320
    OR p_buyer_age < 0 OR p_buyer_age > 120
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

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'VIP not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.worker_event_assignments
    WHERE worker_id = v_worker.id AND event_id = v_vip.event_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Worker is not assigned to this event' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_vip.event_id AND creator_id = v_worker.organizer_id
  FOR UPDATE;
  IF NOT FOUND OR v_event.is_cancelled OR v_event.status IN ('cancelled', 'deleted')
    OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now()
  THEN
    RAISE EXCEPTION 'Event not available';
  END IF;
  IF coalesce(v_event.available_tickets, 0) < p_quantity THEN
    RAISE EXCEPTION 'Not enough event tickets available';
  END IF;

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id AND event_id = v_event.id
  FOR UPDATE;
  IF NOT FOUND OR coalesce(v_vip.quantity_available, 0) < p_quantity
    OR v_vip.base_price IS NULL OR v_vip.base_price < 0 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - p_quantity
  WHERE id = v_vip.id;
  UPDATE public.events
  SET available_tickets = available_tickets - p_quantity,
      sold_tickets = coalesce(sold_tickets, 0) + p_quantity,
      updated_at = now()
  WHERE id = v_event.id;

  FOR i IN 1..p_quantity LOOP
    v_token := gen_random_uuid();
    INSERT INTO public.tickets (
      event_id, ticket_type, ticket_type_id, price, quantity, total_price,
      status, ticket_status, validation_status, payment_status,
      sold_by_worker_id, purchase_date, attendee_name, attendee_email,
      attendee_age, buyer_name, buyer_email, qr_code, qr_token
    ) VALUES (
      v_event.id, 'VIP - ' || coalesce(v_vip.name, 'VIP'), NULL,
      v_vip.base_price, 1, v_vip.base_price,
      'valid', 'active', 'valid', 'paid', v_worker.id, now(),
      btrim(p_buyer_name), lower(btrim(p_buyer_email)), p_buyer_age,
      btrim(p_buyer_name), lower(btrim(p_buyer_email)), v_token::text, v_token
    ) RETURNING id INTO v_ticket_id;
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  RETURN jsonb_build_object('ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.sell_vip_manual(uuid,uuid,integer,text,text,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_vip_manual(uuid,uuid,integer,text,text,integer)
  TO authenticated, service_role;
