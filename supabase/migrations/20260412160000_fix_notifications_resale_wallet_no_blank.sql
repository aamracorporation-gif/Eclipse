CREATE OR REPLACE FUNCTION public.fill_notification_title_body_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message text;
  v_tpl public.notification_templates%ROWTYPE;
  v_data jsonb;
BEGIN
  v_message := NULLIF(COALESCE(to_jsonb(NEW)->>'message', ''), '');
  v_data := COALESCE(NEW.data, '{}'::jsonb);

  IF (NEW.title IS NULL OR btrim(NEW.title) = '' OR NEW.body IS NULL OR btrim(NEW.body) = '') THEN
    BEGIN
      SELECT * INTO v_tpl
      FROM public.notification_templates
      WHERE key = NEW.type AND enabled = true;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_tpl.key IS NOT NULL THEN
      IF (NEW.title IS NULL OR btrim(NEW.title) = '') THEN
        NEW.title := public.render_notification_template(v_tpl.title_template, v_data);
      END IF;
      IF (NEW.body IS NULL OR btrim(NEW.body) = '') THEN
        NEW.body := public.render_notification_template(v_tpl.body_template, v_data);
      END IF;
    END IF;
  END IF;

  IF (NEW.title IS NULL OR btrim(NEW.title) = '') THEN
    NEW.title := 'Notificación';
  END IF;

  IF (NEW.body IS NULL OR btrim(NEW.body) = '') THEN
    IF v_message IS NOT NULL THEN
      NEW.body := v_message;
    ELSIF NEW.title IS NOT NULL AND btrim(NEW.title) <> '' THEN
      NEW.body := NEW.title;
    ELSE
      NEW.body := COALESCE(NULLIF(NEW.type, ''), '');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_notification_title_body ON public.notifications;
CREATE TRIGGER trg_fill_notification_title_body
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.fill_notification_title_body_from_message();

CREATE OR REPLACE FUNCTION public.notify_ticket_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id uuid;
  v_event_id uuid;
  v_event_title text;
  v_event_date timestamptz;
  v_venue_id uuid;
  v_venue_name text;
  v_venue_address text;
  v_organizer_id uuid;

  v_new_owner uuid;
  v_old_owner uuid;

  v_buyer_id uuid;
  v_seller_id uuid;

  v_lock_key bigint;
  v_data jsonb;

  v_qr_token text;
  v_qr_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_new_owner :=
    COALESCE(
      NULLIF(to_jsonb(NEW)->>'owner_id', '')::uuid,
      NULLIF(to_jsonb(NEW)->>'user_id', '')::uuid
    );

  v_old_owner :=
    COALESCE(
      NULLIF(to_jsonb(OLD)->>'owner_id', '')::uuid,
      NULLIF(to_jsonb(OLD)->>'user_id', '')::uuid
    );

  IF v_old_owner IS NOT DISTINCT FROM v_new_owner THEN
    RETURN NEW;
  END IF;

  IF (NULLIF(COALESCE(to_jsonb(OLD)->>'ticket_status', ''), '')) IS NOT NULL THEN
    IF (to_jsonb(OLD)->>'ticket_status') IS DISTINCT FROM 'reselling' AND (to_jsonb(OLD)->>'status') IS DISTINCT FROM 'resale' THEN
      RETURN NEW;
    END IF;
  ELSE
    IF (to_jsonb(OLD)->>'status') IS DISTINCT FROM 'resale' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_ticket_id := NEW.id;
  v_event_id := NEW.event_id;
  v_buyer_id := v_new_owner;
  v_seller_id := v_old_owner;

  v_lock_key :=
    hashtext(
      'notify_ticket_sale:' ||
      COALESCE(v_ticket_id::text, '') || ':' ||
      COALESCE(v_buyer_id::text, '') || ':' ||
      COALESCE(v_seller_id::text, '') || ':resale'
    )::bigint;

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN NEW;
  END IF;

  SELECT e.title, e.event_date, e.venue_id, e.creator_id
  INTO v_event_title, v_event_date, v_venue_id, v_organizer_id
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_venue_id IS NOT NULL THEN
    SELECT v.name, v.address INTO v_venue_name, v_venue_address
    FROM public.venues v
    WHERE v.id = v_venue_id;
  END IF;

  v_event_title := COALESCE(NULLIF(v_event_title, ''), 'este evento');

  v_qr_token := COALESCE(NULLIF(to_jsonb(NEW)->>'qr_token', ''), NULLIF(to_jsonb(NEW)->>'qr_code', ''), '');
  v_qr_code := COALESCE(NULLIF(to_jsonb(NEW)->>'qr_code', ''), '');

  v_data := jsonb_build_object(
    'event_id', v_event_id::text,
    'event_title', v_event_title,
    'name', '¡Genial!',
    'quantity', '1',
    'event_date', COALESCE(v_event_date::text, ''),
    'venue_name', COALESCE(v_venue_name, ''),
    'venue_address', COALESCE(v_venue_address, ''),
    'ticket_id', v_ticket_id::text,
    'qr_token', v_qr_token,
    'qr_code', v_qr_code,
    'buyer_id', COALESCE(v_buyer_id::text, ''),
    'seller_id', COALESCE(v_seller_id::text, ''),
    'source', 'resale',
    'payment_method', 'resale'
  );

  IF v_organizer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_organizer_id,
        'organizer',
        'organizer_realtime_sale',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_organizer_id,
        'organizer',
        'organizer_realtime_sale',
        '💰 Nueva venta',
        'Se ha vendido 1 entrada para ' || v_event_title || '.',
        'normal',
        v_data
      );
    END;
  END IF;

  IF v_buyer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_buyer_id,
        'attendee',
        'purchase_completed',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_buyer_id,
        'attendee',
        'purchase_completed',
        '🎉 ¡Compra completada!',
        'Tu compra para ' || v_event_title || ' se confirmó.',
        'high',
        v_data
      );
    END;
  END IF;

  IF v_seller_id IS NOT NULL AND v_seller_id IS DISTINCT FROM v_buyer_id THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_seller_id,
        'attendee',
        'resale_sold',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_seller_id,
        'attendee',
        'resale_sold',
        '💸 Entrada vendida',
        'Has vendido tu entrada de ' || v_event_title || '.',
        'high',
        v_data
      );
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_ticket_sale ON public.tickets;
CREATE TRIGGER trigger_notify_ticket_sale
AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_sale();

CREATE OR REPLACE FUNCTION public.buy_ticket_with_wallet(
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
  v_wallet public.wallets%ROWTYPE;
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  v_first_id uuid;
  i integer;
  v_single_price numeric;
  v_has_ticket_type_table boolean;
  v_has_ticket_type_column boolean;
  v_has_qr_token boolean;
  v_has_ticket_status boolean;
  v_event_title text;
  v_organizer_id uuid;
  v_pi text;
  v_tx_id uuid;
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

  v_has_ticket_type_table := to_regclass('public.event_ticket_types') IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'ticket_type_id'
  ) INTO v_has_ticket_type_column;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'qr_token'
  ) INTO v_has_qr_token;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'ticket_status'
  ) INTO v_has_ticket_status;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance)
    VALUES (p_user_id, 0)
    RETURNING * INTO v_wallet;
  END IF;

  IF v_wallet.balance < p_total_price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  SELECT available_tickets, title, creator_id INTO v_event_available, v_event_title, v_organizer_id
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available in event';
  END IF;

  IF p_ticket_type_id IS NOT NULL AND v_has_ticket_type_table THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id
    FOR UPDATE;

    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
      RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  v_single_price := p_total_price / p_quantity;
  v_ticket_ids := ARRAY[]::uuid[];

  UPDATE public.events
  SET
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  IF p_ticket_type_id IS NOT NULL AND v_has_ticket_type_table THEN
    UPDATE public.event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  FOR i IN 1..p_quantity LOOP
    IF v_has_ticket_type_column AND p_ticket_type_id IS NOT NULL THEN
      IF v_has_qr_token AND v_has_ticket_status THEN
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code, ticket_type_id,
            qr_token, ticket_status, purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8, gen_random_uuid(), ''active'', now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i), p_ticket_type_id;
      ELSE
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code, ticket_type_id,
            purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i), p_ticket_type_id;
      END IF;
    ELSE
      IF v_has_qr_token AND v_has_ticket_status THEN
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code,
            qr_token, ticket_status, purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7, gen_random_uuid(), ''active'', now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i);
      ELSE
        EXECUTE '
          INSERT INTO public.tickets (
            event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code,
            purchase_date, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7, now(), ''valid'')
          RETURNING id
        '
        INTO v_ticket_id
        USING p_event_id, p_user_id, p_buyer_name, p_buyer_email, 1, v_single_price, (p_qr_code || '-' || i);
      END IF;
    END IF;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  v_first_id := v_ticket_ids[1];

  UPDATE public.wallets
  SET balance = balance - p_total_price,
      updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (
    v_wallet.id,
    p_total_price,
    'debit',
    'Purchase ' || p_quantity || ' ticket(s)',
    v_first_id
  );

  v_pi := 'wallet:' || v_first_id::text;

  INSERT INTO public.payment_transactions (
    user_id,
    kind,
    amount_cents,
    currency,
    stripe_payment_intent_id,
    status,
    metadata
  )
  VALUES (
    p_user_id,
    'event_ticket',
    ROUND(p_total_price * 100)::int,
    'eur',
    v_pi,
    'created',
    jsonb_build_object(
      'event_id', p_event_id::text,
      'ticket_type_id', COALESCE(p_ticket_type_id::text, ''),
      'quantity', p_quantity::text,
      'buyer_name', COALESCE(p_buyer_name, ''),
      'buyer_email', COALESCE(p_buyer_email, ''),
      'ticket_id', v_first_id::text,
      'payment_method', 'wallet'
    )
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.payment_transactions
  SET status = 'fulfilled',
      fulfilled_at = now()
  WHERE id = v_tx_id;

  RETURN json_build_object('ticket_ids', v_ticket_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_ticket_with_wallet(uuid, uuid, text, text, int, numeric, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
