DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificacion_tipo') THEN
    CREATE TYPE public.notificacion_tipo AS ENUM (
      'compra_entrada',
      'compra_vip',
      'compra_reventa',
      'credito_generado',
      'entrada_recibida_por_reventa',
      'pago_enviado_organizador',
      'evento_proximo_24h',
      'evento_proximo_3h',
      'evento_proximo_30min',
      'evento_manana',
      'entrada_validada'
    );
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS referencia_evento_id uuid,
  ADD COLUMN IF NOT EXISTS tipo public.notificacion_tipo;

CREATE INDEX IF NOT EXISTS idx_notifications_user_tipo_evento_created_at
ON public.notifications(user_id, tipo, referencia_evento_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.crearNotificacion(
  p_usuario_id uuid,
  p_tipo public.notificacion_tipo,
  p_referencia_evento_id uuid,
  p_titulo text,
  p_mensaje text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing uuid;
  v_dedupe_seconds int;
  v_role text;
  v_recent_count int;
  v_channels text[];
  v_status text;
  v_error text;
  v_priority text;
  v_id uuid;
  v_data jsonb;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'usuario_id required';
  END IF;

  v_dedupe_seconds := CASE
    WHEN p_tipo = 'entrada_validada' THEN 10
    ELSE 43200
  END;

  SELECT n.id INTO v_existing
  FROM public.notifications n
  WHERE n.user_id = p_usuario_id
    AND n.tipo = p_tipo
    AND n.referencia_evento_id IS NOT DISTINCT FROM p_referencia_evento_id
    AND n.created_at > now() - make_interval(secs => v_dedupe_seconds)
  ORDER BY n.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  BEGIN
    SELECT COALESCE(NULLIF(p.role, ''), 'attendee') INTO v_role
    FROM public.profiles p
    WHERE p.id = p_usuario_id;
  EXCEPTION
    WHEN undefined_table THEN
      v_role := 'attendee';
    WHEN undefined_column THEN
      v_role := 'attendee';
    WHEN others THEN
      v_role := 'attendee';
  END;

  v_role := COALESCE(v_role, 'attendee');

  BEGIN
    SELECT COALESCE(t.default_channels, ARRAY['in_app','push']::text[]) INTO v_channels
    FROM public.notification_templates t
    WHERE t.key = p_tipo::text AND t.enabled = true;
  EXCEPTION
    WHEN undefined_table THEN
      v_channels := ARRAY['in_app','push']::text[];
    WHEN undefined_column THEN
      v_channels := ARRAY['in_app','push']::text[];
    WHEN others THEN
      v_channels := ARRAY['in_app','push']::text[];
  END;

  v_channels := COALESCE(v_channels, ARRAY['in_app','push']::text[]);

  SELECT count(*) INTO v_recent_count
  FROM public.notifications
  WHERE user_id = p_usuario_id
    AND created_at > now() - interval '1 minute';

  v_status := 'pending';
  v_error := NULL;
  IF v_recent_count >= 5 THEN
    v_status := 'blocked';
    v_error := 'rate_limited';
  END IF;

  v_priority := CASE
    WHEN p_tipo IN ('compra_entrada','compra_vip','compra_reventa','entrada_validada') THEN 'high'
    WHEN p_tipo IN ('evento_proximo_24h','evento_proximo_3h','evento_proximo_30min','evento_manana') THEN 'high'
    ELSE 'normal'
  END;

  v_data := jsonb_build_object(
    'event_id', COALESCE(p_referencia_evento_id::text, ''),
    'tipo', p_tipo::text
  );

  BEGIN
    INSERT INTO public.notifications (
      user_id,
      role,
      type,
      title,
      body,
      data,
      priority,
      status,
      error_message,
      channels,
      tipo,
      referencia_evento_id,
      read
    )
    VALUES (
      p_usuario_id,
      v_role,
      p_tipo::text,
      COALESCE(NULLIF(p_titulo, ''), 'Notificación'),
      COALESCE(NULLIF(p_mensaje, ''), ''),
      v_data,
      v_priority,
      v_status,
      v_error,
      v_channels,
      p_tipo,
      p_referencia_evento_id,
      false
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN undefined_column THEN
      INSERT INTO public.notifications (
        user_id,
        role,
        type,
        message,
        created_at,
        tipo,
        referencia_evento_id
      )
      VALUES (
        p_usuario_id,
        v_role,
        p_tipo::text,
        COALESCE(NULLIF(p_mensaje, ''), ''),
        now(),
        p_tipo,
        p_referencia_evento_id
      )
      RETURNING id INTO v_id;
    WHEN others THEN
      INSERT INTO public.notifications (
        user_id,
        role,
        type,
        message,
        created_at
      )
      VALUES (
        p_usuario_id,
        v_role,
        p_tipo::text,
        COALESCE(NULLIF(p_mensaje, ''), ''),
        now()
      )
      RETURNING id INTO v_id;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crearNotificacion(uuid, public.notificacion_tipo, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crearNotificacion(uuid, public.notificacion_tipo, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public."triggerNotificationsOnTransactionComplete"(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_vip public.reservados_vip%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_rt public.resale_transactions%ROWTYPE;
  v_event_id uuid;
  v_tipo_comprador public.notificacion_tipo;
  v_title text;
  v_body text;
BEGIN
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE id = p_transaction_id;

  IF v_tx.id IS NULL OR v_tx.status IS DISTINCT FROM 'fulfilled' THEN
    RETURN;
  END IF;

  IF v_tx.kind = 'event_ticket' THEN
    v_event_id := NULLIF(v_tx.metadata->>'event_id', '')::uuid;
    SELECT * INTO v_event FROM public.events WHERE id = v_event_id;
    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_tipo_comprador := 'compra_entrada';
    v_title := '✅ Compra confirmada';
    v_body := 'Tu compra se ha confirmado. Tienes tus entradas en Mis Entradas.';

    PERFORM public.crearNotificacion(v_tx.user_id, v_tipo_comprador, v_event.id, v_title, v_body);

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.crearNotificacion(
        v_event.creator_id,
        v_tipo_comprador,
        v_event.id,
        '💸 Nueva venta',
        'Se ha vendido una nueva entrada para tu evento'
      );
    END IF;
    RETURN;
  END IF;

  IF v_tx.kind = 'vip_table' THEN
    SELECT * INTO v_vip
    FROM public.reservados_vip
    WHERE id = NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;

    IF v_vip.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = v_vip.event_id;
    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_tipo_comprador := 'compra_vip';
    v_title := '✅ VIP confirmado';
    v_body := 'Tu compra VIP se ha confirmado. Disfruta del evento.';

    PERFORM public.crearNotificacion(v_tx.user_id, v_tipo_comprador, v_event.id, v_title, v_body);

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.crearNotificacion(
        v_event.creator_id,
        v_tipo_comprador,
        v_event.id,
        '💸 Nueva venta VIP',
        'Se ha vendido una nueva entrada VIP para tu evento'
      );
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

    SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id;
    IF v_ticket.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_tipo_comprador := 'compra_reventa';
    v_title := '✅ Compra confirmada';
    v_body := 'Tu compra en reventa se ha confirmado. Tienes tu entrada en Mis Entradas.';

    PERFORM public.crearNotificacion(v_tx.user_id, v_tipo_comprador, v_event.id, v_title, v_body);

    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM v_tx.user_id THEN
      PERFORM public.crearNotificacion(
        v_listing.seller_id,
        'entrada_recibida_por_reventa',
        v_event.id,
        '📩 Entrada transferida',
        'Se ha realizado una compra de tu entrada en reventa.'
      );
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.crearNotificacion(
        v_event.creator_id,
        v_tipo_comprador,
        v_event.id,
        '💸 Nueva venta',
        'Se ha vendido una nueva entrada para tu evento'
      );
    END IF;
    RETURN;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_ledger_movimientos_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
  v_event_title text;
  v_tx public.payment_transactions%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF NEW.tipo = 'generacion_credito_reventa' AND NEW.usuario_id IS NOT NULL THEN
    v_event_id := NULL;

    SELECT * INTO v_tx
    FROM public.payment_transactions
    WHERE stripe_payment_intent_id = NEW.referencia_id
      AND kind = 'resale_ticket'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_tx.id IS NOT NULL THEN
      SELECT * INTO v_listing
      FROM public.resale_listings
      WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid;
    ELSE
      SELECT * INTO v_listing
      FROM public.resale_listings
      WHERE id = NULLIF(NEW.referencia_id, '')::uuid;
    END IF;

    IF v_listing.id IS NOT NULL THEN
      SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id;
      IF v_ticket.id IS NOT NULL THEN
        SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
        v_event_id := v_event.id;
        v_event_title := v_event.title;
      END IF;
    END IF;

    PERFORM public.crearNotificacion(
      NEW.usuario_id,
      'credito_generado',
      v_event_id,
      '💳 Crédito generado',
      'Se ha generado crédito por una reventa.'
    );
  END IF;

  IF NEW.tipo = 'pago_organizador' AND NEW.organizador_id IS NOT NULL THEN
    PERFORM public.crearNotificacion(
      NEW.organizador_id,
      'pago_enviado_organizador',
      NULL,
      '💸 Pago enviado',
      'Se ha enviado un pago a tu cuenta.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_movimientos_notifications ON public.ledger_movimientos;
CREATE TRIGGER trg_ledger_movimientos_notifications
AFTER INSERT ON public.ledger_movimientos
FOR EACH ROW
EXECUTE FUNCTION public.handle_ledger_movimientos_notifications();

CREATE OR REPLACE FUNCTION public.notify_ticket_validated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
BEGIN
  IF (TG_OP = 'UPDATE')
     AND (OLD.status IS DISTINCT FROM 'used')
     AND (NEW.status = 'used')
     AND NEW.user_id IS NOT NULL THEN
    SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
    PERFORM public.crearNotificacion(
      NEW.user_id,
      'entrada_validada',
      NEW.event_id,
      '✅ Entrada validada',
      'Tu entrada ha sido validada. Disfruta del evento'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ticket_validated ON public.tickets;
CREATE TRIGGER trg_notify_ticket_validated
AFTER UPDATE OF status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_validated();

CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.user_id, e.id AS event_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    PERFORM public.crearNotificacion(
      r.user_id,
      'evento_proximo_24h',
      r.event_id,
      '⏰ Evento próximo',
      'Tu evento es mañana. Ve preparándote 🎉'
    );
  END LOOP;

  FOR r IN
    SELECT DISTINCT t.user_id, e.id AS event_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
  LOOP
    PERFORM public.crearNotificacion(
      r.user_id,
      'evento_proximo_3h',
      r.event_id,
      '⏰ Evento próximo',
      'Tu evento empieza en 3 horas'
    );
  END LOOP;

  FOR r IN
    SELECT DISTINCT t.user_id, e.id AS event_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
  LOOP
    PERFORM public.crearNotificacion(
      r.user_id,
      'evento_proximo_30min',
      r.event_id,
      '⏰ Evento próximo',
      'Tu evento empieza en 30 minutos. Es hora de ir'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.schedule_event_notifications();
END;
$$;

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
BEGIN
  IF p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  PERFORM public.apply_credito_delta(p_user_id, -ROUND(p_total_price::numeric, 2), 'compra_con_credito', NULL, 'Compra con crédito (sin Stripe)');

  SELECT available_tickets INTO v_event_available
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

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

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  PERFORM public.crearNotificacion(
    p_user_id,
    'compra_entrada',
    p_event_id,
    '✅ Compra confirmada',
    'Tu compra se ha confirmado. Tienes tus entradas en Mis Entradas.'
  );

  IF v_event.creator_id IS NOT NULL THEN
    PERFORM public.crearNotificacion(
      v_event.creator_id,
      'compra_entrada',
      p_event_id,
      '💸 Nueva venta',
      'Se ha vendido una nueva entrada para tu evento'
    );
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
BEGIN
  IF p_vip_reservado_id IS NULL THEN
    RAISE EXCEPTION 'VIP not found';
  END IF;

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id
  FOR UPDATE;

  IF v_vip IS NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  v_price := ROUND(COALESCE(v_vip.base_price, 0)::numeric, 2);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  PERFORM public.apply_credito_delta(p_user_id, -v_price, 'compra_con_credito', NULL, 'Compra VIP con crédito (sin Stripe)');

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - 1
  WHERE id = v_vip.id;

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
    GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
    gen_random_uuid(),
    gen_random_uuid()::text,
    NULL,
    v_price,
    'valid',
    'active'
  )
  RETURNING id INTO v_ticket_id;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_vip.event_id;

  PERFORM public.crearNotificacion(
    p_user_id,
    'compra_vip',
    v_vip.event_id,
    '✅ VIP confirmado',
    'Tu compra VIP se ha confirmado. Disfruta del evento.'
  );

  IF v_event.creator_id IS NOT NULL THEN
    PERFORM public.crearNotificacion(
      v_event.creator_id,
      'compra_vip',
      v_vip.event_id,
      '💸 Nueva venta VIP',
      'Se ha vendido una nueva entrada VIP para tu evento'
    );
  END IF;

  RETURN json_build_object('success', true, 'ticket_id', v_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_commission numeric;
  v_seller_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Listing not active';
  END IF;

  IF v_listing.seller_id IS DISTINCT FROM NULL AND v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy own listing';
  END IF;

  v_commission := ROUND((v_listing.price * 0.12)::numeric, 2);
  v_seller_amount := ROUND((v_listing.price - v_commission)::numeric, 2);

  PERFORM public.apply_credito_delta(p_buyer_id, -ROUND(v_listing.price::numeric, 2), 'compra_con_credito', p_listing_id::text, 'Compra reventa con crédito (sin Stripe)');
  PERFORM public.apply_credito_delta(v_listing.seller_id, v_seller_amount, 'generacion_credito_reventa', p_listing_id::text, 'Crédito generado por reventa');
  PERFORM public.record_ledger_movimiento('comision_plataforma', NULL, NULL, v_commission, p_listing_id::text, 'Comisión plataforma reventa');

  UPDATE public.tickets
  SET
    user_id = p_buyer_id,
    status = 'valid',
    ticket_status = 'active',
    qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text,
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now()
  WHERE id = v_listing.ticket_id;

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = v_listing.id;

  INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount)
  VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_buyer_id, v_listing.price, v_commission, v_seller_amount);

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_listing.ticket_id;

  IF v_ticket.id IS NOT NULL THEN
    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_ticket.event_id;
  END IF;

  PERFORM public.crearNotificacion(
    p_buyer_id,
    'compra_reventa',
    v_ticket.event_id,
    '✅ Compra confirmada',
    'Tu compra en reventa se ha confirmado. Tienes tu entrada en Mis Entradas.'
  );

  IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM p_buyer_id THEN
    PERFORM public.crearNotificacion(
      v_listing.seller_id,
      'entrada_recibida_por_reventa',
      v_ticket.event_id,
      '📩 Entrada transferida',
      'Se ha realizado una compra de tu entrada en reventa.'
    );
  END IF;

  IF v_event.creator_id IS NOT NULL THEN
    PERFORM public.crearNotificacion(
      v_event.creator_id,
      'compra_reventa',
      v_ticket.event_id,
      '💸 Nueva venta',
      'Se ha vendido una nueva entrada para tu evento'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing.id, 'ticket_id', v_listing.ticket_id);
END;
$$;

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
      IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'cron'
          AND p.proname = 'schedule'
      ) THEN
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event_reminders_5min') THEN
            PERFORM cron.schedule('event_reminders_5min', '*/5 * * * *', $$select public.schedule_event_notifications();$$);
          END IF;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
