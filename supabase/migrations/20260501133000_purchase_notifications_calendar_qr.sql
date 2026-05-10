CREATE OR REPLACE FUNCTION public.buy_ticket_with_credito(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity int,
  p_total_price numeric,
  p_qr_code text,
  p_ticket_type_id uuid DEFAULT NULL
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
  v_first_ticket public.tickets%ROWTYPE;
  v_venue public.venues%ROWTYPE;
  v_data jsonb;
  v_calendar_url text;
  v_map_url text;
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

  PERFORM public.apply_credito_delta(
    p_user_id,
    -ROUND(p_total_price::numeric, 2),
    'compra_con_credito',
    NULL,
    'Compra con crédito (sin Stripe)'
  );

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
      ticket_status
    )
    VALUES (
      p_event_id,
      p_user_id,
      p_buyer_name,
      p_buyer_email,
      1,
      gen_random_uuid(),
      p_qr_code,
      p_ticket_type_id,
      v_single_price,
      'valid',
      'active'
    )
    RETURNING id INTO v_ticket_id;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  UPDATE public.events
  SET available_tickets = available_tickets - p_quantity,
      sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE public.event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  SELECT * INTO v_first_ticket
  FROM public.tickets
  WHERE id = v_ticket_ids[1];

  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = v_event.venue_id;

  v_calendar_url := '/functions/v1/ticket-calendar?ticket_id=' || COALESCE(v_first_ticket.id::text, '') || '&token=' || COALESCE(v_first_ticket.qr_token::text, '');
  v_map_url := CASE
    WHEN v_venue.latitude IS NOT NULL AND v_venue.longitude IS NOT NULL THEN
      'https://www.google.com/maps/search/?api=1&query=' || v_venue.latitude::text || ',' || v_venue.longitude::text
    ELSE
      ''
  END;

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_user_id::text, ''),
    'event_id', COALESCE(v_event.id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'event_date', COALESCE(v_event.event_date::text, ''),
    'quantity', GREATEST(p_quantity, 1)::text,
    'ticket_id', COALESCE(v_first_ticket.id::text, ''),
    'qr_token', COALESCE(v_first_ticket.qr_token::text, ''),
    'calendar_url', COALESCE(v_calendar_url, ''),
    'map_url', COALESCE(v_map_url, ''),
    'venue_name', COALESCE(v_venue.name, ''),
    'venue_address', COALESCE(v_venue.address, ''),
    'payment_method', 'wallet'
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_event.creator_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN json_build_object('success', true, 'ticket_ids', v_ticket_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_vip_with_credito(
  p_vip_reservado_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vip public.reservados_vip%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_price numeric;
  v_ticket_id uuid;
  v_ticket public.tickets%ROWTYPE;
  v_qty int;
  v_venue public.venues%ROWTYPE;
  v_data jsonb;
  v_calendar_url text;
  v_map_url text;
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

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_vip.event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  PERFORM public.apply_credito_delta(p_user_id, -v_price, 'compra_con_credito', NULL, 'Compra VIP con crédito (sin Stripe)');

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
    ticket_status
  )
  VALUES (
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
    'active'
  )
  RETURNING id INTO v_ticket_id;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_ticket_id;

  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = v_event.venue_id;

  v_calendar_url := '/functions/v1/ticket-calendar?ticket_id=' || COALESCE(v_ticket.id::text, '') || '&token=' || COALESCE(v_ticket.qr_token::text, '');
  v_map_url := CASE
    WHEN v_venue.latitude IS NOT NULL AND v_venue.longitude IS NOT NULL THEN
      'https://www.google.com/maps/search/?api=1&query=' || v_venue.latitude::text || ',' || v_venue.longitude::text
    ELSE
      ''
  END;

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_user_id::text, ''),
    'event_id', COALESCE(v_event.id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'event_date', COALESCE(v_event.event_date::text, ''),
    'quantity', v_qty::text,
    'ticket_id', COALESCE(v_ticket.id::text, ''),
    'qr_token', COALESCE(v_ticket.qr_token::text, ''),
    'vip_reservado_id', COALESCE(v_vip.id::text, ''),
    'calendar_url', COALESCE(v_calendar_url, ''),
    'map_url', COALESCE(v_map_url, ''),
    'venue_name', COALESCE(v_venue.name, ''),
    'venue_address', COALESCE(v_venue.address, ''),
    'payment_method', 'wallet',
    'kind', 'vip_table'
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_event.creator_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN json_build_object('success', true, 'ticket_id', v_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerNotificationsOnTransactionComplete"(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_rt public.resale_transactions%ROWTYPE;
  v_vip public.reservados_vip%ROWTYPE;
  v_event_id uuid;
  v_vip_id uuid;
  v_qty int := 1;
  v_data jsonb;
  v_pi text;
  v_first_ticket public.tickets%ROWTYPE;
  v_venue public.venues%ROWTYPE;
  v_calendar_url text;
  v_map_url text;
BEGIN
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE id = p_transaction_id;

  IF v_tx.id IS NULL OR v_tx.status IS DISTINCT FROM 'fulfilled' THEN
    RETURN;
  END IF;

  v_pi := NULLIF(COALESCE(v_tx.stripe_payment_intent_id, ''), '');

  IF v_tx.kind = 'event_ticket' THEN
    v_event_id := NULLIF(v_tx.metadata->>'event_id', '')::uuid;
    v_qty := GREATEST(COALESCE((v_tx.metadata->>'quantity')::int, 1), 1);

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_first_ticket
    FROM public.tickets t
    WHERE t.payment_transaction_id = v_tx.id
    ORDER BY t.id ASC
    LIMIT 1;

    SELECT * INTO v_venue
    FROM public.venues
    WHERE id = v_event.venue_id;

    v_calendar_url := '/functions/v1/ticket-calendar?ticket_id=' || COALESCE(v_first_ticket.id::text, '') || '&token=' || COALESCE(v_first_ticket.qr_token::text, '');
    v_map_url := CASE
      WHEN v_venue.latitude IS NOT NULL AND v_venue.longitude IS NOT NULL THEN
        'https://www.google.com/maps/search/?api=1&query=' || v_venue.latitude::text || ',' || v_venue.longitude::text
      ELSE
        ''
    END;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'event_date', COALESCE(v_event.event_date::text, ''),
      'quantity', v_qty::text,
      'ticket_id', COALESCE(v_first_ticket.id::text, ''),
      'qr_token', COALESCE(v_first_ticket.qr_token::text, ''),
      'calendar_url', COALESCE(v_calendar_url, ''),
      'map_url', COALESCE(v_map_url, ''),
      'venue_name', COALESCE(v_venue.name, ''),
      'venue_address', COALESCE(v_venue.address, ''),
      'payment_intent_id', COALESCE(v_pi, '')
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;

  IF v_tx.kind = 'vip_table' THEN
    v_vip_id := NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;
    IF v_vip_id IS NULL THEN
      v_vip_id := NULLIF(v_tx.metadata->>'reference_id', '')::uuid;
    END IF;
    IF v_vip_id IS NULL THEN
      v_vip_id := NULLIF(v_tx.metadata->>'vip_id', '')::uuid;
    END IF;

    IF v_vip_id IS NOT NULL THEN
      SELECT * INTO v_vip
      FROM public.reservados_vip
      WHERE id = v_vip_id;
    END IF;

    IF v_vip.id IS NULL THEN
      v_event_id := NULLIF(v_tx.metadata->>'event_id', '')::uuid;
      v_qty := 1;
    ELSE
      v_event_id := v_vip.event_id;
      v_qty := GREATEST(COALESCE(v_vip.capacity_people, 1), 1);
    END IF;

    IF v_event_id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_first_ticket
    FROM public.tickets t
    WHERE t.payment_transaction_id = v_tx.id
    ORDER BY t.id ASC
    LIMIT 1;

    SELECT * INTO v_venue
    FROM public.venues
    WHERE id = v_event.venue_id;

    v_calendar_url := '/functions/v1/ticket-calendar?ticket_id=' || COALESCE(v_first_ticket.id::text, '') || '&token=' || COALESCE(v_first_ticket.qr_token::text, '');
    v_map_url := CASE
      WHEN v_venue.latitude IS NOT NULL AND v_venue.longitude IS NOT NULL THEN
        'https://www.google.com/maps/search/?api=1&query=' || v_venue.latitude::text || ',' || v_venue.longitude::text
      ELSE
        ''
    END;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'event_date', COALESCE(v_event.event_date::text, ''),
      'quantity', v_qty::text,
      'ticket_id', COALESCE(v_first_ticket.id::text, ''),
      'qr_token', COALESCE(v_first_ticket.qr_token::text, ''),
      'vip_reservado_id', COALESCE(v_vip.id::text, ''),
      'calendar_url', COALESCE(v_calendar_url, ''),
      'map_url', COALESCE(v_map_url, ''),
      'venue_name', COALESCE(v_venue.name, ''),
      'venue_address', COALESCE(v_venue.address, ''),
      'payment_intent_id', COALESCE(v_pi, ''),
      'kind', 'vip_table'
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;

  IF v_tx.kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid;

    IF v_listing.id IS NULL THEN
      SELECT * INTO v_rt
      FROM public.resale_transactions
      WHERE payment_transaction_id = v_tx.id
         OR stripe_payment_intent_id = v_tx.stripe_payment_intent_id
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_rt.id IS NOT NULL THEN
        SELECT * INTO v_listing FROM public.resale_listings WHERE id = v_rt.listing_id;
      END IF;
    END IF;

    IF v_listing.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_listing.ticket_id;

    IF v_ticket.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_ticket.event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_venue
    FROM public.venues
    WHERE id = v_event.venue_id;

    v_calendar_url := '/functions/v1/ticket-calendar?ticket_id=' || COALESCE(v_ticket.id::text, '') || '&token=' || COALESCE(v_ticket.qr_token::text, '');
    v_map_url := CASE
      WHEN v_venue.latitude IS NOT NULL AND v_venue.longitude IS NOT NULL THEN
        'https://www.google.com/maps/search/?api=1&query=' || v_venue.latitude::text || ',' || v_venue.longitude::text
      ELSE
        ''
    END;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'seller_id', COALESCE(v_listing.seller_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'event_date', COALESCE(v_event.event_date::text, ''),
      'quantity', '1',
      'ticket_id', v_ticket.id::text,
      'qr_token', COALESCE(v_ticket.qr_token::text, ''),
      'calendar_url', COALESCE(v_calendar_url, ''),
      'map_url', COALESCE(v_map_url, ''),
      'venue_name', COALESCE(v_venue.name, ''),
      'venue_address', COALESCE(v_venue.address, ''),
      'listing_id', v_listing.id::text,
      'payment_intent_id', COALESCE(v_pi, '')
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM v_tx.user_id THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'resale_sold', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;
END;
$$;

UPDATE public.notification_templates
SET
  body_template = '¡Listo! Tu compra para "{{event_title}}" se confirmó. Añade el evento al calendario: {{calendar_url}}',
  default_channels = ARRAY['in_app','push','email']::text[],
  updated_at = now()
WHERE key = 'purchase_completed';

NOTIFY pgrst, 'reload schema';
