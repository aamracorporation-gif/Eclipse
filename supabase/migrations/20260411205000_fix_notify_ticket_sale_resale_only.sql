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
  v_organizer_id uuid;
  v_venue_id uuid;
  v_venue_name text;
  v_venue_address text;

  v_new_owner uuid;
  v_old_owner uuid;

  v_buyer_id uuid;
  v_seller_id uuid;
  v_is_resale boolean := false;

  v_lock_key bigint;
  v_data jsonb;

  v_qr_token text;
  v_qr_code text;

  v_rt record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_ticket_id := NEW.id;
  v_event_id := NEW.event_id;

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

  v_buyer_id := v_new_owner;
  v_seller_id := v_old_owner;
  v_is_resale := true;

  BEGIN
    SELECT *
    INTO v_rt
    FROM public.resale_transactions rt
    WHERE rt.ticket_id = v_ticket_id
    ORDER BY rt.created_at DESC
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    RETURN NEW;
  WHEN others THEN
    RETURN NEW;
  END;

  IF v_rt IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.title, e.creator_id, e.event_date, e.venue_id
  INTO v_event_title, v_organizer_id, v_event_date, v_venue_id
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

  v_data := jsonb_build_object(
    'event_id', v_event_id::text,
    'event_title', v_event_title,
    'event_date', COALESCE(v_event_date::text, ''),
    'venue_name', COALESCE(v_venue_name, ''),
    'venue_address', COALESCE(v_venue_address, ''),
    'ticket_id', v_ticket_id::text,
    'qr_token', v_qr_token,
    'qr_code', v_qr_code,
    'buyer_id', COALESCE(v_buyer_id::text, ''),
    'seller_id', COALESCE(v_seller_id::text, ''),
    'source', 'resale',
    'resale_transaction_id', COALESCE(to_jsonb(v_rt)->>'id', NULL),
    'amount', COALESCE(to_jsonb(v_rt)->>'price', NULL),
    'commission', COALESCE(to_jsonb(v_rt)->>'commission', NULL),
    'seller_amount', COALESCE(to_jsonb(v_rt)->>'seller_amount', NULL),
    'payment_method', 'resale'
  );

  IF v_organizer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(
      v_organizer_id,
      'organizer',
      'organizer_realtime_sale',
      v_data
    );
  END IF;

  IF v_buyer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(
      v_buyer_id,
      'attendee',
      'purchase_success',
      v_data
    );

    PERFORM public.enqueue_notification_from_template(
      v_buyer_id,
      'attendee',
      'ticket_available',
      v_data
    );
  END IF;

  IF v_seller_id IS NOT NULL AND v_seller_id IS DISTINCT FROM v_buyer_id THEN
    PERFORM public.enqueue_notification_from_template(
      v_seller_id,
      'attendee',
      'resale_sold',
      v_data
    );
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

